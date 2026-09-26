import { getAddress, isAddress, type Address } from 'viem';

import { ENSV2 } from '../ens/contracts.ts';

export function readIssuerMode(config: {
  mode?: string;
  controlledKernel?: string;
}): Address | undefined {
  const mode = config.mode ?? 'controlled';
  if (mode === 'controlled') {
    if (!config.controlledKernel || !isAddress(config.controlledKernel) ||
      config.controlledKernel.toLowerCase() === ENSV2.publicTestKernel.toLowerCase()) {
      throw new Error('ENS_CONTROLLED_KERNEL must be a real non-synthetic Kernel account');
    }
    return getAddress(config.controlledKernel);
  }
  if (mode === 'hackathon') {
    return undefined;
  }
  throw new Error('ENS_ISSUER_MODE must be controlled or hackathon');
}
