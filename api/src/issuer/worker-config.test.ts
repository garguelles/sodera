import { describe, expect, it } from 'vitest';

import { ENSV2 } from '../ens/contracts.ts';
import { readIssuerMode } from './worker-config.ts';

describe('private issuer mode', () => {
  it('accepts one named real Kernel for a controlled claim', () => {
    expect(readIssuerMode({ controlledKernel: '0x1111111111111111111111111111111111111111' }))
      .toBe('0x1111111111111111111111111111111111111111');
    expect(() => readIssuerMode({ controlledKernel: ENSV2.publicTestKernel })).toThrow();
  });

  it('accepts successive verified Kernels in an explicitly selected hackathon worker', () => {
    expect(readIssuerMode({ mode: 'hackathon' })).toBeUndefined();
    expect(() => readIssuerMode({ mode: 'local-demo' })).toThrow('controlled or hackathon');
  });
});
