import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getJob, getComparison, setPipelineStage } from '../../services/api';
import { PK_PROFILES, identifyPK, normalizeDisc } from '../../data/pkProfiles';
import type { PKProfile } from '../../data/pkProfiles';
import type { CSSProperties } from 'react';

const DISC_COLORS: Record<string, string> = { D: '#e74c3c', I: '#f39c12', S: '#2ecc71', C: '#3498db' };
const DISC_NAMES: Record<string, string> = { D: 'Dominante', I: 'Influyente', S: 'Sólido', C: 'Cumplidor' };
const COG_DIMS = ['verbal', 'espacial', 'logica', 'numerica', 'abstracta'];
const COG_LABELS: Record<string, string> = { verbal: 'Verbal', espacial: 'Espacial', logica: 'Lógica', numerica: 'Numérica', abstracta: 'Abstracta' };
const INT_LABELS: Record<string, string> = { autenticidad: 'Autenticidad', inteligencia_social: 'Inteligencia social', imparcialidad: 'Imparcialidad', sencillez: 'Sencillez', dominio_personal: 'Dominio personal', honestidad: 'Honestidad', hurto: 'Hurto', soborno: 'Soborno', alcohol: 'Alcohol', drogas: 'Drogas', confiabilidad: 'Confiabilidad', apuestas: 'Apuestas', etica_profesional: 'Ética prof.', personalidad: 'Personalidad', buena_impresion: 'Buena impresión' };
const CANDIDATE_COLORS = ['#dafd6f', '#3498db', '#1abc9c', '#f39c12'];

