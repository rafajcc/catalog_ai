// Simple console logger for Catalog AI

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private level: LogLevel;
  private filePath?: string;

  constructor(level: LogLevel = 'info', filePath?: string) {
    this.level = level;
    this.filePath = filePath;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  setLogFile(filePath: string): void {
    this.filePath = filePath;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private format(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const line = this.format(level, message, meta);
    switch (level) {
      case 'debug': console.debug(line); break;
      case 'info': console.log(line); break;
      case 'warn': console.warn(line); break;
      case 'error': console.error(line); break;
    }
    if (this.filePath) {
      try {
        const fs = require('fs');
        fs.appendFileSync(this.filePath, line + '\n');
      } catch {
        /* fail to write log file silently */
      }
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) this.write('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('info')) this.write('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) this.write('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('error')) this.write('error', message, meta);
  }
}

const logFile = (process.env.LOG_FILE || '').trim();
export const logger = new Logger(
  (process.env.LOG_LEVEL as LogLevel) || 'info',
  logFile || undefined
);
