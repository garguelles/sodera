import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { LauncherScreen } from './launcher-screen';
import { WalletHome } from './wallet-home';
import type { LauncherApp, LauncherClient } from '@/launcher/launcher-client';
import type { LauncherPreferencesStorage } from '@/launcher/launcher-preferences';
import { createWalletHomeFixtureProvider } from '@/wallet/wallet-home-fixtures';

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

function createPreferencesStorage(initialValue: string | null = null): LauncherPreferencesStorage {
  let value = initialValue;
  return {
    read: jest.fn(async () => value),
    write: jest.fn(async (nextValue: string) => {
      value = nextValue;
    }),
  };
}

function renderLauncher(
  client: LauncherClient,
  preferencesStorage = createPreferencesStorage(),
) {
  return render(<LauncherScreen client={client} preferencesStorage={preferencesStorage} />);
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
    await renderLauncher(client);

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
    await renderLauncher(client);
    await screen.findByText('Calculator');

    await act(() => notifyAppsChanged());

    expect(await screen.findByText('Camera')).toBeOnTheScreen();
    expect(screen.queryByText('Calculator')).not.toBeOnTheScreen();
  });

  it('keeps the drawer usable when an app disappears before launch', async () => {
    const client = createClient({
      launchApp: jest.fn().mockRejectedValue(new Error('App is no longer available')),
    });
    await renderLauncher(client);

    await act(() =>
      fireEvent.press(screen.getByRole('button', { name: 'Open Calculator' })),
    );

    await waitFor(() => expect(screen.getByText('App is no longer available')).toBeOnTheScreen());
    expect(screen.queryByRole('button', { name: 'Open Calculator' })).not.toBeOnTheScreen();
  });

  it('offers retry when app discovery fails', async () => {
    const getLaunchableApps = jest
      .fn()
      .mockRejectedValueOnce(new Error('Unable to load apps'))
      .mockResolvedValueOnce([calculator]);
    const client = createClient({ getLaunchableApps });
    await renderLauncher(client);

    await act(() => fireEvent.press(screen.getByRole('button', { name: 'Retry' })));

    expect(await screen.findByText('Calculator')).toBeOnTheScreen();
    expect(getLaunchableApps).toHaveBeenCalledTimes(2);
  });

  it('filters apps by label and displays an empty search result', async () => {
    const camera = { ...calculator, componentName: 'com.android.camera/.Camera', label: 'Camera' };
    await renderLauncher(createClient({ getLaunchableApps: jest.fn().mockResolvedValue([calculator, camera]) }));
    await screen.findByText('Calculator');

    fireEvent.changeText(screen.getByLabelText('Search apps'), ' camera ');

    await waitFor(() => {
      expect(screen.getByText('Camera')).toBeOnTheScreen();
      expect(screen.getByText('1 of 2 apps')).toBeOnTheScreen();
      expect(screen.queryByText('Calculator')).not.toBeOnTheScreen();
    });

    fireEvent.changeText(screen.getByLabelText('Search apps'), 'maps');

    await waitFor(() => expect(screen.getByText('No apps match "maps"')).toBeOnTheScreen());
  });

  it('persists favorites by package and restores them after remount', async () => {
    const storage = createPreferencesStorage();
    const client = createClient();
    const firstRender = await renderLauncher(client, storage);
    await screen.findByText('Calculator');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pin Calculator' })).toBeEnabled(),
    );
    fireEvent.press(screen.getByRole('button', { name: 'Pin Calculator' }));
    await waitFor(() => expect(storage.write).toHaveBeenCalledTimes(1));
    expect(JSON.parse((storage.write as jest.Mock).mock.calls[0][0]).favoritePackageNames).toEqual([
      calculator.packageName,
    ]);

    await firstRender.unmount();
    await renderLauncher(client, storage);

    const unpin = await screen.findByRole('button', { name: 'Unpin Calculator' });
    fireEvent.press(unpin);
    await waitFor(() => expect(storage.write).toHaveBeenCalledTimes(2));
    expect(JSON.parse((storage.write as jest.Mock).mock.calls[1][0]).favoritePackageNames).toEqual([]);
  });

  it('uses current discovery metadata for a persisted favorite', async () => {
    const updatedCalculator = {
      ...calculator,
      componentName: 'com.android.calculator2/.NewCalculator',
      label: 'Calculator Pro',
    };
    const storage = createPreferencesStorage(
      JSON.stringify({ schemaVersion: 1, favoritePackageNames: [calculator.packageName] }),
    );
    const client = createClient({ getLaunchableApps: jest.fn().mockResolvedValue([updatedCalculator]) });
    await renderLauncher(client, storage);

    fireEvent.press(await screen.findByRole('button', { name: 'Open Calculator Pro' }));

    expect(client.launchApp).toHaveBeenCalledWith(updatedCalculator.componentName);
  });

  it('hides unavailable favorites and clears them from settings', async () => {
    const storage = createPreferencesStorage(
      JSON.stringify({ schemaVersion: 1, favoritePackageNames: ['com.example.removed'] }),
    );
    await renderLauncher(createClient(), storage);
    await screen.findByText('Calculator');

    await act(() =>
      fireEvent.press(screen.getByRole('button', { name: 'Open launcher settings' })),
    );

    expect(screen.getByText('0 currently installed')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Clear favorite apps' }));
    await waitFor(() => expect(storage.write).toHaveBeenCalledTimes(1));
    expect(JSON.parse((storage.write as jest.Mock).mock.calls[0][0]).favoritePackageNames).toEqual([]);
  });

  it('reconciles a favorite when a package-change event removes its app', async () => {
    let notifyAppsChanged: () => void = () => undefined;
    const getLaunchableApps = jest
      .fn()
      .mockResolvedValueOnce([calculator])
      .mockResolvedValueOnce([]);
    const client = createClient({
      getLaunchableApps,
      subscribeToAppChanges: jest.fn((listener: () => void) => {
        notifyAppsChanged = listener;
        return () => undefined;
      }),
    });
    const storage = createPreferencesStorage(
      JSON.stringify({ schemaVersion: 1, favoritePackageNames: [calculator.packageName] }),
    );
    await renderLauncher(client, storage);
    expect(await screen.findByRole('button', { name: 'Unpin Calculator' })).toBeOnTheScreen();

    await act(() => notifyAppsChanged());

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Open Calculator' })).not.toBeOnTheScreen();
      expect(screen.getByText('No launchable apps found')).toBeOnTheScreen();
    });
  });

  it('keeps discovered apps usable when preference storage fails', async () => {
    const storage: LauncherPreferencesStorage = {
      read: jest.fn().mockRejectedValue(new Error('Preferences unavailable')),
      write: jest.fn().mockRejectedValue(new Error('Preferences unavailable')),
    };
    const client = createClient();
    await renderLauncher(client, storage);

    expect(await screen.findByText('Preferences unavailable')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Open Calculator' }));

    expect(client.launchApp).toHaveBeenCalledWith(calculator.componentName);
  });

  it('keeps wallet controls usable when launcher discovery fails', async () => {
    const client = createClient({
      getLaunchableApps: jest.fn().mockRejectedValue(new Error('Launcher unavailable')),
    });
    await render(
      <LauncherScreen
        client={client}
        homeContent={<WalletHome provider={createWalletHomeFixtureProvider()} />}
        preferencesStorage={createPreferencesStorage()}
      />,
    );

    expect(await screen.findByText('Launcher unavailable')).toBeOnTheScreen();
    expect(screen.getByText('$3,045.00')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Hide financial amounts' }));

    await waitFor(() => expect(screen.queryByText('$3,045.00')).toBeNull());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeOnTheScreen();

    await act(() =>
      fireEvent.press(screen.getByRole('button', { name: 'Open launcher settings' })),
    );
    expect(screen.getByText('Launcher settings')).toBeOnTheScreen();
    await act(() =>
      fireEvent.press(screen.getByRole('button', { name: 'Close launcher settings' })),
    );

    expect(screen.getByRole('button', { name: 'Show financial amounts' })).toBeOnTheScreen();
    expect(screen.queryByText('$3,045.00')).toBeNull();
  });
});
