import { useEffect, useState } from 'react';
import { getTechnicalQuestions, updateTechnicalQuestion, regenerateTechnical, getJobAssessments } from '../services/api';
import type { CSSProperties } from 'react';

interface Props {
  jobId: string;
  currentPrompt: string;
  onClose: () => void;
  onRegenerated: () => void;
}

interface Question {
  id: string;
  text: string;
  options: string[];
  correct: number;
  dimension: string;
}

export default function TechnicalQuestionsModal({ jobId, currentPrompt, onClose, onRegenerated }: Props) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ text: string; options: string[]; correct: number }>({ text: '', options: ['', '', '', ''], correct: 0 });
  const [saving, setSaving] = useState(false);

  // Regenerate state
  const [showRegen, setShowRegen] = useState(false);
  const [regenPrompt, setRegenPrompt] = useState(currentPrompt);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    getTechnicalQuestions(jobId).then(q => { setQuestions(q); setLoading(false); });
  }, [jobId]);

  const startEdit = (q: Question) => {
    setEditingId(q.id);
    setEditForm({ text: q.text, options: [...q.options], correct: q.correct });
  };

  const cancelEdit = () => { setEditingId(null); };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    await updateTechnicalQuestion(jobId, editingId, editForm);
    setQuestions(prev => prev.map(q => q.id === editingId ? { ...q, ...editForm } : q));
    setEditingId(null);
    setSaving(false);
  };

  const handleRegenerate = async () => {
    if (!confirm('¿Estás seguro? Se perderán las preguntas actuales y se generarán 15 nuevas.')) return;
    setRegenerating(true);
    try {
      await regenerateTechnical(jobId, regenPrompt);
      const updated = await getTechnicalQuestions(jobId);
      setQuestions(updated);
      setShowRegen(false);
      onRegenerated();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Error desconocido';
      alert('Error al regenerar: ' + msg);
    }
    setRegenerating(false);
  };

  const letters = ['A', 'B', 'C', 'D'];

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={modalHeader}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--kuno-cream)', margin: 0 }}>
            Preguntas técnicas ({questions.length})
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowRegen(!showRegen)} style={btnOutline}>
              {showRegen ? 'Cancelar' : 'Regenerar con nuevo prompt'}
            </button>
            <button onClick={onClose} style={btnCloseStyle}>✕</button>
          </div>
        </div>

        {/* Regenerate section */}
        {showRegen && (
          <div style={regenBox}>
            <label style={labelStyle}>Prompt técnico</label>
            <textarea value={regenPrompt} onChange={e => setRegenPrompt(e.target.value)} rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
            <button onClick={handleRegenerate} disabled={regenerating} style={regenerating ? { ...btnPrimary, opacity: 0.6 } : btnPrimary}>
              {regenerating ? 'Generando 15 preguntas...' : 'Regenerar preguntas'}
            </button>
          </div>
        )}

        {/* Questions list */}
        <div style={questionsBody}>
          {loading ? (
            <p style={{ color: 'var(--kuno-text-muted)', textAlign: 'center', padding: 40 }}>Cargando preguntas...</p>
          ) : questions.length === 0 ? (
            <p style={{ color: 'var(--kuno-text-muted)', textAlign: 'center', padding: 40 }}>No hay preguntas generadas.</p>
          ) : (
            questions.map((q, idx) => (
              <div key={q.id} style={questionCard}>
                {editingId === q.id ? (
                  /* Edit mode */
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={qNumber}>{idx + 1}.</span>
                      <span style={{ fontSize: 10, color: 'var(--kuno-text-muted)' }}>{q.id}</span>
                    </div>
                    <textarea value={editForm.text} onChange={e => setEditForm(p => ({ ...p, text: e.target.value }))} rows={3} style={{ ...inputStyle, marginBottom: 8, resize: 'vertical' }} />
                    {editForm.options.map((opt, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <button onClick={() => setEditForm(p => ({ ...p, correct: i }))} style={editForm.correct === i ? correctBtnActive : correctBtn}>
                          {letters[i]}
                        </button>
                        <input type="text" value={opt} onChange={e => { const opts = [...editForm.options]; opts[i] = e.target.value; setEditForm(p => ({ ...p, options: opts })); }} style={{ ...inputStyle, flex: 1 }} />
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button onClick={saveEdit} disabled={saving} style={btnPrimary}>{saving ? 'Guardando...' : 'Guardar'}</button>
                      <button onClick={cancelEdit} style={btnOutline}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <p style={{ fontSize: 13, color: 'var(--kuno-cream)', fontWeight: 500, lineHeight: 1.5, flex: 1 }}>
                        <span style={qNumber}>{idx + 1}.</span> {q.text}
                      </p>
                      <button onClick={() => startEdit(q)} style={btnEdit}>Editar</button>
                    </div>
                    <div style={{ marginLeft: 20 }}>
                      {q.options.map((opt, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                          <span style={i === q.correct ? optCorrect : optNormal}>{letters[i]}</span>
                          <span style={{ fontSize: 12, color: i === q.correct ? 'var(--kuno-lime)' : 'var(--kuno-text-muted)' }}>{opt}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const overlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modal: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 700, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const modalHeader: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--kuno-border)', flexShrink: 0 };
const questionsBody: CSSProperties = { flex: 1, overflowY: 'auto', padding: '16px 20px' };
const regenBox: CSSProperties = { padding: '16px 20px', borderBottom: '1px solid var(--kuno-border)', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--kuno-dark-2)' };

const questionCard: CSSProperties = { padding: '14px 16px', background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', marginBottom: 10 };
const qNumber: CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--kuno-lime)', marginRight: 4 };

const optNormal: CSSProperties = { width: 20, height: 20, borderRadius: '50%', background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: 'var(--kuno-text-muted)', flexShrink: 0 };
const optCorrect: CSSProperties = { ...optNormal, background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', border: '1px solid var(--kuno-lime)' };

const correctBtn: CSSProperties = { width: 28, height: 28, borderRadius: '50%', background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', color: 'var(--kuno-text-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0 };
const correctBtnActive: CSSProperties = { ...correctBtn, background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', border: '1px solid var(--kuno-lime)' };

const btnEdit: CSSProperties = { background: 'transparent', border: '1px solid var(--kuno-border)', color: 'var(--kuno-text-muted)', fontSize: 11, padding: '3px 10px', borderRadius: 'var(--radius)', cursor: 'pointer', flexShrink: 0 };
const btnOutline: CSSProperties = { background: 'transparent', border: '1px solid var(--kuno-border)', color: 'var(--kuno-text-muted)', fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 'var(--radius)', cursor: 'pointer' };
const btnCloseStyle: CSSProperties = { background: 'transparent', border: 'none', color: 'var(--kuno-text-muted)', fontSize: 18, cursor: 'pointer', padding: 4 };
const btnPrimary: CSSProperties = { background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontWeight: 600, fontSize: 12, padding: '8px 16px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer' };
const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 500, color: 'var(--kuno-text-muted)', marginBottom: 4 };
const inputStyle: CSSProperties = { width: '100%', padding: '8px 12px', background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', color: 'var(--kuno-cream)', fontSize: 13 };
