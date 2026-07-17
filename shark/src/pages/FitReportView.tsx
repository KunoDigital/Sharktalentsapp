import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { config } from '../config';
import { calculateCompetencias } from '../data/competencias';
import { INTEGRIDAD_DIMENSIONES } from '../data/integridadDescriptions';

// Mapea key técnica del backend ('autenticidad', 'hurto', ...) al label friendly
// que el cliente puede leer ('Autenticidad', 'Hurto', ...). buena_impresion no
// se muestra en las columnas — es un indicador de validez del test.
const DIMENSION_LABEL: Record<string, string> = Object.fromEntries(
  INTEGRIDAD_DIMENSIONES.map((d) => [d.key, d.label]),
);
function labelForDimension(key: string): string {
  return DIMENSION_LABEL[key] ?? key;
}

// Página pública del fit report — la que el cliente abre desde el email.
// Diseño calzado 1:1 con mockup-reporte-completo-fit-psicometrico.html:
// paleta Navy #1B2438 + Lima #D6F26B + Crema #F0F0EC, fuentes Ubuntu + Oswald,
// portada con ring de fit_pct, secciones veredicto/matches/como es/fit cultural/
// como aprovechar + parte 2 con DISC bars, VELNA rows, top 10 competencias, y
// ejes de integridad en 3 columnas de riesgo.

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

type IntegrityDim = { dimension: string; nivel: 'bajo' | 'medio' | 'alto'; pct: number };

type Scores = {
  disc: { d: number | null; i: number | null; s: number | null; c: number | null; perfil_dominante: string | null };
  velna: { verbal: number | null; logica: number | null; numerica: number | null; abstracta: number | null; espacial: number | null; indice: number | null };
  integridad: { overall_nivel: string | null; overall_pct: number | null; buena_impresion_pct: number | null; dimensiones: IntegrityDim[] };
};

type CompetenciaRow = { key: string; label: string; pct: number };

type Payload = {
  ok: boolean;
  report: FitReport;
  scores: Scores;
  demo_report_url: string | null;
  lead: { email: string; contact_name: string | null; company: string | null; puesto: string | null };
  candidate: { name: string } | null;
};

const NAVY = '#1B2438';
const NAVY2 = '#222D45';
const LIMA = '#D6F26B';
const CREMA = '#F0F0EC';
const PAGE = '#E5E5DE';
const MUTED = '#666C7C';
const GRIS = '#8B8E9C';
const LINE = 'rgba(27,36,56,0.1)';

const SELLO_LABEL: Record<FitSello, string> = {
  recomendado: 'Recomendado',
  recomendado_con_reservas: 'Recomendado con reservas',
  no_recomendado: 'No recomendado',
  pendiente_evaluacion: 'Pendiente evaluación',
};

const NIVEL_LABEL: Record<FitLevel, string> = {
  alto: 'Alto', medio: 'Medio', bajo: 'Bajo', pendiente: 'Pendiente',
};

// Etiquetas de las 5 dimensiones VELNA con su subtítulo laboral (mockup).
const VELNA_LABELS: Array<{ key: keyof Scores['velna']; label: string; sub: string }> = [
  { key: 'verbal', label: 'Razonamiento verbal', sub: 'Comprende y comunica ideas complejas' },
  { key: 'logica', label: 'Razonamiento lógico', sub: 'Identifica patrones y resuelve de forma deductiva' },
  { key: 'numerica', label: 'Razonamiento numérico', sub: 'Cálculo, proporciones e interpretación de tablas' },
  { key: 'abstracta', label: 'Razonamiento abstracto', sub: 'Aprende reglas nuevas y se adapta a lo desconocido' },
  { key: 'espacial', label: 'Razonamiento espacial', sub: 'Interpreta planos, mapas y esquemas' },
];

// Categoría del índice global según el rango (bajo <40, promedio 40-60, promedio_alto 61-75, alto 76-85, muy_alto >85).
function velnaCategoria(pct: number | null): string {
  if (pct === null) return '—';
  if (pct < 40) return 'Bajo';
  if (pct < 61) return 'Promedio';
  if (pct < 76) return 'Promedio alto';
  if (pct < 86) return 'Alto';
  return 'Muy alto';
}

