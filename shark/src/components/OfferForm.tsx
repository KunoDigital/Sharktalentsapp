import { useState } from 'react';
import { useApi, ApiError } from '../lib/api';

type Props = {
  applicationId: string;
  candidateName: string;
  jobTitle?: string;
  onSent?: (signRequestId: string) => void;
};

/**
 * Form para mandar oferta laboral al candidato finalist.
 *
 * Llama POST /api/applications/:id/send-offer con subject + message + document_url o template_id.
 * Backend crea sign request en Zoho Sign → candidato recibe email con link para firmar.
 * Cuando firma, webhook /api/webhooks/zoho-sign actualiza pipeline_stage a 'hired'.
 */
export default function OfferForm({ applicationId, candidateName, jobTitle, onSent }: Props) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(`Oferta laboral${jobTitle ? ` — ${jobTitle}` : ''}`);
  const [message, setMessage] = useState(
    `Hola ${candidateName},\n\nNos complace ofrecerte la posición. Por favor revisa y firma el contrato adjunto.\n\nSaludos.`,
  );
  const [documentUrl, setDocumentUrl] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [useTemplate, setUseTemplate] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ signRequestId: string; signingUrls?: Array<{ url: string; signer_email: string }> } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await api.applications.sendOffer(applicationId, {
        subject,
        message,
        document_url: !useTemplate && documentUrl ? documentUrl : undefined,
        template_id: useTemplate && templateId ? templateId : undefined,
      });
      setSent({ signRequestId: r.sign_request_id, signingUrls: r.signing_urls });
      if (onSent) onSent(r.sign_request_id);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message;
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div style={{ padding: '0.85rem 1rem', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px' }}>
        <div style={{ fontWeight: 700, color: 'var(--st-ok, #22c55e)', marginBottom: '0.4rem' }}>
          ✓ Oferta enviada para firma
        </div>
        <div className="muted small">Sign request ID: <code>{sent.signRequestId}</code></div>
        <p className="muted small" style={{ marginTop: '0.5rem' }}>
          El candidato recibirá email con el link para firmar. Cuando firme, el sistema actualiza
          el pipeline a <strong>hired</strong> automáticamente.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn-toolbar" onClick={() => setOpen(true)}>
        📜 Mandar oferta para firma
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '0.6rem', padding: '0.85rem 1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '8px' }}>
      <div style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.2rem' }}>
        Mandar oferta a {candidateName}
      </div>

      <label style={{ fontSize: '0.85rem' }}>
        Asunto
        <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} required style={{ width: '100%' }} />
      </label>

      <label style={{ fontSize: '0.85rem' }}>
        Mensaje
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} style={{ width: '100%' }} />
      </label>

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', fontSize: '0.85rem' }}>
        <label style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
          <input type="radio" checked={useTemplate} onChange={() => setUseTemplate(true)} />
          Usar template Zoho Sign
        </label>
        <label style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
          <input type="radio" checked={!useTemplate} onChange={() => setUseTemplate(false)} />
          PDF custom (URL)
        </label>
      </div>

      {useTemplate ? (
        <label style={{ fontSize: '0.85rem' }}>
          Template ID (Zoho Sign)
          <input
            type="text"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            placeholder="ej: tmpl_offer_default_2026"
            required
            style={{ width: '100%' }}
          />
        </label>
      ) : (
        <label style={{ fontSize: '0.85rem' }}>
          URL del PDF a firmar
          <input
            type="url"
            value={documentUrl}
            onChange={(e) => setDocumentUrl(e.target.value)}
            placeholder="https://..."
            required
            style={{ width: '100%' }}
          />
        </label>
      )}

      {error && (
        <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.25)', borderRadius: '6px', fontSize: '0.85rem' }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Enviando...' : 'Mandar oferta'}
        </button>
        <button type="button" className="cd-btn-ghost" onClick={() => { setOpen(false); setError(null); }}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
