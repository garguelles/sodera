const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const isowsNativePath = path.join(path.dirname(require.resolve('isows/package.json')), '_esm/native.js');
const zeroDevSdkUtilsPath = path.join(path.dirname(require.resolve('@zerodev/sdk')), '../_esm/utils.js');
const viemPath = path.dirname(require.resolve('viem'));

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('ox/')) {
    // Metro otherwise selects ox's TypeScript source, whose relative .js imports are not published there.
    // Resolve from the importing module so each viem copy (the 1inch SDKs bring a newer one) gets its own ox.
    const paths = context.originModulePath.includes('/node_modules/')
      ? [path.dirname(context.originModulePath)]
      : [viemPath];
    return { filePath: require.resolve(moduleName, { paths }), type: 'sourceFile' };
  }
  if (moduleName === 'isows' && platform !== 'web') {
    return { filePath: isowsNativePath, type: 'sourceFile' };
  }
  if (
    moduleName === '@zerodev/sdk' &&
    context.originModulePath.includes('/@zerodev/passkey-validator/')
  ) {
    return { filePath: zeroDevSdkUtilsPath, type: 'sourceFile' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
