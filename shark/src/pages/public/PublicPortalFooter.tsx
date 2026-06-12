import { Link } from 'react-router-dom';

const YEAR = new Date().getFullYear();

export function PublicPortalFooter({
  variant = 'portal',
  agencyName,
}: {
  variant?: 'portal' | 'report';
  agencyName?: string;
}) {
  const className = variant === 'report' ? 'pr-footer' : 'cp-footer';
  const brandClass = variant === 'report' ? 'pr-brand' : 'cp-brand';
  const tagClass = variant === 'report' ? 'pr-footer-tag' : 'cp-footer-tag';

  return (
    <footer className={className}>
      <div className={brandClass}>SharkTalents.AI</div>
      <div className={tagClass}>
        Powered by SharkTalents — evaluación de talento con IA
        {agencyName && <> · operado por {agencyName}</>}
      </div>
      <div className="ppf-legal">
        <Link to="/legal/privacidad" target="_blank" rel="noopener noreferrer">Privacidad</Link>
        <span aria-hidden="true">·</span>
        <Link to="/legal/terminos" target="_blank" rel="noopener noreferrer">Términos</Link>
        <span aria-hidden="true">·</span>
        <span>© {YEAR}</span>
      </div>
    </footer>
  );
}
