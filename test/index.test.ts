jest.mock('../backend/src/app', () => ({
  __esModule: true,
  default: jest.fn()
}));

jest.mock('../backend/src/modules/auth', () => ({
  __esModule: true,
  findUserByUsername: jest.fn(),
  createUser: jest.fn(),
  hashPassword: jest.fn().mockResolvedValue('hashed-password')
}));

jest.mock('../backend/src/utils/logger', () => ({
  logger: {
    setLevel: jest.fn(),
    getLevel: jest.fn(() => 'info'),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../backend/src/utils/error-handler', () => ({
  AppError: jest.fn(),
  ErrorHandler: { setup: jest.fn() }
}));

const path = require('path');

const expectedDataDir = path.join(path.dirname(require.resolve('../backend/src/index')), '..');

interface IndexMocks {
  createApp: jest.Mock;
  info: jest.Mock;
  error: jest.Mock;
  setup: jest.Mock;
}

function loadIndex(listenImpl: (port: unknown, cb: () => void) => any): IndexMocks {
  const createAppMock = require('../backend/src/app').default as jest.Mock;
  const loggerMock = require('../backend/src/utils/logger').logger;
  const errorHandlerMock = require('../backend/src/utils/error-handler').ErrorHandler;

  createAppMock.mockReturnValue(Promise.resolve({ listen: listenImpl }));
  require('../backend/src/index');

  return {
    createApp: createAppMock,
    info: loggerMock.info,
    error: loggerMock.error,
    setup: errorHandlerMock.setup
  };
}

describe('index.ts', () => {
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    delete process.env.PORT;
    delete process.env.NODE_ENV;
  });

  const listenWithClose = (close: jest.Mock = jest.fn()) =>
    jest.fn((_port: unknown, cb: () => void) => {
      cb();
      return { close };
    });

  it('starts the server on the default port', async () => {
    const listenMock = listenWithClose();

    const mocks = loadIndex(listenMock);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.createApp).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock.mock.calls[0][0]).toBe(3000);
  });

  it('resolves the default data directory to the backend package directory', async () => {
    const listenMock = listenWithClose();

    loadIndex(listenMock);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listenMock.mock.calls.length).toBe(1);
    expect(require('../backend/src/app').default).toHaveBeenCalledWith(
      expect.objectContaining({ dataDir: expectedDataDir })
    );
  });

  it('uses the PORT environment variable when set', async () => {
    process.env.PORT = '4321';
    const listenMock = listenWithClose();

    loadIndex(listenMock);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listenMock.mock.calls[0][0]).toBe('4321');
  });

  it('logs when the server starts', async () => {
    const mocks = loadIndex(listenWithClose());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.info).toHaveBeenCalledWith('Server started on port 3000', { port: 3000 });
  });

  it('exits with code 1 when the server fails to start', async () => {
    const mocks = loadIndex(() => {
      throw new Error('EADDRINUSE');
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.error).toHaveBeenCalledWith('Failed to start server', expect.any(Object));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('shuts down gracefully on SIGTERM', async () => {
    const closeMock = jest.fn((cb: () => void) => cb());

    const mocks = loadIndex(listenWithClose(closeMock));
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.emit('SIGTERM');

    expect(closeMock).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.info).toHaveBeenCalledWith('Server closed');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('shuts down gracefully on SIGINT', async () => {
    const closeMock = jest.fn((cb: () => void) => cb());

    loadIndex(jest.fn(() => ({ close: closeMock })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.emit('SIGINT');

    expect(closeMock).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits cleanly when shutting down without an active server', async () => {
    loadIndex(jest.fn(() => undefined));
    process.emit('SIGTERM');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('configures the error handler for production by default', () => {
    const mocks = loadIndex(jest.fn(() => ({ close: jest.fn() })));

    expect(mocks.setup).toHaveBeenCalledWith(false);
  });

  it('configures the error handler for development mode', () => {
    process.env.NODE_ENV = 'development';

    const mocks = loadIndex(jest.fn(() => ({ close: jest.fn() })));

    expect(mocks.setup).toHaveBeenCalledWith(true);
  });
});
