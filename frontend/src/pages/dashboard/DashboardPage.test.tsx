import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardPage from './DashboardPage';
import { renderWithI18n } from '../../test-utils';

var mockApi: any;

jest.mock('../../services/api-service', () => ({
  getApiService: () => mockApi
}));

describe('DashboardPage', () => {
  beforeEach(() => {
    mockApi = {
      getSystemStatus: jest.fn().mockResolvedValue({ success: true, message: 'Online' }),
      getPrestashopData: jest.fn().mockResolvedValue({ success: true, data: null }),
      fetchPrestashopData: jest.fn(),
      clearPrestashopData: jest.fn().mockResolvedValue({ success: true }),
      getConfiguration: jest.fn().mockResolvedValue({ success: true })
    };
  });

  it('shows the system status in the header', async () => {
    renderWithI18n(<DashboardPage />, 'en');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Online'));
  });

  it('shows Offline when the status request fails', async () => {
    mockApi.getSystemStatus.mockRejectedValue(new Error('down'));
    renderWithI18n(<DashboardPage />, 'en');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Offline'));
  });

  it('renders the PrestaShop import section by default', () => {
    renderWithI18n(<DashboardPage />, 'en');
    expect(screen.getByText('Import from PrestaShop')).toBeInTheDocument();
  });

  it('opens and closes the configuration view from the settings button', async () => {
    renderWithI18n(<DashboardPage />, 'en');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByText('Configuration')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('Import from PrestaShop')).toBeInTheDocument();
  });

  it('loads an existing PrestaShop dataset on mount', async () => {
    mockApi.getPrestashopData.mockResolvedValue({
      success: true,
      data: { data_id: 'ps-1', summary: { total: 2 } }
    });
    renderWithI18n(<DashboardPage />, 'en');

    await waitFor(() => expect(screen.getByText('2 products imported from PrestaShop')).toBeInTheDocument());
  });

  it('fetches PrestaShop data from the import section', async () => {
    mockApi.fetchPrestashopData.mockResolvedValue({
      success: true,
      data: { data_id: 'ps-1', summary: { total: 2 } }
    });
    renderWithI18n(<DashboardPage />, 'en');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Brand/), 'Sony');
    await user.click(screen.getByRole('button', { name: 'Fetch from PrestaShop' }));

    await waitFor(() => expect(screen.getByText('2 products imported from PrestaShop')).toBeInTheDocument());
  });

  it('keeps the import filters when navigating to settings and back', async () => {
    renderWithI18n(<DashboardPage />, 'en');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Brand/), 'Sony');
    await user.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByText('Configuration')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByLabelText(/Brand/)).toHaveValue('Sony');
  });

  it('removes the PrestaShop dataset via the clear button', async () => {
    mockApi.getPrestashopData.mockResolvedValue({
      success: true,
      data: { data_id: 'ps-1', summary: { total: 2 } }
    });
    renderWithI18n(<DashboardPage />, 'en');

    await waitFor(() => expect(screen.getByText('2 products imported from PrestaShop')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove imported data' }));

    expect(mockApi.clearPrestashopData).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText('2 products imported from PrestaShop')).not.toBeInTheDocument()
    );
  });

  it('opens the imported products view from the View button and navigates back', async () => {
    mockApi.getPrestashopData.mockResolvedValue({
      success: true,
      data: {
        data_id: 'ps-1',
        summary: { total: 1 },
        products: [{ id: 'ps_p7', name: 'Camiseta', reference: 'REF-001', images: [] }]
      }
    });
    renderWithI18n(<DashboardPage />, 'en');

    const user = userEvent.setup();
    const viewButton = await screen.findByRole('button', { name: 'View' });
    await user.click(viewButton);

    expect(await screen.findByText('Camiseta')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Import from PrestaShop')).toBeInTheDocument();
  });

  it('keeps the success message translated after switching the language', async () => {
    mockApi.fetchPrestashopData.mockResolvedValue({
      success: true,
      data: { data_id: 'ps-1', summary: { total: 22 } }
    });
    renderWithI18n(<DashboardPage />, 'es');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Llamar a PrestaShop' }));

    await waitFor(() =>
      expect(screen.getByText('Datos importados desde PrestaShop: 22 productos')).toBeInTheDocument()
    );

    await user.click(screen.getByRole('button', { name: 'EN' }));

    await waitFor(() => expect(screen.getByText('Imported 22 products from PrestaShop')).toBeInTheDocument());
  });
});
