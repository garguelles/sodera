import { CURRENT_WALLET_IDENTITY_PINS, type WalletIdentityStorage } from './wallet-identity';
import { createWalletHomeLiveProvider } from './wallet-home-live';
import type { RegisteredPrimaryPasskey } from './passkey-ceremony';

jest.mock('./wallet-identity-native-storage', () => ({
  walletIdentityNativeStorage: { read: jest.fn(), write: jest.fn(), clear: jest.fn() },
}));

const account = '0x1111111111111111111111111111111111111111' as const;
const credential: RegisteredPrimaryPasskey = {
  id: 'credential',
  publicKeyX: `0x${'11'.repeat(32)}`,
  publicKeyY: `0x${'22'.repeat(32)}`,
  aaguid: `0x${'00'.repeat(16)}`,
  origin: 'android:apk-key-hash:-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w',
  authenticatorAttachment: 'platform',
};

describe('wallet Home live provider', () => {
  it('binds the persisted Kernel account to its live Sepolia ETH balance', async () => {
    const client = {
      getChainId: jest.fn().mockResolvedValue(11155111),
      getBalance: jest.fn().mockResolvedValue(820_000_000_000_000_000n),
    };
    const provider = createWalletHomeLiveProvider({ storage: createStorage(), client });

    await expect(provider.load()).resolves.toMatchObject({
      status: 'ready',
      snapshot: {
        identity: { username: 'anon.sodera.eth', address: account },
        portfolio: {
          balances: [{ symbol: 'ETH', amount: '0.82 ETH', valueUsdCents: null }],
          positions: [],
        },
      },
    });
    expect(client.getBalance).toHaveBeenCalledWith({ address: account });
  });

  it('rejects a balance endpoint on another chain', async () => {
    const provider = createWalletHomeLiveProvider({
      storage: createStorage(),
      client: {
        getChainId: jest.fn().mockResolvedValue(1),
        getBalance: jest.fn().mockResolvedValue(0n),
      },
    });

    await expect(provider.load()).rejects.toThrow('Wallet balance RPC is not Ethereum Sepolia');
  });

  it('does not query balances without a derived persisted account', async () => {
    const client = {
      getChainId: jest.fn(),
      getBalance: jest.fn(),
    };
    const provider = createWalletHomeLiveProvider({
      storage: { ...createStorage(), read: jest.fn().mockResolvedValue(null) },
      client,
    });

    await expect(provider.load()).rejects.toThrow('No Wallet Identity metadata exists');
    expect(client.getBalance).not.toHaveBeenCalled();
  });
});

function createStorage(): WalletIdentityStorage {
  const value = JSON.stringify({
    schemaVersion: 1,
    phase: 'accountDerived',
    pins: CURRENT_WALLET_IDENTITY_PINS,
    credential,
    account,
  });
  return {
    read: jest.fn().mockResolvedValue(value),
    write: jest.fn(),
    clear: jest.fn(),
  };
}
