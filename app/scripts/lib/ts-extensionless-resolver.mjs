// Lets verification scripts import app TypeScript modules that use extensionless relative imports.
// The Uniswap SDKs' ESM builds are bundler-only (extensionless imports, unattributed JSON), so Node
// loads their CommonJS builds instead.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@uniswap/')) {
    return nextResolve(specifier, { ...context, conditions: ['node', 'require', 'default'] });
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith('.') || !context.parentURL?.endsWith('.ts')) throw error;
    return nextResolve(`${specifier}.ts`, context);
  }
}
