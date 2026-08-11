import { AppError, ErrorHandler } from '../backend/src/utils/error-handler';
import { logger } from '../backend/src/utils/logger';

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: any) => body);
  return res;
}

describe('AppError', () => {
  it('defaults to a 500 status code', () => {
    const error = new AppError('boom');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe('AppError');
    expect(error.message).toBe('boom');
    expect(error.statusCode).toBe(500);
  });

  it('stores a custom status code and details', () => {
    const error = new AppError('not found', 404, { id: 1 });

    expect(error.statusCode).toBe(404);
    expect(error.details).toEqual({ id: 1 });
  });
});

describe('ErrorHandler', () => {
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    ErrorHandler.setup(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('notFound', () => {
    it('passes a 404 AppError to next', () => {
      const next = jest.fn();
      const req: any = { method: 'GET', originalUrl: '/missing' };

      ErrorHandler.notFound(req, mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0][0];
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Route not found: GET /missing');
    });
  });

  describe('handle', () => {
    it('responds with 500 for generic errors', () => {
      const res = mockRes();
      const next = jest.fn();
      const req: any = {};

      ErrorHandler.handle(new Error('boom'), req, res, next);

      expect(errorSpy).toHaveBeenCalledWith('Unhandled error', expect.any(Object));
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { message: 'boom', statusCode: 500, details: undefined }
      });
    });

    it('falls back to a default message when the error has none', () => {
      const res = mockRes();
      const req: any = {};

      ErrorHandler.handle({}, req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { message: 'Internal server error', statusCode: 500, details: undefined }
      });
    });

    it('responds with the error status code for client errors', () => {
      const res = mockRes();
      const req: any = {};

      ErrorHandler.handle(new AppError('missing product', 404, { product_id: 7 }), req, res, jest.fn());

      expect(warnSpy).toHaveBeenCalledWith('Request error', expect.objectContaining({ statusCode: 404 }));
      expect(errorSpy).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { message: 'missing product', statusCode: 404, details: { product_id: 7 } }
      });
    });

    it('includes the error code when one is set', () => {
      const res = mockRes();
      const req: any = {};

      ErrorHandler.handle(new AppError('bad csv', 400, { columns: 2 }, 'CSV_COLUMN_COUNT_MISMATCH'), req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          message: 'bad csv',
          statusCode: 400,
          details: { columns: 2 },
          code: 'CSV_COLUMN_COUNT_MISMATCH'
        }
      });
    });

    it('includes the stack in the response in development mode', () => {
      ErrorHandler.setup(true);
      const res = mockRes();
      const req: any = {};

      ErrorHandler.handle(new AppError('boom', 500), req, res, jest.fn());

      const payload = res.json.mock.calls[0][0];
      expect(payload.error.stack).toBeDefined();
    });

    it('omits the stack in production mode', () => {
      const res = mockRes();
      const req: any = {};

      ErrorHandler.handle(new AppError('boom', 500), req, res, jest.fn());

      const payload = res.json.mock.calls[0][0];
      expect(payload.error.stack).toBeUndefined();
    });
  });
});
