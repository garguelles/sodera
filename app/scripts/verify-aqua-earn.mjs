import assert from 'node:assert/strict';

import { Address as SdkAddress, HexString, Order, SwapVMContract, TakerTraits } from '@1inch/swap-vm-sdk';
import {
  createPublicClient,
  decodeAbiParameters,
  decodeFunctionResult,
  encodeAbiParameters,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  keccak256,
  maxUint256,
  pad,
  parseAbi,
  parseEther,
  parseUnits,
  sliceHex,
  toHex,
} from 'viem';
import { sepolia } from 'viem/chains';

import { aquaAbi, buildClosePositionCalls, buildOpenPositionCalls } from '../src/wallet/aqua-calls.ts';
import { AQUA_FEE_BPS, buildAquaOrder } from '../src/wallet/aqua-strategy.ts';
import {
  SEPOLIA_AQUA_ADDRESS,
  SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS,
  SEPOLIA_USDC_ADDRESS,
  SEPOLIA_WETH_ADDRESS,
} from '../src/wallet/sepolia.ts';

if (!process.env.SEPOLIA_RPC_URL) {
  throw new Error('SEPOLIA_RPC_URL is required');
}

// The router pinned in docs/research/aqua-swapvm-sepolia.md.
const EXPECTED_ROUTER_NAME = '1inch SwapVM v1.0';
// Fresh addresses with no Sepolia history, so balance checks are exact.
const MAKER = '0x00000000000000000000000000000000000A0a01';
const TAKER = '0x00000000000000000000000000000000000a0a02';
const SALT = 1_790_000_000n;
// Opcodes of the Sepolia router's AquaOpcodes table (and the SDK's aquaInstructions).
const OPCODE = { xycSwapXD: 0x11, salt: 0x14, flatFeeAmountInXD: 0x15 };
const FEE_DENOMINATOR = 1_000_000_000n;
// Aqua's tokensCount: 0 = never shipped, 0xff = docked, otherwise the active strategy's token count.
const DOCKED = 0xff;
// FiatTokenV2_2 keeps balances in `balanceAndBlacklistStates` at storage slot 9.
const USDC_BALANCE_MAPPING_SLOT = 9n;
const POSITION_USDC = parseUnits('100', 6);
const TRADE_USDC = parseUnits('10', 6);
const ETH_USD_FEED = '0x694AA1769357215DE4FAC081bf1f309aDC325306';

const orderAbi = {
  type: 'tuple',
  components: [
    { name: 'maker', type: 'address' },
    { name: 'traits', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
};
const routerAbi = parseAbi([
  'function hash((address maker, uint256 traits, bytes data) order) view returns (bytes32)',
  'function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)',
]);
const feedAbi = parseAbi([
  'function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80)',
]);
const swapVmAbi = parseAbi([
  'function quote((address maker, uint256 traits, bytes data) order, address tokenIn, address tokenOut, uint256 amount, bytes takerTraitsAndData) view returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)',
]);

const client = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });

console.log('1. Chain');
assert.equal(await client.getChainId(), sepolia.id, 'RPC is not Ethereum Sepolia');
console.log(`   Ethereum Sepolia at block ${await client.getBlockNumber()}`);

console.log('2. Contracts');
for (const [name, address] of Object.entries({
  Aqua: SEPOLIA_AQUA_ADDRESS,
  AquaSwapVMRouter: SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS,
  USDC: SEPOLIA_USDC_ADDRESS,
  WETH: SEPOLIA_WETH_ADDRESS,
})) {
  const code = await client.getCode({ address });
  assert.ok(code && code !== '0x', `${name} has no code at ${address}`);
  console.log(`   ${name} ${address}: ${(code.length - 2) / 2} bytes`);
}
const [, routerName] = await client.readContract({
  address: SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS,
  abi: routerAbi,
  functionName: 'eip712Domain',
});
assert.equal(routerName, EXPECTED_ROUTER_NAME);
console.log(`   router reports "${routerName}"`);

console.log('3. Order');
const { order, strategyHash } = buildAquaOrder({ maker: MAKER, salt: SALT });
const [decoded] = decodeAbiParameters([orderAbi], order);
assert.equal(decoded.maker, MAKER);
const routerHash = await client.readContract({
  address: SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS,
  abi: routerAbi,
  functionName: 'hash',
  args: [decoded],
});
assert.equal(routerHash, strategyHash, 'router hash differs from keccak256(order)');
console.log(`   router.hash(order) = keccak256(order) = ${strategyHash}`);

