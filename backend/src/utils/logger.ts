// Simple console logger for Catalog AI with optional file logging and
// rotation: by file size (legacy) or by calendar day (daily).

import * as fs from 'fs';
import * as path from 'path';
import { getLogContext } from './log-context';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogRotation = 'daily' | 'size' | 'off';

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

// Parses the rotation mode. Anything that is not "daily", "off", "none" or "0"
// falls back to the legacy size-based rotation.
export function parseLogRotation(value: string | undefined): LogRotation {
  const v = (value || '').trim().toLowerCase();
  if (v === 'daily') return 'daily';
  if (v === 'off' || v === 'none' || v === '0' || v === 'false') return 'off';
  return 'size';
}

// The repository root (the folder that contains the backend/ worktree). Used as
// the anchor for relative LOG_FILE / LOG_DIR values: whatever the process
// working directory is (e.g. Plesk launches the app from another folder), a
// relative `../logs/...` always resolves from the app folder itself.
const APP_ROOT = path.resolve(__dirname, '..', '..', '..');

// The active log file path resolved from LOG_FILE / LOG_DIR. An absolute
// LOG_FILE wins; otherwise the (relative) LOG_FILE is written inside LOG_DIR;
// relative LOG_DIR values resolve from the app folder (APP_ROOT). With neither
// variable set there is no file logging.
export function resolveLogFilePath(): string | undefined {
  const file = (process.env.LOG_FILE || '').trim();
  const dir = (process.env.LOG_DIR || '').trim();
  if (!file && !dir) return undefined;
  const dirPath = dir ? (path.isAbsolute(dir) ? dir : path.join(APP_ROOT, dir)) : APP_ROOT;
  const combined = file && path.isAbsolute(file) ? file : path.join(dirPath, file || 'catalog_ai.log');
  return path.resolve(combined);
}

// "YYYY-MM-DD" in the server's local time zone.
export function dayStamp(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export class Logger {
  private level: LogLevel;
  private filePath?: string;
  private maxFileSize: number;
  private maxFiles: number;
  private rotation: LogRotation;
  private currentDay?: string;
  private fileWriteWarned = false;

  constructor(
    level: LogLevel = 'info',
    filePath?: string,
    maxFileSize = DEFAULT_MAX_SIZE,
    maxFiles = DEFAULT_MAX_FILES,
    rotation: LogRotation = 'size'
  ) {
    this.level = level;
    this.filePath = filePath;
    this.maxFileSize = maxFileSize;
    this.maxFiles = maxFiles;
    this.rotation = rotation;
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
  // references are replaced with "[Circular]" placeholders. Error instances
  // are expanded to { name, message, ...own props } because their real
  // properties are non-enumerable and would otherwise be lost as `{}`.
  // The stack is deliberately omitted to keep the log line short.
  private safeStringify(meta?: Record<string, unknown>): string {
    if (!meta || Object.keys(meta).length === 0) return '';
    const seen = new WeakSet<object>();
    const serializeError = (error: Error): Record<string, unknown> => {
      const base: Record<string, unknown> = {
        name: error.name,
        message: error.message
      };
      for (const key of Object.keys(error)) {
        base[key] = (error as unknown as Record<string, unknown>)[key];
      }
      return base;
    };
    try {
      return JSON.stringify(meta, (_key: string, item: unknown) => {
        if (item instanceof Error) return serializeError(item);
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

  // Archives the active file under its current day (<file>.<YYYY-MM-DD>) the
  // first time a line is written after the calendar day changed, keeping at
  // most `maxFiles` dated archives (with `maxFiles <= 0` the file is truncated
  // instead of archived). On the first write of a fresh process the day of an
  // existing file (from its mtime) is adopted, so a process that already ran
  // over midnight rotates exactly once on its next line.
  private rotateDailyIfNeeded(): void {
    if (!this.filePath) return;
    const today = dayStamp();
    if (this.currentDay === today) return;
    if (this.currentDay === undefined) {
      try {
        this.currentDay = dayStamp(fs.statSync(this.filePath).mtime);
      } catch {
        this.currentDay = today;
      }
      if (this.currentDay === today) return;
    }
    if (this.maxFiles <= 0) {
      try {
        fs.truncateSync(this.filePath, 0);
      } catch {
        // ignore
      }
    } else {
      const archive = `${this.filePath}.${this.currentDay}`;
      if (fs.existsSync(this.filePath)) fs.renameSync(this.filePath, archive);
      this.pruneDailyArchives();
    }
    this.currentDay = today;
  }

  // Keeps only the newest `maxFiles` dated archives; older ones are removed.
  private pruneDailyArchives(): void {
    if (!this.filePath || this.maxFiles <= 0) return;
    let entries: string[];
    try {
      entries = fs.readdirSync(path.dirname(this.filePath));
    } catch {
      return;
    }
    const prefix = `${path.basename(this.filePath)}.`;
    const archives = entries
      .filter((name) => name.startsWith(prefix) && /\.\d{4}-\d{2}-\d{2}$/.test(name))
      .map((name) => path.join(path.dirname(this.filePath), name))
      .sort();
    const surplus = archives.length - this.maxFiles;
    for (let i = 0; i < surplus; i++) {
      try {
        fs.unlinkSync(archives[i]);
      } catch {
        // ignore
      }
    }
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
        // The parent directory is created on demand, so LOG_DIR (or any custom
        // LOG_FILE parent) does not have to pre-exist on the server.
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        if (this.rotation === 'daily') this.rotateDailyIfNeeded();
        else if (this.rotation === 'size') this.rotateIfNeeded();
        fs.appendFileSync(this.filePath, line + '\n');
        this.fileWriteWarned = false;
      } catch (error) {
        // Never fail the caller because of a log file problem, but do not stay
        // silent either: warn once per failure streak (until a write succeeds
        // again) so a broken LOG_FILE path is visible in the console.
        if (!this.fileWriteWarned) {
          this.fileWriteWarned = true;
          const reason = error instanceof Error ? error.message : String(error);
          console.error(
            `[${new Date().toISOString()}] ERROR: Failed to write log file at "${this.filePath}": ${reason}`
          );
        }
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

export const logFilePath = resolveLogFilePath();
const parsedMaxSize = parseByteSize(process.env.LOG_MAX_SIZE);
const parsedMaxFiles = parsePositiveInt(process.env.LOG_MAX_FILES, DEFAULT_MAX_FILES);
export const logger = new Logger(
  (process.env.LOG_LEVEL as LogLevel) || 'info',
  logFilePath,
  parsedMaxSize === undefined ? DEFAULT_MAX_SIZE : parsedMaxSize,
  parsedMaxFiles,
  parseLogRotation(process.env.LOG_ROTATION)
);