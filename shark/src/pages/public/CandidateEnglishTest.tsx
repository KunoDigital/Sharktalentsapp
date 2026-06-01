/**
 * Test de Inglés del candidato — flow completo (4 secciones secuenciales).
 *
 * Estructura:
 *   1. Multiple-choice: 18 preguntas vocab + grammar + reading
 *   2. Listening: 1 audio del nivel + 2 preguntas
 *   3. Writing: 1 prompt con anti-paste + timer
 *   4. (Si pasa) Speaking video — el candidato pasa al CandidateVideoTest
 *
 * El candidato NO ve el resultado — sigue el flow regardless of passed/not passed.
 * El backend persiste el score y el reporte cliente lo muestra.
 *
 * Spec: docs/master-plan/25_TEST_INGLES.md
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getTestSession } from '../../data/mockCandidateTests';
import { getJobById } from '../../data/mockJobs';
import { useAntiPaste } from '../../hooks/useAntiPaste';
import { pickStratifiedFrontend } from '../../lib/questionSelector';
import a2Bank from '../../data/questions/english-a2.json';
import b1Bank from '../../data/questions/english-b1.json';
import b2Bank from '../../data/questions/english-b2.json';
import c1Bank from '../../data/questions/english-c1.json';
import englishConfig from '../../data/english-config.json';
import { submitEnglishTest } from '../../lib/testApi';
import { logger } from '../../lib/logger';
import './candidate-test.css';

const log = logger('CANDIDATE_ENGLISH');

type EnglishLevel = 'A2' | 'B1' | 'B2' | 'C1';

type MCQuestion = {
  id: string;
  type: 'vocab' | 'grammar' | 'reading';
  text: string;
  options: string[];
  correct: number;
};

type ListeningQuestion = {
  id: string;
  text: string;
  options: string[];
  correct: number;
};

type Section = 'mc' | 'listening' | 'writing' | 'submitting' | 'done';

const BANKS: Record<EnglishLevel, MCQuestion[]> = {
  A2: a2Bank as MCQuestion[],
  B1: b1Bank as MCQuestion[],
  B2: b2Bank as MCQuestion[],
  C1: c1Bank as MCQuestion[],
};

export default function CandidateEnglishTest() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const session = token ? getTestSession(token) : undefined;
  const job = session ? getJobById(session.job_id) : undefined;

  const level: EnglishLevel = (job?.english_min_level ?? 'B1') as EnglishLevel;
  const cfg = englishConfig.levels[level];
  const writingPrompt = englishConfig.writing_prompts[level];
  const listeningCfg = englishConfig.listening[level];

  const [section, setSection] = useState<Section>('mc');

  // Section 1: Multiple-choice
  const mcQuestions = useMemo(() => {
    return pickStratifiedFrontend(BANKS[level], { vocab: 8, grammar: 8, reading: 4 });
  }, [level]);
  const [mcCurrentIdx, setMcCurrentIdx] = useState(0);
  const [mcAnswers, setMcAnswers] = useState<Record<string, number>>({});

  // Section 2: Listening
  const listeningQuestions = listeningCfg.questions as ListeningQuestion[];
  const [listeningAnswers, setListeningAnswers] = useState<Record<string, number>>({});
  const [audioPlayed, setAudioPlayed] = useState(0);

  // Section 3: Writing
  const [writingText, setWritingText] = useState('');
  const writingStartTime = useRef<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(cfg.writing_time_seconds);
  const { textareaProps, stats } = useAntiPaste({ enabled: true });

  useEffect(() => {
    if (section !== 'writing') return;
    if (writingStartTime.current === null) writingStartTime.current = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - writingStartTime.current!) / 1000);
      const remaining = cfg.writing_time_seconds - elapsed;
      setTimeRemaining(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        handleSubmitAll();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [section]);

  if (!session) {
    return <p>Link inválido. <Link to="/">Volver</Link></p>;
  }

  // ===== Navigation handlers =====

  function handleMcAnswer(qIdx: number, optionIdx: number) {
    const q = mcQuestions[qIdx];
    setMcAnswers((curr) => ({ ...curr, [q.id]: optionIdx }));
  }

  function nextMc() {
    if (mcCurrentIdx < mcQuestions.length - 1) {
      setMcCurrentIdx(mcCurrentIdx + 1);
    } else {
      setSection('listening');
    }
  }

  function prevMc() {
    if (mcCurrentIdx > 0) setMcCurrentIdx(mcCurrentIdx - 1);
  }

  function handleListeningAnswer(qid: string, optionIdx: number) {
    setListeningAnswers((curr) => ({ ...curr, [qid]: optionIdx }));
  }

  function listeningNext() {
    setSection('writing');
  }

  async function handleSubmitAll() {
    setSection('submitting');

    const mcCorrect = mcQuestions.reduce((sum, q) => sum + (mcAnswers[q.id] === q.correct ? 1 : 0), 0);
    const listeningCorrect = listeningQuestions.reduce(
      (sum, q) => sum + (listeningAnswers[q.id] === q.correct ? 1 : 0),
      0,
    );
    const wordCount = writingText.split(/\s+/).filter(Boolean).length;
    const timeElapsed = writingStartTime.current
      ? Math.floor((Date.now() - writingStartTime.current) / 1000)
      : 0;

    if (token) {
      try {
        const result = await submitEnglishTest(token, {
          level,
          mc_correct: mcCorrect,
          mc_total: mcQuestions.length,
          listening_correct: listeningCorrect,
          listening_total: listeningQuestions.length,
          writing_text: writingText,
          writing_word_count: wordCount,
          writing_time_seconds: timeElapsed,
          writing_paste_attempts: stats.paste_attempts,
          writing_focus_lost_count: stats.focus_lost_count,
          audio_listening_id: listeningCfg.audio_filename,
        });
        log.info('english submitted', {
          level,
          total_score_pct: result.total_score_pct,
          passed: result.passed,
        });
      } catch (err) {
        log.warn('english submit failed', { error: (err as Error).message });
      }
    }

    setSection('done');
    setTimeout(() => navigate(`/test/${token}/done?phase=ingles`), 1500);
  }

  // ===== Render =====

  if (section === 'submitting') {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks">
            <h1>Procesando...</h1>
            <p>Estamos guardando tus respuestas.</p>
          </div>
        </main>
      </div>
    );
  }

  if (section === 'done') {
    return (
      <div className="ct-root">
        <main className="ct-main">
          <div className="ct-thanks">
            <h1>✓ Respuestas guardadas</h1>
            <p>Pasamos a la siguiente sección en un momento…</p>
          </div>
        </main>
      </div>
    );
  }

  // Section 1: MC
  if (section === 'mc') {
    const q = mcQuestions[mcCurrentIdx];
    const selected = mcAnswers[q.id];
    const canAdvance = selected !== undefined;

    return (
      <div className="ct-root">
        <main className="ct-main">
          <header className="ct-header">
            <h1>English test — Part 1 of 3</h1>
            <p className="ct-subtitle">Multiple choice questions ({cfg.ux_label})</p>
            <div className="ct-progress">
              <div className="ct-progress-bar" style={{ width: `${((mcCurrentIdx + 1) / mcQuestions.length) * 100}%` }} />
            </div>
            <div className="ct-progress-label">
              Question {mcCurrentIdx + 1} of {mcQuestions.length}
            </div>
          </header>

          <section className="ct-question">
            <p className="ct-question-text">{q.text}</p>
            <div className="ct-options" role="radiogroup">
              {q.options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={selected === i}
                  className={`ct-option ${selected === i ? 'ct-option-selected' : ''}`}
                  onClick={() => handleMcAnswer(mcCurrentIdx, i)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </section>

          <div className="ct-actions">
            <button type="button" className="ct-btn-secondary" onClick={prevMc} disabled={mcCurrentIdx === 0}>
              ← Previous
            </button>
            <button type="button" className="ct-btn-primary" onClick={nextMc} disabled={!canAdvance}>
              {mcCurrentIdx === mcQuestions.length - 1 ? 'Continue to listening →' : 'Next →'}
            </button>
          </div>
        </main>
      </div>
    );
  }

  // Section 2: Listening
  if (section === 'listening') {
    const allAnswered = listeningQuestions.every((q) => listeningAnswers[q.id] !== undefined);
    const audioUrl = `/api/files/english-listening/${listeningCfg.audio_filename}`;

    return (
      <div className="ct-root">
        <main className="ct-main">
          <header className="ct-header">
            <h1>English test — Part 2 of 3</h1>
            <p className="ct-subtitle">Listen to the audio, then answer the questions below.</p>
          </header>

          <section className="ct-question">
            <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f9fafb', borderRadius: '8px' }}>
              <audio
                controls
                src={audioUrl}
                onPlay={() => setAudioPlayed((p) => p + 1)}
                style={{ width: '100%' }}
              >
                Your browser doesn't support audio.
              </audio>
              <p className="muted small" style={{ marginTop: '0.5rem' }}>
                You may listen up to 2 times. Played: {audioPlayed} / 2
              </p>
            </div>

            {listeningQuestions.map((q, qi) => {
              const sel = listeningAnswers[q.id];
              return (
                <div key={q.id} style={{ marginBottom: '1.5rem' }}>
                  <p className="ct-question-text" style={{ fontWeight: 600 }}>
                    {qi + 1}. {q.text}
                  </p>
                  <div className="ct-options" role="radiogroup">
                    {q.options.map((opt, i) => (
                      <button
                        key={i}
                        type="button"
                        role="radio"
                        aria-checked={sel === i}
                        className={`ct-option ${sel === i ? 'ct-option-selected' : ''}`}
                        onClick={() => handleListeningAnswer(q.id, i)}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </section>

          <div className="ct-actions">
            <button type="button" className="ct-btn-primary" onClick={listeningNext} disabled={!allAnswered}>
              Continue to writing →
            </button>
          </div>
        </main>
      </div>
    );
  }

  // Section 3: Writing
  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  const wordCount = writingText.split(/\s+/).filter(Boolean).length;
  const reachedMinWords = wordCount >= writingPrompt.min_words;

  return (
    <div className="ct-root">
      <main className="ct-main">
        <header className="ct-header">
          <h1>English test — Part 3 of 3</h1>
          <p className="ct-subtitle">Writing exercise</p>
        </header>

        <section className="ct-question">
          <div style={{ padding: '1rem', background: '#f9fafb', borderRadius: '8px', marginBottom: '1rem' }}>
            <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Prompt:</p>
            <p>{writingPrompt.prompt}</p>
            <p className="muted small" style={{ marginTop: '0.5rem' }}>
              Minimum: {writingPrompt.min_words} words.
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
            <span>Words: <strong>{wordCount}</strong> / {writingPrompt.min_words}</span>
            <span style={{ color: timeRemaining < 60 ? '#ef4444' : '#6b7280' }}>
              Time: <strong>{minutes}:{seconds.toString().padStart(2, '0')}</strong>
            </span>
          </div>

          <textarea
            {...textareaProps}
            value={writingText}
            onChange={(e) => setWritingText(e.target.value)}
            placeholder="Write your answer here..."
            rows={15}
            style={{
              width: '100%',
              padding: '0.75rem',
              fontSize: '1rem',
              fontFamily: 'inherit',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              resize: 'vertical',
            }}
          />
          {stats.paste_attempts > 0 && (
            <p style={{ color: '#ef4444', fontSize: '0.875rem', marginTop: '0.5rem' }}>
              ⚠ Paste is disabled in this section. Type your answer naturally.
            </p>
          )}
        </section>

        <div className="ct-actions">
          <button
            type="button"
            className="ct-btn-primary"
            onClick={handleSubmitAll}
            disabled={!reachedMinWords}
          >
            Submit all answers
          </button>
        </div>
      </main>
    </div>
  );
}
