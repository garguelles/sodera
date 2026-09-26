import assert from 'node:assert/strict';

import {
  createPublicClient,
  encodeAbiParameters,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  keccak256,
  pad,
  parseAbi,
  parseEther,
  parseUnits,
  toHex,
} from 'viem';
import { sepolia } from 'viem/chains';

import {
  SEPOLIA_PERMIT2_ADDRESS,
  SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
  SEPOLIA_UNISWAP_V4_POOL_MANAGER_ADDRESS,
  SEPOLIA_UNISWAP_V4_QUOTER_ADDRESS,
  SEPOLIA_UNISWAP_V4_STATE_VIEW_ADDRESS,
  SEPOLIA_USDC_ADDRESS,
  SWAP_POOL_ID,
  SWAP_POOL_KEY,
} from '../src/wallet/sepolia.ts';
import { buildSwapCalls, swapDeadline } from '../src/wallet/uniswap-swap-calls.ts';
import { quoteSwap } from '../src/wallet/uniswap-quote.ts';

if (!process.env.SEPOLIA_RPC_URL) {
  throw new Error('SEPOLIA_RPC_URL is required');
}

const V4_TOO_LITTLE_RECEIVED_SELECTOR = '0x8b063d73';
const SIMULATION_ACCOUNT = '0x000000000000000000000000000000000000dEaD';
// FiatTokenV2_2 keeps balances in `balanceAndBlacklistStates` at storage slot 9.
const USDC_BALANCE_MAPPING_SLOT = 9n;
// eth_simulateV1 reports native ETH transfers as ERC-20-style logs from this address.
const NATIVE_TRANSFER_LOG_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const poolKeyComponents = [
  { name: 'currency0', type: 'address' },
  { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' },
];
const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
]);
const permit2AllowanceAbi = parseAbi([
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
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

const ethIn = parseEther('0.001');
const usdcIn = parseUnits('1', 6);
const [ethToUsdc, usdcToEth] = await Promise.all([
  quoteSwap({ direction: 'eth-to-usdc', amountIn: ethIn }, client),
  quoteSwap({ direction: 'usdc-to-eth', amountIn: usdcIn }, client),
]);
const deadline = swapDeadline();

// ETH -> USDC: one call, sent with exactly the input ETH.
function simulateEthToUsdc(minAmountOut) {
  const calls = buildSwapCalls({ direction: 'eth-to-usdc', amountIn: ethIn, minAmountOut, deadline });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS);
  assert.equal(calls[0].value, ethIn);
  return client.call({
    account: SIMULATION_ACCOUNT,
    to: calls[0].to,
    data: calls[0].data,
    value: calls[0].value,
    stateOverride: [{ address: SIMULATION_ACCOUNT, balance: parseEther('1') }],
  });
}
await simulateEthToUsdc(ethToUsdc.minAmountOut);
const slippageRevert = await simulateEthToUsdc(ethToUsdc.amountOut + 1n).then(
  () => null,
  (error) => error,
);
assert.ok(
  String(slippageRevert?.walk?.()?.data ?? '').startsWith(V4_TOO_LITTLE_RECEIVED_SELECTOR),
  'Swap above the quoted output did not revert with V4TooLittleReceived',
);

// USDC -> ETH: approve USDC to Permit2, Permit2 to the router, then swap, all in one batch.
const usdcToEthCalls = buildSwapCalls({
  direction: 'usdc-to-eth',
  amountIn: usdcIn,
  minAmountOut: usdcToEth.minAmountOut,
  deadline,
});
assert.deepEqual(
  usdcToEthCalls.map((call) => [call.to, call.value]),
  [
    [SEPOLIA_USDC_ADDRESS, 0n],
    [SEPOLIA_PERMIT2_ADDRESS, 0n],
    [SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS, 0n],
  ],
);
const usdcBalanceSlot = keccak256(
  encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [SIMULATION_ACCOUNT, USDC_BALANCE_MAPPING_SLOT],
  ),
);
const [{ calls: simulatedCalls }] = await client.simulateBlocks({
  blocks: [
    {
      calls: [
        ...usdcToEthCalls.map((call) => ({ account: SIMULATION_ACCOUNT, ...call })),
        {
          account: SIMULATION_ACCOUNT,
          to: SEPOLIA_USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [SIMULATION_ACCOUNT, SEPOLIA_PERMIT2_ADDRESS],
        },
        {
          account: SIMULATION_ACCOUNT,
          to: SEPOLIA_PERMIT2_ADDRESS,
          abi: permit2AllowanceAbi,
          functionName: 'allowance',
          args: [SIMULATION_ACCOUNT, SEPOLIA_USDC_ADDRESS, SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS],
        },
      ],
      stateOverrides: [
        {
          address: SEPOLIA_USDC_ADDRESS,
          stateDiff: [{ slot: usdcBalanceSlot, value: pad(toHex(usdcIn)) }],
        },
      ],
    },
  ],
  traceTransfers: true,
});
simulatedCalls.forEach((call, index) => {
  assert.equal(call.status, 'success', `USDC to ETH batch call ${index} failed`);
});
const ethReceived = simulatedCalls[2].logs
  .filter(
    (log) =>
      log.address.toLowerCase() === NATIVE_TRANSFER_LOG_ADDRESS &&
      BigInt(log.topics[2]) === BigInt(SIMULATION_ACCOUNT),
  )
  .reduce((total, log) => total + BigInt(log.data), 0n);
assert.ok(
  ethReceived >= usdcToEth.minAmountOut,
  `USDC to ETH swap paid ${ethReceived} wei, below the ${usdcToEth.minAmountOut} wei minimum`,
);
assert.equal(simulatedCalls[3].result, 0n, 'USDC allowance to Permit2 was left behind');
assert.equal(simulatedCalls[4].result[0], 0n, 'Permit2 allowance to the router was left behind');

console.log(
  JSON.stringify(
    {
      chainId: sepolia.id,
      blockNumber: blockNumber.toString(),
      poolId: SWAP_POOL_ID,
      activeLiquidity: liquidity.toString(),
      poolPriceUsdcPerEth: usdcPerEth.toFixed(2),
      ethToUsdc: {
        amountIn: `${formatEther(ethIn)} ETH`,
        quotedOut: `${formatUnits(ethToUsdc.amountOut, 6)} USDC`,
        minimumOut: `${formatUnits(ethToUsdc.minAmountOut, 6)} USDC`,
        simulation: 'succeeded; minimum above quote reverted with V4TooLittleReceived',
      },
      usdcToEth: {
        amountIn: `${formatUnits(usdcIn, 6)} USDC`,
        quotedOut: `${formatEther(usdcToEth.amountOut)} ETH`,
        minimumOut: `${formatEther(usdcToEth.minAmountOut)} ETH`,
        simulatedReceived: `${formatEther(ethReceived)} ETH`,
        allowancesAfterSwap: 'USDC->Permit2 0, Permit2->router 0',
      },
    },
    null,
    2,
  ),
);
