import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MarketplacesTab from './MarketplacesTab';
import { renderWithI18n } from '../../test-utils';

var mockApi: any;

vi.mock('../../services/api-service', () => ({
  getApiService: () => mockApi
}));

const MARKETPLACES = [
  { id: 1, name: 'PrestaShop', label: 'PrestaShop', enabled: true, in_use_by: [] },
  { id: 2, name: 'Shopify', label: 'Shopify', enabled: true, in_use_by: [] },
  { id: 3, name: 'Mock', label: 'Mock', enabled: true, in_use_by: [{ id: 1, name: 'Tienda Uno' }] }
];

describe('MarketplacesTab', () => {
  beforeEach(() => {
    mockApi = {
      getMarketplaces: vi.fn().mockResolvedValue({ success: true, data: MARKETPLACES }),
      setMarketplaceEnabled: vi.fn().mockResolvedValue({ success: true })
    };
  });

  it('lists every marketplace with its status', async () => {
    renderWithI18n(<MarketplacesTab onError={() => {}} onSuccess={() => {}} />, 'en');
    await waitFor(() => expect(screen.getByText('PrestaShop')).toBeInTheDocument());
    expect(screen.getByText('Shopify')).toBeInTheDocument();
    expect(screen.getByText('Mock')).toBeInTheDocument();
  });

  it('asks for confirmation and lists the affected comercios before disabling', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    renderWithI18n(<MarketplacesTab onError={() => {}} onSuccess={onSuccess} />, 'en');

    await waitFor(() => expect(screen.getByText('Mock')).toBeInTheDocument());

    // The Mock row is the third one; click its Disable button.
    const disableButtons = screen.getAllByRole('button', { name: 'Disable' });
    await user.click(disableButtons[2]);

    // Confirmation shows the affected comercio and does not call the API yet.
    expect(screen.getByText('Tienda Uno')).toBeInTheDocument();
    expect(mockApi.setMarketplaceEnabled).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Disable anyway' }));
    await waitFor(() => expect(mockApi.setMarketplaceEnabled).toHaveBeenCalledWith('Mock', false));
    expect(onSuccess).toHaveBeenCalled();
  });

  it('enables a marketplace without a confirmation', async () => {
    mockApi.getMarketplaces.mockResolvedValue({
      success: true,
      data: [{ ...MARKETPLACES[0], enabled: false }, MARKETPLACES[1], MARKETPLACES[2]]
    });
    const user = userEvent.setup();
    renderWithI18n(<MarketplacesTab onError={() => {}} onSuccess={() => {}} />, 'en');

    await waitFor(() => expect(screen.getByText('PrestaShop')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(mockApi.setMarketplaceEnabled).toHaveBeenCalledWith('PrestaShop', true));
  });
});
