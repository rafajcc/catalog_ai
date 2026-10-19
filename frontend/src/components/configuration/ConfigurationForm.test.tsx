import { screen, waitFor, within } from '@testing-library/react';
import { renderWithI18n } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import ConfigurationForm from './ConfigurationForm';

var mockApi: any;

vi.mock('../../services/api-service', () => ({
  getApiService: () => mockApi
}));

describe('ConfigurationForm', () => {
  beforeEach(() => {
    mockApi = {
      getConfiguration: vi.fn().mockResolvedValue({ success: true }),
      getDefaultPrompt: vi.fn().mockResolvedValue({ success: true, data: {} }),
      testPrestashopConnection: vi.fn(),
      testShopifyConnection: vi.fn(),
      testAIConnection: vi.fn(),
      updateConfiguration: vi.fn()
    };
  });

  it('loads the current configuration on mount', async () => {
    mockApi.getConfiguration.mockResolvedValue({
      success: true,
      prestashop: { base_url: 'https://shop.example.com', api_key: 'ps-key', version: '8', language_id: 2 },
      ai: { default_prompt: 'MI PROMPT' }
    });

    renderWithI18n(<ConfigurationForm />, 'en');

    expect(await screen.findByDisplayValue('https://shop.example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ps-key')).toBeInTheDocument();
    expect((screen.getByLabelText('Version') as HTMLSelectElement).value).toBe('8');
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
    expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe('MI PROMPT');
    expect(screen.getByLabelText('Use default prompt')).not.toBeChecked();
  });

  it('tests the PrestaShop connection with the current values', async () => {
    mockApi.testPrestashopConnection.mockResolvedValue({ success: true });
    renderWithI18n(<ConfigurationForm />, 'en');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Base URL/), 'https://shop.test');
    await user.type(screen.getByLabelText('PrestaShop API key'), 'abc');
    await user.click(screen.getByRole('button', { name: /Test PrestaShop connection/ }));

    await waitFor(() =>
      expect(mockApi.testPrestashopConnection).toHaveBeenCalledWith({
        base_url: 'https://shop.test',
        api_key: 'abc',
        version: '1.7',
        language_id: 1
      })
    );
    expect(await screen.findByText('PrestaShop connection OK')).toBeInTheDocument();
  });

  it('saves the PrestaShop values and the enabled fields', async () => {
    mockApi.updateConfiguration.mockResolvedValue({ success: true });
    renderWithI18n(<ConfigurationForm />, 'en');

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Base URL/), 'https://shop.test');
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));

    expect(await screen.findByText('Configuration saved')).toBeInTheDocument();
    expect(mockApi.updateConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        prestashop: expect.objectContaining({ base_url: 'https://shop.test' }),
        ai: expect.objectContaining({ enabled_fields: ['name'] })
      })
    );
  });

  it('shows an error message when a test fails', async () => {
    mockApi.testPrestashopConnection.mockRejectedValue(new Error('bad api key'));
    renderWithI18n(<ConfigurationForm />, 'en');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Test PrestaShop connection/ }));

    expect(await screen.findByText('bad api key')).toBeInTheDocument();
  });

  it('shows the default prompt read-only and saves it as empty when the checkbox is on', async () => {
    mockApi.getDefaultPrompt.mockResolvedValue({ success: true, data: { es: 'PROMPT-ES', en: 'PROMPT-EN' } });
    mockApi.updateConfiguration.mockResolvedValue({ success: true });
    renderWithI18n(<ConfigurationForm />, 'en');

    const textarea = (await screen.findByDisplayValue('PROMPT-EN')) as HTMLTextAreaElement;
    expect(textarea).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Use default prompt')).toBeChecked();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));
    expect(await screen.findByText('Configuration saved')).toBeInTheDocument();
    expect(mockApi.updateConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ ai: expect.objectContaining({ default_prompt: '' }) })
    );
  });

  it('allows editing and saving a custom prompt when the default checkbox is off', async () => {
    mockApi.getDefaultPrompt.mockResolvedValue({ success: true, data: { en: 'PROMPT-EN' } });
    mockApi.updateConfiguration.mockResolvedValue({ success: true });
    renderWithI18n(<ConfigurationForm />, 'en');

    await screen.findByDisplayValue('PROMPT-EN');
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Use default prompt'));

    // The prompt is edited in the large modal, not inline.
    await user.click(screen.getByLabelText('Prompt'));
    const modal = screen.getByRole('dialog', { name: 'Edit prompt' });
    const modalTextarea = within(modal).getByLabelText('Edit prompt');
    await user.clear(modalTextarea);
    await user.type(modalTextarea, 'MY CUSTOM PROMPT');
    await user.click(within(modal).getByRole('button', { name: 'Apply' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));
    expect(await screen.findByText('Configuration saved')).toBeInTheDocument();
    expect(mockApi.updateConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ ai: expect.objectContaining({ default_prompt: 'MY CUSTOM PROMPT' }) })
    );
  });

  it('opens a large modal pre-filled with the prompt when the field is clicked', async () => {
    mockApi.getDefaultPrompt.mockResolvedValue({ success: true, data: { en: 'PROMPT-EN' } });
    renderWithI18n(<ConfigurationForm />, 'en');

    await screen.findByDisplayValue('PROMPT-EN');
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Prompt'));

    expect(screen.getByRole('dialog', { name: 'Edit prompt' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: 'Edit prompt' })).getByRole('textbox')).toHaveValue('PROMPT-EN');
  });

  it('turns the system default prompt into a custom one when the modal is applied with changes', async () => {
    mockApi.getDefaultPrompt.mockResolvedValue({ success: true, data: { en: 'PROMPT-EN' } });
    mockApi.updateConfiguration.mockResolvedValue({ success: true });
    renderWithI18n(<ConfigurationForm />, 'en');

    await screen.findByDisplayValue('PROMPT-EN');
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Prompt'));

    const modal = screen.getByRole('dialog', { name: 'Edit prompt' });
    const modalTextarea = within(modal).getByRole('textbox');
    await user.clear(modalTextarea);
    await user.type(modalTextarea, 'MY CUSTOM PROMPT');
    await user.click(within(modal).getByRole('button', { name: 'Apply' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Use default prompt')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));
    expect(await screen.findByText('Configuration saved')).toBeInTheDocument();
    expect(mockApi.updateConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ ai: expect.objectContaining({ default_prompt: 'MY CUSTOM PROMPT' }) })
    );
  });

  it('closes the prompt modal without changes on Cancel', async () => {
    mockApi.getDefaultPrompt.mockResolvedValue({ success: true, data: { en: 'PROMPT-EN' } });
    renderWithI18n(<ConfigurationForm />, 'en');

    await screen.findByDisplayValue('PROMPT-EN');
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Prompt'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Use default prompt')).toBeChecked();
  });

  it('warns before overwriting a custom prompt when re-enabling the default', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockApi.getDefaultPrompt.mockResolvedValue({ success: true, data: { en: 'PROMPT-EN' } });
    mockApi.getConfiguration.mockResolvedValue({
      success: true,
      ai: { enabled_fields: ['name'], default_prompt: 'CUSTOM' }
    });
    renderWithI18n(<ConfigurationForm />, 'en');

    await screen.findByDisplayValue('CUSTOM');
    const checkbox = (await screen.findByLabelText('Use default prompt')) as HTMLInputElement;
    expect(checkbox).not.toBeChecked();

    const user = userEvent.setup();
    await user.click(checkbox);

    expect(confirmSpy).toHaveBeenCalledWith(
      'The custom text will be overwritten with the system default prompt. Continue?'
    );
    expect(checkbox).not.toBeChecked();

    confirmSpy.mockReturnValue(true);
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByLabelText('Prompt')).toHaveAttribute('readonly');
    expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe('PROMPT-EN');

    confirmSpy.mockRestore();
  });

  it('calls onClose when the Back button is clicked', async () => {
    const onClose = vi.fn();
    renderWithI18n(<ConfigurationForm onClose={onClose} />, 'en');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('collapses and expands the Marketplaces section', async () => {
    renderWithI18n(<ConfigurationForm />, 'en');

    expect(await screen.findByLabelText('Base URL')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Marketplaces' }));

    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marketplaces' })).toHaveAttribute('aria-expanded', 'false');

    await user.click(screen.getByRole('button', { name: 'Marketplaces' }));
    expect(screen.getByLabelText('Base URL')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marketplaces' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses and expands the PrestaShop subsection inside Marketplaces', async () => {
    renderWithI18n(<ConfigurationForm />, 'en');

    expect(await screen.findByLabelText('Base URL')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'PrestaShop' }));

    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PrestaShop' })).toHaveAttribute('aria-expanded', 'false');

    await user.click(screen.getByRole('button', { name: 'PrestaShop' }));
    expect(screen.getByLabelText('Base URL')).toBeInTheDocument();
  });

  it('collapses and expands the AI prompt section', async () => {
    renderWithI18n(<ConfigurationForm />, 'en');

    expect(await screen.findByLabelText('Prompt')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'AI prompt' }));

    expect(screen.queryByLabelText('Prompt')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI prompt' })).toHaveAttribute('aria-expanded', 'false');

    await user.click(screen.getByRole('button', { name: 'AI prompt' }));
    expect(screen.getByLabelText('Prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI prompt' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('loads the active marketplace and Shopify configuration on mount', async () => {
    mockApi.getConfiguration.mockResolvedValue({
      success: true,
      active_marketplace: 'Shopify',
      shopify: { shop_domain: 'my-store.myshopify.com', api_version: '2026-01', has_api_key: true }
    });

    renderWithI18n(<ConfigurationForm />, 'en');

    expect(await screen.findByDisplayValue('my-store.myshopify.com')).toBeInTheDocument();
    expect((screen.getByLabelText('Default marketplace') as HTMLSelectElement).value).toBe('Shopify');
    expect((screen.getByLabelText('API version') as HTMLSelectElement).value).toBe('2026-01');
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('tests the Shopify connection with the current values', async () => {
    mockApi.testShopifyConnection.mockResolvedValue({ success: true });
    renderWithI18n(<ConfigurationForm />, 'en');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Store domain'), 'shop.test');
    await user.type(screen.getByLabelText('Access token (Admin API)'), 'shpat_abc');
    await user.click(screen.getByRole('button', { name: /Test Shopify connection/ }));

    await waitFor(() =>
      expect(mockApi.testShopifyConnection).toHaveBeenCalledWith({
        shop_domain: 'shop.test',
        access_token: 'shpat_abc',
        api_version: '2026-07'
      })
    );
    expect(await screen.findByText('Shopify connection OK')).toBeInTheDocument();
  });

  it('saves the Shopify settings together with the active marketplace and notifies the parent', async () => {
    mockApi.updateConfiguration.mockResolvedValue({ success: true });
    const onSaved = vi.fn();
    renderWithI18n(<ConfigurationForm onSaved={onSaved} />, 'en');

    await screen.findByLabelText('Store domain');

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Default marketplace'), 'Shopify');
    await user.type(screen.getByLabelText('Store domain'), 'shop.test');
    await user.type(screen.getByLabelText('Access token (Admin API)'), 'shpat_x');
    await user.selectOptions(screen.getByLabelText('API version'), '2026-04');
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));

    expect(await screen.findByText('Configuration saved')).toBeInTheDocument();
    expect(mockApi.updateConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        shopify: { shop_domain: 'shop.test', access_token: 'shpat_x', api_version: '2026-04' },
        active_marketplace: 'Shopify'
      })
    );
    expect(onSaved).toHaveBeenCalledWith({ active_marketplace: 'Shopify' });
  });

  it('offers the demo Mock marketplace in the dropdown and saves it as active', async () => {
    mockApi.updateConfiguration.mockResolvedValue({ success: true });
    const onSaved = vi.fn();
    renderWithI18n(<ConfigurationForm onSaved={onSaved} />, 'en');

    await screen.findByLabelText('Base URL');

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Default marketplace'), 'Mock');
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));

    expect(await screen.findByText('Configuration saved')).toBeInTheDocument();
    expect(mockApi.updateConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ active_marketplace: 'Mock' })
    );
    expect(onSaved).toHaveBeenCalledWith({ active_marketplace: 'Mock' });
  });
});
