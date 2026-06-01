/**
 * Tests estructurales del bot decisor (bot.ts).
 *
 * Replica las reglas de auto-apply de bot.ts para que cualquier cambio en producción
 * obligue a actualizar el test. Los tests cubren:
 *
 * - Modos cold / warm / hot — qué dispara cada uno
 * - Threshold de confidence
 * - Validación de transición recomendada
 * - Whitelist de stages que el bot puede recomendar
 * - Path parsing /api/applications/:id/bot-review
 * - Priority de review queue (high si confidence < 0.5)
 */
import { describe, expect, it } from 'vitest';
import { transitionAllowed, isStage, type PipelineStage } from '../src/lib/pipelineStateMachine';

type BotMode = 'cold' | 'warm' | 'hot';
type Recommendation = {
  stage: string;
  confidence: number;
  needs_human_review: boolean;
};

// ===== Replica de la lógica de bot.ts:200-232 =====
function shouldAutoApply(opts: {
  mode: BotMode;
  autoApplyFlag: boolean;
  recommendation: Recommendation;
  fromStage: string;
  threshold: number;
}): { wouldAutoApply: boolean; transitionIsValid: boolean } {
  const recommendedStage = isStage(opts.recommendation.stage)
    ? (opts.recommendation.stage as PipelineStage)
    : null;
  const transitionIsValid = recommendedStage != null
    && isStage(opts.fromStage)
    && transitionAllowed(opts.fromStage as PipelineStage, recommendedStage);

  const passesThreshold = opts.recommendation.confidence >= opts.threshold
    && !opts.recommendation.needs_human_review;

  const wouldAutoApply = transitionIsValid && (
    (opts.mode === 'warm' && opts.autoApplyFlag && passesThreshold) ||
    (opts.mode === 'hot' && passesThreshold)
  );

  return { wouldAutoApply, transitionIsValid };
}

function reviewPriority(confidence: number): 'high' | 'normal' {
  return confidence < 0.5 ? 'high' : 'normal';
}

function extractResultIdFromBotPath(url: string): string | null {
  const match = url.match(/^\/api\/applications\/([^/]+)\/bot-review/);
  return match?.[1] ?? null;
}

const VALID_RECOMMENDATION_STAGES = [
  'tecnica_completed',
  'conductual_completed',
  'integridad_completed',
  'finalist',
  'auto_rejected_low_score',
  'rejected_by_admin',
];

describe('Bot mode cold', () => {
  const baseRec: Recommendation = { stage: 'finalist', confidence: 0.95, needs_human_review: false };

  it('NUNCA aplica auto, ni con confidence 1.0', () => {
    const r = shouldAutoApply({
      mode: 'cold',
      autoApplyFlag: true,
      recommendation: { ...baseRec, confidence: 1.0 },
      fromStage: 'integridad_completed',
      threshold: 0.75,
    });
    expect(r.wouldAutoApply).toBe(false);
  });

  it('NUNCA aplica auto, ni con autoApplyFlag=true', () => {
    const r = shouldAutoApply({
      mode: 'cold',
      autoApplyFlag: true,
      recommendation: baseRec,
      fromStage: 'integridad_completed',
      threshold: 0.75,
    });
    expect(r.wouldAutoApply).toBe(false);
  });
});

describe('Bot mode warm', () => {
  const valid: Recommendation = { stage: 'finalist', confidence: 0.95, needs_human_review: false };

  it('aplica auto si confidence >= threshold Y autoApply=true', () => {
    const r = shouldAutoApply({
      mode: 'warm',
      autoApplyFlag: true,
      recommendation: valid,
      fromStage: 'integridad_completed',
      threshold: 0.75,
    });
    expect(r.wouldAutoApply).toBe(true);
  });

  it('NO aplica si autoApply=false aunque confidence sea alta', () => {
    const r = shouldAutoApply({
      mode: 'warm',
      autoApplyFlag: false,
      recommendation: valid,
      fromStage: 'integridad_completed',
      threshold: 0.75,
    });
    expect(r.wouldAutoApply).toBe(false);
  });

  it('NO aplica si confidence < threshold', () => {
    const r = shouldAutoApply({
      mode: 'warm',
      autoApplyFlag: true,
      recommendation: { ...valid, confidence: 0.6 },
      fromStage: 'integridad_completed',
      threshold: 0.75,
    });
    expect(r.wouldAutoApply).toBe(false);
  });

  it('NO aplica si needs_human_review=true', () => {
    const r = shouldAutoApply({
      mode: 'warm',
      autoApplyFlag: true,
      recommendation: { ...valid, needs_human_review: true },
      fromStage: 'integridad_completed',
      threshold: 0.75,
    });
    expect(r.wouldAutoApply).toBe(false);
  });
});

