import { useState } from 'react';
import { useI18n } from '../../i18n';
import { getApiService } from '../../services/api-service';

interface ChangePasswordPageProps {
  username?: string;
  onDone: () => void;
  header: React.ReactNode;
}

// Full-screen page shown right after login when the backend reports a pending
// forced password change (the user logged in with a password chosen by an
// admin or the super admin).
export default function ChangePasswordPage({ username, onDone, header }: ChangePasswordPageProps) {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setLoading(true);
    try {
      const res = await getApiService().changePassword(currentPassword, newPassword);
      if (res.success) {
        onDone();
      } else {
        setError(t('auth.changePasswordError'));
      }
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || t('auth.changePasswordError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      {header}
      <div className="auth-card">
        <div className="card">
          <h2>{t('auth.changePassword')}</h2>
          <p className="input-hint">{t('auth.changePasswordRequired', { username: username ?? '' })}</p>
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="cp-current">{t('auth.currentPassword')}</label>
              <input
                id="cp-current"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="cp-new">{t('auth.newPassword')}</label>
              <input
                id="cp-new"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
              <span className="field-hint">{t('users.passwordHint')}</span>
            </div>
            <div className="field">
              <label htmlFor="cp-confirm">{t('auth.confirmPassword')}</label>
              <input
                id="cp-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
            {error && <p className="auth-error">{error}</p>}
            <button className="btn primary" type="submit" disabled={loading}>
              {loading ? '…' : t('auth.changePassword')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}