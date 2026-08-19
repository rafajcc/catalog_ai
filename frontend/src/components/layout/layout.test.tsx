import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppHeader from './AppHeader';
import { renderWithI18n } from '../../test-utils';

describe('AppHeader', () => {
  it('shows the application title and status', () => {
    renderWithI18n(<AppHeader status="Online" />, 'en');
    expect(screen.getByText('Catalog AI')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Status: Online');
  });

  it('shows an offline status in red', () => {
    renderWithI18n(<AppHeader status="Offline" />, 'en');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Offline');
    expect(status.querySelector('.chip')?.className).toContain('error');
  });

  it('switches the UI language via the selector', async () => {
    renderWithI18n(<AppHeader status="Online" />, 'es');
    expect(screen.getByRole('status')).toHaveTextContent('En línea');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'EN' }));

    expect(screen.getByRole('status')).toHaveTextContent('Status: Online');
  });

  it('toggles configuration via the settings button', async () => {
    const onToggleConfiguration = jest.fn();
    renderWithI18n(
      <AppHeader status="Online" configurationOpen={false} onToggleConfiguration={onToggleConfiguration} />,
      'en'
    );

    const settings = screen.getByRole('button', { name: 'Settings' });
    expect(settings).toBeInTheDocument();
    expect(settings).toHaveAttribute('aria-pressed', 'false');

    const user = userEvent.setup();
    await user.click(settings);

    expect(onToggleConfiguration).toHaveBeenCalledTimes(1);
  });

  it('navigates home when the application title is clicked', async () => {
    const onHome = jest.fn();
    renderWithI18n(<AppHeader status="Online" onHome={onHome} />, 'en');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Go to home' }));

    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('shows the users button when onToggleUsers is provided', () => {
    renderWithI18n(
      <AppHeader status="Online" onToggleUsers={jest.fn()} />,
      'en'
    );
    expect(screen.getByRole('button', { name: 'User Management' })).toBeInTheDocument();
  });

  it('does not show the users button when onToggleUsers is not provided', () => {
    renderWithI18n(<AppHeader status="Online" />, 'en');
    expect(screen.queryByRole('button', { name: 'User Management' })).not.toBeInTheDocument();
  });
});
