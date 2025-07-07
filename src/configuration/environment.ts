import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive().max(65535))
    .default('3000'),
  API_TIMEOUT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive())
    .default('30000'),
  API_RETRY_ATTEMPTS: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive().max(10))
    .default('3'),
  ENABLE_DEBUG_LOGGING: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .default('false'),
});

export type Environment = z.infer<typeof environmentSchema>;

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
      const errorMessage = error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join('\n');
      throw new Error(`Environment validation failed:\n${errorMessage}`);
    }
    throw error;
  }
}

// Safely get environment variables, handling browser context
function getEnvironmentVariables(): Record<string, string | undefined> {
  try {
    // Try import.meta.env first (Vite/modern bundlers)
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      return import.meta.env;
    }
  } catch {
    // Ignore errors
  }

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
