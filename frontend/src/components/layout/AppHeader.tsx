import { FiSettings } from 'react-icons/fi';
import { useI18n, Language } from '../../i18n';

const STATUS_KEYS: Record<string, string> = {
  'Online': 'status.online',
  'Offline': 'status.offline',
  'Degraded': 'status.degraded',
  'Checking…': 'status.checking'
};

const LANGUAGES: Array<{ value: Language; label: string }> = [
  { value: 'es', label: 'ES' },
  { value: 'en', label: 'EN' }
];

interface AppHeaderProps {
  status: string;
  configurationOpen?: boolean;
  onToggleConfiguration?: () => void;
}

export default function AppHeader({ status, configurationOpen, onToggleConfiguration }: AppHeaderProps) {
  const { language, setLanguage, t } = useI18n();
  const statusClass = status === 'Online' ? 'chip' : status === 'Offline' ? 'chip error' : 'chip';
  const statusText = STATUS_KEYS[status] ? t(STATUS_KEYS[status]) : status;

  return (
    <header
      style={{
        background: '#111827',
        color: '#ffffff',
        padding: '0.75rem 1.25rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}
    >
      <h1 style={{ margin: 0, fontSize: '1.1rem' }}>Catalog AI</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <span role="status">
          {t('header.statusLabel')} <span className={statusClass}>{statusText}</span>
        </span>
        <div
          role="group"
          aria-label={t('header.language')}
          style={{ display: 'flex', border: '1px solid #374151', borderRadius: '0.25rem', overflow: 'hidden' }}
        >
          {LANGUAGES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setLanguage(item.value)}
              aria-pressed={language === item.value}
              disabled={language === item.value}
              style={{
                background: language === item.value ? '#2563eb' : 'transparent',
                color: '#ffffff',
                border: 'none',
                padding: '0.25rem 0.6rem',
                fontSize: '0.8rem',
                cursor: 'pointer'
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onToggleConfiguration}
          aria-label={t('header.settings')}
          aria-pressed={configurationOpen === true}
          title={t('header.settings')}
          style={{
            background: configurationOpen ? '#2563eb' : 'transparent',
            color: '#ffffff',
            border: 'none',
            padding: '0.35rem',
            borderRadius: '0.25rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <FiSettings size={18} />
        </button>
      </div>
    </header>
  );
}
