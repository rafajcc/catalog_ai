import { useEffect, useState } from 'react';
import { I18nProvider } from './i18n';
import DashboardPage from './pages/dashboard/DashboardPage';
import LoginPage from './pages/auth/LoginPage';
import RegisterComercioPage from './pages/auth/RegisterComercioPage';
import ChangePasswordPage from './pages/auth/ChangePasswordPage';
import LegalPage from './pages/legal/LegalPage';
import { LEGAL_DOCUMENTS, LegalDocument, legalDocumentFromPath, legalPath } from './pages/legal/legal-documents';
import AppHeader from './components/layout/AppHeader';
import { getApiService } from './services/api-service';
import './styles/index.css';

type View = 'login' | 'register' | 'dashboard' | 'change-password';

function AuthHeader() {
  return <AppHeader />;
}

function AppRouter() {
  const [view, setView] = useState<View>('login');
  const [pendingUser, setPendingUser] = useState<string | undefined>();
  const [legalDoc, setLegalDoc] = useState<LegalDocument | null>(() =>
    legalDocumentFromPath(window.location.pathname)
  );

  // The app has no URL-based routing: every view is in-memory state, so the
  // address bar keeps whatever path the server's SPA fallback served
  // (index.html for any GET). Legal pages are the exception: they have their own
  // public URL so they can be linked and opened directly. Any other path is
  // normalized back to the app root, which is the real URL of the login screen.
  useEffect(() => {
    if (!legalDocumentFromPath(window.location.pathname) && window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/');
    }
    const handlePopState = () => {
      setLegalDoc(legalDocumentFromPath(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Search engines must not index the legal pages: the backend also sends an
  // X-Robots-Tag header, this meta tag covers the client-side navigation.
  useEffect(() => {
    const isTest = document.querySelector<HTMLMetaElement>('meta[name="app-env"]')?.content === 'test';
    const prefix = isTest ? 'Test ' : '';
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (legalDoc) {
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'robots';
        document.head.appendChild(meta);
      }
      meta.content = 'noindex, nofollow';
      const label = LEGAL_DOCUMENTS.find((item) => item.id === legalDoc)?.label ?? 'Información legal';
      document.title = `${prefix}${label} — Catálogo IA`;
    } else {
      if (meta) meta.remove();
      document.title = `${prefix}Catálogo IA - Vera Technology`;
    }
  }, [legalDoc]);

  function openLegal(next: LegalDocument) {
    const nextPath = legalPath(next);
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, '', nextPath);
    }
    setLegalDoc(next);
  }

  function closeLegal() {
    // Replace instead of push so closing the document does not leave a
    // duplicate entry in the browser history.
    if (window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/');
    }
    setLegalDoc(null);
  }

  function handleLogout() {
    // The backend drops the comercio's loaded dataset on logout, so the next
    // login always starts from the product search screen with no leftover data.
    localStorage.removeItem('auth_token');
    getApiService()
      .logout()
      .catch(() => {});
    setPendingUser(undefined);
    setView('login');
  }

  if (legalDoc) {
    return <LegalPage document={legalDoc} onOpen={openLegal} onBack={closeLegal} />;
  }

  if (view === 'register') {
    return (
      <RegisterComercioPage
        onBackToLogin={() => setView('login')}
        onOpenLegal={openLegal}
        header={<AuthHeader />}
      />
    );
  }

  if (view === 'login') {
    return (
      <LoginPage
        onLogin={(user) => {
          if (user?.must_change_password) {
            // The user logged in with a temporary password handed over by an
            // admin/super admin: force the change before anything else.
            setPendingUser(user.username);
            setView('change-password');
          } else {
            setView('dashboard');
          }
        }}
        onRegister={() => setView('register')}
        onOpenLegal={openLegal}
        header={<AuthHeader />}
      />
    );
  }

  if (view === 'change-password') {
    return (
      <ChangePasswordPage
        username={pendingUser}
        onDone={() => setView('dashboard')}
        header={<AuthHeader />}
      />
    );
  }

  return <DashboardPage onLogout={handleLogout} onOpenLegal={openLegal} />;
}

export default function App() {
  return (
    <I18nProvider>
      <AppRouter />
    </I18nProvider>
  );
}
