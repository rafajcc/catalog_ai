import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import App from './App';

vi.mock('./services/api-service', () => ({
  getApiService: () => ({
    login: vi.fn().mockResolvedValue({ success: false }),
    logout: vi.fn().mockResolvedValue({ success: true }),
    registerComercio: vi.fn().mockResolvedValue({ success: false })
  })
}));

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    document.querySelector('meta[name="robots"]')?.remove();
  });

  it('renders the login page in Spanish by default', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
  });

  it('renders the login page in English when language preference is stored', () => {
    window.localStorage.setItem('catalogai_lang', 'en');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('normalizes a bogus path back to the app root in the address bar', () => {
    window.history.replaceState({}, '', '/cualquier/path');
    render(<App />);
    expect(window.location.pathname).toBe('/');
  });

  it('renders the legal notice without login and marks it noindex', () => {
    window.history.replaceState({}, '', '/aviso-legal');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Aviso legal', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText(/Rafael Culebras Cabeza/).length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe('/aviso-legal');
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow');
  });

  it('renders the privacy and cookie policies from their public URLs', () => {
    window.history.replaceState({}, '', '/privacidad');
    const view = render(<App />);
    expect(screen.getByRole('heading', { name: 'Política de privacidad', level: 1 })).toBeInTheDocument();
    view.unmount();

    window.history.replaceState({}, '', '/cookies');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Política de cookies', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText('access_token').length).toBeGreaterThan(0);
  });
});
