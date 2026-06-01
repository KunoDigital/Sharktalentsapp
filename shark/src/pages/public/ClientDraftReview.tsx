import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { config } from '../../config';
import { logger } from '../../lib/logger';

const log = logger('CLIENT_DRAFT_REVIEW');

type Payload = {
  title?: string;
  company?: string;
  sector?: string;
  modalidad?: string;
  viajes?: string;
  salario?: string;
  reporta_a?: string;
  a_cargo?: string;
  incorporacion?: string;
  objetivo_cargo?: string;
  responsabilidades?: string[];
  tareas_especificas?: string[];
  herramientas_conocimientos?: string[];
  formacion_requerida?: string;
  experiencia_requerida?: string;
  disc_perfil_descripcion?: string;
  disc_ventajas?: string[];
  disc_desventajas_potenciales?: string[];
  context_summary?: string;
  cognitive_level?: 'basic' | 'mid' | 'senior';
  disc_ideal?: { d?: number; i?: number; s?: number; c?: number; description?: string[] };
  velna_ideal?: { verbal?: number; espacial?: number; logica?: number; numerica?: number; abstracta?: number };
  competencias?: Array<{ name: string; required_pct: number; que_evaluamos?: string }>;
  salary_range_usd?: { min?: number; max?: number };
  tecnica_minimo_pct?: number;
};

type DraftData = {
  id: string;
  status: string;
  created_at: string;
  client_name: string;
  client_company: string;
  agency_name: string;
  payload: Payload;
};

const DISC_COLORS: Record<'D' | 'I' | 'S' | 'C', string> = {
  D: '#e74c3c', I: '#f39c12', S: '#2ecc71', C: '#3498db',
};
const DISC_NAMES: Record<'D' | 'I' | 'S' | 'C', string> = {
  D: 'Dominancia', I: 'Influencia', S: 'Estabilidad', C: 'Cumplimiento',
};
const VELNA_LABELS: Record<string, string> = {
  verbal: 'Verbal', espacial: 'Espacial', logica: 'Lógica', numerica: 'Numérica', abstracta: 'Abstracta',
};

const COMPETENCIA_NAMES: Record<string, string> = {
  comunicacion_digital: 'Comunicación digital',
  colaboracion: 'Colaboración',
  adaptabilidad: 'Adaptabilidad',
  iniciativa: 'Iniciativa',
  planificacion: 'Planificación',
  manejo_ambiguedad: 'Manejo de la ambigüedad',
  trabajo_equipo: 'Trabajo en equipo y colaboración',
  retroalimentacion: 'Retroalimentación y monitoreo',
  orientacion_cliente: 'Orientación al cliente',
  aprendizaje_vuelo: 'Aprendizaje al vuelo',
  resolucion_problemas: 'Resolución de problemas complejos',
  inteligencia_emocional: 'Inteligencia emocional',
  creatividad_innovacion: 'Creatividad e innovación',
  liderazgo: 'Liderazgo',
  orientacion_logro: 'Orientación al logro',
  persuasion_negociacion: 'Persuasión y negociación',
  mentalidad_digital: 'Mentalidad digital',
  foco_data: 'Foco en data',
  impacto_influencia: 'Impacto e influencia',
  autoconfianza: 'Autoconfianza',
  comprension_interpersonal: 'Comprensión interpersonal',
  desarrollo_interrelaciones: 'Desarrollo de interrelaciones',
  orden_calidad: 'Orden y calidad',
  asertividad: 'Asertividad',
  dinamismo_energia: 'Dinamismo y energía',
  habilidad_analitica: 'Habilidad analítica',
  perseverancia: 'Perseverancia',
  orientacion_accion: 'Orientación a la acción',
  compromiso_organizacional: 'Compromiso organizacional',
  actitud_servicio: 'Actitud de servicio',
  manejo_conflictos: 'Manejo de conflictos',
  toma_decisiones_oportuna: 'Toma de decisiones oportuna',
  calidad_decisiones: 'Calidad de las decisiones',
  capacidad_intelectual: 'Capacidad intelectual',
  capacidad_escuchar: 'Capacidad para escuchar',
  paciencia: 'Paciencia',
  comunicacion_escrita: 'Comunicación escrita',
  gestion_riesgo: 'Gestión del riesgo',
  pensamiento_critico: 'Pensamiento crítico y análisis',
  resiliencia: 'Resiliencia, tolerancia al estrés y flexibilidad',
};

