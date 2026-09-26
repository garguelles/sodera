// Feasibility spike for "pay with any token": can the Uniswap Trading API give a smart account
// batchable calls that pay a recipient an exact amount on Sepolia? Run: pnpm verify:pay-with
import assert from 'node:assert/strict';

import {
  createPublicClient,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  keccak256,
  pad,
  parseAbi,
  parseEther,
  parseUnits,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';

const API_URL = 'https://trade-api.gateway.uniswap.org/v1';
const ROUTER_VERSION = '2.1.2';
const CHAIN_ID = sepolia.id;
const SLIPPAGE_PERCENT = 0.5;
const DEADLINE_SECONDS = 600;

const USDC: Address = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const ETH: Address = zeroAddress;
const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const TRADING_ROUTER: Address = '0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3';
const PERMIT2_PROXY: Address = '0x0000000085E102724e78eCd2F45DC9cA239Affad';
// FiatTokenV2_2 keeps balances in `balanceAndBlacklistStates` at storage slot 9.
const USDC_BALANCE_SLOT = 9n;
// eth_simulateV1 reports native ETH transfers as ERC-20-style logs from this address.
const NATIVE_LOG_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const TRANSFER_TOPIC = keccak256(toHex('Transfer(address,address,uint256)'));
const PAYEE: Address = '0x000000000000000000000000000000000000bEEF';
const ACCOUNT = (process.env.PAY_WITH_ACCOUNT ?? '0xFbf2213c7F5DE314729293fF1B541F8591637658') as Address;

const KNOWN_TARGETS: Record<string, string> = {
  [USDC.toLowerCase()]: 'USDC',
  [PERMIT2.toLowerCase()]: 'Permit2',
  [TRADING_ROUTER.toLowerCase()]: 'Universal Router 2.1.2',
  [PERMIT2_PROXY.toLowerCase()]: 'Permit2 proxy',
  [PAYEE.toLowerCase()]: 'payee',
};

const permit2Abi = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
]);

type Call = { to: Address; value: bigint; data: Hex };
type ApiTransaction = { to: Address; data: Hex; value?: string };
type PayCase = { name: string; tokenIn: Address; tokenOut: Address; amountOut: bigint };
type Option = 'swap_5792' | 'swap_5792-exact' | 'swap_5792-bounded' | 'permit-as-transaction' | 'permit2-disabled';

const apiKey = process.env.UNISWAP_API_KEY;
const rpcUrl = process.env.SEPOLIA_RPC_URL;
if (!apiKey) throw new Error('UNISWAP_API_KEY is required in agent/.env');
if (!rpcUrl) throw new Error('SEPOLIA_RPC_URL is required in agent/.env');

const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
assert.equal(await client.getChainId(), CHAIN_ID);

async function api(path: string, body: unknown, { permit2Disabled = false } = {}, attempt = 1): Promise<{
  payload: Record<string, any>;
  latencyMs: number;
}> {
  const started = Date.now();
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey!,
      'content-type': 'application/json',
      accept: 'application/json',
      'x-universal-router-version': ROUTER_VERSION,
      ...(permit2Disabled ? { 'x-permit2-disabled': 'true' } : {}),
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - started;
  const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok && attempt === 1 && (response.status === 429 || payload.errorCode === 'UpstreamTimeoutError')) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return api(path, body, { permit2Disabled }, attempt + 1);
  }
  if (!response.ok) {
    const detail = [payload.errorCode, payload.detail].filter(Boolean).join(': ');
    throw new Error(`${path} ${response.status} ${detail || 'error'}`.trim());
  }
  return { payload, latencyMs };
}

function toCall(transaction: ApiTransaction | null | undefined): Call | null {
  if (!transaction) return null;
  return { to: transaction.to, value: BigInt(transaction.value ?? '0'), data: transaction.data };
}

function quoteBody(payCase: PayCase, extra: Record<string, unknown> = {}) {
  return {
    type: 'EXACT_OUTPUT',
    amount: payCase.amountOut.toString(),
    tokenIn: payCase.tokenIn,
    tokenOut: payCase.tokenOut,
    tokenInChainId: CHAIN_ID,
    tokenOutChainId: CHAIN_ID,
    swapper: ACCOUNT,
    slippageTolerance: SLIPPAGE_PERCENT,
    routingPreference: 'BEST_PRICE',
    protocols: ['V2', 'V3', 'V4'],
    ...extra,
  };
}

