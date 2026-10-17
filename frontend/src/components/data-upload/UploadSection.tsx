import { useState } from 'react';
import { getApiService } from '../../services/api-service';
import { getApiError, getErrorMessage } from '../../utils/download';
import { useI18n, TranslateParams } from '../../i18n';
import {
  MarketplaceName,
  PrestaShopFilterOperator,
  PrestaShopPresenceFilter,
  PrestaShopUploadStatus
} from '../../types';

interface Message {
  kind: 'success' | 'error';
  // The message is stored as a translation key (with optional params) instead
  // of an already-translated string, so it follows the currently selected
  // language instead of freezing in the language used when it appeared.
  key?: string;
  params?: TranslateParams;
  text?: string;
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
  activeMarketplace?: MarketplaceName;
  prestashop?: PrestaShopUploadStatus;
  shopify?: PrestaShopUploadStatus;
  filters?: PrestaShopFetchFilters;
  edited?: boolean;
  onFiltersChange?: (filters: PrestaShopFetchFilters) => void;
  onPrestashopReady?: (dataId: string, count: number) => void;
  onPrestashopCleared?: () => void;
  onShopifyReady?: (dataId: string, count: number) => void;
  onShopifyCleared?: () => void;
  onView?: () => void;
}

export default function UploadSection({
  activeMarketplace = 'PrestaShop',
  prestashop = { present: false },
  shopify = { present: false },
  filters = DEFAULT_PRESTASHOP_FILTERS,
  edited = false,
  onFiltersChange,
  onPrestashopReady,
  onPrestashopCleared,
  onShopifyReady,
  onShopifyCleared,
  onView
}: UploadSectionProps) {
  const api = getApiService();
  const { t } = useI18n();
  const [localFilters, setLocalFilters] = useState<PrestaShopFetchFilters>(filters);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const isShopify = activeMarketplace === 'Shopify';
  const status = isShopify ? shopify : prestashop;
  const labels = isShopify
    ? {
        title: 'upload.shopifyTitle',
        intro: 'upload.shopifyIntro',
        fetchButton: 'upload.shopifyFetchButton',
        fetching: 'upload.shopifyFetching',
        success: 'upload.shopifySuccess',
        notConfigured: 'upload.shopifyNotConfigured',
        cleared: 'upload.shopifyCleared',
        loaded: 'upload.shopifyLoaded',
        editedWarning: 'upload.shopifyEditedWarning'
      }
    : {
        title: 'upload.prestashopTitle',
        intro: 'upload.prestashopIntro',
        fetchButton: 'upload.prestashopFetchButton',
        fetching: 'upload.prestashopFetching',
        success: 'upload.prestashopSuccess',
        notConfigured: 'upload.prestashopNotConfigured',
        cleared: 'upload.prestashopCleared',
        loaded: 'upload.prestashopLoaded',
        editedWarning: 'upload.prestashopEditedWarning'
      };

  // Controlled by the parent when `onFiltersChange` is provided (so the values
  // survive an unmount), otherwise kept internally for standalone use.
  const activeFilters = onFiltersChange ? filters : localFilters;

  function updateFilters(patch: Partial<PrestaShopFetchFilters>) {
    const next = { ...activeFilters, ...patch };
    if (onFiltersChange) onFiltersChange(next);
    else setLocalFilters(next);
  }

  async function handleFetch() {
    if (edited && !window.confirm(t(labels.editedWarning))) {
      return;
    }
    const references = activeFilters.references
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    setBusy(true);
    setMessage(null);
    try {
      const request = {
        references,
        brand: activeFilters.brand.trim(),
        description: activeFilters.description,
        images: activeFilters.images,
        filter_operator: activeFilters.filter_operator,
        limit: PRESTASHOP_FETCH_LIMIT
      };
      const response = isShopify ? await api.fetchShopifyData(request) : await api.fetchPrestashopData(request);
      const data = response?.data ?? {};
      const count = Number(data?.summary?.total ?? 0);
      setMessage({ kind: 'success', key: labels.success, params: { count } });
      if (isShopify) onShopifyReady?.(String(data?.data_id ?? ''), count);
      else onPrestashopReady?.(String(data?.data_id ?? ''), count);
    } catch (error) {
      setMessage({ kind: 'error', text: formatError(error) });
    } finally {
      setBusy(false);
    }
  }

  function formatError(error: unknown): string {
    const apiError = getApiError(error);
    const message = apiError?.message;
    if (typeof message === 'string') {
      if (message.includes('must be configured')) {
        return t(labels.notConfigured);
      }
      if (message.includes('No products matched')) {
        return t('upload.prestashopNoMatch');
      }
    }
    return getErrorMessage(error);
  }

  async function handleClear() {
    setBusy(true);
    setMessage(null);
    try {
      if (isShopify) await api.clearShopifyData();
      else await api.clearPrestashopData();
      updateFilters(DEFAULT_PRESTASHOP_FILTERS);
      setMessage({ kind: 'success', key: labels.cleared });
      if (isShopify) onShopifyCleared?.();
      else onPrestashopCleared?.();
    } catch (error) {
      setMessage({ kind: 'error', text: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  const inputPrefix = isShopify ? 'sh' : 'ps';

  return (
    <section className="card">
      <h2>{t(labels.title)}</h2>
      <p className="hint">{t(labels.intro)}</p>

      <div className="field prestashop-fetch">
        <label htmlFor={`${inputPrefix}-refs-input`}>{t('upload.prestashopReferencesLabel')}</label>
        <textarea
          id={`${inputPrefix}-refs-input`}
          value={activeFilters.references}
          disabled={busy}
          rows={3}
          autoComplete="off"
          placeholder={t('upload.prestashopReferencesPlaceholder')}
          onChange={(event) => updateFilters({ references: event.target.value })}
        />

        <div className="prestashop-filters">
          <div>
            <label htmlFor={`${inputPrefix}-brand-input`}>{t('upload.prestashopBrandLabel')}</label>
            <input
              id={`${inputPrefix}-brand-input`}
              type="text"
              value={activeFilters.brand}
              disabled={busy}
              autoComplete="off"
              placeholder={t('upload.prestashopBrandPlaceholder')}
              onChange={(event) => updateFilters({ brand: event.target.value })}
            />
          </div>
          <div>
            <label htmlFor={`${inputPrefix}-desc-filter`}>{t('upload.prestashopDescriptionFilter')}</label>
            <select
              id={`${inputPrefix}-desc-filter`}
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
            <label htmlFor={`${inputPrefix}-images-filter`}>{t('upload.prestashopImagesFilter')}</label>
            <select
              id={`${inputPrefix}-images-filter`}
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
            <label htmlFor={`${inputPrefix}-filter-operator`}>{t('upload.prestashopFilterOperator')}</label>
            <select
              id={`${inputPrefix}-filter-operator`}
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

        <button type="button" className="btn primary" disabled={busy} onClick={handleFetch}>
          {busy ? t(labels.fetching) : t(labels.fetchButton)}
        </button>

        {status.present && (
          <div className="uploaded-group">
            <div className="uploaded-group-header">
              <strong>{t(labels.loaded, { count: status.count ?? 0 })}</strong>
              <div className="actions">
                <button type="button" className="btn btn-small" disabled={busy} onClick={onView}>
                  {t('upload.prestashopView')}
                </button>
                <button type="button" className="btn btn-small" disabled={busy} onClick={handleClear}>
                  {t('upload.prestashopClear')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {message && (
        <div className={`message ${message.kind}`}>{message.key ? t(message.key, message.params) : message.text}</div>
      )}
    </section>
  );
}
