import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { getApiService } from '../../services/api-service';
import { getErrorMessage } from '../../utils/download';
import { useI18n } from '../../i18n';
import { ConfigurationResponse, MarketplaceName } from '../../types';

interface Message {
  kind: 'success' | 'error';
  text: string;
}

const PRESTASHOP_VERSIONS = ['1.7', '8', '9'];

// Fallback list used until the server responds with the platform-wide switch
// state. The real list comes from GET /config, so a marketplace disabled by the
// super admin is filtered out of the selector.
const DEFAULT_MARKETPLACES: Array<{ value: MarketplaceName; label: string }> = [
  { value: 'PrestaShop', label: 'PrestaShop' },
  { value: 'Shopify', label: 'Shopify' },
  { value: 'Mock', label: 'Mock' }
];

const SHOPIFY_API_VERSIONS = ['2026-07', '2026-04', '2026-01', '2025-10'];

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

// Comercio settings screen. The AI providers are global and are managed by the
// super admin, so this screen only keeps what is per comercio: the PrestaShop
// and Shopify connections and the custom prompt used by the AI autocomplete.
export default function ConfigurationForm({ onClose, readOnly, onDirtyChange, onSaved }: ConfigurationFormProps) {
  const api = getApiService();
  const { t, language } = useI18n();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasPsApiKey, setHasPsApiKey] = useState(false);
  const [psApiKeyHint, setPsApiKeyHint] = useState<string | null>(null);
  const [version, setVersion] = useState('1.7');
  const [languageId, setLanguageId] = useState(1);
  const [activeMarketplace, setActiveMarketplace] = useState<MarketplaceName>('PrestaShop');
  const [marketplaces, setMarketplaces] = useState<Array<{ value: MarketplaceName; label: string; enabled: boolean }>>(
    DEFAULT_MARKETPLACES.map((m) => ({ ...m, enabled: true }))
  );
  const [shopDomain, setShopDomain] = useState('');
  const [shopifyAccessToken, setShopifyAccessToken] = useState('');
  const [hasShopifyToken, setHasShopifyToken] = useState(false);
  const [shopifyTokenHint, setShopifyTokenHint] = useState<string | null>(null);
  const [shopifyApiVersion, setShopifyApiVersion] = useState('2026-07');
  const [defaultPrompts, setDefaultPrompts] = useState<Record<string, string>>({});
  const [useDefaultPrompt, setUseDefaultPrompt] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [promptModalValue, setPromptModalValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [messageSection, setMessageSection] = useState<'prestashop' | 'shopify' | 'save' | null>(null);
  const disabledField = busy || readOnly;
  const [openMarketplaces, setOpenMarketplaces] = useState(true);
  const [openPrompt, setOpenPrompt] = useState(true);
  const [openPrestashop, setOpenPrestashop] = useState(true);
  const [openShopify, setOpenShopify] = useState(true);

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
      useDefaultPrompt !== init.useDefaultPrompt ||
      prompt !== init.prompt
    );
  }

  // Notify parent whenever dirty state changes.
  useEffect(() => {
    onDirtyChange?.(computeDirty());
  });

  // Credential state (saved badge + masked hint) that GET /config returns for
  // the marketplace secrets. Applied on load and again after every save so the
  // screen always reflects what is really stored instead of what was typed.
  const applyCredentialState = useCallback((config: ConfigurationResponse): void => {
    if (config.prestashop) {
      setHasPsApiKey(config.prestashop.has_api_key ?? false);
      setPsApiKeyHint(config.prestashop.api_key_hint ?? null);
    }
    if (config.shopify) {
      setHasShopifyToken(config.shopify.has_api_key ?? false);
      setShopifyTokenHint(config.shopify.api_key_hint ?? null);
    }
  }, []);

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
        if (config.active_marketplace) {
          setActiveMarketplace(config.active_marketplace);
        }
        if (Array.isArray(config.marketplaces) && config.marketplaces.length > 0) {
          setMarketplaces(config.marketplaces.map((m) => ({ value: m.name, label: m.label, enabled: m.enabled })));
        }
        if (config.shopify) {
          setShopDomain(config.shopify.shop_domain ?? '');
          setShopifyAccessToken(config.shopify.access_token ?? '');
          setShopifyApiVersion(config.shopify.api_version ?? '2026-07');
        }
        applyCredentialState(config);
        const customPrompt = config.ai?.default_prompt;
        if (customPrompt) {
          setUseDefaultPrompt(false);
          setPrompt(customPrompt);
        } else {
          setUseDefaultPrompt(true);
          setPrompt('');
        }
        // Capture initial values for dirty detection after all state is set.
        captureInitial({
          baseUrl: config.prestashop?.base_url ?? '',
          apiKey: config.prestashop?.api_key ?? '',
          version: config.prestashop?.version ?? '1.7',
          languageId: config.prestashop?.language_id ?? 1,
          activeMarketplace: config.active_marketplace ?? 'PrestaShop',
          shopDomain: config.shopify?.shop_domain ?? '',
          shopifyAccessToken: config.shopify?.access_token ?? '',
          shopifyApiVersion: config.shopify?.api_version ?? '2026-07',
          useDefaultPrompt: !customPrompt,
          prompt: customPrompt ?? ''
        });
      })
      .catch((error) => {
        console.error('[ConfigurationForm] Failed to load config or default prompt:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [api, applyCredentialState]);

  const defaultPrompt = defaultPrompts[language] ?? '';
  // The field shows the system default (read-only) while "use default" is on,
  // and the custom editable prompt otherwise.
  const promptValue = useDefaultPrompt ? defaultPrompt : prompt;

  // Options shown in the selector: only the enabled marketplaces, plus the
  // currently active one even if it was disabled platform-wide (so the select
  // keeps a matching option instead of going blank). When that happens the user
  // is warned and must pick another marketplace to operate.
  const enabledMarketplaces = marketplaces.filter((m) => m.enabled);
  const activeMarketplaceEnabled = marketplaces.some((m) => m.value === activeMarketplace && m.enabled);
  const marketplaceOptions = activeMarketplaceEnabled
    ? enabledMarketplaces
    : [
        ...enabledMarketplaces,
        {
          value: activeMarketplace,
          label: marketplaces.find((m) => m.value === activeMarketplace)?.label ?? activeMarketplace,
          enabled: false
        }
      ];

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

  async function run(action: () => Promise<unknown>, successText: string, section: 'prestashop' | 'shopify' | 'save'): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    setMessageSection(section);
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

  async function handleSave() {
    const typedApiKey = apiKey.trim();
    const typedAccessToken = shopifyAccessToken.trim();
    let ok: boolean;
    if (readOnly) {
      ok = await run(
        () =>
          api.updateConfiguration({
            ai: {
              enabled_fields: ['name'],
              default_prompt: useDefaultPrompt ? '' : prompt
            }
          }),
        t('config.saved'),
        'save'
      );
    } else {
      // Never resend an empty secret: leaving the field blank means "keep the
      // stored credential", so the key is simply omitted from the payload (the
      // backend preserves it) and the value is trimmed before it is sent.
      ok = await run(
        () =>
          api.updateConfiguration({
            prestashop: {
              base_url: baseUrl,
              version,
              language_id: languageId,
              ...(typedApiKey ? { api_key: typedApiKey } : {})
            },
            shopify: {
              shop_domain: shopDomain,
              api_version: shopifyApiVersion,
              ...(typedAccessToken ? { access_token: typedAccessToken } : {})
            },
            active_marketplace: activeMarketplace,
            ai: {
              enabled_fields: ['name'],
              default_prompt: useDefaultPrompt ? '' : prompt
            }
          }),
        t('config.saved'),
        'save'
      );
    }
    if (!ok) return;
    // Drop the typed plaintext from memory; the fields go back to the "saved"
    // state. The masked state is reloaded from the server so a save that did not
    // persist (e.g. a comercio without its marketplace rows) shows immediately
    // instead of failing later, when leaving the app and coming back.
    setApiKey('');
    setShopifyAccessToken('');
    if (typedApiKey) setHasPsApiKey(true);
    if (typedAccessToken) setHasShopifyToken(true);
    try {
      applyCredentialState(await api.getConfiguration());
    } catch {
      // The configuration was saved; failing to refresh the preview must not
      // turn the successful save into an error.
    }
    // After a successful save, the current values become the new baseline.
    captureInitial({
      baseUrl,
      apiKey: '',
      version,
      languageId,
      activeMarketplace,
      shopDomain,
      shopifyAccessToken: '',
      shopifyApiVersion,
      useDefaultPrompt,
      prompt
    });
    onSaved?.({ active_marketplace: activeMarketplace });
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
            {marketplaceOptions.map((marketplace) => (
              <option key={marketplace.value} value={marketplace.value}>
                {marketplace.label}
                {!marketplace.enabled ? ' ' + t('config.marketplaceDisabledOption') : ''}
              </option>
            ))}
          </select>
        </div>
        {!activeMarketplaceEnabled && (
          <p className="message error">{t('config.marketplaceDisabledWarning')}</p>
        )}
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
            <div className="field-header key-hint-row">
              <label htmlFor="ps-api-key">{t('config.psApiKey')}</label>
              {hasPsApiKey && psApiKeyHint && (
                <span className="config-key-hint" title={t('config.apiKeyHintTitle')}>
                  {psApiKeyHint}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                id="ps-api-key"
                type="password"
                value={apiKey}
                placeholder={hasPsApiKey && !apiKey ? t('config.apiKeyPlaceholder') : ''}
                disabled={disabledField}
                readOnly={readOnly}
                autoComplete="new-password"
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
            <div className="field-header key-hint-row">
              <label htmlFor="shopify-token">{t('config.shopifyToken')}</label>
              {hasShopifyToken && shopifyTokenHint && (
                <span className="config-key-hint" title={t('config.apiKeyHintTitle')}>
                  {shopifyTokenHint}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                id="shopify-token"
                type="password"
                value={shopifyAccessToken}
                placeholder={hasShopifyToken && !shopifyAccessToken ? t('config.apiKeyPlaceholder') : ''}
                disabled={disabledField}
                readOnly={readOnly}
                autoComplete="new-password"
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
        title={t('config.promptSection')}
        open={openPrompt}
        onToggle={() => setOpenPrompt((value) => !value)}
        className="config-collapsible--ai"
      >
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