async function buildOptionCalls(payCase: PayCase, option: Option) {
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_SECONDS;
  const latencies: Record<string, number> = {};
  const permit2Disabled = option === 'permit2-disabled';
  const quoted = await api(
    '/quote',
    quoteBody(
      payCase,
      option === 'permit-as-transaction'
        ? { generatePermitAsTransaction: true }
        : option === 'swap_5792-exact'
          ? { permitAmount: 'EXACT' }
          : {},
    ),
    { permit2Disabled },
  );
  latencies.quote = quoted.latencyMs;
  const { quote, permitData, permitTransaction, routing } = quoted.payload;
  assert.equal(routing, 'CLASSIC', `expected CLASSIC routing, got ${routing}`);
  const maxAmountIn = BigInt(quote.input.maximumAmount ?? quote.input.amount);

  const calls: Call[] = [];
  if (option.startsWith('swap_5792')) {
    const batch = await api('/swap_5792', {
      quote,
      ...(permitData ? { permitData } : {}),
      deadline,
    });
    latencies.swap_5792 = batch.latencyMs;
    const apiCalls = (batch.payload.calls as ApiTransaction[]).map((call) => toCall(call)!);
    if (option === 'swap_5792-bounded') {
      // Keep only the router call; replace the API's unlimited approvals with ones capped at maxAmountIn.
      const routerCalls = apiCalls.filter((call) => call.to.toLowerCase() === TRADING_ROUTER.toLowerCase());
      assert.equal(routerCalls.length, 1, 'expected exactly one router call');
      if (payCase.tokenIn !== ETH) calls.push(...boundedApprovals(maxAmountIn, deadline));
      calls.push(routerCalls[0]!);
    } else {
      calls.push(...apiCalls);
    }
  } else {
    if (payCase.tokenIn !== ETH) {
      const approval = await api(
        '/check_approval',
        { walletAddress: ACCOUNT, token: payCase.tokenIn, amount: maxAmountIn.toString(), chainId: CHAIN_ID },
        { permit2Disabled },
      );
      latencies.check_approval = approval.latencyMs;
      for (const call of [toCall(approval.payload.cancel), toCall(approval.payload.approval)]) {
        if (call) calls.push(call);
      }
    }
    const permitCall = toCall(permitTransaction);
    if (permitCall) calls.push(permitCall);
    assert.ok(!permitData || permitCall, 'quote still requires an off-chain permit signature');
    const swap = await api('/swap', { quote, deadline }, { permit2Disabled });
    latencies.swap = swap.latencyMs;
    calls.push(toCall(swap.payload.swap)!);
  }
  return { quote, calls, maxAmountIn, latencies, permitDataReturned: Boolean(permitData) };
}

function boundedApprovals(maxAmountIn: bigint, deadline: number): Call[] {
  return [
    {
      to: USDC,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [PERMIT2, maxAmountIn] }),
    },
    {
      to: PERMIT2,
      value: 0n,
      data: encodeFunctionData({
        abi: permit2Abi,
        functionName: 'approve',
        args: [USDC, TRADING_ROUTER, maxAmountIn, deadline],
      }),
    },
  ];
}

function transferToPayee(payCase: PayCase): Call {
  return payCase.tokenOut === ETH
    ? { to: PAYEE, value: payCase.amountOut, data: '0x' }
    : {
        to: USDC,
        value: 0n,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [PAYEE, payCase.amountOut] }),
      };
}

function describeApprovals(calls: Call[]) {
  return calls.flatMap((call) => {
    if (call.to.toLowerCase() === USDC.toLowerCase() && call.data.startsWith('0x095ea7b3')) {
      const { args } = decodeFunctionData({ abi: erc20Abi, data: call.data });
      return [{ kind: 'ERC20.approve', spender: args[0], amount: (args[1] as bigint).toString() }];
    }
    if (call.to.toLowerCase() === PERMIT2.toLowerCase()) {
      const { functionName, args } = decodeFunctionData({ abi: permit2Abi, data: call.data });
      if (functionName === 'approve') {
        return [
          {
            kind: 'Permit2.approve',
            spender: args[1],
            amount: (args[2] as bigint).toString(),
            expiration: new Date(Number(args[3]) * 1000).toISOString(),
          },
        ];
      }
    }
    return [];
  });
}

async function simulate(payCase: PayCase, calls: Call[]) {
  const usdcSlot = keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [ACCOUNT, USDC_BALANCE_SLOT]),
  );
  const [{ calls: results }] = await client.simulateBlocks({
    blocks: [
      {
        calls: [
          ...calls.map((call) => ({ account: ACCOUNT, ...call })),
          {
            account: ACCOUNT,
            to: USDC,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [ACCOUNT, PERMIT2],
          },
          {
            account: ACCOUNT,
            to: USDC,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [ACCOUNT, PERMIT2_PROXY],
          },
          {
            account: ACCOUNT,
            to: PERMIT2,
            abi: permit2Abi,
            functionName: 'allowance',
            args: [ACCOUNT, USDC, TRADING_ROUTER],
          },
        ],
        stateOverrides: [
          { address: ACCOUNT, balance: parseEther('10') },
          { address: USDC, stateDiff: [{ slot: usdcSlot, value: pad(toHex(1_000_000n * 10n ** 6n)) }] },
        ],
      },
    ],
    traceTransfers: true,
  });

  const failed = results.slice(0, calls.length).findIndex((result) => result.status !== 'success');
  const deltas: Record<'ETH' | 'USDC', Record<string, bigint>> = { ETH: {}, USDC: {} };
  for (const result of results.slice(0, calls.length)) {
    for (const log of result.logs ?? []) {
      const asset =
        log.address.toLowerCase() === NATIVE_LOG_ADDRESS
          ? 'ETH'
          : log.address.toLowerCase() === USDC.toLowerCase()
            ? 'USDC'
            : null;
      if (!asset || log.topics[0] !== TRANSFER_TOPIC) continue;
      const from = `0x${log.topics[1]!.slice(26)}`;
      const to = `0x${log.topics[2]!.slice(26)}`;
      const amount = BigInt(log.data);
      deltas[asset][from] = (deltas[asset][from] ?? 0n) - amount;
      deltas[asset][to] = (deltas[asset][to] ?? 0n) + amount;
    }
  }
  const [usdcToPermit2, usdcToProxy, permit2ToRouter] = results.slice(calls.length).map((result) => result.result);
  return {
    failedCall: failed === -1 ? null : failed,
    deltas,
    allowancesAfter: {
      usdcToPermit2: String(usdcToPermit2),
      usdcToProxy: String(usdcToProxy),
      permit2ToRouter: String((permit2ToRouter as readonly bigint[] | undefined)?.[0]),
    },
  };
}

