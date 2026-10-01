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
});
