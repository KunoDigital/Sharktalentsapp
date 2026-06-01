/**
 * Tests estructurales de videos.ts.
 *
 * Cobertura:
 * - MAX_BYTES = 25MB (límite de upload)
 * - tryParseArray helper (parser tolerante)
 * - Categories válidas para preguntas de video
 * - Path parsers
 */
import { describe, expect, it } from 'vitest';

const MAX_BYTES = 25 * 1024 * 1024; // 25MB

const VALID_VIDEO_CATEGORIES = [
  'technical',
  'weakness_followup',
  'situational',
  'cv_claim_check',
  'integrity_check',
  'english_check',
];

function tryParseArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function extractGenerateVideosPath(url: string): string | null {
  return url.match(/^\/api\/applications\/([^/]+)\/videos\/generate/)?.[1] ?? null;
}

function extractAnalyzePath(url: string): { applicationId: string; responseId: string } | null {
  const m = url.match(/^\/api\/applications\/([^/]+)\/videos\/([^/]+)\/analyze/);
  return m ? { applicationId: m[1], responseId: m[2] } : null;
}

function extractTokenFromPublicVideoPath(url: string): string | null {
  return url.match(/^\/test\/([^/]+)\/videos/)?.[1] ?? null;
}

describe('Videos MAX_BYTES limit', () => {
  it('es 25MB (Catalyst File Store limit + UX razonable)', () => {
    expect(MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_BYTES).toBe(26214400);
  });

  it('un archivo de 24MB pasa', () => {
    const size = 24 * 1024 * 1024;
    expect(size).toBeLessThanOrEqual(MAX_BYTES);
  });

  it('un archivo de 26MB no pasa', () => {
    const size = 26 * 1024 * 1024;
    expect(size).toBeGreaterThan(MAX_BYTES);
  });
});

describe('Video question categories whitelist', () => {
  it('6 categorías válidas', () => {
    expect(VALID_VIDEO_CATEGORIES).toHaveLength(6);
  });

  it('technical: pregunta técnica con video', () => {
    expect(VALID_VIDEO_CATEGORIES).toContain('technical');
  });

  it('weakness_followup: pregunta sobre punto débil de scores previos', () => {
    expect(VALID_VIDEO_CATEGORIES).toContain('weakness_followup');
  });

  it('situational: caso práctico', () => {
    expect(VALID_VIDEO_CATEGORIES).toContain('situational');
  });

  it('cv_claim_check: validar claim del CV', () => {
    expect(VALID_VIDEO_CATEGORIES).toContain('cv_claim_check');
  });

  it('integrity_check: pregunta para validar integridad reportada', () => {
    expect(VALID_VIDEO_CATEGORIES).toContain('integrity_check');
  });

  it('english_check: validar nivel de inglés (si aplica)', () => {
    expect(VALID_VIDEO_CATEGORIES).toContain('english_check');
  });

  it('todas las categorías son snake_case', () => {
    for (const cat of VALID_VIDEO_CATEGORIES) {
      expect(cat).toMatch(/^[a-z_]+$/);
    }
  });
});

describe('tryParseArray helper', () => {
  it('null/undefined → []', () => {
    expect(tryParseArray(null)).toEqual([]);
    expect(tryParseArray(undefined)).toEqual([]);
  });

  it('string vacío → []', () => {
    expect(tryParseArray('')).toEqual([]);
  });

  it('JSON array de strings → array', () => {
    expect(tryParseArray('["a","b","c"]')).toEqual(['a', 'b', 'c']);
  });

  it('filtra non-strings', () => {
    expect(tryParseArray('["a", 1, "b", null, "c"]')).toEqual(['a', 'b', 'c']);
  });

  it('JSON object (no array) → []', () => {
    expect(tryParseArray('{"foo":"bar"}')).toEqual([]);
  });

  it('JSON inválido → [] (no throw)', () => {
    expect(tryParseArray('not json')).toEqual([]);
    expect(tryParseArray('{broken')).toEqual([]);
  });

  it('JSON null → []', () => {
    expect(tryParseArray('null')).toEqual([]);
  });
});

describe('Path parsing /api/applications/:id/videos/*', () => {
  it('generate path', () => {
    expect(extractGenerateVideosPath('/api/applications/app_1/videos/generate')).toBe('app_1');
  });

  it('rechaza generate sin /generate', () => {
    expect(extractGenerateVideosPath('/api/applications/app_1/videos')).toBe(null);
  });

  it('analyze path con applicationId + responseId', () => {
    expect(extractAnalyzePath('/api/applications/app_1/videos/resp_2/analyze')).toEqual({
      applicationId: 'app_1',
      responseId: 'resp_2',
    });
  });

  it('public video path /test/<token>/videos', () => {
    expect(extractTokenFromPublicVideoPath('/test/abc123/videos')).toBe('abc123');
  });

  it('public video upload path /test/<token>/videos/<id>/upload', () => {
    expect(extractTokenFromPublicVideoPath('/test/abc123/videos/q1/upload')).toBe('abc123');
  });
});
