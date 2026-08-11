import { useEffect, useState } from 'react';
import { getApiService } from '../../services/api-service';
import { getErrorMessage } from '../../utils/download';
import { useI18n } from '../../i18n';
import { AIProviderName } from '../../types';

interface Message {
  kind: 'success' | 'error';
  text: string;
}

const AI_PROVIDERS: Array<{ value: AIProviderName; label: string }> = [
  { value: 'mock', label: 'Mock' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openrouter', label: 'OpenRouter' }
];

// Fallback URLs shown while the config is loading or after switching provider,
// matching the defaults the backend reports for each provider.
const AI_PROVIDER_BASE_URLS: Record<AIProviderName, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  openrouter: 'https://openrouter.ai/api/v1',
  mock: ''
};

const PRESTASHOP_VERSIONS = ['1.7', '8', '9'];

export default function ConfigurationForm() {
  const api = getApiService();
  const { t } = useI18n();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [version, setVersion] = useState('1.7');
  const [languageId, setLanguageId] = useState(1);
  const [aiProvider, setAiProvider] = useState<AIProviderName>('mock');
  const [aiModel, setAiModel] = useState('');
  const [aiLanguage, setAiLanguage] = useState('es');
  const [aiKey, setAiKey] = useState('');
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getConfiguration()
      .then((config) => {
        if (cancelled) {
          return;
        }
        if (config.prestashop) {
          setBaseUrl(config.prestashop.base_url ?? '');
          setApiKey(config.prestashop.api_key ?? '');
          setVersion(config.prestashop.version ?? '1.7');
          setLanguageId(config.prestashop.language_id ?? 1);
        }
        if (config.ai) {
          setAiProvider(config.ai.provider ?? 'mock');
          setAiModel(config.ai.model ?? '');
          setAiLanguage(config.ai.language ?? 'es');
          setAiKey(config.ai.api_key ?? '');
          setAiBaseUrl(config.ai.base_url ?? '');
        }
      })
      .catch(() => {
        // Defaults are fine when the endpoint is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function run(action: () => Promise<unknown>, successText: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ kind: 'success', text: successText });
    } catch (error) {
      setMessage({ kind: 'error', text: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleTestPrestashop() {
    await run(
      () => api.testPrestashopConnection({ base_url: baseUrl, api_key: apiKey, version, language_id: languageId }),
      t('config.prestashopOk')
    );
  }

  async function handleTestAI() {
    await run(
      () => api.testAIConnection({ provider: aiProvider, model: aiModel, api_key: aiKey, language: aiLanguage, enabled_fields: ['name'] }),
      t('config.aiOk')
    );
  }

  async function handleSave() {
    await run(
      () =>
        api.updateConfiguration({
          prestashop: { base_url: baseUrl, api_key: apiKey, version, language_id: languageId },
          ai: { provider: aiProvider, model: aiModel, api_key: aiKey, language: aiLanguage, enabled_fields: ['name'] }
        }),
      t('config.saved')
    );
  }

  return (
    <section className="card">
      <h2>{t('config.title')}</h2>

      <h3>{t('config.prestashopSection')}</h3>
      <div className="field">
        <label htmlFor="ps-base-url">{t('config.baseUrl')}</label>
        <input
          id="ps-base-url"
          type="text"
          value={baseUrl}
          disabled={busy}
          placeholder={t('config.baseUrlPlaceholder')}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="ps-api-key">{t('config.psApiKey')}</label>
        <input
          id="ps-api-key"
          type="password"
          value={apiKey}
          disabled={busy}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="ps-version">{t('config.version')}</label>
        <select
          id="ps-version"
          value={version}
          disabled={busy}
          onChange={(event) => setVersion(event.target.value)}
        >
          {PRESTASHOP_VERSIONS.map((versionOption) => (
            <option key={versionOption} value={versionOption}>
              {versionOption}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="ps-language">{t('config.languageId')}</label>
        <input
          id="ps-language"
          type="number"
          value={languageId}
          disabled={busy}
          onChange={(event) => setLanguageId(Number(event.target.value))}
        />
      </div>
      <button type="button" className="btn" disabled={busy} onClick={handleTestPrestashop}>
        {t('config.testPrestashop')}
      </button>

      <h3>{t('config.aiSection')}</h3>
      <div className="field">
        <label htmlFor="ai-provider">{t('config.provider')}</label>
        <select
          id="ai-provider"
          value={aiProvider}
          disabled={busy}
          onChange={(event) => {
            setAiProvider(event.target.value as AIProviderName);
            setAiBaseUrl('');
          }}
        >
          {AI_PROVIDERS.map((provider) => (
            <option key={provider.value} value={provider.value}>
              {provider.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="ai-base-url">{t('config.aiBaseUrl')}</label>
        <input
          id="ai-base-url"
          type="text"
          value={aiBaseUrl || AI_PROVIDER_BASE_URLS[aiProvider]}
          readOnly
          disabled={busy}
          placeholder="—"
        />
      </div>
      <div className="field">
        <label htmlFor="ai-model">{t('config.model')}</label>
        <input
          id="ai-model"
          type="text"
          value={aiModel}
          disabled={busy}
          onChange={(event) => setAiModel(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="ai-language">{t('config.aiLanguage')}</label>
        <input
          id="ai-language"
          type="text"
          value={aiLanguage}
          disabled={busy}
          onChange={(event) => setAiLanguage(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="ai-key">{t('config.aiApiKey')}</label>
        <input
          id="ai-key"
          type="password"
          value={aiKey}
          disabled={busy}
          onChange={(event) => setAiKey(event.target.value)}
        />
      </div>
      <button type="button" className="btn" disabled={busy} onClick={handleTestAI}>
        {t('config.testAi')}
      </button>

      <div style={{ marginTop: '0.75rem' }}>
        <button type="button" className="btn primary" disabled={busy} onClick={handleSave}>
          {t('config.save')}
        </button>
      </div>

      {message && <div className={`message ${message.kind}`}>{message.text}</div>}
    </section>
  );
}
