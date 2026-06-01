import { describe, it, expect } from 'vitest';
import {
  scoreEnglishTest,
  multipleChoiceScorePct,
  ENGLISH_PASS_THRESHOLDS,
  ENGLISH_SCORE_WEIGHTS,
} from '../src/lib/englishScoring';

describe('englishScoring.scoreEnglishTest', () => {
  it('candidato perfecto en B2 → passes', () => {
    const result = scoreEnglishTest({
      level: 'B2',
      mc_score_pct: 100,
      listening_score_pct: 100,
      writing_score_pct: 100,
    });
    expect(result.total_score_pct).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.threshold_pct).toBe(70);
  });

  it('candidato exactamente al threshold → passes', () => {
    const result = scoreEnglishTest({
      level: 'B2',
      mc_score_pct: 70,
      listening_score_pct: 70,
      writing_score_pct: 70,
    });
    expect(result.total_score_pct).toBe(70);
    expect(result.passed).toBe(true);
  });

  it('candidato 1 punto debajo del threshold → no pasa', () => {
    const result = scoreEnglishTest({
      level: 'B2',
      mc_score_pct: 69,
      listening_score_pct: 69,
      writing_score_pct: 69,
    });
    expect(result.total_score_pct).toBe(69);
    expect(result.passed).toBe(false);
  });

  it('weighted score: MC=80, Listening=60, Writing=40 → 65', () => {
    // 0.5*80 + 0.25*60 + 0.25*40 = 40 + 15 + 10 = 65
    const result = scoreEnglishTest({
      level: 'B1',
      mc_score_pct: 80,
      listening_score_pct: 60,
      writing_score_pct: 40,
    });
    expect(result.total_score_pct).toBe(65);
    expect(result.passed).toBe(true);  // B1 threshold 65 → passes exactly
  });

  it('thresholds diferenciados por nivel', () => {
    expect(ENGLISH_PASS_THRESHOLDS.A2).toBe(60);
    expect(ENGLISH_PASS_THRESHOLDS.B1).toBe(65);
    expect(ENGLISH_PASS_THRESHOLDS.B2).toBe(70);
    expect(ENGLISH_PASS_THRESHOLDS.C1).toBe(75);
  });

  it('mismo score 70%: pasa B2 pero NO pasa C1', () => {
    const inputBase = { mc_score_pct: 70, listening_score_pct: 70, writing_score_pct: 70 };
    expect(scoreEnglishTest({ ...inputBase, level: 'B2' }).passed).toBe(true);
    expect(scoreEnglishTest({ ...inputBase, level: 'C1' }).passed).toBe(false);
  });

  it('weights suman 1.0', () => {
    const sum = ENGLISH_SCORE_WEIGHTS.multiple_choice + ENGLISH_SCORE_WEIGHTS.listening + ENGLISH_SCORE_WEIGHTS.writing;
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('throws si level inválido', () => {
    expect(() => scoreEnglishTest({
      level: 'A1' as 'A2',
      mc_score_pct: 50,
      listening_score_pct: 50,
      writing_score_pct: 50,
    })).toThrow(/invalid level/);
  });

  it('throws si score parcial > 100', () => {
    expect(() => scoreEnglishTest({
      level: 'A2',
      mc_score_pct: 110,
      listening_score_pct: 50,
      writing_score_pct: 50,
    })).toThrow(/in \[0, 100\]/);
  });

  it('throws si score parcial < 0', () => {
    expect(() => scoreEnglishTest({
      level: 'A2',
      mc_score_pct: 50,
      listening_score_pct: -10,
      writing_score_pct: 50,
    })).toThrow(/in \[0, 100\]/);
  });
});

describe('englishScoring.multipleChoiceScorePct', () => {
  it('calcula % de aciertos', () => {
    expect(multipleChoiceScorePct(15, 20)).toBe(75);
    expect(multipleChoiceScorePct(20, 20)).toBe(100);
    expect(multipleChoiceScorePct(0, 20)).toBe(0);
  });

  it('clamps a [0, 100]', () => {
    expect(multipleChoiceScorePct(-5, 20)).toBe(0);
    expect(multipleChoiceScorePct(25, 20)).toBe(100);
  });

  it('returns 0 si totalQuestions <= 0', () => {
    expect(multipleChoiceScorePct(5, 0)).toBe(0);
    expect(multipleChoiceScorePct(5, -1)).toBe(0);
  });
});
