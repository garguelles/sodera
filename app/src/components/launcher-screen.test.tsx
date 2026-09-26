import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { LauncherScreen } from './launcher-screen';

describe('LauncherScreen', () => {
  it('opens Phone by card or upward gesture, alongside Wallet and Settings', async () => {
    const onOpenPhone = jest.fn();
    const onOpenWallet = jest.fn();
    const onOpenSettings = jest.fn();
    const home = await render(
      <LauncherScreen
        accountAddress="0x1234567890123456789012345678901234567890"
        username="anon.sodera.eth"
        homeContent={<Text>Market watch</Text>}
        onOpenPhone={onOpenPhone}
        onOpenWallet={onOpenWallet}
        onOpenSettings={onOpenSettings}
      />,
    );

    expect(home.getByText('Market watch')).toBeOnTheScreen();
    expect(home.getByText('0x1234...7890')).toBeOnTheScreen();
    expect(home.getByText('anon.sodera.eth')).toBeOnTheScreen();
    expect(home.getByText('𝕏 @anon_builder')).toBeOnTheScreen();
    expect(home.getByText('github/anon')).toBeOnTheScreen();
    expect(home.getByText('sodera.xyz')).toBeOnTheScreen();
    expect(home.queryByLabelText('Search apps')).not.toBeOnTheScreen();
    fireEvent.press(home.getByRole('button', { name: 'Open Phone' }));
    fireEvent.press(home.getByRole('button', { name: 'Open Wallet' }));
    fireEvent.press(home.getByRole('button', { name: 'Open launcher settings' }));

    expect(onOpenPhone).toHaveBeenCalledTimes(1);
    expect(onOpenWallet).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    const affordance = home.getByText('SWIPE UP FOR PHONE').parent!;
    fireEvent(affordance, 'touchStart', { nativeEvent: { pageX: 100, pageY: 200 } });
    fireEvent(affordance, 'touchEnd', { nativeEvent: { pageX: 102, pageY: 120 } });
    expect(onOpenPhone).toHaveBeenCalledTimes(2);
    await home.unmount();
  });
});
