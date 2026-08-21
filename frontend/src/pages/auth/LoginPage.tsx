import { useState } from 'react';
import { useI18n } from '../../i18n';
import { getApiService } from '../../services/api-service';

interface LoginPageProps {
  onLogin: () => void;
  onRegister: () => void;
  header: React.ReactNode;
}

export default function LoginPage({ onLogin, onRegister, header }: LoginPageProps) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await getApiService().login(username, password);
      if (res.success) {
        onLogin();
      } else {
        setError(t('auth.loginError'));
      }
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || t('auth.loginError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      {header}
      <div className="auth-card">
        <div className="card">
        <h2>{t('auth.login')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="auth-username">{t('auth.username')}</label>
            <input
              id="auth-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="auth-password">{t('auth.password')}</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          {error && <p className="auth-error">{error}</p>}
          <button className="btn primary" type="submit" disabled={loading}>
            {loading ? '…' : t('auth.login')}
          </button>
        </form>
        <p className="auth-link">
          <button className="btn-link" type="button" onClick={onRegister}>
            {t('auth.registerLink')}
          </button>
        </p>
        <div className="auth-branding">
          <img src="/VERA-LOGO.svg" alt="Vera Technology" className="auth-branding-logo" />
        </div>
        </div>
      </div>
    </div>
  );
}
