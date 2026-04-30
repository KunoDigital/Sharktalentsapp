import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  getDraftById,
  STATUS_LABELS,
  STATUS_COLOR,
  type TranscriptHighlight,
} from '../data/mockDrafts';
import './pages.css';
import './draft-review.css';

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
  const draft = id ? getDraftById(id) : undefined;

  // Edición del draft (mock — en backend persiste)
  const [edited, setEdited] = useState(draft?.draft ?? null);
  const [decision, setDecision] = useState<'approve' | 'request_more' | 'discard' | null>(null);

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

  function handleSubmit() {
    if (!decision) return;
    if (decision === 'approve') {
      alert('Mock: draft aprobado y enviado al cliente. Cliente recibe email con link al portal.');
    } else if (decision === 'request_more') {
      alert('Mock: pedido de más info enviado al cliente.');
    } else {
      alert('Mock: draft descartado y reagendar reunión.');
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
          <button className="btn-primary draft-action-submit" onClick={handleSubmit}>
            Confirmar acción
          </button>
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
