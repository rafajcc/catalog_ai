import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { getApiService } from '../../services/api-service';
import { ApiUser } from '../../types';

interface UserManagementPageProps {
  onBack: () => void;
  currentUserId: number;
}

export default function UserManagementPage({ onBack, currentUserId }: UserManagementPageProps) {
  const { t } = useI18n();
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [creating, setCreating] = useState(false);
  const [success, setSuccess] = useState('');

  async function loadUsers() {
    try {
      setLoading(true);
      setError('');
      const res = await getApiService().getUsers();
      if (res.success && res.users) {
        setUsers(res.users);
      }
    } catch {
      setError(t('users.error'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError('');
    setSuccess('');
    try {
      const res = await getApiService().createUser(newUsername, newPassword, newRole);
      if (res.success) {
        setSuccess(t('users.created'));
        setNewUsername('');
        setNewPassword('');
        setNewRole('user');
        setShowForm(false);
        await loadUsers();
      }
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || t('users.error'));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(user: ApiUser) {
    if (!window.confirm(t('users.deleteConfirm', { username: user.username }))) return;
    try {
      const res = await getApiService().deleteUser(user.id);
      if (res.success) {
        setSuccess(t('users.deleted'));
        await loadUsers();
      }
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || t('users.error'));
    }
  }

  async function handleToggleRole(user: ApiUser) {
    const newRoleValue = user.role === 'admin' ? 'user' : 'admin';
    try {
      const res = await getApiService().updateUser(user.id, { role: newRoleValue });
      if (res.success) {
        await loadUsers();
      }
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || t('users.error'));
    }
  }

  return (
    <div className="users-panel">
      <div className="users-toolbar">
        <button className="btn" type="button" onClick={onBack}>{t('users.back')}</button>
        <h2 className="users-title">{t('users.title')}</h2>
        <div className="users-toolbar-actions">
          <button className="btn primary" type="button" onClick={() => setShowForm(!showForm)}>
            {showForm ? t('users.cancel') : t('users.addUser')}
          </button>
        </div>
      </div>

      {error && <p className="message error">{error}</p>}
      {success && <p className="message success">{success}</p>}

      {showForm && (
        <div className="card">
          <form onSubmit={handleCreate}>
            <div className="field">
              <label htmlFor="new-username">{t('users.newUsername')}</label>
              <input
                id="new-username"
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                required
                autoFocus
              />
              <span className="field-hint">{t('users.usernameHint')}</span>
            </div>
            <div className="field">
              <label htmlFor="new-password">{t('users.newPassword')}</label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
              <span className="field-hint">{t('users.passwordHint')}</span>
            </div>
            <div className="field">
              <label htmlFor="new-role">{t('users.newRole')}</label>
              <select
                id="new-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as 'admin' | 'user')}
              >
                <option value="user">{t('users.roleUser')}</option>
                <option value="admin">{t('users.roleAdmin')}</option>
              </select>
            </div>
            <button className="btn primary" type="submit" disabled={creating}>
              {creating ? '…' : t('users.createUser')}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <p className="hint">{t('view.loading')}</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>{t('users.username')}</th>
              <th>{t('users.role')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  {user.username}
                  {user.id === currentUserId && <span className="users-you-badge"> (you)</span>}
                </td>
                <td>
                  <button
                    className="btn btn-small"
                    type="button"
                    onClick={() => handleToggleRole(user)}
                    disabled={user.id === currentUserId}
                    title={user.id === currentUserId ? t('users.cannotDeleteSelf') : undefined}
                  >
                    {user.role === 'admin' ? t('users.roleAdmin') : t('users.roleUser')}
                  </button>
                </td>
                <td>
                  <button
                    className="btn btn-small btn-danger"
                    type="button"
                    onClick={() => handleDelete(user)}
                    disabled={user.id === currentUserId}
                    title={user.id === currentUserId ? t('users.cannotDeleteSelf') : undefined}
                  >
                    {t('users.delete')}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign: 'center', color: '#6b7280' }}>—</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
