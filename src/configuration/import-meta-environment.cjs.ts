type EnvironmentVariables = Record<string, string | undefined>;

/** CommonJS builds have no import.meta; env comes from process.env in the caller. */
export function getImportMetaEnvironmentVariables(): EnvironmentVariables | undefined {
  return undefined;
}
