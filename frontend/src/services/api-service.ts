// API Service Layer
// Handles all communication between the frontend and the backend

import axios, { AxiosInstance } from 'axios';
import {
  AIConfig,
  ApiResponse,
  ConfigurationResponse,
  PrestaShopConfig,
  PrestaShopFetchRequest,
  ProductEdits
} from '../types';

export type ConfigurationUpdate = Partial<Omit<ConfigurationResponse, 'prestashop' | 'ai'>> & {
  prestashop?: Partial<PrestaShopConfig>;
  ai?: Partial<AIConfig>;
};

export class ApiService {
  readonly baseURL: string;
  private client: AxiosInstance;

  constructor(baseURL = '/api') {
    this.baseURL = baseURL;
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('auth_token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('auth_token');
          window.location.href = '/login';
        }

        if (error.response?.status >= 500) {
          console.error('Server error:', error.response.data);
        }

        return Promise.reject(error);
      }
    );
  }

  // Health check
  async healthCheck(): Promise<ApiResponse> {
    const response = await this.client.get('/health');
    return response.data;
  }

  // Configuration endpoints
  async getConfiguration(): Promise<ConfigurationResponse> {
    const response = await this.client.get('/config');
    return response.data;
  }

  async updateConfiguration(config: ConfigurationUpdate): Promise<ApiResponse> {
    const response = await this.client.put('/config', config);
    return response.data;
  }

  async testPrestashopConnection(config: PrestaShopConfig): Promise<ApiResponse> {
    const response = await this.client.post('/config/test/prestashop', config);
    return response.data;
  }

  async testAIConnection(config: AIConfig): Promise<ApiResponse> {
    const response = await this.client.post('/config/test/ai', config);
    return response.data;
  }

  // PrestaShop Webservice fetch endpoints
  async fetchPrestashopData(request: PrestaShopFetchRequest): Promise<ApiResponse> {
    const response = await this.client.post('/fetch/prestashop', request);
    return response.data;
  }

  async getPrestashopData(): Promise<ApiResponse> {
    const response = await this.client.get('/fetch/prestashop');
    return response.data;
  }

  async clearPrestashopData(): Promise<ApiResponse> {
    const response = await this.client.delete('/fetch/prestashop');
    return response.data;
  }

  // Pushes pending product edits back to PrestaShop. `updates` maps each raw
  // PrestaShop product id to the fields the user changed (only those are sent).
  async savePrestashopEdits(updates: Record<string, ProductEdits>): Promise<ApiResponse> {
    const response = await this.client.post('/fetch/prestashop/save', { updates });
    return response.data;
  }

  // Utility endpoints
  async getSystemStatus(): Promise<ApiResponse> {
    const response = await this.client.get('/status');
    return response.data;
  }

  async getLogs(level?: string, limit?: number): Promise<ApiResponse> {
    const params = new URLSearchParams();
    if (level) params.append('level', level);
    if (limit) params.append('limit', limit.toString());

    const response = await this.client.get(`/logs?${params.toString()}`);
    return response.data;
  }
}

let cachedApiService: ApiService | undefined;

export function getApiService(): ApiService {
  if (!cachedApiService) {
    cachedApiService = new ApiService();
  }
  return cachedApiService;
}
