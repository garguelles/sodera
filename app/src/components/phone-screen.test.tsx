import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { PhoneScreen } from './phone-screen';
import type { LauncherApp, LauncherClient } from '@/launcher/launcher-client';
import type { LauncherPreferencesStorage } from '@/launcher/launcher-preferences';

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

function renderPhone(
  client: LauncherClient,
  preferencesStorage = createPreferencesStorage(),
) {
  return render(<PhoneScreen client={client} preferencesStorage={preferencesStorage} />);
}

describe('PhoneScreen', () => {
  it('shows all apps in the list and pinned apps in the bottom dock', async () => {
    const camera = {
      ...calculator,
      componentName: 'com.android.camera/.Camera',
      packageName: 'com.android.camera',
      label: 'Camera',
    };
    const storage = createPreferencesStorage(
      JSON.stringify({ schemaVersion: 1, favoritePackageNames: [calculator.packageName] }),
    );
    await renderPhone(
      createClient({ getLaunchableApps: jest.fn().mockResolvedValue([calculator, camera]) }),
      storage,
    );

    expect(await screen.findAllByRole('button', { name: 'Open Calculator' })).toHaveLength(2);
    expect(await screen.findByRole('button', { name: 'Open Camera' })).toBeOnTheScreen();
    expect(screen.queryByText('FAVORITES')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Unpin Calculator' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Pin Camera' })).not.toBeOnTheScreen();
    expect(screen.queryByText('Search includes pinned apps')).not.toBeOnTheScreen();
    expect(screen.getByLabelText('Search apps')).toBeOnTheScreen();

    fireEvent.changeText(screen.getByLabelText('Search apps'), 'calc');
    await waitFor(() => {
      expect(screen.getByText('1 of 2 apps')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Open Calculator' })).toBeOnTheScreen();
      expect(screen.queryByText('Calculator')).toBeOnTheScreen();
    });
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
    await renderPhone(client);

    expect(screen.getByText('Loading apps...')).toBeOnTheScreen();
    await act(() => resolveApps([calculator]));
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
    await renderPhone(client);
    await screen.findByText('Calculator');

    await act(() => notifyAppsChanged());

    expect(await screen.findByText('Camera')).toBeOnTheScreen();
    expect(screen.queryByText('Calculator')).not.toBeOnTheScreen();
  });

  it('keeps Phone usable when an app disappears before launch', async () => {
    const client = createClient({
      launchApp: jest.fn().mockRejectedValue(new Error('App is no longer available')),
    });
    await renderPhone(client);

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
    await renderPhone(client);

    const retryButton = await screen.findByRole('button', { name: 'Retry' });
    fireEvent.press(retryButton);
    await waitFor(() => expect(getLaunchableApps).toHaveBeenCalledTimes(2));

    expect(await screen.findByText('Calculator')).toBeOnTheScreen();
  });

  it('filters apps by label and displays an empty search result', async () => {
    const camera = {
      ...calculator,
      componentName: 'com.android.camera/.Camera',
      packageName: 'com.android.camera',
      label: 'Camera',
    };
    await renderPhone(createClient({ getLaunchableApps: jest.fn().mockResolvedValue([calculator, camera]) }));
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
    await renderPhone(client, storage);

    const calculatorButtons = await screen.findAllByRole('button', { name: 'Open Calculator Pro' });
    fireEvent.press(calculatorButtons[0]);

    expect(client.launchApp).toHaveBeenCalledWith(updatedCalculator.componentName);
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
    await renderPhone(createClient(), storage);
    expect(await screen.findAllByRole('button', { name: 'Open Calculator' })).toHaveLength(2);

    await act(() => storage.write(JSON.stringify({ schemaVersion: 1, favoritePackageNames: [] })));

    expect(await screen.findByText('Pin apps in Settings for quick access.')).toBeOnTheScreen();
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
    await renderPhone(client, storage);
    expect(await screen.findAllByRole('button', { name: 'Open Calculator' })).toHaveLength(2);

    await act(() => notifyAppsChanged());

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Open Calculator' })).not.toBeOnTheScreen();
      expect(screen.getByText('Pin apps in Settings for quick access.')).toBeOnTheScreen();
    });
  });

  it('keeps discovered apps usable when preference storage fails', async () => {
    const storage: LauncherPreferencesStorage = {
      read: jest.fn().mockRejectedValue(new Error('Preferences unavailable')),
      write: jest.fn().mockRejectedValue(new Error('Preferences unavailable')),
    };
    const client = createClient();
    await renderPhone(client, storage);

    expect(await screen.findByText('Preferences unavailable')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Open Calculator' }));

    expect(client.launchApp).toHaveBeenCalledWith(calculator.componentName);
  });

});
