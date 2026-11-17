import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageProviderAuditView } from './SuperAdminPage';
import { renderWithI18n } from '../../test-utils';

var mockApi: any;

vi.mock('../../services/api-service', () => ({
  getApiService: () => mockApi
}));

describe('ImageProviderAuditView', () => {
  beforeEach(() => {
    mockApi = {
      getImageProviderAuditLog: vi.fn().mockResolvedValue({
        success: true,
        data: {
          rows: [
            {
              id: 1,
              request_id: 'req-1',
              comercio_id: 1,
              comercio_name: 'Tienda Uno',
              user_id: 2,
              user_name: 'juan',
              provider_slug: 'mock',
              provider_name: 'Mock (desarrollo)',
              status: 'ok',
              requested_images: 5,
              urls_count: 5,
              duration_ms: 12,
              product_brand: 'Adidas',
              product_reference: 'REF-100',
              product_ean: '840000001234',
              error_message: null,
              requested_at: '2026-10-23 10:00:00'
            }
          ],
          total: 1,
          limit: 50,
          summary: [
            {
              provider_slug: 'mock',
              provider_name: 'Mock (desarrollo)',
              calls: 1,
              ok: 1,
              empty: 0,
              error: 0,
              quota: 0,
              urls: 5,
              total_duration_ms: 12,
              avg_duration_ms: 12
            }
          ],
          providers: [
            { slug: 'mock', name: 'Mock (desarrollo)' },
            { slug: 'feeds', name: 'Feeds' }
          ]
        }
      }),
      downloadImageProviderAuditCsv: vi.fn()
    };
  });

  it('loads the report with the default range and shows the summary and detail', async () => {
    const onError = vi.fn();
    renderWithI18n(
      <ImageProviderAuditView
        comercios={[{ id: 1, name: 'Tienda Uno' } as any]}
        onError={onError}
      />,
      'en'
    );

    await waitFor(() => expect(mockApi.getImageProviderAuditLog).toHaveBeenCalled());
    expect(await screen.findByText('Summary by service')).toBeInTheDocument();
    expect(screen.getByText('Call detail')).toBeInTheDocument();
    expect(screen.getByText('Records found: 1')).toBeInTheDocument();
    expect(screen.getByText('Adidas')).toBeInTheDocument();
    expect(screen.getByText('REF-100')).toBeInTheDocument();
    expect(screen.getByText('840000001234')).toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  });

  it('excludes a service when clicked while All is selected', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <ImageProviderAuditView
        comercios={[{ id: 1, name: 'Tienda Uno' } as any]}
        onError={() => {}}
      />,
      'en'
    );

    await waitFor(() => expect(mockApi.getImageProviderAuditLog).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.click(screen.getByRole('checkbox', { name: 'Mock (desarrollo)' }));

    expect(screen.getByRole('checkbox', { name: 'All' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Feeds' })).toBeChecked();
    expect(screen.getByText('All except 1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View on screen' }));
    await waitFor(() =>
      expect(mockApi.getImageProviderAuditLog).toHaveBeenLastCalledWith(
        expect.objectContaining({ providers: ['feeds'] })
      )
    );
  });

  it('returns to All when the only excluded service is selected again', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <ImageProviderAuditView
        comercios={[{ id: 1, name: 'Tienda Uno' } as any]}
        onError={() => {}}
      />,
      'en'
    );

    await waitFor(() => expect(mockApi.getImageProviderAuditLog).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'All' }));
    const mockCheckbox = screen.getByRole('checkbox', { name: 'Mock (desarrollo)' });
    await user.click(mockCheckbox);
    await user.click(mockCheckbox);

    expect(screen.getByRole('checkbox', { name: 'All' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View on screen' }));
    await waitFor(() =>
      expect(mockApi.getImageProviderAuditLog).toHaveBeenLastCalledWith(
        expect.objectContaining({ providers: null })
      )
    );
  });

  it('lets All reselect every service after an exclusion', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <ImageProviderAuditView
        comercios={[{ id: 1, name: 'Tienda Uno' } as any]}
        onError={() => {}}
      />,
      'en'
    );

    await waitFor(() => expect(mockApi.getImageProviderAuditLog).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.click(screen.getByRole('checkbox', { name: 'Feeds' }));
    expect(screen.getByText('All except 1')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'All' }));
    expect(screen.getByRole('checkbox', { name: 'Mock (desarrollo)' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Feeds' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'View on screen' }));
    await waitFor(() =>
      expect(mockApi.getImageProviderAuditLog).toHaveBeenLastCalledWith(
        expect.objectContaining({ providers: null })
      )
    );
  });

  it('clears every service when All is clicked while checked', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <ImageProviderAuditView
        comercios={[{ id: 1, name: 'Tienda Uno' } as any]}
        onError={() => {}}
      />,
      'en'
    );

    await waitFor(() => expect(mockApi.getImageProviderAuditLog).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.click(screen.getByRole('checkbox', { name: 'All' }));

    expect(screen.getByRole('checkbox', { name: 'All' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Mock (desarrollo)' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Feeds' })).not.toBeChecked();
    expect(screen.getByText('None')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View on screen' }));
    await waitFor(() => expect(screen.getByText('No data for the selected range')).toBeInTheDocument());
    // An empty selection must not fall through to the backend as "no filter".
    expect(mockApi.getImageProviderAuditLog).toHaveBeenCalledTimes(1);
  });

  it('restores every tick when All is clicked again after clearing', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <ImageProviderAuditView
        comercios={[{ id: 1, name: 'Tienda Uno' } as any]}
        onError={() => {}}
      />,
      'en'
    );

    await waitFor(() => expect(mockApi.getImageProviderAuditLog).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.click(screen.getByRole('checkbox', { name: 'All' }));
    await user.click(screen.getByRole('checkbox', { name: 'All' }));

    expect(screen.getByRole('checkbox', { name: 'All' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Mock (desarrollo)' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Feeds' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'View on screen' }));
    await waitFor(() =>
      expect(mockApi.getImageProviderAuditLog).toHaveBeenLastCalledWith(
        expect.objectContaining({ providers: null })
      )
    );
  });
});
