import SoderaPasskey from '../../modules/sodera-passkey';

import type { PasskeyNativeAdapter } from './passkey-ceremony';

export const passkeyNativeAdapter: PasskeyNativeAdapter = {
  createCredential: (requestJson) => SoderaPasskey.createCredentialAsync(requestJson),
  getCredential: (requestJson) => SoderaPasskey.getCredentialAsync(requestJson),
  readRegistrationJournal: () => SoderaPasskey.readRegistrationJournalAsync(),
  async clearRegistrationJournal() {
    if (!(await SoderaPasskey.clearRegistrationJournalAsync())) {
      throw new Error('Could not clear the Primary Passkey registration journal');
    }
  },
  cancel: () => SoderaPasskey.cancelPendingOperation(),
};