function nivelIntegridadLabel(n: string | null): string {
  if (n === 'bajo') return 'Bajo';
  if (n === 'medio') return 'Medio';
  if (n === 'alto') return 'Alto';
  return '—';
}

// Formatea fecha larga en LatAm neutral ("16 de julio de 2026").
function fechaHoy(): string {
  return new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function FitReportView() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${config.apiBase}/api/marketing/fit-report/view/${token}`);
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
          setError({ code: err.error?.code ?? 'error', message: err.error?.message ?? `HTTP ${res.status}` });
          return;
        }
        const payload = (await res.json()) as Payload;
        setData(payload);
      } catch (err) {
        setError({ code: 'network_error', message: (err as Error).message });
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  // Cargamos Ubuntu + Oswald una sola vez desde Google Fonts.
  useEffect(() => {
    const id = 'shark-fit-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&family=Oswald:wght@500&display=swap';
    document.head.appendChild(link);
  }, []);

  // Top 10 competencias — calculadas desde DISC + VELNA con la misma función
  // que usa DemoReport. Vive arriba de los early returns porque los hooks
  // tienen que ejecutarse en el mismo orden en cada render.
  const topCompetencias: CompetenciaRow[] = useMemo(() => {
    if (!data) return [];
    const { d, i, s, c } = data.scores.disc;
    const v = data.scores.velna;
    if (d === null || i === null || s === null || c === null) return [];
    if (v.verbal === null || v.espacial === null || v.logica === null || v.numerica === null || v.abstracta === null) return [];
    const all = calculateCompetencias(
      { D: d, I: i, S: s, C: c },
      { verbal: v.verbal, espacial: v.espacial, logica: v.logica, numerica: v.numerica, abstracta: v.abstracta },
    );
    return [...all].sort((a, b) => b.score - a.score).slice(0, 10).map((row) => ({
      key: row.id, label: row.nombre, pct: row.score,
    }));
  }, [data]);

  if (loading) {
    return <ScreenMessage>Cargando reporte…</ScreenMessage>;
  }
  if (error) {
    return (
      <ScreenMessage>
        <div style={{ fontSize: 18, fontWeight: 700, color: NAVY, marginBottom: 8 }}>
          {error.code === 'token_expired' ? 'El link expiró' : 'No pudimos cargar el reporte'}
        </div>
        <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.6 }}>
          {error.code === 'token_expired'
            ? 'Los links del reporte tienen validez de 30 días. Escribinos para que te enviemos uno nuevo.'
            : error.message}
        </div>
      </ScreenMessage>
    );
  }
  if (!data) return null;

  const { report: r, scores, demo_report_url } = data;
  const fitPct = r.veredicto.fit_pct ?? 0;
  const isPendiente = r.veredicto.sello === 'pendiente_evaluacion';

  return (
    <div style={{ background: PAGE, color: NAVY, fontFamily: "'Ubuntu', sans-serif", fontSize: '15.5px', lineHeight: 1.6, padding: '44px 20px 80px', minHeight: '100vh' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* ── PORTADA NAVY ── */}
        <Cover
          candidato={r.candidato_nombre}
          empresa={r.cliente_empresa}
          puesto={r.puesto}
          fitPct={fitPct}
          isPendiente={isPendiente}
        />

        {/* ── VEREDICTO ── */}
        <Card num={1} title="Veredicto">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
            <b style={{ fontSize: 26, letterSpacing: '-0.01em' }}>{r.veredicto.titulo || `${r.candidato_nombre}`}</b>
            <Sello sello={r.veredicto.sello} />
          </div>
          <p>{r.veredicto.parrafo}</p>
          <div style={{ background: CREMA, borderRadius: 12, padding: '14px 18px', fontSize: 13.5, color: MUTED, marginTop: 16 }}>
            <b style={{ color: NAVY }}>Alcance:</b> esta evaluación cubre su conducta, su pensamiento, su integridad y el encaje contigo. Lo que dependa de su trayectoria — experiencia previa, idiomas, referencias — queda en tus manos en la entrevista.
          </div>
        </Card>

        {/* ── MATCHES ── */}
        {r.matches.length > 0 && (
          <Card num={2} title="¿Cumplirá tus expectativas? Punto por punto" subtitle="Cada expectativa que nos diste en la llamada, contra lo que su evaluación demuestra. Esto es el fit.">
            {r.matches.map((m, i) => (
              <MatchBlock key={i} match={m} />
            ))}
          </Card>
        )}

        {/* ── CÓMO ES ── */}
        {(r.como_es.fuertes.length > 0 || r.como_es.debiles.length > 0) && (
          <Card num={3} title={`Cómo es ${r.candidato_nombre}`} subtitle="La persona detrás de los resultados — sin adornos, en ambas direcciones.">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 22 }}>
              <div>
                <h3 style={{ fontSize: 16.5, marginBottom: 12 }}>Puntos fuertes</h3>
                {r.como_es.fuertes.map((f, i) => <ChipItem key={i} kind="strong">{f}</ChipItem>)}
              </div>
              <div>
                <h3 style={{ fontSize: 16.5, marginBottom: 12 }}>Puntos débiles</h3>
                {r.como_es.debiles.map((d, i) => <ChipItem key={i} kind="weak">{d}</ChipItem>)}
              </div>
            </div>
          </Card>
        )}

        {/* ── FIT CULTURAL + APROVECHAR ── */}
        {(r.fit_cultural.parrafo || r.como_aprovechar.length > 0) && (
          <Card num={4} title="Fit cultural con tu equipo">
            {r.fit_cultural.parrafo && (
              <FitBox nivelLabel={NIVEL_LABEL[r.fit_cultural.nivel]} sublabel="Fit cultural">
                <p style={{ margin: 0, fontSize: 14, color: '#C9CDD8' }}>{r.fit_cultural.parrafo}</p>
              </FitBox>
            )}
            {r.como_aprovechar.length > 0 && (
              <div style={{ marginTop: r.fit_cultural.parrafo ? 30 : 0 }}>
                <h3 style={{ fontSize: 16.5, marginBottom: 12 }}>Cómo aprovechar este perfil si la contratas</h3>
                {r.como_aprovechar.map((a, i) => (
                  <div key={i} style={{ borderLeft: `3px solid ${LIMA}`, padding: '6px 0 6px 18px', marginBottom: 14, fontSize: 14.5 }}>
                    <b style={{ display: 'block' }}>{a.titulo}</b>
                    <span style={{ color: MUTED, fontSize: 14 }}>{a.texto}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* ── SEPARADOR PARTE 2 ── */}
        <Parte2Separator />

        {/* ── CÓMO SE COMPORTA (DISC) ── */}
        <Card num={5} title="Cómo se comporta" subtitle="Perfil conductual — cómo trabaja en el día a día.">
          <DiscBars disc={scores.disc} />
          {r.conducta.dominante_titulo && (
            <div style={{ background: CREMA, borderLeft: `4px solid ${LIMA}`, borderRadius: 12, padding: '18px 22px', fontSize: 14 }}>
              <b style={{ display: 'block', fontSize: 16.5, marginBottom: 6 }}>Perfil dominante: {r.conducta.dominante_titulo}</b>
              {r.conducta.dominante_parrafo}
            </div>
          )}
          {(r.conducta.como_trabaja.decisiones || r.conducta.como_trabaja.equipo || r.conducta.como_trabaja.presion || r.conducta.como_trabaja.comunicacion) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginTop: 16 }}>
              <WCard label="Toma de decisiones">{r.conducta.como_trabaja.decisiones}</WCard>
              <WCard label="Trabajo en equipo">{r.conducta.como_trabaja.equipo}</WCard>
              <WCard label="Bajo presión">{r.conducta.como_trabaja.presion}</WCard>
              <WCard label="Comunicación">{r.conducta.como_trabaja.comunicacion}</WCard>
            </div>
          )}
        </Card>

        {/* ── CÓMO PIENSA (VELNA) ── */}
        <Card num={6} title="Cómo piensa y decide" subtitle="Capacidad de pensamiento en cinco áreas.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, background: CREMA, borderRadius: 16, padding: '22px 28px', marginBottom: 18, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 56, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>
              {scores.velna.indice !== null ? `${Math.round(scores.velna.indice)}%` : '—'}
            </span>
            <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', background: NAVY, color: LIMA, borderRadius: 20, padding: '5px 16px' }}>
              {velnaCategoria(scores.velna.indice)}
            </span>
            <span style={{ color: MUTED, fontSize: 13.5, flex: 1, minWidth: 200 }}>
              Cada área mide algo distinto y predice cosas distintas en el trabajo.
            </span>
          </div>
          {VELNA_LABELS.map((v) => (
            <ScoreRow key={v.key} label={v.label} sub={v.sub} pct={scores.velna[v.key]} showPct />
          ))}
          {r.pensamiento.que_significa && (
            <div style={{ background: CREMA, borderLeft: `4px solid ${LIMA}`, borderRadius: 12, padding: '16px 20px', marginTop: 16, fontSize: 14.5 }}>
              <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: MUTED, display: 'block', marginBottom: 5 }}>Qué significa para ti</span>
              {r.pensamiento.que_significa}
            </div>
          )}
        </Card>

        {/* ── COMPETENCIAS (top 10) ── */}
        {topCompetencias.length > 0 && (
          <Card num={7} title="Top 10 competencias" subtitle="Comportamientos concretos en el trabajo, combinando su conducta y su razonamiento.">
            {topCompetencias.map((c) => (
              <ScoreRow key={c.key} label={c.label} pct={c.pct} showPct />
            ))}
          </Card>
        )}

        {/* ── INTEGRIDAD ── */}
        <Card num={8} title="Qué tan íntegra es" subtitle="Perfil de riesgo conductual — nueve ejes éticos, con detector de respuestas para quedar bien.">
          <FitBox
            nivelLabel={nivelIntegridadLabel(scores.integridad.overall_nivel)}
            sublabel="Riesgo global"
          >
            <p style={{ margin: 0, fontSize: 14, color: '#C9CDD8' }}>{r.integridad.parrafo}</p>
          </FitBox>
          <div style={{ marginTop: 24 }}>
            <RiskColumns dimensiones={scores.integridad.dimensiones} />
          </div>
          {r.integridad.nota_medios && (
            <p style={{ fontSize: 12.5, color: MUTED, marginTop: 14 }}>{r.integridad.nota_medios}</p>
          )}
        </Card>

        {/* ── Link al reporte psicométrico si existe ── */}
        {demo_report_url && (
          <div style={{ background: `linear-gradient(135deg, ${NAVY}, ${NAVY2})`, color: CREMA, borderRadius: 22, padding: '32px 40px', display: 'flex', gap: 20, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', boxShadow: '0 18px 44px rgba(27,36,56,0.25)' }}>
            <p style={{ margin: 0, fontSize: 14.5, maxWidth: 460, color: '#C9CDD8' }}>
              <b style={{ color: LIMA }}>Reporte psicométrico detallado</b>
              <br />
              Los datos crudos de cada prueba en una vista aparte — útil si querés compartirlo con otro miembro del equipo.
            </p>
            <a href={demo_report_url} target="_blank" rel="noreferrer" style={{ background: LIMA, color: NAVY, fontWeight: 700, fontSize: 15, border: 'none', borderRadius: 10, padding: '15px 28px', textDecoration: 'none', boxShadow: '0 8px 22px rgba(214,242,107,0.4)' }}>
              Abrir reporte psicométrico
            </a>
          </div>
        )}

        <p style={{ textAlign: 'center', fontSize: 12.5, color: MUTED, marginTop: 8 }}>
          Este reporte combina los resultados de las evaluaciones psicométricas de la candidata con la conversación de fit sostenida con {r.cliente_contacto}. Cualquier duda, responde el correo — llega directo al equipo de SharkTalents.
          <br />
          <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 9.5, letterSpacing: '0.2em', color: GRIS, textTransform: 'uppercase' }}>
            SharkTalents.ai · Detectamos lo que el CV no muestra · Confidencial — solo para el empleador que lo solicitó
          </span>
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Componentes de layout
// ============================================================================

function ScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: PAGE, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: "'Ubuntu', sans-serif", color: NAVY }}>
      <div style={{ background: '#fff', borderRadius: 22, padding: 32, maxWidth: 480, textAlign: 'center', boxShadow: '0 18px 44px rgba(27,36,56,0.09)' }}>
        {children}
      </div>
    </div>
  );
}

function Cover({ candidato, empresa, puesto, fitPct, isPendiente }: { candidato: string; empresa: string; puesto: string; fitPct: number; isPendiente: boolean }) {
  const RADIUS = 72;
  const CIRC = 2 * Math.PI * RADIUS; // 452.39...
  const dashOffset = CIRC - (CIRC * fitPct) / 100;

  return (
    <div style={{
      background: `linear-gradient(135deg, ${NAVY} 0%, ${NAVY2} 100%)`,
      color: CREMA, borderRadius: 22, padding: '54px 56px',
      position: 'relative', overflow: 'hidden',
      boxShadow: '0 24px 60px rgba(27,36,56,0.3)',
      display: 'grid', gridTemplateColumns: '1fr auto', gap: 36, alignItems: 'center',
    }}>
      <div>
        <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 12, letterSpacing: '0.34em', textTransform: 'uppercase', color: LIMA, marginBottom: 20 }}>
          SharkTalents
        </div>
        <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#9BA0B0' }}>
          Reporte de finalista · Fit + psicométrico
        </div>
        <h1 style={{ fontSize: 'clamp(34px,6vw,48px)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05, margin: '4px 0 14px' }}>
          {candidato}
        </h1>
        <div style={{ color: '#9BA0B0', fontSize: 15 }}>
          Para <b style={{ color: CREMA }}>{empresa}</b> · Puesto: {puesto}
          <br />
          {fechaHoy()}
        </div>
        <div style={{ marginTop: 20 }}>
          <span style={chipStyle}>Confidencial</span>
          {isPendiente && <span style={chipStyle}>Evaluación en curso</span>}
        </div>
      </div>
      {!isPendiente && (
        <div style={{ position: 'relative', width: 172, height: 172, zIndex: 1 }}>
          <svg viewBox="0 0 160 160" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
            <circle cx="80" cy="80" r={RADIUS} fill="none" stroke="rgba(240,240,236,0.14)" strokeWidth={11} />
            <circle
              cx="80" cy="80" r={RADIUS} fill="none" stroke={LIMA} strokeWidth={11} strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={dashOffset}
              style={{
                transition: 'stroke-dashoffset 1.6s cubic-bezier(0.22,1,0.36,1) 0.3s',
                filter: 'drop-shadow(0 0 10px rgba(214,242,107,0.6))',
              }}
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <b style={{ fontSize: 40, color: LIMA }}>{Math.round(fitPct)}%</b>
            <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 8.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#9BA0B0', textAlign: 'center', lineHeight: 1.6 }}>
              Fit con tus<br />expectativas
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ num, title, subtitle, children }: { num: number; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#FFFFFF', borderRadius: 22, padding: '42px 48px', boxShadow: '0 2px 4px rgba(27,36,56,0.05), 0 18px 44px rgba(27,36,56,0.09)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6 }}>
        <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: '0.18em', background: LIMA, color: NAVY, borderRadius: 20, padding: '4px 13px' }}>
          {String(num).padStart(2, '0')}
        </span>
        <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', margin: 0 }}>{title}</h2>
      </div>
      {subtitle && <p style={{ fontSize: 14, color: MUTED, marginBottom: 22, marginTop: 0 }}>{subtitle}</p>}
      {children}
    </div>
  );
}

function Sello({ sello }: { sello: FitSello }) {
  return (
    <span style={{
      fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase',
      background: LIMA, color: NAVY, borderRadius: 20, padding: '6px 18px',
      boxShadow: '0 6px 16px rgba(214,242,107,0.5)',
    }}>
      {SELLO_LABEL[sello]}
    </span>
  );
}

function MatchBlock({ match }: { match: Match }) {
  const engrana = match.estado === 'engrana';
  return (
    <div style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 16, boxShadow: '0 2px 4px rgba(27,36,56,0.06), 0 10px 26px rgba(27,36,56,0.08)' }}>
      <div style={{
        background: `linear-gradient(120deg, ${NAVY}, ${NAVY2})`, color: CREMA,
        padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      }}>
        <div>
          <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase', color: LIMA, display: 'block', marginBottom: 3 }}>
            Tu expectativa
          </span>
          <b style={{ fontSize: 15.5, fontWeight: 700 }}>{match.expectativa}</b>
        </div>
        <span style={{
          fontFamily: "'Oswald', sans-serif", fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
          padding: '6px 16px', borderRadius: 20, whiteSpace: 'nowrap', flexShrink: 0,
          ...(engrana
            ? { background: LIMA, color: NAVY, boxShadow: '0 0 14px rgba(214,242,107,0.55)' }
            : { background: 'transparent', color: '#9BA0B0', border: `1.5px dashed ${GRIS}` }),
        }}>
          {engrana ? 'Engrana' : 'A validar'}
        </span>
      </div>
      <div style={{ background: CREMA, padding: '16px 24px 10px' }}>
        <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase', color: MUTED, display: 'block', marginBottom: 8 }}>
          La evidencia
        </span>
        <ul style={{ margin: '0 0 12px 18px', fontSize: 14, color: '#3A4358' }}>
          {match.evidencias.map((e, i) => <li key={i} style={{ marginBottom: 5 }}>{e}</li>)}
        </ul>
      </div>
    </div>
  );
}

function ChipItem({ kind, children }: { kind: 'strong' | 'weak'; children: React.ReactNode }) {
  return (
    <div style={{ background: CREMA, borderRadius: 12, padding: '13px 16px 13px 30px', marginBottom: 10, fontSize: 14, position: 'relative' }}>
      <span style={{
        content: '', position: 'absolute', width: 8, height: 8, borderRadius: '50%',
        background: kind === 'strong' ? LIMA : GRIS,
        border: kind === 'strong' ? `1.5px solid ${NAVY}` : 'none',
        left: 12, top: 19, display: 'inline-block',
      }} />
      {children}
    </div>
  );
}

function FitBox({ nivelLabel, sublabel, children }: { nivelLabel: string; sublabel: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', gap: 22, alignItems: 'center',
      background: `linear-gradient(120deg, ${NAVY}, ${NAVY2})`, color: CREMA,
      borderRadius: 16, padding: '24px 28px', flexWrap: 'wrap',
    }}>
      <div style={{ flexShrink: 0, background: LIMA, color: NAVY, borderRadius: 14, padding: '16px 26px', textAlign: 'center', boxShadow: '0 8px 22px rgba(214,242,107,0.35)' }}>
        <b style={{ fontSize: 26, display: 'block' }}>{nivelLabel}</b>
        <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 8.5, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          {sublabel}
        </span>
      </div>
      <div style={{ flex: 1, minWidth: 200 }}>{children}</div>
    </div>
  );
}

function WCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: CREMA, borderRadius: 12, padding: '15px 18px', fontSize: 13.5, color: '#3A4358' }}>
      <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: MUTED, display: 'block', marginBottom: 4 }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function Parte2Separator() {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${NAVY}, ${NAVY2})`, color: CREMA,
      borderRadius: 22, padding: '30px 40px', position: 'relative', overflow: 'hidden',
      boxShadow: '0 18px 44px rgba(27,36,56,0.25)',
    }}>
      <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: '0.28em', color: LIMA, display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>
        Parte 2 · La evidencia
      </span>
      <p style={{ margin: 0, fontSize: 14.5, color: '#9BA0B0', maxWidth: 560 }}>
        Todo lo anterior sale de aquí: los datos duros de su evaluación. Léelos si quieres profundizar — o confía en que ya los leímos por ti.
      </p>
    </div>
  );
}

