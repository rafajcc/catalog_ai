import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

var mockApi: any;

jest.mock('./services/api-service', () => ({
  getApiService: () => mockApi
}));

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockApi = {
      getSystemStatus: jest.fn().mockResolvedValue({ success: true, message: 'Online' }),
      getPrestashopData: jest.fn().mockResolvedValue({ success: true, data: null })
    };
  });

  it('renders the dashboard page in Spanish by default', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('En línea'));
    expect(screen.getByText('Importar desde PrestaShop')).toBeInTheDocument();
  });

  it('renders in English when the language preference is stored', async () => {
    window.localStorage.setItem('catalogai_lang', 'en');
    render(<App />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Online'));
    expect(screen.getByText('Import from PrestaShop')).toBeInTheDocument();
  });
});
