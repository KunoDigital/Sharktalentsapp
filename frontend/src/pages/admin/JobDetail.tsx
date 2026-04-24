import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getJob, getJobAssessments, getComparison, generateTechnical, downloadReport, createAssessments, setPipelineStage, updateJob, exportCandidatesCsv } from '../../services/api';
import TechnicalQuestionsModal from '../../components/TechnicalQuestionsModal';
import { PK_PROFILES, identifyPK } from '../../data/pkProfiles';
import type { CSSProperties } from 'react';

interface Assessment {
  id: number;
  type: string;
  public_token: string;
  status: string;
  questions_count: number;
  link: string;
}

interface CompetenciaScore {
  id: string;
  nombre: string;
  score: number;
}

interface CandidateComparison {
  candidate: { id: number; name: string; email: string };
  kudert_result_id?: number;
  results: {
    disc?: { score: Record<string, number>; perfil_dominante: string; match_percentage: number } | null;
    cognitive?: { score: Record<string, number>; match_percentage: number } | null;
    technical?: { score: number | null; passed: boolean } | null;
    integrity?: { overall: string; recomendacion: string; overall_pct: number; dimensiones: Record<string, { nivel: string; pct: number }> } | null;
    emotional?: { score: number; perfil: string } | null;
    competencias?: CompetenciaScore[] | null;
  };
}

interface IdealCompetencia {
  id: string;
  nivel_esperado: number;
}

interface ComparisonData {
  ideal_profile: {
    disc: Record<string, number>;
    cognitive: Record<string, number>;
    min_technical_score: number;
  };
  ideal_competencias: IdealCompetencia[];
  candidates: CandidateComparison[];
}

const typeLabels: Record<string, string> = {
  technical: 'Técnica',
  kudert: 'Evaluación Conductual',
  integrity: 'Integridad',
};

const typeDescriptions: Record<string, string> = {
  technical: 'Prueba Técnica',
  kudert: 'DISC + Cognitiva + Emoción',
  integrity: 'Integridad',
};

const discProfileNames: Record<string, string> = {
  D: 'Dominante',
  I: 'Influyente',
  S: 'Sólido',
  C: 'Cumplidor',
};

