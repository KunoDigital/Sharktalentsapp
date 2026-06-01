import { describe, it, expect } from 'vitest';
import {
  buildTestFlow,
  estimateTestDurationMinutes,
  BLOCK_DURATION_MINUTES,
} from '../src/lib/candidateTestFlow';

describe('candidateTestFlow.buildTestFlow', () => {
  it('default: DISC + Mindset + VELNA + Integridad + Emocional + Videos', () => {
    const flow = buildTestFlow({});
    expect(flow).toEqual(['disc', 'mindset', 'velna', 'integrity', 'emotional', 'videos']);
  });

  it('mindset_test_enabled false → quita el bloque mindset', () => {
    const flow = buildTestFlow({ mindset_test_enabled: false });
    expect(flow).not.toContain('mindset');
    expect(flow[0]).toBe('disc');
    expect(flow[1]).toBe('velna');
  });

  it('tech_prompt definido → agrega technical', () => {
    const flow = buildTestFlow({ tech_prompt: 'Senior backend dev with Python+SQL' });
    expect(flow).toContain('technical');
    // técnica va después de emocional, antes de videos/inglés
    expect(flow.indexOf('technical')).toBeGreaterThan(flow.indexOf('emotional'));
  });

  it('english_required + level → agrega english antes de videos', () => {
    const flow = buildTestFlow({
      english_required: true,
      english_min_level: 'B2',
    });
    expect(flow).toContain('english');
    expect(flow.indexOf('english')).toBeLessThan(flow.indexOf('videos'));
  });

  it('english_required true PERO sin level → NO agrega english', () => {
    const flow = buildTestFlow({ english_required: true });
    expect(flow).not.toContain('english');
  });

  it('flow completo: todos los bloques activados', () => {
    const flow = buildTestFlow({
      english_required: true,
      english_min_level: 'B2',
      mindset_test_enabled: true,
      tech_prompt: 'something',
    });
    expect(flow).toEqual([
      'disc',
      'mindset',
      'velna',
      'integrity',
      'emotional',
      'technical',
      'english',
      'videos',
    ]);
  });

  it('videos siempre va último', () => {
    const flow = buildTestFlow({
      english_required: true,
      english_min_level: 'C1',
      tech_prompt: 'x',
    });
    expect(flow[flow.length - 1]).toBe('videos');
  });

  it('disc siempre va primero', () => {
    const flow = buildTestFlow({});
    expect(flow[0]).toBe('disc');
  });
});

describe('candidateTestFlow.estimateTestDurationMinutes', () => {
  it('default flow ~64 min (12+7+18+8+7+12)', () => {
    const minutes = estimateTestDurationMinutes({});
    expect(minutes).toBe(12 + 7 + 18 + 8 + 7 + 12);
  });

  it('flow completo (con técnica + inglés) ~114 min', () => {
    const minutes = estimateTestDurationMinutes({
      english_required: true,
      english_min_level: 'B2',
      tech_prompt: 'x',
    });
    expect(minutes).toBe(12 + 7 + 18 + 8 + 7 + 30 + 20 + 12);
  });

  it('sin mindset: ~57 min', () => {
    const minutes = estimateTestDurationMinutes({ mindset_test_enabled: false });
    expect(minutes).toBe(12 + 18 + 8 + 7 + 12);
  });
});

describe('BLOCK_DURATION_MINUTES', () => {
  it('mindset es 7 min (rápido)', () => {
    expect(BLOCK_DURATION_MINUTES.mindset).toBe(7);
  });

  it('inglés es 20 min (bloque largo: MC + listening + writing + opt video)', () => {
    expect(BLOCK_DURATION_MINUTES.english).toBe(20);
  });
});
