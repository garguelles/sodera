import { NativeModule, requireNativeModule } from 'expo';

import { LauncherApp, SoderaLauncherModuleEvents } from './SoderaLauncher.types';

declare class SoderaLauncherModule extends NativeModule<SoderaLauncherModuleEvents> {
  getLaunchableAppsAsync(): Promise<LauncherApp[]>;
  launchAppAsync(componentName: string): Promise<void>;
}

export default requireNativeModule<SoderaLauncherModule>('SoderaLauncher');