const integrityDimLabels: Record<string, string> = {
  honestidad: 'Honestidad',
  hurto: 'Hurto',
  soborno: 'Soborno',
  alcohol: 'Alcohol',
  drogas: 'Drogas',
  confiabilidad: 'Confiabilidad',
  etica_profesional: 'Ética profesional',
  personalidad: 'Personalidad',
  apuestas: 'Apuestas',
};

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Record<string, unknown> | null>(null);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [integrityModal, setIntegrityModal] = useState<{ name: string; data: { overall: string; recomendacion: string; overall_pct: number; dimensiones: Record<string, { nivel: string; pct: number }> } } | null>(null);
  const [creatingAssessments, setCreatingAssessments] = useState(false);

  const loadAssessments = () => {
    if (!id) return;
    getJobAssessments(id).then(setAssessments).catch(() => {});
  };

  useEffect(() => {
    if (!id) return;
    getJob(id).then(setJob);
    loadAssessments();
    getComparison(id).then(setComparison).catch(() => {});
  }, [id]);

  const handleTechnicalGenerated = (updatedAssessments: Assessment[]) => {
    setAssessments(updatedAssessments);
  };

  if (!job) return <p style={{ color: 'var(--kuno-text-muted)', padding: 24 }}>Cargando...</p>;

  return (
    <div>
      <Link to="/admin" style={backLink}>← Volver a puestos</Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--kuno-cream)' }}>
          {job.title as string}
        </h1>
        <span style={(job.is_active as number) ? badgeActive : badgeInactive}>
          {(job.is_active as number) ? 'Activo' : 'Inactivo'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 36 }}>
        <p style={{ color: 'var(--kuno-text-muted)', fontSize: 15 }}>{job.company as string}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to={`/admin/jobs/${id}/pipeline`}>
            <button style={btnOutlineLime}>Ver pipeline</button>
          </Link>
          <Link to={`/admin/jobs/${id}/integrity`}>
            <button style={btnOutlineLime}>Ver integridad</button>
          </Link>
          <Link to={`/admin/jobs/${id}/compare`}>
            <button style={btnOutlineLime}>Comparar candidatos</button>
          </Link>
          <button style={btnOutlineLime} onClick={async () => {
            try {
              const blob = await exportCandidatesCsv(id!);
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = `candidatos_${id}.csv`; a.click(); URL.revokeObjectURL(url);
            } catch { alert('Error exportando'); }
          }}>Exportar Excel</button>
        </div>
      </div>

      {/* Assessments */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={sectionTitle}>Pruebas</h2>
        {assessments.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <p style={{ color: 'var(--kuno-text-muted)', fontSize: 14 }}>No hay pruebas generadas.</p>
            <button
              onClick={async () => {
                setCreatingAssessments(true);
                try {
                  await createAssessments(id!);
                  loadAssessments();
                } catch { alert('Error al crear pruebas'); }
                setCreatingAssessments(false);
              }}
              disabled={creatingAssessments}
              style={creatingAssessments ? { ...btnOutlineLime, opacity: 0.6 } : btnOutlineLime}
            >
              {creatingAssessments ? 'Creando...' : 'Crear pruebas'}
            </button>
          </div>
        ) : (
          <div style={assessmentGrid}>
            {assessments.map(a => (
              <AssessmentCard
                key={a.id}
                assessment={a}
                jobId={id!}
                techPrompt={(job.tech_prompt as string) || ''}
                onTechnicalGenerated={handleTechnicalGenerated}
              />
            ))}
          </div>
        )}
      </section>

      {/* Company Context */}
      <CompanyContextSection job={job} jobId={id!} onUpdated={(j) => setJob(j)} />

      {/* DISC Profile B */}
      <DiscProfileBSection job={job} jobId={id!} onUpdated={(j) => setJob(j)} />

      {/* Comparison */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={sectionTitle}>Comparación de candidatos</h2>
        {!comparison || comparison.candidates.length === 0 ? (
          <div style={emptyCard}>
            <p style={{ color: 'var(--kuno-text-muted)', fontSize: 14 }}>
              Aún no hay candidatos que hayan completado pruebas.
            </p>
          </div>
        ) : (() => {
          const hasIdealComp = comparison.ideal_competencias && comparison.ideal_competencias.length > 0;
          return (
          <div style={tableWrapper}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Candidato</th>
                  <th style={thStyle}>DISC</th>
                  <th style={thStyle}>Cognitiva</th>
                  <th style={thStyle}>Emoción</th>
                  <th style={thStyle}>Técnica</th>
                  {hasIdealComp && <th style={thStyle}>Competencias</th>}
                  <th style={thStyle}>Integridad</th>
                  <th style={thStyle}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {comparison.candidates.map(c => (
                  <tr key={c.candidate.id}>
                    {/* Candidate */}
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{c.candidate.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--kuno-text-muted)' }}>{c.candidate.email}</div>
                    </td>
                    {/* DISC */}
                    <td style={tdStyle}>
                      {c.results.disc ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <span style={profileBadge(c.results.disc.perfil_dominante)}>
                            {discProfileNames[c.results.disc.perfil_dominante] || c.results.disc.perfil_dominante}
                          </span>
                          <MatchBar pct={c.results.disc.match_percentage} />
                        </div>
                      ) : <span style={badgePending}>—</span>}
                    </td>
                    {/* Cognitive */}
                    <td style={tdStyle}>
                      {c.results.cognitive ? (
                        <MatchBar pct={c.results.cognitive.match_percentage} />
                      ) : <span style={badgePending}>—</span>}
                    </td>
                    {/* Emotional */}
                    <td style={tdStyle}>
                      {c.results.emotional ? (
                        <span style={emotionBadge(c.results.emotional.perfil)}>
                          {c.results.emotional.perfil === 'espontaneo' ? 'E' : c.results.emotional.perfil === 'mesura' ? 'M' : 'R'}
                          {' '}{c.results.emotional.score}
                        </span>
                      ) : <span style={badgePending}>—</span>}
                    </td>
                    {/* Technical */}
                    <td style={tdStyle}>
                      {c.results.technical?.score != null ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--kuno-cream)' }}>
                            {c.results.technical.score}%
                          </span>
                          <span style={c.results.technical.passed ? badgePass : badgeFail}>
                            {c.results.technical.passed ? 'Aprobado' : 'No aprobado'}
                          </span>
                        </div>
                      ) : <span style={badgePending}>Pendiente</span>}
                    </td>
                    {/* Competencias */}
                    {hasIdealComp && (
                      <td style={tdStyle}>
                        {c.results.competencias ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {comparison.ideal_competencias.map(ic => {
                              const candidateComp = c.results.competencias!.find(cc => cc.id === ic.id);
                              const score = candidateComp?.score ?? 0;
                              const met = score >= ic.nivel_esperado;
                              return (
                                <div key={ic.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                                  <span style={met ? compBadgePass : compBadgeFail}>{score}</span>
                                  <span style={{ color: 'var(--kuno-text-muted)' }}>{candidateComp?.nombre || ic.id}</span>
                                </div>
                              );
                            })}
                          </div>
                        ) : <span style={badgePending}>—</span>}
                      </td>
                    )}
                    {/* Integrity */}
                    <td style={tdStyle}>
                      {c.results.integrity ? (
                        <button
                          onClick={() => setIntegrityModal({ name: c.candidate.name, data: c.results.integrity! })}
                          style={{ ...riskBadgeStyle(c.results.integrity.overall), cursor: 'pointer', border: 'none' }}
                        >
                          {c.results.integrity.overall.toUpperCase()}
                        </button>
                      ) : <span style={badgePending}>—</span>}
                    </td>
                    {/* Action */}
                    <td style={tdStyle}>
                      <ReportButton jobId={id!} candidateId={c.candidate.id} candidateName={c.candidate.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          ); })()}
      </section>

      {/* Pipeline Decision Panel */}
      {comparison && comparison.candidates.length > 0 && (
        <PipelineDecisionPanel candidates={comparison.candidates} onSaved={() => {
          if (id) getComparison(id).then(setComparison).catch(() => {});
        }} />
      )}

      {/* Integrity Modal */}
      {integrityModal && (
        <IntegrityModal
          name={integrityModal.name}
          data={integrityModal.data}
          onClose={() => setIntegrityModal(null)}
        />
      )}
    </div>
  );
}

