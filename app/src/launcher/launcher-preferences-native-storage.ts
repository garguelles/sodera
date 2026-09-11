import SoderaLauncher from '../../modules/sodera-launcher';

import type { LauncherPreferencesStorage } from './launcher-preferences';

export const launcherPreferencesNativeStorage: LauncherPreferencesStorage = {
  read: () => SoderaLauncher.readLauncherPreferencesAsync(),
  async write(value) {
    if (!(await SoderaLauncher.writeLauncherPreferencesAsync(value))) {
      throw new Error('Could not persist launcher preferences');
    }
  },
};
