import { NativeModule, requireNativeModule } from 'expo';

import type { NativePasskeyResult, RegistrationJournal } from './SoderaPasskey.types';

declare class SoderaPasskeyModule extends NativeModule {
  createCredentialAsync(requestJson: string): Promise<NativePasskeyResult>;
  getCredentialAsync(requestJson: string): Promise<NativePasskeyResult>;
  readRegistrationJournalAsync(): Promise<RegistrationJournal | null>;
  clearRegistrationJournalAsync(): Promise<boolean>;
  readWalletIdentityAsync(): Promise<string | null>;
  writeWalletIdentityAsync(value: string): Promise<boolean>;
  clearWalletIdentityAsync(): Promise<boolean>;
  cancelPendingOperation(): void;
}

export default requireNativeModule<SoderaPasskeyModule>('SoderaPasskey');
