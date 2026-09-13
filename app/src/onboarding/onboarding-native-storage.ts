import SoderaPasskey from '../../modules/sodera-passkey';

import type { OnboardingProfileStorage } from './onboarding';

export const onboardingNativeStorage: OnboardingProfileStorage = {
  read: () => SoderaPasskey.readOnboardingProfileAsync(),
  async write(value) {
    if (!(await SoderaPasskey.writeOnboardingProfileAsync(value))) {
      throw new Error('Could not persist onboarding profile');
    }
  },
};
