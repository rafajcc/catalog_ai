import { PrestaShopProductUpdate, ProductImageUpload } from '../../../types';

// Keeps only the editable product fields with string values, so the save
// endpoint can never write anything else to the PrestaShop Webservice.
export function sanitizePrestashopUpdate(rawFields: unknown): PrestaShopProductUpdate {
  if (!rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) return {};
  const source = rawFields as Record<string, unknown>;
  const result: PrestaShopProductUpdate = {};
  if (typeof source.description_short === 'string') result.description_short = source.description_short;
  if (typeof source.description === 'string') result.description = source.description;
  if (typeof source.meta_title === 'string') result.meta_title = source.meta_title;
  if (typeof source.meta_description === 'string') result.meta_description = source.meta_description;
  if (Array.isArray(source.images) && source.images.every((img): img is ProductImageUpload =>
    typeof img === 'object' && img !== null && typeof (img as ProductImageUpload).data === 'string' && typeof (img as ProductImageUpload).content_type === 'string'
  )) {
    result.images = source.images as ProductImageUpload[];
  }
  return result;
}

// Maps the generic editable fields onto the Shopify Admin API input shape
// (bodyHtml for the description, a nested seo object for the meta fields).
export function sanitizeShopifyUpdate(source: Record<string, any>): Record<string, any> {
  const input: Record<string, any> = {};
  if (typeof source.title === 'string' || typeof source.name === 'string') {
    input.title = typeof source.title === 'string' ? source.title : source.name;
  }
  if (typeof source.bodyHtml === 'string') input.bodyHtml = source.bodyHtml;
  if (typeof source.description === 'string') input.bodyHtml = source.description;
  if (source.seo && typeof source.seo === 'object') {
    input.seo = {};
    if (typeof source.seo.title === 'string') input.seo.title = source.seo.title;
    if (typeof source.seo.description === 'string') input.seo.description = source.seo.description;
  }
  if (typeof source.meta_title === 'string') {
    if (!input.seo) input.seo = {};
    input.seo.title = source.meta_title;
  }
  if (typeof source.meta_description === 'string') {
    if (!input.seo) input.seo = {};
    input.seo.description = source.meta_description;
  }
  if (typeof source.handle === 'string') input.handle = source.handle;
  return input;
}

// Pulls the well-formed image uploads (base64 data + content type) out of a
// raw per-product update payload.
export function extractImageUploads(source: unknown): ProductImageUpload[] {
  if (!Array.isArray(source)) return [];
  return source.filter(
    (img): img is ProductImageUpload =>
      Boolean(img) &&
      typeof (img as ProductImageUpload).data === 'string' &&
      typeof (img as ProductImageUpload).content_type === 'string'
  );
}

// Pulls the image ids to delete out of a raw per-product update payload.
export function extractImagesToDelete(source: unknown): string[] {
  if (!Array.isArray(source)) return [];
  return source.filter((id): id is string => typeof id === 'string');
}
