import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { getApiService } from '../../services/api-service';
import { getErrorMessage } from '../../utils/download';
import { useI18n } from '../../i18n';

interface Message {
  kind: 'success' | 'error';
  text: string;
}

const PRESTASHOP_VERSIONS = ['1.7', '8', '9'];

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
// connection and the custom prompt used by the AI autocomplete.
export default function ConfigurationForm({ onClose, readOnly, onDirtyChange }: ConfigurationFormProps) {
  const api = getApiService();
  const { t, language } = useI18n();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasPsApiKey, setHasPsApiKey] = useState(false);
  const [version, setVersion] = useState('1.7');
  const [languageId, setLanguageId] = useState(1);
  const [defaultPrompts, setDefaultPrompts] = useState<Record<string, string>>({});
  const [useDefaultPrompt, setUseDefaultPrompt] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [promptModalValue, setPromptModalValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [messageSection, setMessageSection] = useState<'prestashop' | 'save' | null>(null);
  const disabledField = busy || readOnly;
  const [openMarketplaces, setOpenMarketplaces] = useState(true);
  const [openPrompt, setOpenPrompt] = useState(true);
  const [openPrestashop, setOpenPrestashop] = useState(true);

  // Snapshot of the config as loaded from the server, used to detect unsaved changes.
  const initialRef = useRef<{
    baseUrl: string;
    apiKey: string;
    version: string;
    languageId: number;
    useDefaultPrompt: boolean;
    prompt: string;
  } | null>(null);

  function captureInitial(values: {
    baseUrl: string;
    apiKey: string;
    version: string;
    languageId: number;
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
  }, [api]);

  const defaultPrompt = defaultPrompts[language] ?? '';
  // The field shows the system default (read-only) while "use default" is on,
  // and the custom editable prompt otherwise.
  const promptValue = useDefaultPrompt ? defaultPrompt : prompt;

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

  async function run(action: () => Promise<unknown>, successText: string, section: 'prestashop' | 'save') {
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

  async function handleSave() {
    if (readOnly) {
      await run(
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
      await run(
        () =>
          api.updateConfiguration({
            prestashop: { base_url: baseUrl, api_key: apiKey, version, language_id: languageId },
            ai: {
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
      useDefaultPrompt,
      prompt
    });
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
