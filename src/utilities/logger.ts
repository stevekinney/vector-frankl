import { LOG_LEVELS } from '../configuration/constants';
import { environment, isProduction, isTest } from '../configuration/environment';

type LogLevel = keyof typeof LOG_LEVELS;
type LogContext = Record<string, unknown>;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
}

export class Logger {
  private level: number;

  constructor() {
    this.level = environment.ENABLE_DEBUG_LOGGING ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO;
  }

  private shouldLog(level: LogLevel): boolean {
    if (isTest() && !environment.ENABLE_DEBUG_LOGGING) {
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

    if (isProduction()) {
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
