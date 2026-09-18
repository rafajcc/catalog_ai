import { useState } from 'react';
import { I18nProvider } from './i18n';
import DashboardPage from './pages/dashboard/DashboardPage';
import LoginPage from './pages/auth/LoginPage';
import RegisterComercioPage from './pages/auth/RegisterComercioPage';
import ChangePasswordPage from './pages/auth/ChangePasswordPage';
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

  return <DashboardPage onLogout={handleLogout} />;
}

export default function App() {
  return (
    <I18nProvider>
      <AppRouter />
    </I18nProvider>
  );
}
