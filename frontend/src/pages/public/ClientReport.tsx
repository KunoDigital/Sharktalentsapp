import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getPublicReport } from '../../services/api';
import { normalizeDisc, identifyPK } from '../../data/pkProfiles';
import type { CSSProperties } from 'react';

const LABELS: Record<string, Record<string, any>> = {
  es: {
    loading: 'Cargando reporte...', notFound: 'Reporte no encontrado',
    title: 'Informe de evaluación', subtitle: 'Análisis psicométrico y técnico de candidatos',
    aiSubtitle: 'Evaluación de talento con inteligencia artificial', confidentialTag: 'CONFIDENCIAL',
    nextStep: 'Siguiente paso: entrevista personal con el candidato de su preferencia',
    comparison: 'Comparativo general', candidate: 'Candidato', affinity: 'Afinidad',
    behavioral: 'Conductual', cognitive: 'Cognitiva', technical: 'Técnica',
    integrity: 'Integridad', emotion: 'Emoción',
    higherAff: 'Mayor afinidad', goodAff: 'Buena afinidad', modAff: 'Afinidad moderada',
    noAlerts: 'Sin alertas', observations: 'observaciones',
    fullProfile: 'Ver perfil completo y detalles →',
    interviewComparison: 'Comparativo de entrevistas', aspect: 'Aspecto',
    interviewResult: 'Resultado de la entrevista',
    whatToExpect: 'Qué esperar', whatToDelegate: 'En qué soltarla',
    whatToTeach: 'En qué enseñarle', mainRisk: 'Riesgo principal',
    analysisConclusion: 'Conclusión del análisis',
    ifAutonomy: 'Si priorizas autonomía', ifGrowth: 'Si priorizas crecimiento',
    leastRisk: 'Menor riesgo', mostPotential: 'Mayor potencial',
    confidential: 'Confidencial y de uso exclusivo para',
    salary: '/mes', years: 'años', affinityLabel: 'afinidad',
    higherAffProfile: 'Mayor afinidad con el perfil', goodAffProfile: 'Buena afinidad con el perfil',
    modAffProfile: 'Afinidad moderada con el perfil',
    finalistsReady: 'Sus finalistas están listos',
    finalistsDesc: (n: number) => `Los ${n} candidatos completaron todas las evaluaciones: conductual, cognitiva, emocional, integridad y técnica. Los ordenamos por afinidad con el perfil del puesto para ayudarle a decidir a quién entrevistar primero.`,
    affinityWithProfile: 'Afinidad con el perfil ideal',
    noAlertsLong: 'Sin alertas — Todas las dimensiones en nivel bajo',
    candidateOf: (i: number, n: number) => `Candidato ${i} de ${n}`,
    integritySection: 'Integridad',
    whoWeSeek: 'Quién buscamos', whatMustKnow: 'Qué debe saber hacer', minTechnical: 'Mínimo técnico',
    intellectualCapacity: 'Capacidad intelectual', finalists: 'finalistas',
    workStyle: 'Estilo de trabajo', decisions: 'Toma de decisiones', teamwork: 'Trabajo en equipo',
    underPressure: 'Bajo presión', communication: 'Comunicación',
    strengthsAndConsiderations: 'Fortalezas y puntos a considerar',
    whyGoodForRole: 'Por qué es bueno para este rol', toConsider: 'A tomar en cuenta',
    emotionalProfile: 'Perfil emocional', balanced: 'Equilibrado', spontaneous: 'Espontáneo', reflective: 'Reflexivo',
    techTest: 'Prueba técnica', passed: 'Aprobada', failed: 'No aprobada', minRequired: 'Mínimo requerido',
    available: 'disponible',
    allDimsLow: 'Todas las dimensiones en nivel bajo',
    backToFinalists: '← Volver a los finalistas',
  },
  en: {
    loading: 'Loading report...', notFound: 'Report not found',
    title: 'Evaluation Report', subtitle: 'Psychometric and technical candidate analysis',
    aiSubtitle: 'AI-powered talent assessment', confidentialTag: 'CONFIDENTIAL',
    nextStep: 'Next step: in-person interview with your preferred candidate',
    comparison: 'General Comparison', candidate: 'Candidate', affinity: 'Affinity',
    behavioral: 'Behavioral', cognitive: 'Cognitive', technical: 'Technical',
    integrity: 'Integrity', emotion: 'Emotion',
    higherAff: 'Higher affinity', goodAff: 'Good affinity', modAff: 'Moderate affinity',
    noAlerts: 'No alerts', observations: 'observations',
    fullProfile: 'View full profile and details →',
    interviewComparison: 'Interview Comparison', aspect: 'Aspect',
    interviewResult: 'Interview result',
    whatToExpect: 'What to expect', whatToDelegate: 'Where they can work independently',
    whatToTeach: 'Where they need coaching', mainRisk: 'Main risk',
    analysisConclusion: 'Analysis Conclusion',
    ifAutonomy: 'If you prioritize autonomy', ifGrowth: 'If you prioritize growth',
    leastRisk: 'Least risk', mostPotential: 'Most potential',
    confidential: 'Confidential and for exclusive use of',
    salary: '/mo', years: 'years', affinityLabel: 'affinity',
    higherAffProfile: 'Higher affinity with the profile', goodAffProfile: 'Good affinity with the profile',
    modAffProfile: 'Moderate affinity with the profile',
    finalistsReady: 'Your finalists are ready',
    finalistsDesc: (n: number) => `All ${n} candidates completed every assessment: behavioral, cognitive, emotional, integrity and technical. We ranked them by affinity with the job profile to help you decide who to interview first.`,
    affinityWithProfile: 'Affinity with ideal profile',
    noAlertsLong: 'No alerts — All dimensions at low risk',
    candidateOf: (i: number, n: number) => `Candidate ${i} of ${n}`,
    integritySection: 'Integrity',
    whoWeSeek: 'Who we are looking for', whatMustKnow: 'Required skills', minTechnical: 'Minimum technical',
    intellectualCapacity: 'Intellectual capacity', finalists: 'finalists',
    workStyle: 'Work style', decisions: 'Decision making', teamwork: 'Teamwork',
    underPressure: 'Under pressure', communication: 'Communication',
    strengthsAndConsiderations: 'Strengths and considerations',
    whyGoodForRole: 'Why they are good for this role', toConsider: 'To consider',
    emotionalProfile: 'Emotional profile', balanced: 'Balanced', spontaneous: 'Spontaneous', reflective: 'Reflective',
    techTest: 'Technical test', passed: 'Passed', failed: 'Not passed', minRequired: 'Minimum required',
    available: 'available',
    allDimsLow: 'All dimensions at low risk',
    backToFinalists: '← Back to finalists',
  },
};

/* ── Animation hooks ── */

// Fade-in when element enters viewport
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect(); } }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

// Animated counter
function AnimatedNumber({ value, duration = 1200 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const { ref, inView } = useInView(0.3);
  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const step = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      setDisplay(Math.round(progress * value));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [inView, value, duration]);
  return <span ref={ref as any}>{display}</span>;
}

// Animated bar that grows from 0
function AnimatedBar({ width, color, height = 7, delay = 0 }: { width: number; color: string; height?: number; delay?: number }) {
  const { ref, inView } = useInView(0.2);
  return (
    <div ref={ref} style={{ height, background: '#eee', borderRadius: height / 2, overflow: 'hidden', flex: 1 }}>
      <div style={{ height: '100%', borderRadius: height / 2, background: color, width: inView ? `${width}%` : '0%', transition: `width 0.8s cubic-bezier(0.4,0,0.2,1) ${delay}ms` }} />
    </div>
  );
}

