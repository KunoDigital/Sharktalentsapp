import { describe, expect, it } from 'vitest';
import { parseFeatureFlags, hasFeature, isValidFlag, _internal } from '../src/lib/featureFlags';

describe('parseFeatureFlags', () => {
  it('null/empty → default ["api"]', () => {
    expect(parseFeatureFlags(null)).toEqual(['api']);
    expect(parseFeatureFlags('')).toEqual(['api']);
    expect(parseFeatureFlags(undefined)).toEqual(['api']);
  });

  it('JSON inválido → default', () => {
    expect(parseFeatureFlags('not json')).toEqual(['api']);
    expect(parseFeatureFlags('{')).toEqual(['api']);
  });

  it('non-array → default', () => {
    expect(parseFeatureFlags('"api"')).toEqual(['api']);
    expect(parseFeatureFlags('{"a":1}')).toEqual(['api']);
  });

  it('filtra flags inválidos', () => {
    const result = parseFeatureFlags(JSON.stringify(['api', 'invalid_flag', 'mcp']));
    expect(result).toEqual(['api', 'mcp']);
  });

  it('preserva flags válidos', () => {
    const result = parseFeatureFlags(JSON.stringify(['mcp', 'video_questions', 'bot_hot']));
    expect(result).toEqual(['mcp', 'video_questions', 'bot_hot']);
  });

  it('array vacío en JSON → array vacío', () => {
    expect(parseFeatureFlags('[]')).toEqual([]);
  });
});

describe('hasFeature', () => {
  it('match exacto', () => {
    expect(hasFeature(['api', 'mcp'], 'api')).toBe(true);
    expect(hasFeature(['api'], 'mcp')).toBe(false);
  });

  it('vacío rechaza todo', () => {
    expect(hasFeature([], 'api')).toBe(false);
  });
});

describe('isValidFlag', () => {
  it('acepta valores conocidos', () => {
    expect(isValidFlag('api')).toBe(true);
    expect(isValidFlag('mcp')).toBe(true);
    expect(isValidFlag('bot_hot')).toBe(true);
  });

  it('rechaza unknown', () => {
    expect(isValidFlag('unknown_flag')).toBe(false);
    expect(isValidFlag(123)).toBe(false);
    expect(isValidFlag(null)).toBe(false);
  });
});

describe('ALL_FLAGS coverage', () => {
  it('incluye los flags documentados', () => {
    expect(_internal.ALL_FLAGS).toContain('api');
    expect(_internal.ALL_FLAGS).toContain('mcp');
    expect(_internal.ALL_FLAGS).toContain('custom_branding');
    expect(_internal.ALL_FLAGS).toContain('video_questions');
    expect(_internal.ALL_FLAGS).toContain('bot_warm');
    expect(_internal.ALL_FLAGS).toContain('bot_hot');
  });
});
