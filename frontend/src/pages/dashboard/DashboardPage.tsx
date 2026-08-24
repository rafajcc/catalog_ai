import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { useBackendStatus } from '../../hooks/useBackendStatus';
import { PrestaShopUploadStatus, ProductEdits, ProductEditsMap } from '../../types';
import { getApiService } from '../../services/api-service';
import AppHeader from '../../components/layout/AppHeader';
import UploadSection, {
  DEFAULT_PRESTASHOP_FILTERS,
  PrestaShopFetchFilters
} from '../../components/data-upload/UploadSection';
import ConfigurationForm from '../../components/configuration/ConfigurationForm';
import ProductsViewPage from '../products/ProductsViewPage';
import UserManagementPage from '../users/UserManagementPage';

export interface DashboardPageProps {
  onLogout?: () => void;
}

export default function DashboardPage({ onLogout }: DashboardPageProps) {
  const { t } = useI18n();
  const [showConfiguration, setShowConfiguration] = useState(false);
  const [showProducts, setShowProducts] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: number; role: string; username: string; comercioName: string; prestashopConfigured: boolean } | null>(null);
  const [prestashop, setPrestashop] = useState<PrestaShopUploadStatus>({ present: false });
  const [filters, setFilters] = useState<PrestaShopFetchFilters>(DEFAULT_PRESTASHOP_FILTERS);
  const [edits, setEdits] = useState<ProductEditsMap>({});
  const [savedEdits, setSavedEdits] = useState<ProductEditsMap>({});
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const status = useBackendStatus();

  useEffect(() => {
    getApiService()
      .getMe()
      .then((res) => {
        if (res.success && res.user) {
          const prestashopConfigured = res.user.prestashop_configured ?? false;
          setCurrentUser({ id: res.user.id, role: res.user.role, username: res.user.username, comercioName: res.user.comercio_name ?? '', prestashopConfigured });
          if (res.user.role === 'admin' && !prestashopConfigured) {
            setShowConfiguration(true);
          }
        }
      })
      .catch(() => {});
  }, []);

  function handlePrestashopReady(dataId: string, count: number) {
    setPrestashop({ present: true, dataId, count });
    setEdits({});
    setSavedEdits({});
    setSelectedProductIds(new Set());
  }

  function confirmIfDirty(action: () => void) {
    if (configDirty && !window.confirm(t('config.unsavedWarning'))) return;
    action();
  }

  function handlePrestashopCleared() {
    setPrestashop({ present: false });
    setEdits({});
    setSavedEdits({});
    setSelectedProductIds(new Set());
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
    <div style={(showProducts || showConfiguration) ? { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' } : undefined}>
      <AppHeader
        status={status}
        configurationOpen={showConfiguration}
        onToggleConfiguration={() => {
          if (configDirty) {
            window.confirm(t('config.unsavedWarning')) && setShowConfiguration(false);
          } else {
            setShowConfiguration((value) => !value);
          }
          setShowProducts(false);
          setShowUsers(false);
        }}
        onHome={() => confirmIfDirty(() => {
          if (currentUser?.role === 'admin' && !currentUser?.prestashopConfigured) {
            setShowConfiguration(true);
          } else {
            setShowConfiguration(false);
          }
          setShowProducts(false);
          setShowUsers(false);
        })}
        onLogout={onLogout}
        onToggleUsers={currentUser?.role === 'admin' ? () => {
          if (configDirty) {
            window.confirm(t('config.unsavedWarning')) && (setShowConfiguration(false), setShowUsers(true));
          } else {
            setShowUsers((value) => !value);
            setShowConfiguration(false);
          }
        } : undefined}
        usersOpen={showUsers}
        comercioName={currentUser?.comercioName}
        username={currentUser?.username}
      />

      <main style={{ padding: (showProducts || showConfiguration) ? 0 : '1.25rem', maxWidth: (showProducts || showConfiguration || showUsers) ? 'none' : 900, margin: (showProducts || showConfiguration) ? 0 : '0 auto', flex: (showProducts || showConfiguration) ? 1 : undefined, overflow: (showProducts || showConfiguration) ? 'hidden' : undefined }}>
        {showConfiguration ? (
          <ConfigurationForm onClose={() => setShowConfiguration(false)} readOnly={currentUser?.role === 'user'} onDirtyChange={setConfigDirty} />
        ) : showProducts ? (
          <ProductsViewPage
            onBack={() => setShowProducts(false)}
            edits={edits}
            savedEdits={savedEdits}
            selectedProductIds={selectedProductIds}
            onSaveProduct={handleSaveProduct}
            onUndoProduct={handleUndoProduct}
            onSavedToPrestashop={handleSavedToPrestashop}
            onSelectedProductIdsChange={setSelectedProductIds}
          />
        ) : showUsers && currentUser ? (
          <UserManagementPage
            onBack={() => setShowUsers(false)}
            currentUserId={currentUser.id}
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
      {(showProducts || showConfiguration) ? null : (
      <footer style={{ textAlign: 'center', color: '#6b7280', fontSize: '0.7rem', padding: '1.5rem 0 0.5rem', borderTop: '1px solid #e5e7eb', marginTop: '2rem' }}>
        © 2026 Vera Technology
      </footer>
      )}
    </div>
  );
}
