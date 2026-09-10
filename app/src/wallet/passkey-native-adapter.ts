import SoderaPasskey from '../../modules/sodera-passkey';

import type { PasskeyNativeAdapter } from './passkey-ceremony';

export const passkeyNativeAdapter: PasskeyNativeAdapter = {
  createCredential: (requestJson) => SoderaPasskey.createCredentialAsync(requestJson),
  getCredential: (requestJson) => SoderaPasskey.getCredentialAsync(requestJson),
  cancel: () => SoderaPasskey.cancelPendingOperation(),
};
