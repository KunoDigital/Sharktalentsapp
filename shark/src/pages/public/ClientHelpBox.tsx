/**
 * Help box reutilizable para el portal cliente. Toma email/whatsapp del recruiter
 * desde la prop. Si no hay whatsapp, muestra solo email.
 */
export function ClientHelpBox({
  recruiterEmail,
  recruiterWhatsapp,
}: {
  recruiterEmail?: string;
  recruiterWhatsapp?: string | null;
}) {
  const email = recruiterEmail || 'proyectos@kunodigital.com';

  // Build WhatsApp link: format wa.me/XXX (sin + sin spaces sin guiones)
  const waNumber = recruiterWhatsapp?.replace(/\D/g, '');
  const waLink = waNumber ? `https://wa.me/${waNumber}` : null;

  return (
    <div className="cp-help-box">
      <div className="cp-help-title">¿Necesitás ayuda?</div>
      <p style={{ margin: 0 }}>
        Escribime a <a href={`mailto:${email}`} className="cp-help-link">{email}</a>
        {waLink && (
          <>
            {' o por '}
            <a href={waLink} target="_blank" rel="noopener" className="cp-help-link">
              WhatsApp
            </a>
          </>
        )}
        . Te respondo el mismo día.
      </p>
    </div>
  );
}
