import { useState } from 'react';
import { useI18n } from '../../i18n';
import { getApiService } from '../../services/api-service';

interface RegisterComercioPageProps {
  onBackToLogin: () => void;
  header: React.ReactNode;
}

export default function RegisterComercioPage({ onBackToLogin, header }: RegisterComercioPageProps) {
  const { t } = useI18n();
  const [comercioName, setComercioName] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [nonce, setNonce] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await getApiService().registerComercio(comercioName, adminUsername, adminPassword, nonce.trim());
      if (res.success) {
        setSuccess(true);
      } else {
        setError(t('auth.registerError'));
      }
    } catch (err: any) {
      const code = err?.response?.data?.error?.code;
      if (code === 'INVALID_INVITATION_CODE') {
        setError(t('auth.registerNonceInvalid'));
      } else if (code === 'USERNAME_TAKEN') {
        setError(t('auth.registerUsernameTaken'));
      } else if (code === 'MISSING_FIELDS') {
        setError(t('auth.registerMissingFields'));
      } else if (err?.response?.status === 409) {
        setError(t('auth.registerSlugConflict'));
      } else {
        setError(err?.response?.data?.error?.message || t('auth.registerError'));
      }
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="auth-page">
        {header}
        <div className="auth-card">
          <div className="card">
            <h2>{t('auth.registerTitle')}</h2>
            <div className="message success">{t('auth.registerSuccess')}</div>
            <p className="auth-link">
              <button className="btn primary" type="button" onClick={onBackToLogin}>
                {t('auth.goToLogin')}
              </button>
            </p>
            <div className="auth-branding">
              <img src="/VERA-LOGO-text_only.svg" alt="Vera Technology" className="auth-branding-logo" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      {header}
      <div className="auth-card">
        <div className="card">
        <h2>{t('auth.registerTitle')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="reg-comercio">{t('auth.registerComercioName')}</label>
            <input
              id="reg-comercio"
              type="text"
              value={comercioName}
              onChange={(e) => setComercioName(e.target.value)}
              placeholder={t('auth.registerComercioNamePlaceholder')}
              autoComplete="off"
              required
              minLength={2}
              maxLength={100}
            />
          </div>
          <div className="field">
            <label htmlFor="reg-username">{t('auth.registerAdminUser')}</label>
            <input
              id="reg-username"
              type="text"
              value={adminUsername}
              onChange={(e) => setAdminUsername(e.target.value)}
              required
              autoComplete="off"
              minLength={3}
              maxLength={30}
              pattern="[a-zA-Z0-9_]{3,30}"
            />
            <small className="field-hint">{t('auth.registerUsernameHint')}</small>
          </div>
          <div className="field">
            <label htmlFor="reg-password">{t('auth.registerAdminPassword')}</label>
            <input
              id="reg-password"
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              required
              autoComplete="off"
              minLength={8}
            />
            <small className="field-hint">{t('auth.registerPasswordHint')}</small>
          </div>
          <div className="field">
            <label htmlFor="reg-nonce">{t('auth.registerNonceLabel')}</label>
            <input
              id="reg-nonce"
              type="text"
              value={nonce}
              onChange={(e) => setNonce(e.target.value)}
              placeholder={t('auth.registerNoncePlaceholder')}
              autoComplete="off"
              required
              maxLength={30}
            />
            <small className="field-hint">{t('auth.registerNonceHint')}</small>
          </div>
          {error && <p className="auth-error">{error}</p>}
          <button className="btn primary" type="submit" disabled={loading}>
            {loading ? '…' : t('auth.registerSubmit')}
          </button>
        </form>
        <p className="auth-link">
          <button className="btn" type="button" onClick={onBackToLogin}>
            {t('auth.backToLogin')}
          </button>
        </p>
        <div className="auth-branding">
          <img src="/VERA-LOGO-text_only.svg" alt="Vera Technology" className="auth-branding-logo" />
        </div>
        </div>
      </div>
    </div>
  );
}
