import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UserManagementPage from './UserManagementPage';
import { renderWithI18n } from '../../test-utils';

var mockApi: any;

vi.mock('../../services/api-service', () => ({
  getApiService: () => mockApi
}));

describe('UserManagementPage', () => {
  beforeEach(() => {
    mockApi = {
      getUsers: vi.fn().mockResolvedValue({
        success: true,
        users: [
          { id: 1, username: 'admin', role: 'admin', comercio_id: 1 },
          { id: 2, username: 'juan', role: 'user', comercio_id: 1 }
        ]
      }),
      createUser: vi.fn().mockResolvedValue({ success: true, user: { id: 3, username: 'maria', role: 'user' } }),
      updateUser: vi.fn().mockResolvedValue({ success: true }),
      deleteUser: vi.fn().mockResolvedValue({ success: true })
    };
  });

  it('renders the user list', async () => {
    renderWithI18n(<UserManagementPage onBack={vi.fn()} currentUserId={1} />, 'en');
    expect(await screen.findByText('admin')).toBeInTheDocument();
    expect(screen.getByText('juan')).toBeInTheDocument();
  });

  it('shows (you) badge next to the current user', async () => {
    renderWithI18n(<UserManagementPage onBack={vi.fn()} currentUserId={1} />, 'en');
    await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument());
    expect(screen.getByText('(you)')).toBeInTheDocument();
  });

  it('disables delete and role toggle for the current user', async () => {
    renderWithI18n(<UserManagementPage onBack={vi.fn()} currentUserId={1} />, 'en');
    await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument());

    const rows = screen.getAllByRole('row');
    const adminRow = rows[1]; // first data row
    const buttons = adminRow.querySelectorAll('button');
    buttons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('opens the create user form and creates a user', async () => {
    renderWithI18n(<UserManagementPage onBack={vi.fn()} currentUserId={1} />, 'en');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Add user' }));

    await user.type(screen.getByLabelText(/New username/), 'maria');
    await user.type(screen.getByLabelText(/Password/), 'AdminPass123');
    await user.click(screen.getByRole('button', { name: 'Create user' }));

    await waitFor(() => expect(mockApi.createUser).toHaveBeenCalledWith('maria', 'AdminPass123', 'user'));
    expect(await screen.findByText('User created successfully')).toBeInTheDocument();
  });

  it('deletes a user after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithI18n(<UserManagementPage onBack={vi.fn()} currentUserId={1} />, 'en');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('juan')).toBeInTheDocument());

    const rows = screen.getAllByRole('row');
    const juanRow = rows[2]; // second data row
    const deleteBtn = juanRow.querySelector('.btn-danger')!;
    await user.click(deleteBtn);

    await waitFor(() => expect(mockApi.deleteUser).toHaveBeenCalledWith(2));
    confirmSpy.mockRestore();
  });

  it('calls onBack when the back button is clicked', async () => {
    const onBack = vi.fn();
    renderWithI18n(<UserManagementPage onBack={onBack} currentUserId={1} />, 'en');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
