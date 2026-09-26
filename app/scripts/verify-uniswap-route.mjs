import assert from 'node:assert/strict';

import {
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  keccak256,
  parseAbi,
  parseEther,
  parseUnits,
} from 'viem';
import { sepolia } from 'viem/chains';

import {
  SEPOLIA_NATIVE_CURRENCY_ADDRESS,
  SEPOLIA_PERMIT2_ADDRESS,
  SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
  SEPOLIA_UNISWAP_V4_POOL_MANAGER_ADDRESS,
  SEPOLIA_UNISWAP_V4_QUOTER_ADDRESS,
  SEPOLIA_UNISWAP_V4_STATE_VIEW_ADDRESS,
  SEPOLIA_USDC_ADDRESS,
  SWAP_POOL_ID,
  SWAP_POOL_KEY,
} from '../src/wallet/sepolia.ts';

if (!process.env.SEPOLIA_RPC_URL) {
  throw new Error('SEPOLIA_RPC_URL is required');
}

const V4_SWAP_COMMAND = '0x10';
const SWAP_EXACT_IN_SINGLE_SETTLE_ALL_TAKE_ALL = '0x060c0f';
const V4_TOO_LITTLE_RECEIVED_SELECTOR = '0x8b063d73';
const SIMULATION_ACCOUNT = '0x000000000000000000000000000000000000dEaD';

const poolKeyComponents = [
  { name: 'currency0', type: 'address' },
  { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' },
];
const exactInputSingleParams = [
  {
    type: 'tuple',
    components: [
      { name: 'poolKey', type: 'tuple', components: poolKeyComponents },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint128' },
      { name: 'amountOutMinimum', type: 'uint128' },
      { name: 'hookData', type: 'bytes' },
    ],
  },
];
const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
]);
const quoterAbi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
]);
const universalRouterAbi = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
]);

const client = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});
assert.equal(await client.getChainId(), sepolia.id);
const blockNumber = await client.getBlockNumber();

const contracts = {
  'Universal Router': SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
  'V4 Quoter': SEPOLIA_UNISWAP_V4_QUOTER_ADDRESS,
  StateView: SEPOLIA_UNISWAP_V4_STATE_VIEW_ADDRESS,
  PoolManager: SEPOLIA_UNISWAP_V4_POOL_MANAGER_ADDRESS,
  Permit2: SEPOLIA_PERMIT2_ADDRESS,
  USDC: SEPOLIA_USDC_ADDRESS,
};
for (const [name, address] of Object.entries(contracts)) {
  const code = await client.getCode({ address });
  assert.ok(code && code !== '0x', `${name} has no bytecode at ${address}`);
}

assert.ok(
  BigInt(SWAP_POOL_KEY.currency0) < BigInt(SWAP_POOL_KEY.currency1),
  'Pool key currencies are not sorted',
);
const derivedPoolId = keccak256(
  encodeAbiParameters([{ type: 'tuple', components: poolKeyComponents }], [SWAP_POOL_KEY]),
);
assert.equal(derivedPoolId, SWAP_POOL_ID, 'Pool key does not hash to the pinned pool ID');

const [liquidity, [sqrtPriceX96]] = await Promise.all([
  client.readContract({
    address: SEPOLIA_UNISWAP_V4_STATE_VIEW_ADDRESS,
    abi: stateViewAbi,
    functionName: 'getLiquidity',
    args: [SWAP_POOL_ID],
  }),
  client.readContract({
    address: SEPOLIA_UNISWAP_V4_STATE_VIEW_ADDRESS,
    abi: stateViewAbi,
    functionName: 'getSlot0',
    args: [SWAP_POOL_ID],
  }),
]);
assert.ok(sqrtPriceX96 > 0n, 'Pool is not initialized');
assert.ok(liquidity > 0n, 'Pool has no active liquidity');
const usdcPerEth = (Number(sqrtPriceX96) / 2 ** 96) ** 2 * 1e12;

async function quote(zeroForOne, exactAmount) {
  const { result } = await client.simulateContract({
    address: SEPOLIA_UNISWAP_V4_QUOTER_ADDRESS,
    abi: quoterAbi,
    functionName: 'quoteExactInputSingle',
    args: [{ poolKey: SWAP_POOL_KEY, zeroForOne, exactAmount, hookData: '0x' }],
  });
  return result[0];
}

const ethIn = parseEther('0.001');
const usdcIn = parseUnits('1', 6);
const [usdcOut, ethOut] = await Promise.all([quote(true, ethIn), quote(false, usdcIn)]);
assert.ok(usdcOut > 0n, 'ETH to USDC quote returned zero');
assert.ok(ethOut > 0n, 'USDC to ETH quote returned zero');

function ethToUsdcCalldata(amountIn, amountOutMinimum) {
  const input = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    [
      SWAP_EXACT_IN_SINGLE_SETTLE_ALL_TAKE_ALL,
      [
        encodeAbiParameters(exactInputSingleParams, [
          { poolKey: SWAP_POOL_KEY, zeroForOne: true, amountIn, amountOutMinimum, hookData: '0x' },
        ]),
        encodeAbiParameters(
          [{ type: 'address' }, { type: 'uint256' }],
          [SEPOLIA_NATIVE_CURRENCY_ADDRESS, amountIn],
        ),
        encodeAbiParameters(
          [{ type: 'address' }, { type: 'uint256' }],
          [SEPOLIA_USDC_ADDRESS, amountOutMinimum],
        ),
      ],
    ],
  );
  return encodeFunctionData({
    abi: universalRouterAbi,
    functionName: 'execute',
    args: [V4_SWAP_COMMAND, [input], BigInt(Math.floor(Date.now() / 1000) + 600)],
  });
}

function simulateEthToUsdc(amountOutMinimum) {
  return client.call({
    account: SIMULATION_ACCOUNT,
    to: SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
    data: ethToUsdcCalldata(ethIn, amountOutMinimum),
    value: ethIn,
    stateOverride: [{ address: SIMULATION_ACCOUNT, balance: parseEther('1') }],
  });
}

const minimumUsdcOut = (usdcOut * 9_950n) / 10_000n;
await simulateEthToUsdc(minimumUsdcOut);

const slippageRevert = await simulateEthToUsdc(usdcOut + 1n).then(
  () => null,
  (error) => error,
);
assert.ok(
  String(slippageRevert?.walk?.()?.data ?? '').startsWith(V4_TOO_LITTLE_RECEIVED_SELECTOR),
  'Swap above the quoted output did not revert with V4TooLittleReceived',
);

console.log(
  JSON.stringify(
    {
      chainId: sepolia.id,
      blockNumber: blockNumber.toString(),
      poolId: SWAP_POOL_ID,
      activeLiquidity: liquidity.toString(),
      poolPriceUsdcPerEth: usdcPerEth.toFixed(2),
      quotes: {
        [`${formatEther(ethIn)} ETH -> USDC`]: formatUnits(usdcOut, 6),
        [`${formatUnits(usdcIn, 6)} USDC -> ETH`]: formatEther(ethOut),
      },
      simulatedEthToUsdcSwap: 'succeeded with 0.5% minimum',
      slippageGuard: 'reverted with V4TooLittleReceived above the quote',
    },
    null,
    2,
  ),
);
