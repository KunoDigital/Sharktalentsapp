import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { publicApi } from '../../lib/publicApi';
import { config } from '../../config';
import { getTestSession } from '../../data/mockCandidateTests';
import './candidate-test.css';

type TestEntryView = {
  candidate_name: string;
  greeting_text: string;
  prefilter_completed: boolean;
  tecnica_completed: boolean;
  conductual_completed: boolean;
  integridad_completed: boolean;
  video_completed: boolean;
  // 'video' agregado 2026-06-29 — antes el frontend ignoraba pipeline_stage='videos_pending'
  // y caía a 'prefilter' por default.
  current_phase: 'prefilter' | 'tecnica' | 'conductual' | 'integridad' | 'video' | 'done';
};

function stageToPhases(stage: string): Pick<TestEntryView, 'prefilter_completed' | 'tecnica_completed' | 'conductual_completed' | 'integridad_completed' | 'video_completed' | 'current_phase'> {
  // 2026-06-18: agregada fase Prefiltro como paso 0.
  // 2026-06-29: agregada fase Video. Stage canónico = 'videos_pending' / 'videos_completed'.
  const completed = {
    prefilter: ['prefilter_passed', 'tecnica_completed', 'conductual_completed', 'integridad_completed', 'videos_pending', 'videos_completed', 'bot_decision_advance', 'finalist', 'offered', 'hired'].includes(stage),
    tecnica: ['tecnica_completed', 'conductual_completed', 'integridad_completed', 'videos_pending', 'videos_completed', 'bot_decision_advance', 'finalist', 'offered', 'hired'].includes(stage),
    conductual: ['conductual_completed', 'integridad_completed', 'videos_pending', 'videos_completed', 'bot_decision_advance', 'finalist', 'offered', 'hired'].includes(stage),
    integridad: ['integridad_completed', 'videos_pending', 'videos_completed', 'bot_decision_advance', 'finalist', 'offered', 'hired'].includes(stage),
    video: ['videos_completed', 'bot_decision_advance', 'finalist', 'offered', 'hired'].includes(stage),
  };
  let current_phase: TestEntryView['current_phase'] = 'prefilter';
  if (!completed.prefilter) current_phase = 'prefilter';
  else if (!completed.tecnica) current_phase = 'tecnica';
  else if (!completed.conductual) current_phase = 'conductual';
  else if (!completed.integridad) current_phase = 'integridad';
  else if (stage === 'videos_pending' || (!completed.video && stage === 'integridad_completed')) current_phase = 'video';
  else current_phase = 'done';
  return {
    prefilter_completed: completed.prefilter,
    tecnica_completed: completed.tecnica,
    conductual_completed: completed.conductual,
    integridad_completed: completed.integridad,
    video_completed: completed.video,
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
        prefilter_completed: true, // mock no tiene este flag, asumimos hecho
        tecnica_completed: mock.tecnica_completed,
        conductual_completed: mock.conductual_completed,
        integridad_completed: mock.integridad_completed,
        video_completed: false,
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
        <p>Si el link es viejo o no funciona, escríbenos a <a href="mailto:proyectos@kunodigital.com">proyectos@kunodigital.com</a> y te mandamos uno nuevo.</p>
      </div>
    );
  }

  const phaseRoute =
    view.current_phase === 'prefilter' ? `/test/${token}/prescreening` :
    view.current_phase === 'tecnica' ? `/test/${token}/tecnica` :
    view.current_phase === 'conductual' ? `/test/${token}/disc` :
    view.current_phase === 'integridad' ? `/test/${token}/integridad` :
    view.current_phase === 'video' ? `/test/${token}/videos` :
    `/test/${token}/my-progress`;

  const phaseTitle =
    view.current_phase === 'prefilter' ? 'Cuestionario inicial' :
    view.current_phase === 'tecnica' ? 'Prueba técnica' :
    view.current_phase === 'conductual' ? 'Evaluación conductual' :
    view.current_phase === 'integridad' ? 'Prueba de integridad' :
    view.current_phase === 'video' ? 'Entrevista en video' :
    'Ver mi progreso';

  const phaseDuration =
    view.current_phase === 'prefilter' ? '~5 min' :
    view.current_phase === 'tecnica' ? '20-30 min' :
    view.current_phase === 'conductual' ? '15-20 min' :
    view.current_phase === 'integridad' ? '10-15 min' :
    view.current_phase === 'video' ? '5-10 min' :
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

        {/* 2026-06-29: Lista de pruebas REMOVIDA por petición de Cris. Mostraba 4 items
            hardcoded (prefilter/técnica/conductual/integridad) sin video/inglés/mindset,
            y le daba al candidato un mapa de todas las pruebas — no todas aplican a cada
            puesto, y revelar la secuencia influye en respuestas. Ahora solo mostramos
            la SIGUIENTE prueba. */}

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
                <li>Hazla en un lugar tranquilo, sin interrupciones.</li>
                <li>No salgas de esta ventana ni copies/pegues — el sistema lo detecta y queda registrado.</li>
                <li>Si tienes un problema técnico, puedes volver al link y continuar donde quedaste.</li>
              </ul>
              <Link to={phaseRoute} className="ct-start-btn">
                Empezar ahora →
              </Link>
            </>
          )}
        </section>

        <p className="ct-help">
          ¿Dudas? Escríbenos a <a href="mailto:proyectos@kunodigital.com">proyectos@kunodigital.com</a>
        </p>
      </main>
    </div>
  );
}

// ProgressItem REMOVIDA 2026-06-29 — la lista de pruebas hardcoded se quitó.
// Si en el futuro queremos lista dinámica basada en qué pruebas aplican al puesto,
// agregar campo `applicable_phases: string[]` al backend y re-implementar.
