# Architecture Decision Records (ADR)

Decisiones arquitectónicas importantes del proyecto. Cada ADR es inmutable una vez aceptado — si una decisión cambia, se crea un nuevo ADR que la supersede.

## Convención de nombres
`<NNN>-<slug-en-minusculas>.md` — ej: `005-clerk-auth.md`.

## ADRs registrados en el master plan

Los ADRs principales están definidos en [docs/master-plan/01_PRINCIPIOS_Y_ALCANCE.md](../master-plan/01_PRINCIPIOS_Y_ALCANCE.md). Lista canónica:

- ADR-001: Seguir con Cloud Scale (no migrar a Slate).
- ADR-002: Mantener HashRouter en frontend.
- ADR-003: TypeScript estricto en backend (`strict: true`).
- ADR-004: Sin tests automatizados en esta fase.
- ADR-005: Clerk para auth y organizations.
- ADR-006: API pública con OpenAPI + API keys por tenant.
- ADR-007: MCP Server como package npm standalone.
- ADR-008: SharkTalents como fuente de verdad del pipeline operativo.
- ADR-009: Bot decisor con cold-start gradual rollout.
- ADR-010: HeyReach como outbound LinkedIn.
- ADR-011: Videos dinámicos reemplazan entrevista intermedia.

Los detalles viven en el master plan. Esta carpeta queda para ADRs **nuevos** que surjan durante la ejecución y no estén ya cubiertos.

## Template para ADR nuevo

```markdown
# ADR-NNN: <título corto>

## Contexto
<problema o pregunta arquitectónica>

## Decisión
**<resumen en 1-2 frases>**

## Razones
1. ...
2. ...

## Consecuencias
- Positivas: ...
- Negativas / trade-offs: ...

## Alternativas consideradas
- A. ... — descartada porque ...
- B. ... — descartada porque ...
```
