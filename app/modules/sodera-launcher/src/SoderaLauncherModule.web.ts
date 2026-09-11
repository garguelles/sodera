import { registerWebModule, NativeModule } from 'expo';

import { SoderaLauncherModuleEvents } from './SoderaLauncher.types';

// SoderaLauncherModule is not available on the web platform.
class SoderaLauncherModule extends NativeModule<SoderaLauncherModuleEvents> {
  async getLaunchableAppsAsync() {
    return [];
  }

  async launchAppAsync() {
    throw new Error('Launching installed apps is only supported on Android');
  }

  async readLauncherPreferencesAsync() {
    return globalThis.localStorage?.getItem('sodera_launcher_preferences') ?? null;
  }

  async writeLauncherPreferencesAsync(value: string) {
    globalThis.localStorage?.setItem('sodera_launcher_preferences', value);
    return true;
  }
}

export default registerWebModule(SoderaLauncherModule, 'SoderaLauncherModule');
