import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import './client-draft-review.css';

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
  // 2026-06-06: nuevos campos del prompt nuevo (A + B + tensiones).
  // Si vienen, mostramos el bloque comparativo. Si no, fallback al disc_ideal único.
  disc_ideal_a?: ClientDiscProfile;
  disc_ideal_b?: ClientDiscProfile;
  tensiones_detectadas?: Array<{ ejes?: string; descripcion?: string }>;
  velna_ideal?: { verbal?: number; espacial?: number; logica?: number; numerica?: number; abstracta?: number };
  competencias?: Array<{ name: string; required_pct: number; que_evaluamos?: string }>;
  salary_range_usd?: { min?: number; max?: number };
  tecnica_minimo_pct?: number;
};

type ClientDiscProfile = {
  patron?: string;
  pk_profile_code?: string;
  pk_profile_name?: string;
  d?: number; i?: number; s?: number; c?: number;
  description?: string[] | string;
  gana_en?: string[];
  sacrifica?: string[];
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
  const [showApprovalForm, setShowApprovalForm] = useState(false);
  const [clientForm, setClientForm] = useState({
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    company: '',
    ruc_nit: '',
    address_street: '',
    address_city: '',
    address_state: '',
    address_country: '',
  });
  const [formError, setFormError] = useState<string | null>(null);

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

  function handleApprove() {
    setActionResult(null);
    setFormError(null);
    setClientForm((prev) => ({
      ...prev,
      contact_name: prev.contact_name || data?.client_name || '',
      company: prev.company || data?.client_company || '',
    }));
    setShowApprovalForm(true);
  }

  async function submitApprovalWithData() {
    if (!token || !draftId) return;
    const required: Array<[keyof typeof clientForm, string]> = [
      ['contact_name', 'Nombre del firmante'],
      ['contact_email', 'Email'],
      ['company', 'Empresa'],
      ['ruc_nit', 'RUC / NIT'],
      ['address_street', 'Calle'],
      ['address_city', 'Ciudad'],
      ['address_country', 'País'],
    ];
    const missing = required.find(([key]) => !clientForm[key].trim());
    if (missing) {
      setFormError(`Completá: ${missing[1]}`);
      return;
    }
    setAction('approving');
    setFormError(null);
    setActionResult(null);
    try {
      const response = await fetch(
        `${config.apiBase.replace(/\/$/, '')}/portal/${encodeURIComponent(token)}/drafts/${encodeURIComponent(draftId)}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_comment: comment.trim() || undefined,
            client_data: {
              contact_name: clientForm.contact_name.trim(),
              contact_email: clientForm.contact_email.trim(),
              contact_phone: clientForm.contact_phone.trim() || undefined,
              company: clientForm.company.trim(),
              ruc_nit: clientForm.ruc_nit.trim(),
              address_street: clientForm.address_street.trim(),
              address_city: clientForm.address_city.trim() || undefined,
              address_state: clientForm.address_state.trim() || undefined,
              address_country: clientForm.address_country.trim(),
            },
          }),
        },
      );
      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson?.error?.message ?? `Error ${response.status}`);
      }
      setShowApprovalForm(false);
      setActionResult({ ok: true, msg: `¡Listo! Vamos a iniciar la búsqueda. En los próximos minutos te llega el contrato a ${clientForm.contact_email} para firmar.` });
    } catch (err) {
      setActionResult({ ok: false, msg: `No se pudo aprobar: ${(err as Error).message}` });
    } finally {
      setAction('idle');
    }
  }

  async function handleRequestChanges() {
    if (!token || !draftId) return;
    if (!comment.trim()) {
      setActionResult({ ok: false, msg: 'Antes de pedir cambios escribe qué necesitas ajustar.' });
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

  // Datos básicos del puesto SIN duplicar Modalidad/Viajes/Salario (esos van en
  // "Condiciones" abajo). Cargo tampoco — ya aparece en el header h1 grande.
  const datosBasicos: Array<[string, string | undefined]> = [
    ['Empresa', p.company],
    ['Sector', p.sector],
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
      <div className="client-draft-card" style={cardStyle}>
        {/* HEADER */}
        <div className="client-draft-card-header" style={headerStyle}>
          <div style={brandStyle}>{data.agency_name.toUpperCase()} · PERFIL DE CARGO</div>
          <h1 style={{ fontSize: 32, fontWeight: 'bold', margin: 0, marginBottom: 6, lineHeight: 1.15 }}>
            {p.title ?? 'Perfil del puesto'}
          </h1>
          <div style={{ color: '#8a93a3', fontSize: 14 }}>
            Para: <strong style={{ color: '#dafd6f' }}>{p.company || data.client_company}</strong>
            {data.client_name && ` · ${data.client_name}`}
          </div>
        </div>

        <div className="client-draft-card-body" style={bodyStyle}>
          <div style={introStyle}>
            Después de nuestra reunión armamos este perfil del puesto. Antes de empezar a buscar candidatos
            necesitamos que <strong>tú confirmes</strong> que está alineado con lo que necesitas.
            Si algo no encaja, puedes pedir cambios y volvemos con una versión ajustada.
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
                  <strong style={{ color: '#0e1218' }}>Formación:</strong> {p.formacion_requerida}
                </p>
              )}
              {p.experiencia_requerida && (
                <p style={paragraphStyle}>
                  <strong style={{ color: '#0e1218' }}>Experiencia:</strong> {p.experiencia_requerida}
                </p>
              )}
            </Section>
          )}

          {/* === BLOQUE NUEVO: Perfiles A y B side-by-side ===
              Se muestra solo si el draft tiene los campos nuevos (disc_ideal_a/b).
              Para drafts viejos, cae al render de disc_ideal único de abajo. */}
          {(p.disc_ideal_a || p.disc_ideal_b) && (
            <Section title="Tipo de personas que buscamos">
              <p style={{ ...paragraphStyle, marginBottom: 8, fontStyle: 'italic' }}>
                Vamos a buscar <strong>dos perfiles</strong> distintos. Las personas no son perfectas — cada perfil cubre el rol con un énfasis diferente. <strong>No elegís uno, los buscamos a los dos en paralelo.</strong>
              </p>
              {p.tensiones_detectadas && p.tensiones_detectadas.length > 0 && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 18, marginBottom: 22 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#92400e', marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    ⚠ Por qué dos perfiles
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 20, color: '#78350f', lineHeight: 1.7, fontSize: 16 }}>
                    {p.tensiones_detectadas.map((t, i) => (
                      <li key={i}><strong>{t.ejes}:</strong> {t.descripcion}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 22 }}>
                {p.disc_ideal_a && <ClientDiscCard label="Perfil A" profile={p.disc_ideal_a} accentLight="#ecfccb" accentDark="#65a30d" />}
                {p.disc_ideal_b && <ClientDiscCard label="Perfil B" profile={p.disc_ideal_b} accentLight="#dbeafe" accentDark="#2563eb" />}
              </div>
            </Section>
          )}

          {/* Tipo de persona (DISC humano) — solo si NO hay A/B (compat drafts viejos) */}
          {!p.disc_ideal_a && !p.disc_ideal_b && (p.disc_perfil_descripcion || p.disc_ideal) && (
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
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#166534', marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    ✓ Esta persona va a poder
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 20, color: '#15803d', lineHeight: 1.7, fontSize: 16 }}>
                    {p.disc_ventajas.map((v, i) => <li key={i}>{v}</li>)}
                  </ul>
                </div>
              )}

              {p.disc_desventajas_potenciales && p.disc_desventajas_potenciales.length > 0 && (
                <div style={{ marginTop: 14, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 18 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#92400e', marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    ⚠ Posibles desventajas / a tomar en cuenta
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 20, color: '#78350f', lineHeight: 1.7, fontSize: 16 }}>
                    {p.disc_desventajas_potenciales.map((v, i) => <li key={i}>{v}</li>)}
                  </ul>
                </div>
              )}
            </Section>
          )}

          {/* Capacidad cognitiva */}
          {p.velna_ideal && (
            <Section title="Capacidad cognitiva esperada" subtitle="VELNA — razonamiento sobre 5 dimensiones">
              <div className="client-draft-velna-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
                {(['verbal', 'espacial', 'logica', 'numerica', 'abstracta'] as const).map((k) => {
                  const v = p.velna_ideal?.[k] ?? 0;
                  return (
                    <div key={k} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 13, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>{VELNA_LABELS[k]}</div>
                      <div style={{ fontSize: 24, fontWeight: 'bold', color: '#0e1218' }}>{v}%</div>
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
          {!decided && !showApprovalForm && (
            <Section title="¿Apruebas este perfil?" subtitle="Una vez que apruebes, te pediremos algunos datos para el contrato y arrancamos la búsqueda de candidatos.">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Comentarios (opcional si apruebas · obligatorio si pides cambios)…"
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
                  ✓ Aprobar el perfil
                </button>
                <button onClick={handleRequestChanges} disabled={action !== 'idle'} style={btnRequest}>
                  {action === 'requesting' ? 'Enviando…' : '✏️ Pedir cambios'}
                </button>
              </div>
            </Section>
          )}

          {/* Formulario embebido pre-aprobación: datos para el contrato.
              Aparece después de tocar "Aprobar el perfil". Al submit pushea
              al CRM (Lead con layout Sharktalents) y dispara el contrato Sign. */}
          {!decided && showApprovalForm && (
            <Section
              title="Antes de iniciar: datos para el contrato"
              subtitle="Necesitamos estos datos para enviarte el contrato. Te toma 2 minutos. Los datos van directo a nuestro CRM, no se comparten."
            >
              <div style={{ display: 'grid', gap: 18 }}>
                <div>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: 15, color: '#0e1218', fontWeight: 600 }}>Datos del firmante</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                    <Field label="Nombre completo" required value={clientForm.contact_name} onChange={(v) => setClientForm({ ...clientForm, contact_name: v })} />
                    <Field label="Email" type="email" required value={clientForm.contact_email} onChange={(v) => setClientForm({ ...clientForm, contact_email: v })} />
                    <Field label="Teléfono" value={clientForm.contact_phone} onChange={(v) => setClientForm({ ...clientForm, contact_phone: v })} />
                  </div>
                </div>

                <div>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: 15, color: '#0e1218', fontWeight: 600 }}>Empresa</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                    <Field label="Empresa" required value={clientForm.company} onChange={(v) => setClientForm({ ...clientForm, company: v })} />
                    <Field label="RUC / NIT" required value={clientForm.ruc_nit} onChange={(v) => setClientForm({ ...clientForm, ruc_nit: v })} />
                  </div>
                </div>

                <div>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: 15, color: '#0e1218', fontWeight: 600 }}>Dirección fiscal</h4>
                  <div style={{ display: 'grid', gap: 12 }}>
                    <Field label="Calle y número" required value={clientForm.address_street} onChange={(v) => setClientForm({ ...clientForm, address_street: v })} />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                      <Field label="Ciudad" required value={clientForm.address_city} onChange={(v) => setClientForm({ ...clientForm, address_city: v })} />
                      <Field label="Estado/Provincia" value={clientForm.address_state} onChange={(v) => setClientForm({ ...clientForm, address_state: v })} />
                      <Field label="País" required value={clientForm.address_country} onChange={(v) => setClientForm({ ...clientForm, address_country: v })} />
                    </div>
                  </div>
                </div>
              </div>

              {formError && (
                <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 14 }}>
                  {formError}
                </div>
              )}
              {actionResult && !actionResult.ok && (
                <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 14 }}>
                  {actionResult.msg}
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
                <button onClick={submitApprovalWithData} disabled={action !== 'idle'} style={btnApprove}>
                  {action === 'approving' ? 'Guardando…' : 'Guardar y aprobar'}
                </button>
                <button onClick={() => setShowApprovalForm(false)} disabled={action !== 'idle'} style={btnRequest}>
                  ← Volver
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
  return <div className="client-draft-page-wrapper" style={pageStyle}>{children}</div>;
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

function Field({
  label, value, onChange, required, type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: 'text' | 'email';
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', fontSize: 13, color: '#374151', gap: 6, minWidth: 0 }}>
      <span style={{ fontWeight: 500 }}>
        {label}{required && <span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>}
      </span>
      <input
        type={type ?? 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '10px 12px', borderRadius: 6, border: '1px solid #d1d5db',
          fontFamily: 'inherit', fontSize: 16, color: '#1f2937', background: '#fff',
          width: '100%', boxSizing: 'border-box', minWidth: 0,
        }}
      />
    </label>
  );
}

const pageStyle: React.CSSProperties = {
  // Padding lo maneja el CSS class `.client-draft-page-wrapper` para responsive.
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  background: '#f3f4f6', color: '#1f2937', lineHeight: 1.6, minHeight: '100vh',
};
const cardStyle: React.CSSProperties = {
  // Width + maxWidth se setean por el CSS class `.client-draft-card` para que el media
  // query mobile pueda sobreescribir (inline styles pisan a las clases).
  margin: '0 auto', background: '#fff',
  borderRadius: 12, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
};
const headerStyle: React.CSSProperties = {
  background: '#0e1218', color: '#fff', padding: '36px 40px',
  borderBottom: '4px solid #dafd6f',
};
const brandStyle: React.CSSProperties = {
  color: '#dafd6f', fontSize: 13, fontWeight: 'bold', letterSpacing: 2, marginBottom: 16,
};
// 2026-06-06: padding reducido de 52/56 → 32/40 para que no sobre tanto margen
// blanco en desktop. Mobile sigue sobrescribiendo por CSS class.
const bodyStyle: React.CSSProperties = { padding: '32px 40px 28px' };
const introStyle: React.CSSProperties = {
  background: '#fffbeb', borderLeft: '4px solid #facc15',
  padding: '20px 24px', borderRadius: 6, marginBottom: 40,
  fontSize: 16, color: '#713f12', lineHeight: 1.7,
};
const paragraphStyle: React.CSSProperties = {
  fontSize: 16, color: '#1f2937', margin: '0 0 14px 0', lineHeight: 1.75,
};
const discRowStyle: React.CSSProperties = { display: 'flex', gap: 16 };
const dataTableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 16,
  border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden',
};
const competenciaTable: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 16,
  border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden',
};
const tableHeader: React.CSSProperties = {
  background: '#0e1218', color: '#dafd6f', fontWeight: 'bold',
  textAlign: 'left', padding: '14px 16px', fontSize: 14, letterSpacing: 0.5,
};
const tableCell: React.CSSProperties = {
  padding: '14px 16px', verticalAlign: 'top', fontSize: 15,
};
const textareaStyle: React.CSSProperties = {
  width: '100%', padding: 14, borderRadius: 6, border: '1px solid #d1d5db',
  fontFamily: 'inherit', fontSize: 16, lineHeight: 1.6, resize: 'vertical',
};
const btnApprove: React.CSSProperties = {
  flex: 1, background: '#dafd6f', color: '#0e1218', fontWeight: 'bold',
  padding: '16px 32px', border: 'none', borderRadius: 6, fontSize: 16, cursor: 'pointer',
  minWidth: 200,
};
const btnRequest: React.CSSProperties = {
  flex: 1, background: '#fff', color: '#0e1218', border: '2px solid #d1d5db',
  fontWeight: 'bold', padding: '16px 32px', borderRadius: 6, fontSize: 16, cursor: 'pointer',
  minWidth: 200,
};

/**
 * Card del perfil DISC para el cliente (vista pública). Muestra el perfil con:
 *   - Header: Label (Perfil A / B) + PK code/name
 *   - Patrón breve (curva)
 *   - Barras DISC vertical estilo gráfico clásico
 *   - Description (puntos clave)
 *   - Gana / Sacrifica
 *
 * Diseño: lenguaje cliente, sin tecnicismos. Colores suaves (verde / azul) para distinguir A y B.
 */
function ClientDiscCard({ label, profile, accentLight, accentDark }: { label: string; profile: ClientDiscProfile; accentLight: string; accentDark: string }) {
  const description = Array.isArray(profile.description) ? profile.description : (typeof profile.description === 'string' ? [profile.description] : []);
  return (
    <div style={{
      background: accentLight,
      border: `2px solid ${accentDark}`,
      borderRadius: 10,
      padding: '20px 22px',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ color: accentDark, fontSize: 15, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</strong>
        {profile.pk_profile_code && <span style={{ fontSize: 14, color: '#4b5563', fontWeight: 600 }}>{profile.pk_profile_code}</span>}
      </div>
      {profile.pk_profile_name && (
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#0e1218', lineHeight: 1.3 }}>{profile.pk_profile_name}</div>
      )}
      {profile.patron && (
        <p style={{ margin: '0 0 24px', fontSize: 15, fontStyle: 'italic', color: '#4b5563', lineHeight: 1.5 }}>{profile.patron}</p>
      )}

      {/* Mini gráfico DISC con barras verticales — más alto + margen del header para que no se solape */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-around', alignItems: 'flex-end', height: 120, marginBottom: 20 }}>
        {(['D', 'I', 'S', 'C'] as const).map((d) => {
          const v = profile[d.toLowerCase() as 'd' | 'i' | 's' | 'c'] ?? 0;
          return (
            <div key={d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: '100%', height: 86, background: '#ffffff', borderRadius: 4, display: 'flex', alignItems: 'flex-end', overflow: 'hidden', border: '1px solid #d1d5db' }}>
                <div style={{ width: '100%', height: `${v}%`, background: DISC_COLORS[d], minHeight: 2 }} />
              </div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6, fontWeight: 600 }}>{d}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: DISC_COLORS[d] }}>{v}</div>
            </div>
          );
        })}
      </div>

      {/* Description (3 puntos clave) */}
      {description.length > 0 && (
        <ul style={{ margin: '0 0 16px', paddingLeft: 18, fontSize: 15, color: '#1f2937', lineHeight: 1.6 }}>
          {description.slice(0, 3).map((d, i) => <li key={i} style={{ marginBottom: 6 }}>{d}</li>)}
        </ul>
      )}

      {/* Gana en */}
      {profile.gana_en && profile.gana_en.length > 0 && (
        <div style={{ background: '#ffffff', border: '1px solid #d1d5db', borderRadius: 6, padding: 12, marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d', letterSpacing: 0.5, marginBottom: 6 }}>✓ APORTA</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: '#166534', lineHeight: 1.6 }}>
            {profile.gana_en.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </div>
      )}

      {/* Sacrifica */}
      {profile.sacrifica && profile.sacrifica.length > 0 && (
        <div style={{ background: '#ffffff', border: '1px solid #d1d5db', borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#b45309', letterSpacing: 0.5, marginBottom: 6 }}>⚠ TEN EN CUENTA</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: '#78350f', lineHeight: 1.6 }}>
            {profile.sacrifica.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
