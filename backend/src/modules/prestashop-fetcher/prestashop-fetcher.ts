// PrestaShop Fetcher Module
// Builds a working dataset (ProductData[]) directly from PrestaShop's
// Webservice as an alternative data source to uploading a CSV. Each fetched row
// is one variant:
// - references resolve to products whose combinations are then fetched by id;
// - a brand narrows the pool to the products of its manufacturers;
// - without references or brand, the first products of the store are imported.
// A product without combinations produces a single product-level row (price,
// stock and reference come from the product itself), while a product with
// combinations produces one row per combination (price and stock come from the
// combination). Product-level values (name, descriptions, brand, category, tax)
// always come from the parent product.

import {
  PrestaShopCombinationInfo,
  PrestaShopProductInfo,
  ProductData
} from '../../types';
import { PrestaShopClient } from '../prestashop-client/prestashop-client';

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

// Product pool fetched when no reference or brand is provided: it bounds the
// request while leaving headroom for the description/images filters to discard
// products before their combinations are resolved. When a brand is given the
// pool is filtered at source (by manufacturer id), so this bound does not apply.
const PRESTASHOP_FETCH_POOL = 200;

// The Home root category id in a default PrestaShop install. It is assigned to
// every product, so it is never a meaningful "category" for the user.
const ROOT_CATEGORY_ID = '2';

// The maximum number of images kept per imported row (they are all the parent
// product's images, shared by every combination).
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
    const brandIds = brand ? await this.resolveBrandIds(brand) : new Set<string>();

    // 1. Gather every variant (combination or simple product) of interest.
    const combinations = new Map<string, PrestaShopCombinationInfo>();
    const simpleProducts: PrestaShopProductInfo[] = [];

    const products = references.length > 0
      ? await this.client.fetchProductsByReference(references)
      : brandIds.size > 0
        ? await this.client.fetchProductsByManufacturer(Array.from(brandIds))
        : await this.client.fetchAllProducts(PRESTASHOP_FETCH_POOL);

    for (const product of products.filter((entry) => this.matches(entry, options, brandIds))) {
      if ((product.combination_ids?.length ?? 0) > 0) {
        for (const combination of await this.client.fetchCombinationsByIds(product.combination_ids ?? [])) {
          combinations.set(combination.id_product_attribute, combination);
        }
      } else {
        simpleProducts.push(product);
      }
    }

    // 2. Product-level data for every parent product.
    const productIds = Array.from(
      new Set([
        ...[...combinations.values()].map((combination) => combination.id_product),
        ...simpleProducts.map((product) => product.id)
      ].filter((id): id is string => !!id))
    );
    const productsById = new Map(
      (await this.client.fetchProductsById(productIds)).map((product) => [product.id, product])
    );

    // 3. Names for the brand (manufacturer) and category ids.
    const manufacturerNames = new Map(
      (await this.client.fetchManufacturers()).map((entry) => [entry.id, entry.name])
    );
    const categoryNames = new Map((await this.client.fetchCategories()).map((entry) => [entry.id, entry.name]));

    // 4. Stock: combinations are keyed by their stock_available id, simple
    // products by their product id.
    const stockIds = Array.from(
      new Set(
        [...combinations.values()]
          .map((combination) => combination.stock_available_id)
          .filter((id): id is string => !!id)
      )
    );
    const stockById = new Map(
      (await this.client.fetchStockByIds(stockIds)).map((entry) => [entry.id, entry.quantity])
    );
    const stockByProductId = new Map(
      (
        await this.client.fetchStockByProductIds(
          simpleProducts.map((product) => product.id).filter((id): id is string => !!id)
        )
      ).map((entry) => [entry.id_product, entry.quantity])
    );

    // 5. Build and filter the rows, combination rows first.
    const limit = Math.min(Math.max(1, options.limit || PRESTASHOP_FETCH_LIMIT), PRESTASHOP_FETCH_LIMIT);
    const rows: ProductData[] = [];
    for (const combination of combinations.values()) {
      const product = productsById.get(combination.id_product);
      if (!this.matches(product, options, brandIds)) continue;
      rows.push(this.toCombinationData(combination, product, manufacturerNames, categoryNames, stockById));
      if (rows.length >= limit) break;
    }
    for (const product of simpleProducts) {
      if (rows.length >= limit) break;
      if (!this.matches(product, options, brandIds)) continue;
      rows.push(this.toProductData(product, stockByProductId.get(product.id), manufacturerNames, categoryNames));
    }
    return rows;
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

  private toCombinationData(
    combination: PrestaShopCombinationInfo,
    product: PrestaShopProductInfo | undefined,
    manufacturerNames: Map<string, string | undefined>,
    categoryNames: Map<string, string | undefined>,
    stockById: Map<string, number | undefined>
  ): ProductData {
    const row = this.toProductData(product, undefined, manufacturerNames, categoryNames);
    return {
      ...row,
      id: `ps_${combination.id_product_attribute}`,
      reference: combination.reference ?? product?.reference,
      ean: combination.ean13 ?? product?.ean13,
      price: combination.price ?? product?.price,
      wholesale_price: combination.wholesale_price ?? product?.wholesale_price,
      quantity: combination.stock_available_id
        ? stockById.get(combination.stock_available_id)
        : undefined
    };
  }

  private toProductData(
    product: PrestaShopProductInfo | undefined,
    quantity: number | undefined,
    manufacturerNames: Map<string, string | undefined>,
    categoryNames: Map<string, string | undefined>
  ): ProductData {
    return {
      id: `ps_p${product?.id ?? ''}`,
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
      quantity,
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
