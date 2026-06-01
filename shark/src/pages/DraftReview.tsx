import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  getDraftById,
  STATUS_LABELS,
  STATUS_COLOR,
  type TranscriptHighlight,
  MOCK_DRAFTS,
} from '../data/mockDrafts';
import { useApi } from '../lib/api';
import { config } from '../config';
import { logger } from '../lib/logger';
import './pages.css';
import './draft-review.css';

const log = logger('DRAFT_REVIEW');

const HL_LABEL: Record<TranscriptHighlight['type'], string> = {
  role: 'Rol',
  salary: 'Salario',
  urgency: 'Urgencia',
  context: 'Contexto',
  concern: 'Atención',
};

const HL_COLOR: Record<TranscriptHighlight['type'], string> = {
  role: 'role',
  salary: 'salary',
  urgency: 'urgency',
  context: 'context',
  concern: 'concern',
};

export default function DraftReview() {
  const { id } = useParams<{ id: string }>();
  const api = useApi();
  const navigate = useNavigate();
  const mockDraft = id ? getDraftById(id) : undefined;
  const isMockId = !!mockDraft || (id ? MOCK_DRAFTS.some((d) => d.id === id) : false);

  const [draft, setDraft] = useState<typeof mockDraft>(mockDraft);
  const [loading, setLoading] = useState(!isMockId && config.useApi && !!id);
  const [edited, setEdited] = useState(mockDraft?.draft ?? null);
  const [decision, setDecision] = useState<'approve' | 'request_more' | 'discard' | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (isMockId || !id || !config.useApi) return;
    let cancelled = false;
    api.drafts.get(id)
      .then((res) => {
        if (cancelled) return;
        const adapted = adaptBackendDraft(res.draft);
        setDraft(adapted);
        setEdited(adapted.draft ?? null);
      })
      .catch((err) => {
        log.warn('failed to fetch draft', { error: (err as Error).message });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, isMockId]);

  if (loading) {
    return <div><p className="muted">Cargando draft…</p></div>;
  }

  if (!draft) {
    return (
      <div>
        <p>Draft no encontrado. <Link to="/drafts">Volver</Link></p>
      </div>
    );
  }

  function patch<K extends keyof NonNullable<typeof edited>>(key: K, value: NonNullable<typeof edited>[K]) {
    setEdited((curr) => (curr ? { ...curr, [key]: value } : curr));
  }

  function patchVelna<K extends keyof NonNullable<typeof edited>['velna_ideal']>(
    key: K,
    value: number,
  ) {
    setEdited((curr) => (curr ? { ...curr, velna_ideal: { ...curr.velna_ideal, [key]: value } } : curr));
  }

  async function handleSubmit() {
    if (!decision || !id) return;
    if (isMockId || !config.useApi) {
      const msg = decision === 'approve'
        ? 'Mock: draft aprobado y enviado al cliente.'
        : decision === 'request_more'
          ? 'Mock: pedido de más info enviado al cliente.'
          : 'Mock: draft descartado y reagendar reunión.';
      alert(msg);
      return;
    }
    setActionPending(true);
    setActionError(null);
    try {
      if (decision === 'approve') {
        // Aprobar = enviar el draft al cliente para validación.
        // El Job real se crea SOLO cuando el cliente apruebe desde el portal externo.
        //
        // IMPORTANTE: NO hacemos patch del draft_payload acá, porque el shape `edited`
        // del admin es un subset del shape real generado por la IA (le falta
        // objetivo_cargo, responsabilidades, tareas_especificas, herramientas, perfil
        // del candidato, DISC narrativo, etc.). Si pisamos el payload con el subset,
        // perdemos toda la información narrativa que el portal del cliente necesita
        // mostrar. Si querés editar el draft antes de enviarlo al cliente, eso será
        // un flow separado (no implementado todavía).
        // Si el draft no tiene email guardado, pedírselo a Cris en el momento.
        let clientEmailToSend: string | undefined;
        const existingEmail = draft?.client_email?.trim() || '';
        if (!existingEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(existingEmail)) {
          const input = prompt(
            'El draft no tiene email del cliente. ¿A qué correo querés mandar la solicitud de aprobación?',
            '',
          );
          if (!input) {
            setActionPending(false);
            return;
          }
          const trimmed = input.trim().toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
            setActionError('El email ingresado no es válido.');
            setActionPending(false);
            return;
          }
          clientEmailToSend = trimmed;
        }
        const res = await api.drafts.sendToClient(id, clientEmailToSend ? { client_email: clientEmailToSend } : undefined);
        // Copiar el portal_url al clipboard automáticamente — el alert no permite seleccionar
        try {
          await navigator.clipboard.writeText(res.portal_url);
          alert('Listo. El cliente recibió un email con el link para revisar el perfil.\n\nEl link del portal también se copió a tu portapapeles — pegalo (Cmd+V) en una pestaña nueva para verlo vos mismo.');
        } catch {
          // Fallback: clipboard API puede fallar en contextos sin HTTPS o sin permiso.
          // Mostrar el link en una ventana nueva.
          const w = window.open('', '_blank', 'width=600,height=200');
          if (w) {
            w.document.write(`<html><body style="font-family:sans-serif;padding:20px;"><h3>Link del portal del cliente</h3><p>Copiá este link (el cliente también lo recibió por email):</p><input type="text" value="${res.portal_url}" style="width:100%;padding:8px;font-size:14px" readonly onclick="this.select()" /><p style="margin-top:12px"><a href="${res.portal_url}" target="_blank">Abrir directamente</a></p></body></html>`);
          } else {
            alert(`Listo. El cliente recibió un email.\n\nLink del portal:\n${res.portal_url}`);
          }
        }
        navigate('/drafts');
      } else if (decision === 'request_more') {
        await api.drafts.patch(id, { status: 'client_changes_requested' });
        alert('Cambios solicitados — draft marcado para revisión.');
      } else {
        await api.drafts.patch(id, { status: 'discarded' });
        navigate('/drafts');
      }
    } catch (err) {
      setActionError((err as Error).message || 'No se pudo aplicar la acción.');
    } finally {
      setActionPending(false);
    }
  }

  return (
    <div className="draft-review">
      <Link to="/drafts" className="back-link">← Drafts</Link>

      <div className="page-header-row">
        <div>
          <h1 className="page-title">Revisión de draft</h1>
          <p className="page-subtitle">
            {draft.client_company} — {draft.client_name} · reunión {draft.meeting_date} ({draft.meeting_duration_min} min)
          </p>
        </div>
        <span className={`status-tag drafts-status-${STATUS_COLOR[draft.status]}`}>
          {STATUS_LABELS[draft.status]}
        </span>
      </div>

      {(() => {
        const comments = (draft as unknown as { client_comments?: Array<{ at: string; text: string }> }).client_comments;
        if (!comments || comments.length === 0) return null;
        return (
          <section style={{
            background: 'rgba(255, 200, 0, 0.08)',
            border: '1px solid rgba(255, 200, 0, 0.4)',
            borderRadius: '10px',
            padding: '1rem 1.25rem',
            marginBottom: '1rem',
          }}>
            <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#f0b330', marginBottom: '0.5rem', fontWeight: 600 }}>
              💬 Comentarios del cliente ({comments.length})
            </div>
            {comments.map((c, i) => (
              <div key={i} style={{
                marginBottom: i < comments.length - 1 ? '0.6rem' : 0,
                paddingBottom: i < comments.length - 1 ? '0.6rem' : 0,
                borderBottom: i < comments.length - 1 ? '1px dashed rgba(255, 200, 0, 0.2)' : 'none',
              }}>
                <div style={{ fontSize: '0.72rem', color: '#888', marginBottom: '0.25rem' }}>
                  {new Date(c.at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                </div>
                <div style={{ fontSize: '0.95rem', color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
                  {c.text}
                </div>
              </div>
            ))}
          </section>
        );
      })()}

      <section className="draft-summary-card">
        <div className="draft-summary-label">RESUMEN DE LA REUNIÓN (IA)</div>
        <p className="draft-summary-text">{draft.ia_summary_meeting}</p>
        {draft.ia_concerns && draft.ia_concerns.length > 0 && (
          <div className="draft-concerns">
            <div className="draft-concerns-label">⚠️ Atención antes de aprobar:</div>
            <ul>
              {draft.ia_concerns.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
        )}
      </section>

      <div className="draft-split">
        {/* IZQUIERDA: transcripción */}
        <section className="draft-panel">
          <div className="draft-panel-header">
            <h2>Transcripción</h2>
            <span className="muted small">
              fuente: {draft.transcript_source === 'zia' ? 'Zia' : 'Whisper (fallback)'}
            </span>
          </div>

          <div className="draft-highlights">
            <div className="draft-highlights-label">Highlights IA</div>
            <div className="draft-highlights-list">
              {draft.highlights.map((h, i) => (
                <div key={i} className={`draft-hl draft-hl-${HL_COLOR[h.type]}`}>
                  <span className="draft-hl-tag">{HL_LABEL[h.type]}</span>
                  <span className="draft-hl-text">{h.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="draft-transcript">
            <pre>{draft.transcript}</pre>
          </div>
        </section>

        {/* DERECHA: draft editable */}
        <section className="draft-panel">
          <div className="draft-panel-header">
            <h2>Draft del puesto</h2>
            {!edited && (
              <span className="muted small">(IA no generó draft aún)</span>
            )}
          </div>

          {edited ? (
            <div className="draft-form">
              <Field label="Título del puesto">
                <input
                  type="text"
                  className="draft-input"
                  value={edited.title}
                  onChange={(e) => patch('title', e.target.value)}
                />
              </Field>

              <Field label="Contexto de la empresa">
                <textarea
                  className="draft-input draft-textarea"
                  rows={4}
                  value={edited.context}
                  onChange={(e) => patch('context', e.target.value)}
                />
              </Field>

              <Field label="Perfil DISC ideal — descripción humana">
                <textarea
                  className="draft-input draft-textarea"
                  rows={3}
                  value={edited.disc_ideal_text}
                  onChange={(e) => patch('disc_ideal_text', e.target.value)}
                />
              </Field>

              <div className="draft-disc-row">
                <span className="draft-disc-pk">{edited.pk_profile_code} — {edited.pk_profile_name}</span>
                <div className="draft-disc-bars-edit">
                  {(['d', 'i', 's', 'c'] as const).map((k) => (
                    <div key={k} className="draft-disc-bar-edit">
                      <span className="draft-disc-letter">{k.toUpperCase()}</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="draft-disc-input"
                        value={edited[`disc_ideal_${k}` as 'disc_ideal_d']}
                        onChange={(e) => patch(`disc_ideal_${k}` as 'disc_ideal_d', Number(e.target.value))}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <Field label="VELNA ideal">
                <div className="draft-velna-grid">
                  {(['verbal', 'espacial', 'logica', 'numerica', 'abstracta'] as const).map((k) => (
                    <div key={k} className="draft-velna-row-edit">
                      <span className="draft-velna-label-edit">{k.charAt(0).toUpperCase() + k.slice(1)}</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="draft-velna-input"
                        value={edited.velna_ideal[k]}
                        onChange={(e) => patchVelna(k, Number(e.target.value))}
                      />
                    </div>
                  ))}
                </div>
              </Field>

              <Field label="Competencias clave">
                <div className="draft-competencias">
                  {edited.competencias.map((c, i) => (
                    <div key={i} className="draft-competencia-row">
                      <input
                        type="text"
                        className="draft-input draft-comp-name"
                        value={c.name}
                        onChange={(e) => {
                          const newComps = [...edited.competencias];
                          newComps[i] = { ...c, name: e.target.value };
                          patch('competencias', newComps);
                        }}
                      />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="draft-input draft-comp-pct"
                        value={c.required_pct}
                        onChange={(e) => {
                          const newComps = [...edited.competencias];
                          newComps[i] = { ...c, required_pct: Number(e.target.value) };
                          patch('competencias', newComps);
                        }}
                      />
                      <span className="draft-comp-pct-suffix">%</span>
                    </div>
                  ))}
                </div>
              </Field>

              <div className="draft-grid-3">
                <Field label="Salario mín ($USD)">
                  <input
                    type="number"
                    className="draft-input"
                    value={edited.salary_range_min_usd}
                    onChange={(e) => patch('salary_range_min_usd', Number(e.target.value))}
                  />
                </Field>
                <Field label="Salario máx ($USD)">
                  <input
                    type="number"
                    className="draft-input"
                    value={edited.salary_range_max_usd}
                    onChange={(e) => patch('salary_range_max_usd', Number(e.target.value))}
                  />
                </Field>
                <Field label="Mínimo técnica %">
                  <input
                    type="number"
                    className="draft-input"
                    value={edited.tecnica_minimo_pct}
                    onChange={(e) => patch('tecnica_minimo_pct', Number(e.target.value))}
                  />
                </Field>
              </div>

              <div className="draft-grid-2">
                <Field label="Modalidad">
                  <select
                    className="draft-input"
                    value={edited.modalidad}
                    onChange={(e) => patch('modalidad', e.target.value as typeof edited.modalidad)}
                  >
                    <option>Presencial</option>
                    <option>Híbrido</option>
                    <option>Remoto</option>
                  </select>
                </Field>
                <Field label="Ubicación">
                  <input
                    type="text"
                    className="draft-input"
                    value={edited.ubicacion}
                    onChange={(e) => patch('ubicacion', e.target.value)}
                  />
                </Field>
              </div>
            </div>
          ) : (
            <div className="draft-pending-block">
              <p>La IA todavía no generó el draft. Estado: <strong>{STATUS_LABELS[draft.status]}</strong>.</p>
              <p className="muted small">Cuando esté listo, vas a poder revisar y editar acá.</p>
              <button className="btn-primary" onClick={() => alert('Mock: forzar generación IA del draft')}>
                Forzar generación IA
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Sticky bottom action bar */}
      <div className="draft-actions">
        <div className="draft-actions-buttons">
          <button
            className={`draft-action draft-action-approve ${decision === 'approve' ? 'is-selected' : ''}`}
            onClick={() => setDecision(decision === 'approve' ? null : 'approve')}
            disabled={!edited}
          >
            ✓ Aprobar y mandar al cliente
          </button>
          <button
            className={`draft-action draft-action-warn ${decision === 'request_more' ? 'is-selected' : ''}`}
            onClick={() => setDecision(decision === 'request_more' ? null : 'request_more')}
          >
            ✏️ Pedir más info al cliente
          </button>
          <button
            className={`draft-action draft-action-danger ${decision === 'discard' ? 'is-selected' : ''}`}
            onClick={() => setDecision(decision === 'discard' ? null : 'discard')}
          >
            ✕ Descartar y reagendar
          </button>
        </div>
        {decision && (
          <button className="btn-primary draft-action-submit" onClick={handleSubmit} disabled={actionPending}>
            {actionPending
              ? (decision === 'approve' ? 'Enviando al cliente…' : 'Aplicando…')
              : (decision === 'approve' ? 'Enviar al cliente para validar' : 'Confirmar acción')}
          </button>
        )}
        {actionError && (
          <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(220,53,69,0.1)', border: '1px solid rgba(220,53,69,0.4)', borderRadius: '6px', color: '#ff8888', fontSize: '0.88rem' }}>
            {actionError}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="draft-field">
      <div className="draft-field-label">{label}</div>
      {children}
    </div>
  );
}

function adaptBackendDraft(d: { ROWID: string; status: string; transcript: string | null; transcript_source: string; meeting_url: string | null; draft_payload: string; client_email: string | null; created_at: string; highlights?: string | null }): typeof MOCK_DRAFTS[number] {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(d.draft_payload); } catch { /* empty */ }

  // Comentarios del cliente — guardados en columna highlights como JSON { client_comments: [{at, text}] }
  let clientComments: Array<{ at: string; text: string }> = [];
  if (d.highlights) {
    try {
      const parsedHl = JSON.parse(d.highlights);
      if (parsedHl && Array.isArray(parsedHl.client_comments)) {
        clientComments = parsedHl.client_comments;
      }
    } catch { /* highlights podría ser viejo formato, ignorar */ }
  }
  const statusMap: Record<string, typeof MOCK_DRAFTS[number]['status']> = {
    draft_generated: 'draft_generated',
    pending_client_review: 'sent_to_client',
    client_approved: 'client_approved',
    client_changes_requested: 'client_requested_changes',
    converted_to_job: 'archived',
    discarded: 'archived',
  };

  const discIdeal = (payload.disc_ideal as { d?: number; i?: number; s?: number; c?: number; description?: string[] }) ?? {};
  const velna = (payload.velna_ideal as { verbal?: number; espacial?: number; logica?: number; numerica?: number; abstracta?: number }) ?? {};
  const salaryRange = (payload.salary_range_usd as { min?: number; max?: number }) ?? {};
  const competenciasArr = Array.isArray(payload.competencias)
    ? (payload.competencias as Array<{ name: string; required_pct: number }>)
    : [];
  const highlightsArr = Array.isArray(payload.highlights_from_transcript)
    ? (payload.highlights_from_transcript as Array<{ type: string; text: string }>)
        .map((h) => ({ type: h.type as TranscriptHighlight['type'], text: h.text, start: 0, end: h.text.length }))
    : [];

  return {
    id: d.ROWID,
    status: statusMap[d.status] ?? 'draft_generated',
    meeting_date: d.created_at?.slice(0, 10) ?? '',
    meeting_duration_min: 30,
    transcript_source: (d.transcript_source as 'zia' | 'whisper') ?? 'zia',
    client_company: typeof payload.company === 'string' ? payload.company : '—',
    client_name: d.client_email ?? '—',
    client_email: d.client_email ?? '',
    transcript_excerpt: d.transcript ? d.transcript.slice(0, 300) : '',
    transcript: d.transcript ?? '',
    draft: {
      title: typeof payload.title === 'string' ? payload.title : 'Puesto sin título',
      context: typeof payload.context_summary === 'string' ? payload.context_summary : '',
      disc_ideal_text: Array.isArray(discIdeal.description) ? discIdeal.description.join(' · ') : '',
      disc_ideal_d: discIdeal.d ?? 50,
      disc_ideal_i: discIdeal.i ?? 50,
      disc_ideal_s: discIdeal.s ?? 50,
      disc_ideal_c: discIdeal.c ?? 50,
      pk_profile_code: 'PK',
      pk_profile_name: 'Personalizado',
      velna_ideal: {
        verbal: velna.verbal ?? 70,
        espacial: velna.espacial ?? 65,
        logica: velna.logica ?? 75,
        numerica: velna.numerica ?? 70,
        abstracta: velna.abstracta ?? 70,
      },
      competencias: competenciasArr,
      salary_range_min_usd: salaryRange.min ?? 0,
      salary_range_max_usd: salaryRange.max ?? 0,
      modalidad: 'Presencial',
      ubicacion: '',
      tecnica_minimo_pct: typeof payload.tecnica_minimo_pct === 'number' ? payload.tecnica_minimo_pct : 60,
    },
    ia_concerns: [],
    history: [],
    highlights: highlightsArr,
    created_at: d.created_at,
    ia_summary_meeting: typeof payload.context_summary === 'string' ? payload.context_summary : '',
    client_comments: clientComments,
  } as unknown as typeof MOCK_DRAFTS[number] & { client_comments: Array<{ at: string; text: string }> };
}