export default function CompareView() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<any>(null);
  const [comparison, setComparison] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!id) return;
    Promise.all([getJob(id), getComparison(id)]).then(([j, c]) => {
      setJob(j);
      setComparison(c);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  if (loading) return <p style={{ color: 'var(--kuno-text-muted)', padding: 24 }}>Cargando...</p>;

  const candidates = comparison?.candidates || [];
  const ideal = comparison?.ideal_profile || {};
  const selected = candidates.filter((c: any) => selectedIds.includes(c.candidate.id));

  const toggleCandidate = (cid: string) => {
    if (selectedIds.includes(cid)) setSelectedIds(prev => prev.filter(x => x !== cid));
    else if (selectedIds.length < 4) setSelectedIds(prev => [...prev, cid]);
  };

  return (
    <div>
      <Link to={`/admin/jobs/${id}`} style={backLink}>← Volver al puesto</Link>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--kuno-cream)', marginBottom: 24 }}>
        Comparar candidatos — {job?.title}
      </h1>

      {/* Report button */}
      {selectedIds.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Link to={`/admin/jobs/${id}/client-report?candidates=${selectedIds.join(',')}`}>
            <button style={{ background: '#3498db', color: '#fff', fontWeight: 700, fontSize: 14, padding: '10px 24px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer' }}>
              Preparar reporte para cliente ({selectedIds.length} candidatos)
            </button>
          </Link>
        </div>
      )}

      {/* Selector */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--kuno-text-muted)', marginBottom: 10 }}>Selecciona hasta 4 candidatos ({selectedIds.length}/4):</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {candidates.map((c: any, i: number) => {
            const isSelected = selectedIds.includes(c.candidate.id);
            const colorIdx = selectedIds.indexOf(c.candidate.id);
            const stage = c.kudert_pipeline_stage;
            const stageColor = stage === 'next_stage_kudert' ? 'var(--kuno-lime)' : stage === 'review_cv_kudert' ? '#3498db' : null;
            const hasAll3 = !!(c.results?.disc && c.results?.technical && c.results?.integrity);
            return (
              <button key={c.candidate.id} onClick={() => toggleCandidate(c.candidate.id)}
                style={{
                  ...chipBtn,
                  borderColor: isSelected ? CANDIDATE_COLORS[colorIdx] : stageColor || 'var(--kuno-border)',
                  background: isSelected ? `${CANDIDATE_COLORS[colorIdx]}15` : stageColor ? `${stageColor}10` : 'var(--kuno-dark)',
                  boxShadow: hasAll3 && !isSelected ? '0 0 0 2px #9b59b6' : 'none',
                }}>
                {isSelected && <span style={{ width: 10, height: 10, borderRadius: '50%', background: CANDIDATE_COLORS[colorIdx], flexShrink: 0 }} />}
                {!isSelected && hasAll3 && <span style={{ fontSize: 10, color: '#9b59b6' }}>★</span>}
                {!isSelected && !hasAll3 && stage === 'next_stage_kudert' && <span style={{ fontSize: 10, color: 'var(--kuno-lime)' }}>✓</span>}
                {!isSelected && !hasAll3 && stage === 'review_cv_kudert' && <span style={{ fontSize: 10, color: '#3498db' }}>?</span>}
                <span style={{ color: isSelected ? 'var(--kuno-cream)' : stageColor || 'var(--kuno-text-muted)', fontWeight: isSelected || stageColor ? 600 : 400 }}>{c.candidate.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {selected.length === 0 ? (
        <div style={emptyCard}><p style={{ color: 'var(--kuno-text-muted)' }}>Selecciona candidatos para comparar.</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--kuno-slate)', border: '1px dashed var(--kuno-text-muted)' }} />
              <span style={{ fontSize: 12, color: 'var(--kuno-text-muted)' }}>Perfil ideal</span>
            </div>
            {selected.map((c: any, i: number) => (
              <div key={c.candidate.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 2, background: CANDIDATE_COLORS[i] }} />
                <span style={{ fontSize: 12, color: 'var(--kuno-cream)' }}>{c.candidate.name}</span>
              </div>
            ))}
          </div>

          {/* DISC Comparison — Ideals on top, Candidates below */}
          <SectionCard title="DISC">
            {(() => { const hasB = !!ideal.disc_b; return (<>
            {/* Ideal profiles row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
              {(() => {
                const idealPK = identifyPK(ideal.disc);
                return <IdealDiscCard label={hasB ? 'Perfil Ideal A' : 'Perfil Ideal'} disc={ideal.disc} pk={idealPK} />;
              })()}
              {hasB && (() => {
                const idealBPK = identifyPK(ideal.disc_b);
                return <IdealDiscCard label="Perfil Ideal B" disc={ideal.disc_b} pk={idealBPK} />;
              })()}
            </div>
            {/* Candidate cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {selected.map((c: any, ci: number) => {
                const disc = c.results?.disc?.score || c.results?.disc;
                const simA = disc ? calcDiscSimilarity(ideal.disc, disc) : null;
                const simB = disc && hasB ? calcDiscSimilarity(ideal.disc_b, disc) : null;
                const pk = disc ? identifyPK(normalizeDisc(disc)) : null;
                return (
                  <div key={c.candidate.id} style={{ background: 'var(--kuno-dark-2)', border: `1px solid ${CANDIDATE_COLORS[ci]}30`, borderRadius: 'var(--radius-lg)', padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: CANDIDATE_COLORS[ci] }}>{c.candidate.name}</span>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                        {simA != null && (
                          <span style={{ fontSize: hasB ? 16 : 22, fontWeight: 800, color: simA >= 70 ? 'var(--kuno-lime)' : simA >= 50 ? '#f39c12' : 'var(--kuno-danger)' }}>
                            {simA}%
                            <span style={{ fontSize: 10, fontWeight: 500, marginLeft: 4, color: 'var(--kuno-text-muted)' }}>{hasB ? 'vs A' : 'similitud'}</span>
                          </span>
                        )}
                        {simB != null && (
                          <span style={{ fontSize: 16, fontWeight: 800, color: simB >= 70 ? 'var(--kuno-lime)' : simB >= 50 ? '#f39c12' : 'var(--kuno-danger)' }}>
                            {simB}%
                            <span style={{ fontSize: 10, fontWeight: 500, marginLeft: 4, color: 'var(--kuno-text-muted)' }}>vs B</span>
                          </span>
                        )}
                      </div>
                    </div>
                    {disc ? (
                      <>
                        <DiscProfileChart disc={disc} raw />
                        {pk && (
                          <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--kuno-dark)', borderRadius: 'var(--radius)', border: '1px solid var(--kuno-border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                              <span style={{ background: CANDIDATE_COLORS[ci], color: 'var(--kuno-dark)', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>{pk.id}</span>
                              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--kuno-cream)' }}>{pk.name}</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {pk.traits.map((t, ti) => (
                                <div key={ti} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: CANDIDATE_COLORS[ci], flexShrink: 0 }} />
                                  <span style={{ fontSize: 12, color: 'var(--kuno-text-muted)' }}>{t}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <p style={{ color: 'var(--kuno-text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>Sin datos DISC</p>
                    )}
                  </div>
                );
              })}
            </div>
            </>); })()}
          </SectionCard>

          {/* Cognitive Comparison — Ideal on top, Candidates below */}
          <SectionCard title="Cognitiva VELNA">
            {/* Ideal row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
              <div style={{ background: 'var(--kuno-dark-2)', border: '1px dashed var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--kuno-text-muted)', marginBottom: 12 }}>Perfil Ideal</div>
                <VelnaChart values={ideal.cognitive || {}} />
              </div>
            </div>
            {/* Candidate cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {selected.map((c: any, ci: number) => {
                const cog = c.results?.cognitive?.score || c.results?.cognitive;
                const candidatePcts = normalizeCognitive(cog);
                const similarity = calcVelnaSimilarity(ideal.cognitive || {}, candidatePcts);
                return (
                  <div key={c.candidate.id} style={{ background: 'var(--kuno-dark-2)', border: `1px solid ${CANDIDATE_COLORS[ci]}30`, borderRadius: 'var(--radius-lg)', padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: CANDIDATE_COLORS[ci] }}>{c.candidate.name}</span>
                      {similarity != null && (
                        <span style={{ fontSize: 22, fontWeight: 800, color: similarity >= 70 ? 'var(--kuno-lime)' : similarity >= 50 ? '#f39c12' : 'var(--kuno-danger)' }}>
                          {similarity}%
                          <span style={{ fontSize: 11, fontWeight: 500, marginLeft: 4, color: 'var(--kuno-text-muted)' }}>similitud</span>
                        </span>
                      )}
                    </div>
                    {cog ? (
                      <VelnaChart values={candidatePcts} color={CANDIDATE_COLORS[ci]} />
                    ) : (
                      <p style={{ color: 'var(--kuno-text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>Sin datos cognitivos</p>
                    )}
                  </div>
                );
              })}
            </div>
          </SectionCard>

          {/* Competencias Comparison */}
          {(() => {
            const ic = comparison?.ideal_competencias || [];
            if (ic.length === 0) return null;
            const allComps = selected.flatMap((c: any) => c.results?.competencias || []);
            const compNames: Record<string, string> = {};
            for (const comp of allComps) if (comp.id && comp.nombre) compNames[comp.id] = comp.nombre;
            return (
              <SectionCard title="Competencias">
                {/* Ideal row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
                  <div style={{ background: 'var(--kuno-dark-2)', border: '1px dashed var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--kuno-text-muted)', marginBottom: 12 }}>Perfil Ideal</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {ic.map((comp: any) => (
                        <CompetenciaScale key={comp.id} label={compNames[comp.id] || comp.id} value={comp.nivel_esperado} />
                      ))}
                    </div>
                  </div>
                </div>
                {/* Candidate cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                  {selected.map((c: any, ci: number) => {
                    const comps = c.results?.competencias || [];
                    return (
                      <div key={c.candidate.id} style={{ background: 'var(--kuno-dark-2)', border: `1px solid ${CANDIDATE_COLORS[ci]}30`, borderRadius: 'var(--radius-lg)', padding: 16 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: CANDIDATE_COLORS[ci], marginBottom: 12 }}>{c.candidate.name}</div>
                        {comps.length > 0 ? (<>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            {ic.map((idealComp: any) => {
                              const candComp = comps.find((cc: any) => cc.id === idealComp.id);
                              const score = candComp?.score ?? 0;
                              return (
                                <CompetenciaScale key={idealComp.id} label={compNames[idealComp.id] || idealComp.id} value={score} color={CANDIDATE_COLORS[ci]} />
                              );
                            })}
                          </div>
                          {(() => {
                            const strengths = comps.filter((cc: any) => cc.score > 75 && !ic.find((i: any) => i.id === cc.id));
                            if (strengths.length === 0) return null;
                            return (
                              <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--kuno-dark)', borderRadius: 'var(--radius)', border: '1px solid var(--kuno-border)' }}>
                                <div style={{ fontSize: 11, color: 'var(--kuno-text-muted)', marginBottom: 6 }}>Destaca en:</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {strengths.map((s: any) => (
                                    <span key={s.id} style={{ fontSize: 11, fontWeight: 600, color: CANDIDATE_COLORS[ci], padding: '3px 10px', background: `${CANDIDATE_COLORS[ci]}15`, borderRadius: 12, border: `1px solid ${CANDIDATE_COLORS[ci]}30` }}>
                                      {s.nombre}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </>) : (
                          <p style={{ color: 'var(--kuno-text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>Sin datos de competencias</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            );
          })()}

          {/* Screen Exit Alerts */}
          <SectionCard title="Monitoreo anti-trampa">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                {selected.map((c: any, ci: number) => {
                  const exits = c.screen_exits || { total: 0, log: [] };
                  const byTest = exits.by_test || {};
                  const techExits = byTest.technical || 0;
                  const kudertExits = byTest.kudert || 0;
                  const integrityExits = byTest.integrity || 0;

                  if (exits.total === 0) return (
                    <div key={c.candidate.id} style={{ background: 'var(--kuno-dark-2)', border: `1px solid ${CANDIDATE_COLORS[ci]}30`, borderRadius: 'var(--radius-lg)', padding: 16 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: CANDIDATE_COLORS[ci], marginBottom: 8 }}>{c.candidate.name}</div>
                      <span style={{ background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12 }}>Sin salidas</span>
                    </div>
                  );
                  return (
                    <div key={c.candidate.id} style={{ background: 'var(--kuno-dark-2)', border: `1px solid ${exits.total >= 3 ? 'rgba(231,76,60,0.4)' : 'rgba(243,156,18,0.4)'}`, borderRadius: 'var(--radius-lg)', padding: 16 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: CANDIDATE_COLORS[ci], marginBottom: 10 }}>{c.candidate.name}</div>
                      {/* Breakdown by test */}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                        {techExits > 0 && (
                          <span style={{ fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 12, background: techExits >= 3 ? 'rgba(231,76,60,0.15)' : 'rgba(243,156,18,0.15)', color: techExits >= 3 ? 'var(--kuno-danger)' : '#f39c12', border: `1px solid ${techExits >= 3 ? 'rgba(231,76,60,0.3)' : 'rgba(243,156,18,0.3)'}` }}>
                            Técnica: {techExits} salidas
                          </span>
                        )}
                        {kudertExits > 0 && (
                          <span style={{ fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 12, background: kudertExits >= 3 ? 'rgba(231,76,60,0.15)' : 'rgba(243,156,18,0.15)', color: kudertExits >= 3 ? 'var(--kuno-danger)' : '#f39c12', border: `1px solid ${kudertExits >= 3 ? 'rgba(231,76,60,0.3)' : 'rgba(243,156,18,0.3)'}` }}>
                            Conductual: {kudertExits} salidas
                          </span>
                        )}
                        {integrityExits > 0 && (
                          <span style={{ fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 12, background: integrityExits >= 3 ? 'rgba(231,76,60,0.15)' : 'rgba(243,156,18,0.15)', color: integrityExits >= 3 ? 'var(--kuno-danger)' : '#f39c12', border: `1px solid ${integrityExits >= 3 ? 'rgba(231,76,60,0.3)' : 'rgba(243,156,18,0.3)'}` }}>
                            Integridad: {integrityExits} salidas
                          </span>
                        )}
                      </div>
                      {/* Detailed log */}
                      {exits.log.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                          {exits.log.map((log: any, li: number) => (
                            <div key={li} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'var(--kuno-dark)', borderRadius: 'var(--radius)', border: '1px solid var(--kuno-border)', fontSize: 12 }}>
                              <span style={{ color: log.type === 'tab' ? 'var(--kuno-danger)' : log.type === 'window' ? '#f39c12' : 'var(--kuno-text-muted)' }}>
                                {log.type === 'tab' ? 'Pestaña' : log.type === 'window' ? 'Ventana' : 'Cursor'}
                              </span>
                              <span style={{ color: 'var(--kuno-cream)' }}>{log.section || 'General'} #{log.questionIdx}</span>
                              {log.duration != null && (
                                <span style={{ fontWeight: 700, color: log.duration > 10 ? 'var(--kuno-danger)' : log.duration > 5 ? '#f39c12' : 'var(--kuno-text-muted)' }}>
                                  {log.duration}s
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ fontSize: 12, color: 'var(--kuno-text-muted)', marginTop: 4 }}>Sin detalle por pregunta (prueba anterior al registro detallado)</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </SectionCard>

          {/* Salary Comparison */}
          <SectionCard title="Aspiración salarial">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {selected.map((c: any, ci: number) => (
                <div key={c.candidate.id} style={{ padding: '12px 18px', background: 'var(--kuno-dark-2)', borderRadius: 'var(--radius)', border: `1px solid ${CANDIDATE_COLORS[ci]}30`, minWidth: 160 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: CANDIDATE_COLORS[ci], marginBottom: 4 }}>{c.candidate.name}</div>
                  {c.candidate.salary_expectation ? (
                    <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--kuno-cream)' }}>
                      ${c.candidate.salary_expectation.toLocaleString()}
                      <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--kuno-text-muted)', marginLeft: 4 }}>/mes</span>
                    </span>
                  ) : (
                    <span style={{ fontSize: 13, color: 'var(--kuno-text-muted)' }}>No indicado</span>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>

          {/* Emotion Comparison */}
          <SectionCard title="Emoción">
            <div style={{ position: 'relative', height: 10, background: 'linear-gradient(to right, #f39c12, #3498db, #9b59b6)', borderRadius: 5, marginBottom: 30 }}>
              {selected.map((c: any, ci: number) => {
                const score = c.results?.emotional?.score;
                if (score == null) return null;
                return <div key={ci} style={{ position: 'absolute', top: -8, left: `${score}%`, transform: 'translateX(-50%)' }}>
                  <div style={{ width: 16, height: 16, borderRadius: '50%', background: CANDIDATE_COLORS[ci], border: '2px solid var(--kuno-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 7, fontWeight: 700, color: ci === 0 ? 'var(--kuno-dark)' : '#fff' }}>{ci + 1}</span>
                  </div>
                  <div style={{ fontSize: 9, color: CANDIDATE_COLORS[ci], textAlign: 'center', marginTop: 2 }}>{c.candidate.name.split(' ')[0]}</div>
                </div>;
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: '#f39c12' }}>Espontáneo</span>
              <span style={{ fontSize: 11, color: '#3498db' }}>Mesura</span>
              <span style={{ fontSize: 11, color: '#9b59b6' }}>Reflexivo</span>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
              {selected.map((c: any, ci: number) => {
                const e = c.results?.emotional;
                return e ? (
                  <span key={ci} style={{ fontSize: 12, color: CANDIDATE_COLORS[ci], fontWeight: 600 }}>
                    {c.candidate.name.split(' ')[0]}: {e.perfil === 'espontaneo' ? 'Espontáneo' : e.perfil === 'mesura' ? 'Mesura' : 'Reflexivo'} ({e.score})
                  </span>
                ) : null;
              })}
            </div>
          </SectionCard>

          {/* Technical Comparison */}
          <SectionCard title="Técnica">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ padding: '8px 14px', background: 'var(--kuno-dark-2)', borderRadius: 'var(--radius)', border: '1px dashed var(--kuno-border)' }}>
                <span style={{ fontSize: 11, color: 'var(--kuno-text-muted)' }}>Mínimo requerido: </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--kuno-cream)' }}>{ideal.min_technical_score || 70}%</span>
              </div>
              {selected.map((c: any, ci: number) => {
                const t = c.results?.technical;
                return (
                  <div key={ci} style={{ padding: '8px 14px', background: 'var(--kuno-dark-2)', borderRadius: 'var(--radius)', border: `1px solid ${CANDIDATE_COLORS[ci]}30` }}>
                    <span style={{ fontSize: 11, color: CANDIDATE_COLORS[ci] }}>{c.candidate.name.split(' ')[0]}: </span>
                    {t ? (
                      <>
                        <span style={{ fontSize: 18, fontWeight: 700, color: t.passed ? 'var(--kuno-lime)' : 'var(--kuno-danger)' }}>{t.score}%</span>
                        <span style={{ fontSize: 10, marginLeft: 6, color: t.passed ? 'var(--kuno-lime)' : 'var(--kuno-danger)' }}>{t.passed ? 'Aprobado' : 'No aprobado'}</span>
                      </>
                    ) : <span style={{ fontSize: 12, color: 'var(--kuno-text-muted)' }}>Pendiente</span>}
                  </div>
                );
              })}
            </div>
          </SectionCard>

          {/* Integrity Comparison */}
          <SectionCard title="Integridad">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thS}>Dimensión</th>
                    {selected.map((c: any, ci: number) => (
                      <th key={ci} style={{ ...thS, color: CANDIDATE_COLORS[ci] }}>{c.candidate.name.split(' ')[0]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Overall */}
                  <tr style={{ borderTop: '1px solid var(--kuno-border)' }}>
                    <td style={{ ...tdS, fontWeight: 700 }}>GENERAL</td>
                    {selected.map((c: any, ci: number) => {
                      const int = c.results?.integrity;
                      if (!int) return <td key={ci} style={tdS}>—</td>;
                      const color = int.overall === 'bajo' ? 'var(--kuno-lime)' : int.overall === 'medio' ? '#f39c12' : 'var(--kuno-danger)';
                      return <td key={ci} style={tdS}><span style={{ fontWeight: 700, color }}>{int.overall.toUpperCase()} {int.overall_pct}%</span></td>;
                    })}
                  </tr>
                  {Object.keys(INT_LABELS).map(dim => (
                    <tr key={dim} style={{ borderTop: '1px solid var(--kuno-border)' }}>
                      <td style={tdS}>{INT_LABELS[dim]}</td>
                      {selected.map((c: any, ci: number) => {
                        const d = c.results?.integrity?.dimensiones?.[dim];
                        if (!d) return <td key={ci} style={tdS}>—</td>;
                        const color = d.nivel === 'bajo' ? 'var(--kuno-lime)' : d.nivel === 'medio' ? '#f39c12' : 'var(--kuno-danger)';
                        return <td key={ci} style={tdS}><span style={{ color, fontWeight: 600 }}>{d.nivel.charAt(0).toUpperCase() + d.nivel.slice(1)} {d.pct}%</span></td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* Pipeline Decision — DISC */}
          <CompareDecisionPanel title="Decisión — Evaluación Conductual (DISC)" candidates={selected} stageField="kudert_result_id" stages={[
            { key: 'next_stage_kudert', label: 'Siguiente etapa', style: 'next' },
            { key: 'review_cv_kudert', label: 'Duda - Revisar CV', style: 'review' },
            { key: 'rejected_kudert', label: 'Rechazar', style: 'reject' },
          ]} onSaved={() => { if (id) getComparison(id).then(c => { setComparison(c); }).catch(() => {}); }} />

          {/* Pipeline Decision — Integridad */}
          <CompareDecisionPanel title="Decisión — Integridad" candidates={selected} stageField="integrity_result_id" stages={[
            { key: 'interview_integrity', label: 'Llamar a entrevista', style: 'next' },
            { key: 'rejected_integrity', label: 'Rechazado', style: 'reject' },
          ]} onSaved={() => { if (id) getComparison(id).then(c => { setComparison(c); }).catch(() => {}); }} />

        </div>
      )}
    </div>
  );
}


function CompetenciaScale({ label, value, color }: { label: string; value: number; color?: string }) {
  const barColor = color || 'var(--kuno-text-muted)';
  const fillColor = value < 30 ? 'var(--kuno-danger)' : value < 59 ? '#f39c12' : 'var(--kuno-lime)';
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--kuno-text-muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, position: 'relative', height: 10 }}>
          {/* Track */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 10, background: 'var(--kuno-dark)', borderRadius: 5, border: '1px solid var(--kuno-border)' }} />
          {/* Fill */}
          <div style={{ position: 'absolute', top: 0, left: 0, height: 10, width: `${value}%`, background: color ? barColor : fillColor, borderRadius: 5, opacity: 0.85 }} />
          {/* Marker */}
          <div style={{ position: 'absolute', top: -5, left: `${value}%`, transform: 'translateX(-50%)', width: 20, height: 20, borderRadius: '50%', background: color ? barColor : fillColor, border: '2px solid var(--kuno-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 7, fontWeight: 800, color: 'var(--kuno-dark)' }}>{value < 30 ? '-' : value < 59 ? '±' : '+'}</span>
          </div>
          {/* Scale labels */}
          <div style={{ position: 'absolute', top: 14, left: 0, right: 0, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 9, color: 'var(--kuno-text-muted)' }}>0</span>
            <span style={{ fontSize: 9, color: 'var(--kuno-text-muted)' }}>40</span>
            <span style={{ fontSize: 9, color: 'var(--kuno-text-muted)' }}>60</span>
            <span style={{ fontSize: 9, color: 'var(--kuno-text-muted)' }}>100</span>
          </div>
        </div>
        <span style={{ fontSize: 16, fontWeight: 800, color: color || fillColor, minWidth: 30, textAlign: 'right' }}>{value}</span>
      </div>
    </div>
  );
}

function IdealDiscCard({ label, disc, pk }: { label: string; disc: Record<string, number>; pk: any }) {
  return (
    <div style={{ background: 'var(--kuno-dark-2)', border: '1px dashed var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--kuno-text-muted)', marginBottom: 12 }}>{label}</div>
      <DiscProfileChart disc={disc} />
      {pk && (
        <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--kuno-dark)', borderRadius: 'var(--radius)', border: '1px solid var(--kuno-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ background: 'var(--kuno-slate)', color: 'var(--kuno-cream)', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>{pk.id}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--kuno-cream)' }}>{pk.name}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {pk.traits.map((t: string, ti: number) => (
              <div key={ti} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--kuno-text-muted)', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--kuno-text-muted)' }}>{t}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface StageOption { key: string; label: string; style: 'next' | 'review' | 'reject' }

function CompareDecisionPanel({ title, candidates, stageField, stages, onSaved }: { title: string; candidates: any[]; stageField: string; stages: StageOption[]; onSaved: () => void }) {
  const [decisions, setDecisions] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const setDecision = (cid: string, decision: string | null) => {
    setSaved(false);
    setDecisions(prev => ({ ...prev, [cid]: decision }));
  };

  const hasChanges = Object.values(decisions).some(d => d != null);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const c of candidates) {
        const decision = decisions[c.candidate.id];
        const resultId = c[stageField];
        if (decision && resultId) {
          await setPipelineStage(resultId, decision);
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

  const btnStyles: Record<string, { normal: CSSProperties; active: CSSProperties }> = {
    next: { normal: decBtnNext, active: decBtnNextActive },
    review: { normal: decBtnReview, active: decBtnReviewActive },
    reject: { normal: decBtnReject, active: decBtnRejectActive },
  };

  return (
    <SectionCard title={title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {candidates.map((c: any, ci: number) => {
          const decision = decisions[c.candidate.id] || null;
          const hasResultId = !!c[stageField];
          return (
            <div key={c.candidate.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 16px', background: 'var(--kuno-dark-2)', borderRadius: 'var(--radius)', border: `1px solid ${CANDIDATE_COLORS[ci]}30`, opacity: hasResultId ? 1 : 0.4 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: CANDIDATE_COLORS[ci] }}>{c.candidate.name}</div>
                <div style={{ fontSize: 12, color: 'var(--kuno-text-muted)' }}>{c.candidate.email}</div>
                {!hasResultId && <div style={{ fontSize: 11, color: 'var(--kuno-text-muted)', marginTop: 2 }}>No ha completado esta prueba</div>}
              </div>
              {hasResultId && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {stages.map(s => (
                    <button key={s.key} onClick={() => setDecision(c.candidate.id, decision === s.key ? null : s.key)}
                      style={decision === s.key ? btnStyles[s.style].active : btnStyles[s.style].normal}>
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
        <button onClick={handleSave} disabled={saving || !hasChanges} style={!saving && hasChanges ? decBtnSave : decBtnSaveDisabled}>
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
        {saved && <span style={{ fontSize: 13, color: 'var(--kuno-lime)' }}>Cambios guardados</span>}
      </div>
    </SectionCard>
  );
}

const decBtnBase: CSSProperties = { fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 'var(--radius)', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s' };
const decBtnNext: CSSProperties = { ...decBtnBase, background: 'transparent', border: '1px solid rgba(218,253,111,0.3)', color: 'var(--kuno-text-muted)' };
const decBtnNextActive: CSSProperties = { ...decBtnBase, background: 'var(--kuno-lime)', border: '1px solid var(--kuno-lime)', color: 'var(--kuno-dark)' };
const decBtnReview: CSSProperties = { ...decBtnBase, background: 'transparent', border: '1px solid rgba(52,152,219,0.3)', color: 'var(--kuno-text-muted)' };
const decBtnReviewActive: CSSProperties = { ...decBtnBase, background: '#3498db', border: '1px solid #3498db', color: '#fff' };
const decBtnReject: CSSProperties = { ...decBtnBase, background: 'transparent', border: '1px solid rgba(231,76,60,0.3)', color: 'var(--kuno-text-muted)' };
const decBtnRejectActive: CSSProperties = { ...decBtnBase, background: 'var(--kuno-danger)', border: '1px solid var(--kuno-danger)', color: '#fff' };
const decBtnSave: CSSProperties = { background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontWeight: 700, fontSize: 14, padding: '10px 32px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer' };
const decBtnSaveDisabled: CSSProperties = { ...decBtnSave, opacity: 0.4, cursor: 'not-allowed' };

function calcDiscSimilarity(ideal: Record<string, number>, candidateRaw: Record<string, number>): number {
  const dims = ['D', 'I', 'S', 'C'];
  const candidate = normalizeDisc(candidateRaw);
  let totalRatio = 0;
  for (const d of dims) {
    const i = ideal?.[d] || 0;
    const c = candidate[d] || 0;
    if (i === 0 && c === 0) { totalRatio += 100; continue; }
    const max = Math.max(i, c, 1);
    const min = Math.min(i, c);
    totalRatio += Math.round((min / max) * 100);
  }
  return Math.round(totalRatio / 4);
}

function DiscProfileChart({ disc, raw }: { disc: Record<string, number>; raw?: boolean }) {
  const dims = ['D', 'I', 'S', 'C'] as const;
  const values = raw ? normalizeDisc(disc) : disc;
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {dims.map(d => {
        const val = values[d] || 0;
        return (
          <div key={d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: DISC_COLORS[d] }}>{d}</span>
            <div style={{ width: '100%', height: 120, background: 'var(--kuno-dark)', borderRadius: 6, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden', border: '1px solid var(--kuno-border)' }}>
              <div style={{ width: '70%', height: `${val}%`, background: DISC_COLORS[d], borderRadius: '4px 4px 0 0', minHeight: 2, opacity: 0.85 }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: DISC_COLORS[d] }}>{val}</span>
            <span style={{ fontSize: 10, color: 'var(--kuno-text-muted)' }}>{DISC_NAMES[d]}</span>
          </div>
        );
      })}
    </div>
  );
}


// Normalize candidate cognitive raw scores to 0-100% per dimension
function normalizeCognitive(cog: any): Record<string, number> {
  if (!cog) return { verbal: 0, espacial: 0, logica: 0, numerica: 0, abstracta: 0 };
  const maxPerDim = cog.max ? Math.max(1, Math.round(cog.max / 5)) : 20;
  const result: Record<string, number> = {};
  for (const dim of COG_DIMS) {
    result[dim] = Math.min(100, Math.round(((cog[dim] || 0) / maxPerDim) * 100));
  }
  return result;
}

// Similarity: min/max ratio per dimension, then average
function calcVelnaSimilarity(ideal: Record<string, number>, candidate: Record<string, number>): number | null {
  let totalRatio = 0;
  let count = 0;
  for (const dim of COG_DIMS) {
    const i = ideal[dim] || 0;
    const c = candidate[dim] || 0;
    if (i === 0 && c === 0) { totalRatio += 100; count++; continue; }
    const max = Math.max(i, c, 1);
    const min = Math.min(i, c);
    totalRatio += Math.round((min / max) * 100);
    count++;
  }
  return count > 0 ? Math.round(totalRatio / count) : null;
}

const COG_COLORS: Record<string, string> = { verbal: '#3498db', espacial: '#2ecc71', logica: '#f39c12', numerica: '#e74c3c', abstracta: '#9b59b6' };

function VelnaChart({ values, color }: { values: Record<string, number>; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {COG_DIMS.map(dim => {
        const val = values[dim] || 0;
        const barColor = color || COG_COLORS[dim];
        return (
          <div key={dim}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--kuno-text-muted)' }}>{COG_LABELS[dim]}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: barColor }}>{val}</span>
            </div>
            <div style={{ height: 8, background: 'var(--kuno-dark)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--kuno-border)' }}>
              <div style={{ height: '100%', width: `${val}%`, background: barColor, borderRadius: 4, opacity: 0.85, transition: 'width 0.3s' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={sectionCard}>
      <h3 style={sectionTitle}>{title}</h3>
      {children}
    </div>
  );
}

const backLink: CSSProperties = { color: 'var(--kuno-text-muted)', fontSize: 14, display: 'inline-block', marginBottom: 20 };
const chipBtn: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, border: '1px solid var(--kuno-border)', cursor: 'pointer', fontSize: 13 };
const emptyCard: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 40, textAlign: 'center' };
const sectionCard: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 24 };
const sectionTitle: CSSProperties = { fontSize: 14, fontWeight: 600, color: 'var(--kuno-lime)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.5px' };
const barTrack: CSSProperties = { flex: 1, height: 8, background: 'var(--kuno-dark-2)', borderRadius: 4, overflow: 'hidden' };
const barFill: CSSProperties = { height: '100%', borderRadius: 4, transition: 'width 0.3s' };
const thS: CSSProperties = { padding: '8px 10px', fontSize: 11, fontWeight: 600, color: 'var(--kuno-cream)', textAlign: 'left', textTransform: 'uppercase' };
const tdS: CSSProperties = { padding: '8px 10px', fontSize: 12, color: 'var(--kuno-cream)' };
