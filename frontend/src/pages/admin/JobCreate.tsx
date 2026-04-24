import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createJob, getCompetenciasList, getLibrary, suggestProfile } from '../../services/api';
import { PK_PROFILES, identifyPK } from '../../data/pkProfiles';
import type { CSSProperties } from 'react';

const STEPS = ['Información del puesto', 'Perfil ideal', 'Listo'];

interface AssessmentLink {
  type: string;
  link: string;
}

export default function JobCreate() {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Step 1
  const [form, setForm] = useState({
    title: '',
    company: '',
    tech_prompt: '',
    cognitive_level: 'basic',
  });

  // Step 2 — DISC
  const [disc, setDisc] = useState({ D: 50, I: 50, S: 50, C: 50 });
  // Step 2 — Cognitive
  const [cognitive, setCognitive] = useState<Record<string, number>>({
    verbal: 50, espacial: 50, logica: 50, numerica: 50, abstracta: 50,
  });
  // Step 2 — Technical min score
  const [minScore, setMinScore] = useState(60);
  // Step 2 — Competencias
  const [allCompetencias, setAllCompetencias] = useState<{ id: string; nombre: string }[]>([]);
  const [idealCompetencias, setIdealCompetencias] = useState<{ id: string; nombre: string; nivel_esperado: number }[]>([]);

  useEffect(() => { getCompetenciasList().then(setAllCompetencias).catch(() => {}); }, []);

  // Step 3 — Result
  const [createdJobId, setCreatedJobId] = useState<number | null>(null);
  const [links, setLinks] = useState<AssessmentLink[]>([]);

  const discTotal = disc.D + disc.I + disc.S + disc.C;

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleCreate = async () => {
    setSaving(true);
    try {
      const result = await createJob({
        ...form,
        ideal_profile: { disc, cognitive, min_technical_score: minScore },
        ideal_competencias: idealCompetencias.map(c => ({ id: c.id, nivel_esperado: c.nivel_esperado })),
      });
      setCreatedJobId(result.id);
      const resultLinks: AssessmentLink[] = Object.entries(result.links).map(([type, link]) => ({
        type,
        link: link as string,
      }));
      setLinks(resultLinks);
      setStep(2);
    } catch {
      alert('Error al crear el puesto');
    }
    setSaving(false);
  };

  return (
    <div>
      <Link to="/admin" style={backLink}>← Volver a puestos</Link>

      {/* Progress indicator */}
      <div style={progressContainer}>
        {STEPS.map((label, i) => (
          <div key={i} style={progressStepWrapper}>
            {i > 0 && <div style={i <= step ? lineActive : lineInactive} />}
            <div style={i <= step ? circleActive : circleInactive}>
              {i < step ? '✓' : i + 1}
            </div>
            <span style={i <= step ? stepLabelActive : stepLabelInactive}>{label}</span>
          </div>
        ))}
      </div>

      {step === 0 && (
        <StepInfo form={form} set={set} setForm={setForm} onNext={() => setStep(1)} />
      )}

      {step === 1 && (
        <StepProfile
          jobTitle={form.title}
          disc={disc}
          setDisc={setDisc}
          discTotal={discTotal}
          cognitive={cognitive}
          setCognitive={setCognitive}
          minScore={minScore}
          setMinScore={setMinScore}
          allCompetencias={allCompetencias}
          idealCompetencias={idealCompetencias}
          setIdealCompetencias={setIdealCompetencias}
          saving={saving}
          onBack={() => setStep(0)}
          onCreate={handleCreate}
        />
      )}

      {step === 2 && (
        <StepDone jobId={createdJobId!} links={links} />
      )}
    </div>
  );
}

