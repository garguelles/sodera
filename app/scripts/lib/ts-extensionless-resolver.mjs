// Lets verification scripts import app TypeScript modules that use extensionless relative imports.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith('.') || !context.parentURL?.endsWith('.ts')) throw error;
    return nextResolve(`${specifier}.ts`, context);
  }
}
