// Trades against a wallet's open Earn position so it collects swap fees during a demo.
//
//   pnpm demo:aqua-trade --maker 0x… [--rounds 3] [--usdc 2] [--lookback 40000]
//
// Each round swaps USDC for WETH and then the WETH back to USDC through the 1inch SwapVM router.
// Every swap pays the position's fee, so the position's value grows while its price returns.
// The trader needs Sepolia ETH for gas and some Circle USDC (faucet.circle.com). It sells back only
// the WETH it bought, so it needs no WETH of its own.
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';

import { Address as SdkAddress, HexString, Order, SwapVMContract, TakerTraits } from '@1inch/swap-vm-sdk';
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  decodeFunctionResult,
  erc20Abi,
  formatEther,
  formatUnits,
  getAddress,
  http,
  maxUint256,
  parseAbi,
  parseAbiItem,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

import { aquaAbi } from '../src/wallet/aqua-calls.ts';
import {
  SEPOLIA_AQUA_ADDRESS,
  SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS,
  SEPOLIA_USDC_ADDRESS,
  SEPOLIA_WETH_ADDRESS,
  sepoliaTransactionUrl,
} from '../src/wallet/sepolia.ts';

const { values } = parseArgs({
  // pnpm passes a `--` separator through; accept the command with or without it.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    maker: { type: 'string' },
    rounds: { type: 'string', default: '3' },
    usdc: { type: 'string', default: '2' },
    lookback: { type: 'string', default: '40000' },
  },
});
if (!values.maker) throw new Error('--maker <wallet address> is required');
if (!process.env.SEPOLIA_RPC_URL) throw new Error('SEPOLIA_RPC_URL is required');
if (!process.env.AQUA_DEMO_TRADER_KEY) throw new Error('AQUA_DEMO_TRADER_KEY is required');

const maker = getAddress(values.maker);
const rounds = Number(values.rounds);
const tradeUsdc = parseUnits(values.usdc, 6);
const SLIPPAGE_BPS = 50n;
const RPC_LOG_RANGE = 45_000n;

const shippedEvent = parseAbiItem('event Shipped(address maker, address app, bytes32 strategyHash, bytes strategy)');
const flowEvents = parseAbi([
  'event Pulled(address maker, address app, bytes32 strategyHash, address token, uint256 amount)',
  'event Pushed(address maker, address app, bytes32 strategyHash, address token, uint256 amount)',
]);
const swapVmAbi = parseAbi([
  'function quote((address maker, uint256 traits, bytes data) order, address tokenIn, address tokenOut, uint256 amount, bytes takerTraitsAndData) view returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)',
]);

const transport = http(process.env.SEPOLIA_RPC_URL);
const client = createPublicClient({ chain: sepolia, transport });
const trader = privateKeyToAccount(process.env.AQUA_DEMO_TRADER_KEY);
const wallet = createWalletClient({ account: trader, chain: sepolia, transport });
const router = new SdkAddress(SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS);
const symbol = { [SEPOLIA_USDC_ADDRESS.toLowerCase()]: 'USDC', [SEPOLIA_WETH_ADDRESS.toLowerCase()]: 'WETH' };

assert.equal(await client.getChainId(), sepolia.id, 'RPC is not Ethereum Sepolia');
console.log(`Trader ${trader.address}\nMaker  ${maker}`);

const { order, strategyHash } = await findLatestOrder();
const before = await positionBalances(strategyHash);
assert.equal(before.active, true, 'The maker has no active Earn position; open one in the app first');
console.log(`Position ${strategyHash}: ${formatAmounts(before)}`);

await ensureTraderFunds();

for (let round = 1; round <= rounds; round += 1) {
  const bought = await swap({ order, strategyHash, tokenIn: SEPOLIA_USDC_ADDRESS, tokenOut: SEPOLIA_WETH_ADDRESS, amount: tradeUsdc });
  const received = await swap({ order, strategyHash, tokenIn: SEPOLIA_WETH_ADDRESS, tokenOut: SEPOLIA_USDC_ADDRESS, amount: bought });
  console.log(`Round ${round}: ${formatUnits(tradeUsdc, 6)} USDC -> ${formatEther(bought)} WETH -> ${formatUnits(received, 6)} USDC`);
}

const after = await positionBalances(strategyHash);
console.log(`\nPosition before: ${formatAmounts(before)}`);
console.log(`Position after:  ${formatAmounts(after)}`);
console.log(
  `The position gained ${formatUnits(after.usdc - before.usdc, 6)} USDC and ` +
    `${formatEther(after.weth - before.weth)} WETH in fees. Refresh Earn in the app to see it.`,
);