/* ── Step 1: Info ── */
function StepInfo({
  form,
  set,
  setForm,
  onNext,
}: {
  form: { title: string; company: string; tech_prompt: string; cognitive_level: string };
  set: (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  setForm: React.Dispatch<React.SetStateAction<{ title: string; company: string; tech_prompt: string; cognitive_level: string }>>;
  onNext: () => void;
}) {
  const valid = form.title.trim() && form.company.trim();
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryItems, setLibraryItems] = useState<{ id: number; name: string; company: string | null; prompt: string; origin: string }[]>([]);
  const [previewItem, setPreviewItem] = useState<{ name: string; prompt: string } | null>(null);

  const loadLibrary = async () => {
    const items = await getLibrary();
    setLibraryItems(items);
    setShowLibrary(true);
  };

  const selectFromLibrary = (item: { name: string; prompt: string }) => {
    setPreviewItem(item);
  };

  const confirmLibrary = () => {
    if (previewItem) {
      setForm(prev => ({ ...prev, tech_prompt: previewItem.prompt }));
      setShowLibrary(false);
      setPreviewItem(null);
    }
  };

  return (
    <div style={cardStyle}>
      <h2 style={cardTitle}>Información del puesto</h2>
      <div style={formGrid}>
        <div>
          <label style={labelStyle}>Título</label>
          <input type="text" value={form.title} onChange={set('title')} placeholder="Ej: Full Stack Developer" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Empresa</label>
          <input type="text" value={form.company} onChange={set('company')} placeholder="Ej: SharkTech" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Nivel cognitivo</label>
          <select value={form.cognitive_level} onChange={set('cognitive_level')} style={inputStyle}>
            <option value="basic">Básico</option>
            <option value="mid">Medio</option>
            <option value="senior">Gerencial</option>
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Prompt técnico</label>
            <button type="button" onClick={loadLibrary} style={btnLibrary}>Cargar desde biblioteca</button>
          </div>
          <textarea
            value={form.tech_prompt}
            onChange={set('tech_prompt')}
            placeholder="Describe las tecnologías y habilidades requeridas..."
            rows={5}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
      </div>

      {/* Library modal */}
      {showLibrary && (
        <div style={libraryOverlay} onClick={() => { setShowLibrary(false); setPreviewItem(null); }}>
          <div style={libraryModal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--kuno-cream)' }}>Biblioteca técnica</h3>
              <button onClick={() => { setShowLibrary(false); setPreviewItem(null); }} style={{ background: 'transparent', border: 'none', color: 'var(--kuno-text-muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            {libraryItems.length === 0 ? (
              <p style={{ color: 'var(--kuno-text-muted)', fontSize: 14, textAlign: 'center', padding: 20 }}>No hay pruebas guardadas.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
                {libraryItems.map(item => (
                  <button key={item.id} onClick={() => selectFromLibrary(item)}
                    style={{ ...libraryItemStyle, borderColor: previewItem?.name === item.name ? 'var(--kuno-lime)' : 'var(--kuno-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--kuno-cream)' }}>{item.name}</span>
                      <span style={item.origin === 'ai' ? { background: 'rgba(218,253,111,0.15)', color: 'var(--kuno-lime)', fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 8 } : { background: 'var(--kuno-dark)', color: 'var(--kuno-text-muted)', fontSize: 9, padding: '2px 6px', borderRadius: 8 }}>
                        {item.origin === 'ai' ? 'IA' : 'Manual'}
                      </span>
                    </div>
                    {item.company && <span style={{ fontSize: 11, color: 'var(--kuno-text-muted)' }}>{item.company}</span>}
                  </button>
                ))}
              </div>
            )}
            {previewItem && (
              <div style={{ marginTop: 16, padding: 12, background: 'var(--kuno-dark-2)', borderRadius: 'var(--radius)', border: '1px solid var(--kuno-border)' }}>
                <p style={{ fontSize: 11, color: 'var(--kuno-text-muted)', marginBottom: 6 }}>Preview del prompt:</p>
                <p style={{ fontSize: 13, color: 'var(--kuno-cream)', lineHeight: 1.5, maxHeight: 80, overflow: 'hidden' }}>{previewItem.prompt}</p>
                <button onClick={confirmLibrary} style={{ ...btnPrimary, marginTop: 12, width: '100%' }}>Usar este prompt</button>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={btnRow}>
        <div />
        <button onClick={onNext} disabled={!valid} style={valid ? btnPrimary : btnDisabled}>
          Siguiente →
        </button>
      </div>
    </div>
  );
}

/* ── Step 2: Profile ── */
function StepProfile({
  jobTitle,
  disc, setDisc, discTotal,
  cognitive, setCognitive,
  minScore, setMinScore,
  allCompetencias, idealCompetencias, setIdealCompetencias,
  saving, onBack, onCreate,
}: {
  jobTitle: string;
  disc: Record<string, number>;
  setDisc: React.Dispatch<React.SetStateAction<{ D: number; I: number; S: number; C: number }>>;
  discTotal: number;
  cognitive: Record<string, number>;
  setCognitive: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  minScore: number;
  setMinScore: (v: number) => void;
  allCompetencias: { id: string; nombre: string }[];
  idealCompetencias: { id: string; nombre: string; nivel_esperado: number }[];
  setIdealCompetencias: React.Dispatch<React.SetStateAction<{ id: string; nombre: string; nivel_esperado: number }[]>>;
  saving: boolean;
  onBack: () => void;
  onCreate: () => void;
}) {
  const discLabels: Record<string, string> = { D: 'Dominancia', I: 'Influencia', S: 'Estabilidad', C: 'Cumplimiento' };
  const cogLabels: Record<string, string> = {
    verbal: 'Verbal', espacial: 'Espacial', logica: 'Lógica', numerica: 'Numérica', abstracta: 'Abstracta',
  };

  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);

  const handleSuggest = async () => {
    setSuggesting(true);
    setSuggested(false);
    try {
      const result = await suggestProfile({
        jobTitle,
        competencias: idealCompetencias.map(c => ({ id: c.id, nombre: c.nombre })),
      });
      if (result.disc) {
        setDisc({ D: result.disc.D || 50, I: result.disc.I || 50, S: result.disc.S || 50, C: result.disc.C || 50 });
      }
      if (result.velna) {
        setCognitive({
          verbal: result.velna.verbal || 50,
          espacial: result.velna.espacial || 50,
          logica: result.velna.logica || 50,
          numerica: result.velna.numerica || 50,
          abstracta: result.velna.abstracta || 50,
        });
      }
      setSuggested(true);
    } catch {
      alert('Error al generar sugerencia');
    }
    setSuggesting(false);
  };

  const availableCompetencias = allCompetencias.filter(c => !idealCompetencias.find(ic => ic.id === c.id));
  const canAdd = idealCompetencias.length < 5;

  const addCompetencia = (id: string) => {
    const comp = allCompetencias.find(c => c.id === id);
    if (!comp || idealCompetencias.length >= 5) return;
    setIdealCompetencias(prev => [...prev, { id: comp.id, nombre: comp.nombre, nivel_esperado: 60 }]);
  };

  const removeCompetencia = (id: string) => {
    setIdealCompetencias(prev => prev.filter(c => c.id !== id));
  };

  const updateNivel = (id: string, nivel: number) => {
    setIdealCompetencias(prev => prev.map(c => c.id === id ? { ...c, nivel_esperado: nivel } : c));
  };

  return (
    <div style={cardStyle}>
      <h2 style={cardTitle}>Perfil ideal</h2>

      {/* DISC */}
      <div style={sectionBlock}>
        <div style={sectionHeader}>
          <h3 style={sectionLabel}>Perfil DISC</h3>
          <span style={discTotal > 200 ? counterDanger : counterNormal}>
            {discTotal} / 200
          </span>
        </div>

        {/* PK Selector */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: 'var(--kuno-text-muted)', marginBottom: 6, display: 'block' }}>Cargar desde perfil Kudert (PK):</label>
          <select
            onChange={e => {
              const pk = PK_PROFILES.find(p => p.id === e.target.value);
              if (pk) setDisc({ D: pk.D, I: pk.I, S: pk.S, C: pk.C });
              e.target.value = '';
            }}
            value=""
            style={{ width: '100%', padding: '10px 14px', background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', color: 'var(--kuno-cream)', fontSize: 13 }}
          >
            <option value="">Seleccionar un perfil PK...</option>
            {PK_PROFILES.map(pk => (
              <option key={pk.id} value={pk.id}>
                {pk.id} — {pk.name} (D:{pk.D} I:{pk.I} S:{pk.S} C:{pk.C})
              </option>
            ))}
          </select>
        </div>

        {Object.entries(discLabels).map(([key, label]) => (
          <SliderRow
            key={key}
            label={label}
            value={disc[key]}
            max={100}
            onChange={v => setDisc(prev => ({ ...prev, [key]: v }))}
          />
        ))}

        {/* Detected PK */}
        {(() => {
          const detected = identifyPK(disc);
          if (!detected) return null;
          return (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--kuno-dark-2)', borderRadius: 'var(--radius)', border: '1px solid var(--kuno-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ background: 'var(--kuno-lime)', color: 'var(--kuno-dark)', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>{detected.id}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--kuno-cream)' }}>{detected.name}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {detected.traits.map((t, i) => (
                  <span key={i} style={{ fontSize: 12, color: 'var(--kuno-text-muted)' }}>• {t}</span>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Cognitive */}
      <div style={sectionBlock}>
        <h3 style={sectionLabel}>Habilidades cognitivas</h3>
        {Object.entries(cogLabels).map(([key, label]) => (
          <SliderRow
            key={key}
            label={label}
            value={cognitive[key]}
            max={100}
            onChange={v => setCognitive(prev => ({ ...prev, [key]: v }))}
          />
        ))}
      </div>

      {/* Technical */}
      <div style={sectionBlock}>
        <h3 style={sectionLabel}>Puntaje técnico mínimo</h3>
        <div style={sliderRow}>
          <span style={sliderLabel}>Mínimo aceptable</span>
          <input
            type="number"
            min={0}
            max={100}
            value={minScore}
            onChange={e => setMinScore(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
            style={{ ...inputStyle, width: 80, textAlign: 'center' }}
          />
          <span style={sliderValue}>%</span>
        </div>
      </div>

      {/* Competencias */}
      <div style={sectionBlock}>
        <div style={sectionHeader}>
          <h3 style={sectionLabel}>Competencias ideales</h3>
          <span style={counterNormal}>{idealCompetencias.length} / 5</span>
        </div>

        {idealCompetencias.map(c => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ ...sliderLabel, flex: 1 }}>{c.nombre}</span>
            <SliderRow label="" value={c.nivel_esperado} max={100} onChange={v => updateNivel(c.id, v)} />
            <button onClick={() => removeCompetencia(c.id)} style={btnRemoveComp}>✕</button>
          </div>
        ))}

        {canAdd && (
          <select
            onChange={e => { addCompetencia(e.target.value); e.target.value = ''; }}
            value=""
            style={{ ...inputStyle, marginTop: 8 }}
          >
            <option value="">+ Agregar competencia...</option>
            {availableCompetencias.map(c => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        )}
      </div>

      {/* Suggest button */}
      {idealCompetencias.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <button onClick={handleSuggest} disabled={suggesting} style={suggesting ? btnSuggestLoading : btnSuggest}>
            {suggesting ? 'Analizando competencias...' : 'Sugerir perfil ideal'}
          </button>
          {suggested && (
            <p style={{ fontSize: 12, color: 'var(--kuno-lime)', marginTop: 8 }}>
              Perfil sugerido basado en las competencias seleccionadas. Puedes ajustarlo.
            </p>
          )}
        </div>
      )}

      <div style={btnRow}>
        <button onClick={onBack} style={btnSecondary}>← Atrás</button>
        <button onClick={onCreate} disabled={saving || discTotal > 200} style={!saving && discTotal <= 200 ? btnPrimary : btnDisabled}>
          {saving ? 'Creando...' : 'Crear puesto →'}
        </button>
      </div>
    </div>
  );
}

/* ── Step 3: Done ── */
function StepDone({ jobId, links }: { jobId: number; links: AssessmentLink[] }) {
  const typeLabels: Record<string, string> = {
    technical: 'Técnica', disc: 'DISC', cognitive: 'Cognitiva', integrity: 'Integridad',
  };

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={successIcon}>
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <path d="M14 24L21 31L34 18" stroke="var(--kuno-lime)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--kuno-cream)', marginBottom: 8 }}>¡Puesto creado!</h2>
      <p style={{ color: 'var(--kuno-text-muted)', fontSize: 14, marginBottom: 32 }}>
        Se generaron las 4 pruebas automáticamente.
      </p>

      <div style={linksGrid}>
        {links.map(l => (
          <LinkCard key={l.type} type={l.type} label={typeLabels[l.type] || l.type} link={l.link} />
        ))}
      </div>

      <Link to={`/admin/jobs/${jobId}`}>
        <button style={{ ...btnPrimary, marginTop: 32 }}>Ir al puesto →</button>
      </Link>
    </div>
  );
}

function LinkCard({ type: _type, label, link }: { type: string; label: string; link: string }) {
  const [copied, setCopied] = useState(false);
  const appBase = window.location.pathname.includes('/app') ? '/app/index.html' : '';
  const fullLink = `${window.location.origin}${appBase}#${link}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(fullLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={linkCardStyle}>
      <span style={typeBadge}>{label}</span>
      <p style={{ fontSize: 11, color: 'var(--kuno-text-muted)', marginTop: 12, wordBreak: 'break-all', textAlign: 'left' }}>
        {fullLink}
      </p>
      <button onClick={handleCopy} style={copied ? btnCopied : btnCopy}>
        {copied ? '¡Copiado!' : 'Copiar link'}
      </button>
    </div>
  );
}

/* ── Slider ── */
function SliderRow({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  const pct = (value / max) * 100;

  return (
    <div style={sliderRow}>
      <span style={sliderLabel}>{label}</span>
      <div style={sliderTrack}>
        <input
          type="range"
          min={0}
          max={max}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={sliderInput}
        />
        <div style={{ ...sliderFill, width: `${pct}%` }} />
      </div>
      <span style={sliderValue}>{value}</span>
    </div>
  );
}

/* ── Styles ── */
const backLink: CSSProperties = {
  color: 'var(--kuno-text-muted)',
  fontSize: 14,
  display: 'inline-block',
  marginBottom: 20,
};

const progressContainer: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 0,
  marginBottom: 36,
};

const progressStepWrapper: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 0,
};

const circleBase: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 13,
  fontWeight: 600,
  flexShrink: 0,
};

const circleActive: CSSProperties = {
  ...circleBase,
  background: 'var(--kuno-lime)',
  color: 'var(--kuno-dark)',
};

const circleInactive: CSSProperties = {
  ...circleBase,
  background: 'var(--kuno-border)',
  color: 'var(--kuno-text-muted)',
};

const lineBase: CSSProperties = {
  width: 60,
  height: 2,
  flexShrink: 0,
};

const lineActive: CSSProperties = { ...lineBase, background: 'var(--kuno-lime)' };
const lineInactive: CSSProperties = { ...lineBase, background: 'var(--kuno-border)' };

const stepLabelActive: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--kuno-cream)',
  marginLeft: 8,
  marginRight: 8,
  whiteSpace: 'nowrap',
};

const stepLabelInactive: CSSProperties = {
  ...stepLabelActive,
  color: 'var(--kuno-text-muted)',
};

const cardStyle: CSSProperties = {
  background: 'var(--kuno-dark)',
  border: '1px solid var(--kuno-border)',
  borderRadius: 'var(--radius-lg)',
  padding: 32,
  maxWidth: 640,
};

const cardTitle: CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--kuno-cream)',
  marginBottom: 24,
};

const formGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 18,
};

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--kuno-text-muted)',
  marginBottom: 6,
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: 'var(--kuno-dark-2)',
  border: '1px solid var(--kuno-border)',
  borderRadius: 'var(--radius)',
  color: 'var(--kuno-cream)',
  fontSize: 14,
};

const btnRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: 28,
};

const btnPrimary: CSSProperties = {
  background: 'var(--kuno-lime)',
  color: 'var(--kuno-dark)',
  fontWeight: 600,
  fontSize: 14,
  padding: '12px 24px',
  borderRadius: 'var(--radius)',
  border: 'none',
};

const btnDisabled: CSSProperties = {
  ...btnPrimary,
  opacity: 0.4,
  cursor: 'not-allowed',
};

const btnSuggest: CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: '1px solid var(--kuno-lime)',
  color: 'var(--kuno-lime)',
  fontWeight: 600,
  fontSize: 14,
  padding: '10px 20px',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
};

const btnSuggestLoading: CSSProperties = {
  ...btnSuggest,
  opacity: 0.6,
  cursor: 'wait',
};

const btnLibrary: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--kuno-border)',
  color: 'var(--kuno-text-muted)',
  fontSize: 12,
  fontWeight: 500,
  padding: '4px 12px',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
};

const libraryOverlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const libraryModal: CSSProperties = { background: 'var(--kuno-dark)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius-lg)', padding: 24, width: '100%', maxWidth: 480, maxHeight: '80vh', overflow: 'auto' };
const libraryItemStyle: CSSProperties = { background: 'var(--kuno-dark-2)', border: '1px solid var(--kuno-border)', borderRadius: 'var(--radius)', padding: '10px 14px', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4 };

const btnSecondary: CSSProperties = {
  background: 'transparent',
  color: 'var(--kuno-text-muted)',
  fontWeight: 500,
  fontSize: 14,
  padding: '12px 24px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--kuno-border)',
};

const sectionBlock: CSSProperties = {
  marginBottom: 28,
};

const sectionHeader: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 14,
};

const sectionLabel: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--kuno-cream)',
  marginBottom: 14,
};

const counterNormal: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--kuno-lime)',
  padding: '2px 10px',
  borderRadius: 12,
  background: 'rgba(218, 253, 111, 0.1)',
};

const counterDanger: CSSProperties = {
  ...counterNormal,
  color: 'var(--kuno-danger)',
  background: 'rgba(231, 76, 60, 0.15)',
};

const btnRemoveComp: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--kuno-danger)',
  fontSize: 16,
  cursor: 'pointer',
  padding: '2px 6px',
  flexShrink: 0,
};

const sliderRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  marginBottom: 10,
};

const sliderLabel: CSSProperties = {
  fontSize: 13,
  color: 'var(--kuno-text-muted)',
  width: 110,
  flexShrink: 0,
};

const sliderTrack: CSSProperties = {
  flex: 1,
  height: 6,
  background: 'var(--kuno-dark-2)',
  borderRadius: 3,
  position: 'relative',
  overflow: 'hidden',
};

const sliderInput: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  opacity: 0,
  cursor: 'pointer',
  zIndex: 2,
  margin: 0,
};

const sliderFill: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  height: '100%',
  background: 'var(--kuno-lime)',
  borderRadius: 3,
  transition: 'width 0.1s',
  pointerEvents: 'none',
};

const sliderValue: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--kuno-cream)',
  width: 36,
  textAlign: 'right',
  flexShrink: 0,
};

const successIcon: CSSProperties = {
  width: 80,
  height: 80,
  borderRadius: '50%',
  border: '2px solid var(--kuno-lime)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: '0 auto 20px',
};

const linksGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 14,
  textAlign: 'left',
};

const linkCardStyle: CSSProperties = {
  background: 'var(--kuno-dark)',
  border: '1px solid var(--kuno-border)',
  borderRadius: 'var(--radius-lg)',
  padding: 18,
  display: 'flex',
  flexDirection: 'column',
};

const typeBadge: CSSProperties = {
  background: 'var(--kuno-lime)',
  color: 'var(--kuno-dark)',
  fontSize: 12,
  fontWeight: 600,
  padding: '4px 12px',
  borderRadius: 20,
  alignSelf: 'flex-start',
};

const btnCopy: CSSProperties = {
  marginTop: 14,
  background: 'transparent',
  border: '1px solid var(--kuno-lime)',
  color: 'var(--kuno-lime)',
  fontSize: 13,
  fontWeight: 500,
  padding: '7px 14px',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
  alignSelf: 'flex-start',
};

const btnCopied: CSSProperties = {
  ...btnCopy,
  background: 'var(--kuno-lime)',
  color: 'var(--kuno-dark)',
  fontWeight: 600,
};
