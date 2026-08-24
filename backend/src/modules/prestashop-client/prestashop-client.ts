// PrestaShop Client Module
// Handles all read interactions with the PrestaShop Webservice (XML over HTTP).
// Supports PrestaShop 1.7+ with proper error handling and authentication.

import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { json2xml, xml2json } from 'xml-js';
import { logger } from '../../utils/logger';
import {
  PrestaShopConfig,
  PrestaShopStockAvailable,
  PrestaShopAPIEndpoints,
  PrestaShopCombinationInfo,
  PrestaShopProductInfo,
  PrestaShopProductUpdate
} from '../../types';

export class PrestaShopClient {
  private client: AxiosInstance;
  private config: PrestaShopConfig;
  private endpoints: PrestaShopAPIEndpoints;

  constructor(config: PrestaShopConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: this.normalizeBaseUrl(config.base_url),
      timeout: config.timeout || 30000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/xml'
      }
    });

    this.endpoints = this.buildEndpoints(config.version);

    this.setupInterceptors();
  }

  private normalizeBaseUrl(url: string): string {
    // The store root works without the trailing "/api": all endpoints are
    // built relative to it (see buildEndpoints), so strip it when present.
    return url.trim().replace(/\/api\/?$/, '');
  }

  private buildEndpoints(_version: string): PrestaShopAPIEndpoints {
    const base = '/api';
    return {
      root: base,
      products: `${base}/products`,
      combinations: `${base}/combinations`,
      stock_availables: `${base}/stock_availables`,
      manufacturers: `${base}/manufacturers`,
      categories: `${base}/categories`,
      images: `${base}/images`
    };
  }

  private setupInterceptors(): void {
    this.client.interceptors.request.use(
      (config) => {
        // PrestaShop's webservice authenticates with HTTP Basic auth: the API
        // key is the username and the password is empty ("KEY:"). It does not
        // accept a Bearer token.
        const credentials = Buffer.from(`${this.config.api_key}:`).toString('base64');
        config.headers['Authorization'] = `Basic ${credentials}`;

        // Log every Webservice call so the development backend log shows the
        // requests (method, full URL and query params) sent to PrestaShop.
        const params = config.params as Record<string, unknown> | undefined;
        const query =
          params && Object.keys(params).length > 0
            ? `?${new URLSearchParams(Object.entries(params).map(([key, value]): [string, string] => [key, String(value)])).toString()}`
            : '';
        logger.info('PrestaShop API request', {
          method: (config.method ?? 'get').toUpperCase(),
          url: `${config.baseURL ?? ''}${config.url ?? ''}${query}`
        });

        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.info('PrestaShop API response', {
          status: response.status,
          url: `${response.config?.baseURL ?? ''}${response.config?.url ?? ''}`
        });
        return response;
      },
      async (error) => {
        const { response } = error;

        if (response?.status === 401) {
          logger.error('PrestaShop API authentication failed', {
            baseUrl: this.config.base_url,
            error: error.message
          });
          throw new Error('Invalid PrestaShop API key or insufficient permissions');
        }

        if (response?.status === 404) {
          logger.warn('PrestaShop resource not found', {
            url: error.config?.url,
            method: error.config?.method
          });
        }

        if (response?.status >= 500) {
          logger.error('PrestaShop server error', {
            status: response.status,
            url: error.config?.url,
            error: error.message
          });
        }

        return Promise.reject(error);
      }
    );
  }

  // -------------------------------------------------------------------------
  // Batch resolution
  // -------------------------------------------------------------------------
  // The Webservice supports OR filters (`[value1|value2|...]`) and `display=full`,
  // so many combinations/products can be fetched in a few requests instead of one
  // per EAN. Values are chunked to keep the request URL within safe limits.

  private readonly BATCH_SIZE = 100;

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  private async getResourceList(path: string, params: Record<string, any>): Promise<any> {
    const response = await this.client.get(path, { params });
    return this.parseXmlResponse(response.data)?.prestashop;
  }

  // Fetches product-level data for every product of the given manufacturer ids
  // (OR filter), including their combinations association. Used to narrow the
  // fetch pool to the products of a requested brand.
  async fetchProductsByManufacturer(ids: string[]): Promise<PrestaShopProductInfo[]> {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    const results: PrestaShopProductInfo[] = [];

    for (const batch of this.chunk(unique, this.BATCH_SIZE)) {
      const root = await this.getResourceList(this.endpoints.products, {
        'filter[id_manufacturer]': `[${batch.join('|')}]`,
        display: 'full',
        limit: 1000
      });
      const nodes = this.toArray(root?.products?.product);
      results.push(...nodes.map((node) => this.extractProductInfo(node)));
    }

    return results;
  }

  // Fetches product-level data for the given product ids.
  async fetchProductsById(ids: string[]): Promise<PrestaShopProductInfo[]> {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    const results: PrestaShopProductInfo[] = [];

    for (const batch of this.chunk(unique, this.BATCH_SIZE)) {
      const root = await this.getResourceList(this.endpoints.products, {
        'filter[id]': `[${batch.join('|')}]`,
        display: 'full',
        limit: 1000
      });
      const nodes = this.toArray(root?.products?.product);
      results.push(...nodes.map((node) => this.extractProductInfo(node)));
    }

    return results;
  }

  // Fetches product-level data for the products matching any of the given
  // references (OR filter), including their combinations association.
  async fetchProductsByReference(references: string[]): Promise<PrestaShopProductInfo[]> {
    const unique = Array.from(new Set(references.map((reference) => reference.trim()).filter(Boolean)));
    const results: PrestaShopProductInfo[] = [];

    for (const batch of this.chunk(unique, this.BATCH_SIZE)) {
      const root = await this.getResourceList(this.endpoints.products, {
        'filter[reference]': `[${batch.join('|')}]`,
        display: 'full',
        limit: 1000
      });
      const nodes = this.toArray(root?.products?.product);
      results.push(...nodes.map((node) => this.extractProductInfo(node)));
    }

    return results;
  }

  // Fetches the first `limit` products of the store (display=full), used when
  // fetching without any EAN or reference criteria.
  async fetchAllProducts(limit: number): Promise<PrestaShopProductInfo[]> {
    const root = await this.getResourceList(this.endpoints.products, {
      display: 'full',
      limit
    });
    const nodes = this.toArray(root?.products?.product);
    return nodes.map((node) => this.extractProductInfo(node));
  }

  // Fetches the combinations matching any of the given combination ids.
  async fetchCombinationsByIds(ids: string[]): Promise<PrestaShopCombinationInfo[]> {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    const results: PrestaShopCombinationInfo[] = [];

    for (const batch of this.chunk(unique, this.BATCH_SIZE)) {
      const root = await this.getResourceList(this.endpoints.combinations, {
        'filter[id]': `[${batch.join('|')}]`,
        display: 'full',
        limit: 1000
      });
      const nodes = this.toArray(root?.combinations?.combination);
      results.push(...nodes.map((node) => this.extractCombination(node)));
    }

    return results;
  }

  // Fetches every manufacturer so ids can be mapped to their localized names.
  async fetchManufacturers(): Promise<Array<{ id: string; name?: string }>> {
    const root = await this.getResourceList(this.endpoints.manufacturers, {
      display: 'full',
      limit: 1000
    });
    const nodes = this.toArray(root?.manufacturers?.manufacturer);
    return nodes
      .map((node) => ({
        id: this.extractAssociatedId(node),
        name: this.extractLocalized(node?.name, this.config.language_id)
      }))
      .filter((entry) => !!entry.id)
      .map((entry) => ({ id: entry.id as string, name: entry.name }));
  }

  // Fetches every category so ids can be mapped to their localized names.
  async fetchCategories(): Promise<Array<{ id: string; name?: string }>> {
    const root = await this.getResourceList(this.endpoints.categories, {
      display: 'full',
      limit: 1000
    });
    const nodes = this.toArray(root?.categories?.category);
    return nodes
      .map((node) => ({
        id: this.extractAssociatedId(node),
        name: this.extractLocalized(node?.name, this.config.language_id)
      }))
      .filter((entry) => !!entry.id)
      .map((entry) => ({ id: entry.id as string, name: entry.name }));
  }

  // Fetches stock quantities for the given stock_available ids.
  async fetchStockByIds(ids: string[]): Promise<Array<{ id: string; quantity?: number }>> {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    const results: Array<{ id: string; quantity?: number }> = [];

    for (const batch of this.chunk(unique, this.BATCH_SIZE)) {
      const root = await this.getResourceList(this.endpoints.stock_availables, {
        'filter[id]': `[${batch.join('|')}]`,
        display: 'full',
        limit: 1000
      });
      const nodes = this.toArray(root?.stock_availables?.stock_available);
      const entries: Array<{ id?: string; quantity?: number }> = nodes.map((node) => {
        const stock = this.extractStockAvailable(node);
        return { id: stock.id, quantity: stock.quantity };
      });
      results.push(...entries.filter((entry) => !!entry.id).map((entry) => ({ id: entry.id as string, quantity: entry.quantity })));
    }

    return results;
  }

  // Fetches the stock quantity of every product without combinations (simple
  // products have no stock_available association on the product, so the stock
  // is resolved by the product id instead).
  async fetchStockByProductIds(ids: string[]): Promise<Array<{ id_product: string; quantity?: number }>> {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    const results: Array<{ id_product: string; quantity?: number }> = [];

    for (const batch of this.chunk(unique, this.BATCH_SIZE)) {
      const root = await this.getResourceList(this.endpoints.stock_availables, {
        'filter[id_product]': `[${batch.join('|')}]`,
        display: 'full',
        limit: 1000
      });
      const nodes = this.toArray(root?.stock_availables?.stock_available);
      const entries: Array<{ id_product?: string; quantity?: number }> = nodes.map((node) => {
        const stock = this.extractStockAvailable(node);
        return { id_product: stock.id_product, quantity: stock.quantity };
      });
      results.push(
        ...entries
          .filter((entry) => !!entry.id_product)
          .map((entry) => ({ id_product: entry.id_product as string, quantity: entry.quantity }))
      );
    }

    return results;
  }

  private parseXmlResponse(xml: string): any {
    try {
      return JSON.parse(xml2json(xml, { compact: true, spaces: 2 }));
    } catch (error) {
      logger.error('XML parsing failed', { xml, error });
      throw new Error('Invalid XML response from PrestaShop');
    }
  }

  private toArray<T>(value: T | T[] | null | undefined): T[] {
    if (value === undefined || value === null) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }

  private extractText(value: any): string | undefined {
    return value?._cdata ?? value?._text;
  }

  // PrestaShop serializes ids either as XML attributes (<image id="30"/>) or as
  // child elements (<image><id><![CDATA[30]]></id></image>). Full responses use
  // the element form on every supported version (1.7+), so accept both.
  private extractAssociatedId(node: any): string | undefined {
    if (!node) return undefined;
    const attribute = node?._attributes?.id;
    if (attribute !== undefined && attribute !== null && String(attribute).trim() !== '') {
      return String(attribute);
    }
    return this.extractText(node?.id);
  }

  private toNumber(value: string | undefined): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const number = parseFloat(value);
    return isNaN(number) ? undefined : number;
  }

  // PrestaShop keeps localized fields as `<name><language id="N">...</language></name>`.
  // Picks the configured language, falling back to the first available one.
  // Some resources are plain single-language fields (e.g. manufacturer names,
  // `<name><![CDATA[Apple]]></name>`), so fall back to the raw text when there
  // is no `<language>` structure.
  private extractLocalized(node: any, languageId: number): string | undefined {
    if (!node) return undefined;
    const languages = this.toArray(node.language);
    if (languages.length === 0) return this.extractText(node);
    const found = languages.find((language) => Number(language?._attributes?.id) === languageId);
    return this.extractText(found ?? languages[0]);
  }

  private extractCombination(node: any): PrestaShopCombinationInfo {
    const stockNodes = this.toArray(node?.associations?.stock_availables?.stock_available);
    return {
      id_product_attribute: this.extractAssociatedId(node),
      id_product: this.extractText(node?.id_product) ?? '',
      reference: this.extractText(node?.reference),
      ean13: this.extractText(node?.ean13),
      price: this.toNumber(this.extractText(node?.price)),
      wholesale_price: this.toNumber(this.extractText(node?.wholesale_price)),
      stock_available_id: this.extractAssociatedId(stockNodes[0])
    };
  }

  private extractProductInfo(node: any): PrestaShopProductInfo {
    const categoryNodes = this.toArray(node?.associations?.categories?.category);
    const combinationNodes = this.toArray(node?.associations?.combinations?.combination);
    const imageNodes = this.toArray(node?.associations?.images?.image);
    return {
      id: this.extractAssociatedId(node),
      reference: this.extractText(node?.reference),
      ean13: this.extractText(node?.ean13),
      name: this.extractLocalized(node?.name, this.config.language_id),
      description: this.extractLocalized(node?.description, this.config.language_id),
      description_short: this.extractLocalized(node?.description_short, this.config.language_id),
      meta_title: this.extractLocalized(node?.meta_title, this.config.language_id),
      meta_description: this.extractLocalized(node?.meta_description, this.config.language_id),
      tax_rules_group_id: this.toNumber(this.extractText(node?.tax_rules_group_id)),
      price: this.toNumber(this.extractText(node?.price)),
      wholesale_price: this.toNumber(this.extractText(node?.wholesale_price)),
      manufacturer_id:
        this.extractText(node?.id_manufacturer) ?? this.extractAssociatedId(node?.manufacturer),
      categories: categoryNodes.map((category) => this.extractAssociatedId(category)).filter(Boolean),
      combination_ids: combinationNodes.map((combination) => this.extractAssociatedId(combination)).filter(Boolean),
      image_ids: imageNodes.map((image) => this.extractAssociatedId(image)).filter(Boolean),
      image_count: imageNodes.length
    };
  }

  private extractStockAvailable(node: any): PrestaShopStockAvailable {
    const quantity = this.extractText(node?.quantity);
    return {
      id: this.extractAssociatedId(node),
      id_product: this.extractText(node?.id_product),
      quantity: quantity !== undefined ? parseInt(quantity, 10) : undefined,
      reference: this.extractText(node?.reference)
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.client.get(this.endpoints.root);
      return response.status === 200;
    } catch (error) {
      logger.error('PrestaShop connection test failed', { error });
      return false;
    }
  }

  // Fetches a product image as raw bytes. The Webservice exposes product images
  // at `/images/products/{product_id}/{image_id}` and authenticates them with
  // the same API key, so the proxy endpoint forwards the binary untouched.
  async fetchProductImage(productId: string, imageId: string): Promise<Buffer> {
    const response = await this.client.get(`${this.endpoints.images}/products/${productId}/${imageId}`, {
      responseType: 'arraybuffer'
    });
    return Buffer.from(response.data);
  }

  // Uploads an image to a product via the Webservice. The binary content is
  // sent as multipart form data with the `image` field name.
  async uploadProductImage(productId: string, imageBuffer: Buffer, contentType: string): Promise<void> {
    const url = `${this.endpoints.images}/products/${productId}`;
    const form = new FormData();
    const ext = contentType.includes('png') ? 'png' : contentType.includes('gif') ? 'gif' : 'jpg';
    form.append('image', imageBuffer, { filename: `image.${ext}`, contentType });

    await this.client.post(url, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
  }

  // PrestaShop 8+ supports the PATCH method for partial updates (only the id and
  // the changed fields are submitted); 1.7 only accepts PUT with the complete
  // resource. The version selected in the configuration drives which method the
  // client uses, so the same save flow works on every supported shop version.
  private supportsPartialUpdates(): boolean {
    const major = Number.parseInt(this.config.version, 10);
    return !Number.isNaN(major) && major >= 8;
  }

  // Updates a product in the shop. Returns the id of the updated product.
  async updateProduct(productId: string, fields: PrestaShopProductUpdate): Promise<string> {
    return this.supportsPartialUpdates()
      ? this.patchProduct(productId, fields)
      : this.putProduct(productId, fields);
  }

  // PrestaShop 1.7 path: the Webservice PUT replaces the whole resource, so the
  // current product is fetched, the editable localized fields are overwritten on
  // it, and the complete XML is sent back.
  private async putProduct(productId: string, fields: PrestaShopProductUpdate): Promise<string> {
    // The single-resource endpoint can answer with the minimum form on some
    // shops, so the full product is fetched through the list endpoint with an id
    // filter (the same path the catalog fetch uses), which always returns the
    // complete resource including the required fields PrestaShop validates on PUT.
    const root = await this.getResourceList(this.endpoints.products, {
      'filter[id]': `[${productId}]`,
      display: 'full',
      limit: 1
    });
    const product = this.toArray(root?.products?.product)[0];
    if (!product) throw new Error(`PrestaShop product ${productId} not found`);

    if (fields.description_short !== undefined) {
      this.setLocalizedField(product, 'description_short', fields.description_short);
    }
    if (fields.description !== undefined) {
      this.setLocalizedField(product, 'description', fields.description);
    }
    if (fields.meta_title !== undefined) {
      this.setLocalizedField(product, 'meta_title', fields.meta_title);
    }
    if (fields.meta_description !== undefined) {
      this.setLocalizedField(product, 'meta_description', fields.meta_description);
    }

    // PrestaShop rejects a PUT whose entity has no non-empty <id> child (error
    // 90, "id is required when modifying a resource"). The id is forced from the
    // URL so a round-trip loss can never strip it from the rebuilt document.
    product.id = { _cdata: String(productId) };

    // The full product response also carries computed fields that the product
    // schema marks as read-only (`manufacturer_name`, `quantity`: setter =>
    // false), so the Webservice rejects them on PUT with error 93
    // ("parameter ... not writable"). They are stripped before the resource is
    // sent back.
    delete product.manufacturer_name;
    delete product.quantity;

    // The PUT body must be a complete, namespace-well-formed document.
    // PrestaShop returns every association with xlink:href attributes, so the
    // root needs the xlink namespace declaration or the shop cannot parse the
    // submitted XML and rejects the whole update.
    const rootAttributes = {
      'xmlns:xlink': 'http://www.w3.org/1999/xlink',
      ...(root?._attributes ?? {})
    };
    const payload = { prestashop: { _attributes: rootAttributes, product } };
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${json2xml(JSON.stringify(payload), {
      compact: true,
      spaces: 2
    })}`;

    return this.submitUpdate(productId, xml, 'put');
  }

  // PrestaShop 8/9 path: the Webservice PATCH updates only the submitted fields,
  // so the request carries just the id and the edited localized fields without
  // touching (or needing to preserve) the rest of the resource.
  private async patchProduct(productId: string, fields: PrestaShopProductUpdate): Promise<string> {
    const product: Record<string, unknown> = { id: { _cdata: String(productId) } };
    if (fields.description_short !== undefined) {
      product.description_short = this.buildLocalizedPatchValue(fields.description_short);
    }
    if (fields.description !== undefined) {
      product.description = this.buildLocalizedPatchValue(fields.description);
    }
    if (fields.meta_title !== undefined) {
      product.meta_title = this.buildLocalizedPatchValue(fields.meta_title);
    }
    if (fields.meta_description !== undefined) {
      product.meta_description = this.buildLocalizedPatchValue(fields.meta_description);
    }

    const payload = {
      prestashop: {
        _attributes: { 'xmlns:xlink': 'http://www.w3.org/1999/xlink' },
        product
      }
    };
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${json2xml(JSON.stringify(payload), {
      compact: true,
      spaces: 2
    })}`;

    return this.submitUpdate(productId, xml, 'patch');
  }

  // Builds the `<field><language id="N"><![CDATA[...]]></language></field>`
  // node a PATCH body needs to overwrite one localized field in the configured
  // language (the Webservice reads the language id attribute).
  private buildLocalizedPatchValue(value: string): unknown {
    return {
      language: {
        _attributes: { id: String(this.config.language_id) },
        _cdata: value
      }
    };
  }

  private async submitUpdate(productId: string, xml: string, method: 'put' | 'patch'): Promise<string> {
    const url = `${this.endpoints.products}/${productId}`;
    const headers = { 'Content-Type': 'application/xml' };
    let response: { status: number };
    try {
      response =
        method === 'patch'
          ? await this.client.patch(url, xml, { headers })
          : await this.client.put(url, xml, { headers });
    } catch (error) {
      const errorResponse = (error as { response?: { status?: number; data?: unknown } })?.response;
      // Log the exact document sent and the raw reply so a rejected update can be
      // diagnosed against the real store (the rebuilt body must carry <id>).
      logger.error('PrestaShop update rejected', {
        productId,
        method: method.toUpperCase(),
        parsedId: productId,
        status: errorResponse?.status,
        requestBody: xml,
        responseBody: typeof errorResponse?.data === 'string' ? errorResponse.data : undefined
      });
      throw new Error(this.describeUpdateError(productId, error));
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`PrestaShop rejected the update (HTTP ${response.status})`);
    }
    return productId;
  }

  // Builds a diagnostic message for a failed update: PrestaShop replies with the
  // reason in the XML error body (`<errors><error><message>...`), so surface it
  // when possible, falling back to the HTTP error text.
  private describeUpdateError(productId: string, error: unknown): string {
    const response = (error as { response?: { status?: number; data?: unknown } })?.response;
    const status = response?.status;
    if (response?.data && typeof response.data === 'string') {
      try {
        const parsed = JSON.parse(xml2json(response.data, { compact: true }));
        const messages = this.toArray(parsed?.prestashop?.errors?.error)
          .map((node) => this.extractText(node?.message))
          .filter((message): message is string => Boolean(message));
        if (messages.length > 0) {
          return `PrestaShop rejected the update of product ${productId} (HTTP ${status ?? '?'}): ${messages.join('; ')}`;
        }
      } catch {
        // ignore malformed error bodies and fall through to the generic message
      }
    }
    const detail = error instanceof Error ? `: ${error.message}` : '';
    return `PrestaShop rejected the update of product ${productId}${detail}`;
  }

  // Overwrites one localized field on a parsed product node, keeping the rest of
  // the resource untouched so the PUT re-sends a complete, valid product. Writes
  // into the configured language, falling back to the first one available.
  private setLocalizedField(node: any, field: string, value: string): void {
    const current = node?.[field];
    if (!current) return;
    const languages = this.toArray(current.language);
    if (languages.length === 0) {
      current._cdata = value;
      return;
    }
    const language =
      languages.find((entry) => Number(entry?._attributes?.id) === this.config.language_id) ?? languages[0];
    if (!language) {
      current.language = { _attributes: { id: String(this.config.language_id) }, _cdata: value };
      return;
    }
    language._cdata = value;
  }
}