function humanizeCompetencia(id: string): string {
  return COMPETENCIA_NAMES[id] || id.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default function ClientDraftReview() {
  const { token, draftId } = useParams<{ token: string; draftId: string }>();
  const [data, setData] = useState<DraftData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<'idle' | 'approving' | 'requesting'>('idle');
  const [actionResult, setActionResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!token || !draftId) {
      setError('Link inválido');
      setLoading(false);
      return;
    }
    async function load() {
      try {
        const response = await fetch(
          `${config.apiBase.replace(/\/$/, '')}/portal/${encodeURIComponent(token!)}/drafts/${encodeURIComponent(draftId!)}`,
        );
        if (!response.ok) {
          setError(response.status === 401 ? 'El link expiró o no es válido' : `Error al cargar (${response.status})`);
          setLoading(false);
          return;
        }
        const json = (await response.json()) as { draft: DraftData };
        setData(json.draft);
      } catch (err) {
        log.warn('load draft failed', { error: (err as Error).message });
        setError('Error de conexión');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token, draftId]);

  async function handleApprove() {
    if (!token || !draftId) return;
    setAction('approving');
    setActionResult(null);
    try {
      const response = await fetch(
        `${config.apiBase.replace(/\/$/, '')}/portal/${encodeURIComponent(token)}/drafts/${encodeURIComponent(draftId)}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_comment: comment.trim() || undefined }),
        },
      );
      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson?.error?.message ?? `Error ${response.status}`);
      }
      setActionResult({ ok: true, msg: '¡Listo! Aprobaste el perfil del puesto. SharkTalents arranca la búsqueda de candidatos.' });
    } catch (err) {
      setActionResult({ ok: false, msg: `No se pudo aprobar: ${(err as Error).message}` });
    } finally {
      setAction('idle');
    }
  }

  async function handleRequestChanges() {
    if (!token || !draftId) return;
    if (!comment.trim()) {
      setActionResult({ ok: false, msg: 'Antes de pedir cambios escribí qué necesitás ajustar.' });
      return;
    }
    setAction('requesting');
    setActionResult(null);
    try {
      const response = await fetch(
        `${config.apiBase.replace(/\/$/, '')}/portal/${encodeURIComponent(token)}/drafts/${encodeURIComponent(draftId)}/request-changes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_comment: comment.trim() }),
        },
      );
      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson?.error?.message ?? `Error ${response.status}`);
      }
      setActionResult({ ok: true, msg: 'Tus comentarios llegaron. Vamos a revisar y te volvemos con el perfil ajustado.' });
    } catch (err) {
      setActionResult({ ok: false, msg: `No se pudo enviar: ${(err as Error).message}` });
    } finally {
      setAction('idle');
    }
  }

  if (loading) return <Page><Loading /></Page>;
  if (error || !data) return <Page><ErrorView msg={error ?? 'Sin datos'} /></Page>;

  const p = data.payload;
  const discSum = (p.disc_ideal?.d ?? 0) + (p.disc_ideal?.i ?? 0) + (p.disc_ideal?.s ?? 0) + (p.disc_ideal?.c ?? 0);
  const decided = actionResult?.ok === true;

  const datosBasicos: Array<[string, string | undefined]> = [
    ['Cargo', p.title],
    ['Empresa', p.company],
    ['Sector', p.sector],
    ['Modalidad', p.modalidad],
    ['Viajes', p.viajes],
    ['Salario', p.salario || (p.salary_range_usd?.min ? `USD ${p.salary_range_usd.min}${p.salary_range_usd.max ? `–${p.salary_range_usd.max}` : ''} mensuales` : undefined)],
    ['Reporta a', p.reporta_a],
    ['A su cargo', p.a_cargo],
  ].filter(([, v]) => !!v) as Array<[string, string | undefined]>;

  const condiciones: Array<[string, string | undefined]> = [
    ['Modalidad', p.modalidad],
    ['Viajes', p.viajes],
    ['Salario', p.salario || (p.salary_range_usd?.min ? `USD ${p.salary_range_usd.min}${p.salary_range_usd.max ? `–${p.salary_range_usd.max}` : ''} mensuales` : undefined)],
    ['Incorporación', p.incorporacion],
  ].filter(([, v]) => !!v) as Array<[string, string | undefined]>;

  return (
    <Page>
      <div style={cardStyle}>
        {/* HEADER */}
        <div style={headerStyle}>
          <div style={brandStyle}>{data.agency_name.toUpperCase()} · PERFIL DE CARGO</div>
          <h1 style={{ fontSize: 32, fontWeight: 'bold', margin: 0, marginBottom: 6, lineHeight: 1.15 }}>
            {p.title ?? 'Perfil del puesto'}
          </h1>
          <div style={{ color: '#8a93a3', fontSize: 14 }}>
            Para: <strong style={{ color: '#dafd6f' }}>{p.company || data.client_company}</strong>
            {data.client_name && ` · ${data.client_name}`}
          </div>
        </div>

        <div style={bodyStyle}>
          <div style={introStyle}>
            Después de nuestra reunión armamos este perfil del puesto. Antes de empezar a buscar candidatos
            necesitamos que <strong>vos confirmes</strong> que está alineado con lo que necesitás.
            Si algo no encaja, podés pedir cambios y volvemos con una versión ajustada.
          </div>

          {/* Datos básicos en tabla */}
          {datosBasicos.length > 0 && (
            <Section title="Datos del puesto">
              <DataTable rows={datosBasicos} />
            </Section>
          )}

          {/* Objetivo del cargo */}
          {p.objetivo_cargo && (
            <Section title="Objetivo del cargo">
              <p style={paragraphStyle}>{p.objetivo_cargo}</p>
            </Section>
          )}

          {/* Responsabilidades */}
          {p.responsabilidades && p.responsabilidades.length > 0 && (
            <Section title="Responsabilidades principales">
              <BulletList items={p.responsabilidades} />
            </Section>
          )}

          {/* Tareas específicas */}
          {p.tareas_especificas && p.tareas_especificas.length > 0 && (
            <Section title="Tareas específicas">
              <BulletList items={p.tareas_especificas} />
            </Section>
          )}

          {/* Herramientas */}
          {p.herramientas_conocimientos && p.herramientas_conocimientos.length > 0 && (
            <Section title="Herramientas y conocimientos requeridos">
              <BulletList items={p.herramientas_conocimientos} />
            </Section>
          )}

          {/* Perfil del candidato */}
          {(p.formacion_requerida || p.experiencia_requerida) && (
            <Section title="Perfil del candidato">
              {p.formacion_requerida && (
                <p style={paragraphStyle}>
                  <strong style={{ color: '#dafd6f' }}>Formación:</strong> {p.formacion_requerida}
                </p>
              )}
              {p.experiencia_requerida && (
                <p style={paragraphStyle}>
                  <strong style={{ color: '#dafd6f' }}>Experiencia:</strong> {p.experiencia_requerida}
                </p>
              )}
            </Section>
          )}

          {/* Tipo de persona (DISC humano) */}
          {(p.disc_perfil_descripcion || p.disc_ideal) && (
            <Section title="Tipo de persona que buscamos">
              {p.disc_perfil_descripcion && (
                <p style={{ ...paragraphStyle, marginBottom: 20 }}>{p.disc_perfil_descripcion}</p>
              )}

              {p.disc_ideal && (
                <>
                  <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                    Perfil DISC ideal · suma = {discSum}
                  </div>
                  <div style={discRowStyle}>
                    {(['D', 'I', 'S', 'C'] as const).map((d) => {
                      const v = p.disc_ideal?.[d.toLowerCase() as 'd' | 'i' | 's' | 'c'] ?? 0;
                      return (
                        <div key={d} style={{ flex: 1, textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>{DISC_NAMES[d]}</div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: DISC_COLORS[d], marginBottom: 6 }}>{d}</div>
                          <div style={{ height: 90, background: '#f3f4f6', borderRadius: 6, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden' }}>
                            <div style={{ width: '60%', height: `${v}%`, background: DISC_COLORS[d], borderRadius: '4px 4px 0 0', opacity: 0.85, minHeight: 2 }} />
                          </div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: DISC_COLORS[d], marginTop: 6 }}>{v}</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {p.disc_ventajas && p.disc_ventajas.length > 0 && (
                <div style={{ marginTop: 24, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 18 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#166534', marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    ✓ Esta persona va a poder
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 20, color: '#15803d', lineHeight: 1.7 }}>
                    {p.disc_ventajas.map((v, i) => <li key={i}>{v}</li>)}
                  </ul>
                </div>
              )}

              {p.disc_desventajas_potenciales && p.disc_desventajas_potenciales.length > 0 && (
                <div style={{ marginTop: 14, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 18 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    ⚠ Posibles desventajas / a tomar en cuenta
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 20, color: '#78350f', lineHeight: 1.7 }}>
                    {p.disc_desventajas_potenciales.map((v, i) => <li key={i}>{v}</li>)}
                  </ul>
                </div>
              )}
            </Section>
          )}

          {/* Capacidad cognitiva */}
          {p.velna_ideal && (
            <Section title="Capacidad cognitiva esperada" subtitle="VELNA — razonamiento sobre 5 dimensiones">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                {(['verbal', 'espacial', 'logica', 'numerica', 'abstracta'] as const).map((k) => {
                  const v = p.velna_ideal?.[k] ?? 0;
                  return (
                    <div key={k} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>{VELNA_LABELS[k]}</div>
                      <div style={{ fontSize: 22, fontWeight: 'bold', color: '#0e1218' }}>{v}%</div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Habilidades blandas — TABLA */}
          {p.competencias && p.competencias.length > 0 && (
            <Section title="Habilidades blandas que buscamos" subtitle="Estas competencias serán evaluadas mediante las herramientas psicométricas de SharkTalents durante el proceso de selección.">
              <table style={competenciaTable}>
                <thead>
                  <tr>
                    <th style={tableHeader}>Competencia</th>
                    <th style={tableHeader}>Qué evaluamos</th>
                    <th style={{ ...tableHeader, width: 60, textAlign: 'right' }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {p.competencias.map((c, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ ...tableCell, fontWeight: 600, color: '#0e1218' }}>{humanizeCompetencia(c.name)}</td>
                      <td style={{ ...tableCell, color: '#4b5563', lineHeight: 1.55 }}>{c.que_evaluamos || '—'}</td>
                      <td style={{ ...tableCell, textAlign: 'right', fontWeight: 700, color: '#0e1218' }}>{c.required_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* Condiciones */}
          {(condiciones.length > 0 || p.tecnica_minimo_pct) && (
            <Section title="Condiciones">
              <DataTable rows={condiciones} />
              {p.tecnica_minimo_pct && (
                <div style={{ marginTop: 14, padding: '12px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 14, color: '#4b5563' }}>
                  <strong style={{ color: '#0e1218' }}>Mínimo en prueba técnica:</strong> {p.tecnica_minimo_pct}%
                </div>
              )}
            </Section>
          )}

          {/* Acciones */}
          {!decided && (
            <Section title="¿Aprobás este perfil?" subtitle="Una vez que apruebes, arrancamos la búsqueda de candidatos.">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Comentarios (opcional si aprobás · obligatorio si pedís cambios)…"
                rows={5}
                style={textareaStyle}
              />
              {actionResult && !actionResult.ok && (
                <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 14 }}>
                  {actionResult.msg}
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
                <button onClick={handleApprove} disabled={action !== 'idle'} style={btnApprove}>
                  {action === 'approving' ? 'Aprobando…' : '✓ Aprobar el perfil'}
                </button>
                <button onClick={handleRequestChanges} disabled={action !== 'idle'} style={btnRequest}>
                  {action === 'requesting' ? 'Enviando…' : '✏️ Pedir cambios'}
                </button>
              </div>
            </Section>
          )}

          {decided && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 24, textAlign: 'center', marginTop: 32 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
              <h3 style={{ color: '#166534', fontSize: 20, fontWeight: 'bold', margin: 0, marginBottom: 8 }}>¡Listo!</h3>
              <p style={{ color: '#15803d', margin: 0, lineHeight: 1.7 }}>{actionResult?.msg}</p>
            </div>
          )}
        </div>

        <div style={{ background: '#0e1218', borderTop: '4px solid #dafd6f', padding: '20px 40px', textAlign: 'center' }}>
          <div style={{ color: '#dafd6f', fontSize: 13, fontWeight: 'bold', letterSpacing: 1 }}>
            Proceso gestionado por {data.agency_name}
          </div>
        </div>
      </div>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return <div style={pageStyle}>{children}</div>;
}

function Loading() {
  return <p style={{ color: '#8a93a3', textAlign: 'center', marginTop: 80 }}>Cargando…</p>;
}

function ErrorView({ msg }: { msg: string }) {
  return (
    <div style={{ ...cardStyle, padding: 40, textAlign: 'center' }}>
      <h1 style={{ color: '#1f2937', fontSize: 22 }}>No se pudo cargar</h1>
      <p style={{ color: '#6b7280' }}>{msg}</p>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 19, color: '#0e1218', marginTop: 0, marginBottom: subtitle ? 4 : 16, fontWeight: 'bold', borderLeft: '3px solid #dafd6f', paddingLeft: 12 }}>
        {title}
      </h2>
      {subtitle && <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0, marginBottom: 16, paddingLeft: 15 }}>{subtitle}</p>}
      {children}
    </section>
  );
}

function DataTable({ rows }: { rows: Array<[string, string | undefined]> }) {
  return (
    <table style={dataTableStyle}>
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
            <td style={{ ...tableCell, fontWeight: 600, color: '#0e1218', width: '35%', background: '#f9fafb' }}>{k}</td>
            <td style={{ ...tableCell, color: '#1f2937' }}>{v ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 22, color: '#1f2937', lineHeight: 1.75 }}>
      {items.map((item, i) => <li key={i} style={{ marginBottom: 4 }}>{item}</li>)}
    </ul>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  background: '#f3f4f6', color: '#1f2937', lineHeight: 1.6, padding: '32px 16px', minHeight: '100vh',
};
const cardStyle: React.CSSProperties = {
  maxWidth: 820, margin: '0 auto', background: '#fff',
  borderRadius: 12, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
};
const headerStyle: React.CSSProperties = {
  background: '#0e1218', color: '#fff', padding: '40px 44px',
  borderBottom: '4px solid #dafd6f',
};
const brandStyle: React.CSSProperties = {
  color: '#dafd6f', fontSize: 11, fontWeight: 'bold', letterSpacing: 2, marginBottom: 14,
};
const bodyStyle: React.CSSProperties = { padding: '44px 44px 32px' };
const introStyle: React.CSSProperties = {
  background: '#fffbeb', borderLeft: '4px solid #facc15',
  padding: '16px 20px', borderRadius: 6, marginBottom: 36,
  fontSize: 14, color: '#713f12', lineHeight: 1.7,
};
const paragraphStyle: React.CSSProperties = {
  fontSize: 14.5, color: '#1f2937', margin: '0 0 12px 0', lineHeight: 1.75,
};
const discRowStyle: React.CSSProperties = { display: 'flex', gap: 16 };
const dataTableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 14,
  border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden',
};
const competenciaTable: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 14,
  border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden',
};
const tableHeader: React.CSSProperties = {
  background: '#0e1218', color: '#dafd6f', fontWeight: 'bold',
  textAlign: 'left', padding: '12px 14px', fontSize: 13, letterSpacing: 0.5,
};
const tableCell: React.CSSProperties = {
  padding: '12px 14px', verticalAlign: 'top', fontSize: 14,
};
const textareaStyle: React.CSSProperties = {
  width: '100%', padding: 12, borderRadius: 6, border: '1px solid #d1d5db',
  fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6, resize: 'vertical',
};
const btnApprove: React.CSSProperties = {
  flex: 1, background: '#dafd6f', color: '#0e1218', fontWeight: 'bold',
  padding: '14px 28px', border: 'none', borderRadius: 6, fontSize: 15, cursor: 'pointer',
  minWidth: 200,
};
const btnRequest: React.CSSProperties = {
  flex: 1, background: '#fff', color: '#0e1218', border: '2px solid #d1d5db',
  fontWeight: 'bold', padding: '14px 28px', borderRadius: 6, fontSize: 15, cursor: 'pointer',
  minWidth: 200,
};
