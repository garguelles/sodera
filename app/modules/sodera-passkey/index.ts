// Re-export the native module. On web, it will be resolved to SoderaPasskeyModule.web.ts
// and on native platforms to SoderaPasskeyModule.ts
export { default } from './src/SoderaPasskeyModule';
export * from './src/SoderaPasskey.types';
