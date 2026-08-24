import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { getApiService } from '../../services/api-service';
import { getErrorMessage } from '../../utils/download';
import { AiAutocompleteResult, AIProviderName, ImportedProduct, PrestaShopProductImage, ProductEdits, ProductEditsMap, ProductImageUpload } from '../../types';

interface ProductsViewPageProps {
  onBack: () => void;
  edits?: ProductEditsMap;
  savedEdits?: ProductEditsMap;
  newImageUrlsByProduct?: Record<string, string[]>;
  originalImagesBeforeAI?: Record<string, PrestaShopProductImage[]>;
  onSaveProduct?: (productId: string, edits: ProductEdits) => void;
  onUndoProduct?: (productId: string) => void;
  onSavedToPrestashop?: (saved: ProductEditsMap) => void;
  onNewImageUrlsChange?: (updater: (prev: Record<string, string[]>) => Record<string, string[]>) => void;
  onOriginalImagesChange?: (updater: (prev: Record<string, PrestaShopProductImage[]>) => Record<string, PrestaShopProductImage[]>) => void;
}

interface ProductEditForm {
  description_short: string;
  description: string;
  meta_title: string;
  meta_description: string;
}

// The fields the AI autocomplete is allowed to fill. These are the four text
// fields the grid can edit; only the empty ones get completed.
const EMPTY_TARGET_FIELDS: ('description_short' | 'description' | 'meta_title' | 'meta_description')[] = ['description_short', 'description', 'meta_title', 'meta_description'];

const AI_PROVIDER_LABELS: Record<AIProviderName, string> = {
  mock: 'Mock',
  gpt4all: 'GPT4All',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter'
};

