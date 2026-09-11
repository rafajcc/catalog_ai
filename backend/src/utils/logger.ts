// Simple console logger for Catalog AI with optional file logging and rotation.

import * as fs from 'fs';
import { getLogContext } from './log-context';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const DEFAULT_MAX_FILES = 5;

// Parses a byte size that may carry a unit suffix (kb, mb, gb, tb). A bare
// number is treated as bytes. Returns undefined for empty/invalid input.
export function parseByteSize(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*([kmgt]?b?)\s*$/i.exec(value);
  if (!match) return undefined;
  const num = parseFloat(match[1]);
  const unit = (match[2] || '').toLowerCase() || 'b';
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
    tb: 1024 * 1024 * 1024 * 1024
  };
  return num * (multipliers[unit] ?? 1);
}

// Parses a non-negative integer. Returns `fallback` for empty/invalid input.
export function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const num = Number(value);
  return Number.isInteger(num) && num >= 0 ? num : fallback;
}

export class Logger {
  private level: LogLevel;
  private filePath?: string;
  private maxFileSize: number;
  private maxFiles: number;

  constructor(
    level: LogLevel = 'info',
    filePath?: string,
    maxFileSize = DEFAULT_MAX_SIZE,
    maxFiles = DEFAULT_MAX_FILES
  ) {
    this.level = level;
    this.filePath = filePath;
    this.maxFileSize = maxFileSize;
    this.maxFiles = maxFiles;
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
    return LEVELS.indexOf(level) >= LEVELS.indexOf(this.level);
  }

  // Serializes a meta object without ever throwing. Some native errors (e.g.
  // the xml-js parse errors) carry a self-referencing enumerable `note`
  // property, so a plain JSON.stringify would throw "Converting circular
  // structure to JSON" and replace the real error being reported. Circular
  // references are replaced with "[Circular]" placeholders.
  private safeStringify(meta?: Record<string, unknown>): string {
    if (!meta || Object.keys(meta).length === 0) return '';
    const seen = new WeakSet<object>();
    try {
      return JSON.stringify(meta, (_key: string, item: unknown) => {
        if (typeof item === 'object' && item !== null) {
          if (seen.has(item)) return '[Circular]';
          seen.add(item);
        }
        return item;
      });
    } catch {
      return '[Unserializable]';
    }
  }

  private format(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const context = getLogContext();
    // e.g. "[comercio=2 user=7]" right after the timestamp, so multi-tenant log
    // lines can be attributed to the comercio and user that requested them.
    const contextStr =
      context.comercioId !== undefined || context.userId !== undefined
        ? ` [comercio=${context.comercioId ?? '-'} user=${context.userId ?? '-'}]`
        : '';
    const metaStr = this.safeStringify(meta);
    return `[${timestamp}]${contextStr} ${level.toUpperCase()}: ${message}${metaStr}`;
  }

  private fileSize(): number {
    if (!this.filePath) return 0;
    try {
      return fs.statSync(this.filePath).size;
    } catch {
      return 0;
    }
  }

  // Rotates the log file once it reaches `maxFileSize`. The active file is
  // renamed to `<file>.1`, older archives shift up and at most `maxFiles`
  // archives are kept. With `maxFileSize <= 0` rotation is disabled; with
  // `maxFiles <= 0` the active file is truncated instead of archived.
  private rotateIfNeeded(): void {
    if (!this.filePath || this.maxFileSize <= 0) return;
    if (this.fileSize() < this.maxFileSize) return;

    if (this.maxFiles <= 0) {
      fs.truncateSync(this.filePath, 0);
      return;
    }
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const from = `${this.filePath}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${this.filePath}.${i + 1}`);
    }
    if (fs.existsSync(this.filePath)) fs.renameSync(this.filePath, `${this.filePath}.1`);
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
        this.rotateIfNeeded();
        fs.appendFileSync(this.filePath, line + '\n');
      } catch {
        /* fail to write/rotate log file silently */
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
const parsedMaxSize = parseByteSize(process.env.LOG_MAX_SIZE);
const parsedMaxFiles = parsePositiveInt(process.env.LOG_MAX_FILES, DEFAULT_MAX_FILES);
export const logger = new Logger(
  (process.env.LOG_LEVEL as LogLevel) || 'info',
  logFile || undefined,
  parsedMaxSize === undefined ? DEFAULT_MAX_SIZE : parsedMaxSize,
  parsedMaxFiles
);