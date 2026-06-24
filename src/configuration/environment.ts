import { z } from 'zod';

import { getImportMetaEnvironmentVariables } from './import-meta-environment.js';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive().max(65535))
    .prefault('3000'),
  API_TIMEOUT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive())
    .prefault('30000'),
  API_RETRY_ATTEMPTS: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive().max(10))
    .prefault('3'),
  ENABLE_DEBUG_LOGGING: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .prefault('false'),
});

export type Environment = z.infer<typeof environmentSchema>;

interface EnvironmentVariableSources {
  importMetaEnvironment?: Record<string, string | undefined>;
  processEnvironment?: Record<string, string | undefined>;
}

export function resolveEnvironmentVariables({
  importMetaEnvironment,
  processEnvironment,
}: EnvironmentVariableSources = {}): Record<string, string | undefined> {
  return importMetaEnvironment ?? processEnvironment ?? {};
}

function validateEnvironment(env?: Record<string, string | undefined>): Environment {
  // In browser environments, provide sensible defaults
  const envToValidate = env || {};

  // Add default values for browser environment
  const browserDefaults = {
    NODE_ENV: 'production',
    PORT: '3000',
    API_TIMEOUT: '30000',
    API_RETRY_ATTEMPTS: '3',
    ENABLE_DEBUG_LOGGING: 'false',
  };

  const finalEnv = { ...browserDefaults, ...envToValidate };

  try {
    return environmentSchema.parse(finalEnv);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.issues
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join('\n');
      throw new Error(`Environment validation failed:\n${errorMessage}`, {
        cause: error,
      });
    }
    throw error;
  }
}

// Safely get environment variables, handling browser context
function getEnvironmentVariables(): Record<string, string | undefined> {
  const fromImportMeta = getImportMetaEnvironmentVariables();
  if (fromImportMeta) return fromImportMeta;

  try {
    // Try process.env (Node.js/some bundlers)
    if (typeof process !== 'undefined' && process.env) {
      return process.env;
    }
  } catch {
    // Ignore errors
  }

  // Return empty object for browser environments
  return {};
}

export const environment = validateEnvironment(getEnvironmentVariables());

export function isDevelopment(): boolean {
  return environment.NODE_ENV === 'development';
}

export function isProduction(): boolean {
  return environment.NODE_ENV === 'production';
}

export function isTest(): boolean {
  return environment.NODE_ENV === 'test';
}
