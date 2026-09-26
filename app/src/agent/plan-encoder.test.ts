import { decodeFunctionData, erc20Abi, getAddress, parseEther } from 'viem';

import { encodePlan } from './plan-encoder';
import { evaluatePolicy } from './policy';
import type { AgentContext } from './schema';
import {
  SEPOLIA_PERMIT2_ADDRESS,
  SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
  SEPOLIA_USDC_ADDRESS,
} from '@/wallet/sepolia';
import type { SwapQuote } from '@/wallet/uniswap-quote';

jest.mock('@/launcher/default-home', () => ({ defaultHomeClient: {} }));

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const ALICE = getAddress('0x2222222222222222222222222222222222222222');
const context: AgentContext = {
  chainId: 11155111,
  now: '2026-09-26T08:00:00.000Z',
  balances: { eth: '1', usdc: '100' },
  prices: { ethUsd: '2000' },
  vaultPosition: null,
  sponsorship: null,
  addressBook: [{ name: 'alice', address: ALICE }],
  capabilities: { send_eth: true, send_usdc: true, swap: true, vault_deposit: false, vault_withdraw: false },
};

function checkedPlan(actions: unknown[]) {
  const result = evaluatePolicy({ kind: 'plan', summary: 's', assumptions: [], actions }, context, {
    account: ACCOUNT,
    valueCapUsd: 250,
    resolveName: (name) => (name === 'alice' ? ALICE : null),
  });
  if (!result.ok) throw new Error(result.violations.map((item) => item.code).join());
  return result.plan;
}

describe('encodePlan', () => {
  it('encodes ETH and USDC sends in plan order with review lines', async () => {
    const { calls, lines, expiresAt } = await encodePlan(
      checkedPlan([
        { type: 'send_eth', recipient: { kind: 'name', value: 'alice' }, amount: '0.01' },
        { type: 'send_usdc', recipient: { kind: 'address', value: '0x3333333333333333333333333333333333333333' }, amount: '2.5' },
      ]),
    );

    expect(calls[0]).toEqual({ to: ALICE, value: parseEther('0.01'), data: '0x' });
    expect(calls[1].to).toBe(SEPOLIA_USDC_ADDRESS);
    expect(calls[1].value).toBe(0n);
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[1].data })).toEqual({
      functionName: 'transfer',
      args: [getAddress('0x3333333333333333333333333333333333333333'), 2_500_000n],
    });
    expect(lines).toEqual([
      { title: 'Send 0.01 ETH to alice', detail: 'ENS · 0x2222...2222' },
      { title: 'Send 2.5 USDC to 0x3333...3333', detail: '0x3333...3333' },
    ]);
    expect(expiresAt).toBeNull();
  });

  const now = Date.parse('2026-09-26T08:00:00Z');
  const quoteSwap = jest.fn(async ({ direction, amountIn }: { direction: string; amountIn: bigint }) =>
    direction === 'eth-to-usdc'
      ? ({ direction, amountIn, amountOut: 26_000_000n, minAmountOut: 25_870_000n } as unknown as SwapQuote)
      : ({ direction, amountIn, amountOut: 1_900_000_000_000_000n, minAmountOut: 1_890_000_000_000_000n } as unknown as SwapQuote),
  );

  it('quotes an ETH to USDC swap and sends the ETH with the router call', async () => {
    const { calls, lines, expiresAt } = await encodePlan(
      checkedPlan([{ type: 'swap', direction: 'eth_to_usdc', amountIn: '0.01' }]),
      { quoteSwap, now: () => now },
    );

    expect(quoteSwap).toHaveBeenCalledWith({ direction: 'eth-to-usdc', amountIn: parseEther('0.01') });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ to: SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS, value: parseEther('0.01') });
    expect(lines).toEqual([
      {
        title: 'Swap 0.01 ETH for ~26 USDC',
        detail: 'at least 25.87 USDC · Uniswap v4 · 0.5% max slippage',
      },
    ]);
    expect(expiresAt).toBe(BigInt(now / 1000 + 600));
  });

  it('approves USDC through Permit2 before a USDC to ETH swap', async () => {
    const { calls } = await encodePlan(checkedPlan([{ type: 'swap', direction: 'usdc_to_eth', amountIn: '5' }]), {
      quoteSwap,
      now: () => now,
    });

    expect(calls.map((call) => call.to)).toEqual([
      SEPOLIA_USDC_ADDRESS,
      SEPOLIA_PERMIT2_ADDRESS,
      SEPOLIA_UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
    ]);
    expect(calls.every((call) => call.value === 0n)).toBe(true);
  });

  it('refuses actions whose encoders do not exist yet', async () => {
    const vaultContext = { ...context, capabilities: { ...context.capabilities, vault_deposit: true } };
    const result = evaluatePolicy(
      { kind: 'plan', summary: 's', assumptions: [], actions: [{ type: 'vault_deposit', amount: '5' }] },
      vaultContext,
      { account: ACCOUNT, valueCapUsd: 250, resolveName: () => null },
    );
    if (!result.ok) throw new Error('Expected a plan');
    await expect(encodePlan(result.plan)).rejects.toThrow('Not implemented: vault_deposit');
  });
});