const cases: PayCase[] = [
  { name: '10 USDC paid with ETH', tokenIn: ETH, tokenOut: USDC, amountOut: parseUnits('10', 6) },
  { name: '0.001 ETH paid with USDC', tokenIn: USDC, tokenOut: ETH, amountOut: parseEther('0.001') },
];
const options: Option[] = [
  'swap_5792',
  'swap_5792-exact',
  'swap_5792-bounded',
  'permit-as-transaction',
  'permit2-disabled',
];
const asset = (address: Address) => (address === ETH ? 'ETH' : 'USDC') as 'ETH' | 'USDC';
const format = (amount: bigint, address: Address) => formatUnits(amount, address === ETH ? 18 : 6);

const report: Record<string, Record<string, unknown>> = {};
const passes: Record<Option, number> = {
  swap_5792: 0,
  'swap_5792-exact': 0,
  'swap_5792-bounded': 0,
  'permit-as-transaction': 0,
  'permit2-disabled': 0,
};

for (const payCase of cases) {
  report[payCase.name] = {};
  for (const option of options) {
    try {
      const built = await buildOptionCalls(payCase, option);
      const calls = [...built.calls, transferToPayee(payCase)];
      const simulation = await simulate(payCase, calls);
      const inAsset = asset(payCase.tokenIn);
      const outAsset = asset(payCase.tokenOut);
      const payeeReceived = simulation.deltas[outAsset][PAYEE.toLowerCase()] ?? 0n;
      const accountSpent = -(simulation.deltas[inAsset][ACCOUNT.toLowerCase()] ?? 0n);
      const routerLeft = {
        ETH: (simulation.deltas.ETH[TRADING_ROUTER.toLowerCase()] ?? 0n).toString(),
        USDC: (simulation.deltas.USDC[TRADING_ROUTER.toLowerCase()] ?? 0n).toString(),
      };
      const checks = {
        allCallsSucceeded: simulation.failedCall === null,
        payeeGotExactAmount: payeeReceived === payCase.amountOut,
        accountSpentAtMostMax: accountSpent <= built.maxAmountIn,
        nothingLeftInRouter: routerLeft.ETH === '0' && routerLeft.USDC === '0',
        noUnknownTargets: calls.every((call) => KNOWN_TARGETS[call.to.toLowerCase()]),
      };
      const pass = Object.values(checks).every(Boolean);
      if (pass) passes[option] += 1;
      report[payCase.name]![option] = {
        pass,
        checks,
        failedCall: simulation.failedCall,
        route: built.quote.routeString,
        priceImpactPercent: built.quote.priceImpact,
        quotedIn: `${format(BigInt(built.quote.input.amount), payCase.tokenIn)} ${inAsset}`,
        maxIn: `${format(built.maxAmountIn, payCase.tokenIn)} ${inAsset}`,
        accountSpent: `${format(accountSpent, payCase.tokenIn)} ${inAsset}`,
        payeeReceived: `${format(payeeReceived, payCase.tokenOut)} ${outAsset}`,
        routerLeft,
        permitDataReturned: built.permitDataReturned,
        calls: calls.map((call) => ({
          target: KNOWN_TARGETS[call.to.toLowerCase()] ?? `UNKNOWN ${call.to}`,
          value: call.value.toString(),
          selector: call.data.slice(0, 10),
          bytes: (call.data.length - 2) / 2,
        })),
        approvals: describeApprovals(calls),
        allowancesAfter: simulation.allowancesAfter,
        latencyMs: built.latencies,
      };
    } catch (error) {
      report[payCase.name]![option] = { pass: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

console.log(JSON.stringify({ account: ACCOUNT, payee: PAYEE, routerVersion: ROUTER_VERSION, report, passes }, null, 2));
const viable = options.filter((option) => passes[option] === cases.length);
console.log(viable.length ? `GO: viable options ${viable.join(', ')}` : 'NO-GO: no option passed both directions');
process.exitCode = viable.length ? 0 : 1;
