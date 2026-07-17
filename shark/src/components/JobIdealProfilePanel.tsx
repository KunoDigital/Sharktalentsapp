/**
 * JobIdealProfilePanel — muestra el perfil de cargo aprobado del puesto.
 *
 * Aparece dentro del JobDetail entre el header y el PipelineDashboard.
 * Resuelve el bug reportado por Cris 2026-06-18: después de aprobar el draft,
 * el perfil de cargo aprobado no se veía dentro del puesto.
 *
 * Muestra:
 * - Contexto y qué busca el cliente
 * - Responsabilidades + skills requeridos
 * - DISC ideal (D/I/S/C como barras horizontales)
 * - VELNA ideal (5 dimensiones)
 * - Competencias requeridas + Boss profile
 * - Reglas de auto-rechazo activas
 * - Salario, idioma, evaluaciones activas
 */
import React, { useState } from 'react';

type IdealProfile = {
  disc?: { d: number; i: number; s: number; c: number; pk_code?: string; pk_name?: string };
  disc_b?: { d: number; i: number; s: number; c: number; pk_code?: string; pk_name?: string };
  velna?: { verbal: number; espacial: number; logica: number; numerica: number; abstracta: number };
  competencias?: Array<{ name: string; required_pct: number }>;
  tecnica_minimo_pct?: number;
  context_summary?: string;
  que_busco?: string;
  que_debe_hacer?: string[];
  que_debe_saber?: string[];
  boss?: {
    name?: string;
    role?: string;
    style_autonomy_consult?: number;
    evidence_quote?: string;
  };
  auto_rejection_rules?: {
    disc_min_similarity?: number;
    velna_min_indice?: number;
    velna_per_dimension?: {
      verbal?: number; espacial?: number; logica?: number; numerica?: number; abstracta?: number;
    };
    integridad_max_riesgo?: number;
    emo_min_score?: number;
    mindset_min_adaptability?: number;
    require_english_passed?: boolean;
  };
  salary_range_usd?: { min: number; max: number };
  report_lang?: 'es' | 'en';
  english_required?: boolean;
  english_min_level?: string;
  mindset_test_enabled?: boolean;
};

