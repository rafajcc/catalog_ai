import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardPage from './DashboardPage';
import { renderWithI18n } from '../../test-utils';

var mockApi: any;

jest.mock('../../services/api-service', () => ({
  getApiService: () => mockApi
}));

async function fetchDataSuccessfully(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  mockApi.fetchPrestashopData.mockResolvedValue({
    success: true,
    data: { data_id: 'ps-1', summary: { total: 2 } }
  });
  await user.click(screen.getByRole('button', { name: 'Fetch from PrestaShop' }));
  await waitFor(() => expect(screen.getByText('2 products imported from PrestaShop')).toBeInTheDocument());
}

async function fetchDataWithProducts(user: ReturnType<typeof userEvent.setup>, products: Record<string, unknown>[]): Promise<void> {
  const responseData = {
    data_id: 'ps-1',
    summary: { total: products.length },
    products
  };
  mockApi.fetchPrestashopData.mockResolvedValue({
    success: true,
    data: responseData
  });
  mockApi.getPrestashopData.mockResolvedValue({
    success: true,
    data: responseData
  });
  await user.click(screen.getByRole('button', { name: 'Fetch from PrestaShop' }));
  await waitFor(() =>
    expect(
      screen.getByText(
        new RegExp(`${products.length} products? imported from PrestaShop`)
      )
    ).toBeInTheDocument()
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    mockApi = {
      getMe: jest.fn().mockResolvedValue({ success: true, user: { id: 1, username: 'admin', role: 'admin', comercio_id: 1 } }),
      getUsers: jest.fn().mockResolvedValue({ success: true, users: [] }),
      createUser: jest.fn().mockResolvedValue({ success: true }),
      updateUser: jest.fn().mockResolvedValue({ success: true }),
      deleteUser: jest.fn().mockResolvedValue({ success: true }),
      getSystemStatus: jest.fn().mockResolvedValue({ success: true, message: 'Online' }),
      getPrestashopData: jest.fn().mockResolvedValue({ success: true, data: null }),
      fetchPrestashopData: jest.fn(),
      clearPrestashopData: jest.fn().mockResolvedValue({ success: true }),
      getConfiguration: jest.fn().mockResolvedValue({ success: true }),
      getDefaultPrompt: jest.fn().mockResolvedValue({ success: true, data: {} })
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
    renderWithI18n(<DashboardPage />, 'en');
    const user = userEvent.setup();
    await fetchDataSuccessfully(user);

    await user.click(screen.getByRole('button', { name: 'Remove imported data' }));

    expect(mockApi.clearPrestashopData).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText('2 products imported from PrestaShop')).not.toBeInTheDocument()
    );
  });

  it('opens the imported products view from the View button and navigates back', async () => {
    renderWithI18n(<DashboardPage />, 'en');
    const user = userEvent.setup();
    await fetchDataWithProducts(user, [
      { id: 'ps_p7', name: 'Camiseta', reference: 'REF-001', images: [] }
    ]);

    await user.click(screen.getByRole('button', { name: 'View' }));

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

  it('keeps product edits when navigating away from and back to the products view', async () => {
    renderWithI18n(<DashboardPage />, 'en');
    const user = userEvent.setup();
    await fetchDataWithProducts(user, [
      { id: 'ps_p7', name: 'Camiseta', reference: 'REF-001', meta_title: 'SEO', images: [] }
    ]);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const card = (await screen.findByText('Camiseta')).closest('.product-card')!;
    await user.click(card);
    const meta = screen.getByLabelText('Meta title');
    await user.clear(meta);
    await user.type(meta, 'SEO nuevo');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('SEO nuevo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(await screen.findByText('SEO nuevo')).toBeInTheDocument();
  });

  it('discards edits when PrestaShop is fetched again after the user confirms', async () => {
    const firstData = {
      data_id: 'ps-1',
      summary: { total: 1 },
      products: [{ id: 'ps_p7', name: 'Camiseta', reference: 'REF-001', meta_title: 'SEO', images: [] }]
    };
    mockApi.fetchPrestashopData
      .mockResolvedValueOnce({ success: true, data: firstData })
      .mockResolvedValueOnce({ success: true, data: { data_id: 'ps-2', summary: { total: 1 } } });
    mockApi.getPrestashopData.mockResolvedValue({ success: true, data: firstData });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    renderWithI18n(<DashboardPage />, 'en');
    const user = userEvent.setup();

    // First fetch to get data
    await user.click(screen.getByRole('button', { name: 'Fetch from PrestaShop' }));
    await waitFor(() => expect(screen.getByText('1 products imported from PrestaShop')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'View' }));

    const card = (await screen.findByText('Camiseta')).closest('.product-card')!;
    await user.click(card);
    const meta = screen.getByLabelText('Meta title');
    await user.clear(meta);
    await user.type(meta, 'SEO nuevo');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('SEO nuevo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Fetch from PrestaShop' }));

    expect(await screen.findByText('1 products imported from PrestaShop')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByText('Camiseta')).toBeInTheDocument();
    expect(screen.queryByText('SEO nuevo')).not.toBeInTheDocument();
    expect(screen.getByText('SEO')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('undoes product edits from the grid view', async () => {
    renderWithI18n(<DashboardPage />, 'en');
    const user = userEvent.setup();
    await fetchDataWithProducts(user, [
      { id: 'ps_p7', name: 'Camiseta', reference: 'REF-001', meta_title: 'SEO', images: [] }
    ]);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const card = (await screen.findByText('Camiseta')).closest('.product-card')!;
    await user.click(card);
    const meta = screen.getByLabelText('Meta title');
    await user.clear(meta);
    await user.type(meta, 'SEO nuevo');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('SEO nuevo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(screen.getByText('SEO')).toBeInTheDocument();
    expect(screen.queryByText('SEO nuevo')).not.toBeInTheDocument();
    expect(screen.queryByText('Edited')).not.toBeInTheDocument();
  });

  it('returns to the home screen when the application title is clicked', async () => {
    renderWithI18n(<DashboardPage />, 'en');
    const user = userEvent.setup();
    await fetchDataWithProducts(user, [
      { id: 'ps_p7', name: 'Camiseta', reference: 'REF-001', images: [] }
    ]);

    await user.click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByText('Camiseta')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Go to home' }));

    expect(screen.getByText('Import from PrestaShop')).toBeInTheDocument();
  });

  it('saves edits to PrestaShop and keeps them visible after navigating away', async () => {
    renderWithI18n(<DashboardPage />, 'en');
    const psData = {
      data_id: 'ps-1',
      summary: { total: 1 },
      products: [
        { id: 'ps_p7', prestashop_id: '7', name: 'Camiseta', reference: 'REF-001', meta_title: 'SEO', images: [] }
      ]
    };
    mockApi.fetchPrestashopData.mockResolvedValue({ success: true, data: psData });
    mockApi.getPrestashopData.mockResolvedValue({ success: true, data: psData });
    mockApi.savePrestashopEdits = jest.fn().mockResolvedValue({ success: true, message: '1 product updated' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Fetch from PrestaShop' }));
    await waitFor(() => expect(screen.getByText('1 products imported from PrestaShop')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'View' }));

    const card = (await screen.findByText('Camiseta')).closest('.product-card')!;
    await user.click(card);
    const meta = screen.getByLabelText('Meta title');
    await user.clear(meta);
    await user.type(meta, 'SEO nuevo');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await user.click(await screen.findByRole('button', { name: 'Save to PrestaShop' }));

    expect(mockApi.savePrestashopEdits).toHaveBeenCalledWith({ '7': { meta_title: 'SEO nuevo' } });
    expect(await screen.findByText('1 product updated')).toBeInTheDocument();
    expect(screen.getByText('SEO nuevo')).toBeInTheDocument();
    expect(screen.queryByText('Edited')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(await screen.findByText('SEO nuevo')).toBeInTheDocument();
    expect(screen.queryByText('Edited')).not.toBeInTheDocument();
  });
});
