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
} from '../src/wallet/sepolia.ts';
import { SWAP_POOL_ID, SWAP_POOL_KEY } from '../src/wallet/uniswap-sdk.ts';
import { buildSwapCalls, swapDeadline } from '../src/wallet/uniswap-swap-calls.ts';
import { formatPriceImpact, quoteSwap } from '../src/wallet/uniswap-quote.ts';

if (!process.env.SEPOLIA_RPC_URL) {
  throw new Error('SEPOLIA_RPC_URL is required');
}

// The pool pinned in docs/research/PRA-212-uniswap-v4-sepolia-route.md.
const EXPECTED_POOL_ID = '0xc743656d27fde4e2d5895e878557aaa56dd48c8656d25e9db35ba10b1fe3d824';
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
assert.equal(derivedPoolId, EXPECTED_POOL_ID, 'Pool key does not hash to the pinned pool ID');
assert.equal(SWAP_POOL_ID, EXPECTED_POOL_ID, 'SDK pool ID does not match the pinned pool ID');

// Captured from the hand-encoded builder used for the first live swaps; refactors must reproduce it byte for byte.
const GOLDEN_DEADLINE = 1_790_400_000n;
const GOLDEN_SWAP_CALLS = {
  'eth-to-usdc': {
    amountIn: 1_000_000_000_000_000n,
    minAmountOut: 31_000_000n,
    calls: [
      [
        SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
        1_000_000_000_000_000n,
        '0x6d882bf9c0eaf4eb7c290b0eaa71b7a86a5f5ed40a6f1c1f7ca2b78ae7a09490',
      ],
    ],
  },
  'usdc-to-eth': {
    amountIn: 1_000_000n,
    minAmountOut: 31_000_000_000_000n,
    calls: [
      [SEPOLIA_USDC_ADDRESS, 0n, '0x4c30657a233b56f2373066dd8805303dafd8450b0fc5afa5256eafd5ca5add94'],
      [SEPOLIA_PERMIT2_ADDRESS, 0n, '0x48752cba2c25ca83ce35b9020ff2ac7145422fe712a762824ea4f3db9e6173ba'],
      [
        SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
        0n,
        '0xa88181a1fb023fe7f3a65d6c58e9b325716b40822357f8a6fc5bc97cd6705e6d',
      ],
    ],
  },
};
for (const [direction, { amountIn, minAmountOut, calls }] of Object.entries(GOLDEN_SWAP_CALLS)) {
  const built = buildSwapCalls({ direction, amountIn, minAmountOut, deadline: GOLDEN_DEADLINE });
  assert.deepEqual(
    built.map((call) => [call.to, call.value, keccak256(call.data)]),
    calls,
    `${direction} calldata differs from the golden encoding`,
  );
}

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
for (const quote of [ethToUsdc, usdcToEth]) {
  assert.equal(
    quote.minAmountOut,
    (quote.amountOut * 9_950n) / 10_000n,
    `${quote.direction} minimum received is not 0.5% below the quote`,
  );
}
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
      goldenCalldata: 'matches the hand-encoded builder in both directions',
      activeLiquidity: liquidity.toString(),
      poolPriceUsdcPerEth: usdcPerEth.toFixed(2),
      ethToUsdc: {
        amountIn: `${formatEther(ethIn)} ETH`,
        quotedOut: `${formatUnits(ethToUsdc.amountOut, 6)} USDC`,
        minimumOut: `${formatUnits(ethToUsdc.minAmountOut, 6)} USDC`,
        priceImpact: formatPriceImpact(ethToUsdc.priceImpact),
        simulation: 'succeeded; minimum above quote reverted with V4TooLittleReceived',
      },
      usdcToEth: {
        amountIn: `${formatUnits(usdcIn, 6)} USDC`,
        quotedOut: `${formatEther(usdcToEth.amountOut)} ETH`,
        minimumOut: `${formatEther(usdcToEth.minAmountOut)} ETH`,
        priceImpact: formatPriceImpact(usdcToEth.priceImpact),
        simulatedReceived: `${formatEther(ethReceived)} ETH`,
        allowancesAfterSwap: 'USDC->Permit2 0, Permit2->router 0',
      },
    },
    null,
    2,
  ),
);
