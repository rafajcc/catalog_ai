import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { getApiService } from '../../services/api-service';
import { AiProviderUpdate, ApiAiProvider } from '../../types';

// The mock provider makes no HTTP calls: model, endpoint, language, timeout,
// concurrency and API key do not apply to it, so its modal only exposes the
// enabled flag and the connection test.
const PROVIDERS_WITHOUT_SETTINGS = ['mock'];

function errorMessage(error: unknown, fallback: string): string {
  const err = error as { response?: { data?: { error?: { message?: string } } } };
  return err?.response?.data?.error?.message || fallback;
}

// Super admin tab with the global AI provider configuration. Every comercio
// shares these providers: only here they are enabled, configured and picked as
// the active one. The comercio settings screen keeps only the prompt.
export default function AiProvidersTab({
  onError,
  onSuccess
}: {
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [providers, setProviders] = useState<ApiAiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
  const [editing, setEditing] = useState<ApiAiProvider | null>(null);

  async function loadProviders() {
    setLoading(true);
    try {
      const res = await getApiService().getAiProviders();
      if (res.success && Array.isArray(res.data)) {
        setProviders(res.data as ApiAiProvider[]);
      }
    } catch (err) {
      onError(errorMessage(err, t('aiproviders.error')));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProviders();
  }, []);

  function replaceProvider(updated: ApiAiProvider) {
    setProviders((prev) => prev.map((item) => (item.name === updated.name ? { ...item, ...updated } : item)));
  }

  async function handleToggleEnabled(p: ApiAiProvider) {
    try {
      const res = await getApiService().updateAiProvider(p.name, { enabled: !p.enabled });
      if (res.success && res.data) {
        replaceProvider(res.data as ApiAiProvider);
        onSuccess(t('aiproviders.saved'));
      }
    } catch (err) {
      onError(errorMessage(err, t('aiproviders.error')));
    }
  }

  async function handleActivate(p: ApiAiProvider) {
    setActivating(p.name);
    try {
      const res = await getApiService().setActiveAiProvider(p.name);
      if (res.success) {
        setProviders((prev) => prev.map((item) => ({ ...item, is_active: item.name === p.name })));
        onSuccess(t('aiproviders.activated', { name: p.label }));
      }
    } catch (err) {
      onError(errorMessage(err, t('aiproviders.error')));
    } finally {
      setActivating(null);
    }
  }

  return (
    <div>
      <p className="hint">{t('aiproviders.intro')}</p>
      {loading ? (
        <p className="hint">{t('view.loading')}</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>{t('aiproviders.name')}</th>
              <th>{t('aiproviders.status')}</th>
              <th>{t('aiproviders.configured')}</th>
              <th>{t('aiproviders.model')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.name}>
                <td>
                  {p.label}
                  {p.is_active && (
                    <span className="chip" style={{ marginLeft: '0.5rem' }}>{t('config.activeBadge')}</span>
                  )}
                </td>
                <td>
                  {p.enabled
                    ? <span className="chip">{t('superadmin.active')}</span>
                    : <span className="chip error">{t('superadmin.inactive')}</span>}
                </td>
                <td>
                  {p.configured
                    ? <span className="hint">{t('aiproviders.configuredYes')}</span>
                    : <span className="hint">{t('aiproviders.configuredNo')}</span>}
                </td>
                <td className="hint">{p.model || '—'}</td>
                <td>
                  <button className="btn btn-small" type="button" onClick={() => setEditing(p)}>
                    {t('aiproviders.configure')}
                  </button>{' '}
                  <button
                    className={`btn btn-small ${p.enabled ? 'btn-danger' : ''}`}
                    type="button"
                    onClick={() => handleToggleEnabled(p)}
                  >
                    {p.enabled ? t('aiproviders.disable') : t('aiproviders.enable')}
                  </button>{' '}
                  {!p.is_active && (
                    <button
                      className="btn btn-small primary"
                      type="button"
                      disabled={activating === p.name}
                      onClick={() => handleActivate(p)}
                    >
                      {t('aiproviders.activate')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {providers.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: '#6b7280' }}>—</td></tr>
            )}
          </tbody>
        </table>
      )}

      {editing && (
        <AiProviderModal
          provider={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            replaceProvider(updated);
            setEditing(null);
            onSuccess(t('aiproviders.saved'));
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

// Modal to edit one provider: enabled flag, endpoint, model, language, timeout,
// concurrency, web search and API key. Providers without settings (mock) only
// show the enabled flag and the connection test.
function AiProviderModal({
  provider,
  onClose,
  onSaved,
  onError
}: {
  provider: ApiAiProvider;
  onClose: () => void;
  onSaved: (updated: ApiAiProvider) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(provider.enabled);
  const [model, setModel] = useState(provider.model ?? '');
  const [baseUrl, setBaseUrl] = useState(provider.base_url ?? '');
  const [language, setLanguage] = useState(provider.language ?? '');
  const [timeout, setTimeoutValue] = useState(provider.timeout === null || provider.timeout === undefined ? '' : String(provider.timeout));
  const [concurrency, setConcurrency] = useState(provider.concurrency === null || provider.concurrency === undefined ? '' : String(provider.concurrency));
  const [webSearch, setWebSearch] = useState(provider.web_search ?? true);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const usesSettings = !PROVIDERS_WITHOUT_SETTINGS.includes(provider.name);

  function draft(): AiProviderUpdate {
    // Nothing to configure on the mock provider: only the enabled flag is saved.
    if (!usesSettings) return { provider: provider.name };
    return {
      provider: provider.name,
      model: model || undefined,
      base_url: baseUrl || undefined,
      language: language || undefined,
      timeout: timeout.trim() === '' ? null : Number(timeout),
      concurrency: concurrency.trim() === '' ? null : Number(concurrency),
      web_search: webSearch,
      api_key: apiKey || undefined
    };
  }

  async function handleSave() {
    setSaving(true);
    try {
      const update: AiProviderUpdate = { ...draft(), enabled };
      if (usesSettings) {
      // Only send the key when the admin typed a new one, so a saved key is never
      // overwritten by an empty field.
      if (apiKey) {
        update.api_key = apiKey;
      } else {
        delete update.api_key;
      }
      }
      const res = await getApiService().updateAiProvider(provider.name, update);
      if (res.success && res.data) {
        onSaved(res.data as ApiAiProvider);
      } else {
        onError(t('aiproviders.error'));
        setSaving(false);
      }
    } catch (err) {
      onError(errorMessage(err, t('aiproviders.error')));
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestMessage(null);
    try {
      await getApiService().testAiProviderConnection(draft());
      setTestMessage({ kind: 'success', text: t('aiproviders.testOk') });
    } catch (err) {
      setTestMessage({ kind: 'error', text: errorMessage(err, t('aiproviders.testFailed')) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="users-title">{t('aiproviders.configTitle', { name: provider.label })}</h3>
        <div className="modal-body">
          <label className="modal-field modal-check">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            {t('aiproviders.enable')}
          </label>

          {usesSettings && (
            <>
              <label className="modal-field">
                <span>{t('config.model')}</span>
                <input type="text" value={model} onChange={(e) => setModel(e.target.value)} autoComplete="off" />
              </label>

              <label className="modal-field">
                <span>{t('aiproviders.baseUrl')}</span>
                <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} autoComplete="off" placeholder="—" />
              </label>

              <label className="modal-field">
                <span>{t('config.aiLanguage')}</span>
                <input type="text" value={language} onChange={(e) => setLanguage(e.target.value)} autoComplete="off" />
              </label>

              <label className="modal-field">
                <span>{t('config.aiTimeout')}</span>
                <input
                  type="number"
                  min={1}
                  value={timeout}
                  placeholder={t('config.aiTimeoutPlaceholder')}
                  onChange={(e) => setTimeoutValue(e.target.value)}
                />
              </label>

              <label className="modal-field">
                <span>{t('config.aiConcurrency')}</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={concurrency}
                  placeholder={t('config.aiConcurrencyPlaceholder')}
                  onChange={(e) => setConcurrency(e.target.value)}
                />
              </label>

              {provider.name === 'openai' && (
                <label className="modal-field">
                  <span className="modal-check">
                    <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} />
                    {t('config.aiWebSearch')}
                  </span>
                  <span className="field-hint">{t('config.aiWebSearchHint')}</span>
                </label>
              )}

              <label className="modal-field">
                <span>
                  {t('config.aiApiKey')}
                  {provider.api_key_hint && (
                    <span className="field-hint"> ({provider.api_key_hint})</span>
                  )}
                </span>
                <input
                  type="password"
                  value={apiKey}
                  placeholder={provider.has_api_key ? t('aiproviders.keyPlaceholder') : ''}
                  onChange={(e) => { setApiKey(e.target.value); }}
                  autoComplete="off"
                />
              </label>
            </>
          )}

          <button className="btn" type="button" disabled={testing} onClick={handleTest}>
            {t('config.testAi')}
          </button>
          {testMessage && (
            <div className={`message ${testMessage.kind}`} style={{ marginTop: '0.5rem' }}>
              {testMessage.text}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn btn-small" type="button" onClick={onClose} disabled={saving}>
            {t('aiproviders.cancel')}
          </button>
          <button className="btn btn-small primary" type="button" onClick={handleSave} disabled={saving}>
            {t('aiproviders.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
