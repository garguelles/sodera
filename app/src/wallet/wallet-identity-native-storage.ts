import SoderaPasskey from '../../modules/sodera-passkey';

import type { WalletIdentityStorage } from './wallet-identity';

export const walletIdentityNativeStorage: WalletIdentityStorage & { readOnboardingProfile(): Promise<string | null> } = {
  read: () => SoderaPasskey.readWalletIdentityAsync(),
  readOnboardingProfile: () => SoderaPasskey.readOnboardingProfileAsync(),
  async write(value) {
    if (!(await SoderaPasskey.writeWalletIdentityAsync(value))) {
      throw new Error('Could not persist Wallet Identity metadata');
    }
  },
  async clear() {
    if (!(await SoderaPasskey.clearWalletIdentityAsync())) {
      throw new Error('Could not clear incomplete Wallet Identity metadata');
    }
  },
};