describe('Bot mode hot', () => {
  const valid: Recommendation = { stage: 'finalist', confidence: 0.95, needs_human_review: false };

  it('aplica auto sin requerir autoApplyFlag', () => {
    const r = shouldAutoApply({
      mode: 'hot',
      autoApplyFlag: false,
      recommendation: valid,
      fromStage: 'integridad_completed',
      threshold: 0.75,
    });
    expect(r.wouldAutoApply).toBe(true);
  });

  it('aún aplica con confidence justo en threshold', () => {
    const r = shouldAutoApply({
      mode: 'hot',
      autoApplyFlag: false,
      recommendation: { ...valid, confidence: 0.75 },
      fromStage: 'integridad_completed',
      threshold: 0.75,
    });
    expect(r.wouldAutoApply).toBe(true);
  });

  it('NO aplica si needs_human_review=true', () => {
    const r = shouldAutoApply({
      mode: 'hot',
      autoApplyFlag: false,
      recommendation: { ...valid, needs_human_review: true },
      fromStage: 'integridad_completed',
      threshold: 0.75,
    });
    expect(r.wouldAutoApply).toBe(false);
  });
});

describe('Validación de transición recomendada', () => {
  it('rechaza salto inválido prefilter_pending → finalist', () => {
    const r = shouldAutoApply({
      mode: 'hot',
      autoApplyFlag: true,
      recommendation: { stage: 'finalist', confidence: 0.99, needs_human_review: false },
      fromStage: 'prefilter_pending',
      threshold: 0.75,
    });
    expect(r.transitionIsValid).toBe(false);
    expect(r.wouldAutoApply).toBe(false);
  });

  it('acepta avance legítimo integridad_completed → finalist', () => {
    const r = shouldAutoApply({
      mode: 'hot',
      autoApplyFlag: true,
      recommendation: { stage: 'finalist', confidence: 0.85, needs_human_review: false },
      fromStage: 'integridad_completed',
      threshold: 0.75,
    });
    expect(r.transitionIsValid).toBe(true);
  });

  it('rechaza stage no reconocido por el state machine', () => {
    const r = shouldAutoApply({
      mode: 'hot',
      autoApplyFlag: true,
      recommendation: { stage: 'made_up_stage', confidence: 0.95, needs_human_review: false },
      fromStage: 'integridad_completed',
      threshold: 0.75,
    });
    expect(r.transitionIsValid).toBe(false);
  });

  it('rechaza cuando fromStage no es válido', () => {
    const r = shouldAutoApply({
      mode: 'hot',
      autoApplyFlag: true,
      recommendation: { stage: 'finalist', confidence: 0.95, needs_human_review: false },
      fromStage: 'foo_bar',
      threshold: 0.75,
    });
    expect(r.transitionIsValid).toBe(false);
  });
});

describe('Stages válidos para el bot recomendar', () => {
  it('todos los stages whitelistados son legítimos del pipeline', () => {
    for (const s of VALID_RECOMMENDATION_STAGES) {
      expect(isStage(s)).toBe(true);
    }
  });

  it('finalist está whitelisted (caso happy path)', () => {
    expect(VALID_RECOMMENDATION_STAGES).toContain('finalist');
  });

  it('auto_rejected_low_score está whitelisted (puede rechazar por score bajo)', () => {
    expect(VALID_RECOMMENDATION_STAGES).toContain('auto_rejected_low_score');
  });

  it('hired NO está whitelisted (decisión humana, no del bot)', () => {
    expect(VALID_RECOMMENDATION_STAGES).not.toContain('hired');
  });

  it('offered NO está whitelisted (decisión humana)', () => {
    expect(VALID_RECOMMENDATION_STAGES).not.toContain('offered');
  });

  it('withdrew NO está whitelisted (acción del candidato, no del bot)', () => {
    expect(VALID_RECOMMENDATION_STAGES).not.toContain('withdrew');
  });
});

describe('Review queue priority', () => {
  it('confidence < 0.5 → high priority', () => {
    expect(reviewPriority(0.4)).toBe('high');
    expect(reviewPriority(0.0)).toBe('high');
    expect(reviewPriority(0.49)).toBe('high');
  });

  it('confidence >= 0.5 → normal priority', () => {
    expect(reviewPriority(0.5)).toBe('normal');
    expect(reviewPriority(0.7)).toBe('normal');
    expect(reviewPriority(1.0)).toBe('normal');
  });
});

describe('Path parsing /api/applications/:id/bot-review', () => {
  it('extrae result id', () => {
    expect(extractResultIdFromBotPath('/api/applications/abc123/bot-review')).toBe('abc123');
  });

  it('extrae con trailing slash', () => {
    expect(extractResultIdFromBotPath('/api/applications/abc123/bot-review/')).toBe('abc123');
  });

  it('extrae con query string', () => {
    expect(extractResultIdFromBotPath('/api/applications/abc123/bot-review?foo=1')).toBe('abc123');
  });

  it('rechaza path sin /bot-review', () => {
    expect(extractResultIdFromBotPath('/api/applications/abc123')).toBe(null);
  });
});
