import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { LauncherScreen } from './launcher-screen';
import { WalletHome } from './wallet-home';
import type { LauncherApp, LauncherClient } from '@/launcher/launcher-client';
import type { LauncherPreferencesStorage } from '@/launcher/launcher-preferences';
import {
  createWalletHomeFixtureProvider,
  failedWalletHomeFixture,
} from '@/wallet/wallet-home-fixtures';

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

async function openAppDrawer() {
  fireEvent.press(screen.getByRole('button', { name: 'Open app drawer' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Return to Home' })).toBeOnTheScreen(),
  );
}

describe('LauncherScreen', () => {
  it('shows only pinned apps on Home and keeps all apps in the drawer', async () => {
    const camera = {
      ...calculator,
      componentName: 'com.android.camera/.Camera',
      packageName: 'com.android.camera',
      label: 'Camera',
    };
    const storage = createPreferencesStorage(
      JSON.stringify({ schemaVersion: 1, favoritePackageNames: [calculator.packageName] }),
    );
    await renderLauncher(
      createClient({ getLaunchableApps: jest.fn().mockResolvedValue([calculator, camera]) }),
      storage,
    );

    expect(await screen.findByRole('button', { name: 'Open Calculator' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Open Camera' })).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Search apps')).not.toBeOnTheScreen();

    await openAppDrawer();

    expect(screen.getByRole('button', { name: 'Open Calculator' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Open Camera' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Search apps')).toBeOnTheScreen();
  });

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
    await openAppDrawer();
    fireEvent.press(await screen.findByRole('button', { name: 'Open Calculator' }));

    expect(client.launchApp).toHaveBeenCalledWith(calculator.componentName);
  });

  it('refreshes the visible list when installed packages change', async () => {
    let notifyAppsChanged: () => void = () => undefined;
    const camera = {
      ...calculator,
      componentName: 'com.android.camera/.Camera',
      packageName: 'com.android.camera',
      label: 'Camera',
    };
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
    await openAppDrawer();
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
    await openAppDrawer();

    const calculatorButton = await screen.findByRole('button', { name: 'Open Calculator' });
    await act(async () => {
      fireEvent.press(calculatorButton);
      await Promise.resolve();
    });

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

    const retryButton = await screen.findByRole('button', { name: 'Retry' });
    fireEvent.press(retryButton);
    await waitFor(() => expect(getLaunchableApps).toHaveBeenCalledTimes(2));
    await openAppDrawer();

    expect(await screen.findByText('Calculator')).toBeOnTheScreen();
  });

  it('filters apps by label and displays an empty search result', async () => {
    const camera = {
      ...calculator,
      componentName: 'com.android.camera/.Camera',
      packageName: 'com.android.camera',
      label: 'Camera',
    };
    await renderLauncher(createClient({ getLaunchableApps: jest.fn().mockResolvedValue([calculator, camera]) }));
    await openAppDrawer();
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
    await openAppDrawer();
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
    await openAppDrawer();

    const unpin = await screen.findByRole('button', { name: 'Unpin Calculator' });
    fireEvent.press(unpin);
    await waitFor(() => expect(storage.write).toHaveBeenCalledTimes(2));
    expect(JSON.parse((storage.write as jest.Mock).mock.calls[1][0]).favoritePackageNames).toEqual([]);
  });

  it('limits pinned apps to four and allows another after unpinning', async () => {
    const apps = ['One', 'Two', 'Three', 'Four', 'Five'].map((label) => ({
      ...calculator,
      componentName: `com.example.${label.toLowerCase()}/.Main`,
      packageName: `com.example.${label.toLowerCase()}`,
      label,
    }));
    const storage = createPreferencesStorage(
      JSON.stringify({
        schemaVersion: 1,
        favoritePackageNames: apps.slice(0, 4).map((app) => app.packageName),
      }),
    );
    await renderLauncher(
      createClient({ getLaunchableApps: jest.fn().mockResolvedValue(apps) }),
      storage,
    );
    await openAppDrawer();

    expect(await screen.findByText('4/4 pinned')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Pin limit reached for Five' })).toBeDisabled();

    fireEvent.press(screen.getByRole('button', { name: 'Unpin One' }));

    expect(await screen.findByRole('button', { name: 'Pin Five' })).toBeEnabled();
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

  it('opens settings through navigation without replacing launcher content', async () => {
    const onOpenSettings = jest.fn();
    const launcher = await render(
      <LauncherScreen
        client={createClient()}
        onOpenSettings={onOpenSettings}
        preferencesStorage={createPreferencesStorage()}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Open launcher settings' }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Passkey proof')).not.toBeOnTheScreen();
    expect(await screen.findByText('No pinned apps')).toBeOnTheScreen();
    await launcher.unmount();
  });

  it('refreshes pinned apps when settings update preferences', async () => {
    let value = JSON.stringify({
      schemaVersion: 1,
      favoritePackageNames: [calculator.packageName],
    });
    let notifyPreferencesChanged: () => void = () => undefined;
    const storage: LauncherPreferencesStorage = {
      read: jest.fn(async () => value),
      write: jest.fn(async (nextValue: string) => {
        value = nextValue;
        notifyPreferencesChanged();
      }),
      subscribe: jest.fn((listener: () => void) => {
        notifyPreferencesChanged = listener;
        return () => undefined;
      }),
    };
    await renderLauncher(createClient(), storage);
    expect(await screen.findByRole('button', { name: 'Open Calculator' })).toBeOnTheScreen();

    await act(() => storage.write(JSON.stringify({ schemaVersion: 1, favoritePackageNames: [] })));

    expect(await screen.findByText('No pinned apps')).toBeOnTheScreen();
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
    expect(await screen.findByRole('button', { name: 'Open Calculator' })).toBeOnTheScreen();

    await act(() => notifyAppsChanged());

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Open Calculator' })).not.toBeOnTheScreen();
      expect(screen.getByText('No pinned apps')).toBeOnTheScreen();
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
    await openAppDrawer();
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
    expect(screen.getByText('$4,045.00')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Hide financial amounts' }));

    await waitFor(() => expect(screen.queryByText('$4,045.00')).toBeNull());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeOnTheScreen();
    await openAppDrawer();
    expect(screen.getByLabelText('Search apps')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Return to Home' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open app drawer' })).toBeOnTheScreen(),
    );

    expect(await screen.findByRole('button', { name: 'Show financial amounts' })).toBeOnTheScreen();
    expect(screen.queryByText('$4,045.00')).toBeNull();
  });

  it('keeps launcher controls usable when wallet data fails', async () => {
    const client = createClient();
    const walletProvider = createWalletHomeFixtureProvider({
      ...failedWalletHomeFixture,
      message: 'Wallet unavailable',
    });
    await render(
      <LauncherScreen
        client={client}
        homeContent={<WalletHome provider={walletProvider} />}
        preferencesStorage={createPreferencesStorage()}
      />,
    );

    expect(await screen.findByText('Wallet unavailable')).toBeOnTheScreen();
    await openAppDrawer();
    fireEvent.changeText(screen.getByLabelText('Search apps'), 'calculator');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open Calculator' })).toBeOnTheScreen(),
    );
    fireEvent.press(screen.getByRole('button', { name: 'Open Calculator' }));

    expect(client.launchApp).toHaveBeenCalledWith(calculator.componentName);
    expect(screen.getByRole('button', { name: 'Pin Calculator' })).toBeEnabled();
  });

});
