export type SoderaLauncherModuleEvents = {
  onAppsChanged: (event: AppsChangedEvent) => void;
};

export type AppsChangedEvent = {
  action: string | null;
  packageName: string | null;
  replacing: boolean;
};

export type LauncherApp = {
  componentName: string;
  packageName: string;
  label: string;
  icon: string | null;
};
