import { useSearchParams, useParams } from 'react-router-dom';
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
    phase === 'integridad' ? 'la prueba de integridad' :
    'esta etapa';

  return (
    <div className="ct-root">
      <main className="ct-main">
        <div className="ct-thanks ct-thanks-big">
          <div className="ct-thanks-icon">✓</div>
          <h1>¡Completaste {phaseLabel}!</h1>
          <p>
            {session?.candidate_name && `Gracias ${session.candidate_name.split(' ')[0]}. `}
            Tus respuestas quedaron guardadas correctamente.
          </p>

          {/* NO mostramos score al candidato: ese resultado lo ve solo el cliente/recruiter
              en el reporte. Mostrarle el score al candidato compromete la integridad del test
              (puede ajustar sus respuestas la próxima vez que haga una prueba). */}

          <p style={{ marginTop: 16 }}>
            El proceso continúa según lo coordinado con quien solicitó la evaluación.
            Si todavía tienes otra prueba pendiente, vas a recibir el link correspondiente.
          </p>
        </div>
      </main>
    </div>
  );
}
