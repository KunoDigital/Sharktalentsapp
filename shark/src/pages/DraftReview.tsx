import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  getDraftById,
  STATUS_LABELS,
  STATUS_COLOR,
  type TranscriptHighlight,
  MOCK_DRAFTS,
} from '../data/mockDrafts';
import { COMPETENCIAS, COMPETENCIAS_CANONICAS } from '../data/competencias';
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
  const [iterating, setIterating] = useState(false);
  const [extraFeedback, setExtraFeedback] = useState('');
  const [regeneratingNarrative, setRegeneratingNarrative] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  async function handlePreview() {
    if (!id || isMockId || !config.useApi) return;
    setPreviewing(true);
    setActionError(null);
    try {
      // Persistir los edits actuales antes de generar el preview — así el cliente
      // ve EXACTAMENTE lo que tú editaste.
      const payloadPatch: Record<string, unknown> = { ...payloadOverrides };
      if (edited && draft?.draft) {
        if (edited.title !== draft.draft.title) payloadPatch.title = edited.title;
        if (edited.context !== draft.draft.context) payloadPatch.context_summary = edited.context;
        if (discChanged || edited.disc_ideal_text !== draft.draft.disc_ideal_text) {
          payloadPatch.disc_ideal = {
            d: edited.disc_ideal_d, i: edited.disc_ideal_i,
            s: edited.disc_ideal_s, c: edited.disc_ideal_c,
            description: edited.disc_ideal_text
              ? edited.disc_ideal_text.split(' · ').filter(Boolean)
              : (rawPayload.disc_ideal as { description?: string[] } | undefined)?.description ?? [],
          };
        }
        payloadPatch.velna_ideal = { ...edited.velna_ideal };
        const validComps = edited.competencias.filter((c) => c.name && c.name.trim());
        if (validComps.length > 0) {
          payloadPatch.competencias = validComps.map((c) => ({ id: c.name, name: c.name, required_pct: c.required_pct }));
        }
        if (edited.salary_range_min_usd || edited.salary_range_max_usd) {
          payloadPatch.salary_range_usd = { min: edited.salary_range_min_usd, max: edited.salary_range_max_usd };
        }
        if (typeof edited.fee_usd === 'number') {
          payloadPatch.fee_usd = edited.fee_usd;
        }
      }
      if (Object.keys(payloadPatch).length > 0) {
        await api.drafts.patch(id, { draft_payload_patch: payloadPatch });
      }
      const res = await api.drafts.previewUrl(id);
      window.open(res.portal_url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setActionError((err as Error).message || 'No se pudo abrir el preview.');
    } finally {
      setPreviewing(false);
    }
  }

  // Detectar si los valores DISC editados difieren del original — si sí, la narrativa
  // (descripción + ventajas + desventajas) está desactualizada y conviene regenerarla.
  const discChanged = useMemo(() => {
    if (!draft || !edited || !draft.draft) return false;
    return (
      edited.disc_ideal_d !== draft.draft.disc_ideal_d ||
      edited.disc_ideal_i !== draft.draft.disc_ideal_i ||
      edited.disc_ideal_s !== draft.draft.disc_ideal_s ||
      edited.disc_ideal_c !== draft.draft.disc_ideal_c
    );
  }, [edited, draft]);

  async function handleRegenerateDiscNarrative() {
    if (!id || isMockId || !config.useApi || !edited) return;
    setRegeneratingNarrative(true);
    setActionError(null);
    try {
      const res = await api.drafts.regenerateDiscNarrative(id, {
        disc_ideal: {
          d: edited.disc_ideal_d, i: edited.disc_ideal_i,
          s: edited.disc_ideal_s, c: edited.disc_ideal_c,
        },
      });
      // Aplicar la narrativa nueva al state editado.
      // disc_ideal_text es el formato flat usado en la UI — joineamos description.
      setEdited((curr) => curr ? {
        ...curr,
        disc_ideal_text: res.narrative.disc_perfil_descripcion,
      } : curr);
      // Guardamos ventajas/desventajas en payloadOverrides para mandarlos en el PATCH del send.
      setPayloadOverrides((p) => ({
        ...p,
        disc_perfil_descripcion: res.narrative.disc_perfil_descripcion,
        disc_ventajas: res.narrative.disc_ventajas,
        disc_desventajas_potenciales: res.narrative.disc_desventajas_potenciales,
      }));
    } catch (err) {
      setActionError((err as Error).message || 'No se pudo regenerar la narrativa DISC.');
    } finally {
      setRegeneratingNarrative(false);
    }
  }

  // payloadOverrides — campos del payload editados directamente (no expuestos en el flat
  // `edited`) que se mandan en el PATCH cuando se envía al cliente. Incluye los campos
  // narrativos (responsabilidades, tareas, etc., Fase 4) y los regenerados por IA (Fase 3.5).
  const [payloadOverrides, setPayloadOverrides] = useState<Record<string, unknown>>({});
  // rawPayload — copia cruda del payload del backend para mostrar valores narrativos
  // (responsabilidades, tareas, etc.) que el adapter `MOCK_DRAFTS shape` no expone.
  const [rawPayload, setRawPayload] = useState<Record<string, unknown>>({});

  function nVal(key: string, fallback: unknown): unknown {
    // Lee del override si está; si no, del rawPayload original.
    if (key in payloadOverrides) return payloadOverrides[key];
    return key in rawPayload ? rawPayload[key] : fallback;
  }
  function setN(key: string, value: unknown) {
    setPayloadOverrides((p) => ({ ...p, [key]: value }));
  }

  async function handleIterate() {
    if (!id || isMockId || !config.useApi) return;
    setIterating(true);
    setActionError(null);
    try {
      await api.drafts.iterate(id, { extra_feedback: extraFeedback.trim() || undefined });
      // Recargar el draft completo desde el backend para tener el payload nuevo bien parseado
      const fresh = await api.drafts.get(id);
      const adapted = adaptBackendDraft(fresh.draft);
      setDraft(adapted);
      setEdited(adapted.draft ?? null);
      setExtraFeedback('');
      alert('Draft actualizado con IA usando los comentarios. Revísalo abajo y, cuando estés conforme, mándalo de vuelta al cliente.');
    } catch (err) {
      setActionError((err as Error).message || 'No se pudo iterar el draft con IA.');
    } finally {
      setIterating(false);
    }
  }

  useEffect(() => {
    if (isMockId || !id || !config.useApi) return;
    let cancelled = false;
    api.drafts.get(id)
      .then((res) => {
        if (cancelled) return;
        const adapted = adaptBackendDraft(res.draft);
        setDraft(adapted);
        setEdited(adapted.draft ?? null);
        // Guardamos el payload crudo para los inputs narrativos (responsabilidades, tareas, etc.)
        try {
          const raw = typeof res.draft.draft_payload === 'string'
            ? JSON.parse(res.draft.draft_payload)
            : (res.draft.draft_payload as Record<string, unknown>);
          if (raw && typeof raw === 'object') setRawPayload(raw);
        } catch { /* keep empty */ }
        // Reset de overrides al cargar otro draft.
        setPayloadOverrides({});
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
        // Aprobar = persistir los edits del admin (Fases 1-4) + enviar al cliente.
        // El Job real se crea SOLO cuando el cliente apruebe desde el portal externo.
        //
        // PATCH con draft_payload_patch hace DEEP-MERGE sobre el payload actual:
        // los campos editados acá pisan, los demás (narrativa que el admin no tocó)
        // quedan intactos. Backend valida (catálogo competencias, rangos, etc.).
        const payloadPatch: Record<string, unknown> = { ...payloadOverrides };
        if (edited && draft?.draft) {
          if (edited.title !== draft.draft.title) payloadPatch.title = edited.title;
          if (edited.context !== draft.draft.context) payloadPatch.context_summary = edited.context;
          // DISC: si cambió algún valor o el texto narrativo, mandamos el objeto entero.
          if (discChanged || edited.disc_ideal_text !== draft.draft.disc_ideal_text) {
            payloadPatch.disc_ideal = {
              d: edited.disc_ideal_d, i: edited.disc_ideal_i,
              s: edited.disc_ideal_s, c: edited.disc_ideal_c,
              description: edited.disc_ideal_text
                ? edited.disc_ideal_text.split(' · ').filter(Boolean)
                : (rawPayload.disc_ideal as { description?: string[] } | undefined)?.description ?? [],
            };
          }
          // Velna: mandamos siempre el objeto entero para que el merge profundo persista.
          payloadPatch.velna_ideal = { ...edited.velna_ideal };
          // Competencias: solo si tiene items con id no vacío.
          const validComps = edited.competencias.filter((c) => c.name && c.name.trim());
          if (validComps.length > 0) {
            payloadPatch.competencias = validComps.map((c) => ({ id: c.name, name: c.name, required_pct: c.required_pct }));
          }
          // Salary range
          if (edited.salary_range_min_usd || edited.salary_range_max_usd) {
            payloadPatch.salary_range_usd = { min: edited.salary_range_min_usd, max: edited.salary_range_max_usd };
          }
          if (typeof edited.tecnica_minimo_pct === 'number') {
            payloadPatch.tecnica_minimo_pct = edited.tecnica_minimo_pct;
          }
          // Fee del puesto — backend valida que sea > 0 con preconditions_not_met.
          if (typeof edited.fee_usd === 'number') {
            payloadPatch.fee_usd = edited.fee_usd;
          }
        }

        // Solo enviar PATCH si hay algo que cambiar — sino skipeamos para no consumir
        // un round-trip innecesario.
        if (Object.keys(payloadPatch).length > 0) {
          try {
            await api.drafts.patch(id, { draft_payload_patch: payloadPatch });
          } catch (err) {
            // Si la validación falla (ej. competencia no en catálogo, DISC fuera de rango),
            // no enviamos al cliente y mostramos el error.
            setActionError(`No se pudieron guardar los cambios: ${(err as Error).message}`);
            setActionPending(false);
            return;
          }
        }

        // Si el draft no tiene email guardado, pedírselo a Cris en el momento.
        let clientEmailToSend: string | undefined;
        const existingEmail = draft?.client_email?.trim() || '';
        if (!existingEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(existingEmail)) {
          const input = prompt(
            'El draft no tiene email del cliente. ¿A qué correo quieres mandar la solicitud de aprobación?',
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
          alert('Listo. El cliente recibió un email con el link para revisar el perfil.\n\nEl link del portal también se copió a tu portapapeles — pégalo (Cmd+V) en una pestaña nueva para verlo tú mismo.');
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
                <div style={{ fontSize: '1rem', color: '#fef3c7', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {c.text}
                </div>
              </div>
            ))}
            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255, 200, 0, 0.25)' }}>
              <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#f0b330', marginBottom: '0.5rem', fontWeight: 600 }}>
                🤖 Iterar perfil con IA
              </div>
              <p className="muted small" style={{ marginBottom: '0.5rem' }}>
                La IA va a reescribir el perfil aplicando los comentarios del cliente. Podés agregar instrucciones extra acá.
              </p>
              <textarea
                value={extraFeedback}
                onChange={(e) => setExtraFeedback(e.target.value)}
                placeholder="(Opcional) Instrucciones extra. Ej: 'también baja el seniority esperado y agrega React Native como deseable'"
                rows={2}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid rgba(255, 200, 0, 0.4)', background: '#1a1410', color: '#fef3c7', fontFamily: 'inherit', fontSize: '0.95rem', marginBottom: '0.5rem' }}
                disabled={iterating}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={handleIterate}
                disabled={iterating}
                style={{ background: '#f0b330', color: '#0e1218' }}
              >
                {iterating ? 'IA aplicando cambios…' : `Iterar perfil con IA (${comments.length} comentario${comments.length === 1 ? '' : 's'}${extraFeedback.trim() ? ' + feedback extra' : ''})`}
              </button>
            </div>
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

              {/* 2026-06-06: bloque nuevo "Análisis del puesto" — jefe + cualidades + tensiones + A vs B
                  generado por la IA con el prompt nuevo. Lee del rawPayload directo (no del adapter)
                  porque son campos que el shape MOCK no expone. */}
              <AnalisisDelPuesto payload={rawPayload} />

              <Field label="Perfil DISC ideal — descripción humana">
                <textarea
                  className="draft-input draft-textarea"
                  rows={3}
                  value={edited.disc_ideal_text}
                  onChange={(e) => patch('disc_ideal_text', e.target.value)}
                />
              </Field>

              {discChanged && (
                <div style={{
                  background: 'rgba(255, 200, 0, 0.12)',
                  border: '1px solid rgba(255, 200, 0, 0.5)',
                  borderRadius: '8px',
                  padding: '0.75rem 1rem',
                  marginBottom: '0.75rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '1rem',
                  flexWrap: 'wrap',
                }}>
                  <div style={{ flex: 1, minWidth: '300px' }}>
                    <strong style={{ color: '#f0b330' }}>⚠️ Valores DISC modificados</strong>
                    <p className="muted small" style={{ margin: '0.2rem 0 0' }}>
                      La descripción narrativa, ventajas y desventajas no coinciden con los nuevos valores. Regeneralas para que sean coherentes.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleRegenerateDiscNarrative}
                    disabled={regeneratingNarrative}
                    style={{ background: '#f0b330', color: '#0e1218', whiteSpace: 'nowrap' }}
                  >
                    {regeneratingNarrative ? 'Regenerando…' : '🤖 Regenerar narrativa'}
                  </button>
                </div>
              )}

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

              <Field label={`Competencias clave (max 5 — del catálogo cerrado)`}>
                <div className="draft-competencias">
                  {edited.competencias.map((c, i) => {
                    // IDs ya elegidos por OTRAS filas — para no permitir duplicados.
                    const usedIds = new Set(edited.competencias.map((x, j) => j !== i ? x.name : null).filter(Boolean));
                    return (
                      <div key={i} className="draft-competencia-row" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
                        <select
                          className="draft-input draft-comp-name"
                          value={c.name}
                          style={{ flex: 1 }}
                          onChange={(e) => {
                            const newComps = [...edited.competencias];
                            newComps[i] = { ...c, name: e.target.value };
                            patch('competencias', newComps);
                          }}
                        >
                          <option value="">— Elegir competencia —</option>
                          {/* Solo mostramos canónicas en el selector. Si un draft viejo guardó
                              un alias deprecado (ej. 'colaboracion'), el value sigue válido y
                              el label se renderiza con el nombre del alias también disponible. */}
                          {COMPETENCIAS_CANONICAS.map((cat) => (
                            <option key={cat.id} value={cat.id} disabled={usedIds.has(cat.id) && cat.id !== c.name}>
                              {cat.nombre}
                            </option>
                          ))}
                          {/* Si el draft actual tiene un alias deprecado, lo mostramos como opción
                              extra para que la UI no pierda la selección al re-render. */}
                          {c.name && !COMPETENCIAS_CANONICAS.some((cat) => cat.id === c.name) && (
                            <option key={c.name} value={c.name}>
                              {COMPETENCIAS.find((cat) => cat.id === c.name)?.nombre ?? c.name} (alias)
                            </option>
                          )}
                        </select>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          className="draft-input draft-comp-pct"
                          value={c.required_pct}
                          style={{ width: '70px' }}
                          onChange={(e) => {
                            const newComps = [...edited.competencias];
                            newComps[i] = { ...c, required_pct: Number(e.target.value) };
                            patch('competencias', newComps);
                          }}
                        />
                        <span className="draft-comp-pct-suffix">%</span>
                        <button
                          type="button"
                          className="btn-toolbar"
                          onClick={() => {
                            const newComps = edited.competencias.filter((_, j) => j !== i);
                            patch('competencias', newComps);
                          }}
                          title="Quitar competencia"
                          style={{ padding: '4px 10px' }}
                        >❌</button>
                      </div>
                    );
                  })}
                  {edited.competencias.length < 5 && (
                    <button
                      type="button"
                      className="btn-toolbar"
                      onClick={() => {
                        const newComps = [...edited.competencias, { name: '', required_pct: 70 }];
                        patch('competencias', newComps);
                      }}
                      style={{ marginTop: '0.4rem' }}
                    >➕ Agregar competencia</button>
                  )}
                </div>
              </Field>

              <Field label="Objetivo del cargo">
                <textarea
                  className="draft-input draft-textarea"
                  rows={3}
                  value={String(nVal('objetivo_cargo', '') ?? '')}
                  onChange={(e) => setN('objetivo_cargo', e.target.value)}
                />
              </Field>

              <Field label="Responsabilidades (una por línea)">
                <textarea
                  className="draft-input draft-textarea"
                  rows={6}
                  value={(Array.isArray(nVal('responsabilidades', [])) ? (nVal('responsabilidades', []) as string[]) : []).join('\n')}
                  onChange={(e) => setN('responsabilidades', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
                />
              </Field>

              <Field label="Tareas específicas (una por línea)">
                <textarea
                  className="draft-input draft-textarea"
                  rows={5}
                  value={(Array.isArray(nVal('tareas_especificas', [])) ? (nVal('tareas_especificas', []) as string[]) : []).join('\n')}
                  onChange={(e) => setN('tareas_especificas', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
                />
              </Field>

              <Field label="Herramientas / conocimientos (uno por línea)">
                <textarea
                  className="draft-input draft-textarea"
                  rows={4}
                  value={(Array.isArray(nVal('herramientas_conocimientos', [])) ? (nVal('herramientas_conocimientos', []) as string[]) : []).join('\n')}
                  onChange={(e) => setN('herramientas_conocimientos', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
                />
              </Field>

              <div className="draft-grid-3">
                <Field label="Formación requerida">
                  <textarea
                    className="draft-input draft-textarea"
                    rows={2}
                    value={String(nVal('formacion_requerida', '') ?? '')}
                    onChange={(e) => setN('formacion_requerida', e.target.value)}
                  />
                </Field>
                <Field label="Experiencia requerida">
                  <textarea
                    className="draft-input draft-textarea"
                    rows={2}
                    value={String(nVal('experiencia_requerida', '') ?? '')}
                    onChange={(e) => setN('experiencia_requerida', e.target.value)}
                  />
                </Field>
                {/* 2026-06-05: eliminado input "Salario (texto)" duplicado — usar el
                    rango numérico Salario mín/máx ($USD) más abajo. Tenían 2 fuentes
                    de verdad que se desincronizaban. */}
              </div>

              <Field label="DISC — Ventajas para este puesto (una por línea)">
                <textarea
                  className="draft-input draft-textarea"
                  rows={4}
                  value={(Array.isArray(nVal('disc_ventajas', [])) ? (nVal('disc_ventajas', []) as string[]) : []).join('\n')}
                  onChange={(e) => setN('disc_ventajas', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
                />
              </Field>

              <Field label="DISC — Desventajas potenciales (una por línea)">
                <textarea
                  className="draft-input draft-textarea"
                  rows={3}
                  value={(Array.isArray(nVal('disc_desventajas_potenciales', [])) ? (nVal('disc_desventajas_potenciales', []) as string[]) : []).join('\n')}
                  onChange={(e) => setN('disc_desventajas_potenciales', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
                />
              </Field>

              <div className="draft-grid-3">
                {/* 2026-06-05: eliminado input "Modalidad (texto)" duplicado — usar el
                    select Modalidad de abajo. Mantenemos Viajes + Reporta a porque son únicos. */}
                <Field label="Viajes">
                  <input
                    type="text"
                    className="draft-input"
                    value={String(nVal('viajes', '') ?? '')}
                    onChange={(e) => setN('viajes', e.target.value)}
                  />
                </Field>
                <Field label="Reporta a">
                  <input
                    type="text"
                    className="draft-input"
                    value={String(nVal('reporta_a', '') ?? '')}
                    onChange={(e) => setN('reporta_a', e.target.value)}
                  />
                </Field>
              </div>

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

              {/* 2026-06-05: Fee del puesto. Obligatorio antes de enviar al cliente
                  (backend valida con preconditions_not_met). El fee se calcula como
                  un % del salario anual y es el precio que cobra Kuno al cliente. */}
              <div className="draft-grid-2">
                <Field label="Fee del puesto ($USD) — obligatorio para enviar al cliente">
                  <input
                    type="number"
                    className="draft-input"
                    value={edited.fee_usd}
                    onChange={(e) => patch('fee_usd', Number(e.target.value))}
                    placeholder="Ej: 3000"
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
            type="button"
            className="btn-toolbar"
            onClick={handlePreview}
            disabled={previewing || !edited}
            style={{ marginRight: 'auto' }}
            title="Guardar edits + abrir el portal del cliente en nueva pestaña"
          >
            {previewing ? 'Generando preview…' : '👁️ Vista previa como cliente'}
          </button>
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
      // disc_ideal_text: primero buscar la narrativa de la IA en disc_perfil_descripcion
      // (es donde el handler dispatchBriefingAutoDraft la guarda); fallback al join
      // del array description si lo trae en disc_ideal (formato viejo).
      disc_ideal_text: typeof payload.disc_perfil_descripcion === 'string' && payload.disc_perfil_descripcion.length > 0
        ? payload.disc_perfil_descripcion
        : (Array.isArray(discIdeal.description) ? discIdeal.description.join(' · ') : ''),
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
      // Antes hardcoded — ahora lee del payload. Si la IA no devolvió o devolvió algo
      // que no matchea el enum, fallback a 'Presencial'.
      modalidad: (typeof payload.modalidad === 'string' && ['Presencial', 'Híbrido', 'Remoto'].includes(payload.modalidad)
        ? payload.modalidad : 'Presencial') as 'Presencial' | 'Híbrido' | 'Remoto',
      ubicacion: typeof payload.ubicacion === 'string' ? payload.ubicacion : '',
      tecnica_minimo_pct: typeof payload.tecnica_minimo_pct === 'number' ? payload.tecnica_minimo_pct : 60,
      fee_usd: typeof payload.fee_usd === 'number' ? payload.fee_usd : 0,
    },
    ia_concerns: [],
    history: [],
    highlights: highlightsArr,
    created_at: d.created_at,
    ia_summary_meeting: typeof payload.context_summary === 'string' ? payload.context_summary : '',
    client_comments: clientComments,
  } as unknown as typeof MOCK_DRAFTS[number] & { client_comments: Array<{ at: string; text: string }> };
}

/**
 * Bloque "Análisis del puesto" — muestra el output nuevo del prompt IA (2026-06-06):
 *   - Jefe identificado (descripción + DISC estimado + patrón compensación/alineamiento)
 *   - Cualidades pedidas (extraídas del transcript)
 *   - Tensiones detectadas (contradicciones entre cualidades — eje vs eje)
 *   - Perfil A y Perfil B side-by-side con PK + DISC + gana/sacrifica
 *
 * Si el payload no tiene estos campos (drafts viejos pre-prompt nuevo), el bloque no
 * se renderea — silencioso, sin romper.
 */
function AnalisisDelPuesto({ payload }: { payload: Record<string, unknown> }) {
  const jefe = payload.jefe as undefined | {
    descripcion?: string;
    disc_estimado?: { d?: number; i?: number; s?: number; c?: number };
    patron_relacion?: string;
  };
  const cualidades = Array.isArray(payload.cualidades_pedidas) ? payload.cualidades_pedidas as string[] : [];
  const tensiones = Array.isArray(payload.tensiones_detectadas) ? payload.tensiones_detectadas as Array<{ ejes?: string; descripcion?: string }> : [];
  const perfilA = payload.disc_ideal_a as undefined | DiscProfileExtended;
  const perfilB = payload.disc_ideal_b as undefined | DiscProfileExtended;

  // Si no tenemos NADA del análisis nuevo, no renderear (compat con drafts viejos)
  if (!jefe && cualidades.length === 0 && tensiones.length === 0 && !perfilA && !perfilB) {
    return null;
  }

  return (
    <section style={{
      background: 'rgba(218,253,111,0.04)',
      border: '1px solid var(--accent)',
      borderRadius: '10px',
      padding: '1rem 1.25rem',
      marginBottom: '1.25rem',
    }}>
      <h3 style={{ margin: '0 0 0.75rem', color: 'var(--accent)', fontSize: '1rem' }}>🎯 Análisis conductual del puesto</h3>

      {/* Jefe */}
      {jefe && (
        <div style={{ marginBottom: '1rem' }}>
          <h4 style={{ fontSize: '0.85rem', margin: '0 0 0.4rem', color: 'var(--st-fg-muted)' }}>JEFE DEL PUESTO</h4>
          <p style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>{jefe.descripcion}</p>
          {jefe.disc_estimado && (
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--st-fg-muted)' }}>DISC estimado:</span>
              <span><strong>D</strong>{jefe.disc_estimado.d ?? '—'}</span>
              <span><strong>I</strong>{jefe.disc_estimado.i ?? '—'}</span>
              <span><strong>S</strong>{jefe.disc_estimado.s ?? '—'}</span>
              <span><strong>C</strong>{jefe.disc_estimado.c ?? '—'}</span>
              {jefe.patron_relacion && (
                <span style={{
                  marginLeft: 'auto',
                  padding: '0.2rem 0.6rem',
                  background: jefe.patron_relacion === 'compensacion' ? 'rgba(255, 180, 50, 0.18)' : jefe.patron_relacion === 'alineamiento' ? 'rgba(80, 200, 120, 0.18)' : 'rgba(160, 160, 160, 0.18)',
                  border: '1px solid currentColor',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>{jefe.patron_relacion}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Cualidades pedidas */}
      {cualidades.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <h4 style={{ fontSize: '0.85rem', margin: '0 0 0.4rem', color: 'var(--st-fg-muted)' }}>CUALIDADES QUE PIDIÓ EL CLIENTE ({cualidades.length})</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {cualidades.map((c, i) => (
              <span key={i} style={{ padding: '0.2rem 0.6rem', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--st-border)', borderRadius: '999px', fontSize: '0.78rem' }}>{c}</span>
            ))}
          </div>
        </div>
      )}

      {/* Tensiones */}
      {tensiones.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <h4 style={{ fontSize: '0.85rem', margin: '0 0 0.4rem', color: 'var(--st-fg-muted)' }}>⚠️ TENSIONES DETECTADAS (contradicciones)</h4>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.85rem' }}>
            {tensiones.map((t, i) => (
              <li key={i} style={{ marginBottom: '0.3rem' }}>
                <strong>{t.ejes}:</strong> {t.descripcion}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Perfiles A y B side-by-side */}
      {(perfilA || perfilB) && (
        <div>
          <h4 style={{ fontSize: '0.85rem', margin: '0 0 0.5rem', color: 'var(--st-fg-muted)' }}>PERFILES IDEALES — buscamos AMBOS (no escoges uno)</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '0.75rem' }}>
            {perfilA && <DiscProfileCard label="PERFIL A" profile={perfilA} accent="#dafd6f" />}
            {perfilB && <DiscProfileCard label="PERFIL B" profile={perfilB} accent="#9bd0ff" />}
          </div>
        </div>
      )}
    </section>
  );
}

type DiscProfileExtended = {
  patron?: string;
  pk_profile_code?: string;
  pk_profile_name?: string;
  d?: number; i?: number; s?: number; c?: number;
  description?: string[] | string;
  gana_en?: string[];
  sacrifica?: string[];
};

function DiscProfileCard({ label, profile, accent }: { label: string; profile: DiscProfileExtended; accent: string }) {
  const max = 100;
  const bar = (v?: number) => {
    const val = Math.max(0, Math.min(100, v ?? 0));
    return (
      <div style={{ background: 'var(--st-bg)', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ width: `${(val / max) * 100}%`, height: '100%', background: accent }} />
      </div>
    );
  };
  const description = Array.isArray(profile.description) ? profile.description : (typeof profile.description === 'string' ? [profile.description] : []);
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${accent}`,
      borderRadius: '8px',
      padding: '0.75rem 1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
        <strong style={{ color: accent, fontSize: '0.85rem', letterSpacing: '0.5px' }}>{label}</strong>
        <span style={{ fontSize: '0.75rem', color: 'var(--st-fg-muted)' }}>{profile.pk_profile_code}</span>
      </div>
      <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem', fontWeight: 600 }}>{profile.pk_profile_name}</div>
      {profile.patron && <p style={{ margin: '0 0 0.6rem', fontSize: '0.78rem', fontStyle: 'italic', color: 'var(--st-fg-muted)' }}>{profile.patron}</p>}

      {/* Barras DISC */}
      <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr 28px', gap: '0.4rem', alignItems: 'center', fontSize: '0.78rem', marginBottom: '0.6rem' }}>
        <span><strong>D</strong></span>{bar(profile.d)}<span style={{ textAlign: 'right' }}>{profile.d ?? '—'}</span>
        <span><strong>I</strong></span>{bar(profile.i)}<span style={{ textAlign: 'right' }}>{profile.i ?? '—'}</span>
        <span><strong>S</strong></span>{bar(profile.s)}<span style={{ textAlign: 'right' }}>{profile.s ?? '—'}</span>
        <span><strong>C</strong></span>{bar(profile.c)}<span style={{ textAlign: 'right' }}>{profile.c ?? '—'}</span>
      </div>

      {/* Description */}
      {description.length > 0 && (
        <ul style={{ margin: '0 0 0.6rem', paddingLeft: '1rem', fontSize: '0.78rem' }}>
          {description.slice(0, 3).map((d, i) => <li key={i} style={{ marginBottom: '0.2rem' }}>{d}</li>)}
        </ul>
      )}

      {/* Gana / Sacrifica */}
      {profile.gana_en && profile.gana_en.length > 0 && (
        <div style={{ marginBottom: '0.4rem' }}>
          <strong style={{ fontSize: '0.75rem', color: '#86efac' }}>✓ GANA EN</strong>
          <ul style={{ margin: '0.2rem 0 0', paddingLeft: '1rem', fontSize: '0.75rem' }}>
            {profile.gana_en.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </div>
      )}
      {profile.sacrifica && profile.sacrifica.length > 0 && (
        <div>
          <strong style={{ fontSize: '0.75rem', color: '#fca5a5' }}>✗ SACRIFICA</strong>
          <ul style={{ margin: '0.2rem 0 0', paddingLeft: '1rem', fontSize: '0.75rem' }}>
            {profile.sacrifica.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
