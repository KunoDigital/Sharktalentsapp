/**
 * Tests del catálogo de competencias del frontend (post-consolidación 2026-06-16).
 *
 * Cubre:
 * - Aliases mapean al canónico correcto
 * - resolveCompetenciaId es idempotente
 * - calculateCompetencias devuelve solo canónicas (no duplica scores)
 * - Cada alias mantiene `factores` para retro-compat de scoring histórico
 */
import { describe, expect, it } from 'vitest';
import {
  COMPETENCIAS,
  COMPETENCIA_ALIASES,
  COMPETENCIAS_CANONICAS,
  resolveCompetenciaId,
  calculateCompetencias,
} from '../src/data/competencias';

describe('Catálogo de competencias del frontend — aliases 2026-06-16', () => {
  it('contiene los 5 aliases identificados', () => {
    expect(COMPETENCIA_ALIASES.colaboracion).toBe('trabajo_equipo');
    expect(COMPETENCIA_ALIASES.manejo_ambiguedad).toBe('orientacion_cliente');
    expect(COMPETENCIA_ALIASES.aprendizaje_vuelo).toBe('aprendizaje_activo');
    expect(COMPETENCIA_ALIASES.habilidad_analitica).toBe('pensamiento_critico');
    expect(COMPETENCIA_ALIASES.resiliencia).toBe('adaptabilidad');
    expect(Object.keys(COMPETENCIA_ALIASES).length).toBe(5);
  });

  it('resolveCompetenciaId mapea alias → canónico', () => {
    expect(resolveCompetenciaId('colaboracion')).toBe('trabajo_equipo');
    expect(resolveCompetenciaId('habilidad_analitica')).toBe('pensamiento_critico');
  });

  it('resolveCompetenciaId pasa-through canónicos sin tocar', () => {
    expect(resolveCompetenciaId('liderazgo')).toBe('liderazgo');
    expect(resolveCompetenciaId('adaptabilidad')).toBe('adaptabilidad');
  });

  it('resolveCompetenciaId es idempotente', () => {
    for (const id of Object.keys(COMPETENCIA_ALIASES)) {
      expect(resolveCompetenciaId(resolveCompetenciaId(id))).toBe(resolveCompetenciaId(id));
    }
  });

  it('cada alias tiene factores para retro-compat (no rompemos scoring histórico)', () => {
    for (const aliasId of Object.keys(COMPETENCIA_ALIASES)) {
      const entry = COMPETENCIAS.find((c) => c.id === aliasId);
      expect(entry?.factores.length).toBeGreaterThan(0);
    }
  });

  it('cada alias.alias_of apunta a un ID existente', () => {
    const allIds = new Set(COMPETENCIAS.map((c) => c.id));
    for (const c of COMPETENCIAS) {
      if (c.alias_of) {
        expect(allIds.has(c.alias_of)).toBe(true);
      }
    }
  });

  it('canónicos no tienen alias_of', () => {
    for (const c of COMPETENCIAS_CANONICAS) {
      expect(c.alias_of).toBeUndefined();
    }
  });

  it('calculateCompetencias devuelve solo canónicas (sin duplicados)', () => {
    const disc = { D: 60, I: 50, S: 50, C: 60 };
    const cog = { verbal: 60, espacial: 70, logica: 70, numerica: 60, abstracta: 60 };
    const result = calculateCompetencias(disc, cog, 50);

    expect(result.length).toBe(COMPETENCIAS_CANONICAS.length);
    const resultIds = new Set(result.map((r) => r.id));
    // Ningún alias deprecado aparece en el output
    for (const aliasId of Object.keys(COMPETENCIA_ALIASES)) {
      expect(resultIds.has(aliasId)).toBe(false);
    }
    // Pero los canónicos correspondientes sí
    expect(resultIds.has('trabajo_equipo')).toBe(true);
    expect(resultIds.has('orientacion_cliente')).toBe(true);
    expect(resultIds.has('aprendizaje_activo')).toBe(true);
    expect(resultIds.has('pensamiento_critico')).toBe(true);
    expect(resultIds.has('adaptabilidad')).toBe(true);
  });
});
