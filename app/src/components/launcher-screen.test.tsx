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
      />,
    );
    await act(async () => {
      await fireEvent.press(home.getByRole('button', { name: 'Open Dera' }));
    });
    expect(onOpenAssistant).toHaveBeenCalled();
    await home.rerender(<LauncherScreen homeContent={null} onOpenPhone={jest.fn()} onOpenSettings={jest.fn()} />);
    expect(home.queryByRole('button', { name: 'Open Dera' })).not.toBeOnTheScreen();
    await home.unmount();
  });

  it('renders home content and opens Phone by upward gesture and Settings by button', async () => {
    const onOpenPhone = jest.fn();
    const onOpenSettings = jest.fn();
    const home = await render(
      <LauncherScreen homeContent={<Text>Market watch</Text>} onOpenPhone={onOpenPhone} onOpenSettings={onOpenSettings} />,
    );

    expect(home.getByText('Market watch')).toBeOnTheScreen();
    expect(home.queryByLabelText('Search apps')).not.toBeOnTheScreen();
    await fireEvent.press(home.getByRole('button', { name: 'Open launcher settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    const affordance = home.getByText('SWIPE UP FOR PHONE').parent!;
    await fireEvent(affordance, 'touchStart', { nativeEvent: { pageX: 100, pageY: 200 } });
    await fireEvent(affordance, 'touchEnd', { nativeEvent: { pageX: 102, pageY: 120 } });
    expect(onOpenPhone).toHaveBeenCalledTimes(1);
    await home.unmount();
  });

  it('shows EDIT HOME with Done while editing and ignores swipe-up', async () => {
    const onDone = jest.fn();
    const onOpenPhone = jest.fn();
    const home = await render(
      <LauncherScreen editing onDone={onDone} homeContent={null} onOpenAssistant={jest.fn()} onOpenPhone={onOpenPhone} onOpenSettings={jest.fn()} />,
    );

    expect(home.getByText('EDIT HOME')).toBeOnTheScreen();
    expect(home.queryByRole('button', { name: 'Open launcher settings' })).not.toBeOnTheScreen();
    expect(home.queryByRole('button', { name: 'Open Dera' })).not.toBeOnTheScreen();
    await fireEvent.press(home.getByRole('button', { name: 'Done editing home' }));
    expect(onDone).toHaveBeenCalledTimes(1);

    const affordance = home.getByText('SWIPE UP FOR PHONE').parent!;
    await fireEvent(affordance, 'touchStart', { nativeEvent: { pageX: 100, pageY: 200 } });
    await fireEvent(affordance, 'touchEnd', { nativeEvent: { pageX: 102, pageY: 120 } });
    expect(onOpenPhone).not.toHaveBeenCalled();
    await home.unmount();
  });
});
