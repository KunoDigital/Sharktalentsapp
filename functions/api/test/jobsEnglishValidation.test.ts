import { describe, it, expect } from 'vitest';
import { validateEnglishConfig } from '../src/features/jobs';

describe('jobs.validateEnglishConfig', () => {
  it('passes si english_required no está seteado', () => {
    expect(() => validateEnglishConfig({})).not.toThrow();
  });

  it('passes si english_required=false', () => {
    expect(() => validateEnglishConfig({ english_required: false })).not.toThrow();
  });

  it('passes si english_required=true + level válido', () => {
    expect(() => validateEnglishConfig({ english_required: true, english_min_level: 'B2' })).not.toThrow();
    expect(() => validateEnglishConfig({ english_required: true, english_min_level: 'A2' })).not.toThrow();
    expect(() => validateEnglishConfig({ english_required: true, english_min_level: 'C1' })).not.toThrow();
  });

  it('throws si english_required=true sin level', () => {
    expect(() => validateEnglishConfig({ english_required: true })).toThrow(/english_min_level/);
  });

  it('throws si english_required=true con level inválido', () => {
    expect(() => validateEnglishConfig({ english_required: true, english_min_level: 'A1' })).toThrow(/A2, B1, B2, C1/);
    expect(() => validateEnglishConfig({ english_required: true, english_min_level: 'C2' })).toThrow();
    expect(() => validateEnglishConfig({ english_required: true, english_min_level: 'X' })).toThrow();
  });

  it('throws si level es número o boolean', () => {
    expect(() => validateEnglishConfig({ english_required: true, english_min_level: 5 })).toThrow();
    expect(() => validateEnglishConfig({ english_required: true, english_min_level: true })).toThrow();
  });
});
