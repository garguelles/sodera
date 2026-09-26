import { decodeFunctionData, erc20Abi, getAddress, parseEther } from 'viem';

import { encodePlan } from './plan-encoder';
import { evaluatePolicy } from './policy';
import type { AgentContext } from './schema';
import { SEPOLIA_USDC_ADDRESS } from '@/wallet/sepolia';

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
  it('encodes ETH and USDC sends in plan order with review lines', () => {
    const { calls, lines } = encodePlan(
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
      { title: 'Send 0.01 ETH to alice', detail: 'address book · 0x2222...2222' },
      { title: 'Send 2.5 USDC to 0x3333...3333', detail: '0x3333...3333' },
    ]);
  });

  it('refuses actions whose encoders do not exist yet', () => {
    expect(() => encodePlan(checkedPlan([{ type: 'swap', direction: 'eth_to_usdc', amountIn: '0.01' }]))).toThrow(
      'Not implemented: swap',
    );
  });
});
