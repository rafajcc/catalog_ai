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
  // True when the active marketplace was disabled platform-wide by the super
  // admin: the fetch is blocked and the user is told to pick another one.
  marketplaceDisabled?: boolean;
  prestashop?: PrestaShopUploadStatus;
  shopify?: PrestaShopUploadStatus;
  mock?: PrestaShopUploadStatus;
  filters?: PrestaShopFetchFilters;
  edited?: boolean;
  onFiltersChange?: (filters: PrestaShopFetchFilters) => void;
  onPrestashopReady?: (dataId: string, count: number) => void;
  onPrestashopCleared?: () => void;
  onShopifyReady?: (dataId: string, count: number) => void;
  onShopifyCleared?: () => void;
  onMockReady?: (dataId: string, count: number) => void;
  onMockCleared?: () => void;
  onView?: () => void;
}

export default function UploadSection({
  activeMarketplace = 'PrestaShop',
  marketplaceDisabled = false,
  prestashop = { present: false },
  shopify = { present: false },
  mock = { present: false },
  filters = DEFAULT_PRESTASHOP_FILTERS,
  edited = false,
  onFiltersChange,
  onPrestashopReady,
  onPrestashopCleared,
  onShopifyReady,
  onShopifyCleared,
  onMockReady,
  onMockCleared,
  onView
}: UploadSectionProps) {
  const api = getApiService();
  const { t } = useI18n();
  const [localFilters, setLocalFilters] = useState<PrestaShopFetchFilters>(filters);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const isMock = activeMarketplace === 'Mock';
  const isShopify = activeMarketplace === 'Shopify';
  const status = isMock ? mock : isShopify ? shopify : prestashop;
  // The marketplace name is the placeholder of every shared message, and the
  // source clause (which backend/API the data comes from) only varies per
  // marketplace, so both live here instead of in a per-marketplace label set.
  const marketplace = activeMarketplace;
  const sourceKey = isMock
    ? 'upload.sourceMock'
    : isShopify
      ? 'upload.sourceShopify'
      : 'upload.sourcePrestashop';
  const source = t(sourceKey);

  // Controlled by the parent when `onFiltersChange` is provided (so the values
  // survive an unmount), otherwise kept internally for standalone use.
  const activeFilters = onFiltersChange ? filters : localFilters;

  function updateFilters(patch: Partial<PrestaShopFetchFilters>) {
    const next = { ...activeFilters, ...patch };
    if (onFiltersChange) onFiltersChange(next);
    else setLocalFilters(next);
  }

  async function handleFetch() {
    // A marketplace disabled platform-wide cannot be fetched from: the comercio
    // must switch to another one (its saved value is kept but unusable).
    if (marketplaceDisabled) return;
    // Warn whenever there is something to lose: pending edits (which fetching
    // again would discard) or a previous result set (which the new search would
    // overwrite). The warning always fires before the request is sent.
    if (edited) {
      if (!window.confirm(t('upload.editedWarning', { marketplace }))) return;
    } else if (status.present) {
      if (!window.confirm(t('upload.overwriteWarning', { marketplace }))) return;
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
      const response = isMock
        ? await api.fetchMockData(request)
        : isShopify
          ? await api.fetchShopifyData(request)
          : await api.fetchPrestashopData(request);
      const data = response?.data ?? {};
      const count = Number(data?.summary?.total ?? 0);
      setMessage({ kind: 'success', key: 'upload.success', params: { count, marketplace } });
      if (isMock) onMockReady?.(String(data?.data_id ?? ''), count);
      else if (isShopify) onShopifyReady?.(String(data?.data_id ?? ''), count);
      else onPrestashopReady?.(String(data?.data_id ?? ''), count);
    } catch (error) {
      const apiError = getApiError(error);
      const message = apiError?.message;
      // A search with no matches must leave the screen consistent with the
      // current result: the previous dataset is discarded so the user never
      // sees stale products from an earlier search.
      if (typeof message === 'string' && message.includes('No products matched')) {
        if (isMock) onMockCleared?.();
        else if (isShopify) onShopifyCleared?.();
        else onPrestashopCleared?.();
      }
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
        return t('upload.notConfigured', { marketplace });
      }
      if (message.includes('No products matched')) {
        return t('upload.noMatch');
      }
    }
    return getErrorMessage(error);
  }

  async function handleClear() {
    setBusy(true);
    setMessage(null);
    try {
      if (isMock) await api.clearMockData();
      else if (isShopify) await api.clearShopifyData();
      else await api.clearPrestashopData();
      updateFilters(DEFAULT_PRESTASHOP_FILTERS);
      setMessage({ kind: 'success', key: 'upload.cleared', params: { marketplace } });
      if (isMock) onMockCleared?.();
      else if (isShopify) onShopifyCleared?.();
      else onPrestashopCleared?.();
    } catch (error) {
      setMessage({ kind: 'error', text: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  const inputPrefix = isMock ? 'mock' : isShopify ? 'sh' : 'ps';

  return (
    <section className="card">
      <h2>{t('upload.title', { marketplace })}</h2>
      <p className="hint">{t('upload.intro', { source })}</p>

      {marketplaceDisabled && (
        <p className="message error">{t('upload.marketplaceDisabled', { marketplace })}</p>
      )}

      <div className="field prestashop-fetch">
        <label htmlFor={`${inputPrefix}-refs-input`}>{t('upload.referencesLabel')}</label>
        <textarea
          id={`${inputPrefix}-refs-input`}
          value={activeFilters.references}
          disabled={busy}
          rows={3}
          autoComplete="off"
          placeholder={t('upload.referencesPlaceholder')}
          onChange={(event) => updateFilters({ references: event.target.value })}
        />

        <div className="prestashop-filters">
          <div>
            <label htmlFor={`${inputPrefix}-brand-input`}>{t('upload.brandLabel')}</label>
            <input
              id={`${inputPrefix}-brand-input`}
              type="text"
              value={activeFilters.brand}
              disabled={busy}
              autoComplete="off"
              placeholder={t('upload.brandPlaceholder')}
              onChange={(event) => updateFilters({ brand: event.target.value })}
            />
          </div>
          <div>
            <label htmlFor={`${inputPrefix}-desc-filter`}>{t('upload.descriptionFilter')}</label>
            <select
              id={`${inputPrefix}-desc-filter`}
              value={activeFilters.description}
              disabled={busy}
              onChange={(event) => updateFilters({ description: event.target.value as PrestaShopPresenceFilter })}
            >
              <option value="with">{t('upload.descWith')}</option>
              <option value="without">{t('upload.descWithout')}</option>
              <option value="all">{t('upload.descAll')}</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${inputPrefix}-images-filter`}>{t('upload.imagesFilter')}</label>
            <select
              id={`${inputPrefix}-images-filter`}
              value={activeFilters.images}
              disabled={busy}
              onChange={(event) => updateFilters({ images: event.target.value as PrestaShopPresenceFilter })}
            >
              <option value="with">{t('upload.imgWith')}</option>
              <option value="without">{t('upload.imgWithout')}</option>
              <option value="all">{t('upload.imgAll')}</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${inputPrefix}-filter-operator`}>{t('upload.filterOperator')}</label>
            <select
              id={`${inputPrefix}-filter-operator`}
              value={activeFilters.filter_operator}
              disabled={busy}
              onChange={(event) => updateFilters({ filter_operator: event.target.value as PrestaShopFilterOperator })}
            >
              <option value="and">{t('upload.filterAnd')}</option>
              <option value="or">{t('upload.filterOr')}</option>
            </select>
          </div>
        </div>

        <p className="hint">{t('upload.limitNote', { limit: PRESTASHOP_FETCH_LIMIT })}</p>

        <button type="button" className="btn primary" disabled={busy || marketplaceDisabled} onClick={handleFetch}>
          {busy ? t('upload.fetching', { marketplace }) : t('upload.fetchButton', { marketplace })}
        </button>

        {status.present && (
          <div className="uploaded-group">
            <div className="uploaded-group-header">
              <strong>{t('upload.loaded', { count: status.count ?? 0, marketplace })}</strong>
              <div className="actions">
                <button type="button" className="btn btn-small" disabled={busy} onClick={onView}>
                  {t('upload.view')}
                </button>
                <button type="button" className="btn btn-small" disabled={busy} onClick={handleClear}>
                  {t('upload.clear')}
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
