import { Logger } from '../backend/src/utils/logger';

describe('Logger', () => {
  let logSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Level management', () => {
    it('defaults to info level', () => {
      expect(new Logger().getLevel()).toBe('info');
    });

    it('honors the level passed to the constructor', () => {
      expect(new Logger('error').getLevel()).toBe('error');
    });

    it('setLevel updates the current level', () => {
      const logger = new Logger('info');

      logger.setLevel('debug');

      expect(logger.getLevel()).toBe('debug');
    });
  });

  describe('Log filtering', () => {
    it('logs info at the default level', () => {
      new Logger().info('hello');

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toContain('INFO: hello');
    });

    it('suppresses debug at info level', () => {
      const logger = new Logger('info');

      logger.debug('secret details');

      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('emits debug at debug level', () => {
      const logger = new Logger('debug');

      logger.debug('secret details');

      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(debugSpy.mock.calls[0][0]).toContain('DEBUG: secret details');
    });

    it('suppresses info, warn and debug at error level', () => {
      const logger = new Logger('error');

      logger.info('info');
      logger.warn('warn');
      logger.debug('debug');
      logger.error('fatal');

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(debugSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toContain('ERROR: fatal');
    });
  });

  describe('Formatting', () => {
    it('includes serialized metadata when provided', () => {
      new Logger().info('created', { id: 42, ok: true });

      const output = logSpy.mock.calls[0][0];
      expect(output).toContain('INFO: created');
      expect(output).toContain('{"id":42,"ok":true}');
    });

    it('omits metadata when empty', () => {
      new Logger().info('no meta', {});

      const output = logSpy.mock.calls[0][0];
      expect(output).toEqual(expect.stringContaining('INFO: no meta'));
      expect(output.endsWith('INFO: no meta')).toBe(true);
    });

    it('omits metadata when not provided', () => {
      new Logger().warn('plain warning');

      expect(warnSpy.mock.calls[0][0].endsWith('WARN: plain warning')).toBe(true);
    });
  });
});
