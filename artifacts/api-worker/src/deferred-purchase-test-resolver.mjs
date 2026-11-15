// This resolver is used ONLY by CI's Node 22 --experimental-strip-types
// integration tests. It mirrors bundler resolution of extensionless TS
// imports in the workspace, without changing production source imports.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND" ||
        (!specifier.startsWith("./") && !specifier.startsWith("../")) ||
        /\.(?:ts|mts|cts|js|mjs|cjs|json)$/.test(specifier)) {
      throw error;
    }
    return nextResolve(specifier + ".ts", context);
  }
}
