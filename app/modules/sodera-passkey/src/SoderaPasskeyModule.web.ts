import { NativeModule, registerWebModule } from 'expo';

import type { NativePasskeyResult } from './SoderaPasskey.types';

class SoderaPasskeyModule extends NativeModule {
  async createCredentialAsync(): Promise<NativePasskeyResult> {
    return unsupportedResult();
  }

  async getCredentialAsync(): Promise<NativePasskeyResult> {
    return unsupportedResult();
  }

  cancelPendingOperation() {}
}

function unsupportedResult(): NativePasskeyResult {
  return { status: 'error', error: { kind: 'unsupported' } };
}

export default registerWebModule(SoderaPasskeyModule, 'SoderaPasskey');
