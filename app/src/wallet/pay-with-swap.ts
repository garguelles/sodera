import { URVersion, V4BaseActionsParser } from '@uniswap/v4-sdk';
import {
  decodeAbiParameters,
  decodeFunctionData,
  isAddressEqual,
  parseAbi,
  parseAbiParameters,
  size,
  slice,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';

import type { PayQuote, PayQuoteRequest } from '../agent/agent-client';
import type { KernelExecutionCall } from './kernel-passkey-execution';
import { SEPOLIA_UNISWAP_TRADING_ROUTER_ADDRESS, SEPOLIA_USDC_ADDRESS, SEPOLIA_WETH_ADDRESS } from './sepolia';
import { buildUsdcPermit2Approvals } from './uniswap-swap-calls';
import { encodeUsdcTransfer } from './usdc-transfer';

// Pay with: the Trading API routes an exact-output swap into the Kernel account, and the wallet
// appends its own transfer to the payee. The router call comes from outside the app, so every
// command in it is decoded and checked against what the user asked for before anything is signed.
// Command shapes: docs/research/trading-api-pay-with-sepolia.md.

/** `/swap_5792` encodes a deadline 30 minutes after quoting; allow a little clock skew on top. */
const MAX_DEADLINE_SECONDS = 30 * 60 + 120;

const MSG_SENDER: Address = '0x0000000000000000000000000000000000000001';
const ADDRESS_THIS: Address = '0x0000000000000000000000000000000000000002';

const ALLOW_REVERT_FLAG = 0x80;
const COMMAND_TYPE_MASK = 0x3f;
const V3_SWAP_EXACT_OUT = 0x01;
const SWEEP = 0x04;
const V2_SWAP_EXACT_OUT = 0x09;
const WRAP_ETH = 0x0b;
const UNWRAP_WETH = 0x0c;
const V4_SWAP = 0x10;

const universalRouterAbi = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
const exactOutV3Params = parseAbiParameters('address, uint256, uint256, bytes, bool');
const exactOutV2Params = parseAbiParameters('address, uint256, uint256, address[], bool');
const wrapParams = parseAbiParameters('address, uint256');
const sweepParams = parseAbiParameters('address, address, uint256');

type Asset = PayQuoteRequest['payAsset'];
/** v4 pools hold native ETH; v2 and v3 pools hold WETH. */
const V4_CURRENCY: Record<Asset, Address> = { ETH: zeroAddress, USDC: SEPOLIA_USDC_ADDRESS };
const ERC20_TOKEN: Record<Asset, Address> = { ETH: SEPOLIA_WETH_ADDRESS, USDC: SEPOLIA_USDC_ADDRESS };

/** The quote does not do what the user asked; nothing from it may be signed. */
export class PayWithSwapRejectedError extends Error {
  constructor(message: string) {
    super(`Uniswap returned a swap Sodera cannot verify: ${message}`);
    this.name = 'PayWithSwapRejectedError';
  }
}

function reject(message: string): never {
  throw new PayWithSwapRejectedError(message);
}

type V4Param = { name: string; value: any };

/** The parser returns ethers BigNumbers, which serialize to `{ type, hex }`. */
function toBigInt(value: unknown) {
  if (typeof value === 'object' && value !== null) {
    const hex = (value as { _hex?: unknown; hex?: unknown })._hex ?? (value as { hex?: unknown }).hex;
    if (typeof hex === 'string') return BigInt(hex);
  }
  if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string') return BigInt(value);
  return reject('an amount could not be read');
}

function param(params: V4Param[], name: string) {
  const found = params.find((entry) => entry.name === name);
  return found ? found.value : reject(`a swap action is missing ${name}`);
}

export type VerifiedPayWithSwap = {
  swap: KernelExecutionCall;
  maxAmountIn: bigint;
  amountOut: bigint;
  /** Router deadline in unix seconds; the Permit2 approval expires with it. */
  deadline: number;
};

/**
 * Checks the router call from `/pay/quote` against the request: the target, the deadline, the ETH
 * value, and every command and v4 action. Only exact-output swaps into the account, settled in the
 * pay asset within `maxAmountIn`, with no take or sweep to anyone else, get through.
 */
export function verifyPayWithSwap({
  request,
  quote,
  nowMs = Date.now(),
}: {
  request: PayQuoteRequest;
  quote: PayQuote;
  nowMs?: number;
}): VerifiedPayWithSwap {
  const { payAsset, receiveAsset } = request;
  if (payAsset === receiveAsset) reject('the assets are the same');
  if (quote.payAsset !== payAsset || quote.receiveAsset !== receiveAsset || quote.amountOut !== request.amountOut) {
    reject('the quote is for a different payment');
  }
  const account = request.account as Address;
  const amountOut = BigInt(request.amountOut);
  const amountIn = BigInt(quote.amountIn);
  const maxAmountIn = BigInt(quote.maxAmountIn);
  if (amountOut <= 0n || maxAmountIn <= 0n || amountIn > maxAmountIn) reject('the quoted amounts are inconsistent');

  if (!isAddressEqual(quote.swap.to as Address, SEPOLIA_UNISWAP_TRADING_ROUTER_ADDRESS)) {
    reject('it does not call the Uniswap router');
  }
  let execute: { commands: Hex; inputs: readonly Hex[]; deadline: bigint };
  try {
    const { functionName, args } = decodeFunctionData({ abi: universalRouterAbi, data: quote.swap.data as Hex });
    if (functionName !== 'execute') throw new Error();
    execute = { commands: args[0], inputs: args[1], deadline: args[2] };
  } catch {
    return reject('it is not a router execute call');
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  const deadline = Number(execute.deadline);
  if (deadline !== quote.deadline) reject('the deadline does not match the quote');
  if (deadline <= nowSeconds) reject('the quote has expired');
  if (deadline > nowSeconds + MAX_DEADLINE_SECONDS) reject('the deadline is too far out');

  const value = BigInt(quote.swap.value);
  if (payAsset === 'ETH' ? value > maxAmountIn : value !== 0n) reject('it sends more ETH than the quote allows');

  const toAccount = (recipient: Address) => isAddressEqual(recipient, account) || isAddressEqual(recipient, MSG_SENDER);
  let exactOut = 0n;
  let maxIn = 0n;

  const commands = execute.commands.slice(2).match(/../g) ?? [];
  if (commands.length === 0 || commands.length !== execute.inputs.length) reject('the commands and inputs do not match');

  commands.forEach((hex, index) => {
    const command = parseInt(hex, 16);
    const input = execute.inputs[index];
    if (command & ALLOW_REVERT_FLAG) reject('a command may fail silently');
    try {
      switch (command & COMMAND_TYPE_MASK) {
        case V4_SWAP: {
          const counted = verifyV4Swap(input);
          exactOut += counted.exactOut;
          maxIn += counted.maxIn;
          return;
        }
        case V3_SWAP_EXACT_OUT: {
          const [recipient, out, inMax, path] = decodeAbiParameters(exactOutV3Params, input);
          // Exact-output v3 paths run from the output token back to the input token.
          if (size(path) < 43 || (size(path) - 20) % 23 !== 0) reject('a v3 path is malformed');
          if (!isAddressEqual(slice(path, 0, 20), ERC20_TOKEN[receiveAsset])) reject('a v3 swap buys the wrong token');
          if (!isAddressEqual(slice(path, size(path) - 20), ERC20_TOKEN[payAsset])) reject('a v3 swap sells the wrong token');
          if (!toAccount(recipient) && !isAddressEqual(recipient, ADDRESS_THIS)) reject('a v3 swap pays someone else');
          exactOut += out;
          maxIn += inMax;
          return;
        }
        case V2_SWAP_EXACT_OUT: {
          const [recipient, out, inMax, path] = decodeAbiParameters(exactOutV2Params, input);
          if (path.length < 2) reject('a v2 path is malformed');
          if (!isAddressEqual(path[0], ERC20_TOKEN[payAsset])) reject('a v2 swap sells the wrong token');
          if (!isAddressEqual(path[path.length - 1], ERC20_TOKEN[receiveAsset])) reject('a v2 swap buys the wrong token');
          if (!toAccount(recipient) && !isAddressEqual(recipient, ADDRESS_THIS)) reject('a v2 swap pays someone else');
          exactOut += out;
          maxIn += inMax;
          return;
        }
        case WRAP_ETH: {
          const [recipient, amount] = decodeAbiParameters(wrapParams, input);
          if (payAsset !== 'ETH') reject('it wraps ETH when paying with USDC');
          if (!isAddressEqual(recipient, ADDRESS_THIS)) reject('it wraps ETH for someone else');
          if (amount > maxAmountIn) reject('it wraps more ETH than the quote allows');
          return;
        }
        case UNWRAP_WETH: {
          const [recipient] = decodeAbiParameters(wrapParams, input);
          if (!toAccount(recipient)) reject('it unwraps ETH to someone else');
          return;
        }
        case SWEEP: {
          const [token, recipient] = decodeAbiParameters(sweepParams, input);
          const tokens: Address[] = [zeroAddress, SEPOLIA_WETH_ADDRESS, SEPOLIA_USDC_ADDRESS];
          const known = tokens.some((known) => isAddressEqual(token, known));
          if (!known) reject('it sweeps an unknown token');
          if (!toAccount(recipient)) reject('it sweeps funds to someone else');
          return;
        }
        default:
          reject(`it uses router command 0x${hex}`);
      }
    } catch (caught) {
      if (caught instanceof PayWithSwapRejectedError) throw caught;
      reject(`command ${index} could not be decoded`);
    }
  });

  if (exactOut !== amountOut) reject('the swaps do not buy exactly the requested amount');
  if (maxIn > maxAmountIn) reject('the swaps may spend more than the quoted maximum');

  return {
    swap: { to: SEPOLIA_UNISWAP_TRADING_ROUTER_ADDRESS, value, data: quote.swap.data as Hex },
    maxAmountIn,
    amountOut,
    deadline,
  };

  function verifyV4Swap(input: Hex) {
    // Router 2.1.x added fields to the exact-output structs; the 2.0 layout misreads the amounts.
    const { actions } = V4BaseActionsParser.parseCalldata(input, URVersion.V2_1_2);
    const payCurrency = V4_CURRENCY[payAsset];
    const receiveCurrency = V4_CURRENCY[receiveAsset];
    let swapOut = 0n;
    let swapMaxIn = 0n;
    for (const action of actions) {
      const params = action.params as V4Param[];
      switch (action.actionName) {
        case 'SWAP_EXACT_OUT': {
          const swap = param(params, 'swap');
          const path = swap.path as { intermediateCurrency: Address }[];
          // Exact-output v4 paths list the currencies before each hop, starting with the input.
          if (!isAddressEqual(swap.currencyOut, receiveCurrency)) reject('a v4 swap buys the wrong token');
          if (!path.length || !isAddressEqual(path[0].intermediateCurrency, payCurrency)) {
            reject('a v4 swap sells the wrong token');
          }
          swapOut += toBigInt(swap.amountOut);
          swapMaxIn += toBigInt(swap.amountInMaximum);
          break;
        }
        case 'SWAP_EXACT_OUT_SINGLE': {
          const swap = param(params, 'swap');
          const { currency0, currency1 } = swap.poolKey as { currency0: Address; currency1: Address };
          const [currencyIn, currencyOut] = swap.zeroForOne ? [currency0, currency1] : [currency1, currency0];
          if (!isAddressEqual(currencyOut, receiveCurrency)) reject('a v4 swap buys the wrong token');
          if (!isAddressEqual(currencyIn, payCurrency)) reject('a v4 swap sells the wrong token');
          swapOut += toBigInt(swap.amountOut);
          swapMaxIn += toBigInt(swap.amountInMaximum);
          break;
        }
        case 'SETTLE': {
          // Zero settles the open debt, which the swap already bounds by amountInMaximum.
          if (!isAddressEqual(param(params, 'currency'), payCurrency)) reject('it settles in the wrong token');
          if (toBigInt(param(params, 'amount')) > maxAmountIn) reject('it settles more than the quoted maximum');
          break;
        }
        case 'SETTLE_ALL': {
          if (!isAddressEqual(param(params, 'currency'), payCurrency)) reject('it settles in the wrong token');
          if (toBigInt(param(params, 'maxAmount')) > maxAmountIn) reject('it settles more than the quoted maximum');
          break;
        }
        case 'TAKE': {
          if (!isAddressEqual(param(params, 'currency'), receiveCurrency)) reject('it takes the wrong token');
          if (!toAccount(param(params, 'recipient'))) reject('it sends the swap output to someone else');
          break;
        }
        case 'TAKE_ALL': {
          if (!isAddressEqual(param(params, 'currency'), receiveCurrency)) reject('it takes the wrong token');
          break;
        }
        default:
          reject(`it uses v4 action ${action.actionName}`);
      }
    }
    if (swapOut === 0n) reject('a v4 command has no swap');
    return { exactOut: swapOut, maxIn: swapMaxIn };
  }
}

/**
 * The whole Pay with batch: bounded approvals when paying with USDC, the verified router call, and
 * the wallet's own transfer of exactly `amountOut` to the payee. The payee never reaches Uniswap.
 */
export function buildPayWithCalls({
  request,
  quote,
  recipient,
  nowMs,
}: {
  request: PayQuoteRequest;
  quote: PayQuote;
  recipient: Address;
  nowMs?: number;
}): KernelExecutionCall[] {
  const { swap, maxAmountIn, amountOut, deadline } = verifyPayWithSwap({ request, quote, nowMs });
  const approvals =
    request.payAsset === 'USDC'
      ? buildUsdcPermit2Approvals({ spender: SEPOLIA_UNISWAP_TRADING_ROUTER_ADDRESS, amount: maxAmountIn, expiration: deadline })
      : [];
  const transfer: KernelExecutionCall =
    request.receiveAsset === 'ETH'
      ? { to: recipient, value: amountOut, data: '0x' }
      : encodeUsdcTransfer({ to: recipient, amountMicro: amountOut });
  return [...approvals, swap, transfer];
}
