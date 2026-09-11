import SoderaLauncher from '../../modules/sodera-launcher';

import type { LauncherPreferencesStorage } from './launcher-preferences';

const preferenceListeners = new Set<() => void>();

export const launcherPreferencesNativeStorage: LauncherPreferencesStorage = {
  read: () => SoderaLauncher.readLauncherPreferencesAsync(),
  async write(value) {
    if (!(await SoderaLauncher.writeLauncherPreferencesAsync(value))) {
      throw new Error('Could not persist launcher preferences');
    }
    preferenceListeners.forEach((listener) => listener());
  },
  subscribe(listener) {
    preferenceListeners.add(listener);
    return () => preferenceListeners.delete(listener);
  },
};
