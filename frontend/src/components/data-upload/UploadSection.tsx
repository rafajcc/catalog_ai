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

// The filter values the user entered in the import panel. Owned by the parent
// so they survive navigating to the settings screen, and reset only when the
// imported data is cleared.
export interface PrestaShopFetchFilters {
  references: string;
  brand: string;
  description: PrestaShopPresenceFilter;
  images: PrestaShopPresenceFilter;
  filter_operator: PrestaShopFilterOperator;
}

export const DEFAULT_PRESTASHOP_FILTERS: PrestaShopFetchFilters = {
  references: '',
  brand: '',
  description: 'all',
  images: 'all',
  filter_operator: 'and'
};

interface UploadSectionProps {
  prestashop?: PrestaShopUploadStatus;
  filters?: PrestaShopFetchFilters;
  onFiltersChange?: (filters: PrestaShopFetchFilters) => void;
  onPrestashopReady?: (dataId: string, count: number) => void;
  onPrestashopCleared?: () => void;
}

export default function UploadSection({
  prestashop = { present: false },
  filters = DEFAULT_PRESTASHOP_FILTERS,
  onFiltersChange,
  onPrestashopReady,
  onPrestashopCleared
}: UploadSectionProps) {
  const api = getApiService();
  const { t } = useI18n();
  const [localFilters, setLocalFilters] = useState<PrestaShopFetchFilters>(filters);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  // Controlled by the parent when `onFiltersChange` is provided (so the values
  // survive an unmount), otherwise kept internally for standalone use.
  const activeFilters = onFiltersChange ? filters : localFilters;

  function updateFilters(patch: Partial<PrestaShopFetchFilters>) {
    const next = { ...activeFilters, ...patch };
    if (onFiltersChange) onFiltersChange(next);
    else setLocalFilters(next);
  }

  async function handlePrestashopFetch() {
    const references = activeFilters.references
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    setBusy(true);
    setMessage(null);
    try {
      const response = await api.fetchPrestashopData({
        references,
        brand: activeFilters.brand.trim(),
        description: activeFilters.description,
        images: activeFilters.images,
        filter_operator: activeFilters.filter_operator,
        limit: PRESTASHOP_FETCH_LIMIT
      });
      const data = response?.data ?? {};
      const count = Number(data?.summary?.total ?? 0);
      setMessage({ kind: 'success', text: t('upload.prestashopSuccess', { count }) });
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
      updateFilters(DEFAULT_PRESTASHOP_FILTERS);
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
          value={activeFilters.references}
          disabled={busy}
          rows={3}
          placeholder={t('upload.prestashopReferencesPlaceholder')}
          onChange={(event) => updateFilters({ references: event.target.value })}
        />

        <div className="prestashop-filters">
          <div>
            <label htmlFor="ps-brand-input">{t('upload.prestashopBrandLabel')}</label>
            <input
              id="ps-brand-input"
              type="text"
              value={activeFilters.brand}
              disabled={busy}
              placeholder={t('upload.prestashopBrandPlaceholder')}
              onChange={(event) => updateFilters({ brand: event.target.value })}
            />
          </div>
          <div>
            <label htmlFor="ps-desc-filter">{t('upload.prestashopDescriptionFilter')}</label>
            <select
              id="ps-desc-filter"
              value={activeFilters.description}
              disabled={busy}
              onChange={(event) => updateFilters({ description: event.target.value as PrestaShopPresenceFilter })}
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
              value={activeFilters.images}
              disabled={busy}
              onChange={(event) => updateFilters({ images: event.target.value as PrestaShopPresenceFilter })}
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
              value={activeFilters.filter_operator}
              disabled={busy}
              onChange={(event) => updateFilters({ filter_operator: event.target.value as PrestaShopFilterOperator })}
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