// ============================================================================
// Componentes de datos duros (DISC bars, VELNA rows, integridad columns)
// ============================================================================

function DiscBars({ disc }: { disc: Scores['disc'] }) {
  const axes: Array<{ letter: 'D' | 'I' | 'S' | 'C'; label: string; val: number | null }> = [
    { letter: 'D', label: 'Decisión', val: disc.d },
    { letter: 'I', label: 'Influencia', val: disc.i },
    { letter: 'S', label: 'Estabilidad', val: disc.s },
    { letter: 'C', label: 'Cumplimiento', val: disc.c },
  ];
  const maxVal = Math.max(...axes.map((a) => a.val ?? 0));
  const dominante = disc.perfil_dominante?.toUpperCase() ?? null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, margin: '22px 0' }}>
      {axes.map((a) => {
        const isDom = dominante === a.letter || (dominante === null && a.val === maxVal && a.val !== null && a.val > 0);
        const barHeight = a.val !== null ? Math.max(4, a.val) : 0;
        return (
          <div key={a.letter} style={{ textAlign: 'center' }}>
            <div style={{ height: 130, background: CREMA, borderRadius: 12, position: 'relative', overflow: 'hidden', ...(isDom ? { outline: `2px solid ${NAVY}`, outlineOffset: -2 } : {}) }}>
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                height: `${barHeight}%`,
                background: isDom ? LIMA : NAVY,
                opacity: isDom ? 1 : 0.28,
                borderRadius: '10px 10px 0 0',
                boxShadow: isDom ? '0 0 18px rgba(214,242,107,0.7)' : undefined,
                transition: 'height 1s cubic-bezier(0.22,1,0.36,1)',
              }} />
            </div>
            <span style={{ fontWeight: 700, fontSize: 18, marginTop: 10, display: 'block' }}>{a.letter}</span>
            <span style={{ fontSize: 13, color: MUTED }}>
              {a.val !== null ? `${Math.round(a.val)} · ${a.label}` : a.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ScoreRow({ label, sub, pct, showPct }: { label: string; sub?: string; pct: number | null; showPct?: boolean }) {
  const p = pct ?? 0;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 110px 52px', gap: 14, alignItems: 'center',
      padding: '12px 4px', borderBottom: `1px solid ${LINE}`, fontSize: 14.5,
    }}>
      <span>
        {label}
        {sub && <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED, display: 'block' }}>{sub}</span>}
      </span>
      <span style={{ height: 9, background: CREMA, borderRadius: 6, overflow: 'hidden' }}>
        <span style={{
          display: 'block', height: '100%', width: `${p}%`,
          background: `linear-gradient(90deg, #C9E85C, ${LIMA})`,
          borderRadius: 6, boxShadow: '0 0 8px rgba(214,242,107,0.45)',
          transition: 'width 1s cubic-bezier(0.22,1,0.36,1)',
        }} />
      </span>
      {showPct && (
        <span style={{ textAlign: 'right', fontWeight: 700, fontSize: 15 }}>
          {pct !== null ? `${Math.round(pct)}%` : '—'}
        </span>
      )}
    </div>
  );
}

