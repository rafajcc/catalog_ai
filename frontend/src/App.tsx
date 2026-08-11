import { I18nProvider } from './i18n';
import DashboardPage from './pages/dashboard/DashboardPage';
import './styles/index.css';

export default function App() {
  return (
    <I18nProvider>
      <DashboardPage />
    </I18nProvider>
  );
}
