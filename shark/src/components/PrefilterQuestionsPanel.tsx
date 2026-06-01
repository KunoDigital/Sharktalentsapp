import { useEffect, useState } from 'react';
import { useApi, ApiError, type ApiPrefilterQuestion } from '../lib/api';
import { config } from '../config';

type PrefilterType = 'yes_no' | 'multi_choice' | 'number' | 'text';

const TYPE_LABELS: Record<PrefilterType, string> = {
  yes_no: 'Sí / No',
  multi_choice: 'Selección múltiple',
  number: 'Número',
  text: 'Texto libre',
};

type Props = {
  jobId: string;
};

/**
 * Panel admin para gestionar el prefilter de un puesto.
 *
 * El prefilter es OPCIONAL. Si lo dejás vacío, los candidatos van directo al test.
 * Si agregás preguntas con `is_disqualifier=true` y un `expected_answer`, el sistema
 * descalifica automáticamente al que no matchee.
 */
export default function PrefilterQuestionsPanel({ jobId }: Props) {
  const api = useApi();
  const [questions, setQuestions] = useState<ApiPrefilterQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableReady, setTableReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // Form state for new question
  const [showForm, setShowForm] = useState(false);
  const [newQText, setNewQText] = useState('');
  const [newQType, setNewQType] = useState<PrefilterType>('yes_no');
  const [newQExpected, setNewQExpected] = useState('');
  const [newQDisqualifier, setNewQDisqualifier] = useState(false);
  const [newQOptions, setNewQOptions] = useState<string>(''); // comma-separated
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!config.useApi || !jobId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    api.prefilter.list(jobId)
      .then((r) => {
        if (cancelled) return;
        setQuestions(r.questions);
        setTableReady(r.table_ready);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        if (e instanceof ApiError && (e.status === 404 || e.status === 503)) {
          setTableReady(false);
        } else {
          setError(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, jobId, reload]);

  async function handleAdd() {
    if (!newQText.trim()) {
      setError('La pregunta no puede estar vacía');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.prefilter.create(jobId, {
        question_text: newQText.trim(),
        type: newQType,
        expected_answer: newQExpected.trim() || undefined,
        is_disqualifier: newQDisqualifier,
        options: newQType === 'multi_choice' && newQOptions.trim()
          ? newQOptions.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined,
        order_index: questions.length,
      });
      setNewQText('');
      setNewQExpected('');
      setNewQDisqualifier(false);
      setNewQOptions('');
      setShowForm(false);
      setReload((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(questionId: string) {
    if (!confirm('¿Borrar esta pregunta?')) return;
    try {
      await api.prefilter.remove(jobId, questionId);
      setReload((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (loading) return <p className="muted small">Cargando prefilter...</p>;

  if (!tableReady) {
    return (
      <p className="muted-note">
        ⏳ Tabla <code>PrefilterQuestions</code> aún no creada en Catalyst. El feature no está disponible
        todavía. Podés guardar el puesto sin prefilter — los candidatos van directo al test.
      </p>
    );
  }

  return (
    <div>
      <p className="muted small" style={{ marginBottom: '0.75rem' }}>
        Preguntas opcionales que el candidato responde antes del test. Si marcás una como
        descalificadora con valor esperado, los candidatos que no matcheen se rechazan automático.
      </p>

      {error && (
        <p className="muted small" style={{ color: 'var(--st-warn-fg)' }}>
          ⚠️ {error}
        </p>
      )}

      {questions.length === 0 ? (
        <p className="muted small">Sin preguntas todavía.</p>
      ) : (
        <ol className="prefilter-list" style={{ listStyle: 'decimal', paddingLeft: '1.5rem', marginBottom: '1rem' }}>
          {questions.map((q) => (
            <li key={q.ROWID} style={{ marginBottom: '0.6rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <strong>{q.question_text}</strong>{' '}
                  <span className="muted small">({TYPE_LABELS[q.type]})</span>
                  {q.is_disqualifier && (
                    <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', color: 'var(--st-warn-fg)' }}>
                      • DESCALIFICADORA
                    </span>
                  )}
                  {q.expected_answer && (
                    <div className="muted small" style={{ marginTop: '0.2rem' }}>
                      Esperado: <code>{q.expected_answer}</code>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(q.ROWID)}
                  className="btn-toolbar"
                  style={{ fontSize: '0.75rem' }}
                >
                  Borrar
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {!showForm ? (
        <button type="button" className="btn-toolbar" onClick={() => setShowForm(true)}>
          + Agregar pregunta
        </button>
      ) : (
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.75rem' }}>
          <div style={{ marginBottom: '0.6rem' }}>
            <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.85rem' }}>Pregunta</label>
            <input
              type="text"
              value={newQText}
              onChange={(e) => setNewQText(e.target.value)}
              placeholder="¿Tenés visa de trabajo en Panamá?"
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.6rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.85rem' }}>Tipo</label>
              <select value={newQType} onChange={(e) => setNewQType(e.target.value as PrefilterType)}>
                <option value="yes_no">Sí / No</option>
                <option value="multi_choice">Selección múltiple</option>
                <option value="number">Número</option>
                <option value="text">Texto libre</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.85rem' }}>Respuesta esperada (opcional)</label>
              <input
                type="text"
                value={newQExpected}
                onChange={(e) => setNewQExpected(e.target.value)}
                placeholder="ej: si, panama, 5"
                style={{ width: '100%' }}
              />
            </div>
          </div>
          {newQType === 'multi_choice' && (
            <div style={{ marginBottom: '0.6rem' }}>
              <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.85rem' }}>Opciones (separadas por coma)</label>
              <input
                type="text"
                value={newQOptions}
                onChange={(e) => setNewQOptions(e.target.value)}
                placeholder="opción 1, opción 2, opción 3"
                style={{ width: '100%' }}
              />
            </div>
          )}
          <div style={{ marginBottom: '0.6rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={newQDisqualifier}
                onChange={(e) => setNewQDisqualifier(e.target.checked)}
              />
              Descalificadora — si la respuesta no matchea el esperado, el candidato se rechaza
            </label>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn-primary" disabled={submitting} onClick={handleAdd}>
              {submitting ? 'Guardando...' : 'Agregar'}
            </button>
            <button type="button" className="cd-btn-ghost" onClick={() => { setShowForm(false); setError(null); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
