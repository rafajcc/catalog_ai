import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock('./services/api-service', () => ({
  getApiService: () => ({
    login: jest.fn().mockResolvedValue({ success: false }),
    logout: jest.fn().mockResolvedValue({ success: true }),
    registerComercio: jest.fn().mockResolvedValue({ success: false })
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
