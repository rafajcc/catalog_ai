import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  Logger,
  dayStamp,
  parseByteSize,
  parseLogRotation,
  parsePositiveInt,
  resolveLogFilePath
} from './logger';

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

  it('creates the parent directory automatically', () => {
    const nested = path.join(dir, 'missing-dir', 'nested', 'app.log');
    const logger = new Logger('info', nested);
    expect(() => logger.info('hello')).not.toThrow();
    expect(fs.existsSync(nested)).toBe(true);
    expect(fs.readFileSync(nested, 'utf8')).toContain('INFO: hello');
  });

  it('warns on console when the log file cannot be written, without failing the caller', () => {
    // A regular file placed where the parent directory should be makes both
    // the directory creation and the append fail.
    const blocker = path.join(dir, 'blocked.log');
    fs.writeFileSync(blocker, '');
    const bad = path.join(blocker, 'nested', 'app.log');
    const logger = new Logger('info', bad);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => logger.info('cannot write')).not.toThrow();
    expect(fs.existsSync(bad)).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ERROR: Failed to write log file at')
    );
    expect(errorSpy.mock.calls[0][0]).toContain(bad);

    errorSpy.mockRestore();
  });
});

describe('daily rotation', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = makeTempDir();
    file = path.join(dir, 'app.log');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rotates the file into a dated archive when the day changes', () => {
    fs.writeFileSync(file, 'yesterday\n');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    fs.utimesSync(file, yesterday, yesterday);

    const logger = new Logger('info', file, 0, 2, 'daily');
    logger.info('today-line');

    const archive = `${file}.${dayStamp(yesterday)}`;
    expect(fs.existsSync(archive)).toBe(true);
    expect(fs.readFileSync(archive, 'utf8')).toContain('yesterday');
    expect(fs.readFileSync(file, 'utf8')).toContain('today-line');
    expect(fs.readFileSync(file, 'utf8')).not.toContain('yesterday');
  });

  it('does not rotate again within the same day', () => {
    fs.writeFileSync(file, 'old\n');
    const logger = new Logger('info', file, 0, 5, 'daily');
    logger.info('line-a');
    logger.info('line-b');
    expect(fs.readFileSync(file, 'utf8')).toContain('old');
    expect(fs.readFileSync(file, 'utf8')).toContain('line-a');
    expect(fs.readFileSync(file, 'utf8')).toContain('line-b');
  });

  it('prunes dated archives beyond the max files limit', () => {
    const now = new Date();
    const stamp = (offset: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - offset);
      return dayStamp(d);
    };
    fs.writeFileSync(`${file}.${stamp(2)}`, 'two-days-ago\n');
    fs.writeFileSync(`${file}.${stamp(1)}`, 'one-day-ago\n');
    fs.writeFileSync(file, 'three-days-ago\n');
    const threeAgo = new Date(now);
    threeAgo.setDate(threeAgo.getDate() - 3);
    fs.utimesSync(file, threeAgo, threeAgo);

    const logger = new Logger('info', file, 0, 2, 'daily');
    logger.info('today-line');

    expect(fs.existsSync(`${file}.${stamp(3)}`)).toBe(false); // oldest pruned
    expect(fs.existsSync(`${file}.${stamp(2)}`)).toBe(true);
    expect(fs.existsSync(`${file}.${stamp(1)}`)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('today-line');
  });

  it('truncates instead of archiving when maxFiles is 0', () => {
    fs.writeFileSync(file, 'yesterday\n');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    fs.utimesSync(file, yesterday, yesterday);

    const logger = new Logger('info', file, 0, 0, 'daily');
    logger.info('today-line');

    const archive = `${file}.${dayStamp(yesterday)}`;
    expect(fs.existsSync(archive)).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toContain('today-line');
    expect(fs.readFileSync(file, 'utf8')).not.toContain('yesterday');
  });
});

describe('parseLogRotation', () => {
  it('parses the supported modes', () => {
    expect(parseLogRotation('daily')).toBe('daily');
    expect(parseLogRotation('DAILY')).toBe('daily');
    expect(parseLogRotation('size')).toBe('size');
    expect(parseLogRotation('off')).toBe('off');
    expect(parseLogRotation('none')).toBe('off');
    expect(parseLogRotation('0')).toBe('off');
    expect(parseLogRotation(undefined)).toBe('size');
    expect(parseLogRotation('')).toBe('size');
    expect(parseLogRotation('bogus')).toBe('size');
  });
});

describe('resolveLogFilePath', () => {
  const previousFile = process.env.LOG_FILE;
  const previousDir = process.env.LOG_DIR;

  afterEach(() => {
    process.env.LOG_FILE = previousFile;
    process.env.LOG_DIR = previousDir;
  });

  it('returns undefined without LOG_FILE or LOG_DIR', () => {
    delete process.env.LOG_FILE;
    delete process.env.LOG_DIR;
    expect(resolveLogFilePath()).toBeUndefined();
  });

  it('resolves a relative LOG_FILE inside LOG_DIR', () => {
    delete process.env.LOG_FILE;
    process.env.LOG_DIR = path.join(someFakeRoot(), 'logs');
    expect(resolveLogFilePath()).toBe(path.join(someFakeRoot(), 'logs', 'catalog_ai.log'));
    process.env.LOG_FILE = 'app.log';
    expect(resolveLogFilePath()).toBe(path.join(someFakeRoot(), 'logs', 'app.log'));
  });

  it('keeps an absolute LOG_FILE as-is', () => {
    process.env.LOG_FILE = path.join(someFakeRoot(), 'other.log');
    process.env.LOG_DIR = path.join(someFakeRoot(), 'logs');
    expect(resolveLogFilePath()).toBe(process.env.LOG_FILE);
  });

  it('resolves a bare relative LOG_FILE from the app root', () => {
    delete process.env.LOG_DIR;
    process.env.LOG_FILE = path.join('..', 'logs', 'catalog_ai.log');
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    expect(resolveLogFilePath()).toBe(path.join(repoRoot, '..', 'logs', 'catalog_ai.log'));
  });

  function someFakeRoot(): string {
    return path.resolve('non-existent-root');
  }
});