// With no hooks, the order data is the program: [opcode][args length][args] per instruction.
const program = decoded.data;
const fee = BigInt(AQUA_FEE_BPS) * 100_000n; // SwapVM fees use 1e9 = 100%.
const expectedProgram =
  `0x${hex8(OPCODE.flatFeeAmountInXD)}04${fee.toString(16).padStart(8, '0')}` +
  `${hex8(OPCODE.xycSwapXD)}00` +
  `${hex8(OPCODE.salt)}08${SALT.toString(16).padStart(16, '0')}`;
assert.equal(program.toLowerCase(), expectedProgram, 'program is not flat fee, x·y=k, salt');
assert.equal(sliceHex(program, 2, 6), `0x${fee.toString(16).padStart(8, '0')}`);
console.log(`   program ${program}: ${AQUA_FEE_BPS} bps flat fee (${fee} / 1e9), x·y=k, salt ${SALT}`);

const [balance, tokensCount] = await client.readContract({
  address: SEPOLIA_AQUA_ADDRESS,
  abi: aquaAbi,
  functionName: 'rawBalances',
  args: [MAKER, SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS, strategyHash, SEPOLIA_USDC_ADDRESS],
});
assert.equal(balance, 0n);
assert.equal(tokensCount, 0);
console.log('   an unshipped order reads as no position (balance 0, tokensCount 0)');

console.log('4. Open, trade, close (eth_simulateV1)');
const [feedDecimals, [, ethUsd]] = await Promise.all([
  client.readContract({ address: ETH_USD_FEED, abi: feedAbi, functionName: 'decimals' }),
  client.readContract({ address: ETH_USD_FEED, abi: feedAbi, functionName: 'latestRoundData' }),
]);
assert.ok(ethUsd > 0n, 'Chainlink ETH/USD is not positive');
// Size the WETH side at the Chainlink price, as the Earn screen does.
const positionWeth = (POSITION_USDC * 10n ** 12n * 10n ** BigInt(feedDecimals)) / ethUsd;
const openCalls = buildOpenPositionCalls({
  order,
  usdcAmount: POSITION_USDC,
  wethAmount: positionWeth,
  wrapWei: positionWeth,
});
assert.equal(openCalls.length, 4, 'open is wrap, approve, approve, ship');
console.log(
  `   position: ${formatUnits(POSITION_USDC, 6)} USDC + ${formatEther(positionWeth)} WETH ` +
    `at ${formatUnits(ethUsd, feedDecimals)} USD/ETH`,
);

const sdkOrder = Order.decode(new HexString(order));
const swapArgs = (threshold) => ({
  order: sdkOrder,
  tokenIn: new SdkAddress(SEPOLIA_USDC_ADDRESS),
  tokenOut: new SdkAddress(SEPOLIA_WETH_ADDRESS),
  amount: TRADE_USDC,
  takerTraits: TakerTraits.new({ threshold }),
});
const router = new SdkAddress(SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS);
const makerOpens = openCalls.map((call) => ({ account: MAKER, ...call }));
const takerApproves = {
  account: TAKER,
  to: SEPOLIA_USDC_ADDRESS,
  abi: erc20Abi,
  functionName: 'approve',
  args: [SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS, maxUint256],
};
const stateOverrides = [
  { address: MAKER, balance: parseEther('10') },
  { address: TAKER, balance: parseEther('10') },
  {
    address: SEPOLIA_USDC_ADDRESS,
    stateDiff: [
      { slot: usdcBalanceSlot(MAKER), value: pad(toHex(POSITION_USDC)) },
      { slot: usdcBalanceSlot(TAKER), value: pad(toHex(TRADE_USDC)) },
    ],
  },
];
const simulate = (calls) =>
  client
    .simulateBlocks({ blocks: [{ calls, stateOverrides }], traceTransfers: true })
    .then(([block]) => block.calls);

