import { NativeModule, registerWebModule } from 'expo';

import type { NativePasskeyResult, RegistrationJournal } from './SoderaPasskey.types';

let registrationJournal: RegistrationJournal | null = null;
let walletIdentity: string | null = null;

class SoderaPasskeyModule extends NativeModule {
  async createCredentialAsync(): Promise<NativePasskeyResult> {
    return unsupportedResult();
  }

  async getCredentialAsync(): Promise<NativePasskeyResult> {
    return unsupportedResult();
  }

  async readRegistrationJournalAsync() {
    return registrationJournal;
  }

  async clearRegistrationJournalAsync() {
    registrationJournal = null;
    return true;
  }

  async readWalletIdentityAsync() {
    return walletIdentity;
  }

  async writeWalletIdentityAsync(value: string) {
    walletIdentity = value;
    return true;
  }

  async clearWalletIdentityAsync() {
    walletIdentity = null;
    return true;
  }

  cancelPendingOperation() {}
}

function unsupportedResult(): NativePasskeyResult {
  return { status: 'error', error: { kind: 'unsupported' } };
}

export default registerWebModule(SoderaPasskeyModule, 'SoderaPasskey');
