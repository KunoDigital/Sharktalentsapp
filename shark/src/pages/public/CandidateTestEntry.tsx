import { Link, useParams } from 'react-router-dom';
import { getTestSession } from '../../data/mockCandidateTests';
import './candidate-test.css';

export default function CandidateTestEntry() {
  const { token } = useParams<{ token: string }>();
  const session = token ? getTestSession(token) : undefined;

  if (!session) {
    return (
      <div className="ct-not-found">
        <h1>Link inválido o expirado</h1>
        <p>Contactá a Kuno Digital si necesitás un nuevo link.</p>
      </div>
    );
  }

  const phaseRoute =
    session.current_phase === 'tecnica' ? `/test/${token}/tecnica` :
    session.current_phase === 'conductual' ? `/test/${token}/disc` :
    `/test/${token}/integridad`;

  const phaseTitle =
    session.current_phase === 'tecnica' ? 'Prueba técnica' :
    session.current_phase === 'conductual' ? 'Evaluación conductual' :
    'Prueba de integridad';

  const phaseDuration =
    session.current_phase === 'tecnica' ? '20-30 min' :
    session.current_phase === 'conductual' ? '15-20 min' :
    '10-15 min';

  return (
    <div className="ct-root">
      <header className="ct-header">
        <div className="ct-brand">SharkTalents.AI</div>
        <div className="ct-brand-tag">Evaluación de talento</div>
      </header>

      <main className="ct-main">
        <div className="ct-greeting">
          <h1>Hola {session.candidate_name.split(' ')[0]} 👋</h1>
          <p className="ct-greeting-text">
            {session.greeting_text ?? 'Gracias por aplicar al puesto. Vamos a empezar con una serie de evaluaciones cortas.'}
          </p>
        </div>

        <section className="ct-progress">
          <h2>Tu progreso</h2>
          <div className="ct-progress-list">
            <ProgressItem
              label="1. Prueba técnica"
              done={session.tecnica_completed}
              current={session.current_phase === 'tecnica'}
            />
            <ProgressItem
              label="2. Evaluación conductual (DISC + cognitiva + emoción)"
              done={session.conductual_completed}
              current={session.current_phase === 'conductual'}
            />
            <ProgressItem
              label="3. Prueba de integridad"
              done={session.integridad_completed}
              current={session.current_phase === 'integridad'}
            />
          </div>
        </section>

        <section className="ct-current-card">
          <div className="ct-current-tag">SIGUIENTE</div>
          <h2>{phaseTitle}</h2>
          <p>Duración estimada: <strong>{phaseDuration}</strong></p>
          <ul className="ct-rules">
            <li>Hazla en un lugar tranquilo, sin interrupciones.</li>
            <li>No salgas de esta ventana ni copies/pegues — el sistema detecta esto y queda registrado.</li>
            <li>Si tienes un problema técnico, puedes volver al link y continuar donde quedaste.</li>
          </ul>
          <Link to={phaseRoute} className="ct-start-btn">
            Empezar ahora →
          </Link>
        </section>

        <p className="ct-help">
          ¿Dudas? Escribí a <a href="mailto:cris@kunodigital.com">cris@kunodigital.com</a>
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
