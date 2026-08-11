import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadSection from './UploadSection';
import { renderWithI18n } from '../../test-utils';

var mockApi: any;

jest.mock('../../services/api-service', () => ({
  getApiService: () => mockApi
}));

describe('UploadSection', () => {
  beforeEach(() => {
    mockApi = {
      fetchPrestashopData: jest.fn(),
      clearPrestashopData: jest.fn()
    };
  });

  it('fetches products from PrestaShop by brand and notifies the parent', async () => {
    mockApi.fetchPrestashopData.mockResolvedValue({
      success: true,
      data: { data_id: 'ps-1', summary: { total: 2 } }
    });
    const onPrestashopReady = jest.fn();

    renderWithI18n(<UploadSection onPrestashopReady={onPrestashopReady} />, 'en');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Brand/), 'Sony');
    await user.click(screen.getByRole('button', { name: 'Fetch from PrestaShop' }));

    await waitFor(() => expect(onPrestashopReady).toHaveBeenCalledWith('ps-1', 2));
    expect(mockApi.fetchPrestashopData).toHaveBeenCalledWith({
      references: [],
      brand: 'Sony',
      description: 'all',
      images: 'all',
      filter_operator: 'and',
      limit: 50
    });
    expect(await screen.findByText('Imported 2 products from PrestaShop')).toBeInTheDocument();
  });

  it('sends references and the selected filters to the fetch endpoint', async () => {
    mockApi.fetchPrestashopData.mockResolvedValue({ success: true, data: { data_id: 'ps-1', summary: { total: 1 } } });

    renderWithI18n(<UploadSection />, 'en');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/References/), 'REF-001, REF-002');
    await user.selectOptions(screen.getByLabelText('Description'), 'with');
    await user.selectOptions(screen.getByLabelText('Images'), 'without');
    await user.click(screen.getByRole('button', { name: 'Fetch from PrestaShop' }));

    await waitFor(() =>
      expect(mockApi.fetchPrestashopData).toHaveBeenCalledWith({
        references: ['REF-001', 'REF-002'],
        brand: '',
        description: 'with',
        images: 'without',
        filter_operator: 'and',
        limit: 50
      })
    );
  });

  it('sends the OR combination when selected', async () => {
    mockApi.fetchPrestashopData.mockResolvedValue({ success: true, data: { data_id: 'ps-1', summary: { total: 1 } } });

    renderWithI18n(<UploadSection />, 'en');

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Description'), 'without');
    await user.selectOptions(screen.getByLabelText('Images'), 'without');
    await user.selectOptions(screen.getByLabelText('Combine filters'), 'or');
    await user.click(screen.getByRole('button', { name: 'Fetch from PrestaShop' }));

    await waitFor(() =>
      expect(mockApi.fetchPrestashopData).toHaveBeenCalledWith({
        references: [],
        brand: '',
        description: 'without',
        images: 'without',
        filter_operator: 'or',
        limit: 50
      })
    );
  });

  it('shows the 50-product limit note', () => {
    renderWithI18n(<UploadSection />, 'es');
    expect(screen.getByText(/Se importarán como máximo los primeros 50 productos/)).toBeInTheDocument();
  });

  it('fetches the first products when no criteria are given', async () => {
    mockApi.fetchPrestashopData.mockResolvedValue({
      success: true,
      data: { data_id: 'ps-1', summary: { total: 5 } }
    });
    const onPrestashopReady = jest.fn();

    renderWithI18n(<UploadSection onPrestashopReady={onPrestashopReady} />, 'en');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Fetch from PrestaShop' }));

    await waitFor(() => expect(onPrestashopReady).toHaveBeenCalledWith('ps-1', 5));
    expect(mockApi.fetchPrestashopData).toHaveBeenCalledWith({
      references: [],
      brand: '',
      description: 'all',
      images: 'all',
      filter_operator: 'and',
      limit: 50
    });
    expect(await screen.findByText('Imported 5 products from PrestaShop')).toBeInTheDocument();
  });

  it('shows a friendly error when PrestaShop is not configured', async () => {
    mockApi.fetchPrestashopData.mockRejectedValue({
      response: { data: { error: { message: 'PrestaShop must be configured to fetch products' } } }
    });
    renderWithI18n(<UploadSection />, 'en');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Brand/), 'Sony');
    await user.click(screen.getByRole('button', { name: 'Fetch from PrestaShop' }));

    expect(
      await screen.findByText('Configure PrestaShop in the Configuration tab to import products.')
    ).toBeInTheDocument();
  });

  it('shows a friendly error when no products match', async () => {
    mockApi.fetchPrestashopData.mockRejectedValue({
      response: { data: { error: { message: 'No products matched the given criteria' } } }
    });
    renderWithI18n(<UploadSection />, 'en');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Brand/), 'Sony');
    await user.click(screen.getByRole('button', { name: 'Fetch from PrestaShop' }));

    expect(await screen.findByText('No products matched the given criteria.')).toBeInTheDocument();
  });

  it('keeps the entered filters after a successful fetch', async () => {
    mockApi.fetchPrestashopData.mockResolvedValue({ success: true, data: { data_id: 'ps-1', summary: { total: 1 } } });

    renderWithI18n(<UploadSection />, 'en');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Brand/), 'Sony');
    await user.type(screen.getByLabelText(/References/), 'REF-001');
    await user.click(screen.getByRole('button', { name: 'Fetch from PrestaShop' }));

    expect(await screen.findByText('Imported 1 products from PrestaShop')).toBeInTheDocument();
    expect(screen.getByLabelText(/Brand/)).toHaveValue('Sony');
    expect(screen.getByLabelText(/References/)).toHaveValue('REF-001');
  });

  it('resets the filters when the imported data is cleared', async () => {
    mockApi.clearPrestashopData.mockResolvedValue({ success: true });

    renderWithI18n(<UploadSection prestashop={{ present: true, dataId: 'ps-1', count: 1 }} />, 'en');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Brand/), 'Sony');
    await user.click(screen.getByRole('button', { name: 'Remove imported data' }));

    expect(await screen.findByText('PrestaShop data removed')).toBeInTheDocument();
    expect(screen.getByLabelText(/Brand/)).toHaveValue('');
    expect(screen.getByLabelText('Description')).toHaveValue('all');
  });

  it('shows the fetched products count and a remove button when PrestaShop data is present', async () => {
    mockApi.clearPrestashopData.mockResolvedValue({ success: true });
    const onPrestashopCleared = jest.fn();

    renderWithI18n(<UploadSection prestashop={{ present: true, dataId: 'ps-1', count: 3 }} onPrestashopCleared={onPrestashopCleared} />, 'en');

    expect(screen.getByText('3 products imported from PrestaShop')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove imported data' }));

    expect(mockApi.clearPrestashopData).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('PrestaShop data removed')).toBeInTheDocument();
    expect(onPrestashopCleared).toHaveBeenCalledTimes(1);
  });

  it('offers a View button next to the remove button that notifies the parent', async () => {
    const onView = jest.fn();
    renderWithI18n(<UploadSection prestashop={{ present: true, dataId: 'ps-1', count: 3 }} onView={onView} />, 'en');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(onView).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Remove imported data' })).toBeInTheDocument();
  });

  it('does not show the View button before any data has been imported', () => {
    renderWithI18n(<UploadSection />, 'en');
    expect(screen.queryByRole('button', { name: 'View' })).not.toBeInTheDocument();
  });
});