// The quote runs on the same state the swap will see.
const quoteTx = SwapVMContract.buildQuoteTx(router, swapArgs(0n));
const quoted = await simulate([...makerOpens, { account: TAKER, to: quoteTx.to, data: quoteTx.data }]);
quoted.forEach((call, index) => assert.equal(call.status, 'success', `open/quote call ${index} failed`));
const [, quotedOut] = decodeFunctionResult({
  abi: swapVmAbi,
  functionName: 'quote',
  data: quoted.at(-1).data,
});
const inAfterFee = (TRADE_USDC * (FEE_DENOMINATOR - BigInt(AQUA_FEE_BPS) * 100_000n)) / FEE_DENOMINATOR;
const expectedOut = (positionWeth * inAfterFee) / (POSITION_USDC + inAfterFee);
const noFeeOut = (positionWeth * TRADE_USDC) / (POSITION_USDC + TRADE_USDC);
assert.ok(quotedOut < noFeeOut, 'the quote does not charge the fee');
assert.ok(quotedOut <= expectedOut && expectedOut - quotedOut <= 2n, `quote ${quotedOut} is not x·y=k after fee`);
console.log(
  `   quote ${formatUnits(TRADE_USDC, 6)} USDC -> ${formatEther(quotedOut)} WETH ` +
    `(x·y=k after ${AQUA_FEE_BPS} bps; ${formatEther(noFeeOut - quotedOut)} WETH kept as fee)`,
);

const swapTx = SwapVMContract.buildSwapTx(router, swapArgs(quotedOut));
const read = (token, owner, functionName = 'balanceOf') => ({
  account: TAKER,
  to: token,
  abi: erc20Abi,
  functionName,
  args: functionName === 'allowance' ? [owner, SEPOLIA_AQUA_ADDRESS] : [owner],
});
const rawBalance = (token) => ({
  account: TAKER,
  to: SEPOLIA_AQUA_ADDRESS,
  abi: aquaAbi,
  functionName: 'rawBalances',
  args: [MAKER, SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS, strategyHash, token],
});
const remainingWeth = positionWeth - quotedOut;
const closeCalls = buildClosePositionCalls({ strategyHash, unwrapWei: remainingWeth });
const flow = [
  ...makerOpens,
  takerApproves,
  { account: TAKER, to: swapTx.to, data: swapTx.data },
  read(SEPOLIA_USDC_ADDRESS, MAKER),
  read(SEPOLIA_WETH_ADDRESS, MAKER),
  read(SEPOLIA_WETH_ADDRESS, TAKER),
  rawBalance(SEPOLIA_USDC_ADDRESS),
  rawBalance(SEPOLIA_WETH_ADDRESS),
  ...closeCalls.map((call) => ({ account: MAKER, ...call })),
  rawBalance(SEPOLIA_USDC_ADDRESS),
  read(SEPOLIA_USDC_ADDRESS, MAKER, 'allowance'),
  read(SEPOLIA_WETH_ADDRESS, MAKER, 'allowance'),
  read(SEPOLIA_WETH_ADDRESS, MAKER),
];
const results = await simulate(flow);
results.forEach((call, index) => assert.equal(call.status, 'success', `flow call ${index} failed`));
const at = (offset) => results[makerOpens.length + offset].result;
assert.equal(at(2), POSITION_USDC + TRADE_USDC, 'maker did not receive the taker USDC');
assert.equal(at(3), remainingWeth, 'maker WETH did not pay the taker');
assert.equal(at(4), quotedOut, 'taker did not receive the quoted WETH');
assert.deepEqual(at(5), [POSITION_USDC + TRADE_USDC, 2], 'Aqua USDC balance did not grow');
assert.deepEqual(at(6), [remainingWeth, 2], 'Aqua WETH balance did not shrink');
const afterClose = makerOpens.length + 7 + closeCalls.length;
assert.deepEqual(results[afterClose].result, [0n, DOCKED], 'the position is not docked');
assert.equal(results[afterClose + 1].result, 0n, 'USDC approval to Aqua was left behind');
assert.equal(results[afterClose + 2].result, 0n, 'WETH approval to Aqua was left behind');
assert.equal(results[afterClose + 3].result, 0n, 'close did not unwrap the WETH');
console.log('   open: wrap, approve, approve, ship all succeed; the tokens stay in the maker wallet');
console.log('   trade: the router pulls the taker USDC to the maker and the maker WETH to the taker');
console.log('   Aqua balances follow the trade (USDC +10, WETH -quoted); close docks, clears approvals, unwraps');

const tooHighTx = SwapVMContract.buildSwapTx(router, swapArgs(quotedOut + 1n));
const tooHigh = await simulate([...makerOpens, takerApproves, { account: TAKER, to: tooHighTx.to, data: tooHighTx.data }]);
assert.equal(tooHigh.at(-1).status, 'failure', 'a threshold above the quote did not revert');
console.log('   a minimum output one wei above the quote reverts');

console.log('\nAqua and SwapVM on Sepolia verified.');

function usdcBalanceSlot(owner) {
  return keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [owner, USDC_BALANCE_MAPPING_SLOT]),
  );
}

function hex8(value) {
  return value.toString(16).padStart(2, '0');
}