// Fetches an image via the backend proxy and returns it as base64 data.
async function fetchImageAsBase64(url: string): Promise<ProductImageUpload | null> {
  try {
    const token = localStorage.getItem('auth_token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const proxyUrl = getApiService().proxyImageUrl(url);
    const response = await fetch(proxyUrl, { headers, credentials: 'include' });
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    return { data: base64, content_type: contentType.split(';')[0].trim() };
  } catch {
    return null;
  }
}

// Renders a PrestaShop description (usually HTML) as readable plain text.
function toPlainText(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Compares the editor contents with the originally imported values and keeps
// only the fields the user actually changed, so the grid can highlight them.
function diffEdits(product: ImportedProduct, fields: ProductEditForm): ProductEdits {
  const edits: ProductEdits = {};
  if (fields.description_short.trim() !== toPlainText(product.description_short).trim()) {
    edits.description_short = fields.description_short.trim();
  }
  if (fields.description.trim() !== toPlainText(product.description).trim()) {
    edits.description = fields.description.trim();
  }
  if (fields.meta_title.trim() !== (product.meta_title ?? '').trim()) {
    edits.meta_title = fields.meta_title.trim();
  }
  if (fields.meta_description.trim() !== (product.meta_description ?? '').trim()) {
    edits.meta_description = fields.meta_description.trim();
  }
  return edits;
}

// Applies the pending and already-saved edits on top of the imported product, so
// both the grid and the autocomplete logic see the values the user will see.
function mergeProductEdits(product: ImportedProduct, saved: ProductEditsMap, pending: ProductEditsMap): ImportedProduct {
  return { ...product, ...(saved[product.id] ?? {}), ...(pending[product.id] ?? {}) };
}

// Whether a target text field is empty once its HTML is rendered as plain text.
function isEmptyField(product: ImportedProduct, field: 'description_short' | 'description' | 'meta_title' | 'meta_description'): boolean {
  return !toPlainText(product[field]);
}

function isEmptyTargetField(product: ImportedProduct): boolean {
  return EMPTY_TARGET_FIELDS.some((field) => isEmptyField(product, field));
}

function needsAiProcessing(product: ImportedProduct): boolean {
  return isEmptyTargetField(product) || (product.images?.length ?? 0) < 5;
}

export default function ProductsViewPage({
  onBack,
  edits = {},
  savedEdits = {},
  newImageUrlsByProduct: newImageUrlsByProductProp = {},
  originalImagesBeforeAI: originalImagesBeforeAIProp = {},
  onSaveProduct = () => {},
  onUndoProduct = () => {},
  onSavedToPrestashop = () => {},
  onNewImageUrlsChange,
  onOriginalImagesChange
}: ProductsViewPageProps) {
  const { t, language } = useI18n();
  const [products, setProducts] = useState<ImportedProduct[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedImage, setSelectedImage] = useState<PrestaShopProductImage | null>(null);
  const [editingProduct, setEditingProduct] = useState<ImportedProduct | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [autocompleteBusy, setAutocompleteBusy] = useState(false);
  const [autocompleteProgress, setAutocompleteProgress] = useState<{ done: number; total: number } | null>(null);
  const [autocompleteMessage, setAutocompleteMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [autocompleteErrors, setAutocompleteErrors] = useState<{ reference: string; message: string }[]>([]);
  const [selectedAiProvider, setSelectedAiProvider] = useState<AIProviderName>('mock');
  const [defaultAiProvider, setDefaultAiProvider] = useState<AIProviderName>('mock');
  const [availableProviders, setAvailableProviders] = useState<AIProviderName[]>(['mock']);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());

  // Use lifted state via callbacks when available, otherwise local state fallback
  const newImageUrlsByProduct = newImageUrlsByProductProp;
  const originalImagesBeforeAI = originalImagesBeforeAIProp;

  const setNewImageUrlsByProduct = useCallback((updater: (prev: Record<string, string[]>) => Record<string, string[]>) => {
    if (onNewImageUrlsChange) {
      onNewImageUrlsChange(updater);
    }
  }, [onNewImageUrlsChange]);

  const setOriginalImagesBeforeAI = useCallback((updater: (prev: Record<string, PrestaShopProductImage[]>) => Record<string, PrestaShopProductImage[]>) => {
    if (onOriginalImagesChange) {
      onOriginalImagesChange(updater);
    }
  }, [onOriginalImagesChange]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await getApiService().getPrestashopData();
        if (!active) return;
        const data = res?.data;
        const loaded = Array.isArray(data?.products) ? data.products : [];
        setProducts(loaded);
        setSelectedProductIds(new Set(loaded.map((p: ImportedProduct) => p.id)));
      } catch {
        if (active) setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const config = await getApiService().getConfiguration();
        if (!active) return;
        const ai = config?.ai;
        if (!ai) return;
        const defaultProvider = (ai.provider ?? 'mock') as AIProviderName;
        setSelectedAiProvider(defaultProvider);
        setDefaultAiProvider(defaultProvider);
        const providersWithSettings = Object.keys(ai.providers ?? {}) as AIProviderName[];
        const allProviders: AIProviderName[] = providersWithSettings.length > 0
          ? providersWithSettings
          : [defaultProvider];
        setAvailableProviders(allProviders);
      } catch {
        // Defaults are fine when the endpoint is unavailable.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (selectedImage) setSelectedImage(null);
      else if (editingProduct) setEditingProduct(null);
    }
    if (!selectedImage && !editingProduct) return undefined;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImage, editingProduct]);

  function isEdited(productId: string, field: 'description_short' | 'description' | 'meta_title' | 'meta_description'): boolean {
    const productEdits = edits[productId];
    return Boolean(productEdits && productEdits[field] !== undefined);
  }

  function handleSave(original: ImportedProduct, fields: ProductEditForm) {
    onSaveProduct(original.id, diffEdits(original, fields));
    setEditingProduct(null);
  }

  // Sends only the pending edits (already computed as per-product deltas) to
  // PrestaShop, keyed by the raw product id, and moves them to the saved map.
  async function handleSaveToPrestashop() {
    const updates: Record<string, ProductEdits> = {};
    for (const product of products ?? []) {
      if (!selectedProductIds.has(product.id)) continue;
      const pending = edits[product.id];
      const newImageUrls = newImageUrlsByProduct[product.id];
      if ((!pending && (!newImageUrls || newImageUrls.length === 0)) || !product.prestashop_id) continue;
      updates[product.prestashop_id] = {
        ...(pending ?? {}),
        image_urls: newImageUrls && newImageUrls.length > 0 ? newImageUrls : undefined
      };
    }
    if (Object.keys(updates).length === 0) return;

    // Fetch all new images via proxy and convert to base64
    const imagePayloads: Record<string, ProductImageUpload[]> = {};
    for (const [psId, update] of Object.entries(updates)) {
      const urls = update.image_urls;
      if (!urls || urls.length === 0) continue;
      const images: ProductImageUpload[] = [];
      for (const url of urls) {
        const img = await fetchImageAsBase64(url);
        if (img) images.push(img);
      }
      if (images.length > 0) imagePayloads[psId] = images;
    }

    // Replace image_urls with base64 images in the payload
    for (const [psId, update] of Object.entries(updates)) {
      const { image_urls, ...textFields } = update;
      const imgs = imagePayloads[psId];
      (updates as Record<string, any>)[psId] = imgs && imgs.length > 0
        ? { ...textFields, images: imgs }
        : textFields;
    }

    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await getApiService().savePrestashopEdits(updates);
      onSavedToPrestashop({ ...edits });
      setSaveMessage({
        type: 'success',
        text: res?.message ?? t('view.saved', { count: Object.keys(updates).length })
      });
    } catch (error) {
      setSaveMessage({ type: 'error', text: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  // Asks the AI provider for the empty text fields of every product that has
  // one, one call per product. Each answer is parsed and applied to the grid,
  // filling only the fields that were empty. A counter shows how many products
  // have been queried so far, and a final message reports the outcome.
  async function handleAutocomplete() {
    const targets = mergedProducts.filter((p) => selectedProductIds.has(p.id) && needsAiProcessing(p));
    if (targets.length === 0 || autocompleteBusy) return;

    setAutocompleteBusy(true);
    setAutocompleteProgress({ done: 0, total: targets.length });
    setAutocompleteMessage(null);
    setAutocompleteErrors([]);

    let completed = 0;
    const errors: { reference: string; message: string }[] = [];
    const api = getApiService();

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const ref = target.reference ?? target.id ?? `#${index + 1}`;
      try {
        const res = await api.autocompleteProduct(target, language, selectedAiProvider);
        const result = res?.data as AiAutocompleteResult | undefined;
        const proposals = result?.proposals ?? {};
        const next: ProductEdits = { ...(edits[target.id] ?? {}) };
        let applied = false;
        for (const field of EMPTY_TARGET_FIELDS) {
          const proposal = proposals[field];
          if (isEmptyField(target, field) && typeof proposal === 'string' && proposal.trim() !== '') {
            next[field] = proposal;
            applied = true;
          }
        }

        // Apply AI-found image URLs if the product has fewer than 5 images
        const imageUrls = result?.image_urls;
        const currentImageCount = target.images?.length ?? 0;
        const imagesNeeded = Math.max(0, 5 - currentImageCount);
        if (Array.isArray(imageUrls) && imageUrls.length > 0 && imagesNeeded > 0) {
          const cappedUrls = imageUrls.slice(0, imagesNeeded);
          const newImages: PrestaShopProductImage[] = cappedUrls.map((url, i) => ({
            id: `ai-${target.id}-${currentImageCount + i}`,
            product_id: target.id,
            url: api.proxyImageUrl(url)
          }));
          setOriginalImagesBeforeAI((prev) => ({
            ...prev,
            [target.id]: prev[target.id] ?? target.images ?? []
          }));
          setNewImageUrlsByProduct((prev) => ({
            ...prev,
            [target.id]: [...(prev[target.id] ?? []), ...cappedUrls]
          }));
          setProducts((prev) =>
            (prev ?? []).map((p) =>
              p.id === target.id ? { ...p, images: [...(p.images ?? []), ...newImages] } : p
            )
          );
          applied = true;
        }

        if (applied) {
          onSaveProduct(target.id, next);
          completed += 1;
        } else {
          const entry = { reference: ref, message: t('view.aiAutocompleteNoProposals') };
          errors.push(entry);
          setAutocompleteErrors([...errors]);
        }
      } catch (error) {
        const entry = { reference: ref, message: getErrorMessage(error) };
        errors.push(entry);
        setAutocompleteErrors([...errors]);
      }
      setAutocompleteProgress({ done: index + 1, total: targets.length });
    }

    setAutocompleteBusy(false);
    setAutocompleteProgress(null);
    if (errors.length === 0) {
      setAutocompleteMessage({
        type: 'success',
        text: t('view.aiAutocompleteSuccess', { completed, total: targets.length })
      });
    } else if (completed === 0) {
      setAutocompleteMessage({
        type: 'error',
        text: t('view.aiAutocompleteAllFailed', { total: targets.length })
      });
    } else {
      setAutocompleteMessage({
        type: 'error',
        text: t('view.aiAutocompletePartial', {
          completed,
          total: targets.length,
          failed: errors.length
        })
      });
    }
  }

  const mergedProducts = (products ?? []).map((product) => mergeProductEdits(product, savedEdits, edits));
  const needsAutocomplete = mergedProducts.some(needsAiProcessing);
  const pendingCount = Math.max(
    Object.keys(edits).length,
    Object.keys(newImageUrlsByProduct).length
  );

  const allSelected = mergedProducts.length > 0 && mergedProducts.every((p) => selectedProductIds.has(p.id));
  const selectedCount = mergedProducts.filter((p) => selectedProductIds.has(p.id)).length;

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedProductIds(new Set());
    } else {
      setSelectedProductIds(new Set(mergedProducts.map((p) => p.id)));
    }
  }

  function toggleProductSelection(productId: string) {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  }

  return (
    <section className="products-view">
      <div className="products-panel">
        <div className="products-toolbar">
          <button type="button" className="btn" onClick={onBack}>
            {t('view.back')}
          </button>
          <h2 className="products-title">{t('view.title')}</h2>
          {products && <span className="hint">{t('view.count', { count: products.length })}</span>}
          {products && products.length > 0 && (
            <label className="products-select-all" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: '#374151', cursor: 'pointer', marginLeft: '0.5rem' }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                style={{ cursor: 'pointer' }}
              />
              {t('view.selectAll')}
              {selectedCount < mergedProducts.length && <span className="hint">({selectedCount}/{mergedProducts.length})</span>}
            </label>
          )}
          {(needsAutocomplete || pendingCount > 0) && (
            <div className="products-toolbar-actions">
              {needsAutocomplete && (
                <>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="products-ai-provider" style={{ fontSize: '0.75rem', color: '#6b7280' }}>{t('view.aiProvider')}</label>
                    <select
                      id="products-ai-provider"
                      value={selectedAiProvider}
                      disabled={autocompleteBusy}
                      onChange={(event) => setSelectedAiProvider(event.target.value as AIProviderName)}
                      style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
                    >
                      {availableProviders.map((provider) => (
                        <option key={provider} value={provider}>
                          {provider === defaultAiProvider
                            ? t('view.aiProviderDefault', { provider: AI_PROVIDER_LABELS[provider] ?? provider })
                            : AI_PROVIDER_LABELS[provider] ?? provider}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="btn products-ai-button"
                    onClick={handleAutocomplete}
                    disabled={autocompleteBusy}
                  >
                    {autocompleteBusy ? t('view.aiAutocompleteRunning') : t('view.aiAutocomplete')}
                  </button>
                </>
              )}
              {autocompleteProgress && (
                <span className="upload-counter" role="status">
                  {autocompleteProgress.done} / {autocompleteProgress.total}
                </span>
              )}
              {pendingCount > 0 && (
                <button
                  type="button"
                  className="btn primary products-save-button"
                  onClick={handleSaveToPrestashop}
                  disabled={saving}
                >
                  {saving ? t('view.saving') : t('view.saveToPrestashop')}
                </button>
              )}
            </div>
          )}
        </div>

        {saveMessage && <div className={`message ${saveMessage.type}`}>{saveMessage.text}</div>}
        {autocompleteMessage && <div className={`message ${autocompleteMessage.type}`}>{autocompleteMessage.text}</div>}
        {autocompleteErrors.length > 0 && (
          <div className="autocomplete-errors">
            <h4 className="autocomplete-errors-title">{t('view.aiAutocompleteErrorsTitle', { count: autocompleteErrors.length })}</h4>
            <ul className="autocomplete-errors-list">
              {autocompleteErrors.map((err, i) => (
                <li key={i} className="autocomplete-error-item">
                  <span className="autocomplete-error-ref">{err.reference}</span>
                  <span className="autocomplete-error-msg">{err.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {products === null && !loadError && <p className="hint">{t('view.loading')}</p>}
        {loadError && <div className="message error">{t('view.loadError')}</div>}
        {products !== null && !loadError && products.length === 0 && <p className="hint">{t('view.empty')}</p>}

        {products !== null && products.length > 0 && (
          <div className="products-grid-scroll">
          <div className="products-grid">
          {mergedProducts.map((product) => {
            const edited = Boolean(edits[product.id]) || Boolean(newImageUrlsByProduct[product.id]?.length);
            return (
              <article
                className="product-card"
                key={product.id}
                role="button"
                tabIndex={0}
                aria-label={`${t('view.edit')}: ${product.reference ?? ''} ${product.name}`.trim()}
                onClick={() => setEditingProduct(product)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setEditingProduct(product);
                  }
                }}
              >
                <div className="product-card-actions">
                  <label
                    className="product-select-check"
                    style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
                    title={t('view.selectProduct')}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selectedProductIds.has(product.id)}
                      onChange={() => toggleProductSelection(product.id)}
                      style={{ cursor: 'pointer', width: '1rem', height: '1rem' }}
                    />
                  </label>
                  {edited && (
                    <>
                      <button
                        type="button"
                        className="product-undo-button"
                        title={t('view.undo')}
                        aria-label={t('view.undo')}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (originalImagesBeforeAI[product.id]) {
                            setProducts((prev) =>
                              (prev ?? []).map((p) =>
                                p.id === product.id ? { ...p, images: originalImagesBeforeAI[product.id] } : p
                              )
                            );
                            setOriginalImagesBeforeAI((prev) => {
                              const next = { ...prev };
                              delete next[product.id];
                              return next;
                            });
                            setNewImageUrlsByProduct((prev) => {
                              const next = { ...prev };
                              delete next[product.id];
                              return next;
                            });
                          }
                          onUndoProduct(product.id);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                          <path
                            fill="currentColor"
                            d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"
                          />
                        </svg>
                      </button>
                      <span className="product-edited-badge" title={t('view.edited')}>
                        {t('view.edited')}
                      </span>
                    </>
                  )}
                </div>

                <ProductField label={t('view.reference')} value={product.reference} bold />
                <ProductField label={t('view.name')} value={product.name} bold />
                <ProductField label={t('view.brand')} value={product.brand} />

                <div className="product-field">
                  <span className="product-field-label">{t('view.images')}</span>
                  <div className="product-thumbs">
                    {(product.images ?? []).map((image) => (
                      <button
                        key={image.id}
                        type="button"
                        className="product-thumb"
                        aria-label={t('view.viewImage')}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedImage(image);
                        }}
                      >
                        <img src={image.url} alt="" loading="lazy" />
                      </button>
                    ))}
                    {(product.images?.length ?? 0) === 0 && <span className="hint">{t('view.noImages')}</span>}
                  </div>
                </div>

                <ProductField
                  label={t('view.descriptionShort')}
                  value={product.description_short}
                  multiline
                  edited={isEdited(product.id, 'description_short')}
                />
                <ProductField
                  label={t('view.description')}
                  value={product.description}
                  multiline
                  edited={isEdited(product.id, 'description')}
                />
                <ProductField
                  label={t('view.metaTitle')}
                  value={product.meta_title}
                  edited={isEdited(product.id, 'meta_title')}
                />
                <ProductField
                  label={t('view.metaDescription')}
                  value={product.meta_description}
                  multiline
                  edited={isEdited(product.id, 'meta_description')}
                />
              </article>
            );
          })}
          </div>
        </div>
      )}
    </div>

    {selectedImage && (
        <div
          className="image-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t('view.viewImage')}
          onClick={() => setSelectedImage(null)}
        >
          <img src={selectedImage.url} alt={t('view.viewImage')} onClick={(event) => event.stopPropagation()} />
          <button
            type="button"
            className="image-modal-close"
            aria-label={t('view.close')}
            onClick={() => setSelectedImage(null)}
          >
            ×
          </button>
        </div>
      )}

      {editingProduct && (
        <ProductEditModal
          product={editingProduct}
          onSave={(fields) => handleSave(editingProduct, fields)}
          onClose={() => setEditingProduct(null)}
          onViewImage={setSelectedImage}
        />
      )}
    </section>
  );
}

function ProductEditModal({
  product,
  onSave,
  onClose,
  onViewImage
}: {
  product: ImportedProduct;
  onSave: (fields: ProductEditForm) => void;
  onClose: () => void;
  onViewImage: (image: PrestaShopProductImage) => void;
}) {
  const { t } = useI18n();
  const [fields, setFields] = useState<ProductEditForm>(() => ({
    description_short: toPlainText(product.description_short),
    description: toPlainText(product.description),
    meta_title: product.meta_title ?? '',
    meta_description: product.meta_description ?? ''
  }));

  function setField(name: keyof ProductEditForm, value: string) {
    setFields((prev) => ({ ...prev, [name]: value }));
  }

  const title = [product.reference, product.name].filter(Boolean).join(' · ') || t('view.editTitle');

  return (
    <div className="edit-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="edit-modal-box" onClick={(event) => event.stopPropagation()}>
        <div className="edit-modal-header">
          <h3 className="edit-modal-title">{title}</h3>
          <button type="button" className="edit-modal-close" aria-label={t('view.close')} onClick={onClose}>
            ×
          </button>
        </div>

        <div className="edit-modal-product">
          <ProductField label={t('view.brand')} value={product.brand} />
        </div>

        {(product.images?.length ?? 0) > 0 && (
          <div className="edit-modal-images">
            <span className="product-field-label">{t('view.images')}</span>
            <div className="edit-modal-thumbs">
              {product.images!.map((image) => (
                <button
                  key={image.id}
                  type="button"
                  className="edit-modal-thumb"
                  aria-label={t('view.viewImage')}
                  onClick={() => onViewImage(image)}
                >
                  <img src={image.url} alt="" />
                </button>
              ))}
            </div>
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave(fields);
          }}
        >
          <label htmlFor="edit-description-short">{t('view.descriptionShort')}</label>
          <textarea
            id="edit-description-short"
            rows={3}
            value={fields.description_short}
            autoComplete="off"
            onChange={(event) => setField('description_short', event.target.value)}
          />

          <label htmlFor="edit-description">{t('view.description')}</label>
          <textarea
            id="edit-description"
            rows={6}
            value={fields.description}
            autoComplete="off"
            onChange={(event) => setField('description', event.target.value)}
          />

          <label htmlFor="edit-meta-title">{t('view.metaTitle')}</label>
          <input
            id="edit-meta-title"
            type="text"
            value={fields.meta_title}
            autoComplete="off"
            onChange={(event) => setField('meta_title', event.target.value)}
          />

          <label htmlFor="edit-meta-description">{t('view.metaDescription')}</label>
          <textarea
            id="edit-meta-description"
            rows={3}
            value={fields.meta_description}
            autoComplete="off"
            onChange={(event) => setField('meta_description', event.target.value)}
          />

          <div className="edit-modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              {t('view.cancel')}
            </button>
            <button type="submit" className="btn primary">
              {t('view.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProductField({
  label,
  value,
  multiline = false,
  bold = false,
  edited = false
}: {
  label: string;
  value?: string;
  multiline?: boolean;
  bold?: boolean;
  edited?: boolean;
}) {
  const { t } = useI18n();
  const text = toPlainText(value);
  const empty = !text;
  return (
    <div className={['product-field', edited ? 'edited' : ''].join(' ').trim()}>
      <span className="product-field-label" title={edited ? t('view.edited') : undefined}>
        {label}
      </span>
      <div
        className={
          [
            'product-field-value',
            multiline ? 'multiline' : '',
            bold ? 'bold' : '',
            empty ? 'is-empty' : ''
          ]
            .join(' ')
            .trim()
        }
      >
        {text || '\u2014'}
      </div>
    </div>
  );
}
