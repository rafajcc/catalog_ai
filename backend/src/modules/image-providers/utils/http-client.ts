// Shared HTTP helpers for the image provider services. Every call ships the
// browser-like User-Agent string (some results depend on it) and reads the
// status codes itself instead of throwing on non-2xx, so each provider can
// translate its own error codes. Ported from the GetImages proof of concept.

import axios, { AxiosRequestConfig } from 'axios';
import { ProviderError } from '../types';

export const IMAGE_PROVIDER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CatalogAI/1.0';

// Default request timeout in seconds. Some providers (Apify, Bright Data,
// ScraperAPI, ...) raise it explicitly when scraping a whole SERP takes long.
export const DEFAULT_IMAGE_PROVIDER_TIMEOUT_S = 15;

export interface HttpResponse {
  status: number;
  // Raw body. JSON responses are ALSO available parsed in `data`.
  text: string;
  data: any;
}

export interface HttpOptions {
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  data?: unknown;
  auth?: { username: string; password: string };
  timeoutS?: number;
}

async function request(method: 'GET' | 'POST', url: string, options: HttpOptions = {}): Promise<HttpResponse> {
  const config: AxiosRequestConfig = {
    method,
    url,
    headers: { 'User-Agent': IMAGE_PROVIDER_USER_AGENT },
    params: options.params,
    data: options.data,
    auth: options.auth,
    timeout: (options.timeoutS ?? DEFAULT_IMAGE_PROVIDER_TIMEOUT_S) * 1000,
    // The providers read and translate the status codes themselves, so a 4xx/5xx
    // response is NOT thrown by axios.
    validateStatus: () => true
  };
  if (options.headers) {
    config.headers = { ...config.headers, ...options.headers };
  }

  let response;
  try {
    response = await axios.request(config);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ProviderError(`Error de red al contactar ${method} ${url}: ${reason}`);
  }

  const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? null);
  let data: any = response.data;
  if (typeof response.data === 'string') {
    try {
      data = JSON.parse(response.data);
    } catch {
      data = undefined;
    }
  }
  return { status: response.status, text, data };
}

export function httpGet(url: string, options: HttpOptions = {}): Promise<HttpResponse> {
  return request('GET', url, options);
}

export function httpPost(url: string, options: HttpOptions = {}): Promise<HttpResponse> {
  return request('POST', url, options);
}