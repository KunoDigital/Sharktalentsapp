import { useState, useRef, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getTestSession, VIDEO_QUESTIONS, type VideoQuestion } from '../../data/mockCandidateTests';
import { useAntiCheat } from '../../hooks/useAntiCheat';
import './candidate-test.css';

type Modality = 'video' | 'audio' | 'text';

type Response = {
  question_id: string;
  modality: Modality;
  blob_url?: string; // local URL del recording (en backend: file id)
  text?: string;
  duration_sec?: number;
  attempt: number;
};

type Phase = 'consent' | 'questions' | 'done';

export default function CandidateVideoTest() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const session = token ? getTestSession(token) : undefined;

  const [phase, setPhase] = useState<Phase>('consent');
  const [questionIdx, setQuestionIdx] = useState(0);
  const [responses, setResponses] = useState<Record<string, Response>>({});
  const [attempts, setAttempts] = useState<Record<string, number>>({});

  const currentQ = VIDEO_QUESTIONS[questionIdx];
  const { count: antiCheatCount } = useAntiCheat({
    enabled: phase === 'questions',
    current_question_id: currentQ?.id ?? null,
  });

  if (!session) return <p>Link inválido. <Link to="/">Volver</Link></p>;

  function handleResponse(r: Response) {
    setResponses((curr) => ({ ...curr, [r.question_id]: r }));
    setAttempts((curr) => ({ ...curr, [r.question_id]: (curr[r.question_id] ?? 0) + 1 }));
  }

  function nextQuestion() {
    if (questionIdx < VIDEO_QUESTIONS.length - 1) {
      setQuestionIdx(questionIdx + 1);
    } else {
      setPhase('done');
      setTimeout(() => navigate(`/test/${token}/done?phase=videos`), 1500);
    }
  }

  if (phase === 'consent') {
    return <ConsentScreen onAccept={() => setPhase('questions')} />;
  }

  if (phase === 'done') {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks-big">
            <div className="ct-thanks-icon">✓</div>
            <h1>¡Terminaste!</h1>
            <p>Recibimos tus 7 respuestas en video. La IA va a transcribirlas y evaluarlas.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="ct-root">
      <header className="ct-test-header">
        <div className="ct-test-brand">SharkTalents.AI · Video {questionIdx + 1}/7</div>
        <div className="ct-test-progress">
          <div className="ct-progress-bar">
            <div className="ct-progress-bar-fill" style={{ width: `${((questionIdx + 1) / VIDEO_QUESTIONS.length) * 100}%` }} />
          </div>
          <span className="ct-progress-text">{questionIdx + 1}/{VIDEO_QUESTIONS.length}</span>
        </div>
      </header>

      <main className="ct-main">
        {antiCheatCount > 0 && (
          <div className="ct-anticheat-warning">
            ⚠️ {antiCheatCount} {antiCheatCount === 1 ? 'salida detectada' : 'salidas detectadas'}.
          </div>
        )}

        <VideoQuestionCard
          question={currentQ}
          attemptsUsed={attempts[currentQ.id] ?? 0}
          existingResponse={responses[currentQ.id]}
          onComplete={(r) => {
            handleResponse(r);
          }}
          onNext={nextQuestion}
        />
      </main>
    </div>
  );
}

function ConsentScreen({ onAccept }: { onAccept: () => void }) {
  const [accepted, setAccepted] = useState(false);
  return (
    <div className="ct-root">
      <main className="ct-main">
        <h1>Última prueba: 7 preguntas en video</h1>
        <p className="ct-instructions">
          Esta es la última parte. Te vamos a hacer 7 preguntas que tenés que contestar grabándote en video, audio o texto. Tenés <strong>2 intentos por pregunta</strong> y máximo 90 segundos por respuesta.
        </p>

        <div className="ct-consent-card">
          <h2>Antes de empezar — consentimiento</h2>
          <ul>
            <li>Vamos a grabar tu video y audio para evaluar tus respuestas con IA.</li>
            <li>Las grabaciones se almacenan encriptadas y se eliminan <strong>30 días después</strong> de cerrarse el puesto.</li>
            <li>Solo tu reclutador y el cliente final que contrate ven las grabaciones.</li>
            <li>Podés pedir que borremos tus datos en cualquier momento (GDPR / Ley de Datos PA).</li>
            <li>Si preferís, podés contestar por audio o texto en lugar de video.</li>
          </ul>
          <label className="ct-consent-check">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>Entiendo y acepto las condiciones de grabación.</span>
          </label>
          <button className="ct-start-btn" onClick={onAccept} disabled={!accepted}>
            Empezar las 7 preguntas →
          </button>
        </div>
      </main>
    </div>
  );
}

