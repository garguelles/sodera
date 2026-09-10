const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const isowsNativePath = path.join(path.dirname(require.resolve('isows/package.json')), '_esm/native.js');
const zeroDevSdkUtilsPath = path.join(path.dirname(require.resolve('@zerodev/sdk')), '../_esm/utils.js');

config.resolver.resolveRequest = (context, moduleName, platform) => {
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
