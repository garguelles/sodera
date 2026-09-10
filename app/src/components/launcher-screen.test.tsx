import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { LauncherScreen } from './launcher-screen';
import type { LauncherApp, LauncherClient } from '@/launcher/launcher-client';

const calculator: LauncherApp = {
  componentName: 'com.android.calculator2/.Calculator',
  packageName: 'com.android.calculator2',
  label: 'Calculator',
  icon: null,
};

function createClient(overrides: Partial<LauncherClient> = {}): LauncherClient {
  return {
    getLaunchableApps: jest.fn().mockResolvedValue([calculator]),
    launchApp: jest.fn().mockResolvedValue(undefined),
    subscribeToAppChanges: jest.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
}

describe('LauncherScreen', () => {
  it('loads and launches an installed app', async () => {
    let resolveApps: (apps: LauncherApp[]) => void = () => undefined;
    const client = createClient({
      getLaunchableApps: jest.fn().mockReturnValue(
        new Promise<LauncherApp[]>((resolve) => {
          resolveApps = resolve;
        }),
      ),
    });
    await render(<LauncherScreen client={client} />);

    expect(screen.getByText('Loading apps...')).toBeOnTheScreen();
    await act(() => resolveApps([calculator]));
    fireEvent.press(await screen.findByRole('button', { name: 'Open Calculator' }));

    expect(client.launchApp).toHaveBeenCalledWith(calculator.componentName);
  });

  it('refreshes the visible list when installed packages change', async () => {
    let notifyAppsChanged: () => void = () => undefined;
    const camera = { ...calculator, componentName: 'com.android.camera/.Camera', label: 'Camera' };
    const getLaunchableApps = jest
      .fn()
      .mockResolvedValueOnce([calculator])
      .mockResolvedValueOnce([camera]);
    const client = createClient({
      getLaunchableApps,
      subscribeToAppChanges: jest.fn((listener: () => void) => {
        notifyAppsChanged = listener;
        return () => undefined;
      }),
    });
    await render(<LauncherScreen client={client} />);
    await screen.findByText('Calculator');

    await act(() => notifyAppsChanged());

    expect(await screen.findByText('Camera')).toBeOnTheScreen();
    expect(screen.queryByText('Calculator')).not.toBeOnTheScreen();
  });

  it('keeps the drawer usable when an app disappears before launch', async () => {
    const client = createClient({
      launchApp: jest.fn().mockRejectedValue(new Error('App is no longer available')),
    });
    await render(<LauncherScreen client={client} />);

    await act(() =>
      fireEvent.press(screen.getByRole('button', { name: 'Open Calculator' })),
    );

    await waitFor(() => expect(screen.getByText('App is no longer available')).toBeOnTheScreen());
    expect(screen.getByRole('button', { name: 'Open Calculator' })).toBeOnTheScreen();
  });

  it('offers retry when app discovery fails', async () => {
    const getLaunchableApps = jest
      .fn()
      .mockRejectedValueOnce(new Error('Unable to load apps'))
      .mockResolvedValueOnce([calculator]);
    const client = createClient({ getLaunchableApps });
    await render(<LauncherScreen client={client} />);

    await act(() => fireEvent.press(screen.getByRole('button', { name: 'Retry' })));

    expect(await screen.findByText('Calculator')).toBeOnTheScreen();
    expect(getLaunchableApps).toHaveBeenCalledTimes(2);
  });
});
