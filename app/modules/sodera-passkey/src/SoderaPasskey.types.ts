export type PasskeyErrorKind =
  | 'canceled'
  | 'noCredential'
  | 'noCreateOption'
  | 'providerConfiguration'
  | 'unsupported'
  | 'interrupted'
  | 'domError'
  | 'unknown';

export type NativePasskeyResult =
  | { status: 'success'; responseJson: string }
  | {
      status: 'error';
      error: {
        kind: PasskeyErrorKind;
        type?: string;
        domError?: string;
      };
    };
