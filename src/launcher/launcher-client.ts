import SoderaLauncher, {
  type LauncherApp,
} from '../../modules/sodera-launcher';

export type { LauncherApp };

export type LauncherClient = {
  getLaunchableApps(): Promise<LauncherApp[]>;
  launchApp(componentName: string): Promise<void>;
  subscribeToAppChanges(listener: () => void): () => void;
};

export const launcherClient: LauncherClient = {
  getLaunchableApps: () => SoderaLauncher.getLaunchableAppsAsync(),
  launchApp: (componentName) => SoderaLauncher.launchAppAsync(componentName),
  subscribeToAppChanges: (listener) => {
    const subscription = SoderaLauncher.addListener('onAppsChanged', listener);
    return () => subscription.remove();
  },
};
