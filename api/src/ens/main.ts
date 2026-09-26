import { createEnsApp } from './app.ts';
import { createSepoliaEnsLookup } from './chain.ts';

export function createEnsService() {
  return createEnsApp(createSepoliaEnsLookup());
}
