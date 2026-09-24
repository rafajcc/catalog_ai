import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegisterComercioPage from './RegisterComercioPage';
import { renderWithI18n } from '../../test-utils';

var mockApi: any;

vi.mock('../../services/api-service', () => ({
  getApiService: () => mockApi
}));

describe('RegisterComercioPage', () => {
  beforeEach(() => {
    mockApi = {
      registerComercio: vi.fn().mockResolvedValue({ success: true })
    };
  });

  it('sends the invitation nonce together with the register data', async () => {
    renderWithI18n(<RegisterComercioPage onBackToLogin={vi.fn()} header={<div />} />, 'en');
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Business name/), 'Mi Tienda');
    await user.type(screen.getByLabelText(/Admin username/), 'owner');
    await user.type(screen.getByLabelText(/Admin password/), 'SuperPass123');
    await user.type(screen.getByLabelText(/Invitation code/), 'ABC234XYZ789');
    await user.click(screen.getByRole('button', { name: 'Create business' }));

    await waitFor(() =>
      expect(mockApi.registerComercio).toHaveBeenCalledWith('Mi Tienda', 'owner', 'SuperPass123', 'ABC234XYZ789')
    );
  });

  it('shows the success screen after a successful registration', async () => {
    renderWithI18n(<RegisterComercioPage onBackToLogin={vi.fn()} header={<div />} />, 'en');
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Business name/), 'Mi Tienda');
    await user.type(screen.getByLabelText(/Admin username/), 'owner');
    await user.type(screen.getByLabelText(/Admin password/), 'SuperPass123');
    await user.type(screen.getByLabelText(/Invitation code/), 'ABC234XYZ789');
    await user.click(screen.getByRole('button', { name: 'Create business' }));

    expect(await screen.findByText('Business registered successfully')).toBeInTheDocument();
  });

  it('shows the invitation code as a required field', () => {
    renderWithI18n(<RegisterComercioPage onBackToLogin={vi.fn()} header={<div />} />, 'en');
    expect(screen.getByLabelText(/Invitation code/)).toBeRequired();
  });
});