function VideoQuestionCard({
  question,
  attemptsUsed,
  existingResponse,
  onComplete,
  onNext,
}: {
  question: VideoQuestion;
  attemptsUsed: number;
  existingResponse: Response | undefined;
  onComplete: (r: Response) => void;
  onNext: () => void;
}) {
  const [modality, setModality] = useState<Modality>('video');
  const [recording, setRecording] = useState(false);
  const [recordingComplete, setRecordingComplete] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [textAnswer, setTextAnswer] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<number | null>(null);

  // Cleanup on unmount or when question changes
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [question.id]);

  // Reset state when question changes
  useEffect(() => {
    setRecording(false);
    setRecordingComplete(false);
    setSecondsElapsed(0);
    setTextAnswer('');
    setPreviewUrl(null);
    setError(null);
    setModality('video');
    chunksRef.current = [];
  }, [question.id]);

  async function startRecording() {
    setError(null);
    try {
      const constraints: MediaStreamConstraints =
        modality === 'video' ? { video: true, audio: true } : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (modality === 'video' && videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
      }

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: modality === 'video' ? 'video/webm' : 'audio/webm',
        });
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setRecordingComplete(true);
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }
        if (timerRef.current) clearInterval(timerRef.current);
      };

      recorder.start();
      setRecording(true);
      setSecondsElapsed(0);

      timerRef.current = window.setInterval(() => {
        setSecondsElapsed((s) => {
          if (s + 1 >= question.max_seconds) {
            stopRecording();
            return question.max_seconds;
          }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      setError(`No pudimos acceder a tu ${modality === 'video' ? 'cámara/micrófono' : 'micrófono'}. ${(err as Error).message}. Probá con texto o revisá los permisos del navegador.`);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }

  function discardAndRetry() {
    setRecordingComplete(false);
    setPreviewUrl(null);
    setSecondsElapsed(0);
    chunksRef.current = [];
  }

  function saveResponse() {
    if (modality === 'text') {
      onComplete({
        question_id: question.id,
        modality: 'text',
        text: textAnswer,
        attempt: attemptsUsed + 1,
      });
    } else if (previewUrl) {
      onComplete({
        question_id: question.id,
        modality,
        blob_url: previewUrl,
        duration_sec: secondsElapsed,
        attempt: attemptsUsed + 1,
      });
    }
  }

  const canSave =
    modality === 'text'
      ? textAnswer.length >= 50
      : recordingComplete;

  const attemptsLeft = 2 - attemptsUsed;
  const wasSaved = !!existingResponse;

  return (
    <section className="ct-question-card">
      <div className="ct-question-num">
        Pregunta {question.order}/7 · {question.category_label}
      </div>
      <h2 className="ct-question-text">{question.question}</h2>
      {question.context_hint && <p className="ct-vq-hint">💡 {question.context_hint}</p>}

      {wasSaved ? (
        <div className="ct-vq-saved">
          <div className="ct-vq-saved-icon">✓</div>
          <div>
            <div className="ct-vq-saved-title">Respuesta guardada</div>
            <div className="ct-vq-saved-meta">
              {existingResponse.modality === 'text' ? 'Texto' : existingResponse.modality === 'audio' ? `Audio · ${existingResponse.duration_sec}s` : `Video · ${existingResponse.duration_sec}s`}
              {' · '}
              Intento {existingResponse.attempt}/2
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="ct-vq-modality-tabs">
            {(['video', 'audio', 'text'] as Modality[]).map((m) => (
              <button
                key={m}
                className={`ct-vq-mod-tab ${modality === m ? 'is-active' : ''}`}
                onClick={() => {
                  if (recording) stopRecording();
                  discardAndRetry();
                  setModality(m);
                }}
                disabled={recording}
              >
                {m === 'video' ? '🎥 Video' : m === 'audio' ? '🎙 Audio' : '✍️ Texto'}
              </button>
            ))}
          </div>

          {error && <div className="ct-vq-error">{error}</div>}

          {modality === 'video' && (
            <div className="ct-vq-video-wrap">
              {!recordingComplete && (
                <video ref={videoPreviewRef} autoPlay muted playsInline className="ct-vq-video-preview" />
              )}
              {recordingComplete && previewUrl && (
                <video src={previewUrl} controls className="ct-vq-video-playback" />
              )}
            </div>
          )}

          {modality === 'audio' && recordingComplete && previewUrl && (
            <audio src={previewUrl} controls className="ct-vq-audio-playback" />
          )}

          {modality === 'text' && (
            <div>
              <textarea
                className="ct-open-textarea"
                rows={6}
                placeholder="Escribí tu respuesta acá. Mínimo 50 caracteres."
                value={textAnswer}
                onChange={(e) => setTextAnswer(e.target.value)}
              />
              <div className="ct-open-counter">{textAnswer.length} caracteres {textAnswer.length < 50 && <span className="muted">· (mínimo 50)</span>}</div>
            </div>
          )}

          {(modality === 'video' || modality === 'audio') && (
            <div className="ct-vq-recorder-controls">
              {!recording && !recordingComplete && (
                <button className="ct-start-btn" onClick={startRecording} disabled={attemptsLeft === 0}>
                  ⚫ Empezar a grabar
                </button>
              )}
              {recording && (
                <>
                  <span className="ct-vq-recording-indicator">● Grabando · {secondsElapsed}s / {question.max_seconds}s</span>
                  <button className="cd-btn-danger" onClick={stopRecording}>
                    ⏹ Detener
                  </button>
                </>
              )}
              {recordingComplete && (
                <>
                  <button className="cd-btn-secondary" onClick={discardAndRetry} disabled={attemptsLeft === 0}>
                    Volver a grabar (te queda{attemptsLeft === 1 ? ' 1 intento' : 'n 2 intentos'})
                  </button>
                </>
              )}
            </div>
          )}

          <div className="ct-vq-attempts-info">
            Intentos disponibles: <strong>{attemptsLeft}</strong> · Máx {question.max_seconds}s por respuesta
          </div>
        </>
      )}

      <div className="ct-test-actions" style={{ justifyContent: 'space-between' }}>
        <div />
        {!wasSaved && (
          <button className="ct-start-btn" onClick={saveResponse} disabled={!canSave}>
            Guardar respuesta
          </button>
        )}
        {wasSaved && (
          <button className="ct-start-btn" onClick={onNext}>
            {question.order === 7 ? 'Terminar →' : 'Siguiente pregunta →'}
          </button>
        )}
      </div>
    </section>
  );
}
