import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { getApiService } from '../../services/api-service';
import { ApiComercio, ApiImageProvider, ApiProviderFeedImage, ApiUser } from '../../types';

type View = { kind: 'list' } | { kind: 'users'; comercio: ApiComercio };

type Tab = 'comercios' | 'image-providers';

// Super admin workspace: list and activate/deactivate every registered
// comercio, inspect/reset the passwords of their users, and manage the shared
// image provider services (order, credentials, billing counters, feeds). Only
// reachable with a superadmin session (role === 'superadmin').
export default function SuperAdminPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('comercios');
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
        <div className="tabs" role="tablist">
          <button
            type="button"
            className={`tab ${tab === 'comercios' ? 'active' : ''}`}
            onClick={() => setTab('comercios')}
          >
            {t('superadmin.tabComercios')}
          </button>
          <button
            type="button"
            className={`tab ${tab === 'image-providers' ? 'active' : ''}`}
            onClick={() => setTab('image-providers')}
          >
            {t('superadmin.tabImageProviders')}
          </button>
        </div>
      </div>
      {error && <p className="message error">{error}</p>}
      {success && <p className="message success">{success}</p>}

      {tab === 'image-providers' ? (
        <ImageProvidersView
          onError={(msg) => setError(msg)}
          onSuccess={(msg) => setSuccess(msg)}
        />
      ) : view.kind === 'list' ? (
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

// One credential/extra field of the config modal. Sending an empty value keeps
// the stored one; the "clear" flag removes it (null on the API).
interface ConfigFieldState {
  value: string;
  clear: boolean;
}

function ImageProvidersView({
  onError,
  onSuccess
}: {
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [providers, setProviders] = useState<ApiImageProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [configOpen, setConfigOpen] = useState<ApiImageProvider | null>(null);

  async function loadProviders() {
    setLoading(true);
    try {
      const res = await getApiService().getImageProviders();
      if (res.success && Array.isArray(res.data)) {
        setProviders(res.data);
      }
    } catch {
      onError(t('iproviders.error'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProviders();
  }, []);

  const sorted = useMemo(() => [...providers].sort((a, b) => a.sort_order - b.sort_order), [providers]);

  async function handleToggle(p: ApiImageProvider) {
    if (p.enabled) {
      try {
        const res = await getApiService().updateImageProvider(p.slug, { enabled: false });
        if (res.success && res.data) {
          setProviders((prev) => prev.map((item) => (item.slug === p.slug ? res.data as ApiImageProvider : item)));
          onSuccess(t('iproviders.saved'));
        }
      } catch (err: any) {
        onError(err?.response?.data?.error?.message || t('iproviders.error'));
      }
      return;
    }

    const hasAnyCredential = p.has_api_key || p.has_username || p.has_password || p.extra_config.some((f) => f.configured);
    if (p.auth_kind !== 'none' && !hasAnyCredential && !window.confirm(t('iproviders.enableWarning'))) {
      return;
    }
    try {
      const res = await getApiService().updateImageProvider(p.slug, { enabled: true });
      if (res.success && res.data) {
        setProviders((prev) => prev.map((item) => (item.slug === p.slug ? res.data as ApiImageProvider : item)));
        onSuccess(t('iproviders.saved'));
      }
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || t('iproviders.error'));
    }
  }

  async function handleResetCalls(p: ApiImageProvider) {
    if (!window.confirm(t('iproviders.resetCallsConfirm', { name: p.name }))) return;
    try {
      await getApiService().resetImageProviderCalls(p.slug);
      await loadProviders();
      onSuccess(t('iproviders.saved'));
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || t('iproviders.error'));
    }
  }

  async function handleReorder(ordered: ApiImageProvider[]) {
    try {
      await getApiService().reorderImageProviders(ordered.map((p) => p.slug));
      await loadProviders();
      onSuccess(t('iproviders.orderSaved'));
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || t('iproviders.error'));
    }
  }

  return (
    <div>
      <p className="hint">{t('iproviders.intro')}</p>
      {loading ? (
        <p className="hint">{t('view.loading')}</p>
      ) : (
        <ProviderTable
          providers={sorted}
          onToggle={handleToggle}
          onConfigure={setConfigOpen}
          onResetCalls={handleResetCalls}
          onReorder={handleReorder}
        />
      )}
      <FeedsManager onError={onError} onSuccess={onSuccess} />
      {configOpen && (
        <ProviderConfigModal
          provider={configOpen}
          onClose={() => setConfigOpen(null)}
          onSaved={(updated) => {
            setProviders((prev) => prev.map((item) => (item.slug === updated.slug ? updated : item)));
            setConfigOpen(null);
            onSuccess(t('iproviders.saved'));
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function ProviderTable({
  providers,
  onToggle,
  onConfigure,
  onResetCalls,
  onReorder
}: {
  providers: ApiImageProvider[];
  onToggle: (p: ApiImageProvider) => void;
  onConfigure: (p: ApiImageProvider) => void;
  onResetCalls: (p: ApiImageProvider) => void;
  onReorder: (ordered: ApiImageProvider[]) => void;
}) {
  const { t } = useI18n();
  const [order, setOrder] = useState<ApiImageProvider[]>(providers);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    setOrder(providers);
  }, [providers]);

  const orderChanged = order.some((p, i) => p.slug !== providers[i]?.slug);

  function handleDragStart(index: number) {
    setDragIndex(index);
  }

  function handleDrop(index: number) {
    if (dragIndex === null || dragIndex === index) return;
    const next = [...order];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(index, 0, moved);
    setOrder(next);
    setDragIndex(null);
  }

  function configuredSummary(p: ApiImageProvider): string[] {
    const labels: string[] = [];
    if (p.has_api_key) labels.push(t('iproviders.apiKey'));
    if (p.has_username) labels.push(t('iproviders.username'));
    if (p.has_password) labels.push(t('iproviders.password'));
    for (const field of p.extra_config) {
      if (field.configured) labels.push(field.label);
    }
    return labels;
  }

  return (
    <>
      <table className="data">
        <thead>
          <tr>
            <th style={{ width: '2.2rem' }}></th>
            <th>{t('iproviders.order')}</th>
            <th>{t('iproviders.name')}</th>
            <th>{t('iproviders.status')}</th>
            <th>{t('iproviders.configured')}</th>
            <th>{t('iproviders.callsThisCycle')}</th>
            <th>{t('iproviders.cycle')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {order.map((p, index) => (
            <tr
              key={p.slug}
              draggable={!p.enabled || true}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(index)}
              className={dragIndex === index ? 'dragging' : p.last_called ? 'last-called' : ''}
            >
              <td style={{ cursor: 'grab' }} title="⋮⋮">⋮⋮</td>
              <td>{index + 1}</td>
              <td>
                {p.name}
                {!p.implemented && <span className="chip error" style={{ marginLeft: '0.5rem' }}>{t('iproviders.notImplemented')}</span>}
                {p.last_called && <span className="chip" style={{ marginLeft: '0.5rem' }}>{t('iproviders.lastCalled')}</span>}
              </td>
              <td>
                {p.enabled
                  ? <span className="chip">{t('superadmin.active')}</span>
                  : <span className="chip error">{t('superadmin.inactive')}</span>}
              </td>
              <td>
                {configuredSummary(p).length > 0
                  ? <span className="hint">{configuredSummary(p).join(', ')}</span>
                  : <span className="hint">{'—'}</span>}
              </td>
              <td>{p.calls_this_cycle}</td>
              <td>
                {p.billing_cycle_day ? (
                  <span className="hint">{t('iproviders.cycleDay')}: {p.billing_cycle_day}</span>
                ) : (
                  <span className="hint">{t('iproviders.cycleDayNone')}</span>
                )}
              </td>
              <td>
                <button className="btn btn-small" type="button" onClick={() => onConfigure(p)}>
                  {t('iproviders.configure')}
                </button>{' '}
                <button
                  className={`btn btn-small ${p.enabled ? 'btn-danger' : ''}`}
                  type="button"
                  disabled={!p.implemented}
                  onClick={() => onToggle(p)}
                >
                  {p.enabled ? t('iproviders.disable') : t('iproviders.enable')}
                </button>{' '}
                {p.calls_this_cycle > 0 && (
                  <button className="btn btn-small" type="button" onClick={() => onResetCalls(p)}>
                    {t('iproviders.resetCalls')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="users-toolbar" style={{ marginTop: '0.75rem' }}>
        <button className="btn" type="button" disabled={!orderChanged} onClick={() => onReorder(order)}>
          {t('iproviders.saveOrder')}
        </button>
        {orderChanged && <span className="hint">—</span>}
      </div>
    </>
  );
}

function ProviderConfigModal({
  provider,
  onClose,
  onSaved,
  onError
}: {
  provider: ApiImageProvider;
  onClose: () => void;
  onSaved: (updated: ApiImageProvider) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<Record<string, ConfigFieldState>>(() => {
    const initial: Record<string, ConfigFieldState> = {};
    const seed = (key: string, configured: boolean) => {
      initial[key] = { value: '', clear: false };
      void configured;
    };
    seed('api_key', provider.has_api_key);
    seed('username', provider.has_username);
    seed('password', provider.has_password);
    for (const field of provider.extra_config) {
      seed(field.key, field.configured);
    }
    return initial;
  });
  const [maxCalls, setMaxCalls] = useState(provider.max_calls_per_month ?? '');
  const [cycleDay, setCycleDay] = useState<number | null>(provider.billing_cycle_day);
  const cycleChanged = cycleDay !== provider.billing_cycle_day;

  const credentialKeys = provider.auth_kind === 'user_password' ? ['username', 'password'] : ['api_key'];

  function fieldLabel(key: string): string {
    switch (key) {
      case 'api_key':
        return t('iproviders.apiKey');
      case 'username':
        return t('iproviders.username');
      case 'password':
        return t('iproviders.password');
      default:
        return provider.extra_config.find((f) => f.key === key)?.label ?? key;
    }
  }

  function fieldConfigured(key: string): boolean {
    switch (key) {
      case 'api_key':
        return provider.has_api_key;
      case 'username':
        return provider.has_username;
      case 'password':
        return provider.has_password;
      default:
        return provider.extra_config.find((f) => f.key === key)?.configured ?? false;
    }
  }

  function setField(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: { ...prev[key], value, clear: false } }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const config: Record<string, unknown> = {};
      const allKeys = [...credentialKeys, ...provider.extra_config.map((f) => f.key)];
      for (const key of allKeys) {
        const state = fields[key] ?? { value: '', clear: false };
        if (state.clear) {
          config[key] = null;
        } else if (state.value.trim() !== '') {
          config[key] = state.value.trim();
        }
      }

      if (maxCalls.trim() !== '') {
        config.max_calls_per_month = maxCalls.trim();
      } else if (provider.max_calls_per_month) {
        config.max_calls_per_month = null;
      }

      const payload: Record<string, unknown> = {
        config,
        billing_cycle_day: cycleDay
      };
      if (cycleChanged) {
        payload.reset_calls = true;
      }

      const res = await getApiService().updateImageProvider(provider.slug, payload);
      if (res.success && res.data) {
        onSaved(res.data as ApiImageProvider);
      } else {
        onError(t('iproviders.error'));
        setSaving(false);
      }
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || t('iproviders.error'));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="users-title">{t('iproviders.configTitle', { name: provider.name })}</h3>
        <div className="modal-body">
          {provider.auth_kind !== 'none' ? (
            <>
              {credentialKeys.map((key) => (
                <label className="modal-field" key={key}>
                  <span>{fieldLabel(key)}</span>
                  <div className="modal-field-row">
                    <input
                      type={key === 'password' ? 'password' : 'text'}
                      value={fields[key]?.value ?? ''}
                      placeholder={fieldConfigured(key) ? t('iproviders.keyPlaceholder') : ''}
                      onChange={(e) => setField(key, e.target.value)}
                    />
                    <label className="modal-check">
                      <input
                        type="checkbox"
                        checked={fields[key]?.clear ?? false}
                        onChange={(e) => setFields((prev) => ({
                          ...prev,
                          [key]: { value: prev[key]?.value ?? '', clear: e.target.checked }
                        }))}
                      />
                      {t('iproviders.clearField')}
                    </label>
                  </div>
                </label>
              ))}
              {provider.extra_config.map((field) => (
                <label className="modal-field" key={field.key}>
                  <span>{field.label}{fieldConfigured(field.key) ? ' ✓' : ''}</span>
                  <div className="modal-field-row">
                    <input
                      type="text"
                      value={fields[field.key]?.value ?? ''}
                      placeholder={fieldConfigured(field.key) ? t('iproviders.keyPlaceholder') : ''}
                      onChange={(e) => setField(field.key, e.target.value)}
                    />
                    <label className="modal-check">
                      <input
                        type="checkbox"
                        checked={fields[field.key]?.clear ?? false}
                        onChange={(e) => setFields((prev) => ({
                          ...prev,
                          [field.key]: { value: prev[field.key]?.value ?? '', clear: e.target.checked }
                        }))}
                      />
                      {t('iproviders.clearField')}
                    </label>
                  </div>
                </label>
              ))}
            </>
          ) : (
            <p className="hint">{t('iproviders.cycleDayNone')}</p>
          )}

          <label className="modal-field">
            <span>{t('iproviders.maxCalls')}</span>
            <input
              type="number"
              min={1}
              value={maxCalls}
              placeholder={t('iproviders.maxCallsNone')}
              onChange={(e) => setMaxCalls(e.target.value)}
            />
          </label>

          <label className="modal-field">
            <span>{t('iproviders.cycleDay')}</span>
            <select
              value={cycleDay ?? ''}
              onChange={(e) => setCycleDay(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">{t('iproviders.cycleDayNone')}</option>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                <option key={day} value={day}>{day}</option>
              ))}
            </select>
          </label>

          {cycleChanged && <p className="message warning">{t('iproviders.cycleChangeWarning')}</p>}
        </div>
        <div className="modal-actions">
          <button className="btn btn-small" type="button" onClick={onClose} disabled={saving}>
            {t('iproviders.cancel')}
          </button>
          <button className="btn btn-small primary" type="button" onClick={handleSave} disabled={saving}>
            {t('iproviders.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function FeedsManager({
  onError,
  onSuccess
}: {
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [feeds, setFeeds] = useState<ApiProviderFeedImage[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ brand: '', reference: '', ean: '', image_url: '' });

  async function loadFeeds() {
    setLoading(true);
    try {
      const res = await getApiService().getProviderFeedImages(search.trim() || undefined);
      if (res.success && Array.isArray(res.data)) {
        setFeeds(res.data);
      }
    } catch {
      onError(t('iproviders.error'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      loadFeeds();
    }, 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    loadFeeds();
  }, []);

  async function handleAdd() {
    if (!form.brand.trim() || !form.image_url.trim()) return;
    setBusy(true);
    try {
      const res = await getApiService().addProviderFeedImage({
        brand: form.brand,
        reference: form.reference,
        ean: form.ean,
        image_url: form.image_url
      });
      if (res.success) {
        setForm({ brand: '', reference: '', ean: '', image_url: '' });
        await loadFeeds();
        onSuccess(t('iproviders.feedsAdded'));
      }
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || t('iproviders.error'));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: number) {
    setBusy(true);
    try {
      const res = await getApiService().deleteProviderFeedImage(id);
      if (res.success) {
        setFeeds((prev) => prev.filter((f) => f.id !== id));
        onSuccess(t('iproviders.feedsDeleted'));
      }
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || t('iproviders.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: '2rem' }}>
      <h3 className="users-title">{t('iproviders.feedsTitle')}</h3>
      <p className="hint">{t('iproviders.feedsIntro')}</p>

      <div className="feed-form">
        <input type="text" placeholder={t('iproviders.feedsBrand')} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
        <input type="text" placeholder={t('iproviders.feedsReference')} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
        <input type="text" placeholder={t('iproviders.feedsEan')} value={form.ean} onChange={(e) => setForm({ ...form, ean: e.target.value })} />
        <input
          type="text"
          placeholder={t('iproviders.feedsUrl')}
          value={form.image_url}
          onChange={(e) => setForm({ ...form, image_url: e.target.value })}
        />
        <button className="btn btn-small" type="button" onClick={handleAdd} disabled={busy || !form.brand.trim() || !form.image_url.trim()}>
          {t('iproviders.feedsAdd')}
        </button>
      </div>

      <div className="users-toolbar" style={{ marginTop: '0.75rem' }}>
        <input
          type="text"
          placeholder={t('iproviders.feedsSearch')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '16rem' }}
        />
      </div>

      {loading ? (
        <p className="hint">{t('view.loading')}</p>
      ) : feeds.length === 0 ? (
        <p className="hint">{t('iproviders.feedsEmpty')}</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>{t('iproviders.feedsBrand')}</th>
              <th>{t('iproviders.feedsReference')}</th>
              <th>{t('iproviders.feedsEan')}</th>
              <th>{t('iproviders.feedsUrl')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {feeds.map((feed) => (
              <tr key={feed.id}>
                <td>{feed.brand}</td>
                <td>{feed.reference ?? '—'}</td>
                <td>{feed.ean ?? '—'}</td>
                <td className="feed-url-cell">{feed.image_url}</td>
                <td>
                  <button className="btn btn-small btn-danger" type="button" onClick={() => handleDelete(feed.id)} disabled={busy}>
                    {t('iproviders.feedsDelete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}