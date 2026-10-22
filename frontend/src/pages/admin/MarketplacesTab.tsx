import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { getApiService } from '../../services/api-service';
import { ApiMarketplace } from '../../types';

function errorMessage(error: unknown, fallback: string): string {
  const err = error as { response?: { data?: { error?: { message?: string } } } };
  return err?.response?.data?.error?.message || fallback;
}

// Super admin tab with the platform-wide marketplace switch. Every comercio
// shares this list: a marketplace disabled here disappears from every comercio
// selector. Disabling one that some comercios have as their active marketplace
// keeps those comercios on it (nothing is reassigned), so the UI asks for
// confirmation first and lists who is affected.
export default function MarketplacesTab({
  onError,
  onSuccess
}: {
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [marketplaces, setMarketplaces] = useState<ApiMarketplace[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<ApiMarketplace | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadMarketplaces() {
    setLoading(true);
    try {
      const res = await getApiService().getMarketplaces();
      if (res.success && Array.isArray(res.data)) {
        setMarketplaces(res.data as ApiMarketplace[]);
      }
    } catch (err) {
      onError(errorMessage(err, t('marketplaces.error')));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMarketplaces();
  }, []);

  async function applyToggle(m: ApiMarketplace, enabled: boolean) {
    setSaving(true);
    try {
      const res = await getApiService().setMarketplaceEnabled(m.name, enabled);
      if (res.success) {
        setMarketplaces((prev) => prev.map((item) => (item.name === m.name ? { ...item, enabled } : item)));
        onSuccess(enabled ? t('marketplaces.enabledOk', { name: m.label }) : t('marketplaces.disabledOk', { name: m.label }));
        setPending(null);
      }
    } catch (err) {
      onError(errorMessage(err, t('marketplaces.error')));
    } finally {
      setSaving(false);
    }
  }

  function handleToggle(m: ApiMarketplace) {
    if (m.enabled) {
      // Disabling may strand comercios that use it: confirm first.
      setPending(m);
      return;
    }
    applyToggle(m, true);
  }

  return (
    <div>
      <p className="hint">{t('marketplaces.intro')}</p>
      {loading ? (
        <p className="hint">{t('view.loading')}</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>{t('marketplaces.name')}</th>
              <th>{t('marketplaces.status')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {marketplaces.map((m) => (
              <tr key={m.name}>
                <td>{m.label}</td>
                <td>
                  {m.enabled
                    ? <span className="chip">{t('superadmin.active')}</span>
                    : <span className="chip error">{t('superadmin.inactive')}</span>}
                </td>
                <td>
                  <button
                    className={`btn btn-small ${m.enabled ? 'btn-danger' : ''}`}
                    type="button"
                    onClick={() => handleToggle(m)}
                  >
                    {m.enabled ? t('marketplaces.disable') : t('marketplaces.enable')}
                  </button>
                </td>
              </tr>
            ))}
            {marketplaces.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign: 'center', color: '#6b7280' }}>—</td></tr>
            )}
          </tbody>
        </table>
      )}

      {pending && (
        <div className="modal-overlay" onClick={() => (!saving ? setPending(null) : undefined)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="users-title">{t('marketplaces.confirmTitle', { name: pending.label })}</h3>
            <div className="modal-body">
              {pending.in_use_by.length > 0 ? (
                <>
                  <p className="message error">
                    {t('marketplaces.inUseWarning', {
                      name: pending.label,
                      count: pending.in_use_by.length
                    })}
                  </p>
                  <ul>
                    {pending.in_use_by.map((c) => (
                      <li key={c.id}>{c.name}</li>
                    ))}
                  </ul>
                  <p className="hint">{t('marketplaces.inUseHint')}</p>
                </>
              ) : (
                <p>{t('marketplaces.confirmQuestion', { name: pending.label })}</p>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-small" type="button" disabled={saving} onClick={() => setPending(null)}>
                {t('marketplaces.cancel')}
              </button>
              <button className="btn btn-small btn-danger" type="button" disabled={saving} onClick={() => applyToggle(pending, false)}>
                {t('marketplaces.confirmDisable')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
