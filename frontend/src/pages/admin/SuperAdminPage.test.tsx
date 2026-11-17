import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SuperAdminPage from './SuperAdminPage';
import { renderWithI18n } from '../../test-utils';

var mockApi: any;

vi.mock('../../services/api-service', () => ({
  getApiService: () => mockApi
}));

describe('SuperAdminPage', () => {
  beforeEach(() => {
    mockApi = {
      getSuperAdminComercios: vi.fn().mockResolvedValue({
        success: true,
        comercios: [{ id: 1, name: 'Tienda Uno', active: true, user_count: 2 }]
      }),
      setComercioActive: vi.fn().mockImplementation(async (_id: number, active: boolean) => ({
        success: true,
        comercio: { id: 1, name: 'Tienda Uno', active, user_count: 2 }
      })),
      getSuperAdminComercioUsers: vi.fn().mockResolvedValue({
        success: true,
        users: []
      }),
      getImageProviders: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getAutocompleteQuotas: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            comercio_id: 1,
            comercio_name: 'Tienda Uno',
            monthly_limit: 100,
            unlimited: false,
            billing_cycle_day: 1,
            calls_this_cycle: 5,
            remaining: 95,
            cycle_start: '2026-11-01',
            updated_at: '2026-11-01 00:00:00'
          }
        ]
      })
    };
  });

  it('shows a success message after the action and clears it when changing tabs', async () => {
    const user = userEvent.setup();
    renderWithI18n(<SuperAdminPage />, 'en');

    await user.click(await screen.findByRole('button', { name: 'Disable' }));

    expect(await screen.findByText('Business updated')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Image providers' }));

    await waitFor(() =>
      expect(screen.queryByText('Business updated')).not.toBeInTheDocument()
    );
  });

  it('defaults the audit report to the last 7 days and applies the date presets', async () => {
    const user = userEvent.setup();
    renderWithI18n(<SuperAdminPage />, 'es');

    await user.click(screen.getByRole('button', { name: 'Cuotas de autocompletado' }));

    const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    expect(screen.getByLabelText('Desde')).toHaveValue(isoDaysAgo(6));
    expect(screen.getByLabelText('Hasta')).toHaveValue(today);

    await user.click(screen.getByRole('button', { name: 'Últimos 30 días' }));
    expect(screen.getByLabelText('Desde')).toHaveValue(isoDaysAgo(29));
    expect(screen.getByLabelText('Hasta')).toHaveValue(today);

    await user.click(screen.getByRole('button', { name: 'Últimos 180 días' }));
    expect(screen.getByLabelText('Desde')).toHaveValue(isoDaysAgo(179));
    expect(screen.getByLabelText('Hasta')).toHaveValue(today);
  });

  it('shows the translated Save label on the autocomplete quotas screen', async () => {
    const user = userEvent.setup();
    renderWithI18n(<SuperAdminPage />, 'es');

    await user.click(screen.getByRole('button', { name: 'Cuotas de autocompletado' }));

    expect(await screen.findByRole('button', { name: 'Guardar' })).toBeInTheDocument();
    expect(screen.queryByText('general.save')).not.toBeInTheDocument();
  });

  it('clears a visible success message when clicking another button on the same screen', async () => {
    const user = userEvent.setup();
    renderWithI18n(<SuperAdminPage />, 'en');

    await user.click(await screen.findByRole('button', { name: 'Disable' }));

    expect(await screen.findByText('Business updated')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View users' }));

    await waitFor(() =>
      expect(screen.queryByText('Business updated')).not.toBeInTheDocument()
    );
  });
});
