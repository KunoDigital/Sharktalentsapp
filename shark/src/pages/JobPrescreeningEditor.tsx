import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';
import './pages.css';

const log = logger('PRESC_EDITOR');

type Question = {
  id: string;
  text: string;
  type: 'yes_no' | 'multiple_choice' | 'range_match';
  options: string[];
  accepted_indices: number[];
  rejection_reason: string;
  criterion: string;
};

export default function JobPrescreeningEditor() {
  const { jobId } = useParams<{ jobId: string }>();
  const api = useApi();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    api.jobs.listPrescreeningQuestions(jobId).then((res) => {
      if (res.questions.length > 0) {
        setQuestions(res.questions);
      } else if (res.status === 'pending') {
        setError('Las preguntas todavía se están generando. Esperá 1-2 min y refrescá.');
      } else if (res.status === 'failed') {
        setError(`La generación falló: ${res.error ?? 'razón desconocida'}. Regenerá desde JobDetail.`);
      } else {
        setError('No hay preguntas todavía. Generalas desde JobDetail primero.');
      }
    }).catch((err) => {
      log.warn('load failed', { error: (err as Error).message });
      setError(`Error cargando preguntas: ${(err as Error).message}`);
    }).finally(() => setLoading(false));
  }, [jobId]);

  function updateQuestion(idx: number, patch: Partial<Question>) {
    setQuestions((curr) => curr.map((q, i) => i === idx ? { ...q, ...patch } : q));
    setDirty(true);
  }

  function updateOption(qIdx: number, optIdx: number, value: string) {
    const q = questions[qIdx];
    const newOptions = [...q.options];
    newOptions[optIdx] = value;
    updateQuestion(qIdx, { options: newOptions });
  }

  function toggleAccepted(qIdx: number, optIdx: number) {
    const q = questions[qIdx];
    const accepted = q.accepted_indices.includes(optIdx)
      ? q.accepted_indices.filter((i) => i !== optIdx)
      : [...q.accepted_indices, optIdx].sort();
    if (accepted.length === 0) {
      alert('Al menos una opción debe ser aceptada — sino todos quedan rechazados.');
      return;
    }
    updateQuestion(qIdx, { accepted_indices: accepted });
  }

  function removeQuestion(idx: number) {
    if (!window.confirm('¿Eliminar esta pregunta?')) return;
    setQuestions((curr) => curr.filter((_, i) => i !== idx));
    setDirty(true);
  }

  function addQuestion() {
    if (questions.length >= 8) {
      alert('Máximo 8 preguntas');
      return;
    }
    setQuestions((curr) => [
      ...curr,
      {
        id: `pq_${Date.now()}`,
        text: 'Pregunta nueva — edita este texto',
        type: 'yes_no',
        options: ['Sí', 'No'],
        accepted_indices: [0],
        rejection_reason: 'Razón del rechazo — edita este texto',
        criterion: 'Criterio que evalúa',
      },
    ]);
    setDirty(true);
  }

  async function handleSave() {
    if (!jobId) return;
    setSaving(true);
    try {
      await api.jobs.updatePrescreeningQuestions(jobId, questions);
      setDirty(false);
      alert('✓ Cambios guardados');
    } catch (err) {
      alert(`Error guardando: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="page"><p>Cargando…</p></div>;
  if (error) {
    return (
      <div className="page">
        <h1 className="page-title">Prescreening del puesto</h1>
        <p style={{ color: '#d97706' }}>⚠️ {error}</p>
        <button className="btn-toolbar" onClick={() => navigate(`/jobs/${jobId}`)}>← Volver al puesto</button>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Editar prescreening</h1>
          <p className="page-subtitle">
            {questions.length} preguntas · Las opciones marcadas con ✓ son las aceptadas (si el candidato elige otra, queda auto-rechazado).
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-toolbar" onClick={() => navigate(`/jobs/${jobId}`)}>← Volver</button>
          <button className="btn-toolbar" onClick={addQuestion} disabled={questions.length >= 8}>+ Agregar pregunta</button>
          <button className="btn-toolbar" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? 'Guardando…' : dirty ? '💾 Guardar cambios' : 'Sin cambios'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 }}>
        {questions.map((q, qIdx) => (
          <div key={q.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>Pregunta {qIdx + 1}</span>
              <button
                style={{ background: 'transparent', border: 0, color: '#dc2626', cursor: 'pointer', fontSize: 13 }}
                onClick={() => removeQuestion(qIdx)}
              >
                Eliminar
              </button>
            </div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Texto de la pregunta</label>
            <textarea
              value={q.text}
              onChange={(e) => updateQuestion(qIdx, { text: e.target.value })}
              style={{ width: '100%', padding: 8, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 14, minHeight: 50 }}
            />
            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Opciones (marcá las aceptadas)</label>
              {q.options.map((opt, optIdx) => (
                <div key={optIdx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <button
                    type="button"
                    onClick={() => toggleAccepted(qIdx, optIdx)}
                    style={{
                      width: 24, height: 24, borderRadius: 4, border: '1px solid #d1d5db',
                      background: q.accepted_indices.includes(optIdx) ? '#16a34a' : '#fff',
                      color: q.accepted_indices.includes(optIdx) ? '#fff' : '#1f2937',
                      cursor: 'pointer', fontSize: 14, fontWeight: 600,
                    }}
                    title={q.accepted_indices.includes(optIdx) ? 'Aceptada (click para des-marcar)' : 'Rechazada (click para aceptar)'}
                  >
                    {q.accepted_indices.includes(optIdx) ? '✓' : ''}
                  </button>
                  <input
                    value={opt}
                    onChange={(e) => updateOption(qIdx, optIdx, e.target.value)}
                    style={{ flex: 1, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 14 }}
                  />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                Mensaje si el candidato es rechazado por esta pregunta
              </label>
              <input
                value={q.rejection_reason}
                onChange={(e) => updateQuestion(qIdx, { rejection_reason: e.target.value })}
                style={{ width: '100%', padding: 8, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 14 }}
              />
            </div>
            <div style={{ marginTop: 8 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                Criterio interno (no se muestra al candidato)
              </label>
              <input
                value={q.criterion}
                onChange={(e) => updateQuestion(qIdx, { criterion: e.target.value })}
                style={{ width: '100%', padding: 8, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 14, color: '#6b7280' }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
