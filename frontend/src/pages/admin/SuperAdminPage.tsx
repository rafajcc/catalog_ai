import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { getApiService } from '../../services/api-service';
import { ApiComercio, ApiUser } from '../../types';

type View = { kind: 'list' } | { kind: 'users'; comercio: ApiComercio };

// Super admin workspace: list and activate/deactivate every registered
// comercio, and inspect/reset the passwords of their users. Only reachable
// with a superadmin session (role === 'superadmin').
export default function SuperAdminPage() {
  const { t } = useI18n();
  const [view, setView] = useState<View>({ kind: 'list' });
  const [comercios, setComercios] = useState<ApiComercio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadComercios() {
    setLoading(true);
    setError('');
    try {
      const res = await getApiService().getSuperAdminComercios();
      if (res.success && res.comercios) {
        setComercios(res.comercios);
      }
    } catch {
      setError(t('superadmin.error'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadComercios();
  }, []);

  async function handleToggleActive(c: ApiComercio) {
    setError('');
    setSuccess('');
    try {
      const res = await getApiService().setComercioActive(c.id, !c.active);
      if (res.success && res.comercio) {
        const updated = res.comercio as ApiComercio;
        setComercios((prev) => prev.map((item) => (item.id === c.id ? { ...item, active: updated.active, user_count: updated.user_count ?? item.user_count } : item)));
        if (view.kind === 'users' && view.comercio.id === c.id) {
          setView({ kind: 'users', comercio: { ...view.comercio, active: updated.active } });
        }
        setSuccess(t('superadmin.comercioUpdated'));
      }
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || t('superadmin.error'));
    }
  }

  return (
    <div className="superadmin-panel">
      <div className="users-toolbar">
        <h2 className="users-title">{t('superadmin.title')}</h2>
      </div>
      {error && <p className="message error">{error}</p>}
      {success && <p className="message success">{success}</p>}

      {view.kind === 'list' ? (
        loading ? (
          <p className="hint">{t('view.loading')}</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>{t('superadmin.comercio')}</th>
                <th>{t('superadmin.status')}</th>
                <th>{t('superadmin.userCount')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {comercios.map((comercio) => (
                <tr key={comercio.id}>
                  <td>{comercio.name}</td>
                  <td>
                    {comercio.active
                      ? <span className="chip">{t('superadmin.active')}</span>
                      : <span className="chip error">{t('superadmin.inactive')}</span>}
                  </td>
                  <td>{comercio.user_count}</td>
                  <td>
                    <button className="btn btn-small" type="button" onClick={() => setView({ kind: 'users', comercio })}>
                      {t('superadmin.viewUsers')}
                    </button>{' '}
                    <button
                      className={`btn btn-small ${comercio.active ? 'btn-danger' : ''}`}
                      type="button"
                      onClick={() => handleToggleActive(comercio)}
                    >
                      {comercio.active ? t('superadmin.deactivate') : t('superadmin.activate')}
                    </button>
                  </td>
                </tr>
              ))}
              {comercios.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: '#6b7280' }}>—</td></tr>
              )}
            </tbody>
          </table>
        )
      ) : (
        <ComercioUsersView
          comercio={view.comercio}
          onBack={() => setView({ kind: 'list' })}
          onError={(msg) => setError(msg)}
          onSuccess={(msg) => setSuccess(msg)}
        />
      )}
    </div>
  );
}

function ComercioUsersView({
  comercio,
  onBack,
  onError,
  onSuccess
}: {
  comercio: ApiComercio;
  onBack: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await getApiService().getSuperAdminComercioUsers(comercio.id);
      if (res.success && res.users) {
        setUsers(res.users);
      }
    } catch {
      onError(t('superadmin.error'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleReset(u: ApiUser) {
    const newPassword = window.prompt(t('superadmin.resetPasswordPrompt', { username: u.username }));
    if (!newPassword) return;
    try {
      const res = await getApiService().resetSuperAdminUserPassword(comercio.id, u.id, newPassword);
      if (res.success) {
        onSuccess(t('superadmin.resetDone', { username: u.username }));
        await loadUsers();
      }
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || t('superadmin.error'));
    }
  }

  return (
    <>
      <div className="users-toolbar">
        <button className="btn" type="button" onClick={onBack}>{t('superadmin.back')}</button>
        <h3 className="users-title">
          {t('superadmin.usersOf', { comercio: comercio.name })}
          {!comercio.active && <span className="chip error" style={{ marginLeft: '0.5rem' }}>{t('superadmin.inactive')}</span>}
        </h3>
      </div>

      {loading ? (
        <p className="hint">{t('view.loading')}</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>{t('users.username')}</th>
              <th>{t('users.role')}</th>
              <th>{t('users.mustChangePassword')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.username}</td>
                <td>{user.role === 'admin' ? t('users.roleAdmin') : t('users.roleUser')}</td>
                <td>
                  {user.must_change_password
                    ? <span className="chip">{t('users.pendingChange')}</span>
                    : <span className="hint" style={{ fontSize: '0.75rem' }}>{t('users.noPendingChange')}</span>}
                </td>
                <td>
                  <button className="btn btn-small" type="button" onClick={() => handleReset(user)}>
                    {t('users.resetPassword')}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: '#6b7280' }}>—</td></tr>
            )}
          </tbody>
        </table>
      )}
    </>
  );
}