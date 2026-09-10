import { NativeModule, requireNativeModule } from 'expo';

import type { NativePasskeyResult } from './SoderaPasskey.types';

declare class SoderaPasskeyModule extends NativeModule {
  createCredentialAsync(requestJson: string): Promise<NativePasskeyResult>;
  getCredentialAsync(requestJson: string): Promise<NativePasskeyResult>;
  cancelPendingOperation(): void;
}

export default requireNativeModule<SoderaPasskeyModule>('SoderaPasskey');