/** The newest strategy this maker shipped to the SwapVM router, from Aqua's Shipped events. */
async function findLatestOrder() {
  const latest = await client.getBlockNumber();
  const earliest = latest > BigInt(values.lookback) ? latest - BigInt(values.lookback) : 0n;
  for (let to = latest; to > earliest; to -= RPC_LOG_RANGE) {
    const from = to - RPC_LOG_RANGE + 1n > earliest ? to - RPC_LOG_RANGE + 1n : earliest;
    const logs = await client.getLogs({ address: SEPOLIA_AQUA_ADDRESS, event: shippedEvent, fromBlock: from, toBlock: to });
    const match = logs
      .filter(
        ({ args }) =>
          args.maker.toLowerCase() === maker.toLowerCase() &&
          args.app.toLowerCase() === SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS.toLowerCase(),
      )
      .at(-1);
    if (match) return { order: match.args.strategy, strategyHash: match.args.strategyHash };
  }
  throw new Error(`No Earn position shipped by ${maker} in the last ${values.lookback} blocks`);
}

async function positionBalances(hash) {
  const [[usdc, usdcCount], [weth, wethCount]] = await Promise.all(
    [SEPOLIA_USDC_ADDRESS, SEPOLIA_WETH_ADDRESS].map((token) =>
      client.readContract({
        address: SEPOLIA_AQUA_ADDRESS,
        abi: aquaAbi,
        functionName: 'rawBalances',
        args: [maker, SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS, hash, token],
      }),
    ),
  );
  return { usdc, weth, active: usdcCount === 2 && wethCount === 2 };
}

/** Enough USDC for a round, and router approvals for both tokens. */
async function ensureTraderFunds() {
  const usdc = await balanceOf(SEPOLIA_USDC_ADDRESS);
  assert.ok(usdc >= tradeUsdc, `The trader needs at least ${formatUnits(tradeUsdc, 6)} USDC (faucet.circle.com)`);
  for (const token of [SEPOLIA_USDC_ADDRESS, SEPOLIA_WETH_ADDRESS]) {
    const allowance = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [trader.address, SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS],
    });
    if (allowance < maxUint256 / 2n) {
      // The router pulls the taker's input with transferFrom, then pushes it to the maker through Aqua.
      await send(
        `Approve the router for ${symbol[token.toLowerCase()]}`,
        await wallet.writeContract({
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS, maxUint256],
        }),
      );
    }
  }
}

async function swap({ order: encoded, strategyHash: hash, tokenIn, tokenOut, amount }) {
  const args = (threshold) => ({
    order: Order.decode(new HexString(encoded)),
    tokenIn: new SdkAddress(tokenIn),
    tokenOut: new SdkAddress(tokenOut),
    amount,
    takerTraits: TakerTraits.new({ threshold }),
  });
  const quoteTx = SwapVMContract.buildQuoteTx(router, args(0n));
  const { data } = await client.call({ account: trader.address, to: quoteTx.to, data: quoteTx.data });
  const [, quoted] = decodeFunctionResult({ abi: swapVmAbi, functionName: 'quote', data });
  const minimum = (quoted * (10_000n - SLIPPAGE_BPS)) / 10_000n;

  const outBefore = await balanceOf(tokenOut);
  const swapTx = SwapVMContract.buildSwapTx(router, args(minimum));
  const receipt = await send(
    `Swap ${symbol[tokenIn.toLowerCase()]} -> ${symbol[tokenOut.toLowerCase()]}`,
    await wallet.sendTransaction({ to: swapTx.to, data: swapTx.data, value: swapTx.value }),
  );
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== SEPOLIA_AQUA_ADDRESS.toLowerCase()) continue;
    const { eventName, args: event } = decodeEventLog({ abi: flowEvents, data: log.data, topics: log.topics });
    if (event.strategyHash !== hash) continue;
    const amountText = event.token.toLowerCase() === SEPOLIA_USDC_ADDRESS.toLowerCase() ? formatUnits(event.amount, 6) : formatEther(event.amount);
    console.log(`    Aqua ${eventName}: ${amountText} ${symbol[event.token.toLowerCase()]} ${eventName === 'Pulled' ? 'from' : 'to'} the maker`);
  }
  return (await balanceOf(tokenOut)) - outBefore;
}

async function send(label, hash) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success', `${label} failed: ${hash}`);
  console.log(`  ${label}: ${sepoliaTransactionUrl(hash)}`);
  return receipt;
}

function balanceOf(token) {
  return client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [trader.address] });
}

function formatAmounts({ usdc, weth }) {
  return `${formatUnits(usdc, 6)} USDC + ${formatEther(weth)} WETH`;
}