/* ── MatchBar ── */
function MatchBar({ pct }: { pct: number }) {
  const color = pct >= 70 ? 'var(--kuno-lime)' : pct >= 50 ? '#f39c12' : 'var(--kuno-danger)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={barTrack}>
        <div style={{ ...barFill, width: `${pct}%`, background: color }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 36, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

/* ── Integrity Modal ── */
function IntegrityModal({ name, data, onClose }: {
  name: string;
  data: { overall: string; recomendacion: string; overall_pct: number; dimensiones: Record<string, { nivel: string; pct: number }> };
  onClose: () => void;
}) {
  const riskColor = (nivel: string) => nivel === 'bajo' ? 'var(--kuno-lime)' : nivel === 'medio' ? '#f39c12' : 'var(--kuno-danger)';

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--kuno-cream)' }}>
            Integridad — {name}
          </h3>
          <button onClick={onClose} style={btnClose}>✕</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '12px 16px', background: 'var(--kuno-dark-2)', borderRadius: 'var(--radius)', border: '1px solid var(--kuno-border)' }}>
          <span style={{ ...riskBadgeStyle(data.overall), fontSize: 13, padding: '5px 14px' }}>
            {data.overall.toUpperCase()}
          </span>
          <span style={{ color: 'var(--kuno-cream)', fontSize: 14 }}>{data.recomendacion}</span>
          <span style={{ color: 'var(--kuno-text-muted)', fontSize: 12, marginLeft: 'auto' }}>{data.overall_pct}% riesgo</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Object.entries(data.dimensiones).map(([dim, d]) => (
            <div key={dim}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--kuno-cream)' }}>
                  {integrityDimLabels[dim] || dim}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: riskColor(d.nivel) }}>
                  {d.nivel.toUpperCase()} {d.pct}%
                </span>
              </div>
              <div style={{ height: 6, background: 'var(--kuno-dark-2)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${d.pct}%`, background: riskColor(d.nivel), borderRadius: 3, transition: 'width 0.3s' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── AssessmentCard ── */
function AssessmentCard({
  assessment,
  jobId,
  techPrompt,
  onTechnicalGenerated,
}: {
  assessment: Assessment;
  jobId: string;
  techPrompt: string;
  onTechnicalGenerated: (assessments: Assessment[]) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);
  const appBase = window.location.pathname.includes('/app') ? '/app/index.html' : '';
  const fullLink = `${window.location.origin}${appBase}#${assessment.link}`;

  const isTechnical = assessment.type === 'technical';
  const hasNoQuestions = isTechnical && assessment.questions_count === 0;

  const handleCopy = () => {
    navigator.clipboard.writeText(fullLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGenerateTechnical = async () => {
    setGenerating(true);
    try {
      await generateTechnical(jobId);
      const { getJobAssessments } = await import('../../services/api');
      const updated = await getJobAssessments(jobId);
      onTechnicalGenerated(updated);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Error al generar';
      alert(msg);
    }
    setGenerating(false);
  };

  return (
    <div style={assessmentCardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={typeBadge}>{typeLabels[assessment.type] || assessment.type}</span>
        {hasNoQuestions && <span style={badgeWarning}>Sin preguntas</span>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--kuno-text-muted)', marginBottom: 4 }}>
        {typeDescriptions[assessment.type] || ''}
      </div>

      {hasNoQuestions ? (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 12, color: 'var(--kuno-text-muted)', marginBottom: 12 }}>
            Las preguntas técnicas se generan con IA.
          </p>
          <button
            onClick={handleGenerateTechnical}
            disabled={generating}
            style={generating ? btnGeneratingStyle : btnGenerateStyle}
          >
            {generating ? 'Generando preguntas...' : 'Generar con IA'}
          </button>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--kuno-text-muted)', marginTop: 12, wordBreak: 'break-all' }}>
            {fullLink}
          </p>
          {isTechnical && (
            <p style={{ fontSize: 11, color: 'var(--kuno-text-muted)', marginTop: 4 }}>
              {assessment.questions_count} preguntas generadas
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={handleCopy} style={copied ? btnCopied : btnCopy}>
              {copied ? '¡Copiado!' : 'Copiar link'}
            </button>
            {isTechnical && assessment.questions_count > 0 && (
              <button onClick={() => setShowQuestions(true)} style={btnEditQuestions}>Ver/Editar preguntas</button>
            )}
          </div>
        </>
      )}

      {showQuestions && (
        <TechnicalQuestionsModal
          jobId={jobId}
          currentPrompt={techPrompt}
          onClose={() => setShowQuestions(false)}
          onRegenerated={async () => {
            const { getJobAssessments } = await import('../../services/api');
            const updated = await getJobAssessments(jobId);
            onTechnicalGenerated(updated);
          }}
        />
      )}
    </div>
  );
}

/* ── ReportButton ── */
function ReportButton({ jobId, candidateId, candidateName }: { jobId: string; candidateId: number; candidateName: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDownload = async () => {
    setLoading(true);
    setError('');
    try {
      const blob = await downloadReport(jobId, candidateId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `informe-${candidateName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError('Error al generar');
    }
    setLoading(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button onClick={handleDownload} disabled={loading} style={loading ? btnReportLoading : btnReport}>
        {loading ? 'Generando...' : 'Ver informe'}
      </button>
      {error && <span style={{ fontSize: 11, color: 'var(--kuno-danger)' }}>{error}</span>}
    </div>
  );
}

/* ── DISC Profile B Section ── */
/* ── Company Context Section ── */
function CompanyContextSection({ job, jobId, onUpdated }: { job: Record<string, unknown>; jobId: string; onUpdated: (j: Record<string, unknown>) => void }) {
  const ip = job.ideal_profile ? (typeof job.ideal_profile === 'string' ? JSON.parse(job.ideal_profile as string) : job.ideal_profile) : {};
  const existing = ip.company_context || '';
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(existing);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const newProfile = { ...ip, company_context: text };
    const updated = await updateJob(jobId, { ideal_profile: newProfile });
    onUpdated(updated);
    setEditing(false);
    setSaving(false);
  };

  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={sectionTitle}>Contexto de la empresa</h2>
        {!editing && (
          <button onClick={() => { setText(existing); setEditing(true); }} style={btnOutlineLime}>
            {existing ? 'Editar contexto' : 'Agregar contexto'}
          </button>
        )}
      </div>
      {!editing && existing && (
        <div style={{ background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 20 }}>
          <p style={{ fontSize: 14, color: 'var(--kuno-cream)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{existing}</p>
        </div>
      )}
      {!editing && !existing && (
        <p style={{ color: 'var(--kuno-text-muted)', fontSize: 14 }}>Describe qué busca la empresa, su cultura, el equipo, por qué se abre el puesto, etc. Esto se usa para generar preguntas de entrevista más precisas.</p>
      )}
      {editing && (
        <div style={{ background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 24 }}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={6}
            placeholder="Ej: Empresa de tecnología con 20 empleados, buscan alguien que maneje Zoho CRM, el equipo es joven y dinámico, el puesto se abre porque están creciendo en ventas B2B..."
            style={{ width: '100%', padding: '12px 14px', background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', color: 'var(--kuno-cream)', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' as const, lineHeight: 1.6 }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={handleSave} disabled={saving} style={saving ? { ...btnOutlineLime, opacity: 0.5 } : btnOutlineLime}>
              {saving ? 'Guardando...' : 'Guardar contexto'}
            </button>
            <button onClick={() => setEditing(false)} style={{ background: 'transparent', border: '1px solid var(--kuno-border)', color: 'var(--kuno-text-muted)', fontSize: 13, padding: '8px 18px', borderRadius: 'var(--radius)', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}
    </section>
  );
}

function DiscProfileBSection({ job, jobId, onUpdated }: { job: Record<string, unknown>; jobId: string; onUpdated: (j: Record<string, unknown>) => void }) {
  const ip = job.ideal_profile ? (typeof job.ideal_profile === 'string' ? JSON.parse(job.ideal_profile as string) : job.ideal_profile) : {};
  const existing = ip.disc_b || null;
  const [editing, setEditing] = useState(false);
  const [disc, setDisc] = useState<Record<string, number>>(existing || { D: 50, I: 50, S: 50, C: 50 });
  const [saving, setSaving] = useState(false);
  const discLabels: Record<string, string> = { D: 'Dominancia', I: 'Influencia', S: 'Estabilidad', C: 'Cumplimiento' };
  const detected = identifyPK(disc);

  const handleSave = async () => {
    setSaving(true);
    const newProfile = { ...ip, disc_b: disc };
    const updated = await updateJob(jobId, { ideal_profile: newProfile });
    onUpdated(updated);
    setEditing(false);
    setSaving(false);
  };

  const handleRemove = async () => {
    setSaving(true);
    const newProfile = { ...ip };
    delete newProfile.disc_b;
    const updated = await updateJob(jobId, { ideal_profile: newProfile });
    onUpdated(updated);
    setEditing(false);
    setSaving(false);
  };

  const handleSelectPK = (pkId: string) => {
    const pk = PK_PROFILES.find(p => p.id === pkId);
    if (pk) setDisc({ D: pk.D, I: pk.I, S: pk.S, C: pk.C });
  };

  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={sectionTitle}>Perfil DISC alternativo (B)</h2>
        {!editing && (
          <button onClick={() => { setDisc(existing || { D: 50, I: 50, S: 50, C: 50 }); setEditing(true); }} style={btnOutlineLime}>
            {existing ? 'Editar perfil B' : 'Agregar perfil B'}
          </button>
        )}
      </div>
      {!editing && existing && (
        <div style={{ background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 20 }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
            {(['D', 'I', 'S', 'C'] as const).map(d => (
              <span key={d} style={{ fontSize: 14, color: 'var(--kuno-cream)' }}><strong>{d}:</strong> {existing[d]}</span>
            ))}
          </div>
          {(() => { const pk = identifyPK(existing); return pk ? <span style={{ fontSize: 13, color: 'var(--kuno-text-muted)' }}>{pk.id} — {pk.name}</span> : null; })()}
        </div>
      )}
      {!editing && !existing && (
        <p style={{ color: 'var(--kuno-text-muted)', fontSize: 14 }}>No hay perfil alternativo configurado.</p>
      )}
      {editing && (
        <div style={{ background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: 'var(--kuno-text-muted)', marginBottom: 6, display: 'block' }}>Cargar desde perfil PK:</label>
            <select onChange={e => { handleSelectPK(e.target.value); e.target.value = ''; }} value="" style={{ width: '100%', padding: '10px 14px', background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', color: 'var(--kuno-cream)', fontSize: 13 }}>
              <option value="">Seleccionar un perfil PK...</option>
              {PK_PROFILES.map(pk => <option key={pk.id} value={pk.id}>{pk.id} — {pk.name} (D:{pk.D} I:{pk.I} S:{pk.S} C:{pk.C})</option>)}
            </select>
          </div>
          {Object.entries(discLabels).map(([key, label]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--kuno-text-muted)', width: 110 }}>{label}</span>
              <input type="range" min={0} max={100} value={disc[key]} onChange={e => setDisc(prev => ({ ...prev, [key]: Number(e.target.value) }))} style={{ flex: 1 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--kuno-cream)', width: 36, textAlign: 'right' }}>{disc[key]}</span>
            </div>
          ))}
          {detected && (
            <div style={{ marginTop: 8, marginBottom: 16, padding: '8px 12px', background: 'var(--kuno-dark-2)', borderRadius: 'var(--radius)', border: '1px solid var(--kuno-border)' }}>
              <span style={{ background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, marginRight: 8 }}>{detected.id}</span>
              <span style={{ fontSize: 13, color: 'var(--kuno-cream)' }}>{detected.name}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={handleSave} disabled={saving} style={saving ? { ...btnOutlineLime, opacity: 0.5 } : btnOutlineLime}>{saving ? 'Guardando...' : 'Guardar perfil B'}</button>
            {existing && <button onClick={handleRemove} disabled={saving} style={{ background: 'transparent', border: '1px solid var(--kuno-danger)', color: 'var(--kuno-danger)', fontSize: 13, fontWeight: 600, padding: '8px 18px', borderRadius: 'var(--radius)', cursor: 'pointer' }}>Eliminar perfil B</button>}
            <button onClick={() => setEditing(false)} style={{ background: 'transparent', border: '1px solid var(--kuno-border)', color: 'var(--kuno-text-muted)', fontSize: 13, padding: '8px 18px', borderRadius: 'var(--radius)', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ── Pipeline Decision Panel ── */
function PipelineDecisionPanel({ candidates, onSaved }: { candidates: CandidateComparison[]; onSaved: () => void }) {
  const [decisions, setDecisions] = useState<Record<number, 'next_stage_kudert' | 'rejected_kudert' | null>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const setDecision = (candidateId: number, decision: 'next_stage_kudert' | 'rejected_kudert' | null) => {
    setSaved(false);
    setDecisions(prev => ({ ...prev, [candidateId]: decision }));
  };

  const hasChanges = Object.values(decisions).some(d => d !== null && d !== undefined);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const c of candidates) {
        const decision = decisions[c.candidate.id];
        if (decision && c.kudert_result_id) {
          await setPipelineStage(c.kudert_result_id, decision);
        }
      }
      setSaved(true);
      setDecisions({});
      onSaved();
    } catch {
      alert('Error al guardar decisiones');
    }
    setSaving(false);
  };

  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={sectionTitle}>Decisión de candidatos</h2>
      <div style={decisionCard}>
        <p style={{ fontSize: 13, color: 'var(--kuno-text-muted)', marginBottom: 16 }}>
          Selecciona qué candidatos pasan a la siguiente etapa o son rechazados. Esto afecta el pipeline de Evaluación Conductual.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {candidates.map(c => {
            const decision = decisions[c.candidate.id] || null;
            return (
              <div key={c.candidate.id} style={decisionRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--kuno-cream)' }}>{c.candidate.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--kuno-text-muted)' }}>{c.candidate.email}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setDecision(c.candidate.id, decision === 'next_stage_kudert' ? null : 'next_stage_kudert')}
                    style={decision === 'next_stage_kudert' ? decisionBtnNextActive : decisionBtnNext}
                  >
                    Siguiente etapa
                  </button>
                  <button
                    onClick={() => setDecision(c.candidate.id, decision === 'rejected_kudert' ? null : 'rejected_kudert')}
                    style={decision === 'rejected_kudert' ? decisionBtnRejectActive : decisionBtnReject}
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
          <button onClick={handleSave} disabled={saving || !hasChanges} style={!saving && hasChanges ? btnSaveDecision : btnSaveDecisionDisabled}>
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
          {saved && <span style={{ fontSize: 13, color: 'var(--kuno-lime)' }}>Cambios guardados</span>}
        </div>
      </div>
    </section>
  );
}

const decisionCard: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 24 };
const decisionRow: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 16px', background: 'var(--kuno-dark-2)', borderRadius: 'var(--radius)', border: '1px solid var(--kuno-border)' };
const decisionBtnBase: CSSProperties = { fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 'var(--radius)', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s' };
const decisionBtnNext: CSSProperties = { ...decisionBtnBase, background: 'transparent', border: '1px solid rgba(218,253,111,0.3)', color: 'var(--kuno-text-muted)' };
const decisionBtnNextActive: CSSProperties = { ...decisionBtnBase, background: 'var(--kuno-lime)', border: '1px solid var(--kuno-lime)', color: 'var(--kuno-dark)' };
const decisionBtnReject: CSSProperties = { ...decisionBtnBase, background: 'transparent', border: '1px solid rgba(231,76,60,0.3)', color: 'var(--kuno-text-muted)' };
const decisionBtnRejectActive: CSSProperties = { ...decisionBtnBase, background: 'var(--kuno-danger)', border: '1px solid var(--kuno-danger)', color: '#fff' };
const btnSaveDecision: CSSProperties = { background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontWeight: 700, fontSize: 14, padding: '10px 32px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer' };
const btnSaveDecisionDisabled: CSSProperties = { ...btnSaveDecision, opacity: 0.4, cursor: 'not-allowed' };

/* ── Styles ── */
const backLink: CSSProperties = { color: 'var(--kuno-text-muted)', fontSize: 14, display: 'inline-block', marginBottom: 20 };
const btnOutlineLime: CSSProperties = { background: 'transparent', border: '1px solid var(--kuno-lime)', color: 'var(--kuno-lime)', fontWeight: 600, fontSize: 13, padding: '8px 18px', borderRadius: 'var(--radius)', cursor: 'pointer' };
const sectionTitle: CSSProperties = { fontSize: 16, fontWeight: 600, color: 'var(--kuno-cream)', marginBottom: 16 };

const assessmentGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 };
const assessmentCardStyle: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 18, display: 'flex', flexDirection: 'column' };
const typeBadge: CSSProperties = { background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 20 };
const badgeWarning: CSSProperties = { background: '#f39c12', color: 'var(--kuno-dark)', fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 20 };

const btnGenerateStyle: CSSProperties = { background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontWeight: 600, fontSize: 13, padding: '8px 16px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer' };
const btnEditQuestions: CSSProperties = { background: 'transparent', border: '1px solid var(--kuno-border)', color: 'var(--kuno-text-muted)', fontSize: 11, fontWeight: 500, padding: '5px 12px', borderRadius: 'var(--radius)', cursor: 'pointer' };
const btnGeneratingStyle: CSSProperties = { ...btnGenerateStyle, opacity: 0.6, cursor: 'wait' };

const btnCopy: CSSProperties = { marginTop: 14, background: 'transparent', border: '1px solid var(--kuno-lime)', color: 'var(--kuno-lime)', fontSize: 13, fontWeight: 500, padding: '7px 14px', borderRadius: 'var(--radius)', cursor: 'pointer', alignSelf: 'flex-start' };
const btnCopied: CSSProperties = { ...btnCopy, background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontWeight: 600 };

const badgeActive: CSSProperties = { background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20 };
const badgeInactive: CSSProperties = { background: 'var(--kuno-slate)', color: 'var(--kuno-cream)', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20 };

const emptyCard: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 32, textAlign: 'center' };

const tableWrapper: CSSProperties = { overflowX: 'auto', borderRadius: 'var(--radius-lg)', border: '1px solid var(--kuno-border)' };
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const thStyle: CSSProperties = { padding: '12px 16px', fontSize: 12, fontWeight: 600, color: 'var(--kuno-cream)', background: 'var(--kuno-slate)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' };
const tdStyle: CSSProperties = { padding: '12px 16px', fontSize: 14, color: 'var(--kuno-cream)', background: 'var(--kuno-dark)', borderTop: '1px solid var(--kuno-border)', verticalAlign: 'middle' };

const profileBadge = (profile: string): CSSProperties => {
  const colors: Record<string, string> = { D: '#e74c3c', I: '#f39c12', S: '#2ecc71', C: '#3498db' };
  return {
    background: colors[profile] || 'var(--kuno-slate)',
    color: '#fff',
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: 20,
    alignSelf: 'flex-start',
    display: 'inline-block',
  };
};

const barTrack: CSSProperties = { flex: 1, height: 6, background: 'var(--kuno-dark-2)', borderRadius: 3, overflow: 'hidden', minWidth: 60 };
const barFill: CSSProperties = { height: '100%', borderRadius: 3, transition: 'width 0.3s' };

const badgePending: CSSProperties = { background: 'var(--kuno-slate)', color: 'var(--kuno-cream)', fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20 };
const badgePass: CSSProperties = { background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 12 };
const badgeFail: CSSProperties = { background: 'var(--kuno-danger)', color: '#fff', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 12 };

const btnDetail: CSSProperties = { background: 'transparent', border: '1px solid var(--kuno-border)', color: 'var(--kuno-cream)', fontSize: 12, fontWeight: 500, padding: '5px 12px', borderRadius: 'var(--radius)', cursor: 'pointer' };
const btnReport: CSSProperties = { background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' };
const btnReportLoading: CSSProperties = { ...btnReport, opacity: 0.6, cursor: 'wait' };

const overlayStyle: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalStyle: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 28, width: '100%', maxWidth: 520, maxHeight: '80vh', overflowY: 'auto' };
const btnClose: CSSProperties = { background: 'transparent', border: 'none', color: 'var(--kuno-text-muted)', fontSize: 18, cursor: 'pointer', padding: 4 };
const answerChip: CSSProperties = { background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)', color: 'var(--kuno-cream)', fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 6 };
const riskBadgeStyle = (nivel: string): CSSProperties => {
  const bg = nivel === 'bajo' ? 'var(--kuno-lime)' : nivel === 'medio' ? '#f39c12' : 'var(--kuno-danger)';
  const color = nivel === 'bajo' ? 'var(--kuno-dark)' : '#fff';
  return { background: bg, color, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, display: 'inline-block' };
};
const emotionBadge = (perfil: string): CSSProperties => {
  const colors: Record<string, string> = { espontaneo: '#f39c12', mesura: '#3498db', reflexivo: '#9b59b6' };
  return { background: colors[perfil] || 'var(--kuno-slate)', color: '#fff', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, display: 'inline-block' };
};
const compBadgePass: CSSProperties = { background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8, minWidth: 28, textAlign: 'center', display: 'inline-block' };
const compBadgeFail: CSSProperties = { ...compBadgePass, background: 'var(--kuno-danger)', color: '#fff' };
