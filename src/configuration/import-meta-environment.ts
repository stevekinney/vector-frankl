type EnvironmentVariables = Record<string, string | undefined>;

/** Returns Vite-style import.meta.env when present (ESM/browser builds). */
export function getImportMetaEnvironmentVariables(): EnvironmentVariables | undefined {
  return (import.meta as ImportMeta & { env?: EnvironmentVariables }).env;
}
