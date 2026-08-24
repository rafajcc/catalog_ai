import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
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
});
