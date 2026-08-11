import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { getApiService } from '../../services/api-service';
import { ImportedProduct, PrestaShopProductImage } from '../../types';

interface ProductsViewPageProps {
  onBack: () => void;
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

export default function ProductsViewPage({ onBack }: ProductsViewPageProps) {
  const { t } = useI18n();
  const [products, setProducts] = useState<ImportedProduct[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedImage, setSelectedImage] = useState<PrestaShopProductImage | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await getApiService().getPrestashopData();
        if (!active) return;
        const data = res?.data;
        setProducts(Array.isArray(data?.products) ? data.products : []);
      } catch {
        if (active) setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setSelectedImage(null);
    }
    if (!selectedImage) return undefined;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImage]);

  return (
    <section>
      <div className="products-toolbar">
        <button type="button" className="btn" onClick={onBack}>
          {t('view.back')}
        </button>
        <h2 className="products-title">{t('view.title')}</h2>
        {products && <span className="hint">{t('view.count', { count: products.length })}</span>}
      </div>

      {products === null && !loadError && <p className="hint">{t('view.loading')}</p>}
      {loadError && <div className="message error">{t('view.loadError')}</div>}
      {products !== null && !loadError && products.length === 0 && <p className="hint">{t('view.empty')}</p>}

      {products !== null && products.length > 0 && (
        <div className="products-grid">
          {products.map((product) => (
            <article className="product-card" key={product.id}>
              <ProductField label={t('view.reference')} value={product.reference} />
              <ProductField label={t('view.name')} value={product.name} />

              <div className="product-field">
                <span className="product-field-label">{t('view.images')}</span>
                <div className="product-thumbs">
                  {(product.images ?? []).map((image) => (
                    <button
                      key={image.id}
                      type="button"
                      className="product-thumb"
                      aria-label={t('view.viewImage')}
                      onClick={() => setSelectedImage(image)}
                    >
                      <img src={image.url} alt="" loading="lazy" />
                    </button>
                  ))}
                  {(product.images?.length ?? 0) === 0 && <span className="hint">{t('view.noImages')}</span>}
                </div>
              </div>

              <ProductField label={t('view.descriptionShort')} value={product.description_short} multiline />
              <ProductField label={t('view.description')} value={product.description} multiline />
              <ProductField label={t('view.metaTitle')} value={product.meta_title} />
              <ProductField label={t('view.metaDescription')} value={product.meta_description} multiline />
            </article>
          ))}
        </div>
      )}

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
    </section>
  );
}

function ProductField({
  label,
  value,
  multiline = false
}: {
  label: string;
  value?: string;
  multiline?: boolean;
}) {
  const text = toPlainText(value);
  const empty = !text;
  return (
    <div className="product-field">
      <span className="product-field-label">{label}</span>
      <div
        className={
          [multiline ? 'product-field-value multiline' : 'product-field-value', empty ? 'is-empty' : ''].join(' ').trim()
        }
      >
        {text || '\u2014'}
      </div>
    </div>
  );}
