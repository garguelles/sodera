import SoderaLauncher from '../../modules/sodera-launcher';

export type DefaultHomeClient = {
  isDefaultHome(): Promise<boolean>;
  requestDefaultHome(): Promise<void>;
};

export const defaultHomeClient: DefaultHomeClient = {
  isDefaultHome: () => SoderaLauncher.isDefaultHomeAsync(),
  requestDefaultHome: () => SoderaLauncher.requestDefaultHomeAsync(),
};
