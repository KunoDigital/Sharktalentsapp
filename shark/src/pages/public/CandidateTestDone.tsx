import { useSearchParams, Link, useParams } from 'react-router-dom';
import { getTestSession } from '../../data/mockCandidateTests';
import './candidate-test.css';

export default function CandidateTestDone() {
  const { token } = useParams<{ token: string }>();
  const [params] = useSearchParams();
  const phase = params.get('phase') ?? 'conductual';
  const session = token ? getTestSession(token) : undefined;

  const phaseLabel =
    phase === 'tecnica' ? 'la prueba técnica' :
    phase === 'conductual' ? 'la evaluación conductual' :
    'la prueba de integridad';

  const next =
    phase === 'tecnica' ? 'la evaluación conductual' :
    phase === 'conductual' ? 'la prueba de integridad' :
    null;

  return (
    <div className="ct-root">
      <main className="ct-main">
        <div className="ct-thanks ct-thanks-big">
          <div className="ct-thanks-icon">✓</div>
          <h1>¡Completaste {phaseLabel}!</h1>
          <p>
            {session?.candidate_name && `Gracias ${session.candidate_name.split(' ')[0]}. `}
            Tus respuestas quedaron guardadas.
          </p>
          {next ? (
            <>
              <p>El siguiente paso es <strong>{next}</strong>. Te vamos a mandar el link por email.</p>
              <Link to={`/test/${token}`} className="ct-start-btn">Volver al inicio</Link>
            </>
          ) : (
            <p>Te vamos a contactar con los próximos pasos.</p>
          )}
        </div>
      </main>
    </div>
  );
}
