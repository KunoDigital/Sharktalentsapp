import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { createClientReport, getClientReportById, generateReportExplanations, updateReportCandidate, publishReport, analyzeTranscript, generateComparison } from '../../services/api';
import type { CSSProperties } from 'react';

interface Reference {
  name: string;
  company: string;
  role: string;
  comments: string;
}

interface ReportCandidate {
  rc_id: string;
  candidate: { id: string; name: string; email: string; phone?: string; salary_expectation?: number };
  scores: any;
  references: Reference[];
  explanations: Record<string, string>;
  sort_order: number;
}

interface ReportData {
  report_id: string;
  job: { title: string; company: string };
  company_slug: string;
  job_slug: string;
  status: string;
  candidates: ReportCandidate[];
}

export default function ReportPreparation() {
  const { id: jobId, reportId } = useParams<{ id: string; reportId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [expandedCandidate, setExpandedCandidate] = useState<string | null>(null);
  const [savingRef, setSavingRef] = useState<string | null>(null);
  const [generatingComparison, setGeneratingComparison] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, reportId]);

  const loadReport = async () => {
    setLoading(true);
    const candidateIds = searchParams.get('candidates')?.split(',').filter(Boolean) || [];

    // Case A: URL has reportId → load that specific report
    if (reportId) {
      const data = await getClientReportById(reportId);
      setReport(data);
      setPublished(data?.status === 'published');
      setLoading(false);
      return;
    }

    // Case B: URL has ?candidates= but no reportId → create a NEW report and navigate to its URL
    if (candidateIds.length > 0) {
      const created = await createClientReport(jobId!, candidateIds);
      navigate(`/admin/jobs/${jobId}/client-report/${created.report_id}`, { replace: true });
      return;
    }

    // Case C: no reportId, no candidates → nothing to show
    setLoading(false);
  };

  const handleGenerate = async () => {
    if (!report) return;
    setGenerating(true);
    try {
      await generateReportExplanations(report.report_id);
      await loadReport();
    } catch { alert('Error generando explicaciones'); }
    setGenerating(false);
  };

  const handlePublish = async () => {
    if (!report) return;
    setPublishing(true);
    try {
      await publishReport(report.report_id);
      setPublished(true);
    } catch { alert('Error publicando reporte'); }
    setPublishing(false);
  };

  const handleUpdateExplanation = async (rcId: string, field: string, value: string) => {
    if (!report) return;
    await updateReportCandidate(report.report_id, rcId, { [field]: value });
  };

  const handleSaveReferences = async (rcId: string, refs: Reference[]) => {
    if (!report) return;
    setSavingRef(rcId);
    await updateReportCandidate(report.report_id, rcId, { references: refs });
    setSavingRef(null);
  };

  if (loading) return <p style={{ color: '#888', padding: 24 }}>Cargando...</p>;
  if (!report) return <p style={{ color: '#888', padding: 24 }}>No hay reporte. Selecciona candidatos desde el comparativo.</p>;

  const appBase = window.location.pathname.includes('/app') ? '/app/index.html' : '';
  const publicUrl = `${window.location.origin}${appBase}#/report/${report.company_slug}/${report.job_slug}/${report.report_id}`;
  const hasExplanations = report.candidates.some(c => c.explanations.summary);

  return (
    <div>
      <Link to={`/admin/jobs/${jobId}`} style={backLink}>← Volver al puesto</Link>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--kuno-cream)', marginBottom: 8 }}>
        Reporte para cliente
      </h1>
      <p style={{ fontSize: 15, color: 'var(--kuno-text-muted)', marginBottom: 24 }}>
        {report.job.title} — {report.job.company}
      </p>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={handleGenerate} disabled={generating} style={generating ? { ...btnPrimary, opacity: 0.5 } : btnPrimary}>
          {generating ? 'Generando explicaciones...' : hasExplanations ? 'Regenerar explicaciones con IA' : 'Generar explicaciones con IA'}
        </button>
        {hasExplanations && (
          <>
            <button onClick={async () => { setGeneratingComparison(true); try { await generateComparison(report.report_id); await loadReport(); } catch { alert('Error generando comparativo'); } setGeneratingComparison(false); }} disabled={generatingComparison} style={generatingComparison ? { ...btnCompare, opacity: 0.5 } : btnCompare}>
              {generatingComparison ? 'Generando comparativo...' : 'Generar comparativo'}
            </button>
            <button onClick={handlePublish} disabled={publishing} style={publishing ? { ...btnPublish, opacity: 0.5 } : btnPublish}>
              {publishing ? 'Publicando y traduciendo...' : published ? 'Republicar (actualiza EN)' : 'Publicar reporte'}
            </button>
          </>
        )}
        {published && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--kuno-text-muted)', width: 24 }}>ES</span>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--kuno-lime)', wordBreak: 'break-all' }}>
                {publicUrl}
              </a>
              <button onClick={() => { navigator.clipboard.writeText(publicUrl); }} style={btnSmall}>Copiar</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--kuno-text-muted)', width: 24 }}>EN</span>
              <a href={publicUrl + '?lang=en'} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#85b7eb', wordBreak: 'break-all' }}>
                {publicUrl}?lang=en
              </a>
              <button onClick={() => { navigator.clipboard.writeText(publicUrl + '?lang=en'); }} style={btnSmall}>Copiar</button>
            </div>
          </div>
        )}
      </div>

      {/* Candidates */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {report.candidates.map((c, ci) => {
          const isExpanded = expandedCandidate === c.rc_id;
          return (
            <div key={c.rc_id} style={candidateCard}>
              <div onClick={() => setExpandedCandidate(isExpanded ? null : c.rc_id)} style={candidateHeader}>
                <div>
                  <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--kuno-cream)' }}>{c.candidate.name}</span>
                  <span style={{ fontSize: 13, color: 'var(--kuno-text-muted)', marginLeft: 12 }}>{c.candidate.email}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {c.explanations.summary ? (
                    <span style={badgeReady}>Listo</span>
                  ) : (
                    <span style={badgePending}>Sin explicaciones</span>
                  )}
                  <span style={{ fontSize: 18, color: 'var(--kuno-text-muted)' }}>{isExpanded ? '▾' : '▸'}</span>
                </div>
              </div>

              {isExpanded && (
                <div style={{ padding: '16px 20px', borderTop: '1px solid var(--kuno-border)' }}>
                  {/* Explanations */}
                  {['summary', 'disc', 'velna', 'emotion', 'technical', 'integrity', 'competencias'].map(field => (
                    <div key={field} style={{ marginBottom: 16 }}>
                      <label style={labelStyle}>{fieldLabels[field]}</label>
                      <textarea
                        value={c.explanations[field] || ''}
                        onChange={e => {
                          const newVal = e.target.value;
                          setReport(prev => {
                            if (!prev) return prev;
                            return { ...prev, candidates: prev.candidates.map(cc => cc.rc_id === c.rc_id ? { ...cc, explanations: { ...cc.explanations, [field]: newVal } } : cc) };
                          });
                        }}
                        onBlur={e => handleUpdateExplanation(c.rc_id, `explanation_${field}`, e.target.value)}
                        rows={3}
                        style={textareaStyle}
                        placeholder={`Explicación de ${fieldLabels[field].toLowerCase()}...`}
                      />
                    </div>
                  ))}

                  {/* References */}
                  <div style={{ marginTop: 20 }}>
                    <label style={{ ...labelStyle, fontSize: 14, marginBottom: 12 }}>Referencias verificadas</label>
                    <ReferencesEditor
                      references={c.references}
                      saving={savingRef === c.rc_id}
                      onSave={refs => handleSaveReferences(c.rc_id, refs)}
                    />
                  </div>

                  {/* Interview Transcript */}
                  <div style={{ marginTop: 20 }}>
                    <TranscriptSection
                      reportId={report.report_id}
                      rcId={c.rc_id}
                      existingAnalysis={c.explanations?.transcript_analysis}
                      onAnalyzed={() => loadReport()}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const fieldLabels: Record<string, string> = {
  summary: 'Resumen ejecutivo',
  disc: 'Perfil conductual (DISC)',
  velna: 'Habilidades cognitivas (VELNA)',
  emotion: 'Perfil emocional',
  technical: 'Evaluación técnica',
  integrity: 'Integridad',
  competencias: 'Competencias',
};

function ReferencesEditor({ references, saving, onSave }: { references: Reference[]; saving: boolean; onSave: (refs: Reference[]) => void }) {
  const [refs, setRefs] = useState<Reference[]>(references.length > 0 ? references : []);
  const [dirty, setDirty] = useState(false);

  const addRef = () => {
    setRefs(prev => [...prev, { name: '', company: '', role: '', comments: '' }]);
    setDirty(true);
  };

  const removeRef = (idx: number) => {
    setRefs(prev => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const updateRef = (idx: number, field: keyof Reference, value: string) => {
    setRefs(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
    setDirty(true);
  };

  return (
    <div>
      {refs.map((ref, i) => (
        <div key={i} style={refCard}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <input placeholder="Nombre" value={ref.name} onChange={e => updateRef(i, 'name', e.target.value)} style={inputStyle} />
            <input placeholder="Empresa" value={ref.company} onChange={e => updateRef(i, 'company', e.target.value)} style={inputStyle} />
            <input placeholder="Cargo" value={ref.role} onChange={e => updateRef(i, 'role', e.target.value)} style={inputStyle} />
            <button onClick={() => removeRef(i)} style={btnRemoveRef}>Eliminar</button>
          </div>
          <textarea placeholder="Comentarios de la referencia..." value={ref.comments} onChange={e => updateRef(i, 'comments', e.target.value)} rows={2} style={{ ...textareaStyle, marginTop: 8 }} />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {refs.length < 3 && <button onClick={addRef} style={btnSmall}>+ Agregar referencia</button>}
        {dirty && <button onClick={() => { onSave(refs); setDirty(false); }} disabled={saving} style={btnSaveRef}>{saving ? 'Guardando...' : 'Guardar referencias'}</button>}
      </div>
    </div>
  );
}

function TranscriptSection({ reportId, rcId, existingAnalysis, onAnalyzed }: { reportId: string; rcId: string; existingAnalysis?: any; onAnalyzed: () => void }) {
  const [transcript, setTranscript] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<any>(existingAnalysis || null);
  const [showPaste, setShowPaste] = useState(false);

  const handleAnalyze = async () => {
    if (!transcript.trim()) return;
    setAnalyzing(true);
    try {
      const result = await analyzeTranscript(reportId, rcId, transcript);
      setAnalysis(result.analysis);
      setShowPaste(false);
      onAnalyzed();
    } catch { alert('Error analizando transcripción'); }
    setAnalyzing(false);
  };

  return (
    <div>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--kuno-cream)', marginBottom: 8 }}>Post-entrevista</label>

      {analysis && (
        <div style={{ background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--kuno-lime)', marginBottom: 8 }}>Análisis de la entrevista</div>
          {analysis.resumen && <p style={{ fontSize: 13, color: 'var(--kuno-cream)', lineHeight: 1.6, marginBottom: 10 }}>{analysis.resumen}</p>}
          {analysis.puntos_fuertes && (
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#5dcaa5' }}>PUNTOS FUERTES: </span>
              <span style={{ fontSize: 12, color: 'var(--kuno-cream)' }}>{analysis.puntos_fuertes.replace(/\|/g, ' • ')}</span>
            </div>
          )}
          {analysis.puntos_debiles && (
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#f39c12' }}>PUNTOS DÉBILES: </span>
              <span style={{ fontSize: 12, color: 'var(--kuno-cream)' }}>{analysis.puntos_debiles.replace(/\|/g, ' • ')}</span>
            </div>
          )}
          {analysis.alertas_resueltas && (
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#85b7eb' }}>ALERTAS: </span>
              <span style={{ fontSize: 12, color: 'var(--kuno-cream)' }}>{analysis.alertas_resueltas}</span>
            </div>
          )}
          {analysis.recomendacion_final && (
            <div style={{ padding: '8px 12px', background: 'var(--kuno-dark)', borderRadius: 'var(--radius)', marginTop: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--kuno-lime)' }}>RECOMENDACIÓN: </span>
              <span style={{ fontSize: 13, color: 'var(--kuno-cream)', fontWeight: 500 }}>{analysis.recomendacion_final}</span>
            </div>
          )}
        </div>
      )}

      {!showPaste ? (
        <button onClick={() => setShowPaste(true)} style={{ background: 'transparent', border: '1px solid var(--kuno-border)', color: 'var(--kuno-text-muted)', fontSize: 12, padding: '6px 14px', borderRadius: 'var(--radius)', cursor: 'pointer' }}>
          {analysis ? 'Pegar nueva transcripción' : 'Pegar transcripción de entrevista'}
        </button>
      ) : (
        <div>
          <textarea
            value={transcript}
            onChange={e => setTranscript(e.target.value)}
            rows={8}
            placeholder="Pega aquí la transcripción de Zoho Meet o las notas de la entrevista..."
            style={{ width: '100%', padding: '10px 12px', background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', color: 'var(--kuno-cream)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' as const, marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleAnalyze} disabled={analyzing || !transcript.trim()} style={analyzing ? { ...btnAnalyze, opacity: 0.5 } : btnAnalyze}>
              {analyzing ? 'Analizando con IA...' : 'Analizar transcripción'}
            </button>
            <button onClick={() => setShowPaste(false)} style={{ background: 'transparent', border: '1px solid var(--kuno-border)', color: 'var(--kuno-text-muted)', fontSize: 12, padding: '6px 14px', borderRadius: 'var(--radius)', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

const btnAnalyze: CSSProperties = { background: '#9b59b6', color: '#fff', fontWeight: 600, fontSize: 12, padding: '8px 16px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer' };

const backLink: CSSProperties = { color: 'var(--kuno-text-muted)', fontSize: 14, display: 'inline-block', marginBottom: 20 };
const btnPrimary: CSSProperties = { background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontWeight: 700, fontSize: 14, padding: '10px 24px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer' };
const btnCompare: CSSProperties = { background: '#9b59b6', color: '#fff', fontWeight: 700, fontSize: 14, padding: '10px 24px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer' };
const btnPublish: CSSProperties = { background: '#3498db', color: '#fff', fontWeight: 700, fontSize: 14, padding: '10px 24px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer' };
const btnSmall: CSSProperties = { background: 'transparent', border: '1px solid var(--kuno-border)', color: 'var(--kuno-text-muted)', fontSize: 12, padding: '5px 12px', borderRadius: 'var(--radius)', cursor: 'pointer' };
const btnSaveRef: CSSProperties = { background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontWeight: 600, fontSize: 12, padding: '5px 14px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer' };
const btnRemoveRef: CSSProperties = { background: 'transparent', border: '1px solid rgba(231,76,60,0.3)', color: 'var(--kuno-danger)', fontSize: 12, padding: '6px 12px', borderRadius: 'var(--radius)', cursor: 'pointer' };
const candidateCard: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' };
const candidateHeader: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', cursor: 'pointer' };
const badgeReady: CSSProperties = { background: 'rgba(218,253,111,0.15)', color: 'var(--kuno-lime)', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12 };
const badgePending: CSSProperties = { background: 'var(--kuno-dark-2)', color: 'var(--kuno-text-muted)', fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 12, border: '1px solid var(--kuno-border)' };
const labelStyle: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--kuno-cream)', marginBottom: 6 };
const textareaStyle: CSSProperties = { width: '100%', padding: '10px 12px', background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', color: 'var(--kuno-cream)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' as const };
const inputStyle: CSSProperties = { padding: '8px 12px', background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', color: 'var(--kuno-cream)', fontSize: 13 };
const refCard: CSSProperties = { padding: 14, background: 'var(--kuno-dark-2)', borderRadius: 'var(--radius)', border: '1px solid var(--kuno-border)', marginBottom: 10 };
