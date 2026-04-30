import { useSearchParams, Link, useParams, useLocation } from 'react-router-dom';
import { getTestSession } from '../../data/mockCandidateTests';
import './candidate-test.css';

type ScoreSummary = {
  type: 'disc' | 'velna' | 'integridad' | 'tecnica' | 'videos';
  data: Record<string, unknown>;
};

export default function CandidateTestDone() {
  const { token } = useParams<{ token: string }>();
  const [params] = useSearchParams();
  const location = useLocation();
  const phase = params.get('phase') ?? 'conductual';
  const session = token ? getTestSession(token) : undefined;

  const summary = (location.state as { score?: ScoreSummary } | null)?.score;

  const phaseLabel =
    phase === 'tecnica' ? 'la prueba técnica' :
    phase === 'conductual' ? 'la evaluación conductual' :
    phase === 'integridad' ? 'la prueba de integridad' :
    phase === 'videos' ? 'las preguntas en video' :
    'esta etapa';

  const next =
    phase === 'tecnica' ? 'la evaluación conductual' :
    phase === 'conductual' ? 'la prueba de integridad' :
    phase === 'integridad' ? 'las preguntas en video' :
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

          {summary && <ScoreSummaryCard summary={summary} />}

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

function ScoreSummaryCard({ summary }: { summary: ScoreSummary }) {
  if (summary.type === 'disc') {
    const data = summary.data as { d: number; i: number; s: number; c: number; dominant: string; similarity?: number };
    return (
      <div className="ct-score-card">
        <h2>Tu perfil DISC</h2>
        <div className="ct-score-bars">
          <ScoreBar label="D" value={data.d} color="#ef4444" />
          <ScoreBar label="I" value={data.i} color="#f59e0b" />
          <ScoreBar label="S" value={data.s} color="#10b981" />
          <ScoreBar label="C" value={data.c} color="#3b82f6" />
        </div>
        <p className="ct-score-detail">
          Perfil dominante: <strong>{data.dominant}</strong>
          {data.similarity != null && <> · Similitud con perfil ideal: <strong>{data.similarity}%</strong></>}
        </p>
      </div>
    );
  }
  if (summary.type === 'velna') {
    const data = summary.data as { aggregate: number; similarity: number; per_subtest: { key: string; pct: number }[] };
    return (
      <div className="ct-score-card">
        <h2>Tu perfil cognitivo</h2>
        <p className="ct-score-detail">
          Agregado: <strong>{data.aggregate}%</strong> · Similitud con ideal: <strong>{data.similarity}%</strong>
        </p>
        <div className="ct-score-bars">
          {data.per_subtest.map((s) => (
            <ScoreBar key={s.key} label={s.key.charAt(0).toUpperCase() + s.key.slice(1, 4)} value={s.pct} color="#a855f7" />
          ))}
        </div>
      </div>
    );
  }
  if (summary.type === 'integridad') {
    const data = summary.data as { observations: string[]; buena_impresion_alta: boolean };
    return (
      <div className="ct-score-card">
        <h2>Integridad</h2>
        {data.observations.length === 0 ? (
          <p className="ct-score-detail">✓ Sin observaciones detectadas.</p>
        ) : (
          <ul className="ct-score-obs">
            {data.observations.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        )}
      </div>
    );
  }
  if (summary.type === 'tecnica') {
    const data = summary.data as { correct: number; total: number; pct: number };
    return (
      <div className="ct-score-card">
        <h2>Prueba técnica</h2>
        <p className="ct-score-detail">
          Resultado: <strong>{data.pct}%</strong> ({data.correct}/{data.total} correctas)
        </p>
      </div>
    );
  }
  return null;
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="ct-score-bar">
      <span className="ct-score-bar-label">{label}</span>
      <div className="ct-score-bar-track">
        <div className="ct-score-bar-fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="ct-score-bar-val">{value}</span>
    </div>
  );
}
