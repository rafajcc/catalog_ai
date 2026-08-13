import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { getApiService } from '../../services/api-service';
import { getErrorMessage } from '../../utils/download';
import { useI18n } from '../../i18n';
import { AIProviderName, AIProviderSettings } from '../../types';

interface Message {
  kind: 'success' | 'error';
  text: string;
}

const AI_PROVIDERS: Array<{ value: AIProviderName; label: string }> = [
  { value: 'mock', label: 'Mock' },
  { value: 'gpt4all', label: 'GPT4All' },
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
  gpt4all: 'http://127.0.0.1:4891/v1',
  mock: ''
};

const PRESTASHOP_VERSIONS = ['1.7', '8', '9'];

// Providers that run without an API key: the mock backend (no HTTP) and the
// local GPT4All server (OpenAI-compatible, accepts any request locally).
const PROVIDERS_WITHOUT_API_KEY: AIProviderName[] = ['mock', 'gpt4all'];

interface ConfigurationFormProps {
  onClose?: () => void;
}

// Collapsible section with the title on the left and the classic expand/collapse
// toggle button on the top-right corner. The body is only rendered while open.
function CollapsibleSection({
  title,
  open,
  onToggle,
  children
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`config-collapsible${open ? ' open' : ''}`}>
      <div className="config-collapsible-header">
        <h3>{title}</h3>
        <button
          type="button"
          className="config-collapsible-toggle"
          aria-expanded={open}
          aria-label={title}
          onClick={onToggle}
        >
          {open ? <FiChevronUp /> : <FiChevronDown />}
        </button>
      </div>
      {open && <div className="config-collapsible-body">{children}</div>}
    </div>
  );
}