function RiskColumns({ dimensiones }: { dimensiones: IntegrityDim[] }) {
  // buena_impresion no es un eje conductual — es indicador de validez del test.
  // Ya lo comunicamos en el párrafo de integridad; no va en las columnas.
  const ejes = dimensiones.filter((d) => d.dimension !== 'buena_impresion');
  const bajo = ejes.filter((d) => d.nivel === 'bajo');
  const medio = ejes.filter((d) => d.nivel === 'medio');
  const alto = ejes.filter((d) => d.nivel === 'alto');

  const RCol = ({ head, headStyle, items }: { head: string; headStyle: React.CSSProperties; items: IntegrityDim[] }) => (
    <div>
      <div style={{
        fontFamily: "'Oswald', sans-serif", fontSize: 10.5, letterSpacing: '0.2em', textTransform: 'uppercase',
        textAlign: 'center', borderRadius: 20, padding: '7px 10px', marginBottom: 12,
        ...headStyle,
      }}>{head}</div>
      {items.length === 0
        ? <div style={{ background: 'transparent', border: `1.5px dashed ${LINE}`, borderRadius: 10, padding: '10px 14px', marginBottom: 8, fontSize: 13.5, textAlign: 'center', color: MUTED }}>Ninguno detectado</div>
        : items.map((d) => (
            <div key={d.dimension} style={{ background: CREMA, borderRadius: 10, padding: '10px 14px', marginBottom: 8, fontSize: 13.5, textAlign: 'center' }}>
              {labelForDimension(d.dimension)}
            </div>
          ))}
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 16 }}>
      <RCol head="Bajo riesgo" headStyle={{ background: LIMA, color: NAVY }} items={bajo} />
      <RCol head="Riesgo medio" headStyle={{ background: CREMA, color: MUTED, border: `1px solid ${LINE}` }} items={medio} />
      <RCol head="Alto riesgo" headStyle={{ background: NAVY, color: CREMA }} items={alto} />
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  display: 'inline-block', fontFamily: "'Oswald', sans-serif", fontSize: 10, letterSpacing: '0.2em',
  textTransform: 'uppercase', border: '1px solid rgba(214,242,107,0.5)', color: LIMA,
  borderRadius: 20, padding: '4px 13px', marginRight: 8, background: 'rgba(214,242,107,0.08)',
};
