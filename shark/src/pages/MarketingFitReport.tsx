import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useNavigate, useParams } from 'react-router-dom';
import { config } from '../config';

// Shape del reporte v2.0 — calzado 1:1 con mockup-reporte-completo-fit-psicometrico.html
type FitSello = 'recomendado' | 'recomendado_con_reservas' | 'no_recomendado' | 'pendiente_evaluacion';
type FitLevel = 'alto' | 'medio' | 'bajo' | 'pendiente';
type MatchEstado = 'engrana' | 'a_validar';

type Match = { expectativa: string; estado: MatchEstado; evidencias: string[] };
type Aprovechar = { titulo: string; texto: string };

type FitReport = {
  cliente_empresa: string;
  cliente_contacto: string;
  puesto: string;
  candidato_nombre: string;
  veredicto: { sello: FitSello; titulo: string; parrafo: string; fit_pct: number | null };
  matches: Match[];
  como_es: { fuertes: string[]; debiles: string[] };
  fit_cultural: { nivel: FitLevel; parrafo: string };
  como_aprovechar: Aprovechar[];
  conducta: {
    perfil_pk: string;
    perfil_nombre: string;
    dominante_titulo: string;
    dominante_parrafo: string;
    como_trabaja: { decisiones: string; equipo: string; presion: string; comunicacion: string };
  };
  pensamiento: { que_significa: string };
  integridad: { parrafo: string; nota_medios: string | null };
  disc_alineacion_score: number;
  faltantes: string[];
};

type LeadContext = {
  lead: {
    id: string;
    email: string;
    contact_name: string | null;
    company: string | null;
    puesto: string | null;
    fit_choice: string | null;
    finalist_status: string | null;
  };
  candidate: { name: string; email: string } | null;
  scores: Record<string, unknown> | null;
  saved_report: FitReport | null;
};

const SELLO_LABELS: Record<FitSello, string> = {
  recomendado: 'Recomendado',
  recomendado_con_reservas: 'Recomendado con reservas',
  no_recomendado: 'No recomendado',
  pendiente_evaluacion: 'Pendiente evaluación',
};

const SELLO_COLORS: Record<FitSello, { bg: string; fg: string }> = {
  recomendado: { bg: '#dcfce7', fg: '#166534' },
  recomendado_con_reservas: { bg: '#fef3c7', fg: '#78350f' },
  no_recomendado: { bg: '#fee2e2', fg: '#7f1d1d' },
  pendiente_evaluacion: { bg: '#f3f4f6', fg: '#4b5563' },
};

const NIVEL_LABELS: Record<FitLevel, string> = { alto: 'Alto', medio: 'Medio', bajo: 'Bajo', pendiente: 'Pendiente' };

// Skeleton para inicializar campos si la IA los omite — evita crashes al editar.
function emptyReport(): FitReport {
  return {
    cliente_empresa: '', cliente_contacto: '', puesto: '', candidato_nombre: '',
    veredicto: { sello: 'pendiente_evaluacion', titulo: '', parrafo: '', fit_pct: null },
    matches: [],
    como_es: { fuertes: [], debiles: [] },
    fit_cultural: { nivel: 'pendiente', parrafo: '' },
    como_aprovechar: [],
    conducta: {
      perfil_pk: '', perfil_nombre: '', dominante_titulo: '', dominante_parrafo: '',
      como_trabaja: { decisiones: '', equipo: '', presion: '', comunicacion: '' },
    },
    pensamiento: { que_significa: '' },
    integridad: { parrafo: '', nota_medios: null },
    disc_alineacion_score: 0,
    faltantes: [],
  };
}

