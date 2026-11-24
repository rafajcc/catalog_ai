import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShopifySettingsTab from './ShopifySettingsTab';
import { renderWithI18n } from '../../test-utils';

var mockApi: any;

vi.mock('../../services/api-service', () => ({
  getApiService: () => mockApi
}));

const SETTINGS = {
  client_id: 'shpca_123',
  has_client_secret: true,
  client_secret_hint: 'abc••••••••xyz',
  api_version: '2026-07',
  configured: true
};

describe('ShopifySettingsTab', () => {
  beforeEach(() => {
    mockApi = {
      getShopifySettings: vi.fn().mockResolvedValue({ success: true, data: SETTINGS }),
      updateShopifySettings: vi.fn().mockResolvedValue({ success: true, data: SETTINGS })
    };
  });

  it('loads the global credentials and shows only a masked secret hint', async () => {
    renderWithI18n(<ShopifySettingsTab onError={() => {}} onSuccess={() => {}} />, 'en');

    expect(await screen.findByLabelText('Client ID')).toHaveValue('shpca_123');
    expect(screen.getByLabelText('API version')).toHaveValue('2026-07');
    expect(screen.getByText(/Stored secret: abc••••••••xyz/)).toBeInTheDocument();
    expect(screen.getByLabelText('Client Secret')).toHaveValue('');
    expect(screen.queryByText('abc••••••••xyz', { selector: 'input' })).not.toBeInTheDocument();
  });

  it('keeps the stored secret when the field is left blank', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    renderWithI18n(<ShopifySettingsTab onError={() => {}} onSuccess={onSuccess} />, 'en');

    await screen.findByLabelText('Client ID');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockApi.updateShopifySettings).toHaveBeenCalledWith({
        client_id: 'shpca_123',
        api_version: '2026-07'
      })
    );
    expect(onSuccess).toHaveBeenCalledWith('Global Shopify settings saved');
  });

  it('reports an error when the settings cannot be loaded', async () => {
    const onError = vi.fn();
    mockApi.getShopifySettings.mockRejectedValue(new Error('boom'));
    renderWithI18n(<ShopifySettingsTab onError={onError} onSuccess={() => {}} />, 'en');

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith('Could not load the global Shopify credentials')
    );
  });
});