// FadeIn wrapper
function FadeIn({ children, delay = 0, direction = 'up' }: { children: React.ReactNode; delay?: number; direction?: 'up' | 'left' | 'right' }) {
  const { ref, inView } = useInView(0.1);
  const transforms: Record<string, string> = { up: 'translateY(30px)', left: 'translateX(-30px)', right: 'translateX(30px)' };
  return (
    <div ref={ref} style={{ opacity: inView ? 1 : 0, transform: inView ? 'none' : transforms[direction], transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms` }}>
      {children}
    </div>
  );
}

// Scroll progress bar
function ScrollProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(h > 0 ? (window.scrollY / h) * 100 : 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return <div style={{ position: 'fixed', top: 0, left: 0, height: 3, background: '#dafd6f', width: `${progress}%`, zIndex: 100, transition: 'width 0.1s linear' }} />;
}

const FONT_H1 = "'Ubuntu', sans-serif";
const FONT_H2 = "'Oswald', sans-serif";
const FONT_H3 = "'Oswald', sans-serif";
const FONT_BODY = "'Montserrat', sans-serif";

const DISC_COLORS: Record<string, string> = { D: '#e74c3c', I: '#f39c12', S: '#2ecc71', C: '#3498db' };
const DISC_NAMES_I18N: Record<string, Record<string, string>> = {
  es: { D: 'Dominancia', I: 'Influencia', S: 'Estabilidad', C: 'Cumplimiento' },
  en: { D: 'Dominance', I: 'Influence', S: 'Steadiness', C: 'Conscientiousness' },
};
const COG_LABELS_I18N: Record<string, Record<string, string>> = {
  es: { verbal: 'Verbal', espacial: 'Espacial', logica: 'Lógica', numerica: 'Numérica', abstracta: 'Abstracta' },
  en: { verbal: 'Verbal', espacial: 'Spatial', logica: 'Logic', numerica: 'Numerical', abstracta: 'Abstract' },
};
const INT_LABELS_I18N: Record<string, Record<string, string>> = {
  es: { autenticidad: 'Autenticidad', inteligencia_social: 'Inteligencia social', imparcialidad: 'Imparcialidad', sencillez: 'Sencillez', dominio_personal: 'Dominio personal', honestidad: 'Honestidad', hurto: 'Hurto', soborno: 'Soborno', alcohol: 'Alcohol', drogas: 'Drogas', confiabilidad: 'Confiabilidad', apuestas: 'Apuestas', etica_profesional: 'Ética profesional', personalidad: 'Personalidad', buena_impresion: 'Buena impresión' },
  en: { autenticidad: 'Authenticity', inteligencia_social: 'Social intelligence', imparcialidad: 'Impartiality', sencillez: 'Simplicity', dominio_personal: 'Self-control', honestidad: 'Honesty', hurto: 'Theft', soborno: 'Bribery', alcohol: 'Alcohol', drogas: 'Drugs', confiabilidad: 'Reliability', apuestas: 'Gambling', etica_profesional: 'Professional ethics', personalidad: 'Personality', buena_impresion: 'Social desirability' },
};
const COMP_LABELS_EN: Record<string, string> = {
  resolucion_problemas: 'Problem solving', adaptabilidad: 'Adaptability', comunicacion_digital: 'Digital communication',
  resiliencia: 'Resilience', planificacion: 'Planning', iniciativa: 'Initiative', orientacion_logro: 'Goal orientation',
  pensamiento_analitico: 'Analytical thinking', liderazgo: 'Leadership', trabajo_equipo: 'Teamwork',
  comunicacion: 'Communication', creatividad: 'Creativity', gestion_tiempo: 'Time management',
  toma_decisiones: 'Decision making', negociacion: 'Negotiation', orientacion_cliente: 'Customer orientation',
  pensamiento_critico: 'Critical thinking', inteligencia_emocional: 'Emotional intelligence',
  gestion_conflictos: 'Conflict management', aprendizaje_continuo: 'Continuous learning',
};

export default function ClientReport() {
  const { companySlug, jobSlug, reportId } = useParams<{ companySlug: string; jobSlug: string; reportId?: string }>();
  const [searchParams] = useSearchParams();
  const lang = (searchParams.get('lang') || 'es').toLowerCase() as 'es' | 'en';
  const t = LABELS[lang] || LABELS.es;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailIdx, setDetailIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!companySlug || !jobSlug) return;
    getPublicReport(companySlug, jobSlug, reportId, lang).then(setData).catch(() => setError(t.notFound)).finally(() => setLoading(false));
  }, [companySlug, jobSlug, reportId]);

  if (loading) return <div style={page}><p style={{ color: '#888', marginTop: 120, textAlign: 'center' }}>{t.loading}</p></div>;
  if (error) return <div style={page}><p style={{ color: '#e74c3c', marginTop: 120, textAlign: 'center' }}>{error}</p></div>;
  if (!data) return null;

  const COG_LABELS = COG_LABELS_I18N[lang] || COG_LABELS_I18N.es;
  const INT_LABELS = INT_LABELS_I18N[lang] || INT_LABELS_I18N.es;
  const { job, candidates, ideal_profile: ip, ideal_competencias: ic } = data;
  const today = new Date().toLocaleDateString('es-PA', { year: 'numeric', month: 'long' });
  const profileDesc = ip?.report_profile_desc || {};
  const hasB = !!ip?.disc_b;

  // Scroll to candidate
  const scrollToCandidate = (idx: number) => {
    const el = document.getElementById(`candidate-${idx}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Detail view with transition
  if (detailIdx !== null) {
    const c = candidates[detailIdx];
    return <DetailView c={c} job={job} ip={ip} ic={ic} idx={detailIdx} total={candidates.length} t={t} lang={lang} onBack={() => { setDetailIdx(null); setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50); }} />;
  }

  return (
    <div style={page}>
      <ScrollProgress />
      <style>{`
        .hover-card:hover { transform: translateY(-4px) !important; box-shadow: 0 8px 24px rgba(0,0,0,0.12) !important; }
        .float-nav-btn:hover { background: #dafd6f22 !important; }
      `}</style>

      {/* TOPBAR */}
      <div style={topbar}>
        <div><div style={logo}>SharkTalents.AI</div><div style={proceso}>{job.title} · {job.company}</div></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={empBadge}>{candidates.length} {t.finalists}</span>
          <div style={empAvatar}>{job.company.substring(0, 2).toUpperCase()}</div>
        </div>
      </div>

      {/* Floating candidate nav */}
      {candidates.length > 0 && (
        <div style={floatingNav}>
          {candidates.map((c: any, i: number) => (
            <button key={i} onClick={() => scrollToCandidate(i)} style={floatingNavBtn}>
              {c.name.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      <div style={content}>
        {/* PORTADA */}
        <FadeIn><div style={portada}>
          <div style={{ color: '#dafd6f', fontSize: 28, fontWeight: 700, marginBottom: 4, fontFamily: FONT_H1 }}>SharkTalents.AI</div>
          <div style={{ color: '#8899aa', fontSize: 13, marginBottom: 20, fontFamily: FONT_BODY }}>{t.aiSubtitle}</div>
          <div style={{ height: 0.5, background: '#dafd6f22', maxWidth: 200, margin: '0 auto 20px' }} />
          <h1 style={h1Style}>{job.title}</h1>
          <div style={{ color: '#aab', fontSize: 16, marginTop: 5, fontFamily: FONT_BODY }}>{job.company}</div>
          <div style={{ color: '#8899aa', fontSize: 13, marginTop: 14, fontFamily: FONT_BODY }}>{today}</div>
          <div style={portadaConf}>{t.confidentialTag}</div>
        </div></FadeIn>

        {/* QUÉ BUSCAMOS — 3 cards */}
        <FadeIn delay={200}><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
          {/* Card 1: {t.whoWeSeek} */}
          <div style={profileCard}>
            <h2 style={profileCardTitle}>{t.whoWeSeek}</h2>
            <div style={profileCardDivider} />
            {profileDesc.persona ? (
              profileDesc.persona.split('.').filter((s: string) => s.trim()).slice(0, 4).map((s: string, i: number) => (
                <div key={i} style={profileBullet}><span style={bulletDot} /><span>{s.trim()}</span></div>
              ))
            ) : (
              <div style={profileBullet}><span style={bulletDot} /><span>{lang === 'en' ? 'Results-oriented professional' : 'Persona orientada a resultados'}</span></div>
            )}
            {/* DISC ideal */}
            <div style={{ marginTop: 14 }}>
              {ip?.disc && (
                <div style={idealChip}>
                  <span style={{ color: '#dafd6f', fontWeight: 700 }}>{hasB ? 'Perfil A:' : 'DISC:'}</span>
                  <span style={{ color: '#fff' }}>D:{ip.disc.D} I:{ip.disc.I} S:{ip.disc.S} C:{ip.disc.C}</span>
                  {(() => { const pk = identifyPK(ip.disc); return pk ? <span style={{ color: '#8899aa', fontSize: 12 }}>{pk.id}</span> : null; })()}
                </div>
              )}
              {hasB && (
                <div style={{ ...idealChip, marginTop: 6 }}>
                  <span style={{ color: '#85b7eb', fontWeight: 700 }}>Perfil B:</span>
                  <span style={{ color: '#fff' }}>D:{ip.disc_b.D} I:{ip.disc_b.I} S:{ip.disc_b.S} C:{ip.disc_b.C}</span>
                  {(() => { const pk = identifyPK(ip.disc_b); return pk ? <span style={{ color: '#8899aa', fontSize: 12 }}>{pk.id}</span> : null; })()}
                </div>
              )}
            </div>
          </div>

          {/* Card 2: {t.whatMustKnow} */}
          <div style={profileCard}>
            <h2 style={profileCardTitle}>{t.whatMustKnow}</h2>
            <div style={profileCardDivider} />
            {ic && ic.length > 0 ? ic.map((comp: any, i: number) => (
              <div key={i} style={profileBullet}><span style={bulletDot} /><span>{lang === 'en' ? (COMP_LABELS_EN[comp.id] || comp.id.replace(/_/g, ' ')) : comp.id.replace(/_/g, ' ')}</span><span style={{ color: '#dafd6f', fontWeight: 700, marginLeft: 'auto', fontSize: 13 }}>{comp.nivel_esperado}</span></div>
            )) : null}
            {profileDesc.competencias && (
              <div style={{ color: '#8899aa', fontSize: 13, marginTop: 10, lineHeight: 1.5 }}>{profileDesc.competencias.split('.')[0]}.</div>
            )}
            <div style={{ marginTop: 12 }}>
              <div style={{ color: '#8899aa', fontSize: 12, marginBottom: 4 }}>{t.minTechnical}</div>
              <div style={{ color: '#dafd6f', fontSize: 22, fontWeight: 700 }}>{ip?.min_technical_score || 60}%</div>
            </div>
          </div>

          {/* Card 3: {t.intellectualCapacity} */}
          <div style={profileCard}>
            <h2 style={profileCardTitle}>{t.intellectualCapacity}</h2>
            <div style={profileCardDivider} />
            {ip?.cognitive && Object.entries(ip.cognitive).map(([dim, val]: [string, any]) => (
              <div key={dim} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: '#aab', width: 80, textTransform: 'capitalize' }}>{COG_LABELS[dim] || dim}</span>
                <div style={{ flex: 1, height: 5, background: '#ffffff15', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 3, background: '#85b7eb', width: `${val}%` }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', width: 28, textAlign: 'right' }}>{val}</span>
              </div>
            ))}
            {profileDesc.cognicion && (
              <div style={{ color: '#8899aa', fontSize: 13, marginTop: 10, lineHeight: 1.5 }}>{profileDesc.cognicion.split('.')[0]}.</div>
            )}
          </div>
        </div></FadeIn>

        {/* INTRO */}
        <FadeIn delay={300}><div style={darkCard}>
          <h2 style={{ color: '#fff', fontSize: 22, fontWeight: 700, marginBottom: 5, fontFamily: FONT_H2, margin: '0 0 5px' }}>{(t as any).finalistsReady}</h2>
          <div style={introSub}>{(t as any).finalistsDesc(candidates.length)}</div>
          <div style={introPill}>{t.nextStep}</div>
        </div></FadeIn>

        {/* SCORECARD */}
        <FadeIn delay={100}><div style={whiteCard}>
          <h2 style={{ padding: '16px 18px', fontSize: 20, fontWeight: 700, color: '#1a1a1a', borderBottom: '0.5px solid #e8e8e0', margin: 0, fontFamily: FONT_H2 }}>{t.comparison}</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead><tr>
                <th style={scTh}>{t.candidate}</th>
                <th style={scTh}>{t.affinity}</th>
                <th style={scTh}>{t.behavioral}</th>
                <th style={scTh}>{t.cognitive}</th>
                <th style={scTh}>{t.technical}</th>
                <th style={scTh}>{t.integrity}</th>
                <th style={scTh}>{t.emotion}</th>
              </tr></thead>
              <tbody>
                {candidates.map((c: any, i: number) => {
                  const a = c.analysis || {};
                  const emo = c.scores?.emotional;
                  const integ = c.scores?.integrity;
                  const scoreClass = a.overall_score >= 70 ? '#dafd6f' : a.overall_score >= 50 ? '#85b7eb' : '#aab';
                  const recLabel = a.overall_score >= 70 ? t.higherAff : a.overall_score >= 50 ? t.goodAff : t.modAff;
                  const recClass = a.overall_score >= 70 ? 'p-hi' : a.overall_score >= 50 ? 'p-mid' : 'p-lo';
                  const alertCount = integ?.dimensiones ? Object.values(integ.dimensiones).filter((d: any) => d.nivel !== 'bajo').length : 0;
                  return (
                    <tr key={i} style={{ borderBottom: '0.5px solid #e8e8e0' }}>
                      <td style={scTd}><div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div><div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>{c.scores?.technical ? `${c.scores.technical.score}% ${t.technical.toLowerCase()}` : ''}</div></td>
                      <td style={scTd}><div style={{ fontSize: 20, fontWeight: 700, color: scoreClass }}>{a.overall_score}%</div><span style={{ ...pill, ...(recClass === 'p-hi' ? pillHi : recClass === 'p-mid' ? pillMid : pillLo) }}>{recLabel}</span></td>
                      <td style={scTd}><div style={{ fontSize: 13, fontWeight: 600 }}>{a.disc_match}%</div><div style={miniBar}><div style={{ ...miniFill, width: `${a.disc_match}%` }} /></div></td>
                      <td style={scTd}><div style={{ fontSize: 13, fontWeight: 600 }}>{a.cognitive_match}%</div><div style={miniBar}><div style={{ ...miniFill, width: `${a.cognitive_match}%` }} /></div></td>
                      <td style={scTd}><div style={{ fontSize: 13, fontWeight: 600 }}>{a.technical_score}%</div><div style={miniBar}><div style={{ ...miniFill, width: `${a.technical_score}%` }} /></div></td>
                      <td style={scTd}>{alertCount === 0 ? <span style={{ color: '#2d6a1f', fontWeight: 600, fontSize: 12 }}>{t.noAlerts}</span> : <span style={{ color: '#7a4a0a', fontWeight: 600, fontSize: 12 }}>{alertCount} {t.observations}</span>}</td>
                      <td style={scTd}><span style={{ ...emoPill, ...(emo?.perfil === 'reflexivo' ? emoR : emoM) }}>{emo?.perfil === 'espontaneo' ? t.spontaneous : emo?.perfil === 'mesura' ? t.balanced : emo?.perfil === 'reflexivo' ? t.reflective : '—'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div></FadeIn>

        {/* CANDIDATE CARDS */}
        {candidates.map((c: any, ci: number) => {
          const a = c.analysis || {};
          const expl = c.explanations || {};
          const emo = c.scores?.emotional;
          const tech = c.scores?.technical;
          const integ = c.scores?.integrity;
          const scoreColor = a.overall_score >= 70 ? '#dafd6f' : a.overall_score >= 50 ? '#85b7eb' : '#aab';
          const rankLabel = a.overall_score >= 70 ? t.higherAffProfile : a.overall_score >= 50 ? t.goodAffProfile : t.modAffProfile;
          const rankClass = a.overall_score >= 70 ? rankBadgeHi : a.overall_score >= 50 ? rankBadgeMid : rankBadgeLo;

          return (
            <FadeIn key={ci} delay={ci * 150}><div id={`candidate-${ci}`} className="hover-card" style={hoverCard}>
              {/* Card top */}
              <div style={cardTop}>
                <div style={rankClass}>{rankLabel}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={avatar}>{c.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2)}</div>
                  <div style={{ flex: 1 }}>
                    <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 700, margin: 0, fontFamily: FONT_H2 }}>{c.name}</h2>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                      {c.salary_expectation && <span style={candidateChip}>${c.salary_expectation.toLocaleString()}{t.salary}</span>}
                      {c.availability && <span style={candidateChip}>{c.availability}</span>}
                      {c.age && <span style={candidateChip}>{c.age} {t.years}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}><div style={{ fontSize: 30, fontWeight: 700, color: scoreColor }}><AnimatedNumber value={a.overall_score} />%</div><div style={{ fontSize: 11, color: '#8899aa' }}>{t.affinityLabel}</div></div>
                </div>
              </div>

              <div style={{ padding: '20px 24px' }}>
                {/* Exec summary */}
                {expl.summary && <div style={execBox}><div style={{ fontSize: 15, color: '#2a2a2a', lineHeight: 1.7 }}>{expl.summary}</div></div>}

                {/* Match bars */}
                <div style={secTitle}>{(t as any).affinityWithProfile}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
                  {[
                    { label: t.behavioral, value: a.disc_match, color: '#dafd6f' },
                    { label: t.cognitive, value: a.cognitive_match, color: '#85b7eb' },
                    { label: t.technical, value: a.technical_score, color: '#5dcaa5' },
                    { label: t.integrity, value: a.integrity_score, color: '#f0997b' },
                    { label: t.emotion, value: a.emotion_score, color: '#ceb5f5' },
                  ].map((m, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 14, color: '#555', width: 100, flexShrink: 0 }}>{m.label}</span>
                      <AnimatedBar width={m.value} color={m.color} height={8} delay={i * 100} />
                      <span style={{ fontSize: 14, fontWeight: 700, width: 42, textAlign: 'right', color: m.value >= 70 ? '#2d6a1f' : m.value >= 50 ? '#7a4a0a' : '#8a2020' }}><AnimatedNumber value={m.value} />%</span>
                    </div>
                  ))}
                </div>

                {/* Work style */}
                {(expl.work_style_decisions || expl.disc) && (<>
                  <div style={secTitle}>{t.workStyle}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 22 }}>
                    {[
                      { l: t.decisions, t: expl.work_style_decisions || '' },
                      { l: t.teamwork, t: expl.work_style_team || '' },
                      { l: t.underPressure, t: expl.work_style_pressure || '' },
                      { l: t.communication, t: expl.work_style_communication || '' },
                    ].filter(w => w.t).map((w, i) => (
                      <div key={i} style={wsItem}><div style={wsLabel}>{w.l}</div><div style={{ fontSize: 14, color: '#2a2a2a', lineHeight: 1.5 }}>{w.t}</div></div>
                    ))}
                  </div>
                </>)}

                {/* Pros / Cons — use Claude's version if available, fallback to code */}
                <div style={secTitle}>{t.strengthsAndConsiderations}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 22 }}>
                  <div style={proBox}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1e5631', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 }}>{t.whyGoodForRole}</div>
                    {(expl.strengths ? expl.strengths.split('|').map((s: string) => s.trim()).filter(Boolean) : a.strengths || []).map((s: string, i: number) => <div key={i} style={proItem}>{s}</div>)}
                  </div>
                  <div style={conBox}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#5a3500', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 }}>{t.toConsider}</div>
                    {(() => {
                      const items = expl.weaknesses ? expl.weaknesses.split('|').map((s: string) => s.trim()).filter(Boolean) : a.weaknesses || [];
                      return items.length > 0 ? items.map((s: string, i: number) => <div key={i} style={conItem}>{s}</div>) : <div style={{ fontSize: 14, color: '#888' }}>Sin áreas críticas</div>;
                    })()}
                  </div>
                </div>

                {/* Integrity — simplified */}
                {integ && (<>
                  <div style={secTitle}>Integridad</div>
                  <div style={{ marginBottom: 22 }}>
                    {(() => {
                      const alertCount = Object.values(integ.dimensiones || {}).filter((d: any) => d.nivel !== 'bajo').length;
                      const alertDims = Object.entries(integ.dimensiones || {}).filter(([, d]: [string, any]) => d.nivel !== 'bajo').map(([dim]: [string, any]) => INT_LABELS[dim] || dim);
                      return alertCount === 0 ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 10, background: '#c3e6cb', border: '1px solid #8bc49a' }}>
                          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#1e7e34' }} />
                          <span style={{ fontSize: 15, fontWeight: 700, color: '#1e5631' }}>{t.noAlerts} — {t.allDimsLow}</span>
                        </div>
                      ) : (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 10, background: '#ffe0a0', border: '1px solid #e0c060' }}>
                          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#7a4a0a' }} />
                          <span style={{ fontSize: 15, fontWeight: 700, color: '#5a3500' }}>{alertCount} {t.observations}: {alertDims.join(', ')}</span>
                        </div>
                      );
                    })()}
                  </div>
                </>)}

                {/* Emotion — text only */}
                {emo && (<>
                  <div style={secTitle}>{t.emotionalProfile}</div>
                  <div style={{ marginBottom: 22, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ ...emoPillLarge, ...(emo.perfil === 'reflexivo' ? { background: '#e6f1fb', color: '#185fa5' } : emo.perfil === 'espontaneo' ? { background: '#fde8e8', color: '#8a2020' } : { background: '#fef9e7', color: '#7a4a0a' }) }}>
                      {emo.perfil === 'espontaneo' ? t.spontaneous : emo.perfil === 'mesura' ? t.balanced : t.reflective}
                    </span>
                    {expl.emotion && <span style={{ fontSize: 14, color: '#555', lineHeight: 1.5 }}>{expl.emotion}</span>}
                  </div>
                </>)}

                {/* Technical — simplified */}
                {tech && (<>
                  <div style={secTitle}>{t.techTest}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
                    <div style={{ fontSize: 36, fontWeight: 700, color: tech.passed ? '#2d6a1f' : '#8a2020', flexShrink: 0 }}>{tech.score}%</div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: tech.passed ? '#2d6a1f' : '#8a2020' }}>
                        {tech.passed ? t.passed : t.failed}
                      </div>
                      <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{t.minRequired}: {ip?.min_technical_score || 60}%</div>
                    </div>
                  </div>
                </>)}

                {/* Detail button */}
                <button onClick={() => setDetailIdx(ci)} style={btn} onMouseEnter={e => { (e.target as HTMLElement).style.background = '#1f283d'; (e.target as HTMLElement).style.color = '#dafd6f'; }} onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent'; (e.target as HTMLElement).style.color = '#1f283d'; }}>{t.fullProfile}</button>
              </div>
            </div></FadeIn>
          );
        })}

        {/* COMPARISON SECTION */}
        {data.comparison?.candidatas && data.comparison.candidatas.length > 0 && (
          <FadeIn delay={200}><div style={whiteCard}>
            <h2 style={{ padding: '16px 18px', fontSize: 20, fontWeight: 700, color: '#1a1a1a', borderBottom: '0.5px solid #e8e8e0', margin: 0, fontFamily: FONT_H2 }}>
              {t.interviewComparison}
            </h2>
            <div style={{ padding: '20px 24px' }}>
              {/* Comparison table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
                  <thead><tr>
                    <th style={{ ...scTh, width: 140 }}>Aspecto</th>
                    {data.comparison.candidatas.map((cc: any, i: number) => (
                      <th key={i} style={scTh}>{cc.nombre}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    <tr style={{ borderBottom: '0.5px solid #e8e8e0' }}>
                      <td style={{ ...scTd, fontWeight: 600, fontSize: 12, color: '#555' }}>{t.interviewResult}</td>
                      {data.comparison.candidatas.map((cc: any, i: number) => (
                        <td key={i} style={{ ...scTd, fontSize: 13, lineHeight: 1.6, color: '#2a2a2a' }}>{cc.resumen_entrevista || '—'}</td>
                      ))}
                    </tr>
                    <tr style={{ borderBottom: '0.5px solid #e8e8e0' }}>
                      <td style={{ ...scTd, fontWeight: 600, fontSize: 12, color: '#555' }}>{t.whatToExpect}</td>
                      {data.comparison.candidatas.map((cc: any, i: number) => (
                        <td key={i} style={{ ...scTd, fontSize: 13, lineHeight: 1.6, color: '#2a2a2a' }}>{cc.que_esperar || '—'}</td>
                      ))}
                    </tr>
                    <tr style={{ borderBottom: '0.5px solid #e8e8e0' }}>
                      <td style={{ ...scTd, fontWeight: 600, fontSize: 12, color: '#555' }}>{t.whatToDelegate}</td>
                      {data.comparison.candidatas.map((cc: any, i: number) => (
                        <td key={i} style={{ ...scTd, fontSize: 13, lineHeight: 1.6, color: '#2a2a2a' }}>{cc.en_que_soltarla || '—'}</td>
                      ))}
                    </tr>
                    <tr style={{ borderBottom: '0.5px solid #e8e8e0' }}>
                      <td style={{ ...scTd, fontWeight: 600, fontSize: 12, color: '#555' }}>{t.whatToTeach}</td>
                      {data.comparison.candidatas.map((cc: any, i: number) => (
                        <td key={i} style={{ ...scTd, fontSize: 13, lineHeight: 1.6, color: '#2a2a2a' }}>{cc.en_que_ensenarle || '—'}</td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ ...scTd, fontWeight: 600, fontSize: 12, color: '#555' }}>{t.mainRisk}</td>
                      {data.comparison.candidatas.map((cc: any, i: number) => (
                        <td key={i} style={{ ...scTd, fontSize: 13, lineHeight: 1.6, color: '#c0392b' }}>{cc.riesgo_principal || '—'}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Conclusion */}
              {data.comparison.conclusion && (
                <div style={{ marginTop: 24, padding: 20, background: '#f8f9fa', borderRadius: 8, border: '1px solid #e8e8e0' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginBottom: 14, fontFamily: FONT_H2 }}>{t.analysisConclusion}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                    {data.comparison.conclusion.si_prioridad_autonomia && (
                      <div style={conclusionCard}><div style={conclusionLabel}>{t.ifAutonomy}</div><div style={conclusionValue}>{data.comparison.conclusion.si_prioridad_autonomia}</div></div>
                    )}
                    {data.comparison.conclusion.si_prioridad_crecimiento && (
                      <div style={conclusionCard}><div style={conclusionLabel}>{t.ifGrowth}</div><div style={conclusionValue}>{data.comparison.conclusion.si_prioridad_crecimiento}</div></div>
                    )}
                    {data.comparison.conclusion.menor_riesgo && (
                      <div style={conclusionCard}><div style={conclusionLabel}>{t.leastRisk}</div><div style={conclusionValue}>{data.comparison.conclusion.menor_riesgo}</div></div>
                    )}
                    {data.comparison.conclusion.mayor_potencial && (
                      <div style={conclusionCard}><div style={conclusionLabel}>{t.mostPotential}</div><div style={conclusionValue}>{data.comparison.conclusion.mayor_potencial}</div></div>
                    )}
                  </div>
                  {data.comparison.conclusion.recomendacion_final && (
                    <div style={{ padding: '14px 18px', background: '#1f283d', borderRadius: 8, color: '#dafd6f', fontSize: 14, lineHeight: 1.7, fontWeight: 500 }}>
                      {data.comparison.conclusion.recomendacion_final}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div></FadeIn>
        )}

        {/* FOOTER */}
        <div style={{ ...darkCard, textAlign: 'center', marginTop: 20 }}>
          <div style={{ color: '#dafd6f', fontSize: 16, fontWeight: 700 }}>SharkTalents.AI</div>
          <div style={{ color: '#8899aa', fontSize: 12, marginTop: 4 }}>{t.aiSubtitle}</div>
          <div style={{ color: '#515f61', fontSize: 11, marginTop: 6 }}>{t.confidential} {job.company}</div>
        </div>
      </div>
    </div>
  );
}

/* ── DETAIL VIEW ── */
function DetailView({ c, job, ip, ic, idx, total, t, lang, onBack }: { c: any; job: any; ip: any; ic: any; idx: number; total: number; t: Record<string, any>; lang: string; onBack: () => void }) {
  const COG_LABELS = COG_LABELS_I18N[lang] || COG_LABELS_I18N.es;
  const INT_LABELS = INT_LABELS_I18N[lang] || INT_LABELS_I18N.es;
  const a = c.analysis || {};
  const expl = c.explanations || {};
  const disc = c.scores?.disc;
  const normDisc = disc ? normalizeDisc(disc) : null;
  const pk = normDisc ? identifyPK(normDisc) : null;
  const cog = c.scores?.cognitive;
  const maxPerDim = cog?.max ? Math.max(1, Math.round(cog.max / 5)) : 20;
  const emo = c.scores?.emotional;
  const integ = c.scores?.integrity;
  const tech = c.scores?.technical;
  const scoreColor = a.overall_score >= 70 ? '#dafd6f' : a.overall_score >= 50 ? '#85b7eb' : '#aab';
  const devItems = (expl.development_plan || '').split('|').map((s: string) => s.trim()).filter((s: string) => s);

  return (
    <div style={page}>
      <div style={topbar}>
        <div><div style={logo}>SharkTalents.AI</div><div style={proceso}>Perfil completo del candidato</div></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={empBadge}>{job.company}</span></div>
      </div>
      <div style={content}>
        <button onClick={onBack} style={backBtn}>{t.backToFinalists || '← Volver a los finalistas'}</button>

        {/* Hero */}
        <div style={darkCard}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <div style={avatar}>{c.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2)}</div>
            <div style={{ flex: 1 }}>
              <h2 style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: 0, fontFamily: FONT_H2 }}>{c.name}</h2>
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                {c.salary_expectation && <span style={candidateChip}>${c.salary_expectation.toLocaleString()}{t.salary}</span>}
                {c.availability && <span style={candidateChip}>{c.availability}</span>}
                {c.age && <span style={candidateChip}>{c.age} {t.years}</span>}
                <span style={{ ...candidateChip, opacity: 0.6 }}>Candidato {idx + 1} de {total}</span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}><div style={{ fontSize: 34, fontWeight: 700, color: scoreColor }}>{a.overall_score}%</div><div style={{ fontSize: 11, color: '#8899aa' }}>{t.affinityLabel}</div></div>
          </div>
          {expl.summary && (
            <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8899aa', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.4 }}>Resumen</div>
              <div style={{ fontSize: 14, color: '#dde', lineHeight: 1.7 }}>{expl.summary}</div>
            </div>
          )}
        </div>

        {/* Cognitive detail */}
        {cog && (
          <div style={detailCard}>
            <h3 style={detailSec}>Capacidad cognitiva</h3>
            {['verbal', 'espacial', 'logica', 'numerica', 'abstracta'].map(dim => {
              const pct = Math.min(100, Math.round(((cog[dim] || 0) / maxPerDim) * 100));
              return (
                <div key={dim} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, color: '#555', width: 140, flexShrink: 0 }}>{COG_LABELS[dim]}</span>
                  <div style={{ flex: 1, height: 6, background: '#eee', borderRadius: 3, overflow: 'hidden' }}><div style={{ height: '100%', borderRadius: 3, background: '#1f283d', width: `${pct}%` }} /></div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', width: 30, textAlign: 'right' }}>{pct}</span>
                </div>
              );
            })}
            {expl.velna && <div style={{ fontSize: 14, color: '#666', marginTop: 10, lineHeight: 1.6 }}>{expl.velna}</div>}
          </div>
        )}

        {/* DISC */}
        {normDisc && (
          <div style={detailCard}>
            <h3 style={detailSec}>Perfil conductual (DISC)</h3>
            <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
              {(['D', 'I', 'S', 'C'] as const).map(d => (
                <div key={d} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: DISC_COLORS[d] }}>{d}</div>
                  <div style={{ height: 70, background: '#f3f4f6', borderRadius: 6, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden', marginTop: 4 }}>
                    <div style={{ width: '55%', height: `${normDisc[d]}%`, background: DISC_COLORS[d], borderRadius: '4px 4px 0 0', opacity: 0.8, minHeight: 2 }} />
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: DISC_COLORS[d], marginTop: 4 }}>{normDisc[d]}</div>
                </div>
              ))}
            </div>
            {pk && (<>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1f283d', marginBottom: 6, fontFamily: FONT_H3 }}>{pk.id}: {pk.name}</div>
              <div style={{ fontSize: 14, color: '#444', lineHeight: 1.7, marginBottom: 10 }}>{pk.description}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {pk.traits.map((t, i) => (
                  <span key={i} style={{ background: '#eef0ec', border: '0.5px solid #d0d0c8', borderRadius: 20, padding: '4px 12px', fontSize: 13, color: '#333' }}>{t}</span>
                ))}
              </div>
            </>)}
          </div>
        )}

        {/* Emotional */}
        {emo && (
          <div style={detailCard}>
            <h3 style={detailSec}>{t.emotionalProfile}</h3>
            <div style={{ position: 'relative', height: 14, marginBottom: 2 }}>
              <div style={{ position: 'absolute', top: 1, left: `${emo.score}%`, transform: 'translateX(-50%)', width: 14, height: 14, borderRadius: '50%', background: '#1f283d', border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
            </div>
            <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 6 }}>
              <div style={{ background: '#f09595', flex: '0 0 30%' }} /><div style={{ background: '#dafd6f', flex: '0 0 40%' }} /><div style={{ background: '#85b7eb', flex: '0 0 30%' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#888', marginBottom: 10 }}><span>Espontáneo</span><span>Equilibrado</span><span>Reflexivo</span></div>
            {expl.emotion && <div style={{ fontSize: 14, color: '#555', lineHeight: 1.6 }}>{expl.emotion}</div>}
          </div>
        )}

        {/* Integrity detail — 3 cards by level */}
        {integ && (() => {
          const dims = Object.entries(integ.dimensiones || {});
          const bajo = dims.filter(([, d]: [string, any]) => d.nivel === 'bajo');
          const medio = dims.filter(([, d]: [string, any]) => d.nivel === 'medio');
          const alto = dims.filter(([, d]: [string, any]) => d.nivel === 'alto');
          return (
            <div style={detailCard}>
              <h3 style={detailSec}>Integridad — 9 dimensiones</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
                {/* Bajo = OK */}
                <div style={{ background: '#d4edda', borderRadius: 10, padding: '14px 16px', border: '1px solid #a3d5b3' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#1e7e34' }} />
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#1e5631', fontFamily: FONT_H3 }}>Sin riesgo</span>
                  </div>
                  {bajo.length > 0 ? bajo.map(([dim]: [string, any]) => (
                    <div key={dim} style={{ fontSize: 13, color: '#1a4a1a', marginBottom: 4, paddingLeft: 6 }}>
                      {INT_LABELS[dim] || dim}
                    </div>
                  )) : <div style={{ fontSize: 13, color: '#5a8a5a', fontStyle: 'italic' }}>Ninguna</div>}
                </div>
                {/* Medio = Observación */}
                <div style={{ background: '#fff3cd', borderRadius: 10, padding: '14px 16px', border: '1px solid #f0d080' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#7a4a0a' }} />
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#5a3500', fontFamily: FONT_H3 }}>Observación</span>
                  </div>
                  {medio.length > 0 ? medio.map(([dim]: [string, any]) => (
                    <div key={dim} style={{ fontSize: 13, color: '#4a3010', marginBottom: 4, paddingLeft: 6, fontWeight: 600 }}>
                      {INT_LABELS[dim] || dim}
                    </div>
                  )) : <div style={{ fontSize: 13, color: '#8a7a50', fontStyle: 'italic' }}>Ninguna</div>}
                </div>
                {/* Alto = Alerta */}
                <div style={{ background: '#f8d7da', borderRadius: 10, padding: '14px 16px', border: '1px solid #e0a0a8' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#8a2020' }} />
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#721c24', fontFamily: FONT_H3 }}>Alerta</span>
                  </div>
                  {alto.length > 0 ? alto.map(([dim]: [string, any]) => (
                    <div key={dim} style={{ fontSize: 13, color: '#5a1015', marginBottom: 4, paddingLeft: 6, fontWeight: 700 }}>
                      {INT_LABELS[dim] || dim}
                    </div>
                  )) : <div style={{ fontSize: 13, color: '#8a5a5a', fontStyle: 'italic' }}>Ninguna</div>}
                </div>
              </div>
              {expl.integrity && <div style={{ fontSize: 14, color: '#555', lineHeight: 1.6 }}>{expl.integrity}</div>}
            </div>
          );
        })()}

        {/* Technical */}
        {tech && (
          <div style={detailCard}>
            <h3 style={detailSec}>{t.techTest}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: 36, fontWeight: 700, color: tech.passed ? '#2d6a1f' : '#8a2020' }}>{tech.score}%</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: tech.passed ? '#2d6a1f' : '#8a2020' }}>{tech.passed ? t.passed : t.failed}</div>
                <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{t.minRequired}: {ip?.min_technical_score || 60}%</div>
                <div style={{ height: 8, background: '#eee', borderRadius: 4, overflow: 'hidden', marginTop: 8, position: 'relative' }}>
                  <div style={{ height: '100%', borderRadius: 4, background: '#5dcaa5', width: `${tech.score}%` }} />
                  <div style={{ position: 'absolute', top: 0, height: '100%', width: 2, background: '#1f283d', opacity: 0.7, left: `${ip?.min_technical_score || 60}%` }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Competencias */}
        {ic && ic.length > 0 && c.scores?.competencias && (
          <div style={detailCard}>
            <h3 style={detailSec}>Competencias del puesto</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {ic.map((idealComp: any) => {
                const candComp = c.scores.competencias.find((cc: any) => cc.id === idealComp.id);
                const score = candComp?.score ?? 0;
                const expected = idealComp.nivel_esperado || 60;
                const diff = score - expected;
                const diffColor = diff >= 0 ? '#2d6a1f' : diff >= -15 ? '#7a4a0a' : '#8a2020';
                const barColor = score >= expected ? '#5dcaa5' : score >= expected - 15 ? '#f0c060' : '#e07070';
                return (
                  <div key={idealComp.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{candComp?.nombre || idealComp.id.replace(/_/g, ' ')}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 12, color: '#888' }}>Esperado: {expected}</span>
                        <span style={{ fontSize: 15, fontWeight: 700, color: diffColor }}>{score}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: diffColor }}>{diff >= 0 ? `+${diff}` : diff}</span>
                      </div>
                    </div>
                    <div style={{ position: 'relative', height: 8, background: '#eee', borderRadius: 4, overflow: 'visible' }}>
                      <div style={{ height: '100%', borderRadius: 4, background: barColor, width: `${Math.min(100, score)}%` }} />
                      <div style={{ position: 'absolute', top: -2, left: `${Math.min(100, expected)}%`, transform: 'translateX(-50%)', width: 3, height: 12, background: '#1f283d', borderRadius: 1, opacity: 0.6 }} />
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Top non-ideal competencias */}
            {(() => {
              const topOthers = (c.scores.competencias || [])
                .filter((cc: any) => cc.score > 70 && !ic.find((i: any) => i.id === cc.id))
                .sort((a: any, b: any) => b.score - a.score)
                .slice(0, 5);
              if (topOthers.length === 0) return null;
              return (
                <div style={{ marginTop: 16, padding: '12px 16px', background: '#f8f8f5', borderRadius: 8, border: '0.5px solid #e8e8e0' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 }}>También destaca en</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {topOthers.map((cc: any) => (
                      <span key={cc.id} style={{ background: '#eef0ec', border: '0.5px solid #d0d0c8', borderRadius: 20, padding: '4px 12px', fontSize: 12, color: '#333' }}>{cc.nombre}</span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Development plan */}
        {devItems.length > 0 && (
          <div style={detailCard}>
            <h3 style={detailSec}>Plan de incorporación</h3>
            {devItems.map((d: string, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#1f283d', color: '#dafd6f', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                <div style={{ fontSize: 14, color: '#2a2a2a', lineHeight: 1.6 }}>{d}</div>
              </div>
            ))}
          </div>
        )}

        {/* References */}
        {c.references?.length > 0 && (
          <div style={detailCard}>
            <h3 style={detailSec}>Referencias</h3>
            {c.references.map((ref: any, i: number) => (
              <div key={i} style={{ background: '#f8f8f5', borderRadius: 8, padding: '14px 16px', marginBottom: 10, border: '0.5px solid #e0e0d8' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>{ref.name}</div>
                <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{ref.role} — {ref.company}</div>
                {ref.comments && <div style={{ fontSize: 14, color: '#2a2a2a', marginTop: 10, lineHeight: 1.6, fontStyle: 'italic', borderTop: '0.5px solid #e8e8e0', paddingTop: 10 }}>"{ref.comments}"</div>}
              </div>
            ))}
          </div>
        )}

        {/* Post-interview Analysis */}
        {expl.transcript_analysis && (
          <div style={detailCard}>
            <h3 style={detailSec}>{t.interviewResult}</h3>
            {expl.transcript_analysis.resumen && <div style={{ fontSize: 14, color: '#333', lineHeight: 1.7, marginBottom: 14 }}>{expl.transcript_analysis.resumen}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              {expl.transcript_analysis.puntos_fuertes && (
                <div style={{ background: '#d4edda', borderRadius: 8, padding: '12px 14px', border: '1px solid #a3d5b3' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1e5631', marginBottom: 6, textTransform: 'uppercase' }}>Puntos fuertes</div>
                  {expl.transcript_analysis.puntos_fuertes.split('|').map((p: string, i: number) => (
                    <div key={i} style={{ fontSize: 13, color: '#1a4a1a', marginBottom: 4, lineHeight: 1.5 }}>+ {p.trim()}</div>
                  ))}
                </div>
              )}
              {expl.transcript_analysis.puntos_debiles && (
                <div style={{ background: '#fff3cd', borderRadius: 8, padding: '12px 14px', border: '1px solid #f0d080' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#5a3500', marginBottom: 6, textTransform: 'uppercase' }}>Puntos débiles</div>
                  {expl.transcript_analysis.puntos_debiles.split('|').map((p: string, i: number) => (
                    <div key={i} style={{ fontSize: 13, color: '#4a3010', marginBottom: 4, lineHeight: 1.5 }}>! {p.trim()}</div>
                  ))}
                </div>
              )}
            </div>
            {expl.transcript_analysis.alertas_resueltas && (
              <div style={{ fontSize: 13, color: '#555', lineHeight: 1.6, marginBottom: 12 }}><strong>Alertas:</strong> {expl.transcript_analysis.alertas_resueltas}</div>
            )}
            {expl.transcript_analysis.recomendacion_final && (
              <div style={{ padding: '12px 16px', background: '#eef0ec', borderRadius: 8, border: '0.5px solid #d0d0c8' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1f283d', marginBottom: 4, textTransform: 'uppercase' }}>Recomendación final</div>
                <div style={{ fontSize: 15, color: '#1a1a1a', lineHeight: 1.6, fontWeight: 500 }}>{expl.transcript_analysis.recomendacion_final}</div>
              </div>
            )}
          </div>
        )}

        {/* Interview Questions */}
        {(() => {
          const iq = expl.interview_questions || [];
          if (iq.length === 0) return null;
          return (
            <div style={detailCard}>
              <h3 style={detailSec}>Preguntas sugeridas para la entrevista</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {iq.map((q: any, i: number) => (
                  <div key={i} style={{ border: '0.5px solid #e8e8e0', borderRadius: 8, padding: '14px 16px', background: '#fff' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#9b59b6', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 }}>Pregunta {i + 1}</div>
                    <div style={{ fontSize: 15, color: '#1a1a1a', lineHeight: 1.6, marginBottom: 8, fontWeight: 500 }}>{q.question}</div>
                    <div style={{ fontSize: 13, color: '#888', fontStyle: 'italic', borderTop: '0.5px solid #eee', paddingTop: 6 }}>{q.why}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Technical Q&A */}
        {c.answers?.technical?.length > 0 && (
          <QASection title="Preguntas y respuestas — Técnica" items={c.answers.technical.map((q: any, i: number) => ({
            num: i + 1,
            text: q.text,
            options: q.options,
            selected: q.selected,
            correct: q.correct,
            showCorrect: true,
          }))} />
        )}

        {/* Integrity Q&A */}
        {c.answers?.integrity?.length > 0 && (
          <QASection title="Preguntas y respuestas — Integridad" items={c.answers.integrity.map((q: any, i: number) => ({
            num: i + 1,
            text: q.text,
            options: q.options,
            selected: q.selected,
            riskWeights: q.risk_weights,
            dimension: q.dimension,
          }))} />
        )}

        {/* Footer */}
        <div style={{ ...darkCard, textAlign: 'center', marginTop: 20 }}>
          <div style={{ color: '#dafd6f', fontSize: 16, fontWeight: 700, fontFamily: FONT_H1 }}>SharkTalents.AI</div>
          <div style={{ color: '#8899aa', fontSize: 12, marginTop: 4 }}>{t.aiSubtitle}</div>
          <div style={{ color: '#515f61', fontSize: 11, marginTop: 6 }}>{t.confidential} {job.company}</div>
        </div>
      </div>
    </div>
  );
}

/* ── STYLES ── */
/* ── Q&A Section ── */
function QASection({ title, items }: { title: string; items: any[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={detailCard}>
      <div onClick={() => setOpen(!open)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1f283d', margin: 0, fontFamily: FONT_H3 }}>{title}</h3>
        <span style={{ fontSize: 18, color: '#9b59b6', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0)' }}>▾</span>
      </div>
      {open && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((item: any, i: number) => (
            <div key={i} style={{ border: '0.5px solid #e8e8e0', borderRadius: 8, padding: '12px 14px', background: '#fff' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                Pregunta {item.num}{item.dimension ? ` — ${item.dimension.replace(/_/g, ' ')}` : ''}
              </div>
              <div style={{ fontSize: 14, color: '#1a1a1a', lineHeight: 1.6, marginBottom: 10 }}>{item.text}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(item.options || []).map((opt: string, oi: number) => {
                  const isSelected = item.selected === oi;
                  const isCorrect = item.showCorrect && item.correct === oi;
                  const riskLevel = item.riskWeights ? item.riskWeights[oi] : null;
                  let bg = '#f8f8f5';
                  let border = '0.5px solid #e8e8e0';
                  let textColor = '#555';
                  if (isSelected && item.showCorrect) {
                    bg = isCorrect ? '#d4edda' : '#f8d7da';
                    border = isCorrect ? '1px solid #a3d5b3' : '1px solid #e0a0a8';
                    textColor = isCorrect ? '#1e5631' : '#721c24';
                  } else if (isSelected && riskLevel != null) {
                    bg = riskLevel === 0 ? '#d4edda' : riskLevel === 1 ? '#e8f5e9' : riskLevel === 2 ? '#fff3cd' : '#f8d7da';
                    border = riskLevel === 0 ? '1px solid #a3d5b3' : riskLevel === 1 ? '1px solid #c8e6c9' : riskLevel === 2 ? '1px solid #f0d080' : '1px solid #e0a0a8';
                    textColor = riskLevel === 0 ? '#1e5631' : riskLevel === 1 ? '#2e7d32' : riskLevel === 2 ? '#5a3500' : '#721c24';
                  } else if (isCorrect && item.showCorrect) {
                    border = '1px solid #a3d5b3';
                  }
                  return (
                    <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, background: bg, border, fontSize: 13, color: textColor }}>
                      <span style={{ fontWeight: 700, width: 18, flexShrink: 0 }}>{String.fromCharCode(65 + oi)}</span>
                      <span style={{ flex: 1 }}>{opt}</span>
                      {isSelected && <span style={{ fontSize: 11, fontWeight: 700 }}>← Respuesta</span>}
                      {isCorrect && item.showCorrect && !isSelected && <span style={{ fontSize: 11, color: '#1e7e34' }}>✓ Correcta</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const page: CSSProperties = { minHeight: '100vh', background: '#515f61', fontFamily: FONT_BODY, color: '#1a1a1a' };
const h1Style: CSSProperties = { color: '#fff', fontSize: 36, fontWeight: 700, fontFamily: FONT_H1, textTransform: 'uppercase', letterSpacing: 1, margin: 0 };
const topbar: CSSProperties = { background: '#1f283d', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 };
const logo: CSSProperties = { color: '#dafd6f', fontSize: 18, fontWeight: 700, letterSpacing: 0.3, fontFamily: FONT_H1 };
const proceso: CSSProperties = { color: '#8899aa', fontSize: 12, marginTop: 1 };
const content: CSSProperties = { padding: '24px 40px', maxWidth: 1050, margin: '0 auto' };
const empBadge: CSSProperties = { background: '#dafd6f18', border: '0.5px solid #dafd6f44', color: '#dafd6f', fontSize: 12, padding: '5px 14px', borderRadius: 20 };
const empAvatar: CSSProperties = { width: 32, height: 32, borderRadius: '50%', background: '#dafd6f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#1f283d' };
const darkCard: CSSProperties = { background: '#1f283d', borderRadius: 12, padding: '20px 22px', marginBottom: 20 };
const whiteCard: CSSProperties = { background: '#fff', border: '0.5px solid #e0e0d8', borderRadius: 12, overflow: 'hidden', marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };
const portada: CSSProperties = { background: '#1f283d', borderRadius: 12, padding: '32px 24px', marginBottom: 20, textAlign: 'center' };
const portadaConf: CSSProperties = { display: 'inline-block', background: '#dafd6f18', border: '0.5px solid #dafd6f44', color: '#dafd6f', fontSize: 11, padding: '3px 14px', borderRadius: 20, marginTop: 10, letterSpacing: 0.5, textTransform: 'uppercase' };
const introSub: CSSProperties = { color: '#8899aa', fontSize: 14, lineHeight: 1.7, marginBottom: 6 };
const introPill: CSSProperties = { display: 'inline-block', background: '#dafd6f18', border: '0.5px solid #dafd6f33', borderRadius: 20, padding: '6px 16px', marginTop: 12, color: '#dafd6f', fontSize: 13 };
const profileCard: CSSProperties = { background: '#1f283d', borderRadius: 12, padding: '22px 20px', display: 'flex', flexDirection: 'column' };
const profileCardTitle: CSSProperties = { color: '#dafd6f', fontSize: 20, fontWeight: 700, marginBottom: 4, fontFamily: FONT_H2, margin: '0 0 4px' };
const profileCardDivider: CSSProperties = { height: 2, background: '#dafd6f33', borderRadius: 1, marginBottom: 14 };
const profileBullet: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, fontSize: 14, color: '#dde', lineHeight: 1.5 };
const bulletDot: CSSProperties = { width: 5, height: 5, borderRadius: '50%', background: '#dafd6f', flexShrink: 0 };
const idealChip: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, background: '#ffffff08', border: '0.5px solid #ffffff15', borderRadius: 8, padding: '6px 12px', fontSize: 13 };
const scTh: CSSProperties = { padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#888', textAlign: 'left', textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '0.5px solid #e8e8e0', background: '#f8f8f5' };
const scTd: CSSProperties = { padding: '12px 14px', fontSize: 13, verticalAlign: 'middle' };
const conclusionCard: CSSProperties = { padding: '12px 16px', background: '#fff', borderRadius: 6, border: '1px solid #e8e8e0' };
const conclusionLabel: CSSProperties = { fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 };
const conclusionValue: CSSProperties = { fontSize: 13, color: '#2a2a2a', lineHeight: 1.6 };
const pill: CSSProperties = { display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, marginTop: 3 };
const pillHi: CSSProperties = { background: '#1a3320', color: '#5dcaa5' };
const pillMid: CSSProperties = { background: '#332a14', color: '#fac775' };
const pillLo: CSSProperties = { background: '#2a2a2a', color: '#aaa' };
const miniBar: CSSProperties = { height: 4, borderRadius: 2, background: '#eee', overflow: 'hidden', width: 70, marginTop: 3 };
const miniFill: CSSProperties = { height: '100%', borderRadius: 2, background: '#1f283d' };
const emoPill: CSSProperties = { display: 'inline-block', padding: '3px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500 };
const emoR: CSSProperties = { background: '#e6f1fb', color: '#185fa5' };
const emoM: CSSProperties = { background: '#fef9e7', color: '#7a4a0a' };
const candidateChip: CSSProperties = { background: '#dafd6f18', border: '0.5px solid #dafd6f44', color: '#dafd6f', fontSize: 12, padding: '3px 10px', borderRadius: 20, fontWeight: 500 };
const floatingNav: CSSProperties = { position: 'fixed', right: 20, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 6, zIndex: 50, background: '#1f283ddd', borderRadius: 12, padding: '10px 8px', backdropFilter: 'blur(8px)' };
const floatingNavBtn: CSSProperties = { background: 'transparent', border: 'none', color: '#dafd6f', fontSize: 11, fontWeight: 600, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: FONT_BODY, textAlign: 'left' };
const hoverCard: CSSProperties = { ...whiteCard, transition: 'transform 0.2s ease, box-shadow 0.2s ease', cursor: 'default' };
const cardTop: CSSProperties = { background: '#1f283d', padding: '16px 20px' };
const avatar: CSSProperties = { width: 44, height: 44, borderRadius: '50%', background: '#dafd6f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: '#1f283d', flexShrink: 0 };
const rankBadgeBase: CSSProperties = { display: 'inline-flex', borderRadius: 20, padding: '3px 12px', fontSize: 11, fontWeight: 600, marginBottom: 10, letterSpacing: 0.2 };
const rankBadgeHi: CSSProperties = { ...rankBadgeBase, background: '#dafd6f33', color: '#dafd6f', border: '0.5px solid #dafd6f55' };
const rankBadgeMid: CSSProperties = { ...rankBadgeBase, background: '#85b7eb22', color: '#85b7eb', border: '0.5px solid #85b7eb44' };
const rankBadgeLo: CSSProperties = { ...rankBadgeBase, background: '#aab2', color: '#ccc', border: '0.5px solid #aab4' };
const execBox: CSSProperties = { background: '#f8f8f5', borderRadius: 8, padding: '14px 16px', marginBottom: 18, borderLeft: '3px solid #dafd6f' };
const sec: CSSProperties = { fontSize: 13, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, margin: '18px 0 10px', paddingBottom: 7, borderBottom: '0.5px solid #e8e8e0' };
const secTitle: CSSProperties = { fontSize: 18, fontWeight: 700, color: '#1f283d', margin: '20px 0 12px', paddingBottom: 8, borderBottom: '2px solid #dafd6f', fontFamily: FONT_H3 };
const emoPillLarge: CSSProperties = { display: 'inline-block', padding: '6px 16px', borderRadius: 20, fontSize: 14, fontWeight: 600, flexShrink: 0 };
const wsItem: CSSProperties = { background: '#eef0ec', borderRadius: 8, padding: '12px 14px', border: '0.5px solid #d8d8d0' };
const wsLabel: CSSProperties = { fontSize: 12, fontWeight: 700, color: '#1f283d', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3, fontFamily: FONT_H3 };
const proBox: CSSProperties = { background: '#d4edda', borderRadius: 8, padding: '14px 16px', border: '1px solid #a3d5b3' };
const conBox: CSSProperties = { background: '#fff3cd', borderRadius: 8, padding: '14px 16px', border: '1px solid #f0d080' };
const proItem: CSSProperties = { fontSize: 13, marginBottom: 4, paddingLeft: 11, position: 'relative', lineHeight: 1.5, color: '#1a4a1a' };
const conItem: CSSProperties = { fontSize: 13, marginBottom: 4, paddingLeft: 11, position: 'relative', lineHeight: 1.5, color: '#4a3010' };
const integItem: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: '#f8f8f5', borderRadius: 7, border: '0.5px solid #e8e8e0' };
const btn: CSSProperties = { width: '100%', padding: '12px', borderRadius: 8, border: '1px solid #1f283d', background: 'transparent', color: '#1f283d', fontSize: 13, cursor: 'pointer', marginTop: 12, fontWeight: 600, letterSpacing: 0.2 };
const backBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#555', cursor: 'pointer', marginBottom: 18, padding: '7px 14px', borderRadius: 8, border: '0.5px solid #e0e0d8', background: '#fff', fontWeight: 500 };
const detailCard: CSSProperties = { background: '#fff', border: '0.5px solid #e0e0d8', borderRadius: 12, padding: '20px 22px', marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };
const detailSec: CSSProperties = { fontSize: 18, fontWeight: 700, color: '#1f283d', letterSpacing: 0.3, margin: '0 0 14px', paddingBottom: 8, borderBottom: '2px solid #dafd6f', fontFamily: FONT_H3 };
