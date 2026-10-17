import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { getApiService } from '../../services/api-service';
import { getErrorMessage } from '../../utils/download';
import { useI18n } from '../../i18n';
import { AIProviderName, AIProviderSettings, MarketplaceName } from '../../types';

interface Message {
  kind: 'success' | 'error';
  text: string;
}

const AI_PROVIDERS: Array<{ value: AIProviderName; label: string }> = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'mock', label: 'Mock' },
  { value: 'openai', label: 'OpenAI' },
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

const MARKETPLACES: Array<{ value: MarketplaceName; label: string }> = [
  { value: 'PrestaShop', label: 'PrestaShop' },
  { value: 'Shopify', label: 'Shopify' }
];

const SHOPIFY_API_VERSIONS = ['2026-07', '2026-04', '2026-01', '2025-10'];

// Providers that run without an API key (the mock backend makes no HTTP calls).
const PROVIDERS_WITHOUT_API_KEY: AIProviderName[] = ['mock'];

interface ConfigurationFormProps {
  onClose?: () => void;
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: (config: { active_marketplace: MarketplaceName }) => void;
}

// Collapsible section with the title on the left and the classic expand/collapse
// toggle button on the top-right corner. The body is only rendered while open.
function CollapsibleSection({
  title,
  open,
  onToggle,
  variant = 'section',
  className = '',
  badge,
  children
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  variant?: 'section' | 'subsection';
  className?: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`config-collapsible config-collapsible--${variant}${open ? ' open' : ''}${className ? ' ' + className : ''}`}>
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
        <h3>
          {title}
          {badge}
        </h3>
        <span className="config-collapsible-icon" aria-hidden="true">
          {open ? <FiChevronUp /> : <FiChevronDown />}
        </span>
      </div>
      {open && <div className="config-collapsible-body">{children}</div>}
    </div>
  );
}

