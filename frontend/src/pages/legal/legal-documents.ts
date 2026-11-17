// Public legal pages. They are loaded from a real URL (the backend serves
// index.html for any GET), so they must be reachable without a session and must
// never be offered to search engines.

export type LegalDocument = 'aviso-legal' | 'privacidad' | 'cookies';

export interface LegalDocumentDefinition {
  id: LegalDocument;
  path: string;
  label: string;
}

export const LEGAL_DOCUMENTS: LegalDocumentDefinition[] = [
  { id: 'aviso-legal', path: '/aviso-legal', label: 'Aviso legal' },
  { id: 'privacidad', path: '/privacidad', label: 'Política de privacidad' },
  { id: 'cookies', path: '/cookies', label: 'Política de cookies' }
];

export function legalDocumentFromPath(pathname: string): LegalDocument | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return LEGAL_DOCUMENTS.find((doc) => doc.path === normalized)?.id ?? null;
}

export function legalPath(document: LegalDocument): string {
  return LEGAL_DOCUMENTS.find((doc) => doc.id === document)?.path ?? '/';
}
