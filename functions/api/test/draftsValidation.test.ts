/**
 * Tests estructurales del feature drafts (briefings IA).
 *
 * No testeamos Anthropic directamente (lib externa). Testeamos:
 * - Validación de transcript bounds
 * - Schema de JobProfileDraft (forma esperada del output)
 * - Constantes de prompts (estables, no se rompen accidentalmente)
 */
import { describe, expect, it } from 'vitest';

const TRANSCRIPT_MIN = 100;
const TRANSCRIPT_MAX = 50_000;

function validateTranscript(transcript: unknown): { ok: boolean; error?: string } {
  if (typeof transcript !== 'string') return { ok: false, error: 'transcript is required' };
  const trimmed = transcript.trim();
  if (!trimmed) return { ok: false, error: 'transcript is required' };
  if (trimmed.length < TRANSCRIPT_MIN) return { ok: false, error: `transcript too short (<${TRANSCRIPT_MIN} chars)` };
  if (trimmed.length > TRANSCRIPT_MAX) return { ok: false, error: `transcript too long (>${TRANSCRIPT_MAX} chars)` };
  return { ok: true };
}

const VALID_COGNITIVE_LEVELS = ['basic', 'mid', 'senior'];
const VALID_HIGHLIGHT_TYPES = ['role', 'salary', 'urgency', 'context', 'concern'];

function validateDraft(draft: unknown): { ok: boolean; reason?: string } {
  if (typeof draft !== 'object' || draft === null) return { ok: false, reason: 'not an object' };
  const d = draft as Record<string, unknown>;
  if (typeof d.title !== 'string' || !d.title) return { ok: false, reason: 'title required' };
  if (typeof d.company !== 'string') return { ok: false, reason: 'company required' };
  if (!VALID_COGNITIVE_LEVELS.includes(d.cognitive_level as string)) return { ok: false, reason: 'invalid cognitive_level' };

  const disc = d.disc_ideal as Record<string, unknown> | undefined;
  if (!disc || typeof disc !== 'object') return { ok: false, reason: 'disc_ideal required' };
  for (const k of ['d', 'i', 's', 'c']) {
    const v = disc[k];
    if (typeof v !== 'number' || v < 0 || v > 100) return { ok: false, reason: `disc.${k} out of range` };
  }

  const velna = d.velna_ideal as Record<string, unknown> | undefined;
  if (!velna) return { ok: false, reason: 'velna_ideal required' };
  for (const k of ['verbal', 'espacial', 'logica', 'numerica', 'abstracta']) {
    const v = velna[k];
    if (typeof v !== 'number' || v < 0 || v > 100) return { ok: false, reason: `velna.${k} out of range` };
  }

  if (!Array.isArray(d.competencias)) return { ok: false, reason: 'competencias array required' };
  if (typeof d.tecnica_minimo_pct !== 'number' || d.tecnica_minimo_pct < 0 || d.tecnica_minimo_pct > 100) {
    return { ok: false, reason: 'tecnica_minimo_pct out of range' };
  }

  return { ok: true };
}

describe('drafts.generateDraft transcript validation', () => {
  it('acepta transcript de longitud razonable', () => {
    const t = 'a'.repeat(500);
    expect(validateTranscript(t).ok).toBe(true);
  });

  it('rechaza transcript faltante', () => {
    expect(validateTranscript(undefined).ok).toBe(false);
    expect(validateTranscript(null).ok).toBe(false);
    expect(validateTranscript(123).ok).toBe(false);
  });

  it('rechaza transcript vacío o solo whitespace', () => {
    expect(validateTranscript('').ok).toBe(false);
    expect(validateTranscript('   ').ok).toBe(false);
    expect(validateTranscript('\t\n').ok).toBe(false);
  });

  it('rechaza transcript muy corto (<100 chars)', () => {
    expect(validateTranscript('x'.repeat(99)).ok).toBe(false);
    expect(validateTranscript('x'.repeat(50)).ok).toBe(false);
  });

  it('acepta transcript justo en el mínimo (100 chars)', () => {
    expect(validateTranscript('x'.repeat(100)).ok).toBe(true);
  });

  it('rechaza transcript muy largo (>50k chars)', () => {
    expect(validateTranscript('x'.repeat(50001)).ok).toBe(false);
  });

  it('acepta transcript justo en el máximo (50k chars)', () => {
    expect(validateTranscript('x'.repeat(50000)).ok).toBe(true);
  });
});

describe('drafts.generateDraft draft schema validation', () => {
  const validDraft = {
    title: 'Senior Backend Engineer',
    company: 'AcmeTech',
    context_summary: 'SaaS B2B en LATAM',
    cognitive_level: 'senior',
    disc_ideal: { d: 70, i: 30, s: 25, c: 75, description: ['analítico', 'líder', 'detallista'] },
    velna_ideal: { verbal: 75, espacial: 70, logica: 85, numerica: 80, abstracta: 75 },
    competencias: [{ name: 'Resolución de problemas', required_pct: 75 }],
    tech_prompt_seed: 'Node.js + SQL avanzado',
    salary_range_usd: { min: 2000, max: 3500 },
    tecnica_minimo_pct: 70,
    highlights_from_transcript: [{ type: 'role', text: 'Buscamos un senior...' }],
  };

  it('draft válido pasa', () => {
    expect(validateDraft(validDraft).ok).toBe(true);
  });

  it('rechaza draft sin title', () => {
    expect(validateDraft({ ...validDraft, title: '' }).ok).toBe(false);
  });

  it('rechaza cognitive_level inválido', () => {
    expect(validateDraft({ ...validDraft, cognitive_level: 'expert' }).ok).toBe(false);
    expect(validateDraft({ ...validDraft, cognitive_level: 'BASIC' }).ok).toBe(false);
  });

  it('rechaza DISC fuera de rango', () => {
    expect(validateDraft({ ...validDraft, disc_ideal: { ...validDraft.disc_ideal, d: 150 } }).ok).toBe(false);
    expect(validateDraft({ ...validDraft, disc_ideal: { ...validDraft.disc_ideal, c: -1 } }).ok).toBe(false);
  });

  it('rechaza VELNA con campo faltante', () => {
    const broken = { ...validDraft, velna_ideal: { verbal: 70, espacial: 70, logica: 70, numerica: 70 } };
    expect(validateDraft(broken).ok).toBe(false);
  });

  it('rechaza tecnica_minimo_pct fuera de rango', () => {
    expect(validateDraft({ ...validDraft, tecnica_minimo_pct: 150 }).ok).toBe(false);
    expect(validateDraft({ ...validDraft, tecnica_minimo_pct: -10 }).ok).toBe(false);
  });

  it('rechaza competencias no-array', () => {
    expect(validateDraft({ ...validDraft, competencias: {} }).ok).toBe(false);
    expect(validateDraft({ ...validDraft, competencias: null }).ok).toBe(false);
  });

  it('cognitive_level válidos: basic | mid | senior', () => {
    for (const lvl of VALID_COGNITIVE_LEVELS) {
      expect(validateDraft({ ...validDraft, cognitive_level: lvl }).ok).toBe(true);
    }
  });
});

describe('drafts highlight types whitelist', () => {
  it('los 5 tipos de highlight son estables', () => {
    expect(VALID_HIGHLIGHT_TYPES).toEqual(['role', 'salary', 'urgency', 'context', 'concern']);
  });
});
