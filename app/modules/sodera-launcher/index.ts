// Re-export the native module. On web, it will be resolved to SoderaLauncherModule.web.ts
// and on native platforms to SoderaLauncherModule.ts
export { default } from './src/SoderaLauncherModule';
export * from './src/SoderaLauncher.types';
