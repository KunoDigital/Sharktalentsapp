/**
 * Tests del catálogo de competencias (post-consolidación 2026-06-16).
 *
 * Cubre:
 * - Aliases mapean al canónico correcto
 * - resolveCompetenciaId es idempotente
 * - Los IDs canónicos no son alias de nadie
 * - Cada alias tiene un `alias_of` que existe en el catálogo
 * - Lista canónica = catálogo total - aliases
 */
import { describe, expect, it } from 'vitest';
import {
  COMPETENCIAS,
  COMPETENCIA_ALIASES,
  COMPETENCIAS_CANONICAS,
  resolveCompetenciaId,
} from '../src/data/competencias';

describe('Catálogo de competencias — aliases consolidados 2026-06-16', () => {
  it('contiene los entries del manual Kudert (55 IDs, incluyendo aliases)', () => {
    // Manual Kudert: 54-57 competencias según el conteo del PDF. En código son 55
    // entries (algunos son aliases deprecados pero siguen como IDs válidos por
    // retro-compat). 50 canónicos + 5 aliases = 55.
    expect(COMPETENCIAS.length).toBe(55);
    expect(COMPETENCIAS_CANONICAS.length).toBe(50);
  });

  it('mapea los 5 aliases identificados al canónico correcto', () => {
    expect(COMPETENCIA_ALIASES.colaboracion).toBe('trabajo_equipo');
    expect(COMPETENCIA_ALIASES.manejo_ambiguedad).toBe('orientacion_cliente');
    expect(COMPETENCIA_ALIASES.aprendizaje_vuelo).toBe('aprendizaje_activo');
    expect(COMPETENCIA_ALIASES.habilidad_analitica).toBe('pensamiento_critico');
    expect(COMPETENCIA_ALIASES.resiliencia).toBe('adaptabilidad');
  });

  it('tiene exactamente 5 aliases', () => {
    expect(Object.keys(COMPETENCIA_ALIASES).length).toBe(5);
  });

  it('resolveCompetenciaId mapea alias → canónico', () => {
    expect(resolveCompetenciaId('colaboracion')).toBe('trabajo_equipo');
    expect(resolveCompetenciaId('resiliencia')).toBe('adaptabilidad');
    expect(resolveCompetenciaId('habilidad_analitica')).toBe('pensamiento_critico');
  });

  it('resolveCompetenciaId pasa-through IDs canónicos sin tocar', () => {
    expect(resolveCompetenciaId('trabajo_equipo')).toBe('trabajo_equipo');
    expect(resolveCompetenciaId('liderazgo')).toBe('liderazgo');
    expect(resolveCompetenciaId('adaptabilidad')).toBe('adaptabilidad');
  });

  it('resolveCompetenciaId es idempotente', () => {
    for (const id of Object.keys(COMPETENCIA_ALIASES)) {
      const once = resolveCompetenciaId(id);
      const twice = resolveCompetenciaId(once);
      expect(once).toBe(twice);
    }
  });

  it('resolveCompetenciaId devuelve el input para IDs desconocidos (no tira)', () => {
    expect(resolveCompetenciaId('xxx_no_existe')).toBe('xxx_no_existe');
    expect(resolveCompetenciaId('')).toBe('');
  });

  it('cada alias.alias_of apunta a un ID que existe en el catálogo', () => {
    const allIds = new Set(COMPETENCIAS.map((c) => c.id));
    for (const comp of COMPETENCIAS) {
      if (comp.alias_of) {
        expect(allIds.has(comp.alias_of)).toBe(true);
      }
    }
  });

  it('ningún canónico apunta a otro canónico vía alias_of (no cadenas)', () => {
    for (const comp of COMPETENCIAS) {
      if (comp.alias_of) {
        const target = COMPETENCIAS.find((c) => c.id === comp.alias_of);
        expect(target?.alias_of).toBeUndefined();
      }
    }
  });

  it('COMPETENCIAS_CANONICAS = catálogo - aliases', () => {
    expect(COMPETENCIAS_CANONICAS.length).toBe(
      COMPETENCIAS.length - Object.keys(COMPETENCIA_ALIASES).length,
    );
    for (const comp of COMPETENCIAS_CANONICAS) {
      expect(comp.alias_of).toBeUndefined();
    }
  });

  it('todos los IDs son únicos (sin duplicados literales)', () => {
    const ids = COMPETENCIAS.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});
