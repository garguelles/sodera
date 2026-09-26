import { act, fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { LauncherScreen } from './launcher-screen';

describe('LauncherScreen', () => {
  it('shows the assistant button next to settings only when configured', async () => {
    const onOpenAssistant = jest.fn();
    const home = await render(
      <LauncherScreen
        homeContent={null}
        onOpenAssistant={onOpenAssistant}
        onOpenPhone={jest.fn()}
        onOpenSettings={jest.fn()}
        onOpenWallet={jest.fn()}
      />,
    );
    await act(async () => {
      fireEvent.press(home.getByRole('button', { name: 'Open Dera' }));
    });
    expect(onOpenAssistant).toHaveBeenCalled();
    expect(home.getByText('ADDRESS ONLY')).toBeOnTheScreen();
    await home.rerender(<LauncherScreen homeContent={null} onOpenPhone={jest.fn()} onOpenSettings={jest.fn()} onOpenWallet={jest.fn()} />);
    expect(home.queryByRole('button', { name: 'Open Dera' })).not.toBeOnTheScreen();
    await home.unmount();
  });

  it('opens Phone by card or upward gesture, alongside Wallet and Settings', async () => {
    const onOpenPhone = jest.fn();
    const onOpenWallet = jest.fn();
    const onOpenSettings = jest.fn();
    const home = await render(
      <LauncherScreen
        accountAddress="0x1234567890123456789012345678901234567890"
        username="gargs.sodera.eth"
        ensVerified
        homeContent={<Text>Market watch</Text>}
        onOpenPhone={onOpenPhone}
        onOpenWallet={onOpenWallet}
        onOpenSettings={onOpenSettings}
      />,
    );

    expect(home.getByText('Market watch')).toBeOnTheScreen();
    expect(home.getByText('0x1234...7890')).toBeOnTheScreen();
    expect(home.getByText('gargs.sodera.eth')).toBeOnTheScreen();
    expect(home.getByText('ETHEREUM SEPOLIA')).toBeOnTheScreen();
    expect(home.getByText('ENS VERIFIED')).toBeOnTheScreen();
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
