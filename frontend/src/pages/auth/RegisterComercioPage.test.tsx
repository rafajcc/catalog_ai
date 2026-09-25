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

  it('shows the localized error when the invitation code is rejected', async () => {
    mockApi.registerComercio = vi.fn().mockRejectedValue({
      response: {
        status: 400,
        data: { error: { code: 'INVALID_INVITATION_CODE', message: 'Invalid, already used or expired invitation code' } }
      }
    });
    renderWithI18n(<RegisterComercioPage onBackToLogin={vi.fn()} header={<div />} />, 'es');
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Nombre del comercio/), 'Mi Tienda');
    await user.type(screen.getByLabelText(/Usuario administrador/), 'owner');
    await user.type(screen.getByLabelText(/Contraseña del administrador/), 'SuperPass123');
    await user.type(screen.getByLabelText(/Código de invitación/), 'ABC234XYZ789');
    await user.click(screen.getByRole('button', { name: 'Crear comercio' }));

    expect(await screen.findByText('El código de invitación no es válido, ya se ha usado o ha caducado')).toBeInTheDocument();
  });

  it('shows a localized message when the username is already taken by another business', async () => {
    mockApi.registerComercio = vi.fn().mockRejectedValue({
      response: {
        status: 409,
        data: { error: { code: 'USERNAME_TAKEN', message: 'This username is already in use' } }
      }
    });
    renderWithI18n(<RegisterComercioPage onBackToLogin={vi.fn()} header={<div />} />, 'es');
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Nombre del comercio/), 'Mi Tienda');
    await user.type(screen.getByLabelText(/Usuario administrador/), 'owner');
    await user.type(screen.getByLabelText(/Contraseña del administrador/), 'SuperPass123');
    await user.type(screen.getByLabelText(/Código de invitación/), 'ABC234XYZ789');
    await user.click(screen.getByRole('button', { name: 'Crear comercio' }));

    expect(await screen.findByText('Ese nombre de usuario ya lo está usando otro comercio')).toBeInTheDocument();
  });
});