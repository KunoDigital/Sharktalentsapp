# Notas de seguridad — vulnerabilidades npm conocidas

`npm audit` reporta 3 vulnerabilities en el frontend (`shark/`). Análisis de cada una y decisión de mitigación.

**Última revisión:** 2026-05-04

---

## 1. `xlsx` (high) — Prototype Pollution + ReDoS

**CVE:** GHSA-4r6h-8v6p-xvw6 (Prototype Pollution) + GHSA-5pgg-2g8v-p4x9 (ReDoS)
**Severity:** High (CVSS 7.8 + 7.5)
**Fix disponible en npm:** ❌ No

### Por qué no la fixeamos

SheetJS (autores de `xlsx`) movió las versiones maintained a su CDN propio (https://cdn.sheetjs.com). Ya no publican en npm. La última versión en npm (0.18.5) tiene los CVEs sin parchear.

### Por qué no nos afecta en práctica

Las vulnerabilidades requieren **input malicioso** procesado por el parser:
- **Prototype Pollution:** atacante tiene que poder inyectar un XLSX manipulado al parser
- **ReDoS:** input untrusted procesado por regex internas

**Nuestro uso de xlsx:** solo **exportación** desde JSON nuestro (datos del backend). Nunca **importamos** XLSX de usuarios. El path de ataque está cerrado.

Archivos que usan xlsx:
- `shark/src/lib/excelExport.ts`
- Todos los `XLSX.utils.json_to_sheet(...)` y similares — read solo de objetos nuestros

### Acción tomada

✅ Documentado.
❌ NO migrar (riesgo bajo en producción + alto costo de cambiar librería de export).

### Mitigación futura (si las cosas cambian)

Si algún día agregamos **import de XLSX subido por usuarios** → migrar a `exceljs` (opensource maintained) o al CDN privado de SheetJS Pro.

---

## 2. `vite` (moderate) — Path Traversal en optimized deps `.map`

**CVE:** GHSA-4w7w-66w2-5vf9
**Severity:** Moderate
**Fix disponible:** Vite 8.x (semver major, riesgo de breaking changes)

### Por qué no la fixeamos

- Solo afecta el **dev server** de Vite (cuando corrés `npm run dev`)
- En producción, los archivos `.js` y `.css` se sirven desde Catalyst Web Hosting, no desde Vite
- Migrar a Vite 8 es semver major: requiere actualizar config, plugins, posibles breaking changes en build

### Por qué no nos afecta en práctica

- En desarrollo local: dev server escucha en `localhost:3000`, no expuesto a internet
- En producción: Vite no corre, solo sirve los assets pre-buildeados

### Acción tomada

✅ Documentado.
❌ NO upgrade hasta que Vite 5 esté EOL o haya un parche para la rama 5.

### Mitigación futura

- Cuando saquen Vite 5.x patcheado → upgrade
- O cuando hagamos el upgrade rutinario a Vite 7+ → atajamos esto + features nuevos

---

## 3. `esbuild` (moderate) — Dev server allows arbitrary requests

**CVE:** GHSA-67mh-4wv8-2f99
**Severity:** Moderate
**Fix:** viene con upgrade de Vite

### Por qué no la fixeamos

Mismo razonamiento que Vite — esbuild solo se usa en dev mode dentro de Vite.

### Acción tomada

✅ Documentado, no requiere acción separada.

---

## Política general

`npm audit fix --force` está **prohibido** porque hace upgrades semver-major sin contexto. Los upgrades de deps mayores se hacen manualmente con tests + verificación de breaking changes.

Cuando salga una vulnerability **realmente high con fix disponible no-major y afecta a producción**, se prioriza inmediato.

Las vulnerabilidades actuales:
- xlsx: alto severity pero **path de ataque cerrado** por nuestro uso (export-only)
- vite/esbuild: dev-only, no producción

**Riesgo neto: bajo.**

---

## Cómo revisar de nuevo

```bash
cd shark
npm audit --json | python3 -c "import json,sys; d=json.load(sys.stdin); [print(v['name'], v['severity'], v.get('fixAvailable')) for v in d['vulnerabilities'].values()]"
```

Si aparece una vulnerability nueva con `fixAvailable: true` y no semver-major → considerar parche inmediato.