export function JobIdealProfilePanel({
  idealProfile,
  context,
  englishRequired,
  englishMinLevel,
  mindsetEnabled,
}: {
  idealProfile: IdealProfile | null;
  context?: string;
  englishRequired?: boolean;
  englishMinLevel?: string;
  mindsetEnabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!idealProfile) return null;

  const ip = idealProfile;
  const evaluacionesActivas: string[] = ['Técnico (25)', 'DISC + VELNA + Emoción', 'Integridad', 'Video'];
  if (englishRequired) evaluacionesActivas.splice(1, 0, `Inglés (${englishMinLevel ?? '?'})`);
  if (mindsetEnabled) evaluacionesActivas.splice(1, 0, 'Mindset');

  const cardStyle: React.CSSProperties = {
    background: '#161a23',
    border: '1px solid #1f2937',
    borderRadius: '8px',
    padding: '1rem',
  };
  const sectionTitle: React.CSSProperties = {
    color: '#dafd6f',
    fontSize: '0.7rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '1px',
    marginBottom: '0.5rem',
  };

  return (
    <div style={{
      background: '#0e1218',
      border: '1px solid #1f2937',
      borderRadius: '8px',
      marginBottom: '1rem',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0.9rem 1.2rem',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          color: '#f3f4f6',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
          <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>{expanded ? '▼' : '▶'}</span>
          <strong style={{ fontSize: '1.05rem', color: '#dafd6f' }}>📋 Perfil de cargo aprobado</strong>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
            DISC + VELNA + Competencias + Reglas de auto-rechazo
          </span>
        </span>
        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
          {expanded ? 'Ocultar' : 'Ver perfil completo'}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: '0 1.2rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {/* Contexto */}
          {(context || ip.context_summary || ip.que_busco) && (
            <div style={cardStyle}>
              <div style={sectionTitle}>Contexto y qué busca el cliente</div>
              {ip.que_busco && <p style={{ color: '#f3f4f6', margin: '0 0 0.5rem', fontSize: '0.9rem' }}>{ip.que_busco}</p>}
              {(context || ip.context_summary) && (
                <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.85rem', lineHeight: 1.5 }}>
                  {context || ip.context_summary}
                </p>
              )}
            </div>
          )}

          {/* Responsabilidades + Requisitos */}
          {(ip.que_debe_hacer?.length || ip.que_debe_saber?.length) ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              {ip.que_debe_hacer && ip.que_debe_hacer.length > 0 && (
                <div style={cardStyle}>
                  <div style={sectionTitle}>Qué debe hacer</div>
                  <ul style={{ color: '#f3f4f6', fontSize: '0.85rem', margin: 0, paddingLeft: '1.2rem' }}>
                    {ip.que_debe_hacer.map((item, i) => (
                      <li key={i} style={{ marginBottom: '0.3rem' }}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {ip.que_debe_saber && ip.que_debe_saber.length > 0 && (
                <div style={cardStyle}>
                  <div style={sectionTitle}>Qué debe saber</div>
                  <ul style={{ color: '#f3f4f6', fontSize: '0.85rem', margin: 0, paddingLeft: '1.2rem' }}>
                    {ip.que_debe_saber.map((item, i) => (
                      <li key={i} style={{ marginBottom: '0.3rem' }}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}

          {/* DISC + VELNA + Competencias */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem' }}>
            {/* DISC ideal */}
            {ip.disc && (
              <div style={cardStyle}>
                <div style={sectionTitle}>DISC ideal {ip.disc.pk_code ? `· ${ip.disc.pk_code}` : ''}</div>
                {ip.disc.pk_name && <p style={{ color: '#94a3b8', fontSize: '0.78rem', margin: '0 0 0.5rem' }}>{ip.disc.pk_name}</p>}
                <DiscBars d={ip.disc.d} i={ip.disc.i} s={ip.disc.s} c={ip.disc.c} />
              </div>
            )}

            {/* VELNA ideal */}
            {ip.velna && (
              <div style={cardStyle}>
                <div style={sectionTitle}>VELNA ideal</div>
                <VelnaBars v={ip.velna.verbal} e={ip.velna.espacial} l={ip.velna.logica} n={ip.velna.numerica} a={ip.velna.abstracta} />
              </div>
            )}

            {/* Competencias requeridas */}
            {ip.competencias && ip.competencias.length > 0 && (
              <div style={cardStyle}>
                <div style={sectionTitle}>Competencias requeridas</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {ip.competencias.map((c, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                      <span style={{ color: '#f3f4f6' }}>{c.name}</span>
                      <strong style={{ color: '#34d399' }}>{c.required_pct}%</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Boss + Reglas auto-rechazo + Meta */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
            {/* Boss */}
            {ip.boss && (ip.boss.name || ip.boss.role) && (
              <div style={cardStyle}>
                <div style={sectionTitle}>Jefe directo</div>
                {ip.boss.name && <p style={{ color: '#f3f4f6', fontWeight: 600, margin: '0 0 0.2rem', fontSize: '0.9rem' }}>{ip.boss.name}</p>}
                {ip.boss.role && <p style={{ color: '#94a3b8', margin: '0 0 0.5rem', fontSize: '0.8rem' }}>{ip.boss.role}</p>}
                {typeof ip.boss.style_autonomy_consult === 'number' && (
                  <p style={{ color: '#94a3b8', margin: '0 0 0.3rem', fontSize: '0.78rem' }}>
                    Estilo: {ip.boss.style_autonomy_consult >= 0.65 ? 'Autonomía' : ip.boss.style_autonomy_consult <= 0.35 ? 'Consultivo' : 'Balanceado'}
                    {' '}({Math.round(ip.boss.style_autonomy_consult * 100)}% autonomía)
                  </p>
                )}
                {ip.boss.evidence_quote && (
                  <blockquote style={{ color: '#94a3b8', fontSize: '0.78rem', margin: '0.5rem 0 0', padding: '0.5rem', borderLeft: '2px solid #dafd6f', background: '#0e1218', fontStyle: 'italic' }}>
                    "{ip.boss.evidence_quote}"
                  </blockquote>
                )}
              </div>
            )}

            {/* Auto-rejection rules */}
            {ip.auto_rejection_rules && Object.keys(ip.auto_rejection_rules).length > 0 && (
              <div style={cardStyle}>
                <div style={sectionTitle}>Reglas de auto-rechazo</div>
                <ul style={{ color: '#f3f4f6', fontSize: '0.82rem', margin: 0, paddingLeft: '1.2rem' }}>
                  {ip.auto_rejection_rules.disc_min_similarity != null && (
                    <li>DISC similitud ≥ {ip.auto_rejection_rules.disc_min_similarity}%</li>
                  )}
                  {ip.auto_rejection_rules.velna_min_indice != null && (
                    <li>VELNA índice global ≥ {ip.auto_rejection_rules.velna_min_indice}</li>
                  )}
                  {ip.auto_rejection_rules.velna_per_dimension && (
                    <>
                      {ip.auto_rejection_rules.velna_per_dimension.verbal != null && <li>Verbal ≥ {ip.auto_rejection_rules.velna_per_dimension.verbal}%</li>}
                      {ip.auto_rejection_rules.velna_per_dimension.espacial != null && <li>Espacial ≥ {ip.auto_rejection_rules.velna_per_dimension.espacial}%</li>}
                      {ip.auto_rejection_rules.velna_per_dimension.logica != null && <li>Lógica ≥ {ip.auto_rejection_rules.velna_per_dimension.logica}%</li>}
                      {ip.auto_rejection_rules.velna_per_dimension.numerica != null && <li>Numérica ≥ {ip.auto_rejection_rules.velna_per_dimension.numerica}%</li>}
                      {ip.auto_rejection_rules.velna_per_dimension.abstracta != null && <li>Abstracta ≥ {ip.auto_rejection_rules.velna_per_dimension.abstracta}%</li>}
                    </>
                  )}
                  {ip.auto_rejection_rules.integridad_max_riesgo != null && (
                    <li>Integridad riesgo global ≤ {ip.auto_rejection_rules.integridad_max_riesgo}%</li>
                  )}
                  {ip.auto_rejection_rules.emo_min_score != null && (
                    <li>Emocional ≥ {ip.auto_rejection_rules.emo_min_score}</li>
                  )}
                  {ip.auto_rejection_rules.mindset_min_adaptability != null && (
                    <li>Mindset adaptabilidad ≥ {ip.auto_rejection_rules.mindset_min_adaptability}%</li>
                  )}
                  {ip.auto_rejection_rules.require_english_passed && (
                    <li>Inglés requerido</li>
                  )}
                </ul>
                <p style={{ color: '#94a3b8', fontSize: '0.72rem', margin: '0.5rem 0 0', fontStyle: 'italic' }}>
                  Integridad 5 hard rejects (Hurto/Soborno/Drogas/Alcohol/Confiabilidad) siempre activas.
                </p>
              </div>
            )}

            {/* Meta */}
            <div style={cardStyle}>
              <div style={sectionTitle}>Configuración del puesto</div>
              <div style={{ color: '#f3f4f6', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {ip.salary_range_usd && (
                  <div>💰 Salario: <strong>${ip.salary_range_usd.min} - ${ip.salary_range_usd.max} USD</strong></div>
                )}
                {ip.tecnica_minimo_pct != null && (
                  <div>🎯 Mínimo técnico: <strong>{ip.tecnica_minimo_pct}%</strong></div>
                )}
                <div>🌐 Idioma del reporte: <strong>{ip.report_lang === 'en' ? 'Inglés' : 'Español'}</strong></div>
                <div style={{ marginTop: '0.3rem', color: '#94a3b8', fontSize: '0.78rem' }}>
                  Evaluaciones activas:
                </div>
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                  {evaluacionesActivas.map((ev, i) => (
                    <span key={i} style={{
                      padding: '2px 8px', background: '#0e1218', border: '1px solid #1f2937',
                      borderRadius: '4px', fontSize: '0.72rem', color: '#dafd6f',
                    }}>{ev}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DiscBars({ d, i, s, c }: { d: number; i: number; s: number; c: number }) {
  const items = [
    { label: 'D', value: d, color: '#ef4444' },
    { label: 'I', value: i, color: '#fbbf24' },
    { label: 'S', value: s, color: '#34d399' },
    { label: 'C', value: c, color: '#3b82f6' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: item.color, fontWeight: 700, fontSize: '0.85rem', width: '16px' }}>{item.label}</span>
          <div style={{ flex: 1, height: '6px', background: '#0e1218', borderRadius: '3px', position: 'relative' }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, height: '100%',
              width: `${item.value}%`, background: item.color, borderRadius: '3px',
            }} />
          </div>
          <strong style={{ color: '#f3f4f6', fontSize: '0.78rem', minWidth: '32px', textAlign: 'right' }}>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function VelnaBars({ v, e, l, n, a }: { v: number; e: number; l: number; n: number; a: number }) {
  const items = [
    { label: 'Verbal', value: v },
    { label: 'Espacial', value: e },
    { label: 'Lógica', value: l },
    { label: 'Numérica', value: n },
    { label: 'Abstracta', value: a },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: '#94a3b8', fontSize: '0.78rem', width: '70px' }}>{item.label}</span>
          <div style={{ flex: 1, height: '6px', background: '#0e1218', borderRadius: '3px', position: 'relative' }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, height: '100%',
              width: `${item.value}%`, background: '#dafd6f', borderRadius: '3px',
            }} />
          </div>
          <strong style={{ color: '#f3f4f6', fontSize: '0.78rem', minWidth: '28px', textAlign: 'right' }}>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}
