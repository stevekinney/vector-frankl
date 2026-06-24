import { LOG_LEVELS } from '../configuration/constants';
import { getImportMetaEnvironmentVariables } from '../configuration/import-meta-environment.js';

type LogLevel = keyof typeof LOG_LEVELS;
type LogContext = Record<string, unknown>;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
}

/**
 * Read a single raw environment variable without pulling in the zod-validated
 * environment module. Logger only needs two raw string values (NODE_ENV and
 * ENABLE_DEBUG_LOGGING); running them through the full schema would drag zod
 * into every bundle entry point via the logger → environment import chain.
 *
 * Uses the same import.meta shim that environment.ts uses, so CJS builds still
 * work correctly (the shim is already rewritten by the build plugin).
 */
function getRawEnvVar(key: string): string | undefined {
  const fromImportMeta = getImportMetaEnvironmentVariables();
  if (fromImportMeta) return fromImportMeta[key];
  try {
    if (typeof process !== 'undefined' && process.env) {
      return process.env[key];
    }
  } catch {
    // process not available in this context
  }
  return undefined;
}

export class Logger {
  private level: number;
  private readonly debugLogging: boolean;
  private readonly nodeEnv: string;

  constructor() {
    this.debugLogging = getRawEnvVar('ENABLE_DEBUG_LOGGING') === 'true';
    this.nodeEnv = getRawEnvVar('NODE_ENV') ?? 'development';
    this.level = this.debugLogging ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO;
  }

  private shouldLog(level: LogLevel): boolean {
    if (this.nodeEnv === 'test' && !this.debugLogging) {
      return false;
    }
    return LOG_LEVELS[level as keyof typeof LOG_LEVELS] <= this.level;
  }

  private formatLog(entry: LogEntry): string {
    const { timestamp, level, message, context } = entry;
    const base = `[${timestamp}] ${level}: ${message}`;

    if (!context || Object.keys(context).length === 0) {
      return base;
    }

    if (this.nodeEnv === 'production') {
      return `${base} ${JSON.stringify(context)}`;
    }

    return `${base}\n${JSON.stringify(context, null, 2)}`;
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context && { context }),
    };

    const formattedLog = this.formatLog(entry);

    switch (level) {
      case 'ERROR':
        console.error(formattedLog);
        break;
      case 'WARN':
        console.warn(formattedLog);
        break;
      default:
        console.log(formattedLog);
    }
  }

  error(message: string, context?: LogContext): void {
    this.log('ERROR', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('WARN', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('INFO', message, context);
  }

  debug(message: string, context?: LogContext): void {
    this.log('DEBUG', message, context);
  }

  success(message: string, context?: LogContext): void {
    // Log success as info level with a success prefix
    this.log('INFO', `✅ ${message}`, context);
  }

  setLevel(level: LogLevel): void {
    this.level = LOG_LEVELS[level as keyof typeof LOG_LEVELS];
  }

  time(label: string): void {
    if (this.shouldLog('DEBUG')) {
      console.time(label);
    }
  }

  timeEnd(label: string): void {
    if (this.shouldLog('DEBUG')) {
      console.timeEnd(label);
    }
  }
}

export const log = new Logger();
