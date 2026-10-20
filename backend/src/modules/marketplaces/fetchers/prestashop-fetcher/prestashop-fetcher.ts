// PrestaShop Fetcher Module
// Builds a working dataset (ProductData[]) directly from PrestaShop's
// Webservice as an alternative data source to uploading a CSV. Each fetched row
// is one product with product-level data:
// - references resolve to products by their product reference (not by
//   combination reference);
// - a brand narrows the pool to the products of its manufacturers;
// - without references or brand, the first products of the store are imported.
// Combinations are never expanded into their own rows: name, reference, ean,
// descriptions, images, brand, category, price and tax always come from the
// product itself. Stock is not fetched: the import is about matching the search
// criteria, not about availability, so no stock_availables request is made.

import { PrestaShopProductInfo, ProductData } from '../../../../types';
import { PrestaShopClient } from '../../clients/prestashop-client/prestashop-client';

export type PrestaShopPresenceFilter = 'with' | 'without' | 'all';

// Combines the description and images criteria: AND requires every active
// criterion to match, OR accepts products that match at least one.
export type PrestaShopFilterOperator = 'and' | 'or';

export interface PrestaShopFetchOptions {
  references?: string[];
  brand?: string;
  description?: PrestaShopPresenceFilter;
  images?: PrestaShopPresenceFilter;
  filter_operator?: PrestaShopFilterOperator;
  limit?: number;
}

export const PRESTASHOP_FETCH_LIMIT = 50;

// Product page fetched when no reference or brand is provided. The page size is
// the unit the no-criteria search walks the catalog by, one request at a time,
// until enough products pass the local description/images filter or the whole
// catalog has been read.
const PRESTASHOP_FETCH_PAGE_SIZE = 100;

// Safety ceiling for the no-criteria search: how many products are read at most
// when paging through the catalog. Real shops can hold tens of thousands of
// products, so an unbounded walk could issue hundreds of requests; this caps the
// latency while still covering small and medium catalogs exhaustively.
export const PRESTASHOP_FETCH_MAX_POOL = 5000;

// The Home root category id in a default PrestaShop install. It is assigned to
// every product, so it is never a meaningful "category" for the user.
const ROOT_CATEGORY_ID = '2';

// The maximum number of images kept per imported product row.
const MAX_PRODUCT_IMAGES = 5;

export class PrestaShopFetcher {
  private client: PrestaShopClient;

  constructor(client: PrestaShopClient) {
    this.client = client;
  }

  async fetch(options: PrestaShopFetchOptions = {}): Promise<ProductData[]> {
    const references = Array.from(
      new Set((options.references ?? []).map((reference) => reference.trim()).filter(Boolean))
    );
    const brand = options.brand?.trim() ?? '';

    // Resolve the requested brand to its manufacturer ids so the pool can be
    // narrowed at source. An empty brand means "no filter": every brand passes.
    // If brand is specified but no manufacturer matches, return empty result.
    const brandIds = brand ? await this.resolveBrandIds(brand) : new Set<string>();
    if (brand && brandIds.size === 0) {
      return [];
    }

    // 1. Gather every product of interest. Combinations are not expanded: each
    // matching product becomes a single product-level row, so the pool products
    // (fetched with display=full) already carry all the fields we need.
    // References and brands are unique/narrow enough to fit a single request;
    // when both are present the brand is pushed into the same query so the
    // server already narrows by manufacturer (the local brand check then only
    // guards against a shop ignoring the combined filter).
    // Without either, the description/images filters cannot run on the server,
    // so the catalog is walked page by page through fetchMatchingPages() until
    // enough products pass (PRESTASHOP_FETCH_LIMIT) or the catalog is exhausted
    // (bounded by PRESTASHOP_FETCH_MAX_POOL).
    const limit = Math.min(Math.max(1, options.limit || PRESTASHOP_FETCH_LIMIT), PRESTASHOP_FETCH_LIMIT);
    const matchingProducts = references.length > 0
      ? (await this.client.fetchProductsByReference(references, Array.from(brandIds))).filter((product) => this.matches(product, options, brandIds))
      : brandIds.size > 0
        ? (await this.client.fetchProductsByManufacturer(Array.from(brandIds))).filter((product) => this.matches(product, options, brandIds))
        : await this.fetchMatchingPages(options, brandIds, limit);

    // 2. Names for the brand (manufacturer) and category ids.
    const manufacturerNames = new Map(
      (await this.client.fetchManufacturers()).map((entry) => [entry.id, entry.name])
    );
    const categoryNames = new Map((await this.client.fetchCategories()).map((entry) => [entry.id, entry.name]));

    // 3. Build the rows, honoring the limit.
    const rows: ProductData[] = [];
    for (const product of matchingProducts) {
      if (rows.length >= limit) break;
      rows.push(this.toProductData(product, manufacturerNames, categoryNames));
    }
    return rows;
  }

