import { fireEvent, render, screen } from '@testing-library/react-native';

import { IdentityWidget } from './identity-widget';

describe('IdentityWidget', () => {
  it('shows the profile and opens the wallet', async () => {
    const onOpenWallet = jest.fn();
    await render(
      <IdentityWidget
        size={{ w: 4, h: 2 }}
        accountAddress="0x1234567890123456789012345678901234567890"
        username="anon.sodera.eth"
        ensVerified
        onOpenWallet={onOpenWallet}
      />,
    );

    expect(screen.getByText('anon.sodera.eth')).toBeOnTheScreen();
    expect(screen.getByText('0x1234...7890')).toBeOnTheScreen();
    expect(screen.getByText('ETHEREUM')).toBeOnTheScreen();
    expect(screen.getByText('ENS VERIFIED')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Copy account address' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'View smart account' }));
    expect(onOpenWallet).toHaveBeenCalledTimes(1);
  });

  it('falls back when there is no account', async () => {
    await render(<IdentityWidget size={{ w: 4, h: 2 }} onOpenWallet={jest.fn()} />);

    expect(screen.getByText('Your smart account')).toBeOnTheScreen();
    expect(screen.getByText('Ethereum smart wallet')).toBeOnTheScreen();
    expect(screen.getByText('ADDRESS ONLY')).toBeOnTheScreen();
  });
});
