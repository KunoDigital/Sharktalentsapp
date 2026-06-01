import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { identifyPK, normalizeDisc } from '../../data/pkProfiles';
import { VELNA_COMPETENCIAS, interpretVelnaLevel, type VelnaSubtest } from '../../data/velnaDescriptions';
import { DISC_WORK_STYLE, DISC_FORTALEZAS, getDominantDim, type DiscDim } from '../../data/discWorkStyle';
import { calculateCompetencias, COMPETENCIA_DESCRIPCIONES } from '../../data/competencias';
import { getDimensionInfo } from '../../data/integridadDescriptions';
import { analizarPerfilIntegridad, preguntasParaEntrevista } from '../../data/integridadAnalysis';
import './candidate-test.css';

const log = logger('DEMO_REPORT');

type ReportData = {
  generated_at: string;
  job: { title: string; company: string; cognitive_level: string } | null;
  candidate: { name: string; email: string; age: number | null } | null;
  pipeline_stage: string;
  scores: Record<string, unknown> | null;
  integrity_dimensions: Array<{ dimension: string; nivel: string; pct: number }>;
};

const DIM_LABELS: Record<string, string> = {
  alcohol: 'Alcohol', apuestas: 'Apuestas', autenticidad: 'Autenticidad',
  buena_impresion: 'Buena impresión', confiabilidad: 'Confiabilidad',
  dominio_personal: 'Dominio personal', drogas: 'Drogas', honestidad: 'Honestidad',
  hurto: 'Hurto', imparcialidad: 'Imparcialidad', inteligencia_social: 'Inteligencia social',
  sencillez: 'Sencillez', soborno: 'Soborno',
};

const DISC_COLORS: Record<DiscDim, string> = { D: '#e74c3c', I: '#f39c12', S: '#2ecc71', C: '#3498db' };
const DISC_FULL_NAMES: Record<DiscDim, string> = {
  D: 'Dominancia · Orientación a resultados',
  I: 'Influencia · Habilidad social',
  S: 'Estabilidad · Constancia',
  C: 'Cumplimiento · Atención al detalle',
};

