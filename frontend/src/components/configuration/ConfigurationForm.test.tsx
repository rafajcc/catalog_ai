import { screen, waitFor } from '@testing-library/react';
import { renderWithI18n } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import ConfigurationForm from './ConfigurationForm';

var mockApi: any;

jest.mock('../../services/api-service', () => ({
  getApiService: () => mockApi
}));

describe('ConfigurationForm', () => {
  beforeEach(() => {
    mockApi = {
      getConfiguration: jest.fn().mockResolvedValue({ success: true }),
      getDefaultPrompt: jest.fn().mockResolvedValue({ success: true, data: {} }),
      testPrestashopConnection: jest.fn(),
      testAIConnection: jest.fn(),
      updateConfiguration: jest.fn()
    };
  });

  it('loads the current configuration on mount', async () => {
    mockApi.getConfiguration.mockResolvedValue({
      success: true,
      prestashop: { base_url: 'https://shop.example.com', api_key: 'ps-key', version: '8', language_id: 2 },
      ai: {
        provider: 'openai',
        providers: { openai: { model: 'gpt-4o', language: 'en', api_key: 'ai-key', base_url: 'https://api.openai.com/v1' } },
        enabled_fields: ['name']
      }
    });

    renderWithI18n(<ConfigurationForm />, 'en');

    expect(await screen.findByDisplayValue('https://shop.example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ps-key')).toBeInTheDocument();
    expect((screen.getByLabelText('Version') as HTMLSelectElement).value).toBe('8');
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
    expect((screen.getByLabelText('Provider') as HTMLSelectElement).value).toBe('openai');
    expect(screen.getByDisplayValue('gpt-4o')).toBeInTheDocument();
    expect(screen.getByDisplayValue('en')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://api.openai.com/v1')).toBeInTheDocument();
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

  it('tests the AI connection and saves configuration', async () => {
    mockApi.testAIConnection.mockResolvedValue({ success: true });
    mockApi.updateConfiguration.mockResolvedValue({ success: true });
    renderWithI18n(<ConfigurationForm />, 'en');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Test AI connection/ }));
    expect(await screen.findByText('AI connection OK')).toBeInTheDocument();
    expect(mockApi.testAIConnection).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'mock', language: 'en' })
    );

    await user.click(screen.getByRole('button', { name: 'Save configuration' }));
    expect(await screen.findByText('Configuration saved')).toBeInTheDocument();
    expect(mockApi.updateConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        prestashop: expect.objectContaining({ base_url: '' }),
        ai: expect.objectContaining({ provider: 'mock' })
      })
    );
  });

  it('shows the selected AI provider URL in a readonly field', async () => {
    mockApi.getConfiguration.mockResolvedValue({
      success: true,
      ai: { provider: 'openai', providers: { openai: { model: 'gpt-4o' } }, enabled_fields: ['name'] }
    });

    renderWithI18n(<ConfigurationForm />, 'en');

    expect(await screen.findByDisplayValue('https://api.openai.com/v1')).toBeInTheDocument();
    expect(screen.getByLabelText('AI provider URL')).toHaveAttribute('readonly');

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Provider'), 'anthropic');

    expect(screen.getByDisplayValue('https://api.anthropic.com')).toBeInTheDocument();
  });

  it('shows an error message when a test fails', async () => {
    mockApi.testPrestashopConnection.mockRejectedValue(new Error('bad api key'));
    renderWithI18n(<ConfigurationForm />, 'en');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Test PrestaShop connection/ }));

    expect(await screen.findByText('bad api key')).toBeInTheDocument();
  });

  it('keeps the settings of every provider when switching and saves them together', async () => {
    mockApi.getConfiguration.mockResolvedValue({
      success: true,
      ai: {
        provider: 'anthropic',
        providers: {
          openai: { model: 'gpt-4o', api_key: 'openai-key', language: 'en' },
          anthropic: { model: 'claude', api_key: 'anthropic-key', language: 'es' }
        },
        enabled_fields: ['name']
      }
    });
    mockApi.updateConfiguration.mockResolvedValue({ success: true });
    renderWithI18n(<ConfigurationForm />, 'en');

    expect(await screen.findByDisplayValue('claude')).toBeInTheDocument();
    expect(screen.getByDisplayValue('anthropic-key')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Provider'), 'openai');

    expect(screen.getByDisplayValue('gpt-4o')).toBeInTheDocument();
    expect(screen.getByDisplayValue('openai-key')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save configuration' }));
    expect(await screen.findByText('Configuration saved')).toBeInTheDocument();
    expect(mockApi.updateConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        ai: expect.objectContaining({
          provider: 'openai',
          providers: expect.objectContaining({
            openai: expect.objectContaining({ model: 'gpt-4o', api_key: 'openai-key' }),
            anthropic: expect.objectContaining({ model: 'claude', api_key: 'anthropic-key' })
          })
        })
      })
    );
  });

  it('tests the connection of the provider currently selected', async () => {
    mockApi.getConfiguration.mockResolvedValue({
      success: true,
      ai: {
        provider: 'openai',
        providers: { openai: { model: 'gpt-4o', api_key: 'openai-key', language: 'en' } },
        enabled_fields: ['name']
      }
    });
    mockApi.testAIConnection.mockResolvedValue({ success: true });
    renderWithI18n(<ConfigurationForm />, 'en');

    await screen.findByDisplayValue('gpt-4o');

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Provider'), 'anthropic');
    await user.type(screen.getByLabelText('AI API key'), 'anthropic-key');
    await user.click(screen.getByRole('button', { name: /Test AI connection/ }));

    expect(await screen.findByText('AI connection OK')).toBeInTheDocument();
    expect(mockApi.testAIConnection).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic', api_key: 'anthropic-key', language: 'en' })
    );
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

    const textarea = (await screen.findByDisplayValue('PROMPT-EN')) as HTMLTextAreaElement;
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Use default prompt'));

    expect(textarea).not.toHaveAttribute('readonly');
    await user.clear(textarea);
    await user.type(textarea, 'MY CUSTOM PROMPT');
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));
    expect(await screen.findByText('Configuration saved')).toBeInTheDocument();
    expect(mockApi.updateConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ ai: expect.objectContaining({ default_prompt: 'MY CUSTOM PROMPT' }) })
    );
  });

  it('warns before overwriting a custom prompt when re-enabling the default', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    mockApi.getDefaultPrompt.mockResolvedValue({ success: true, data: { en: 'PROMPT-EN' } });
    mockApi.getConfiguration.mockResolvedValue({
      success: true,
      ai: { provider: 'mock', enabled_fields: ['name'], default_prompt: 'CUSTOM' }
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
});

