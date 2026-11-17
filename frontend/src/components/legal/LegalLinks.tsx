import { LegalDocument, LEGAL_DOCUMENTS } from '../../pages/legal/legal-documents';

interface LegalLinksProps {
  current?: LegalDocument;
  onOpen?: (document: LegalDocument) => void;
  className?: string;
}

// Shared footer for the login/register/dashboard screens and for the legal
// documents themselves. The anchors keep a real href so they can be opened in a
// new tab or followed when JavaScript routing is not involved; when the app
// provides onOpen the click is handled in memory (no reload, no session loss).
export default function LegalLinks({ current, onOpen, className }: LegalLinksProps) {
  return (
    <nav className={className ? `legal-links ${className}` : 'legal-links'} aria-label="Información legal">
      {LEGAL_DOCUMENTS.map((item) => (
        <a
          key={item.id}
          href={item.path}
          aria-current={current === item.id ? 'page' : undefined}
          onClick={
            onOpen
              ? (event) => {
                  // Let the browser handle new-tab/new-window clicks normally.
                  if (
                    event.defaultPrevented ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return;
                  }
                  event.preventDefault();
                  onOpen(item.id);
                }
              : undefined
          }
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
