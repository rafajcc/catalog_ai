import { useState } from 'react';
import { I18nProvider } from './i18n';
import DashboardPage from './pages/dashboard/DashboardPage';
import LoginPage from './pages/auth/LoginPage';
import RegisterComercioPage from './pages/auth/RegisterComercioPage';
import AppHeader from './components/layout/AppHeader';
import './styles/index.css';

type View = 'login' | 'register' | 'dashboard';

function AuthHeader() {
  return <AppHeader />;
}

function AppRouter() {
  const [view, setView] = useState<View>('login');

  if (view === 'register') {
    return (
      <RegisterComercioPage
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
