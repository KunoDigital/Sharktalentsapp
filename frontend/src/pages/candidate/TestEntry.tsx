import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getTest, startTest } from '../../services/api';
import type { CSSProperties } from 'react';

interface TestInfo {
  type: string;
  job_title: string;
  company: string;
  sections?: { name: string; questions: any[]; timer: number | null }[];
}

export default function TestEntry() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [step, setStep] = useState<'terms' | 'register' | 'index'>('terms');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', age: '', salary_expectation: '', availability: '' });
  const [testInfo, setTestInfo] = useState<TestInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [resumeState, setResumeState] = useState<any>(null);

  useEffect(() => {
    if (!token) return;
    getTest(token)
      .then(data => { setTestInfo(data); setLoading(false); })
      .catch(() => { setError('Prueba no encontrada o ya no está activa.'); setLoading(false); });
  }, [token]);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    try {
      const result = await startTest(token, {
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        age: form.age ? Number(form.age) : undefined,
        salary_expectation: form.salary_expectation ? Number(form.salary_expectation) : undefined,
        availability: form.availability || undefined,
      });

      // If already completed, show message
      if (result.already_completed) {
        setError('Ya completaste esta prueba anteriormente.');
        setSubmitting(false);
        return;
      }

      const navState: any = { email: form.email };
      // If resuming, pass saved answers
      if (result.saved_answers && result.answered_count > 0) {
        navState.savedAnswers = result.saved_answers;
        navState.resuming = true;
      }

      if (testInfo?.type === 'kudert') {
        setResumeState(navState);
        setStep('index');
      } else {
        navigate(`/test/${token}/questions`, { state: navState });
      }
    } catch {
      setError('Error al iniciar la prueba.');
    }
    setSubmitting(false);
  };

  if (loading) return <div style={pageStyle}><p style={{ color: 'var(--kuno-text-muted)', marginTop: 80 }}>Cargando...</p></div>;
  if (error) return (
    <div style={pageStyle}>
      <header style={headerStyle}><span style={logoStyle}>SharkTalents</span></header>
      <div style={cardStyle}><p style={{ color: 'var(--kuno-danger)', textAlign: 'center' }}>{error}</p></div>
    </div>
  );

  // ── STEP: Terms ──
  if (step === 'terms') {
    return (
      <div style={pageStyle}>
        <header style={headerStyle}><span style={logoStyle}>SharkTalents</span></header>
        <div style={cardStyle}>
          <h1 style={titleStyle}>Términos y Condiciones</h1>
          <div style={termsBox}>
            <p style={{ fontSize: 14, color: 'var(--kuno-cream)', lineHeight: 1.7 }}>
              Al participar en este proceso de evaluación, acepto que mis respuestas sean analizadas con fines de selección.
              La información es confidencial y será usada únicamente por SharkTalents by Kuno Digital.
            </p>
          </div>
          <label style={checkboxRow}>
            <input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} style={checkbox} />
            <span style={{ fontSize: 14, color: 'var(--kuno-cream)' }}>He leído y acepto los términos y condiciones</span>
          </label>
          <button onClick={() => setStep('register')} disabled={!termsAccepted} style={termsAccepted ? btnPrimary : btnDisabled}>
            Continuar
          </button>
        </div>
      </div>
    );
  }

  // ── STEP: Register ──
  if (step === 'register') {
    const typeLabels: Record<string, string> = { technical: 'Técnica', kudert: 'Evaluación Conductual', integrity: 'Integridad' };
    const isTechnical = testInfo?.type === 'technical';

    return (
      <div style={pageStyle}>
        <header style={headerStyle}><span style={logoStyle}>SharkTalents</span></header>
        <div style={cardStyle}>
          <h1 style={titleStyle}>Registro</h1>
          {testInfo && (
            <div style={infoBox}>
              <p style={{ fontSize: 14, color: 'var(--kuno-cream)' }}><strong>{testInfo.job_title}</strong> — {testInfo.company}</p>
              <p style={{ fontSize: 13, color: 'var(--kuno-text-muted)', marginTop: 4 }}>Prueba: {typeLabels[testInfo.type] || testInfo.type}</p>
            </div>
          )}
          <form onSubmit={handleRegister} style={formStyle}>
            <div style={formGrid}>
              <div>
                <label style={labelStyle}>Nombre completo *</label>
                <input type="text" value={form.name} onChange={set('name')} placeholder="Tu nombre" required style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Email *</label>
                <input type="email" value={form.email} onChange={set('email')} placeholder="tu@email.com" required style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Teléfono</label>
                <input type="tel" value={form.phone} onChange={set('phone')} placeholder="+52 123 456 7890" style={inputStyle} />
              </div>
              {isTechnical && (
                <>
                  <div>
                    <label style={labelStyle}>Edad *</label>
                    <input type="number" value={form.age} onChange={set('age')} placeholder="25" min="16" max="80" required style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Aspiración salarial (USD/mes) *</label>
                    <input type="number" value={form.salary_expectation} onChange={set('salary_expectation')} placeholder="2000" min="0" required style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Disponibilidad *</label>
                    <select value={form.availability} onChange={set('availability')} required style={inputStyle}>
                      <option value="">Selecciona...</option>
                      <option value="disponible">Estoy totalmente disponible</option>
                      <option value="15_dias">Estoy trabajando, necesito al menos 15 días</option>
                      <option value="negociar">Debo negociar con mi empresa actual</option>
                    </select>
                  </div>
                </>
              )}
            </div>
            <button type="submit" disabled={submitting} style={btnPrimary}>
              {submitting ? 'Registrando...' : 'Continuar'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── STEP: Index (Evaluación Conductual) ──
  const sectionMeta: Record<string, { time: string }> = {
    'DISC': { time: 'Sin límite' },
    'Verbal': { time: '5 min' },
    'Espacial': { time: '5 min' },
    'Lógico': { time: '6 min' },
    'Numérico': { time: '5 min' },
    'Abstracto': { time: '20 min' },
    'Emoción': { time: 'Sin límite' },
  };

  return (
    <div style={pageStyle}>
      <header style={headerStyle}><span style={logoStyle}>SharkTalents</span></header>
      <div style={{ ...cardStyle, maxWidth: 560 }}>
        <h1 style={titleStyle}>Tu evaluación conductual</h1>
        <p style={{ fontSize: 14, color: 'var(--kuno-text-muted)', marginBottom: 20 }}>
          La prueba consta de las siguientes secciones. Las secciones cognitivas tienen tiempo límite.
        </p>
        <table style={indexTable}>
          <thead>
            <tr>
              <th style={indexTh}>Sección</th>
              <th style={indexTh}>Preguntas</th>
              <th style={indexTh}>Tiempo</th>
            </tr>
          </thead>
          <tbody>
            {testInfo?.sections?.map((sec, i) => (
              <tr key={i}>
                <td style={indexTd}>
                  <span style={{ fontWeight: 500, color: 'var(--kuno-cream)' }}>{sec.name}</span>
                </td>
                <td style={indexTd}>{sec.questions.length}</td>
                <td style={indexTd}>{sectionMeta[sec.name]?.time || (sec.timer ? `${Math.round(sec.timer / 60)} min` : 'Sin límite')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => navigate(`/test/${token}/questions`, { state: resumeState || { email: form.email } })} style={{ ...btnPrimary, marginTop: 24 }}>
          {resumeState?.resuming ? 'Continuar evaluación' : 'Iniciar evaluación'}
        </button>
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = { minHeight: '100vh', background: 'var(--kuno-dark-2)', display: 'flex', flexDirection: 'column', alignItems: 'center' };
const headerStyle: CSSProperties = { padding: '24px 0', textAlign: 'center' };
const logoStyle: CSSProperties = { fontSize: 22, fontWeight: 700, color: 'var(--kuno-lime)' };
const cardStyle: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 36, width: '100%', maxWidth: 460, marginTop: 20 };
const titleStyle: CSSProperties = { fontSize: 22, fontWeight: 700, color: 'var(--kuno-cream)', marginBottom: 16 };
const infoBox: CSSProperties = { background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: 16 };
const formStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18 };
const formGrid: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 };
const labelStyle: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--kuno-text-muted)', marginBottom: 6 };
const inputStyle: CSSProperties = { width: '100%', padding: '10px 14px', background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', color: 'var(--kuno-cream)', fontSize: 14 };
const btnPrimary: CSSProperties = { width: '100%', background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontWeight: 600, fontSize: 14, padding: '12px 24px', borderRadius: 'var(--radius)', border: 'none' };
const btnDisabled: CSSProperties = { ...btnPrimary, opacity: 0.4, cursor: 'not-allowed' };
const termsBox: CSSProperties = { background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 20 };
const checkboxRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, cursor: 'pointer' };
const checkbox: CSSProperties = { width: 18, height: 18, accentColor: 'var(--kuno-lime)' };
const indexTable: CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const indexTh: CSSProperties = { padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--kuno-cream)', background: 'var(--kuno-slate)', textAlign: 'left', textTransform: 'uppercase' };
const indexTd: CSSProperties = { padding: '10px 12px', fontSize: 14, color: 'var(--kuno-text-muted)', borderTop: '1px solid var(--kuno-border)' };
