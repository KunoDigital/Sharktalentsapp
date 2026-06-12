import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { publicApi } from '../../lib/publicApi';
import { config } from '../../config';
import { getTestSession } from '../../data/mockCandidateTests';
import './candidate-test.css';

type TestEntryView = {
  candidate_name: string;
  greeting_text: string;
  tecnica_completed: boolean;
  conductual_completed: boolean;
  integridad_completed: boolean;
  current_phase: 'tecnica' | 'conductual' | 'integridad' | 'done';
};

function stageToPhases(stage: string): Pick<TestEntryView, 'tecnica_completed' | 'conductual_completed' | 'integridad_completed' | 'current_phase'> {
  const completed = {
    tecnica: ['tecnica_completed', 'conductual_completed', 'integridad_completed', 'videos_pending', 'videos_completed', 'bot_decision_advance', 'finalist', 'offered', 'hired'].includes(stage),
    conductual: ['conductual_completed', 'integridad_completed', 'videos_pending', 'videos_completed', 'bot_decision_advance', 'finalist', 'offered', 'hired'].includes(stage),
    integridad: ['integridad_completed', 'videos_pending', 'videos_completed', 'bot_decision_advance', 'finalist', 'offered', 'hired'].includes(stage),
  };
  let current_phase: TestEntryView['current_phase'] = 'tecnica';
  if (!completed.tecnica) current_phase = 'tecnica';
  else if (!completed.conductual) current_phase = 'conductual';
  else if (!completed.integridad) current_phase = 'integridad';
  else current_phase = 'done';
  return {
    tecnica_completed: completed.tecnica,
    conductual_completed: completed.conductual,
    integridad_completed: completed.integridad,
    current_phase,
  };
}

export default function CandidateTestEntry() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<TestEntryView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) { setNotFound(true); setLoading(false); return; }
      // 1. Modo backend: validar token contra el backend.
      if (config.useApi) {
        try {
          const res = await publicApi.getTestStatus(token);
          if (cancelled) return;
          if (!res || res.expired) { setNotFound(true); setLoading(false); return; }
          setView({
            candidate_name: res.candidate?.name ?? 'candidato/a',
            greeting_text: '',
            ...stageToPhases(res.pipeline_stage),
          });
          setLoading(false);
          return;
        } catch {
          if (cancelled) return;
          // Si el backend falló, intentar mock fallback abajo (modo demo).
        }
      }
      // 2. Modo demo / fallback: mock.
      const mock = getTestSession(token);
      if (cancelled) return;
      if (!mock) { setNotFound(true); setLoading(false); return; }
      setView({
        candidate_name: mock.candidate_name,
        greeting_text: mock.greeting_text ?? '',
        tecnica_completed: mock.tecnica_completed,
        conductual_completed: mock.conductual_completed,
        integridad_completed: mock.integridad_completed,
        current_phase: mock.current_phase,
      });
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <p className="ct-help">Cargando tu evaluación…</p>
        </main>
      </div>
    );
  }

  if (notFound || !view) {
    return (
      <div className="ct-not-found">
        <h1>Link inválido o expirado</h1>
        <p>Si el link es viejo o no funciona, escribinos a <a href="mailto:cris@kunodigital.com">cris@kunodigital.com</a> y te mandamos uno nuevo.</p>
      </div>
    );
  }

  const phaseRoute =
    view.current_phase === 'tecnica' ? `/test/${token}/tecnica` :
    view.current_phase === 'conductual' ? `/test/${token}/disc` :
    view.current_phase === 'integridad' ? `/test/${token}/integridad` :
    `/test/${token}/my-progress`;

  const phaseTitle =
    view.current_phase === 'tecnica' ? 'Prueba técnica' :
    view.current_phase === 'conductual' ? 'Evaluación conductual' :
    view.current_phase === 'integridad' ? 'Prueba de integridad' :
    'Ver mi progreso';

  const phaseDuration =
    view.current_phase === 'tecnica' ? '20-30 min' :
    view.current_phase === 'conductual' ? '15-20 min' :
    view.current_phase === 'integridad' ? '10-15 min' :
    '';

  const allDone = view.current_phase === 'done';

  return (
    <div className="ct-root">
      <header className="ct-header">
        <div className="ct-brand">SharkTalents.AI</div>
        <div className="ct-brand-tag">Evaluación de talento</div>
      </header>

      <main className="ct-main">
        <div className="ct-greeting">
          <h1>Hola {view.candidate_name.split(' ')[0]} 👋</h1>
          <p className="ct-greeting-text">
            {view.greeting_text || 'Gracias por aplicar al puesto. Vamos a empezar con una serie de evaluaciones cortas.'}
          </p>
        </div>

        <section className="ct-progress">
          <h2>Tu progreso</h2>
          <div className="ct-progress-list">
            <ProgressItem
              label="1. Prueba técnica"
              done={view.tecnica_completed}
              current={view.current_phase === 'tecnica'}
            />
            <ProgressItem
              label="2. Evaluación conductual (DISC + cognitiva + emoción)"
              done={view.conductual_completed}
              current={view.current_phase === 'conductual'}
            />
            <ProgressItem
              label="3. Prueba de integridad"
              done={view.integridad_completed}
              current={view.current_phase === 'integridad'}
            />
          </div>
        </section>

        <section className="ct-current-card">
          {allDone ? (
            <>
              <div className="ct-current-tag">¡COMPLETASTE TODO!</div>
              <h2>Gracias por completar la evaluación</h2>
              <p>Vamos a revisar tu perfil y te avisamos los próximos pasos por email.</p>
              <Link to={phaseRoute} className="ct-start-btn">Ver mi progreso</Link>
            </>
          ) : (
            <>
              <div className="ct-current-tag">SIGUIENTE</div>
              <h2>{phaseTitle}</h2>
              <p>Duración estimada: <strong>{phaseDuration}</strong></p>
              <ul className="ct-rules">
                <li>Hacela en un lugar tranquilo, sin interrupciones.</li>
                <li>No salgas de esta ventana ni copies/pegues — el sistema lo detecta y queda registrado.</li>
                <li>Si tenés un problema técnico, podés volver al link y continuar donde quedaste.</li>
              </ul>
              <Link to={phaseRoute} className="ct-start-btn">
                Empezar ahora →
              </Link>
            </>
          )}
        </section>

        <p className="ct-help">
          ¿Dudas? Escribinos a <a href="mailto:cris@kunodigital.com">cris@kunodigital.com</a>
        </p>
      </main>
    </div>
  );
}

function ProgressItem({ label, done, current }: { label: string; done: boolean; current: boolean }) {
  return (
    <div className={`ct-progress-item ${done ? 'is-done' : current ? 'is-current' : ''}`}>
      <div className="ct-progress-dot">
        {done ? '✓' : current ? '●' : ''}
      </div>
      <div className="ct-progress-label">{label}</div>
      {done && <span className="ct-progress-status">Completada</span>}
      {current && <span className="ct-progress-status is-current">Próxima</span>}
    </div>
  );
}
