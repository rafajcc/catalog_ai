import { render, RenderResult } from '@testing-library/react';
import { ReactElement } from 'react';
import { I18nProvider, Language, STORAGE_KEY } from './i18n';

export function renderWithI18n(ui: ReactElement, language: Language = 'es'): RenderResult {
  window.localStorage.setItem(STORAGE_KEY, language);
  return render(<I18nProvider>{ui}</I18nProvider>);
}
