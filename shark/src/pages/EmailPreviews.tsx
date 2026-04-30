import { useState } from 'react';
import './pages.css';
import './email-previews.css';

type EmailTemplate = {
  id: string;
  trigger: string;
  audience: 'candidato' | 'cliente';
  subject: string;
  body: string;
  cta: string;
  channels: ('email' | 'whatsapp')[];
};

const TEMPLATES: EmailTemplate[] = [
  {
    id: 'cand_apply_received',
    trigger: 'Candidato envía aplicación',
    audience: 'candidato',
    subject: '¡Recibimos tu aplicación, {{candidate.first_name}}!',
    body: `Hola {{candidate.first_name}},

Recibimos tu aplicación al puesto de {{job.title}} en {{job.client_company}}.

Para avanzar al siguiente paso, necesitamos que completes la prueba técnica. Tarda unos 20-30 minutos.

Hacela en un lugar tranquilo, sin interrupciones — no salgas de la pestaña ni copies/pegues, el sistema lo detecta y queda registrado.`,
    cta: 'Empezar prueba técnica',
    channels: ['email'],
  },
  {
    id: 'cand_tecnica_passed',
    trigger: 'Candidato pasa prueba técnica',
    audience: 'candidato',
    subject: '✓ Pasaste la prueba técnica — siguiente paso',
    body: `{{candidate.first_name}}, tu prueba técnica salió {{tecnica.pct}}%. Felicitaciones.

El siguiente paso es la evaluación conductual: DISC + cognitiva (VELNA) + emoción. Tarda 15-20 minutos.

Tip: hacela cuando estés tranquila/o. Las respuestas espontáneas son las que reflejan mejor tu perfil.`,
    cta: 'Empezar evaluación conductual',
    channels: ['email', 'whatsapp'],
  },
  {
    id: 'cand_rejected_cordial',
    trigger: 'Auto-rechazo del bot decisor',
    audience: 'candidato',
    subject: 'Sobre tu aplicación a {{job.title}}',
    body: `Hola {{candidate.first_name}},

Gracias por aplicar al puesto de {{job.title}} en {{job.client_company}}.

Después de revisar tu perfil, decidimos no avanzar con tu aplicación en esta oportunidad. {{rejection.reason_human}}

Tu información queda en nuestra base. Si surge un puesto que matchee mejor con tu perfil, te contactamos.`,
    cta: 'Ver otros puestos abiertos',
    channels: ['email'],
  },
  {
    id: 'client_draft_ready',
    trigger: 'IA generó draft post-reunión',
    audience: 'cliente',
    subject: 'Tu nuevo perfil de puesto está listo: {{job.title}}',
    body: `Hola {{client.first_name}},

Después de nuestra reunión, nuestra IA armó un borrador del perfil del puesto basándose en lo que conversamos.

Lo podés revisar acá. Si está bien, lo aprobás y empezamos a buscar candidatos. Si querés ajustar algo, dejá comentarios y lo actualizamos.

Tarda 5 minutos revisarlo.`,
    cta: 'Revisar y aprobar perfil',
    channels: ['email', 'whatsapp'],
  },
  {
    id: 'client_search_started',
    trigger: 'Cliente aprobó draft, búsqueda inicia',
    audience: 'cliente',
    subject: '🚀 Empezamos a buscar candidatos',
    body: `{{client.first_name}}, ya empezamos a buscar candidatos para {{job.title}}.

Te vamos a avisar cuando:
• Lleguen los primeros 5-10 candidatos al funnel
• Tengamos finalistas listos para entrevista (3 candidatos top)

Mientras tanto, podés ver el avance en tiempo real en tu portal.`,
    cta: 'Ver avance del puesto',
    channels: ['email'],
  },
  {
    id: 'client_finalists_ready',
    trigger: 'Finalistas listos, reporte publicado',
    audience: 'cliente',
    subject: '🎯 Tus finalistas están listos — {{job.title}}',
    body: `{{client.first_name}}, terminamos las evaluaciones.

{{finalists.count}} candidatos pasaron todas las pruebas (técnica, conductual, integridad y videos cortos). Te preparamos un reporte con análisis IA por candidato, comparativo, riesgos y recomendación final.

Click abajo, lo revisás en 5 min, y nos decís a quién querés entrevistar.`,
    cta: 'Ver reporte de finalistas',
    channels: ['email', 'whatsapp'],
  },
  {
    id: 'client_funnel_active',
    trigger: 'Funnel con candidatos en evaluación',
    audience: 'cliente',
    subject: 'Update: candidatos avanzando en {{job.title}}',
    body: `{{client.first_name}}, update rápido del puesto:

• {{funnel.applied}} aplicaron en total
• {{funnel.tecnica_done}} pasaron la prueba técnica
• {{funnel.conductual_done}} completaron la conductual
• ETA finalistas: {{funnel.eta}}

No tenés que hacer nada. Te avisamos cuando estén los finalistas.`,
    cta: 'Ver detalle del funnel',
    channels: ['email'],
  },
];

export default function EmailPreviews() {
  const [filter, setFilter] = useState<'all' | 'candidato' | 'cliente'>('all');
  const filtered = TEMPLATES.filter((t) => filter === 'all' || t.audience === filter);

  return (
    <div>
      <h1 className="page-title">Email templates</h1>
      <p className="page-subtitle">
        Vista previa de los emails que el sistema manda automáticamente. Cada uno se dispara por un evento del flujo.
      </p>

      <div className="filters-bar">
        <div className="filter-pills">
          {(['all', 'candidato', 'cliente'] as const).map((f) => (
            <button
              key={f}
              className={`filter-pill ${filter === f ? 'is-active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'Todos' : f === 'candidato' ? 'Candidato' : 'Cliente'}
              <span className="filter-pill-count">
                {f === 'all' ? TEMPLATES.length : TEMPLATES.filter((t) => t.audience === f).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="email-templates-grid">
        {filtered.map((t) => (
          <div key={t.id} className="email-template-card">
            <div className="email-template-meta">
              <span className={`email-audience-tag is-${t.audience}`}>{t.audience}</span>
              <span className="email-trigger">⚡ {t.trigger}</span>
              <span className="email-channels">
                {t.channels.includes('email') && '📧'} {t.channels.includes('whatsapp') && '💬'}
              </span>
            </div>
            <div className="email-preview-frame">
              <div className="email-from">
                <strong>De:</strong> Kuno Digital &lt;cris@kunodigital.com&gt;
              </div>
              <div className="email-subject">
                <strong>{t.subject}</strong>
              </div>
              <div className="email-body">{t.body}</div>
              <button className="email-cta-btn">{t.cta}</button>
              <div className="email-footer">
                Powered by <span className="email-brand">SharkTalents.AI</span> · Si no querés recibir estos emails, <a>desuscribirte acá</a>
              </div>
            </div>
            <div className="email-vars-hint">
              💡 Variables como <code>{'{{candidate.first_name}}'}</code> se reemplazan al enviar.
            </div>
          </div>
        ))}
      </div>

      <p className="muted-note">
        Backend (Catalyst function) renderiza estos templates con los datos reales del candidato/cliente y los manda vía proveedor de email + WhatsApp Business API.
      </p>
    </div>
  );
}