export default function DemoReport() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Link inválido');
      setLoading(false);
      return;
    }
    if (token === 'preview') {
      setData(getMockReport());
      setLoading(false);
      return;
    }
    async function load() {
      try {
        const response = await fetch(`${config.apiBase.replace(/\/$/, '')}/report/${encodeURIComponent(token!)}`);
        if (!response.ok) {
          setError(response.status === 401 || response.status === 404 ? 'Reporte no encontrado o link expirado' : `Error al cargar (${response.status})`);
          setLoading(false);
          return;
        }
        const json = (await response.json()) as { report: ReportData };
        setData(json.report);
      } catch (err) {
        log.warn('failed to load report', { error: (err as Error).message });
        setError('Error de conexión');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  if (loading) return <div style={pageStyle}><p style={{ color: '#8a93a3' }}>Cargando reporte…</p></div>;
  if (error || !data) {
    return (
      <div style={pageStyle}>
        <h1 style={{ color: '#fff', fontSize: 24, marginBottom: 12 }}>Reporte no encontrado</h1>
        <p style={{ color: '#8a93a3' }}>{error ?? 'El link puede haber expirado.'}</p>
      </div>
    );
  }

  const scores = (data.scores ?? {}) as Record<string, number | string | null>;
  const candidateName = data.candidate?.name ?? 'el colaborador';
  const date = new Date(data.generated_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });

  const discRaw = { D: Number(scores.disc_d ?? 0), I: Number(scores.disc_i ?? 0), S: Number(scores.disc_s ?? 0), C: Number(scores.disc_c ?? 0) };
  const discNormFromBackend = {
    D: Number(scores.disc_norm_d ?? 0), I: Number(scores.disc_norm_i ?? 0),
    S: Number(scores.disc_norm_s ?? 0), C: Number(scores.disc_norm_c ?? 0),
  };
  const totalNorm = discNormFromBackend.D + discNormFromBackend.I + discNormFromBackend.S + discNormFromBackend.C;
  const disc = totalNorm > 0 ? discNormFromBackend : normalizeDisc(discRaw);
  const dominantDim = getDominantDim(disc as { D: number; I: number; S: number; C: number });
  const pk = identifyPK(disc);
  const workStyle = DISC_WORK_STYLE[dominantDim];
  const fortalezasBase = DISC_FORTALEZAS[dominantDim];

  const velna: Record<VelnaSubtest, number> = {
    verbal: Number(scores.velna_verbal ?? 0),
    espacial: Number(scores.velna_espacial ?? 0),
    logica: Number(scores.velna_logica ?? 0),
    numerica: Number(scores.velna_numerica ?? 0),
    abstracta: Number(scores.velna_abstracta ?? 0),
  };
  const velnaTotal = Number(scores.velna_total ?? Math.round((velna.verbal + velna.espacial + velna.logica + velna.numerica + velna.abstracta) / 5));

  const intOverall = String(scores.int_overall ?? '—');
  const intPct = Number(scores.int_overall_pct ?? 0);
  const intRecomendacion = String(scores.int_recomendacion ?? '—');

  const integrityAlerts = data.integrity_dimensions.filter((d) => d.nivel !== 'bajo');
  const integrityOK = data.integrity_dimensions.filter((d) => d.nivel === 'bajo');

  const competenciasAll = calculateCompetencias(
    disc as { D: number; I: number; S: number; C: number },
    velna,
    50,
  );
  const competenciasTop = [...competenciasAll].sort((a, b) => b.score - a.score).slice(0, 10);

  const cognitiveStrengths = (Object.entries(velna) as Array<[VelnaSubtest, number]>)
    .filter(([, v]) => v >= 65)
    .sort((a, b) => b[1] - a[1]);
  const cognitiveWeak = (Object.entries(velna) as Array<[VelnaSubtest, number]>)
    .filter(([, v]) => v < 50)
    .sort((a, b) => a[1] - b[1]);

  const fortalezasList = [...fortalezasBase.fortalezas];
  const considerarList = [...fortalezasBase.considerar];
  cognitiveStrengths.slice(0, 2).forEach(([k]) => {
    const comp = VELNA_COMPETENCIAS.find((c) => c.key === k);
    if (comp) fortalezasList.push(`Buen razonamiento ${comp.label.toLowerCase().replace('razonamiento ', '')} — ${comp.utilidad.split('.')[0].toLowerCase()}`);
  });
  cognitiveWeak.slice(0, 1).forEach(([k]) => {
    const comp = VELNA_COMPETENCIAS.find((c) => c.key === k);
    if (comp) considerarList.push(`Razonamiento ${comp.label.toLowerCase().replace('razonamiento ', '')} bajo el promedio — funciona mejor con apoyo en tareas de esta área`);
  });
  if (integrityAlerts.length > 0) {
    considerarList.push(`${integrityAlerts.length} dimensión(es) de integridad en nivel medio/alto: ${integrityAlerts.map((d) => (DIM_LABELS[d.dimension] ?? d.dimension)).join(', ')}`);
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={headerStyle}>
          <div style={brandStyle}>SHARKTALENTS · REPORTE DEMO</div>
          <h1 style={{ fontSize: 32, fontWeight: 'bold', margin: 0, marginBottom: 4 }}>{candidateName}</h1>
          <div style={{ color: '#8a93a3', fontSize: 15 }}>Evaluación gratuita · 2 pruebas completadas</div>
          <div style={metaStyle}>
            <span><strong style={{ color: '#e6e8eb' }}>Fecha:</strong> {date}</span>
          </div>
        </div>

        <div style={bodyStyle}>
          <div style={introStyle}>
            Este reporte sintetiza los resultados de <strong>{candidateName}</strong> en las 2 evaluaciones que completó:
            <strong> conductual</strong> (DISC + capacidad cognitiva) e <strong>integridad</strong>.
            En el servicio completo, este reporte incluye además prueba técnica a medida del rol, evaluación emocional,
            videos con análisis IA, y un comparativo entre varios candidatos.
          </div>

          <section style={sectionStyle}>
            <div style={sectionLabelStyle}>PRUEBA 1 · BLOQUE A · CONDUCTUAL</div>
            <h2 style={sectionTitleStyle}>Perfil DISC</h2>
            <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>
              Cómo se comporta {candidateName} naturalmente bajo presión y en el día a día.
            </p>

            <div style={discBarsContainer}>
              {(['D', 'I', 'S', 'C'] as DiscDim[]).map((d) => (
                <div key={d} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: DISC_COLORS[d], marginBottom: 6 }}>{d}</div>
                  <div style={{ height: 100, background: '#f3f4f6', borderRadius: 6, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
                    <div style={{ width: '60%', height: `${disc[d]}%`, background: DISC_COLORS[d], borderRadius: '4px 4px 0 0', opacity: 0.85, minHeight: 2, transition: 'height 0.6s ease' }} />
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: DISC_COLORS[d], marginTop: 6 }}>{disc[d]}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2, letterSpacing: 0.3 }}>{DISC_FULL_NAMES[d].split(' · ')[0]}</div>
                </div>
              ))}
            </div>

            {pk && (
              <div style={pkBox}>
                <div style={{ fontSize: 12, color: '#0e1218', fontWeight: 700, letterSpacing: 1.5, marginBottom: 6 }}>
                  PERFIL DOMINANTE · {pk.id}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#0e1218', marginBottom: 12, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
                  {pk.name}
                </div>
                <p style={{ color: '#1f2937', margin: 0, marginBottom: 14, fontSize: 14.5, lineHeight: 1.7 }}>
                  {pk.description}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {pk.traits.map((trait, i) => (
                    <span key={i} style={traitChip}>{trait}</span>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section style={sectionStyle}>
            <div style={sectionLabelStyle}>ESTILO DE TRABAJO</div>
            <h2 style={sectionTitleStyle}>¿Cómo trabaja {candidateName}?</h2>
            <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>
              4 dimensiones derivadas de su perfil dominante ({dominantDim}).
            </p>
            <div style={workStyleGrid}>
              <WorkStyleCard label="Toma de decisiones" text={workStyle.decisiones} />
              <WorkStyleCard label="Trabajo en equipo" text={workStyle.equipo} />
              <WorkStyleCard label="Bajo presión" text={workStyle.presion} />
              <WorkStyleCard label="Comunicación" text={workStyle.comunicacion} />
            </div>
          </section>

          <section style={sectionStyle}>
            <div style={sectionLabelStyle}>PRUEBA 1 · BLOQUE B · CAPACIDAD COGNITIVA</div>
            <h2 style={sectionTitleStyle}>VELNA — 5 competencias</h2>
            <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>
              Score normalizado por sub-prueba. Cada área mide algo distinto y predice cosas distintas en el trabajo.
            </p>

            <div style={cognitiveScoreStyle}>
              <div style={{ fontSize: 56, fontWeight: 'bold', color: '#1f2937', lineHeight: 1 }}>
                {velnaTotal}<span style={{ fontSize: 28, color: '#6b7280', marginLeft: 4 }}>%</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'inline-block', background: '#dafd6f', color: '#1f2937', fontSize: 12, fontWeight: 'bold', padding: '4px 12px', borderRadius: 99, letterSpacing: 0.5, marginBottom: 8 }}>
                  {velnaTotal >= 70 ? 'CAPACIDAD ALTA' : velnaTotal >= 50 ? 'CAPACIDAD MEDIA' : 'CAPACIDAD BAJA'}
                </div>
                <p style={{ fontSize: 14, color: '#4b5563', margin: 0 }}>
                  Promedio de las 5 sub-pruebas (verbal, espacial, lógica, numérica, abstracta).
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {VELNA_COMPETENCIAS.map((comp) => (
                <VelnaCard key={comp.key} comp={comp} pct={velna[comp.key]} />
              ))}
            </div>
          </section>

          <section style={sectionStyle}>
            <div style={sectionLabelStyle}>COMPETENCIAS PROFESIONALES</div>
            <h2 style={sectionTitleStyle}>Top 10 competencias de {candidateName.split(' ')[0]}</h2>
            <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>
              Cada competencia es un comportamiento concreto en el trabajo, calculada combinando perfil conductual (DISC),
              razonamiento (VELNA) y manejo emocional. Las 10 más altas indican dónde rinde mejor.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {competenciasTop.map((c) => (
                <CompetenciaCard key={c.id} id={c.id} nombre={c.nombre} score={c.score} />
              ))}
            </div>
          </section>

          <section style={sectionStyle}>
            <div style={sectionLabelStyle}>FORTALEZAS Y PUNTOS A CONSIDERAR</div>
            <h2 style={sectionTitleStyle}>Resumen ejecutivo</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
              <div style={proBox}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e5631', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Lo que aporta
                </div>
                {fortalezasList.map((f, i) => (
                  <div key={i} style={proItem}><span style={{ color: '#1e7e34', fontWeight: 700, position: 'absolute', left: 0 }}>✓</span>{f}</div>
                ))}
              </div>
              <div style={conBox}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#5a3500', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  A tomar en cuenta
                </div>
                {considerarList.map((c, i) => (
                  <div key={i} style={conItem}><span style={{ color: '#a16207', fontWeight: 700, position: 'absolute', left: 0 }}>!</span>{c}</div>
                ))}
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <div style={sectionLabelStyle}>PRUEBA 2 · INTEGRIDAD</div>
            <h2 style={sectionTitleStyle}>Perfil de riesgo conductual</h2>
            <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>
              13 dimensiones que predicen comportamientos de riesgo en el trabajo. Lo deseable es <strong>nivel bajo</strong> en todas.
            </p>

            <div style={{ background: intOverall === 'bajo' ? '#f0fdf4' : intOverall === 'medio' ? '#fffbeb' : '#fef2f2', border: `1px solid ${intOverall === 'bajo' ? '#bbf7d0' : intOverall === 'medio' ? '#fde68a' : '#fecaca'}`, borderRadius: 8, padding: 20, marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 'bold', color: intOverall === 'bajo' ? '#166534' : intOverall === 'medio' ? '#92400e' : '#991b1b', margin: 0, marginBottom: 6 }}>
                Perfil global: {intOverall.toUpperCase()}
              </h3>
              <p style={{ fontSize: 14, color: intOverall === 'bajo' ? '#15803d' : intOverall === 'medio' ? '#78350f' : '#7f1d1d', margin: 0 }}>
                Score general de riesgo: <strong>{intPct}%</strong> · Recomendación: <strong>{intRecomendacion}</strong>
              </p>
            </div>

            {data.integrity_dimensions.length === 0 ? (
              <p style={{ color: '#9ca3af' }}>No hay datos por dimensión disponibles.</p>
            ) : (() => {
              const analisis = analizarPerfilIntegridad(data.integrity_dimensions);
              const preguntas = preguntasParaEntrevista(data.integrity_dimensions);
              return (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 24 }}>
                    <div style={summaryStat}>
                      <div style={{ fontSize: 32, fontWeight: 800, color: '#1e7e34', lineHeight: 1 }}>{integrityOK.length}</div>
                      <div style={{ fontSize: 12, color: '#1e5631', textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 }}>Sin riesgo</div>
                    </div>
                    <div style={summaryStat}>
                      <div style={{ fontSize: 32, fontWeight: 800, color: '#a16207', lineHeight: 1 }}>{integrityAlerts.filter((d) => d.nivel === 'medio').length}</div>
                      <div style={{ fontSize: 12, color: '#5a3500', textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 }}>Observación</div>
                    </div>
                    <div style={summaryStat}>
                      <div style={{ fontSize: 32, fontWeight: 800, color: '#991b1b', lineHeight: 1 }}>{integrityAlerts.filter((d) => d.nivel === 'alto').length}</div>
                      <div style={{ fontSize: 12, color: '#7f1d1d', textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 }}>Alerta</div>
                    </div>
                  </div>

                  <div style={{ background: '#f9fafb', borderLeft: '4px solid #0e1218', borderRadius: 6, padding: '18px 22px', marginBottom: 24 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0e1218', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Análisis global</div>
                    <p style={{ fontSize: 14.5, color: '#1f2937', margin: 0, lineHeight: 1.7 }}>{analisis.resumen}</p>
                  </div>

                  {analisis.validezNota && (
                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '16px 20px', marginBottom: 28 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#991b1b', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>⚠ Validez del test</div>
                      <p style={{ fontSize: 14, color: '#7f1d1d', margin: 0, lineHeight: 1.7 }}>{analisis.validezNota}</p>
                    </div>
                  )}

                  <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0e1218', marginTop: 32, marginBottom: 16 }}>Dimensiones por nivel de riesgo</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, alignItems: 'start' }}>
                    <RiesgoBox titulo="Riesgo bajo" subtitulo="Sin alertas" color="green" dims={integrityOK} />
                    <RiesgoBox titulo="Riesgo medio" subtitulo="Observar" color="amber" dims={integrityAlerts.filter((d) => d.nivel === 'medio')} />
                    <RiesgoBox titulo="Riesgo alto" subtitulo="Alertas críticas" color="red" dims={integrityAlerts.filter((d) => d.nivel === 'alto')} />
                  </div>

                  {preguntas.length > 0 && (
                    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 24, marginTop: 32 }}>
                      <h3 style={{ fontSize: 17, fontWeight: 700, color: '#5a3500', margin: 0, marginBottom: 6 }}>
                        Qué validar en entrevista
                      </h3>
                      <p style={{ fontSize: 13.5, color: '#78350f', marginTop: 0, marginBottom: 16, lineHeight: 1.6 }}>
                        Preguntas y acciones concretas para profundizar antes de tomar la decisión final.
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {preguntas.map(({ dimension, label, preguntas: qs }) => (
                          <div key={dimension}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#0e1218', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
                            <ul style={{ margin: 0, paddingLeft: 18, color: '#1f2937', fontSize: 14, lineHeight: 1.7 }}>
                              {qs.map((q, i) => (<li key={i}>{q}</li>))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </section>

          <div style={{ background: 'linear-gradient(135deg, #0e1218 0%, #1f283d 100%)', border: '1px solid #dafd6f', borderRadius: 12, padding: 32, marginTop: 48, textAlign: 'center' }}>
            <h3 style={{ fontSize: 22, marginBottom: 8, color: '#dafd6f', marginTop: 0 }}>¿Te sirvió esta demo?</h3>
            <p style={{ color: '#e6e8eb', fontSize: 15, marginBottom: 0, lineHeight: 1.7 }}>
              En el servicio completo recibís este mismo análisis pero con <strong style={{ color: '#dafd6f' }}>prueba técnica a medida del rol</strong>,
              <strong style={{ color: '#dafd6f' }}> evaluación emocional</strong>,
              <strong style={{ color: '#dafd6f' }}> videos con análisis IA</strong> y un
              <strong style={{ color: '#dafd6f' }}> comparativo de finalistas</strong> con recomendación de a quién entrevistar primero.
            </p>
          </div>
        </div>

        <div style={{ background: '#f9fafb', borderTop: '1px solid #e5e7eb', padding: '24px 48px', textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
          <strong style={{ color: '#1f2937' }}>SharkTalents</strong> · Una evaluación con criterio<br />
          Reporte generado el {date}
        </div>
      </div>
    </div>
  );
}

function WorkStyleCard({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#0e1218', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#1f2937', lineHeight: 1.6 }}>{text}</div>
    </div>
  );
}

function VelnaCard({ comp, pct }: { comp: typeof VELNA_COMPETENCIAS[number]; pct: number }) {
  const interp = interpretVelnaLevel(pct);
  const color = interp.level === 'alto' ? '#1e7e34' : interp.level === 'medio' ? '#a16207' : '#991b1b';
  const bg = interp.level === 'alto' ? '#f0fdf4' : interp.level === 'medio' ? '#fffbeb' : '#fef2f2';
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <h4 style={{ fontSize: 16, fontWeight: 700, color: '#0e1218', margin: 0 }}>{comp.label}</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, background: bg, color, padding: '3px 10px', borderRadius: 99, letterSpacing: 0.5 }}>
            {interp.label.toUpperCase()}
          </span>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#0e1218' }}>{pct}%</span>
        </div>
      </div>
      <div style={{ height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #dafd6f 0%, #c5fc6f 100%)', borderRadius: 3 }} />
      </div>
      <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 8, lineHeight: 1.6 }}>
        <strong style={{ color: '#0e1218' }}>Qué mide: </strong>{comp.mide}
      </div>
      <div style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.6 }}>
        <strong style={{ color: '#0e1218' }}>En qué es bueno: </strong>{comp.utilidad}
      </div>
      <div style={{ fontSize: 12, color, marginTop: 8, fontStyle: 'italic' }}>
        {interp.note}
      </div>
    </div>
  );
}

function CompetenciaCard({ id, nombre, score }: { id: string; nombre: string; score: number }) {
  const color = score >= 70 ? '#1e7e34' : score >= 55 ? '#0e1218' : '#a16207';
  const barColor = score >= 70 ? 'linear-gradient(90deg, #dafd6f 0%, #c5fc6f 100%)' : score >= 55 ? '#85b7eb' : '#fcd34d';
  const descripcion = COMPETENCIA_DESCRIPCIONES[id] ?? '';
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h4 style={{ fontSize: 15, fontWeight: 700, color: '#0e1218', margin: 0 }}>{nombre}</h4>
        <span style={{ fontSize: 18, fontWeight: 800, color }}>{score}%</span>
      </div>
      <div style={{ height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden', marginBottom: 10 }}>
        <div style={{ height: '100%', width: `${score}%`, background: barColor, borderRadius: 3 }} />
      </div>
      {descripcion && <div style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.6 }}>{descripcion}</div>}
    </div>
  );
}

function RiesgoBox({ titulo, subtitulo, color, dims }: { titulo: string; subtitulo: string; color: 'green' | 'amber' | 'red'; dims: Array<{ dimension: string; nivel: string; pct: number }> }) {
  const palette = {
    green: { bg: '#f0fdf4', border: '#bbf7d0', accent: '#1e7e34', text: '#1e5631', body: '#1a4a1a', muted: '#5a8a5a' },
    amber: { bg: '#fffbeb', border: '#fde68a', accent: '#a16207', text: '#5a3500', body: '#4a3010', muted: '#8a7a50' },
    red:   { bg: '#fef2f2', border: '#fecaca', accent: '#991b1b', text: '#7f1d1d', body: '#5a1010', muted: '#8a5050' },
  }[color];
  return (
    <div style={{ background: palette.bg, border: `1px solid ${palette.border}`, borderRadius: 12, padding: 18, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: palette.accent }} />
        <h4 style={{ fontSize: 16, fontWeight: 700, color: palette.text, margin: 0 }}>{titulo}</h4>
      </div>
      <div style={{ fontSize: 11.5, color: palette.muted, marginBottom: 14, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {dims.length} {dims.length === 1 ? 'dimensión' : 'dimensiones'} · {subtitulo}
      </div>
      {dims.length === 0 ? (
        <div style={{ fontSize: 13, color: palette.muted, fontStyle: 'italic' }}>Ninguna en este nivel</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {dims.map((d) => {
            const info = getDimensionInfo(d.dimension);
            if (!info) return null;
            const interpretacion = d.nivel === 'alto' ? info.alto : d.nivel === 'medio' ? info.medio : info.bajo;
            return (
              <div key={d.dimension} style={{ background: '#fff', borderRadius: 8, padding: 12, border: `1px solid ${palette.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <h5 style={{ fontSize: 14, fontWeight: 700, color: '#0e1218', margin: 0 }}>{info.label}</h5>
                  <span style={{ fontSize: 13, fontWeight: 800, color: palette.accent }}>{d.pct}%</span>
                </div>
                <div style={{ fontSize: 11.5, color: '#6b7280', marginBottom: 6, lineHeight: 1.5 }}>
                  <em>Qué mide:</em> {info.mide}
                </div>
                <div style={{ fontSize: 12.5, color: palette.body, lineHeight: 1.55 }}>
                  {interpretacion}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  background: '#f3f4f6', color: '#1f2937', lineHeight: 1.65,
  padding: '32px 16px', minHeight: '100vh',
};
const cardStyle: React.CSSProperties = {
  maxWidth: 920, margin: '0 auto', background: '#fff',
  borderRadius: 12, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
};
const headerStyle: React.CSSProperties = {
  background: '#0e1218', color: '#fff', padding: '40px 48px',
  borderBottom: '4px solid #dafd6f',
};
const brandStyle: React.CSSProperties = {
  color: '#dafd6f', fontSize: 13, fontWeight: 'bold',
  letterSpacing: 2, marginBottom: 12,
};
const metaStyle: React.CSSProperties = {
  marginTop: 24, paddingTop: 20,
  borderTop: '1px solid rgba(255,255,255,0.1)',
  color: '#8a93a3', fontSize: 13,
  display: 'flex', gap: 28, flexWrap: 'wrap',
};
const bodyStyle: React.CSSProperties = { padding: 48 };
const introStyle: React.CSSProperties = {
  background: '#f9fafb', borderLeft: '4px solid #dafd6f',
  padding: '20px 24px', borderRadius: 6, marginBottom: 40,
  fontSize: 15, color: '#374151',
};
const sectionStyle: React.CSSProperties = { marginBottom: 56 };
const sectionLabelStyle: React.CSSProperties = {
  display: 'inline-block', fontSize: 11, fontWeight: 'bold',
  color: '#6b7280', letterSpacing: 2, marginBottom: 10,
};
const sectionTitleStyle: React.CSSProperties = {
  fontSize: 24, color: '#1f2937', marginBottom: 8, marginTop: 0,
};
const discBarsContainer: React.CSSProperties = {
  display: 'flex', gap: 18, marginBottom: 24,
};
const pkBox: React.CSSProperties = {
  background: 'linear-gradient(135deg, #fdfff5 0%, #f0fdf4 100%)',
  border: '2px solid #dafd6f', borderRadius: 10, padding: 24,
};
const traitChip: React.CSSProperties = {
  background: '#fff', border: '1px solid #d0d0c0', borderRadius: 20,
  padding: '5px 13px', fontSize: 13, color: '#1f2937', fontWeight: 500,
};
const workStyleGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
};
const cognitiveScoreStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 28,
  background: '#f9fafb', border: '1px solid #e5e7eb',
  borderRadius: 8, padding: 24, marginBottom: 24,
};
const proBox: React.CSSProperties = {
  background: '#f0fdf4', border: '1px solid #bbf7d0',
  borderRadius: 10, padding: 18,
};
const conBox: React.CSSProperties = {
  background: '#fffbeb', border: '1px solid #fde68a',
  borderRadius: 10, padding: 18,
};
const proItem: React.CSSProperties = {
  fontSize: 14, color: '#1a4a1a', marginBottom: 8,
  paddingLeft: 16, position: 'relative',
};
const conItem: React.CSSProperties = {
  fontSize: 14, color: '#4a3010', marginBottom: 8,
  paddingLeft: 16, position: 'relative',
};
const summaryStat: React.CSSProperties = {
  background: '#fff', border: '1px solid #e5e7eb',
  borderRadius: 8, padding: '16px 12px', textAlign: 'center',
};

function getMockReport(): ReportData {
  return {
    generated_at: new Date().toISOString(),
    job: null,
    candidate: { name: 'Ana Demo García', email: 'a***a@demo.com', age: 32 },
    pipeline_stage: 'integridad_completed',
    scores: {
      disc_norm_d: 85,
      disc_norm_i: 45,
      disc_norm_s: 30,
      disc_norm_c: 60,
      disc_perfil_dominante: 'D',
      velna_verbal: 78,
      velna_espacial: 65,
      velna_logica: 82,
      velna_numerica: 70,
      velna_abstracta: 68,
      velna_total: 73,
      int_overall: 'medio',
      int_overall_pct: 28,
      int_recomendacion: 'Revisar con cautela',
    },
    integrity_dimensions: [
      { dimension: 'honestidad', nivel: 'bajo', pct: 18 },
      { dimension: 'confiabilidad', nivel: 'bajo', pct: 22 },
      { dimension: 'autenticidad', nivel: 'bajo', pct: 15 },
      { dimension: 'dominio_personal', nivel: 'bajo', pct: 25 },
      { dimension: 'imparcialidad', nivel: 'bajo', pct: 20 },
      { dimension: 'sencillez', nivel: 'bajo', pct: 28 },
      { dimension: 'inteligencia_social', nivel: 'bajo', pct: 12 },
      { dimension: 'apuestas', nivel: 'bajo', pct: 8 },
      { dimension: 'soborno', nivel: 'bajo', pct: 18 },
      { dimension: 'buena_impresion', nivel: 'medio', pct: 42 },
      { dimension: 'alcohol', nivel: 'medio', pct: 38 },
      { dimension: 'drogas', nivel: 'medio', pct: 35 },
      { dimension: 'hurto', nivel: 'alto', pct: 72 },
    ],
  };
}
