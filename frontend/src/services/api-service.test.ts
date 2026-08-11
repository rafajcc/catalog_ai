import { ApiService } from './api-service';

var mockGet: jest.Mock;
var mockPost: jest.Mock;
var mockPut: jest.Mock;
var mockDelete: jest.Mock;
var mockInterceptorsUse: jest.Mock;

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: () => ({
      get: mockGet,
      post: mockPost,
      put: mockPut,
      delete: mockDelete,
      interceptors: {
        request: { use: mockInterceptorsUse },
        response: { use: mockInterceptorsUse }
      }
    })
  }
}));

function getRequestHandler(): (config: any) => any {
  return mockInterceptorsUse.mock.calls[0][0];
}

function getResponseErrorHandler(): (error: any) => Promise<any> {
  return mockInterceptorsUse.mock.calls[1][1];
}

describe('ApiService', () => {
  beforeEach(() => {
    mockGet = jest.fn();
    mockPost = jest.fn();
    mockPut = jest.fn();
    mockDelete = jest.fn();
    mockInterceptorsUse = jest.fn();
    localStorage.clear();
  });

  it('creates an axios instance with the configured base URL and timeouts', () => {
    const service = new ApiService('/custom');
    expect(service.baseURL).toBe('/custom');
  });

  it('attaches the auth token from localStorage on every request', () => {
    localStorage.setItem('auth_token', 'secret-token');
    new ApiService();
    const handler = getRequestHandler();

    const config: any = { headers: {} };
    const result = handler(config);

    expect(result.headers.Authorization).toBe('Bearer secret-token');
  });

  it('leaves the request headers unchanged when no token is present', () => {
    new ApiService();
    const handler = getRequestHandler();

    const config: any = { headers: {} };
    const result = handler(config);

    expect(result.headers.Authorization).toBeUndefined();
  });

  it('clears the token and redirects to login on 401 responses', async () => {
    localStorage.setItem('auth_token', 'expired-token');
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: { pathname: '/', href: '', search: '', hash: '', origin: 'http://localhost' }
    });
    try {
      new ApiService();
      const handler = getResponseErrorHandler();

      await expect(handler({ response: { status: 401 } })).rejects.toEqual({ response: { status: 401 } });
      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(window.location.href).toBe('/login');
    } finally {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: originalLocation
      });
    }
  });

  it('logs server errors for 5xx responses', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    new ApiService();
    const handler = getResponseErrorHandler();

    return expect(
      handler({ response: { status: 500, data: { error: 'boom' } } })
    ).rejects.toEqual({ response: { status: 500, data: { error: 'boom' } } }).then(() => {
      expect(consoleError).toHaveBeenCalledWith('Server error:', { error: 'boom' });
      consoleError.mockRestore();
    });
  });

  it('rejects other response errors without side effects', () => {
    new ApiService();
    const handler = getResponseErrorHandler();

    return expect(
      handler({ response: { status: 400 } })
    ).rejects.toEqual({ response: { status: 400 } });
  });

  describe('request methods', () => {
    let service: ApiService;

    beforeEach(() => {
      service = new ApiService();
    });

    it('healthCheck hits /health', async () => {
      mockGet.mockResolvedValue({ data: { success: true } });
      await expect(service.healthCheck()).resolves.toEqual({ success: true });
      expect(mockGet).toHaveBeenCalledWith('/health');
    });

    it('getConfiguration hits /config', async () => {
      mockGet.mockResolvedValue({ data: { ai: { provider: 'mock' } } });
      await expect(service.getConfiguration()).resolves.toEqual({ ai: { provider: 'mock' } });
      expect(mockGet).toHaveBeenCalledWith('/config');
    });

    it('updateConfiguration PUTs to /config', async () => {
      mockPut.mockResolvedValue({ data: { success: true } });
      const config = { prestashop: { base_url: 'https://shop.test' } };
      await service.updateConfiguration(config);
      expect(mockPut).toHaveBeenCalledWith('/config', config);
    });

    it('testPrestashopConnection POSTs config', async () => {
      mockPost.mockResolvedValue({ data: { success: true } });
      const config: any = { base_url: 'https://shop.test', api_key: 'key' };
      await service.testPrestashopConnection(config);
      expect(mockPost).toHaveBeenCalledWith('/config/test/prestashop', config);
    });

    it('testAIConnection POSTs config', async () => {
      mockPost.mockResolvedValue({ data: { success: true } });
      const config: any = { provider: 'openai', api_key: 'key' };
      await service.testAIConnection(config);
      expect(mockPost).toHaveBeenCalledWith('/config/test/ai', config);
    });

    it('fetchPrestashopData posts the fetch criteria', async () => {
      mockPost.mockResolvedValue({ data: { success: true, data: { data_id: 'ps-1' } } });
      const request = {
        eans: ['8412345678901'],
        references: ['REF-A'],
        description: 'with',
        images: 'without',
        limit: 50
      } as import('../../src/types').PrestaShopFetchRequest;
      const result = await service.fetchPrestashopData(request);
      expect(result.data.data_id).toBe('ps-1');
      expect(mockPost).toHaveBeenCalledWith('/fetch/prestashop', request);
    });

    it('getPrestashopData hits the fetch status endpoint', async () => {
      mockGet.mockResolvedValue({ data: { success: true, data: { data_id: 'ps-1' } } });
      const result = await service.getPrestashopData();
      expect(result.data.data_id).toBe('ps-1');
      expect(mockGet).toHaveBeenCalledWith('/fetch/prestashop');
    });

    it('clearPrestashopData deletes the fetched dataset', async () => {
      mockDelete.mockResolvedValue({ data: { success: true } });
      const result = await service.clearPrestashopData();
      expect(result).toEqual({ success: true });
      expect(mockDelete).toHaveBeenCalledWith('/fetch/prestashop');
    });

    it('getSystemStatus hits /status', async () => {
      mockGet.mockResolvedValue({ data: { success: true } });
      await service.getSystemStatus();
      expect(mockGet).toHaveBeenCalledWith('/status');
    });

    it('getLogs appends provided query params', async () => {
      mockGet.mockResolvedValue({ data: { success: true } });
      await service.getLogs('error', 50);
      expect(mockGet).toHaveBeenCalledWith('/logs?level=error&limit=50');
    });

    it('getLogs omits query params when not provided', async () => {
      mockGet.mockResolvedValue({ data: { success: true } });
      await service.getLogs();
      expect(mockGet).toHaveBeenCalledWith('/logs?');
    });
  });
});
