import { getAddress } from 'viem';

import { AGENT_CAPABILITIES, loadAgentContext } from './agent-context';

jest.mock('@/launcher/default-home', () => ({ defaultHomeClient: {} }));
jest.mock('@/wallet/wallet-identity-native-storage', () => ({ walletIdentityNativeStorage: {} }));

const ACCOUNT = getAddress('0x1111111111111111111111111111111111111111');
const now = Date.parse('2026-09-26T08:00:00Z');

function balanceClient(round: readonly bigint[] = [1n, 268_775_750_636n, 0n, BigInt(now / 1000 - 60), 1n]) {
  return {
    getChainId: jest.fn().mockResolvedValue(11155111),
    getBalance: jest.fn().mockResolvedValue(719_432_815_254_333_180n),
    readContract: jest.fn(async ({ functionName }: { functionName: string }) =>
      functionName === 'balanceOf' ? 160_000n : functionName === 'decimals' ? 8 : round,
    ),
  };
}

describe('loadAgentContext', () => {
  it('snapshots balances, price, and contacts, with the seams that do not exist yet as null', async () => {
    const context = await loadAgentContext({
      account: ACCOUNT,
      balanceClient: balanceClient(),
      addressBook: [{ name: 'alice', address: getAddress('0x2222222222222222222222222222222222222222') }],
      now: () => now,
    });

    expect(context).toEqual({
      chainId: 11155111,
      now: '2026-09-26T08:00:00.000Z',
      balances: { eth: '0.71943281525433318', usdc: '0.16' },
      prices: { ethUsd: '2687.75750636' },
      vaultPosition: null,
      sponsorship: null,
      addressBook: [{ name: 'alice', address: '0x2222222222222222222222222222222222222222' }],
      capabilities: AGENT_CAPABILITIES,
    });
    expect(AGENT_CAPABILITIES).toEqual({
      send_eth: true,
      send_usdc: true,
      swap: false,
      vault_deposit: false,
      vault_withdraw: false,
    });
  });

  it('sends no price when the feed is stale', async () => {
    const stale = balanceClient([1n, 268_775_750_636n, 0n, BigInt(now / 1000 - 10_000), 1n]);
    const context = await loadAgentContext({ account: ACCOUNT, balanceClient: stale, addressBook: [], now: () => now });
    expect(context.prices.ethUsd).toBeNull();
  });
});
