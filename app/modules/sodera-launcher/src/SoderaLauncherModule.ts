import { NativeModule, requireNativeModule } from 'expo';

import { LauncherApp, SoderaLauncherModuleEvents } from './SoderaLauncher.types';

declare class SoderaLauncherModule extends NativeModule<SoderaLauncherModuleEvents> {
  getLaunchableAppsAsync(): Promise<LauncherApp[]>;
  launchAppAsync(componentName: string): Promise<void>;
  isDefaultHomeAsync(): Promise<boolean>;
  requestDefaultHomeAsync(): Promise<void>;
  readLauncherPreferencesAsync(): Promise<string | null>;
  writeLauncherPreferencesAsync(value: string): Promise<boolean>;
}

export default requireNativeModule<SoderaLauncherModule>('SoderaLauncher');
