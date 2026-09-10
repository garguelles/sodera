import { readKernelExecutionConfig } from './kernel-passkey-execution';

const originalExecutionRpc = process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL;
const originalBundlerRpc = process.env.EXPO_PUBLIC_ZERODEV_SEPOLIA_BUNDLER_RPC;

afterEach(() => {
  process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL = originalExecutionRpc;
  process.env.EXPO_PUBLIC_ZERODEV_SEPOLIA_BUNDLER_RPC = originalBundlerRpc;
});

describe('Kernel passkey execution configuration', () => {
  it('requires both explicit mobile RPC URLs', () => {
    delete process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL;
    delete process.env.EXPO_PUBLIC_ZERODEV_SEPOLIA_BUNDLER_RPC;

    expect(readKernelExecutionConfig).toThrow(
      'EXPO_PUBLIC_SEPOLIA_RPC_URL and EXPO_PUBLIC_ZERODEV_SEPOLIA_BUNDLER_RPC are required',
    );
  });

  it('does not collapse execution and Bundler roles into one endpoint', () => {
    process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL = 'https://rpc.example';
    process.env.EXPO_PUBLIC_ZERODEV_SEPOLIA_BUNDLER_RPC = 'https://rpc.example';

    expect(readKernelExecutionConfig).toThrow(
      'Execution and ZeroDev Bundler RPC URLs must be configured separately',
    );
  });

  it('rejects non-HTTPS mobile RPC configuration', () => {
    process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL = 'http://rpc.example';
    process.env.EXPO_PUBLIC_ZERODEV_SEPOLIA_BUNDLER_RPC = 'https://rpc.zerodev.app/api/v3/test';

    expect(readKernelExecutionConfig).toThrow('Kernel execution RPC URLs must use HTTPS');
  });

  it('returns the two explicit HTTPS endpoints', () => {
    process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL = 'https://rpc.example';
    process.env.EXPO_PUBLIC_ZERODEV_SEPOLIA_BUNDLER_RPC = 'https://rpc.zerodev.app/api/v3/test';

    expect(readKernelExecutionConfig()).toEqual({
      executionRpcUrl: 'https://rpc.example',
      bundlerRpcUrl: 'https://rpc.zerodev.app/api/v3/test',
    });
  });

  it('rejects an alternative Bundler provider', () => {
    process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL = 'https://rpc.example';
    process.env.EXPO_PUBLIC_ZERODEV_SEPOLIA_BUNDLER_RPC = 'https://bundler.example';

    expect(readKernelExecutionConfig).toThrow(
      'The Bundler must use the verified ZeroDev-hosted endpoint',
    );
  });
});
