import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Logger, parseByteSize, parsePositiveInt } from './logger';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-ai-logger-'));
}

describe('parseByteSize', () => {
  it('parses plain byte numbers', () => {
    expect(parseByteSize('1024')).toBe(1024);
    expect(parseByteSize('0')).toBe(0);
  });

  it('parses unit suffixes', () => {
    expect(parseByteSize('2kb')).toBe(2048);
    expect(parseByteSize('10mb')).toBe(10 * 1024 * 1024);
    expect(parseByteSize('1Gb')).toBe(1024 * 1024 * 1024);
    expect(parseByteSize('5 MB')).toBe(5 * 1024 * 1024);
  });

  it('rejects empty or invalid values', () => {
    expect(parseByteSize(undefined)).toBeUndefined();
    expect(parseByteSize('')).toBeUndefined();
    expect(parseByteSize('   ')).toBeUndefined();
    expect(parseByteSize('10 minutes')).toBeUndefined();
    expect(parseByteSize('abc')).toBeUndefined();
  });
});

describe('parsePositiveInt', () => {
  it('parses non-negative integers', () => {
    expect(parsePositiveInt('5', 3)).toBe(5);
    expect(parsePositiveInt('0', 3)).toBe(0);
  });

  it('falls back for invalid values', () => {
    expect(parsePositiveInt(undefined, 3)).toBe(3);
    expect(parsePositiveInt('', 3)).toBe(3);
    expect(parsePositiveInt('abc', 3)).toBe(3);
    expect(parsePositiveInt('-1', 3)).toBe(3);
    expect(parsePositiveInt('2.5', 3)).toBe(3);
  });
});

describe('Logger file output', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = makeTempDir();
    file = path.join(dir, 'app.log');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes to the log file in addition to the console', () => {
    const logger = new Logger('info', file);
    logger.info('hello');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('INFO: hello');
  });

  it('does not write levels below the configured threshold', () => {
    const logger = new Logger('warn', file);
    logger.info('subdued');
    logger.warn('visible');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toContain('subdued');
    expect(content).toContain('WARN: visible');
  });

  it('rotates the file when the size limit is exceeded and keeps max archives', () => {
    const logger = new Logger('info', file, 100, 2);

    logger.info('start');
    logger.info('BIG_MARKER' + 'x'.repeat(300)); // pushes the file over the limit
    expect(fs.statSync(file).size).toBeGreaterThan(100);

    logger.info('after-first-rotate');
    expect(fs.readFileSync(file, 'utf8')).toContain('after-first-rotate');
    expect(fs.readFileSync(`${file}.1`, 'utf8')).toContain('BIG_MARKER');

    logger.info('BIG_MARKER_2' + 'y'.repeat(300));
    logger.info('after-second-rotate');

    expect(fs.existsSync(`${file}.1`)).toBe(true);
    expect(fs.existsSync(`${file}.2`)).toBe(true);
    expect(fs.existsSync(`${file}.3`)).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toContain('after-second-rotate');
    expect(fs.readFileSync(`${file}.1`, 'utf8')).toContain('after-first-rotate');
    expect(fs.readFileSync(`${file}.2`, 'utf8')).toContain('start');
  });

  it('truncates the file instead of archiving when maxFiles is 0', () => {
    const logger = new Logger('info', file, 100, 0);
    logger.info('BIG_MARKER' + 'x'.repeat(300));
    logger.info('tail');
    expect(fs.existsSync(`${file}.1`)).toBe(false);
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toContain('BIG_MARKER');
    expect(content).toContain('tail');
  });

  it('does not rotate when maxFileSize is 0', () => {
    const logger = new Logger('info', file, 0, 2);
    logger.info('x'.repeat(1000));
    logger.info('again');
    expect(fs.existsSync(`${file}.1`)).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toContain('again');
  });

  it('fails silently when the log file cannot be written', () => {
    const bad = path.join(dir, 'missing-dir', 'nested', 'app.log');
    const logger = new Logger('info', bad);
    expect(() => logger.info('cannot write')).not.toThrow();
    expect(fs.existsSync(bad)).toBe(false);
  });
});