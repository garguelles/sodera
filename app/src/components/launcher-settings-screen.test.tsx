import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { LauncherSettingsScreen } from './launcher-settings-screen';
import type { LauncherPreferencesStorage } from '@/launcher/launcher-preferences';

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
      JSON.stringify({ schemaVersion: 1, favoritePackageNames: ['one', 'two'] }),
    );
    await render(<LauncherSettingsScreen preferencesStorage={storage} />);

    expect(await screen.findByText('2 of 4 pinned')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Clear favorite apps' }));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText('0 of 4 pinned')).toBeOnTheScreen());
    expect(JSON.parse((storage.write as jest.Mock).mock.calls[0][0]).favoritePackageNames).toEqual([]);
  });
});
