import { useState } from 'react';
import { getApiService } from '../../services/api-service';
import { getApiError, getErrorMessage } from '../../utils/download';
import { useI18n } from '../../i18n';
import { PrestaShopFilterOperator, PrestaShopPresenceFilter, PrestaShopUploadStatus } from '../../types';

interface Message {
  kind: 'success' | 'error';
  text: string;
}

const PRESTASHOP_FETCH_LIMIT = 50;

interface UploadSectionProps {
  prestashop?: PrestaShopUploadStatus;
  onPrestashopReady?: (dataId: string, count: number) => void;
  onPrestashopCleared?: () => void;
}

export default function UploadSection({
  prestashop = { present: false },
  onPrestashopReady,
  onPrestashopCleared
}: UploadSectionProps) {
  const api = getApiService();
  const { t } = useI18n();
  const [referenceText, setReferenceText] = useState('');
  const [brandText, setBrandText] = useState('');
  const [descriptionFilter, setDescriptionFilter] = useState<PrestaShopPresenceFilter>('all');
  const [imagesFilter, setImagesFilter] = useState<PrestaShopPresenceFilter>('all');
  const [filterOperator, setFilterOperator] = useState<PrestaShopFilterOperator>('and');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  async function handlePrestashopFetch() {
    const references = referenceText
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    setBusy(true);
    setMessage(null);
    try {
      const response = await api.fetchPrestashopData({
        references,
        brand: brandText.trim(),
        description: descriptionFilter,
        images: imagesFilter,
        filter_operator: filterOperator,
        limit: PRESTASHOP_FETCH_LIMIT
      });
      const data = response?.data ?? {};
      const count = Number(data?.summary?.total ?? 0);
      setMessage({ kind: 'success', text: t('upload.prestashopSuccess', { count }) });
      setReferenceText('');
      setBrandText('');
      onPrestashopReady?.(String(data?.data_id ?? ''), count);
    } catch (error) {
      setMessage({ kind: 'error', text: formatPrestashopError(error) });
    } finally {
      setBusy(false);
    }
  }

  function formatPrestashopError(error: unknown): string {
    const apiError = getApiError(error);
    const message = apiError?.message;
    if (typeof message === 'string') {
      if (message.includes('must be configured')) {
        return t('upload.prestashopNotConfigured');
      }
      if (message.includes('No products matched')) {
        return t('upload.prestashopNoMatch');
      }
    }
    return getErrorMessage(error);
  }

  async function handlePrestashopClear() {
    setBusy(true);
    setMessage(null);
    try {
      await api.clearPrestashopData();
      setMessage({ kind: 'success', text: t('upload.prestashopCleared') });
      onPrestashopCleared?.();
    } catch (error) {
      setMessage({ kind: 'error', text: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>{t('upload.prestashopTitle')}</h2>
      <p className="hint">{t('upload.prestashopIntro')}</p>

      <div className="field prestashop-fetch">
        <label htmlFor="ps-refs-input">{t('upload.prestashopReferencesLabel')}</label>
        <textarea
          id="ps-refs-input"
          value={referenceText}
          disabled={busy}
          rows={3}
          placeholder={t('upload.prestashopReferencesPlaceholder')}
          onChange={(event) => setReferenceText(event.target.value)}
        />

        <div className="prestashop-filters">
          <div>
            <label htmlFor="ps-brand-input">{t('upload.prestashopBrandLabel')}</label>
            <input
              id="ps-brand-input"
              type="text"
              value={brandText}
              disabled={busy}
              placeholder={t('upload.prestashopBrandPlaceholder')}
              onChange={(event) => setBrandText(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="ps-desc-filter">{t('upload.prestashopDescriptionFilter')}</label>
            <select
              id="ps-desc-filter"
              value={descriptionFilter}
              disabled={busy}
              onChange={(event) => setDescriptionFilter(event.target.value as PrestaShopPresenceFilter)}
            >
              <option value="with">{t('upload.prestashopDescWith')}</option>
              <option value="without">{t('upload.prestashopDescWithout')}</option>
              <option value="all">{t('upload.prestashopDescAll')}</option>
            </select>
          </div>
          <div>
            <label htmlFor="ps-images-filter">{t('upload.prestashopImagesFilter')}</label>
            <select
              id="ps-images-filter"
              value={imagesFilter}
              disabled={busy}
              onChange={(event) => setImagesFilter(event.target.value as PrestaShopPresenceFilter)}
            >
              <option value="with">{t('upload.prestashopImgWith')}</option>
              <option value="without">{t('upload.prestashopImgWithout')}</option>
              <option value="all">{t('upload.prestashopImgAll')}</option>
            </select>
          </div>
          <div>
            <label htmlFor="ps-filter-operator">{t('upload.prestashopFilterOperator')}</label>
            <select
              id="ps-filter-operator"
              value={filterOperator}
              disabled={busy}
              onChange={(event) => setFilterOperator(event.target.value as PrestaShopFilterOperator)}
            >
              <option value="and">{t('upload.prestashopFilterAnd')}</option>
              <option value="or">{t('upload.prestashopFilterOr')}</option>
            </select>
          </div>
        </div>

        <p className="hint">{t('upload.prestashopLimitNote', { limit: PRESTASHOP_FETCH_LIMIT })}</p>

        <button type="button" className="btn primary" disabled={busy} onClick={handlePrestashopFetch}>
          {busy ? t('upload.prestashopFetching') : t('upload.prestashopFetchButton')}
        </button>

        {prestashop.present && (
          <div className="uploaded-group">
            <div className="uploaded-group-header">
              <strong>{t('upload.prestashopLoaded', { count: prestashop.count ?? 0 })}</strong>
              <button type="button" className="btn btn-small" disabled={busy} onClick={handlePrestashopClear}>
                {t('upload.prestashopClear')}
              </button>
            </div>
          </div>
        )}
      </div>

      {message && <div className={`message ${message.kind}`}>{message.text}</div>}
    </section>
  );
}
