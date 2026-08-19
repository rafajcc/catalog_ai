import { useEffect, useState } from 'react';
import { I18nProvider } from './i18n';
import DashboardPage from './pages/dashboard/DashboardPage';
import LoginPage from './pages/auth/LoginPage';
import RegisterComercioPage from './pages/auth/RegisterComercioPage';
import AppHeader from './components/layout/AppHeader';
import { getApiService } from './services/api-service';
import './styles/index.css';

type View = 'login' | 'register' | 'dashboard';

function AuthHeader() {
  return <AppHeader />;
}

function AppRouter() {
  const [view, setView] = useState<View>('login');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    getApiService()
      .getMe()
      .then((res) => {
        if (res.success) setView('dashboard');
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  if (checking) return null;

  if (view === 'register') {
    return (
      <RegisterComercioPage
        onRegistered={() => setView('dashboard')}
        onBackToLogin={() => setView('login')}
        header={<AuthHeader />}
      />
    );
  }

  if (view === 'login') {
    return (
      <LoginPage
        onLogin={() => setView('dashboard')}
        onRegister={() => setView('register')}
        header={<AuthHeader />}
      />
    );
  }

  return <DashboardPage onLogout={() => setView('login')} />;
}

export default function App() {
  return (
    <I18nProvider>
      <AppRouter />
    </I18nProvider>
  );
}
