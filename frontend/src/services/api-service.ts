// API Service Layer
// Handles all communication between the frontend and the backend

import axios, { AxiosInstance } from 'axios';
import {
  AIConfig,
  ApiResponse,
  ConfigurationResponse,
  ImportedProduct,
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

  // Auth endpoints
  async login(username: string, password: string): Promise<ApiResponse> {
    const response = await this.client.post('/auth/login', { username, password });
    return response.data;
  }

  async logout(): Promise<ApiResponse> {
    const response = await this.client.post('/auth/logout');
    return response.data;
  }

  async getMe(): Promise<ApiResponse> {
    const response = await this.client.get('/auth/me');
    return response.data;
  }

  async registerComercio(comercioName: string, adminUsername: string, adminPassword: string): Promise<ApiResponse> {
    const response = await this.client.post('/auth/register-comercio', {
      comercio_name: comercioName,
      admin_username: adminUsername,
      admin_password: adminPassword
    });
    return response.data;
  }

  // User management endpoints
  async getUsers(): Promise<ApiResponse> {
    const response = await this.client.get('/auth/users');
    return response.data;
  }

  async createUser(username: string, password: string, role: 'admin' | 'user'): Promise<ApiResponse> {
    const response = await this.client.post('/auth/users', { username, password, role });
    return response.data;
  }

  async updateUser(id: number, data: { password?: string; role?: 'admin' | 'user' }): Promise<ApiResponse> {
    const response = await this.client.put(`/auth/users/${id}`, data);
    return response.data;
  }

  async deleteUser(id: number): Promise<ApiResponse> {
    const response = await this.client.delete(`/auth/users/${id}`);
    return response.data;
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

  // System default AI prompt in every supported language, so the config panel
  // can show the default value (read-only) when the user opts to use it.
  async getDefaultPrompt(): Promise<{ success: boolean; data: Record<string, string> }> {
    const response = await this.client.get('/config/default-prompt');
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

  // Asks the selected AI provider to propose values for the empty text fields of
  // one imported product. The UI language picks which default prompt is used.
  async autocompleteProduct(product: ImportedProduct, language?: string): Promise<ApiResponse> {
    const response = await this.client.post('/autocomplete', { product, language });
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
