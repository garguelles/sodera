import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { LauncherSettingsScreen } from './launcher-settings-screen';
import type { LauncherApp, LauncherClient } from '@/launcher/launcher-client';
import type { LauncherPreferencesStorage } from '@/launcher/launcher-preferences';

const apps: LauncherApp[] = ['One', 'Two', 'Three', 'Four', 'Five'].map((label) => ({
  componentName: `com.example.${label.toLowerCase()}/.Main`,
  packageName: `com.example.${label.toLowerCase()}`,
  label,
  icon: null,
}));

const client: LauncherClient = {
  getLaunchableApps: jest.fn().mockResolvedValue(apps),
  launchApp: jest.fn(),
  subscribeToAppChanges: jest.fn().mockReturnValue(() => undefined),
};

function createPreferencesStorage(initialValue: string | null): LauncherPreferencesStorage {
  let value = initialValue;
  return {
    read: jest.fn(async () => value),
    write: jest.fn(async (nextValue: string) => {
      value = nextValue;
    }),
  };
}

describe('LauncherSettingsScreen', () => {
  it('loads and clears pinned apps', async () => {
    const storage = createPreferencesStorage(
      JSON.stringify({ schemaVersion: 1, favoritePackageNames: apps.slice(0, 2).map((app) => app.packageName) }),
    );
    await render(<LauncherSettingsScreen client={client} preferencesStorage={storage} />);

    expect(await screen.findByText('2 of 4 pinned')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Clear favorite apps' }));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText('0 of 4 pinned')).toBeOnTheScreen());
    expect(JSON.parse((storage.write as jest.Mock).mock.calls[0][0]).favoritePackageNames).toEqual([]);
  });

  it('pins and unpins installed apps and enforces the four-app dock limit', async () => {
    const storage = createPreferencesStorage(JSON.stringify({
      schemaVersion: 1,
      favoritePackageNames: apps.slice(0, 4).map((app) => app.packageName),
    }));
    await render(<LauncherSettingsScreen client={client} preferencesStorage={storage} />);

    expect(await screen.findByText('4 of 4 pinned')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Pin limit reached for Five' })).toBeDisabled();

    fireEvent.press(screen.getByRole('button', { name: 'Unpin One' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pin Five' })).toBeEnabled());
    fireEvent.press(screen.getByRole('button', { name: 'Pin Five' }));

    await waitFor(() => expect(storage.write).toHaveBeenCalledTimes(2));
    expect(JSON.parse((storage.write as jest.Mock).mock.calls[1][0]).favoritePackageNames).toEqual(
      apps.slice(1).map((app) => app.packageName),
    );
  });
});
