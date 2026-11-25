import axios, { AxiosError, AxiosInstance } from 'axios';
import FormData from 'form-data';
import { AppError } from '../../../../utils/error-handler';
import { ShopifyConfig } from '../../../../types';

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
          // The token was revoked or lacks the granted scopes: no silent fix is
          // possible, so the UI should take the user back through the consent.
          return Promise.reject(
            new AppError('La conexión de Shopify necesita autorización', 401, undefined, 'SHOPIFY_OAUTH_REQUIRED')
          );
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
    // `media.nodes` is a Media interface (images, videos, 3D models...); `image`
    // only exists on MediaImage, so it must be selected with an inline fragment.
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
              }
            }
            media(first: 20) {
              nodes {
                id
                ... on MediaImage {
                  image {
                    url
                  }
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
    const res = await this.http.post<ShopifyGraphQLResponse<any>>('/graphql.json', {
      query: mutation,
      variables: { input: { id: productId, ...input } }
    });
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

  // Uploads an image to a product. Shopify needs three steps: reserve a staged
  // upload target, push the binary to that external URL with the signed
  // parameters, and finally attach the resulting resource as product media.
  async uploadProductImage(productId: string, imageBuffer: Buffer, contentType: string): Promise<void> {
    const mimeType = this.normalizeContentType(contentType);
    const target = await this.createStagedUpload(imageBuffer, mimeType);
    await this.uploadToStagedTarget(target, imageBuffer, mimeType);
    await this.attachProductMedia(productId, target.resourceUrl);
  }

  // Accepts the content type as sent by the browser/proxy, including data URI
  // suffixes like `image/jpeg;base64`, and returns the bare MIME type Shopify
  // validates against.
  private normalizeContentType(contentType: string): string {
    return contentType.split(';', 1)[0].trim();
  }

  private fileExtension(contentType: string): string {
    if (contentType.includes('png')) return 'png';
    if (contentType.includes('gif')) return 'gif';
    if (contentType.includes('webp')) return 'webp';
    return 'jpg';
  }

  private async createStagedUpload(
    imageBuffer: Buffer,
    contentType: string
  ): Promise<{ url: string; resourceUrl: string; filename: string; parameters: Array<{ name: string; value: string }> }> {
    const mutation = `
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    // Shopify rejects MIME types with parameters such as `image/jpeg;base64`:
    // the data URI prefix must be stripped before asking for a staged target.
    const mimeType = this.normalizeContentType(contentType);
    const filename = `image-${Date.now()}.${this.fileExtension(mimeType)}`;
    const variables = {
      input: [
        {
          resource: 'PRODUCT_IMAGE',
          filename,
          mimeType,
          fileSize: String(imageBuffer.length),
          httpMethod: 'POST'
        }
      ]
    };
    const res = await this.http.post<ShopifyGraphQLResponse<any>>('/graphql.json', { query: mutation, variables });
    const body = res.data;
    const errors = body?.errors ?? body?.data?.stagedUploadsCreate?.userErrors ?? [];
    if (errors.length > 0) {
      throw new AppError(errors[0].message, 400);
    }
    const staged = body?.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!staged?.url || !staged?.resourceUrl) {
      throw new AppError('No se pudo preparar la subida de la imagen a Shopify', 400);
    }
    return { url: staged.url, resourceUrl: staged.resourceUrl, filename, parameters: staged.parameters ?? [] };
  }

  private async uploadToStagedTarget(
    target: { url: string; filename: string; parameters: Array<{ name: string; value: string }> },
    imageBuffer: Buffer,
    contentType: string
  ): Promise<void> {
    const form = new FormData();
    // Shopify requires the signed parameters first and the file field last.
    for (const parameter of target.parameters) {
      form.append(parameter.name, parameter.value);
    }
    form.append('file', imageBuffer, { filename: target.filename, contentType });
    const headers = form.getHeaders();
    // The staged URL is an external storage endpoint, so it is uploaded without
    // the shop token or the shop base URL.
    await axios.post(target.url, form.getBuffer(), {
      headers,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
  }

  private async attachProductMedia(productId: string, originalSource: string): Promise<void> {
    const mutation = `
      mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media {
            id
          }
          mediaUserErrors {
            field
            message
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    const res = await this.http.post<ShopifyGraphQLResponse<any>>('/graphql.json', {
      query: mutation,
      variables: { productId, media: [{ originalSource, mediaContentType: 'IMAGE' }] }
    });
    const body = res.data;
    const errors =
      body?.errors ??
      body?.data?.productCreateMedia?.mediaUserErrors ??
      body?.data?.productCreateMedia?.userErrors ??
      [];
    if (errors.length > 0) {
      throw new AppError(errors[0].message, 400);
    }
  }
}