export default function ConfigurationForm({ onClose, readOnly, onDirtyChange, onSaved }: ConfigurationFormProps) {
  const api = getApiService();
  const { t, language } = useI18n();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasPsApiKey, setHasPsApiKey] = useState(false);
  const [version, setVersion] = useState('1.7');
  const [languageId, setLanguageId] = useState(1);
  const [activeMarketplace, setActiveMarketplace] = useState<MarketplaceName>('PrestaShop');
  const [shopDomain, setShopDomain] = useState('');
  const [shopifyAccessToken, setShopifyAccessToken] = useState('');
  const [hasShopifyToken, setHasShopifyToken] = useState(false);
  const [shopifyApiVersion, setShopifyApiVersion] = useState('2026-07');
  const [aiProvider, setAiProvider] = useState<AIProviderName>('mock');
  // Per-provider settings being edited, so switching providers keeps each
  // provider's own values (and any unsaved edits) instead of overwriting them.
  const [aiDrafts, setAiDrafts] = useState<Partial<Record<AIProviderName, AIProviderSettings>>>({});
  const [hasAiApiKeys, setHasAiApiKeys] = useState<Partial<Record<AIProviderName, boolean>>>({});
  const [defaultPrompts, setDefaultPrompts] = useState<Record<string, string>>({});
  const [useDefaultPrompt, setUseDefaultPrompt] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [promptModalValue, setPromptModalValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [messageSection, setMessageSection] = useState<'prestashop' | 'shopify' | 'ai' | 'save' | null>(null);
  const [messageProvider, setMessageProvider] = useState<AIProviderName | null>(null);
  const disabledField = busy || readOnly;
  const [openMarketplaces, setOpenMarketplaces] = useState(true);
  const [openAIProviders, setOpenAIProviders] = useState(true);
  const [openPrestashop, setOpenPrestashop] = useState(true);
  const [openShopify, setOpenShopify] = useState(true);
  // Explicit collapse state per provider. The active provider stays expanded
  // unless the user collapses it explicitly.
  const [openProviderSubsections, setOpenProviderSubsections] = useState<Partial<Record<AIProviderName, boolean>>>({});

  // Snapshot of the config as loaded from the server, used to detect unsaved changes.
  const initialRef = useRef<{
    baseUrl: string;
    apiKey: string;
    version: string;
    languageId: number;
    activeMarketplace: MarketplaceName;
    shopDomain: string;
    shopifyAccessToken: string;
    shopifyApiVersion: string;
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
    activeMarketplace: MarketplaceName;
    shopDomain: string;
    shopifyAccessToken: string;
    shopifyApiVersion: string;
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
      activeMarketplace !== init.activeMarketplace ||
      shopDomain !== init.shopDomain ||
      shopifyAccessToken !== init.shopifyAccessToken ||
      shopifyApiVersion !== init.shopifyApiVersion ||
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
          setHasPsApiKey(config.prestashop.has_api_key ?? false);
          setVersion(config.prestashop.version ?? '1.7');
          setLanguageId(config.prestashop.language_id ?? 1);
        }
        if (config.active_marketplace) {
          setActiveMarketplace(config.active_marketplace);
        }
        if (config.shopify) {
          setShopDomain(config.shopify.shop_domain ?? '');
          setShopifyAccessToken(config.shopify.access_token ?? '');
          setHasShopifyToken(config.shopify.has_api_key ?? false);
          setShopifyApiVersion(config.shopify.api_version ?? '2026-07');
        }
        if (config.ai) {
          setAiProvider(config.ai.provider ?? 'mock');
          setAiDrafts({ ...(config.ai.providers ?? {}) });
          const aiHasKeyMap: Partial<Record<AIProviderName, boolean>> = {};
          if (config.ai.providers) {
            for (const [name, settings] of Object.entries(config.ai.providers)) {
              aiHasKeyMap[name as AIProviderName] = (settings as any)?.has_api_key ?? false;
            }
          }
          setHasAiApiKeys(aiHasKeyMap);
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
          activeMarketplace: config.active_marketplace ?? 'PrestaShop',
          shopDomain: config.shopify?.shop_domain ?? '',
          shopifyAccessToken: config.shopify?.access_token ?? '',
          shopifyApiVersion: config.shopify?.api_version ?? '2026-07',
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

  function openPromptModal(): void {
    if (busy) return;
    setPromptModalValue(promptValue);
    setPromptModalOpen(true);
  }

  function applyPromptModal(): void {
    if (!useDefaultPrompt) {
      setPrompt(promptModalValue);
    } else if (promptModalValue !== defaultPrompt) {
      // Typing in the modal while the default prompt is shown turns it into a
      // custom prompt, mirroring what unchecking the checkbox would do.
      setPrompt(promptModalValue);
      setUseDefaultPrompt(false);
    }
    setPromptModalOpen(false);
  }

  async function run(action: () => Promise<unknown>, successText: string, section: 'prestashop' | 'shopify' | 'ai' | 'save', provider?: AIProviderName): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    setMessageSection(section);
    setMessageProvider(provider ?? null);
    try {
      await action();
      setMessage({ kind: 'success', text: successText });
      return true;
    } catch (error) {
      setMessage({ kind: 'error', text: getErrorMessage(error) });
      return false;
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

  async function handleTestShopify() {
    await run(
      () => api.testShopifyConnection({ shop_domain: shopDomain, access_token: shopifyAccessToken, api_version: shopifyApiVersion }),
      t('config.shopifyOk'),
      'shopify'
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
          timeout: settings.timeout ?? undefined,
          enabled_fields: ['name']
        }),
      t('config.aiOk'),
      'ai',
      provider
    );
  }

  async function handleSave() {
    let ok: boolean;
    if (readOnly) {
      ok = await run(
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
      ok = await run(
        () =>
          api.updateConfiguration({
            prestashop: { base_url: baseUrl, api_key: apiKey, version, language_id: languageId },
            shopify: { shop_domain: shopDomain, access_token: shopifyAccessToken, api_version: shopifyApiVersion },
            active_marketplace: activeMarketplace,
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
    if (!ok) return;
    // After a successful save, the current values become the new baseline.
    captureInitial({
      baseUrl,
      apiKey,
      version,
      languageId,
      activeMarketplace,
      shopDomain,
      shopifyAccessToken,
      shopifyApiVersion,
      aiProvider,
      aiDrafts: JSON.stringify(aiDrafts),
      useDefaultPrompt,
      prompt
    });
    onSaved?.({ active_marketplace: activeMarketplace });
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
            disabled={disabledField}
            readOnly={readOnly}
            autoComplete="off"
            onChange={(event) => updateAiSettings(provider, { base_url: event.target.value })}
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
            autoComplete="off"
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
            autoComplete="off"
            onChange={(event) => updateAiSettings(provider, { language: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={`ai-timeout-${provider}`}>{t('config.aiTimeout')}</label>
          <input
            id={`ai-timeout-${provider}`}
            type="number"
            min={1}
            value={settings.timeout ?? ''}
            placeholder={t('config.aiTimeoutPlaceholder')}
            disabled={disabledField}
            readOnly={readOnly}
            autoComplete="off"
            onChange={(event) =>
              updateAiSettings(provider, { timeout: event.target.value === '' ? null : Number(event.target.value) })
            }
          />
        </div>
        <div className="field">
          <label htmlFor={`ai-concurrency-${provider}`}>{t('config.aiConcurrency')}</label>
          <input
            id={`ai-concurrency-${provider}`}
            type="number"
            min={1}
            max={50}
            value={settings.concurrency ?? ''}
            placeholder={t('config.aiConcurrencyPlaceholder')}
            disabled={disabledField}
            readOnly={readOnly}
            autoComplete="off"
            onChange={(event) =>
              updateAiSettings(provider, { concurrency: event.target.value === '' ? null : Number(event.target.value) })
            }
          />
        </div>
        {provider === 'openai' && (
          <div className="field">
            <label className="inline">
              <input
                id={`ai-web-search-${provider}`}
                type="checkbox"
                checked={settings.web_search ?? true}
                disabled={disabledField}
                onChange={(event) => updateAiSettings(provider, { web_search: event.target.checked })}
              />
              {t('config.aiWebSearch')}
            </label>
            <span className="field-hint">{t('config.aiWebSearchHint')}</span>
          </div>
        )}
        {!PROVIDERS_WITHOUT_API_KEY.includes(provider) && (
          <div className="field">
            <label htmlFor={`ai-key-${provider}`}>{t('config.aiApiKey')}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                id={`ai-key-${provider}`}
                type="password"
                value={settings.api_key ?? ''}
                placeholder={hasAiApiKeys[provider] && !settings.api_key ? t('config.apiKeyPlaceholder') : ''}
                disabled={disabledField}
                readOnly={readOnly}
                autoComplete="off"
                onChange={(event) => { updateAiSettings(provider, { api_key: event.target.value }); setHasAiApiKeys((prev) => ({ ...prev, [provider]: false })); }}
                style={{ flex: 1 }}
              />
              {hasAiApiKeys[provider] && !settings.api_key && <span className="config-saved-badge">{t('config.apiKeySaved')}</span>}
            </div>
          </div>
        )}
        <button type="button" className="btn" disabled={busy} onClick={() => handleTestAI(provider)}>
          {t('config.testAi')}
        </button>
        {message && messageSection === 'ai' && messageProvider === provider && <div className={`message ${message.kind}`} style={{ marginTop: '0.5rem' }}>{message.text}</div>}
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
        <div className="field">
          <label htmlFor="active-marketplace">{t('config.activeMarketplace')}</label>
          <select
            id="active-marketplace"
            value={activeMarketplace}
            disabled={disabledField}
            onChange={(event) => setActiveMarketplace(event.target.value as MarketplaceName)}
          >
            {MARKETPLACES.map((marketplace) => (
              <option key={marketplace.value} value={marketplace.value}>
                {marketplace.label}
              </option>
            ))}
          </select>
        </div>
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
              autoComplete="off"
              placeholder={t('config.baseUrlPlaceholder')}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ps-api-key">{t('config.psApiKey')}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                id="ps-api-key"
                type="password"
                value={apiKey}
                placeholder={hasPsApiKey && !apiKey ? t('config.apiKeyPlaceholder') : ''}
                disabled={disabledField}
                readOnly={readOnly}
                autoComplete="off"
                onChange={(event) => { setApiKey(event.target.value); setHasPsApiKey(false); }}
                style={{ flex: 1 }}
              />
              {hasPsApiKey && !apiKey && <span className="config-saved-badge">{t('config.apiKeySaved')}</span>}
            </div>
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
              autoComplete="off"
              onChange={(event) => setLanguageId(Number(event.target.value))}
            />
          </div>
          <button type="button" className="btn" disabled={busy} onClick={handleTestPrestashop}>
            {t('config.testPrestashop')}
          </button>
          {message && messageSection === 'prestashop' && <div className={`message ${message.kind}`} style={{ marginTop: '0.5rem' }}>{message.text}</div>}
        </CollapsibleSection>

        <CollapsibleSection
          title={t('config.shopifySection')}
          open={openShopify}
          onToggle={() => setOpenShopify((value) => !value)}
          variant="subsection"
        >
          <div className="field">
            <label htmlFor="shop-domain">{t('config.shopDomain')}</label>
            <input
              id="shop-domain"
              type="text"
              value={shopDomain}
              disabled={disabledField}
              readOnly={readOnly}
              autoComplete="off"
              placeholder={t('config.shopDomainPlaceholder')}
              onChange={(event) => setShopDomain(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="shopify-token">{t('config.shopifyToken')}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                id="shopify-token"
                type="password"
                value={shopifyAccessToken}
                placeholder={hasShopifyToken && !shopifyAccessToken ? t('config.apiKeyPlaceholder') : ''}
                disabled={disabledField}
                readOnly={readOnly}
                autoComplete="off"
                onChange={(event) => { setShopifyAccessToken(event.target.value); setHasShopifyToken(false); }}
                style={{ flex: 1 }}
              />
              {hasShopifyToken && !shopifyAccessToken && <span className="config-saved-badge">{t('config.apiKeySaved')}</span>}
            </div>
          </div>
          <div className="field">
            <label htmlFor="shopify-api-version">{t('config.shopifyApiVersion')}</label>
            <select
              id="shopify-api-version"
              value={shopifyApiVersion}
              disabled={disabledField}
              onChange={(event) => setShopifyApiVersion(event.target.value)}
            >
              {SHOPIFY_API_VERSIONS.map((apiVersion) => (
                <option key={apiVersion} value={apiVersion}>
                  {apiVersion}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn" disabled={busy} onClick={handleTestShopify}>
            {t('config.testShopify')}
          </button>
          {message && messageSection === 'shopify' && <div className={`message ${message.kind}`} style={{ marginTop: '0.5rem' }}>{message.text}</div>}
        </CollapsibleSection>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('config.aiSection')}
        open={openAIProviders}
        onToggle={() => setOpenAIProviders((value) => !value)}
        className="config-collapsible--ai"
      >
        <div className="config-active-provider-wrapper">
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
            className={provider.value === aiProvider ? 'config-collapsible--is-active' : ''}
            badge={provider.value === aiProvider ? <span className="config-active-badge">{t('config.activeBadge')}</span> : undefined}
          >
            {renderProviderFields(provider.value)}
          </CollapsibleSection>
        ))}

        <div className="field">
          <label htmlFor="ai-default-prompt">{t('config.defaultPrompt')}</label>
          {useDefaultPrompt && (
            <p className="prompt-hint">{t('config.promptCustomHint')}</p>
          )}
          <textarea
            id="ai-default-prompt"
            rows={10}
            value={promptValue}
            readOnly
            disabled={busy}
            autoComplete="off"
            title={t('config.editPrompt')}
            onClick={openPromptModal}
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
      {promptModalOpen && (
        <div className="prompt-modal" role="dialog" aria-modal="true" aria-label={t('config.editPrompt')} onClick={() => setPromptModalOpen(false)}>
          <div className="prompt-modal-box" onClick={(event) => event.stopPropagation()}>
            <div className="prompt-modal-header">
              <h3 className="prompt-modal-title">{t('config.editPrompt')}</h3>
              <button type="button" className="prompt-modal-close" aria-label={t('config.back')} onClick={() => setPromptModalOpen(false)}>
                ×
              </button>
            </div>
            <textarea
              id="ai-default-prompt-edit"
              rows={16}
              autoFocus
              value={promptModalValue}
              aria-label={t('config.editPrompt')}
              autoComplete="off"
              onChange={(event) => setPromptModalValue(event.target.value)}
            />
            <div className="prompt-modal-actions">
              <button type="button" className="btn" onClick={() => setPromptModalOpen(false)}>
                {t('config.promptCancel')}
              </button>
              <button type="button" className="btn primary" onClick={applyPromptModal}>
                {t('config.promptApply')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