// Rehidrata un reporte parcial (ej: uno viejo del shape v4) con la estructura
// completa. Evita undefined en campos anidados durante la edición.
function normalizeReport(r: Partial<FitReport>): FitReport {
  const skel = emptyReport();
  return {
    cliente_empresa: r.cliente_empresa ?? skel.cliente_empresa,
    cliente_contacto: r.cliente_contacto ?? skel.cliente_contacto,
    puesto: r.puesto ?? skel.puesto,
    candidato_nombre: r.candidato_nombre ?? skel.candidato_nombre,
    veredicto: { ...skel.veredicto, ...(r.veredicto ?? {}) },
    matches: r.matches ?? skel.matches,
    como_es: { ...skel.como_es, ...(r.como_es ?? {}) },
    fit_cultural: { ...skel.fit_cultural, ...(r.fit_cultural ?? {}) },
    como_aprovechar: r.como_aprovechar ?? skel.como_aprovechar,
    conducta: {
      ...skel.conducta,
      ...(r.conducta ?? {}),
      como_trabaja: { ...skel.conducta.como_trabaja, ...(r.conducta?.como_trabaja ?? {}) },
    },
    pensamiento: { ...skel.pensamiento, ...(r.pensamiento ?? {}) },
    integridad: { ...skel.integridad, ...(r.integridad ?? {}) },
    disc_alineacion_score: r.disc_alineacion_score ?? skel.disc_alineacion_score,
    faltantes: r.faltantes ?? skel.faltantes,
  };
}

