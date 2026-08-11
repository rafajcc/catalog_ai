import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { useBackendStatus } from '../../hooks/useBackendStatus';
import { getApiService } from '../../services/api-service';
import { PrestaShopUploadStatus } from '../../types';
import AppHeader from '../../components/layout/AppHeader';
import UploadSection from '../../components/data-upload/UploadSection';
import ConfigurationForm from '../../components/configuration/ConfigurationForm';

export default function DashboardPage() {
  const { t } = useI18n();
  const [showConfiguration, setShowConfiguration] = useState(false);
  const [prestashop, setPrestashop] = useState<PrestaShopUploadStatus>({ present: false });
  const status = useBackendStatus();

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await getApiService().getPrestashopData();
        if (!active) return;
        const data = res?.data;
        if (data?.data_id) {
          setPrestashop({
            present: true,
            dataId: data.data_id,
            count: data.summary?.total ?? data.products?.length ?? 0
          });
        }
      } catch {
        /* backend may be offline */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function handlePrestashopReady(dataId: string, count: number) {
    setPrestashop({ present: true, dataId, count });
  }

  function handlePrestashopCleared() {
    setPrestashop({ present: false });
  }

  return (
    <div>
      <AppHeader
        status={status}
        configurationOpen={showConfiguration}
        onToggleConfiguration={() => setShowConfiguration((value) => !value)}
      />

      <main style={{ padding: '1.25rem', maxWidth: 900, margin: '0 auto' }}>
        {showConfiguration ? (
          <ConfigurationForm />
        ) : (
          <>
            <UploadSection
              prestashop={prestashop}
              onPrestashopReady={handlePrestashopReady}
              onPrestashopCleared={handlePrestashopCleared}
            />
            {!prestashop.present && (
              <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '0.8rem', marginTop: '1rem' }}>
                {t('dashboard.importHint')}
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
