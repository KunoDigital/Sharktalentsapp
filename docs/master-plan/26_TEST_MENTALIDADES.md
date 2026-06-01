# 26 — Test de Mentalidades (Adaptabilidad y Resiliencia)

**Estado:** Diseño cerrado. Banco de 10 preguntas en repo. Implementación pendiente.

**Última actualización:** 2026-05-05

## Objetivo

Detectar si el candidato tiene una **mentalidad adaptable** o limitante por defecto. Output principal binario: adaptable / mixto / limitante. Output secundario: perfil de los 7 ejes McKinsey Forward.

## Por qué existe

Cris está certificándose en McKinsey Forward — Adaptabilidad y Resiliencia. El marco identifica patrones de pensamiento que predicen cómo una persona responde a cambios y desafíos. Es complemento al DISC (que mide estilo de comportamiento) y a la integridad (que mide actitud).

## Marco teórico

**McKinsey Forward — 7 pares de mentalidades:**

| Eje | Limitante | Adaptable |
|---|---|---|
| 1 (Aprendizaje) | Fija | Crecimiento |
| 2 (Conocimiento) | Experto/a | Curiosa |
| 3 (Resolución) | Reactiva | Creativa |
| 4 (Locus de control) | Víctima | Agente |
| 5 (Recursos) | Escasez | Abundancia |
| 6 (Estructura) | Certeza | Exploración |
| 7 (Riesgo) | Protección | Oportunidad |

**Punto central del marco:** no hay mentalidad "buena/mala" — hay mentalidad **adecuada al contexto**. Lo que importa es la autoconciencia y poder elegir deliberadamente.

## Diseño

### Formato

10 preguntas situacionales con **6 opciones cada una** = 3 ejes × 2 polos por pregunta. Esto fuerza al candidato a elegir explícitamente entre limitante y adaptable del mismo eje, dando señal psicométrica más fuerte.

### Output

**Métrica principal — adaptabilidad global:**

```
Score = (elecciones de polos adaptables) / 10 × 100
```

| Score | Categoría |
|---|---|
| 70-100% | Adaptable |
| 50-69% | Mixto |
| 0-49% | Limitante |

**Métrica secundaria — perfil por eje:** 14 polos con % de elección, drill-down disponible para Cris/cliente.

### Posicionamiento en el flow del candidato

Va **entre DISC y VELNA**, sin nombre revelador (titulado "Sección 2 — Preguntas extras") para evitar deseabilidad social.

```
1. Datos básicos
2. DISC                              ← existente
3. SECCIÓN 2 (test de mentalidades)  ← ESTE DOC
4. VELNA cognitivo                   ← existente
5. Integridad
6. Emocional
7. Técnica (si requerida)
8. Inglés (si requerido)
9. Videos abiertos
```

### Framing diferenciado por audiencia

| Audiencia | Cómo se llama | Mensaje |
|---|---|---|
| Candidato (UI) | "Sección 2 — Preguntas extras" | "Sobre cómo abordas situaciones cotidianas. No hay respuestas correctas." |
| Cris / cliente (reporte) | "Test de Mentalidades" | Detalle completo del marco McKinsey + perfil de los 7 ejes |
| Código backend | `mindset_test` | Identificador técnico |

**Por qué la diferenciación:** el marco McKinsey dice que las mentalidades **se manifiestan**, no se declaran. Si el candidato sabe que le están midiendo "adaptabilidad", se autorreporta como adaptable. Al presentarlo neutramente, su mentalidad real aparece en las elecciones.

### Principios de diseño del banco

Estos son **críticos para validez psicométrica**:

1. **Ninguna opción suena "mala"** — la mentalidad limitante NO es "perezoso/a o ignorante/a", es respuesta legítima pero por defecto distinto. Si una opción se delata como "la mala", deseabilidad social mata el test.

2. **Escenarios del DÍA A DÍA, no del trabajo** — el contexto laboral activa "modo entrevista" (curado, performativo). Cotidiano (relaciones, hobbies, salud, hogar) revela patrones auténticos.

3. **Categorías cubiertas** — las 10 preguntas tocan 7 categorías: aprender, social, salud, hogar, relaciones, tiempo libre, imprevistos.

### Banco completo

Las 10 preguntas viven en `shark/src/data/questions/mindset.json`.
Configuración (mapeo mentalidad → eje + polo, thresholds): `shark/src/data/mindset-config.json`.

Distribución de ejes en las 10 preguntas:

| Eje | Apariciones |
|---|---|
| 1 (Fija/Crecimiento) | 4 |
| 2 (Experto/Curiosa) | 4 |
| 3 (Reactiva/Creativa) | 5 |
| 4 (Víctima/Agente) | 5 |
| 5 (Escasez/Abundancia) | 4 |
| 6 (Certeza/Exploración) | 4 |
| 7 (Protección/Oportunidad) | 4 |

## Implementación pendiente

### Schema (Catalyst Datastore)

**Tabla nueva: `MindsetScores`** (20 columnas)

Schema completo: `docs/master-plan/MIGRATIONS_TESTS_NUEVOS.csv`.

**Columna adicional en `Jobs`:**
- `mindset_test_enabled` (Boolean, default true) — para deshabilitar opcionalmente por puesto

### Backend (functions/api/src/)

- `features/mindsetTest.ts` — endpoints de test (start, submit answers)
- `lib/mindsetScoring.ts` — lógica de scoring (cuenta polos elegidos, computa adaptabilidad global, perfil por eje)
- Wire al router

### Frontend (shark/src/)

- `pages/CandidateMindsetTest.tsx` — UI con escenarios + 6 opciones randomizadas (orden aleatorio para evitar position bias)
- Modificar JobForm para toggle "Habilitar test de mentalidades" (default ON)
- Modificar candidate test journey para incluir el bloque entre DISC y VELNA
- Modificar reporte cliente para mostrar el perfil de mentalidades

### Catalyst Console

- Crear tabla `MindsetScores` con schema del CSV
- Agregar columna `mindset_test_enabled` a Jobs

## Referencias

- Marco McKinsey Forward: https://www.mckinsey.com/forward
- Lecciones del curso de Cris: archivos `Expertosocialshark/info-del-curso/`
- Doc de mejoras (con detalle de exploración): [docs/MEJORAS.md](../MEJORAS.md) sección 2
- Doc de prueba técnica de doble eje (otro test situacional): [19_PRUEBA_TECNICA_DOBLE_EJE.md](19_PRUEBA_TECNICA_DOBLE_EJE.md)
