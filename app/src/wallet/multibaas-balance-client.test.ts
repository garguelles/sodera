import type { Address } from 'viem';

import type { MultiBaasClient } from './multibaas';
import { createMultiBaasBalanceClient } from './multibaas-balance-client';
import { SEPOLIA_ETH_USD_FEED_ADDRESS, SEPOLIA_USDC_ADDRESS } from './sepolia';
import { SEPOLIA_READ_ABI } from './wallet-home-live';

jest.mock('@/launcher/default-home', () => ({ defaultHomeClient: {} }));
jest.mock('./wallet-identity-native-storage', () => ({
  walletIdentityNativeStorage: { read: jest.fn(), write: jest.fn(), clear: jest.fn() },
}));

const account = '0x1111111111111111111111111111111111111111' as Address;

describe('createMultiBaasBalanceClient', () => {
  it('reads the chain id from chain status', async () => {
    const client = createClient();
    jest.mocked(client.getChainStatus).mockResolvedValue({ chainID: 11155111, networkID: 11155111 });

    await expect(createMultiBaasBalanceClient({ client }).getChainId()).resolves.toBe(11155111);
  });

  it('reads the ETH balance from the address endpoint', async () => {
    const client = createClient();
    jest.mocked(client.getAddress).mockResolvedValue({ address: account, balance: '22564727475221642' });

    await expect(createMultiBaasBalanceClient({ client }).getBalance({ address: account })).resolves.toBe(
      22564727475221642n,
    );
    expect(client.getAddress).toHaveBeenCalledWith(account, ['balance']);
  });

  it('reads USDC through its linked label', async () => {
    const client = createClient();
    jest.mocked(client.callMethod).mockResolvedValueOnce('1500000').mockResolvedValueOnce('6');
    const balances = createMultiBaasBalanceClient({ client });

    await expect(
      balances.readContract({
        address: SEPOLIA_USDC_ADDRESS,
        abi: SEPOLIA_READ_ABI,
        functionName: 'balanceOf',
        args: [account],
      }),
    ).resolves.toBe(1_500_000n);
    await expect(
      balances.readContract({ address: SEPOLIA_USDC_ADDRESS, abi: SEPOLIA_READ_ABI, functionName: 'decimals' }),
    ).resolves.toBe(6);

    expect(client.callMethod).toHaveBeenNthCalledWith(1, SEPOLIA_USDC_ADDRESS, 'usdc', 'balanceOf', [account]);
    expect(client.callMethod).toHaveBeenNthCalledWith(2, SEPOLIA_USDC_ADDRESS, 'usdc', 'decimals', []);
  });

  it('returns the Chainlink round as five bigints in order', async () => {
    const client = createClient();
    jest
      .mocked(client.callMethod)
      .mockResolvedValue(['18446744073709587959', '268775750636', '1790401272', '1790401272', '18446744073709587959']);

    await expect(
      createMultiBaasBalanceClient({ client }).readContract({
        address: SEPOLIA_ETH_USD_FEED_ADDRESS,
        abi: SEPOLIA_READ_ABI,
        functionName: 'latestRoundData',
      }),
    ).resolves.toEqual([18446744073709587959n, 268775750636n, 1790401272n, 1790401272n, 18446744073709587959n]);
    expect(client.callMethod).toHaveBeenCalledWith(SEPOLIA_ETH_USD_FEED_ADDRESS, 'ethprice', 'latestRoundData', []);
  });

  it('rejects unknown contracts and malformed values', async () => {
    const client = createClient();
    const balances = createMultiBaasBalanceClient({ client });

    await expect(
      balances.readContract({ address: account, abi: SEPOLIA_READ_ABI, functionName: 'decimals' }),
    ).rejects.toThrow(`MultiBaas has no linked contract for ${account}`);

    jest.mocked(client.getAddress).mockResolvedValue({ balance: 12 });
    await expect(balances.getBalance({ address: account })).rejects.toThrow('MultiBaas returned invalid data');

    jest.mocked(client.callMethod).mockResolvedValue(['1', '2']);
    await expect(
      balances.readContract({
        address: SEPOLIA_ETH_USD_FEED_ADDRESS,
        abi: SEPOLIA_READ_ABI,
        functionName: 'latestRoundData',
      }),
    ).rejects.toThrow('MultiBaas returned invalid data');

    jest.mocked(client.getChainStatus).mockResolvedValue({});
    await expect(balances.getChainId()).rejects.toThrow('MultiBaas returned invalid data');
  });
});

function createClient(): MultiBaasClient {
  return {
    executeEventQuery: jest.fn(),
    callMethod: jest.fn(),
    getAddress: jest.fn(),
    getChainStatus: jest.fn(),
  };
}
