import axios, { AxiosError, AxiosInstance } from 'axios';
import { AppError } from '../../utils/error-handler';
import { ShopifyConfig } from '../../types';
import { logger } from '../../utils/logger';

export interface ShopifyGraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: any }>;
}

export interface ShopifyProductNode {
  id: string;
  title: string;
  handle: string;
  bodyHtml?: string;
  vendor?: string;
  productType?: string;
  status?: string;
  tags?: string[];
  seo?: {
    title?: string;
    description?: string;
  };
  variants?: {
    nodes: Array<{
      id: string;
      sku?: string;
      barcode?: string;
      price?: string;
      inventoryQuantity?: number;
    }>;
  };
  media?: {
    nodes: Array<{
      id: string;
      image?: {
        url?: string;
      };
    }>;
  };
}

export interface ShopifyProductsConnection {
  products: {
    pageInfo: {
      hasNextPage: boolean;
      endCursor?: string;
    };
    nodes: ShopifyProductNode[];
  };
}

const SHOPIFY_DEFAULT_TIMEOUT_MS = 30000;

export class ShopifyClient {
  private readonly http: AxiosInstance;

  constructor(private readonly config: ShopifyConfig) {
    if (!config.shop_domain || !config.access_token) {
      throw new AppError('Shopify debe estar configurado', 400);
    }
    const apiVersion = config.api_version || '2026-07';
    const baseURL = `https://${config.shop_domain}/admin/api/${apiVersion}`;
    const timeout = (config.timeout ?? SHOPIFY_DEFAULT_TIMEOUT_MS);
    this.http = axios.create({
      baseURL,
      timeout,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': config.access_token
      }
    });
    this.http.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401 || error.response?.status === 403) {
          return Promise.reject(new AppError('Clave/token de Shopify inválido o sin permisos', 400));
        }
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
          return Promise.reject(new AppError('Tiempo de espera agotado al contactar Shopify', 504));
        }
        if (error.response?.status >= 500) {
          return Promise.reject(new AppError('Error interno de Shopify', 502));
        }
        return Promise.reject(error);
      }
    );
  }

  async testConnection(): Promise<boolean> {
    try {
      const query = `
        query shopName {
          shop {
            name
          }
        }
      `;
      const res = await this.http.post<ShopifyGraphQLResponse<{ shop?: { name?: string } }>>('/graphql.json', { query });
      const body = res.data;
      if (body?.errors && body.errors.length > 0) {
        throw new AppError(body.errors[0].message, 400);
      }
      return true;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw new AppError('No se pudo conectar con Shopify', 400);
    }
  }

  async getProducts(limit: number, cursor?: string): Promise<{ nodes: ShopifyProductNode[]; hasNextPage: boolean; endCursor?: string }> {
    const first = Math.max(1, Math.min(50, limit));
    const query = `
      query getProducts($first: Int!, $after: String) {
        products(first: $first, after: $after, sortKey: ID) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            title
            handle
            bodyHtml
            vendor
            productType
            status
            tags
            seo {
              title
              description
            }
            variants(first: 5) {
              nodes {
                id
                sku
                barcode
                price
                inventoryQuantity
              }
            }
            media(first: 20) {
              nodes {
                id
                image {
                  url
                }
              }
            }
          }
        }
      }
    `;
    const variables: any = { first };
    if (cursor) variables.after = cursor;
    const res = await this.http.post<ShopifyGraphQLResponse<ShopifyProductsConnection>>('/graphql.json', { query, variables });
    const body = res.data;
    if (body?.errors && body.errors.length > 0) {
      throw new AppError(body.errors[0].message, 400);
    }
    const conn = body?.data?.products;
    return {
      nodes: conn?.nodes ?? [],
      hasNextPage: conn?.pageInfo?.hasNextPage ?? false,
      endCursor: conn?.pageInfo?.endCursor
    };
  }

  async updateProduct(productId: string, input: Record<string, any>): Promise<void> {
    const mutation = `
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    const res = await this.http.post<ShopifyGraphQLResponse<any>>('/graphql.json', { query: mutation, variables: { input } });
    const body = res.data;
    const errors = body?.errors ?? body?.data?.productUpdate?.userErrors ?? [];
    if (errors.length > 0) {
      throw new AppError(errors[0].message, 400);
    }
  }

  async fetchProductImageBuffer(url: string): Promise<Buffer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout ?? SHOPIFY_DEFAULT_TIMEOUT_MS));
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new AppError('No se pudo obtener la imagen de Shopify', 502);
      const array = await res.arrayBuffer();
      return Buffer.from(array);
    } catch (error) {
      if ((error as any).name === 'AbortError') throw new AppError('Tiempo de espera agotado al obtener la imagen', 504);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async deleteProductImage(productId: string, imageId: string): Promise<void> {
    const mutation = `
      mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
        productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
          deletedMediaIds
          userErrors {
            field
            message
          }
        }
      }
    `;
    const res = await this.http.post<ShopifyGraphQLResponse<any>>('/graphql.json', { query: mutation, variables: { productId, mediaIds: [imageId] } });
    const body = res.data;
    const errors = body?.errors ?? body?.data?.productDeleteMedia?.userErrors ?? [];
    if (errors.length > 0) {
      throw new AppError(errors[0].message, 400);
    }
  }
}
