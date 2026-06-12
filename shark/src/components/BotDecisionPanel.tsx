import { useEffect, useState } from 'react';
import { useApi } from '../lib/api';
import { logger } from '../lib/logger';

const log = logger('BOT_DECISION_PANEL');

type Decision = NonNullable<Awaited<ReturnType<ReturnType<typeof useApi>['applications']['getBotDecision']>>['decision']>;

const DECISION_LABEL: Record<string, { label: string; color: string; icon: string }> = {
  advance: { label: 'Avanzar', color: '#16a34a', icon: '✓' },
  reject: { label: 'Rechazar', color: '#dc2626', icon: '✗' },
  needs_human: { label: 'Necesita revisión humana', color: '#d97706', icon: '⚠️' },
  finalist: { label: 'Marcar finalista', color: '#16a34a', icon: '🎯' },
};

export function BotDecisionPanel({ applicationId }: { applicationId: string }) {
  const api = useApi();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(true);
  const [tableNotReady, setTableNotReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.applications.getBotDecision(applicationId).then((res) => {
      if (cancelled) return;
      setDecision(res.decision);
      if (res.table_not_ready) setTableNotReady(true);
    }).catch((err) => {
      log.debug('bot decision load failed', { error: (err as Error).message });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [applicationId]);

  if (loading) return null;
  if (tableNotReady) return null;  // tabla BotDecisions no creada — no mostrar panel
  if (!decision) return null;  // no hay decision para este candidato

  const meta = DECISION_LABEL[decision.decision] ?? { label: decision.decision, color: 'var(--st-fg-muted)', icon: '?' };
  const confColor = decision.confidence_pct >= 80 ? '#16a34a'
    : decision.confidence_pct >= 60 ? '#d97706' : '#dc2626';

  return (
    <section style={{ border: '1px solid var(--st-border)', borderRadius: 8, padding: 16, background: 'var(--st-bg-elev)', margin: '1rem 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: '0 0 4px 0', fontSize: 16, fontWeight: 600 }}>🤖 Análisis del bot decisor</h3>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--st-fg-muted-2)' }}>
            Decidido {new Date(decision.decided_at).toLocaleString('es-419')}
            {decision.auto_executed && ' · ejecutado automáticamente'}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: meta.color, fontSize: 16, fontWeight: 600 }}>
            {meta.icon} {meta.label}
          </div>
          <div style={{ fontSize: 12, color: confColor, marginTop: 2 }}>
            Confianza: {decision.confidence_pct}%
          </div>
        </div>
      </div>

      {decision.overridden && (
        <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4, padding: 10, marginBottom: 12, fontSize: 13, color: '#78350f' }}>
          ⚠️ Decisión overrideada {decision.overridden_by ? `por ${decision.overridden_by}` : ''}: {decision.overridden_reason ?? 'sin razón especificada'}
        </div>
      )}

      <div style={{ background: 'var(--st-bg-elev-2)', borderLeft: '3px solid ' + meta.color, padding: 12, fontSize: 14, color: 'var(--st-fg-muted)', lineHeight: 1.5 }}>
        {decision.rationale}
      </div>

      <p style={{ margin: '12px 0 0 0', fontSize: 12, color: 'var(--st-fg-muted)' }}>
        Stage propuesto: <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>{decision.from_stage}</code> → <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>{decision.to_stage_proposed}</code>
      </p>
    </section>
  );
}
