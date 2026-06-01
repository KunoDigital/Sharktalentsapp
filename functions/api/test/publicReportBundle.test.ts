import { describe, expect, it } from 'vitest';
import { computeSummaryScore } from '../src/features/publicReportBundle';
import { signToken, verifyToken, expiresIn } from '../src/lib/urlSigning';

const SECRET = 'test-bundle-secret';

describe('computeSummaryScore', () => {
  it('devuelve null si no hay scores', () => {
    expect(computeSummaryScore(null)).toBe(null);
    expect(computeSummaryScore(undefined)).toBe(null);
    expect(computeSummaryScore({} as any)).toBe(null);
  });

  it('promedia las dimensiones disponibles', () => {
    const scores = {
      result_id: 'r1',
      velna_indice: 80,
      tec_score_pct: 90,
      int_overall_pct: 20, // riesgo bajo → integridad invertida = 80
      emo_score: 70,
    };
    // (80 + 90 + 80 + 70) / 4 = 80
    expect(computeSummaryScore(scores)).toBe(80);
  });

  it('ignora dimensiones faltantes', () => {
    const scores = {
      result_id: 'r1',
      velna_indice: 90,
      tec_score_pct: 80,
    };
    // (90 + 80) / 2 = 85
    expect(computeSummaryScore(scores)).toBe(85);
  });

  it('integridad muy alta = riesgo alto = score más bajo', () => {
    const a = computeSummaryScore({ result_id: 'r1', int_overall_pct: 80 });
    const b = computeSummaryScore({ result_id: 'r1', int_overall_pct: 10 });
    expect(a).toBeLessThan(b ?? 0);
  });

  it('redondea a entero', () => {
    const scores = {
      result_id: 'r1',
      velna_indice: 81,
      tec_score_pct: 82,
      emo_score: 83,
    };
    // (81+82+83)/3 = 82
    expect(computeSummaryScore(scores)).toBe(82);
  });
});

describe('report_bundle token kind', () => {
  it('roundtrip preserva kind=report_bundle y ref', () => {
    const token = signToken({
      kind: 'report_bundle',
      ref: 'job_42',
      exp: expiresIn(60),
    }, SECRET);
    const verified = verifyToken(token, 'report_bundle', SECRET);
    expect(verified.kind).toBe('report_bundle');
    expect(verified.ref).toBe('job_42');
  });

  it('token kind=report no es aceptado como bundle', () => {
    const token = signToken({
      kind: 'report',
      ref: 'result_1',
      exp: expiresIn(60),
    }, SECRET);
    expect(() => verifyToken(token, 'report_bundle', SECRET)).toThrow();
  });
});
