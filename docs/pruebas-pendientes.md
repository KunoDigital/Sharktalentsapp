# Pruebas pendientes — SharkTalents V2

Validaciones que requieren un candidato/puesto real o intervención de Cris para confirmar que algo funciona como esperado.

**Última actualización:** 2026-06-12

---

## 1. Validación del análisis IA Conductual (Capa 4) ⏳

**Estado:** Implementado, NO deployado. Esperando validación con caso real.

**Última actualización:** 2026-06-12

### Qué hay que probar

El endpoint `GET /api/applications/:id/conductual-analysis` genera un análisis IA del candidato con:
- veredicto (encaja / encaja_con_reservas / no_encaja)
- 3-5 razones a favor referenciando contexto del puesto
- 2-4 razones en contra honestas
- recomendación accionable
- alertas específicas (anti-cheat, mismatch boss, etc.)
- resumen ejecutivo 1-2 frases

### Cómo probarlo

1. Identificar un `application_id` de un candidato real que ya tenga Scores completos (al menos DISC + VELNA + Emoción cargados)
2. Hacer: `GET /server/api/applications/<application_id>/conductual-analysis` con auth tenant
3. Validar:
   - ¿El veredicto refleja lo que vos pensarías al mirar los scores?
   - ¿Las razones a favor REFERENCIAN datos concretos (no son genéricas)?
   - ¿Las razones en contra son honestas, sin inventar problemas?
   - ¿Considera el `context_summary` del puesto al razonar?
   - ¿El tono es CRUDO/HONESTO (sin "este candidato es excelente en todo")?

### Criterios de aceptación antes de deploy

- ✅ Output respeta el schema (tool calling forzado, validación lo asegura)
- ⏳ Cris confirma que el veredicto refleja su análisis manual del mismo candidato
- ⏳ Cris confirma que el tono no tiene sesgo de elogio
- ⏳ Cris confirma que las razones referencian el contexto del puesto

### Si el output NO es bueno

- Refinar el `SYSTEM_PROMPT` en `functions/api/src/lib/conductualAnalysis.ts`
- Posibles ajustes: más ejemplos de tono crudo, más restricciones de qué NO decir, ajustar `temperature` (hoy 0.3)
- Re-correr la prueba

### Costo de cada corrida de prueba

~$0.05-0.10 por análisis (Claude Sonnet). Cache 1h, no se cobra de nuevo si se pide al mismo input dentro de la hora.

### Archivos involucrados

- `functions/api/src/lib/conductualAnalysis.ts`
- `functions/api/src/features/applications.ts` (handler `getConductualAnalysis`)
- `functions/api/src/router.ts` (ruta nueva)

---

## Plantilla para nuevas pruebas pendientes

```markdown
## N. <Título de la prueba>

**Estado:** Implementado / En diseño / Bloqueado por X

**Última actualización:** YYYY-MM-DD

### Qué hay que probar

### Cómo probarlo

### Criterios de aceptación antes de deploy

### Si falla la validación
```
