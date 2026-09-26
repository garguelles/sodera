import { fireEvent, render, screen } from '@testing-library/react-native';

import { ReceiveScreen } from './receive-screen';
import type { RegisteredPrimaryPasskey } from '@/wallet/passkey-ceremony';
import {
  CURRENT_WALLET_IDENTITY_PINS,
  type WalletIdentityStorage,
} from '@/wallet/wallet-identity';

jest.mock('react-native-qrcode-svg', () => {
  const { Text } = jest.requireActual('react-native');
  return function MockQRCode({ value }: { value: string }) {
    return <Text>{`QR:${value}`}</Text>;
  };
});
jest.mock('@/wallet/wallet-identity-native-storage', () => ({
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

describe('ReceiveScreen', () => {
  it('shows the persisted account in the QR code and address display', async () => {
    await render(
      <ReceiveScreen copyAddress={jest.fn()} onBack={jest.fn()} storage={createStorage()} />,
    );

    expect(
      await screen.findByLabelText(`QR code for wallet address ${account}`),
    ).toBeOnTheScreen();
    expect(screen.getByText(account)).toBeOnTheScreen();
    expect(screen.getByText('Ethereum')).toBeOnTheScreen();
  });

  it('copies the exact persisted account and confirms success', async () => {
    const copyAddress = jest.fn().mockResolvedValue(undefined);
    await render(
      <ReceiveScreen copyAddress={copyAddress} onBack={jest.fn()} storage={createStorage()} />,
    );

    await screen.findByText(account);
    await fireEvent.press(screen.getByRole('button', { name: 'Copy wallet address' }));

    expect(copyAddress).toHaveBeenCalledWith(account);
    expect(await screen.findByText('Copied')).toBeOnTheScreen();
  });

  it('shows a retryable error without rendering a QR code when identity is missing', async () => {
    await render(
      <ReceiveScreen
        copyAddress={jest.fn()}
        onBack={jest.fn()}
        storage={{ ...createStorage(), read: jest.fn().mockResolvedValue(null) }}
      />,
    );

    expect(await screen.findByText('Wallet address unavailable')).toBeOnTheScreen();
    expect(screen.getByText('No Wallet Identity metadata exists')).toBeOnTheScreen();
    expect(screen.queryByLabelText(/QR code for wallet address/)).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeOnTheScreen();
  });
});

function createStorage(): WalletIdentityStorage {
  return {
    read: jest.fn().mockResolvedValue(
      JSON.stringify({
        schemaVersion: 1,
        phase: 'accountDerived',
        pins: CURRENT_WALLET_IDENTITY_PINS,
        credential,
        account,
      }),
    ),
    write: jest.fn(),
    clear: jest.fn(),
  };
}
