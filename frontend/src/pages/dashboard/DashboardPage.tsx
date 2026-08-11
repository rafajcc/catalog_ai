import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { useBackendStatus } from '../../hooks/useBackendStatus';
import { getApiService } from '../../services/api-service';
import { PrestaShopUploadStatus, ProductEdits, ProductEditsMap } from '../../types';
import AppHeader from '../../components/layout/AppHeader';
import UploadSection, {
  DEFAULT_PRESTASHOP_FILTERS,
  PrestaShopFetchFilters
} from '../../components/data-upload/UploadSection';
import ConfigurationForm from '../../components/configuration/ConfigurationForm';
import ProductsViewPage from '../products/ProductsViewPage';

export default function DashboardPage() {
  const { t } = useI18n();
  const [showConfiguration, setShowConfiguration] = useState(false);
  const [showProducts, setShowProducts] = useState(false);
  const [prestashop, setPrestashop] = useState<PrestaShopUploadStatus>({ present: false });
  const [filters, setFilters] = useState<PrestaShopFetchFilters>(DEFAULT_PRESTASHOP_FILTERS);
  const [edits, setEdits] = useState<ProductEditsMap>({});
  const [savedEdits, setSavedEdits] = useState<ProductEditsMap>({});
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
    setEdits({});
    setSavedEdits({});
  }

  function handlePrestashopCleared() {
    setPrestashop({ present: false });
    setEdits({});
    setSavedEdits({});
  }

  function handleSaveProduct(productId: string, productEdits: ProductEdits) {
    setEdits((prev) => {
      const next = { ...prev };
      if (Object.keys(productEdits).length === 0) delete next[productId];
      else next[productId] = productEdits;
      return next;
    });
  }

  function handleUndoProduct(productId: string) {
    setEdits((prev) => {
      if (!(productId in prev)) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  }

  // Promotes the pending edits to "already pushed to PrestaShop" so the grid
  // keeps showing the new values without the edited markers.
  function handleSavedToPrestashop(saved: ProductEditsMap) {
    setSavedEdits((prev) => ({ ...prev, ...saved }));
    setEdits({});
  }

  return (
    <div>
      <AppHeader
        status={status}
        configurationOpen={showConfiguration}
        onToggleConfiguration={() => setShowConfiguration((value) => !value)}
        onHome={() => {
          setShowConfiguration(false);
          setShowProducts(false);
        }}
      />

      <main style={{ padding: '1.25rem', maxWidth: showProducts ? 1100 : 900, margin: '0 auto' }}>
        {showConfiguration ? (
          <ConfigurationForm />
        ) : showProducts ? (
          <ProductsViewPage
            onBack={() => setShowProducts(false)}
            edits={edits}
            savedEdits={savedEdits}
            onSaveProduct={handleSaveProduct}
            onUndoProduct={handleUndoProduct}
            onSavedToPrestashop={handleSavedToPrestashop}
          />
        ) : (
          <>
            <UploadSection
              prestashop={prestashop}
              filters={filters}
              edited={Object.keys(edits).length > 0}
              onFiltersChange={setFilters}
              onPrestashopReady={handlePrestashopReady}
              onPrestashopCleared={handlePrestashopCleared}
              onView={() => setShowProducts(true)}
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
