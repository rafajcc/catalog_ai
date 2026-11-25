import { FormEvent, useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { getApiService } from '../../services/api-service';
import { ApiShopifySettings } from '../../types';

function errorMessage(error: unknown, fallback: string): string {
  const err = error as { response?: { data?: { error?: { message?: string } } } };
  return err?.response?.data?.error?.message || fallback;
}

// Super admin tab with the Shopify app credentials shared by every comercio.
// They identify Catalog AI itself, so a comercio never sees or types them: the
// per-comercio screen only holds the shop domain and the OAuth token obtained
// with these global credentials.
export default function ShopifySettingsTab({
  onError,
  onSuccess
}: {
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [apiVersion, setApiVersion] = useState('');
  const [settings, setSettings] = useState<ApiShopifySettings | null>(null);

  async function loadSettings() {
    setLoading(true);
    try {
      const res = await getApiService().getShopifySettings();
      if (res.success && res.data) {
        const data = res.data as ApiShopifySettings;
        setSettings(data);
        setClientId(data.client_id ?? '');
        setApiVersion(data.api_version ?? '');
      }
    } catch (err) {
      onError(errorMessage(err, t('shopifySettings.loadError')));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const typedSecret = clientSecret.trim();
      const res = await getApiService().updateShopifySettings({
        client_id: clientId.trim(),
        api_version: apiVersion.trim(),
        // Leaving the secret blank keeps the stored one; the backend treats an
        // empty string as "unchanged" and only clears it on an explicit null.
        ...(typedSecret ? { client_secret: typedSecret } : {})
      });
      if (res.success && res.data) {
        const data = res.data as ApiShopifySettings;
        setSettings(data);
        setClientId(data.client_id ?? '');
        setApiVersion(data.api_version ?? '');
        setClientSecret('');
        onSuccess(t('shopifySettings.saved'));
      }
    } catch (err) {
      onError(errorMessage(err, t('shopifySettings.error')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="hint">{t('shopifySettings.intro')}</p>
      {loading ? (
        <p className="hint">{t('view.loading')}</p>
      ) : (
        <form onSubmit={handleSubmit}>
          {settings && (
            <p className="hint">
              {settings.configured
                ? t('shopifySettings.configuredYes')
                : t('shopifySettings.configuredNo')}
              {settings.client_secret_hint
                ? ` — ${t('shopifySettings.clientSecretHint', { hint: settings.client_secret_hint })}`
                : ''}
            </p>
          )}
          <div className="field">
            <label htmlFor="shopify-client-id">{t('shopifySettings.clientId')}</label>
            <input
              id="shopify-client-id"
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="shopify-client-secret">{t('shopifySettings.clientSecret')}</label>
            <input
              id="shopify-client-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={t('shopifySettings.clientSecretPlaceholder')}
              autoComplete="new-password"
            />
          </div>
          <div className="field">
            <label htmlFor="shopify-api-version">{t('shopifySettings.apiVersion')}</label>
            <input
              id="shopify-api-version"
              type="text"
              value={apiVersion}
              onChange={(e) => setApiVersion(e.target.value)}
              placeholder="2026-07"
            />
          </div>
          <button className="btn primary" type="submit" disabled={saving}>
            {t('general.save')}
          </button>
        </form>
      )}
    </div>
  );
}