export default function MarketingFitReport() {
  const { leadId } = useParams<{ leadId: string }>();
  const { getToken } = useAuth();
  const navigate = useNavigate();

  const [ctxData, setCtxData] = useState<LeadContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [transcript, setTranscript] = useState('');
  const [notes, setNotes] = useState('');
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState<FitReport | null>(null);

  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadContext = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/marketing/fit-report/${leadId}/context`, {
        headers: { 'X-Clerk-Token': token ?? '' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LeadContext;
      setCtxData(data);
      if (data.saved_report) setReport(normalizeReport(data.saved_report));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [leadId, getToken]);

  useEffect(() => { void loadContext(); }, [loadContext]);

  useEffect(() => {
    if (!leadId || !report) return;
    setAutoSaveStatus('saving');
    const timeoutId = window.setTimeout(async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${config.apiBase}/api/marketing/fit-report/${leadId}/save-draft`, {
          method: 'POST',
          headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
          body: JSON.stringify({ report }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setAutoSaveStatus('saved');
      } catch {
        setAutoSaveStatus('error');
      }
    }, 2000);
    return () => window.clearTimeout(timeoutId);
  }, [leadId, report, getToken]);

  async function handleGenerate() {
    if (!leadId) return;
    if (transcript.trim().length < 50) {
      alert('El transcript necesita al menos 50 caracteres para que la IA lo procese bien.');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/marketing/fit-report/${leadId}/generate`, {
        method: 'POST',
        headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: transcript.trim(), notes: notes.trim() }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { report: FitReport };
      setReport(normalizeReport(data.report));
    } catch (err) {
      setError(`Error generando reporte: ${(err as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handlePreview() {
    if (!leadId || !report) return;
    setPreviewLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/marketing/fit-report/${leadId}/preview`, {
        method: 'POST',
        headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ report }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { url: string };
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      alert(`Error abriendo preview: ${(err as Error).message}`);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleSend() {
    if (!leadId || !report) return;
    if (!confirm(`¿Enviar el reporte de fit al cliente (${ctxData?.lead.email}) y hacer handoff a un vendedor por round-robin?`)) return;
    setSending(true);
    setSendResult(null);
    try {
      const token = await getToken();
      const res = await fetch(`${config.apiBase}/api/marketing/fit-report/${leadId}/send`, {
        method: 'POST',
        headers: { 'X-Clerk-Token': token ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ report }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { ok: boolean; email_ok: boolean; assigned_to: string | null };
      setSendResult({
        ok: true,
        message: `Reporte enviado. Email ${data.email_ok ? '✓' : '⚠'}. Vendedor asignado: ${data.assigned_to ?? 'ninguno disponible — quedó sin asignar'}.`,
      });
    } catch (err) {
      setSendResult({ ok: false, message: (err as Error).message });
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Cargando contexto del lead…</div>;
  }
  if (error && !ctxData) {
    return (
      <div style={{ padding: '24px 32px', background: '#f7f8fa', minHeight: '100vh', color: '#111827' }}>
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#7f1d1d', padding: 12, borderRadius: 6 }}>Error: {error}</div>
        <button onClick={() => navigate('/marketing/prospectos')} style={{ marginTop: 16, background: '#111827', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, cursor: 'pointer' }}>← Volver a Prospectos</button>
      </div>
    );
  }
  if (!ctxData) return null;

  const patch = (fn: (r: FitReport) => FitReport) => setReport((prev) => (prev ? fn(prev) : prev));

  return (
    <div style={{ padding: '24px 32px', background: '#f7f8fa', minHeight: '100vh', color: '#111827' }}>
      <button onClick={() => navigate('/marketing/prospectos')} style={{ background: 'transparent', border: 'none', color: '#4b5563', fontSize: 13, cursor: 'pointer', marginBottom: 12 }}>← Volver a Prospectos</button>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>
        {ctxData.saved_report ? 'Fit report — guardado' : 'Armar fit report'}
      </h1>
      <p style={{ margin: '4px 0 20px', color: '#6b7280', fontSize: 13 }}>
        {ctxData.saved_report
          ? 'Este reporte ya se generó. Podés revisar / editar y re-enviarlo cuando estés lista.'
          : 'Reporte manual del camino A. Pegá la transcripción de la reunión con el cliente + notas rápidas, la IA arma el reporte, vos editás, y al enviar se despacha al cliente + round-robin al vendedor.'}
      </p>
      {ctxData.saved_report && (
        <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#166534', padding: 10, borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
          ✓ Reporte guardado previamente. Los cambios se autoguardan mientras editás.
        </div>
      )}

      {report && autoSaveStatus !== 'idle' && (
        <div style={{ fontSize: 11, color: autoSaveStatus === 'saved' ? '#059669' : autoSaveStatus === 'error' ? '#dc2626' : '#6b7280', marginBottom: 10, textAlign: 'right' }}>
          {autoSaveStatus === 'saving' && '💾 Guardando…'}
          {autoSaveStatus === 'saved' && '✓ Guardado automático'}
          {autoSaveStatus === 'error' && '⚠ Error al guardar — chequeá tu conexión'}
        </div>
      )}

      {!ctxData.scores && !ctxData.saved_report && (
        <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', color: '#78350f', padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 13, lineHeight: 1.5 }}>
          <strong>⚠ El candidato aún no completó las pruebas.</strong> Podés armar el contexto ahora — la IA va a marcar el veredicto como "Pendiente evaluación" y no emitirá juicio sobre el candidato. Cuando termine las pruebas, regenerá el reporte.
        </div>
      )}

      {/* Contexto */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 14 }}>
          <div style={labelStyle}>Cliente</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{ctxData.lead.company ?? '(sin empresa)'}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{ctxData.lead.contact_name ?? '(sin contacto)'} · {ctxData.lead.email}</div>
          {ctxData.lead.puesto && <div style={{ fontSize: 12, marginTop: 6, color: '#374151' }}>💼 {ctxData.lead.puesto}</div>}
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 14 }}>
          <div style={labelStyle}>Candidato</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{ctxData.candidate?.name ?? '(sin candidato)'}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{ctxData.candidate?.email ?? '—'}</div>
          <div style={{ fontSize: 12, marginTop: 6, color: '#374151' }}>
            {ctxData.scores ? '✓ Pruebas listas' : '⏳ Pruebas pendientes'}
          </div>
        </div>
      </div>

      {/* Inputs */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 14 }}>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <div style={fieldLabelStyle}>Transcripción de la reunión con el cliente *</div>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={8}
            placeholder="Pegá la transcripción de la reunión de fit — Zia, Otter, o cualquier herramienta que uses..."
            style={textareaStyle}
          />
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{transcript.length} caracteres (mínimo 50, máximo 30.000)</div>
        </label>
        <label style={{ display: 'block' }}>
          <div style={fieldLabelStyle}>Notas rápidas (opcional)</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Contexto adicional — red flags que percibiste, tono del cliente, etc."
            style={textareaStyle}
          />
        </label>
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => void handleGenerate()}
            disabled={generating || transcript.trim().length < 50}
            style={{ background: '#4f46e5', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: generating ? 'wait' : 'pointer' }}
          >
            {generating ? 'Generando con IA…' : '🤖 Generar reporte con IA'}
          </button>
        </div>
      </div>

      {error && ctxData && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#7f1d1d', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{error}</div>
      )}

      {/* Reporte editable */}
      {report && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Reporte generado — revisá y editá</h2>
            {typeof report.veredicto.fit_pct === 'number' && (
              <span style={{ background: '#0e1218', color: '#dafd6f', fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20 }}>
                Fit {report.veredicto.fit_pct}%
              </span>
            )}
            <span style={{ fontSize: 11, color: '#6b7280' }}>DISC alineación IA: {report.disc_alineacion_score}</span>
          </div>

          {/* Veredicto */}
          <Section title="Veredicto">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#4b5563' }}>Sello:</span>
              <select
                value={report.veredicto.sello}
                onChange={(e) => patch((r) => ({ ...r, veredicto: { ...r.veredicto, sello: e.target.value as FitSello } }))}
                style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, background: SELLO_COLORS[report.veredicto.sello].bg, color: SELLO_COLORS[report.veredicto.sello].fg, fontWeight: 600 }}
              >
                {(['pendiente_evaluacion', 'recomendado', 'recomendado_con_reservas', 'no_recomendado'] as FitSello[]).map((v) => <option key={v} value={v}>{SELLO_LABELS[v]}</option>)}
              </select>
            </div>
            <input
              value={report.veredicto.titulo}
              onChange={(e) => patch((r) => ({ ...r, veredicto: { ...r.veredicto, titulo: e.target.value } }))}
              placeholder="Título en positivo (máx 8 palabras)"
              style={{ ...inputStyle, marginBottom: 8 }}
            />
            <textarea
              value={report.veredicto.parrafo}
              onChange={(e) => patch((r) => ({ ...r, veredicto: { ...r.veredicto, parrafo: e.target.value } }))}
              rows={3}
              placeholder="Párrafo del veredicto (máx 60 palabras)"
              style={textareaStyle}
            />
          </Section>

          {/* Matches */}
          <Section title="Matches — expectativa vs evidencia">
            <MatchList items={report.matches} onChange={(items) => patch((r) => ({ ...r, matches: items }))} />
          </Section>

          {/* Cómo es */}
          <Section title="Cómo es — puntos fuertes">
            <BulletList items={report.como_es.fuertes} onChange={(items) => patch((r) => ({ ...r, como_es: { ...r.como_es, fuertes: items } }))} />
          </Section>
          <Section title="Cómo es — puntos débiles">
            <BulletList items={report.como_es.debiles} onChange={(items) => patch((r) => ({ ...r, como_es: { ...r.como_es, debiles: items } }))} />
          </Section>

          {/* Fit cultural */}
          <Section title="Fit cultural">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: '#4b5563' }}>Nivel:</span>
              <select
                value={report.fit_cultural.nivel}
                onChange={(e) => patch((r) => ({ ...r, fit_cultural: { ...r.fit_cultural, nivel: e.target.value as FitLevel } }))}
                style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
              >
                {(['pendiente', 'alto', 'medio', 'bajo'] as FitLevel[]).map((l) => <option key={l} value={l}>{NIVEL_LABELS[l]}</option>)}
              </select>
            </div>
            <textarea
              value={report.fit_cultural.parrafo}
              onChange={(e) => patch((r) => ({ ...r, fit_cultural: { ...r.fit_cultural, parrafo: e.target.value } }))}
              rows={3}
              placeholder="Párrafo del fit cultural (máx 70 palabras)"
              style={textareaStyle}
            />
          </Section>

          {/* Cómo aprovechar */}
          <Section title="Cómo aprovechar este perfil (management POST-hire, NO guía de entrevista)">
            <AprovecharList items={report.como_aprovechar} onChange={(items) => patch((r) => ({ ...r, como_aprovechar: items }))} />
          </Section>

          {/* Conducta */}
          <Section title="Conducta — dominante">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <input value={report.conducta.perfil_pk} disabled placeholder="Perfil PK" style={{ ...inputStyle, background: '#f9fafb', color: '#6b7280' }} />
              <input value={report.conducta.perfil_nombre} disabled placeholder="Perfil nombre" style={{ ...inputStyle, background: '#f9fafb', color: '#6b7280' }} />
            </div>
            <input
              value={report.conducta.dominante_titulo}
              onChange={(e) => patch((r) => ({ ...r, conducta: { ...r.conducta, dominante_titulo: e.target.value } }))}
              placeholder='3 descriptores separados por " · " (ej: "Decidida · Directa · Empuje")'
              style={{ ...inputStyle, marginBottom: 8 }}
            />
            <textarea
              value={report.conducta.dominante_parrafo}
              onChange={(e) => patch((r) => ({ ...r, conducta: { ...r.conducta, dominante_parrafo: e.target.value } }))}
              rows={3}
              placeholder="Párrafo del perfil dominante (máx 60 palabras)"
              style={textareaStyle}
            />
          </Section>

          <Section title="Conducta — cómo trabaja (4 áreas)">
            {(['decisiones', 'equipo', 'presion', 'comunicacion'] as const).map((k) => (
              <div key={k} style={{ marginBottom: 10 }}>
                <div style={fieldLabelStyle}>{k === 'presion' ? 'Bajo presión' : k === 'equipo' ? 'Trabajo en equipo' : k.charAt(0).toUpperCase() + k.slice(1)}</div>
                <textarea
                  value={report.conducta.como_trabaja[k]}
                  onChange={(e) => patch((r) => ({ ...r, conducta: { ...r.conducta, como_trabaja: { ...r.conducta.como_trabaja, [k]: e.target.value } } }))}
                  rows={2}
                  style={textareaStyle}
                />
              </div>
            ))}
          </Section>

          {/* Pensamiento */}
          <Section title='Pensamiento — "Qué significa para ti"'>
            <textarea
              value={report.pensamiento.que_significa}
              onChange={(e) => patch((r) => ({ ...r, pensamiento: { que_significa: e.target.value } }))}
              rows={3}
              placeholder="Máx 45 palabras — qué puede hacer el empleador con esta capacidad + qué área baja es irrelevante para el puesto"
              style={textareaStyle}
            />
          </Section>

          {/* Integridad */}
          <Section title="Integridad">
            <textarea
              value={report.integridad.parrafo}
              onChange={(e) => patch((r) => ({ ...r, integridad: { ...r.integridad, parrafo: e.target.value } }))}
              rows={3}
              placeholder="Párrafo (máx 45 palabras) incluyendo la lectura del detector de buena impresión"
              style={{ ...textareaStyle, marginBottom: 8 }}
            />
            <div style={fieldLabelStyle}>Nota sobre ejes medios (opcional)</div>
            <textarea
              value={report.integridad.nota_medios ?? ''}
              onChange={(e) => patch((r) => ({ ...r, integridad: { ...r.integridad, nota_medios: e.target.value.trim() ? e.target.value : null } }))}
              rows={2}
              placeholder="Si hay ejes en riesgo medio: aclarar que son zonas para observar, no alertas"
              style={textareaStyle}
            />
          </Section>

          {sendResult && (
            <div style={{ background: sendResult.ok ? '#dcfce7' : '#fef2f2', border: `1px solid ${sendResult.ok ? '#86efac' : '#fca5a5'}`, color: sendResult.ok ? '#166534' : '#7f1d1d', padding: 12, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
              {sendResult.ok ? '✓ ' : '⚠ '}{sendResult.message}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20, paddingTop: 16, borderTop: '1px solid #e5e7eb', flexWrap: 'wrap' }}>
            <button
              onClick={() => void handleGenerate()}
              disabled={generating || sending}
              style={{ background: 'transparent', color: '#4b5563', border: '1px solid #d1d5db', padding: '10px 18px', borderRadius: 6, fontSize: 13, cursor: generating ? 'wait' : 'pointer' }}
            >
              🔄 Regenerar con IA
            </button>
            <button
              onClick={() => void handlePreview()}
              disabled={previewLoading || sending}
              style={{ background: '#fff', color: '#4f46e5', border: '1px solid #c7d2fe', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: previewLoading ? 'wait' : 'pointer' }}
            >
              {previewLoading ? 'Cargando…' : '👁 Ver reporte como lo verá el cliente'}
            </button>
            <button
              onClick={() => void handleSend()}
              disabled={sending || sendResult?.ok}
              style={{ background: '#059669', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: sending ? 'wait' : 'pointer' }}
            >
              {sending ? 'Enviando…' : sendResult?.ok ? '✓ Enviado' : '📤 Enviar reporte al cliente'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const textareaStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 6,
  fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 6,
  fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, marginBottom: 6,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12, color: '#4b5563', fontWeight: 600, marginBottom: 6,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function BulletList({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <span style={{ color: '#9ca3af', fontSize: 13, marginTop: 8 }}>•</span>
          <textarea
            value={item}
            onChange={(e) => {
              const next = [...items]; next[i] = e.target.value; onChange(next);
            }}
            rows={2}
            style={textareaStyle}
          />
          <button onClick={() => onChange(items.filter((_, idx) => idx !== i))} title="Eliminar" style={removeBtnStyle}>✕</button>
        </div>
      ))}
      <button onClick={() => onChange([...items, ''])} style={addBtnStyle}>+ Agregar bullet</button>
    </div>
  );
}

function MatchList({ items, onChange }: { items: Match[]; onChange: (items: Match[]) => void }) {
  const patchOne = (i: number, next: Partial<Match>) => onChange(items.map((m, idx) => idx === i ? { ...m, ...next } : m));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((m, i) => (
        <div key={i} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <select
              value={m.estado}
              onChange={(e) => patchOne(i, { estado: e.target.value as MatchEstado })}
              style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, fontWeight: 600, background: m.estado === 'engrana' ? '#dcfce7' : '#fef3c7', color: m.estado === 'engrana' ? '#166534' : '#78350f' }}
            >
              <option value="engrana">Engrana</option>
              <option value="a_validar">A validar</option>
            </select>
            <button onClick={() => onChange(items.filter((_, idx) => idx !== i))} style={{ ...removeBtnStyle, marginLeft: 'auto' }}>✕</button>
          </div>
          <input
            value={m.expectativa}
            onChange={(e) => patchOne(i, { expectativa: e.target.value })}
            placeholder="Expectativa (palabras del empleador, máx 16 palabras)"
            style={{ ...inputStyle, marginBottom: 8 }}
          />
          <div style={fieldLabelStyle}>Evidencias (2 puntos)</div>
          <BulletList items={m.evidencias} onChange={(next) => patchOne(i, { evidencias: next })} />
        </div>
      ))}
      <button onClick={() => onChange([...items, { expectativa: '', estado: 'engrana', evidencias: [''] }])} style={addBtnStyle}>+ Agregar match</button>
    </div>
  );
}

function AprovecharList({ items, onChange }: { items: Aprovechar[]; onChange: (items: Aprovechar[]) => void }) {
  const patchOne = (i: number, next: Partial<Aprovechar>) => onChange(items.map((a, idx) => idx === i ? { ...a, ...next } : a));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((a, i) => (
        <div key={i} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input
              value={a.titulo}
              onChange={(e) => patchOne(i, { titulo: e.target.value })}
              placeholder="Título — la fortaleza que aprovechas"
              style={{ ...inputStyle }}
            />
            <button onClick={() => onChange(items.filter((_, idx) => idx !== i))} style={removeBtnStyle}>✕</button>
          </div>
          <textarea
            value={a.texto}
            onChange={(e) => patchOne(i, { texto: e.target.value })}
            rows={2}
            placeholder="Instrucción práctica de gestión POST-hire (máx 35 palabras). NO validaciones ni preguntas de entrevista."
            style={textareaStyle}
          />
        </div>
      ))}
      <button onClick={() => onChange([...items, { titulo: '', texto: '' }])} style={addBtnStyle}>+ Agregar</button>
    </div>
  );
}

const removeBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 14, padding: 6,
};

const addBtnStyle: React.CSSProperties = {
  alignSelf: 'flex-start', background: 'transparent', border: '1px dashed #d1d5db',
  color: '#4b5563', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', marginTop: 4,
};