  // Walks the catalog page by page (no reference/brand criteria), filtering each
  // page locally, and stops once `limit` products have matched or the catalog is
  // exhausted. A page shorter than the page size means the last page was reached;
  // PRESTASHOP_FETCH_MAX_POOL caps how far the walk goes on very large catalogs.
  private async fetchMatchingPages(
    options: PrestaShopFetchOptions,
    brandIds: Set<string>,
    limit: number
  ): Promise<PrestaShopProductInfo[]> {
    const matched: PrestaShopProductInfo[] = [];
    for (let offset = 0; offset < PRESTASHOP_FETCH_MAX_POOL; offset += PRESTASHOP_FETCH_PAGE_SIZE) {
      const page = await this.client.fetchAllProducts(PRESTASHOP_FETCH_PAGE_SIZE, offset);
      for (const product of page) {
        if (this.matches(product, options, brandIds)) {
          matched.push(product);
          if (matched.length >= limit) return matched;
        }
      }
      // A short page means there is nothing left to read on the server.
      if (page.length < PRESTASHOP_FETCH_PAGE_SIZE) break;
    }
    return matched;
  }

  private async resolveBrandIds(brand: string): Promise<Set<string>> {
    const needle = brand.toLowerCase();
    const manufacturers = await this.client.fetchManufacturers();
    return new Set(
      manufacturers
        .filter((entry) => entry.name?.toLowerCase().includes(needle))
        .map((entry) => entry.id)
    );
  }

  private matches(
    product: PrestaShopProductInfo | undefined,
    options: PrestaShopFetchOptions,
    brandIds: Set<string>
  ): boolean {
    // A brand criterion is always required when set: an empty set means every
    // brand is accepted, so it contributes no constraint.
    if (brandIds.size > 0 && (!product?.manufacturer_id || !brandIds.has(product.manufacturer_id))) {
      return false;
    }

    const description = product?.description?.trim() ?? '';
    const imageCount = product?.image_count ?? 0;

    let descriptionMatches: boolean | undefined;
    if (options.description === 'with') descriptionMatches = description.length > 0;
    else if (options.description === 'without') descriptionMatches = description.length === 0;

    let imagesMatches: boolean | undefined;
    if (options.images === 'with') imagesMatches = imageCount > 0;
    else if (options.images === 'without') imagesMatches = imageCount <= 0;

    // A criterion set to 'all' contributes no constraint. The active criteria
    // are combined with the selected operator (AND by default).
    const active = [descriptionMatches, imagesMatches].filter((value): value is boolean => value !== undefined);
    if (active.length === 0) return true;
    return options.filter_operator === 'or' ? active.some(Boolean) : active.every(Boolean);
  }

  private toProductData(
    product: PrestaShopProductInfo | undefined,
    manufacturerNames: Map<string, string | undefined>,
    categoryNames: Map<string, string | undefined>
  ): ProductData {
    return {
      id: `ps_p${product?.id ?? ''}`,
      prestashop_id: product?.id,
      status: 'pending',
      source_file: 'prestashop',
      validation_errors: [],
      warnings: [],
      name: product?.name ?? '',
      reference: product?.reference,
      ean: product?.ean13,
      description: product?.description,
      description_short: product?.description_short,
      meta_title: product?.meta_title,
      meta_description: product?.meta_description,
      price: product?.price,
      wholesale_price: product?.wholesale_price,
      brand: product?.manufacturer_id ? manufacturerNames.get(product.manufacturer_id) : undefined,
      category: this.pickCategory(product, categoryNames),
      tax:
        product?.tax_rules_group_id !== undefined && product.tax_rules_group_id !== null
          ? String(product.tax_rules_group_id)
          : undefined,
      images: (product?.image_ids ?? []).slice(0, MAX_PRODUCT_IMAGES).map((id) => ({
        id,
        product_id: product?.id ?? '',
        url: `/api/fetch/prestashop/images/${product?.id ?? ''}/${id}`
      })),
      is_new: false,
      is_updated: false
    };
  }

  private pickCategory(
    product: PrestaShopProductInfo | undefined,
    categoryNames: Map<string, string | undefined>
  ): string | undefined {
    for (const id of product?.categories ?? []) {
      if (id === ROOT_CATEGORY_ID) continue;
      const name = categoryNames.get(id);
      if (name) return name;
    }
    return undefined;
  }
}