export default function ConfigurationForm({ onClose }: ConfigurationFormProps) {
  const api = getApiService();
  const { t, language } = useI18n();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [version, setVersion] = useState('1.7');
  const [languageId, setLanguageId] = useState(1);
  const [aiProvider, setAiProvider] = useState<AIProviderName>('mock');
  // Per-provider settings being edited, so switching providers keeps each
  // provider's own values (and any unsaved edits) instead of overwriting them.
  const [aiDrafts, setAiDrafts] = useState<Partial<Record<AIProviderName, AIProviderSettings>>>({});
  const [defaultPrompts, setDefaultPrompts] = useState<Record<string, string>>({});
  const [useDefaultPrompt, setUseDefaultPrompt] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [openMarketplaces, setOpenMarketplaces] = useState(true);
  const [openAIProviders, setOpenAIProviders] = useState(true);
  const [openPrestashop, setOpenPrestashop] = useState(true);
  // Explicit collapse state per provider. The active provider stays expanded
  // unless the user collapses it explicitly.
  const [openProviderSubsections, setOpenProviderSubsections] = useState<Partial<Record<AIProviderName, boolean>>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getConfiguration(), api.getDefaultPrompt()])
      .then(([config, defaults]) => {
        if (cancelled) {
          return;
        }
        setDefaultPrompts(defaults?.data ?? {});
        if (config.prestashop) {
          setBaseUrl(config.prestashop.base_url ?? '');
          setApiKey(config.prestashop.api_key ?? '');
          setVersion(config.prestashop.version ?? '1.7');
          setLanguageId(config.prestashop.language_id ?? 1);
        }
        if (config.ai) {
          setAiProvider(config.ai.provider ?? 'mock');
          setAiDrafts({ ...(config.ai.providers ?? {}) });
          const customPrompt = config.ai.default_prompt;
          if (customPrompt) {
            setUseDefaultPrompt(false);
            setPrompt(customPrompt);
          } else {
            setUseDefaultPrompt(true);
            setPrompt('');
          }
        }
      })
      .catch(() => {
        // Defaults are fine when the endpoint is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const defaultPrompt = defaultPrompts[language] ?? '';
  // The field shows the system default (read-only) while "use default" is on,
  // and the custom editable prompt otherwise.
  const promptValue = useDefaultPrompt ? defaultPrompt : prompt;

  function updateAiSettings(provider: AIProviderName, patch: Partial<AIProviderSettings>): void {
    setAiDrafts((drafts) => ({
      ...drafts,
      [provider]: { ...(drafts[provider] ?? {}), ...patch }
    }));
  }

  function isProviderOpen(provider: AIProviderName): boolean {
    return openProviderSubsections[provider] ?? provider === aiProvider;
  }

  function toggleProvider(provider: AIProviderName): void {
    setOpenProviderSubsections((prev) => ({
      ...prev,
      [provider]: !(prev[provider] ?? provider === aiProvider)
    }));
  }

  function handleUseDefaultPromptChange(checked: boolean): void {
    if (!checked) {
      // Start editing from the currently shown value (default or custom).
      setPrompt(promptValue);
      setUseDefaultPrompt(false);
      return;
    }
    if (window.confirm(t('config.defaultPromptOverwriteWarning'))) {
      setPrompt('');
      setUseDefaultPrompt(true);
    }
  }

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

  async function handleTestAI(provider: AIProviderName) {
    const settings = aiDrafts[provider] ?? {};
    await run(
      () =>
        api.testAIConnection({
          provider,
          model: settings.model,
          api_key: settings.api_key,
          language: settings.language ?? language,
          base_url: settings.base_url,
          enabled_fields: ['name']
        }),
      t('config.aiOk')
    );
  }

  async function handleSave() {
    await run(
      () =>
        api.updateConfiguration({
          prestashop: { base_url: baseUrl, api_key: apiKey, version, language_id: languageId },
          ai: {
            provider: aiProvider,
            providers: aiDrafts,
            enabled_fields: ['name'],
            default_prompt: useDefaultPrompt ? '' : prompt
          }
        }),
      t('config.saved')
    );
  }

  function renderProviderFields(provider: AIProviderName) {
    const settings = aiDrafts[provider] ?? {};
    return (
      <>
        <div className="field">
          <label htmlFor={`ai-base-url-${provider}`}>{t('config.aiBaseUrl')}</label>
          <input
            id={`ai-base-url-${provider}`}
            type="text"
            value={settings.base_url || AI_PROVIDER_BASE_URLS[provider]}
            readOnly
            disabled={busy}
            placeholder="—"
          />
        </div>
        <div className="field">
          <label htmlFor={`ai-model-${provider}`}>{t('config.model')}</label>
          <input
            id={`ai-model-${provider}`}
            type="text"
            value={settings.model ?? ''}
            disabled={busy}
            onChange={(event) => updateAiSettings(provider, { model: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={`ai-language-${provider}`}>{t('config.aiLanguage')}</label>
          <input
            id={`ai-language-${provider}`}
            type="text"
            value={settings.language ?? language}
            disabled={busy}
            onChange={(event) => updateAiSettings(provider, { language: event.target.value })}
          />
        </div>
        {!PROVIDERS_WITHOUT_API_KEY.includes(provider) && (
          <div className="field">
            <label htmlFor={`ai-key-${provider}`}>{t('config.aiApiKey')}</label>
            <input
              id={`ai-key-${provider}`}
              type="password"
              value={settings.api_key ?? ''}
              disabled={busy}
              onChange={(event) => updateAiSettings(provider, { api_key: event.target.value })}
            />
          </div>
        )}
        <button type="button" className="btn" disabled={busy} onClick={() => handleTestAI(provider)}>
          {t('config.testAi')}
        </button>
      </>
    );
  }

  return (
    <section className="card">
      <h2>{t('config.title')}</h2>

      <CollapsibleSection
        title={t('config.marketplaces')}
        open={openMarketplaces}
        onToggle={() => setOpenMarketplaces((value) => !value)}
      >
        <CollapsibleSection
          title={t('config.prestashopSection')}
          open={openPrestashop}
          onToggle={() => setOpenPrestashop((value) => !value)}
        >
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
        </CollapsibleSection>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('config.aiSection')}
        open={openAIProviders}
        onToggle={() => setOpenAIProviders((value) => !value)}
      >
        <div className="field">
          <label htmlFor="ai-provider">{t('config.activeProvider')}</label>
          <select
            id="ai-provider"
            value={aiProvider}
            disabled={busy}
            onChange={(event) => {
              const value = event.target.value as AIProviderName;
              setAiProvider(value);
              setOpenProviderSubsections((prev) => ({ ...prev, [value]: true }));
            }}
          >
            {AI_PROVIDERS.map((provider) => (
              <option key={provider.value} value={provider.value}>
                {provider.label}
              </option>
            ))}
          </select>
        </div>

        {AI_PROVIDERS.map((provider) => (
          <CollapsibleSection
            key={provider.value}
            title={provider.label}
            open={isProviderOpen(provider.value)}
            onToggle={() => toggleProvider(provider.value)}
          >
            {renderProviderFields(provider.value)}
          </CollapsibleSection>
        ))}

        <div className="field">
          <label htmlFor="ai-default-prompt">{t('config.defaultPrompt')}</label>
          <textarea
            id="ai-default-prompt"
            rows={10}
            value={promptValue}
            readOnly={useDefaultPrompt}
            disabled={busy}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <label className="inline">
            <input
              type="checkbox"
              checked={useDefaultPrompt}
              disabled={busy}
              onChange={(event) => handleUseDefaultPromptChange(event.target.checked)}
            />
            {t('config.useDefaultPrompt')}
          </label>
        </div>
      </CollapsibleSection>

      <div style={{ marginTop: '0.75rem' }}>
        <button type="button" className="btn primary" disabled={busy} onClick={handleSave}>
          {t('config.save')}
        </button>
        {onClose && (
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {t('config.back')}
          </button>
        )}
      </div>

      {message && <div className={`message ${message.kind}`}>{message.text}</div>}
    </section>
  );
}
