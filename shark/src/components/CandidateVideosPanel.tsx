/**
 * Panel de videos dinámicos del candidato. Cris ve:
 *   - Las 7 preguntas IA generadas para este candidato (con rationale interno)
 *   - Las respuestas (transcripts) y su estado (pending/ok/failed)
 *   - Análisis IA de cada respuesta (si ya corrió)
 *   - Botón para generar preguntas si no existen + botón para correr análisis IA si hay transcript
 */
import { useEffect, useState } from 'react';
import {
  useApi,
  ApiError,
  type VideoQuestionAdmin,
  type VideoResponse,
  type VideoAnalysis,
} from '../lib/api';
import { TableNotReadyBanner } from './TableNotReadyBanner';
import { config } from '../config';
import { logger } from '../lib/logger';

const log = logger('CANDIDATE_VIDEOS_PANEL');

const CATEGORY_LABEL: Record<VideoQuestionAdmin['category'], string> = {
  technical: '🔧 Técnica',
  weakness_followup: '⚠️ Debilidad',
  situational: '🎬 Situacional',
  cv_claim_check: '📄 Validar CV',
  integrity_check: '🛡 Integridad',
  english_check: '🇺🇸 Inglés',
};

export default function CandidateVideosPanel({ applicationId }: { applicationId: string }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [questions, setQuestions] = useState<VideoQuestionAdmin[]>([]);
  const [responses, setResponses] = useState<VideoResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tableNotReady, setTableNotReady] = useState(false);

  async function load() {
    if (!config.useApi) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.videos.list(applicationId);
      setQuestions(res.questions);
      setResponses(res.responses);
      setTableNotReady(false);
    } catch (err) {
      log.warn('list videos failed', { error: (err as Error).message });
      if (err instanceof ApiError && err.code === 'table_not_ready') {
        setTableNotReady(true);
      } else if (err instanceof ApiError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open, applicationId]);

  async function handleGenerate() {
    if (!confirm('¿Generar las 7 preguntas de video con IA? Cada generación cuesta tokens.')) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await api.videos.generate(applicationId);
      if (res.table_missing) {
        setTableNotReady(true);
      } else {
        await load();
      }
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message;
      setError(msg);
    } finally {
      setGenerating(false);
    }
  }

  async function handleAnalyze(responseId: string) {
    setAnalyzingId(responseId);
    setError(null);
    try {
      await api.videos.analyze(applicationId, responseId);
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message;
      setError(msg);
    } finally {
      setAnalyzingId(null);
    }
  }

  function getResponse(questionId: string): VideoResponse | undefined {
    // Tomar el último attempt
    return responses
      .filter((r) => r.question_id === questionId)
      .sort((a, b) => b.attempt - a.attempt)[0];
  }

  function parseAnalysis(payload: string | null): VideoAnalysis | null {
    if (!payload) return null;
    try { return JSON.parse(payload); } catch { return null; }
  }

  return (
    <section className="job-form-section" style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>🎥 Videos dinámicos</h2>
        <button className="btn-toolbar" onClick={() => setOpen((v) => !v)}>
          {open ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: '1rem' }}>
          {!config.useApi && (
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(99, 102, 241, 0.08)', border: '1px dashed rgba(99, 102, 241, 0.4)', borderRadius: '6px', color: '#a5b4fc' }}>
              📺 Modo demo — activá VITE_USE_API y deployá backend para usar el flujo real.
            </div>
          )}

          {tableNotReady && (
            <TableNotReadyBanner
              tableName="VideoQuestions / VideoResponses"
              migrationSection="§12/§13"
              unlocksFeature="generación de 7 preguntas IA por candidato + análisis del speaking"
            />
          )}

          {error && (
            <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#fca5a5', marginBottom: '1rem' }}>
              ⚠️ {error}
            </div>
          )}

          {config.useApi && !tableNotReady && (
            <>
              <p className="muted small">
                7 preguntas IA personalizadas según los scores del candidato. Cuando el candidato responde,
                el transcript queda <code>pending</code> hasta que la integración de transcripción lo procesa,
                después podés disparar el análisis IA por respuesta.
              </p>

              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                {questions.length === 0 ? (
                  <button className="btn-primary" onClick={handleGenerate} disabled={generating}>
                    {generating ? 'Generando 7 preguntas con IA…' : '🪄 Generar preguntas'}
                  </button>
                ) : (
                  <button className="btn-toolbar" onClick={handleGenerate} disabled={generating}>
                    {generating ? 'Regenerando…' : '🔄 Regenerar (descarta las anteriores)'}
                  </button>
                )}
                <button className="cd-btn-ghost" onClick={load} disabled={loading}>
                  Refrescar
                </button>
              </div>

              {loading && <p className="muted">Cargando…</p>}

              {!loading && questions.length === 0 && (
                <p className="muted">No hay preguntas generadas todavía. Click "Generar preguntas".</p>
              )}

              {questions.map((q) => {
                const resp = getResponse(q.question_id);
                const analysis = parseAnalysis(resp?.analysis_payload ?? null);
                return (
                  <div key={q.ROWID} style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--st-fg-muted)' }}>
                        {CATEGORY_LABEL[q.category]} · max {q.max_duration_sec}s
                      </span>
                      {resp && (
                        <span className={`status-tag ${resp.transcript_status === 'ok' ? 'status-active' : 'status-paused'}`}>
                          transcript: {resp.transcript_status}
                        </span>
                      )}
                    </div>
                    <div style={{ fontWeight: 500, marginBottom: '0.3rem' }}>{q.question_text}</div>
                    {q.rationale_internal && (
                      <details style={{ fontSize: '0.78rem', color: 'var(--st-fg-muted)', marginBottom: '0.5rem' }}>
                        <summary>💭 Rationale interno (Cris solo)</summary>
                        <div style={{ marginTop: '0.3rem', padding: '0.3rem', background: 'rgba(0,0,0,0.2)' }}>{q.rationale_internal}</div>
                      </details>
                    )}

                    {!resp && <p className="muted small">⏳ Esperando respuesta del candidato…</p>}

                    {resp && resp.transcript && (
                      <details style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
                        <summary>📝 Transcript ({resp.transcript.length} chars)</summary>
                        <p style={{ marginTop: '0.3rem', whiteSpace: 'pre-wrap' }}>{resp.transcript}</p>
                      </details>
                    )}

                    {resp && resp.transcript && analysis === null && resp.analysis_status !== 'ok' && (
                      <button
                        className="btn-toolbar"
                        onClick={() => handleAnalyze(resp.ROWID)}
                        disabled={analyzingId === resp.ROWID}
                        style={{ marginTop: '0.5rem' }}
                      >
                        {analyzingId === resp.ROWID ? 'Analizando con IA…' : '🤖 Analizar con IA'}
                      </button>
                    )}

                    {analysis && (
                      <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(99, 102, 241, 0.08)', borderRadius: '4px', fontSize: '0.85rem' }}>
                        <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.3rem' }}>
                          <span><strong>Score:</strong> {analysis.overall_pct}%</span>
                          <span><strong>Señales:</strong> {analysis.signals_matched_pct}%</span>
                          {analysis.integrity_concern_pct != null && (
                            <span><strong>Riesgo integridad:</strong> {analysis.integrity_concern_pct}%</span>
                          )}
                          {analysis.english_level_pct != null && (
                            <span><strong>Inglés:</strong> {analysis.english_level_pct}%</span>
                          )}
                        </div>
                        {analysis.observations.length > 0 && (
                          <ul style={{ paddingLeft: '1rem', marginTop: '0.3rem' }}>
                            {analysis.observations.map((o, i) => <li key={i}>{o}</li>)}
                          </ul>
                        )}
                        {analysis.flags.length > 0 && (
                          <div style={{ marginTop: '0.3rem', color: '#fca5a5' }}>
                            🚩 Flags: {analysis.flags.join(', ')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </section>
  );
}
