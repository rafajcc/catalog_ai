import { useEffect, useRef, useState } from 'react';
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
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}

// Collapsible section with the title on the left and the classic expand/collapse
// toggle button on the top-right corner. The body is only rendered while open.
function CollapsibleSection({
  title,
  open,
  onToggle,
  variant = 'section',
  children
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  variant?: 'section' | 'subsection';
  children: ReactNode;
}) {
  return (
    <div className={`config-collapsible config-collapsible--${variant}${open ? ' open' : ''}`}>
      <div
        className="config-collapsible-header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={title}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <h3>{title}</h3>
        <span className="config-collapsible-icon" aria-hidden="true">
          {open ? <FiChevronUp /> : <FiChevronDown />}
        </span>
      </div>
      {open && <div className="config-collapsible-body">{children}</div>}
    </div>
  );
}

export default function ConfigurationForm({ onClose, readOnly, onDirtyChange }: ConfigurationFormProps) {
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
  const [messageSection, setMessageSection] = useState<'prestashop' | 'ai' | 'save' | null>(null);
  const disabledField = busy || readOnly;
  const [openMarketplaces, setOpenMarketplaces] = useState(true);
  const [openAIProviders, setOpenAIProviders] = useState(true);
  const [openPrestashop, setOpenPrestashop] = useState(true);
  // Explicit collapse state per provider. The active provider stays expanded
  // unless the user collapses it explicitly.
  const [openProviderSubsections, setOpenProviderSubsections] = useState<Partial<Record<AIProviderName, boolean>>>({});

  // Snapshot of the config as loaded from the server, used to detect unsaved changes.
  const initialRef = useRef<{
    baseUrl: string;
    apiKey: string;
    version: string;
    languageId: number;
    aiProvider: string;
    aiDrafts: string;
    useDefaultPrompt: boolean;
    prompt: string;
  } | null>(null);

  function captureInitial(values: {
    baseUrl: string;
    apiKey: string;
    version: string;
    languageId: number;
    aiProvider: string;
    aiDrafts: string;
    useDefaultPrompt: boolean;
    prompt: string;
  }) {
    initialRef.current = values;
  }

  function computeDirty(): boolean {
    const init = initialRef.current;
    if (!init) return false;
    return (
      baseUrl !== init.baseUrl ||
      apiKey !== init.apiKey ||
      version !== init.version ||
      languageId !== init.languageId ||
      aiProvider !== init.aiProvider ||
      JSON.stringify(aiDrafts) !== init.aiDrafts ||
      useDefaultPrompt !== init.useDefaultPrompt ||
      prompt !== init.prompt
    );
  }

  // Notify parent whenever dirty state changes.
  useEffect(() => {
    onDirtyChange?.(computeDirty());
  });

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
        // Capture initial values for dirty detection after all state is set.
        const loadedProvider = config.ai?.provider ?? 'mock';
        const loadedDrafts = config.ai?.providers ?? {};
        const loadedCustomPrompt = config.ai?.default_prompt;
        const loadedUseDefault = !loadedCustomPrompt;
        const loadedPrompt = loadedCustomPrompt ?? '';
        captureInitial({
          baseUrl: config.prestashop?.base_url ?? '',
          apiKey: config.prestashop?.api_key ?? '',
          version: config.prestashop?.version ?? '1.7',
          languageId: config.prestashop?.language_id ?? 1,
          aiProvider: loadedProvider,
          aiDrafts: JSON.stringify(loadedDrafts),
          useDefaultPrompt: loadedUseDefault,
          prompt: loadedPrompt
        });
      })
      .catch((error) => {
        console.error('[ConfigurationForm] Failed to load config or default prompt:', error);
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

  async function run(action: () => Promise<unknown>, successText: string, section: 'prestashop' | 'ai' | 'save') {
    setBusy(true);
    setMessage(null);
    setMessageSection(section);
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
      t('config.prestashopOk'),
      'prestashop'
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
      t('config.aiOk'),
      'ai'
    );
  }

  async function handleSave() {
    if (readOnly) {
      await run(
        () =>
          api.updateConfiguration({
            ai: {
              provider: aiProvider,
              enabled_fields: ['name'],
              default_prompt: useDefaultPrompt ? '' : prompt
            }
          }),
        t('config.saved'),
        'save'
      );
    } else {
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
        t('config.saved'),
        'save'
      );
    }
    // After a successful save, the current values become the new baseline.
    captureInitial({
      baseUrl,
      apiKey,
      version,
      languageId,
      aiProvider,
      aiDrafts: JSON.stringify(aiDrafts),
      useDefaultPrompt,
      prompt
    });
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
            disabled={disabledField}
            placeholder="—"
          />
        </div>
        <div className="field">
          <label htmlFor={`ai-model-${provider}`}>{t('config.model')}</label>
          <input
            id={`ai-model-${provider}`}
            type="text"
            value={settings.model ?? ''}
            disabled={disabledField}
            readOnly={readOnly}
            onChange={(event) => updateAiSettings(provider, { model: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={`ai-language-${provider}`}>{t('config.aiLanguage')}</label>
          <input
            id={`ai-language-${provider}`}
            type="text"
            value={settings.language ?? language}
            disabled={disabledField}
            readOnly={readOnly}
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
              disabled={disabledField}
              readOnly={readOnly}
              onChange={(event) => updateAiSettings(provider, { api_key: event.target.value })}
            />
          </div>
        )}
        <button type="button" className="btn" disabled={busy} onClick={() => handleTestAI(provider)}>
          {t('config.testAi')}
        </button>
        {message && messageSection === 'ai' && <div className={`message ${message.kind}`} style={{ marginTop: '0.5rem' }}>{message.text}</div>}
      </>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="products-toolbar" style={{ flexShrink: 0, background: '#ffffff', margin: 0, padding: '0.75rem 1.25rem', borderBottom: '1px solid #e5e7eb' }}>
        {onClose && (
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {t('config.back')}
          </button>
        )}
        <h2 className="products-title">{t('config.title')}</h2>
        <div className="products-toolbar-actions">
          <button type="button" className="btn primary" disabled={busy} onClick={handleSave}>
            {t('config.save')}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
        <section className="card" style={{ margin: 0 }}>

      <CollapsibleSection
        title={t('config.marketplaces')}
        open={openMarketplaces}
        onToggle={() => setOpenMarketplaces((value) => !value)}
      >
        <CollapsibleSection
          title={t('config.prestashopSection')}
          open={openPrestashop}
          onToggle={() => setOpenPrestashop((value) => !value)}
          variant="subsection"
        >
          <div className="field">
            <label htmlFor="ps-base-url">{t('config.baseUrl')}</label>
            <input
              id="ps-base-url"
              type="text"
              value={baseUrl}
              disabled={disabledField}
              readOnly={readOnly}
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
              disabled={disabledField}
              readOnly={readOnly}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ps-version">{t('config.version')}</label>
            <select
              id="ps-version"
              value={version}
              disabled={disabledField}
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
              disabled={disabledField}
              readOnly={readOnly}
              onChange={(event) => setLanguageId(Number(event.target.value))}
            />
          </div>
          <button type="button" className="btn" disabled={busy} onClick={handleTestPrestashop}>
            {t('config.testPrestashop')}
          </button>
          {message && messageSection === 'prestashop' && <div className={`message ${message.kind}`} style={{ marginTop: '0.5rem' }}>{message.text}</div>}
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
            disabled={disabledField}
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
            variant="subsection"
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

      {message && messageSection === 'save' && <div className={`message ${message.kind}`} style={{ marginTop: '0.5rem' }}>{message.text}</div>}
      </section>
      </div>
    </div>
  );
}
