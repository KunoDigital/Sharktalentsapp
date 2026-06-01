# SharkTalents MCP Server

MCP server (Model Context Protocol) que conecta Claude Desktop directamente a tu data en SharkTalents. Permite preguntas en lenguaje natural sobre tus puestos, candidatos, finalistas, cola de revisión del bot, etc.

## ¿Para qué sirve?

Una vez configurado en Claude Desktop, podés escribirle cosas como:

- *"¿Qué puestos tengo abiertos hoy?"*
- *"Mostrame los candidatos finalistas del puesto Backend Engineer en AcmeTech."*
- *"Tengo 7 items en la cola del bot — leéme los rationale uno por uno"*
- *"Confirmá la decisión 4 del bot, override la 6 con stage 'rejected_by_admin', razón 'no fitea con el jefe'"*

Claude consulta el MCP server, este consume la API pública de SharkTalents (con auth via API key) y devuelve los datos.

## Requisitos

- Node 20+
- API key de SharkTalents (crear en Settings → API keys del tenant)
- Claude Desktop instalado

## Instalación

### Opción A — desde el repo (recomendado mientras esté en desarrollo)

```bash
cd /path/to/sharktalentsapp/mcp
npm install
npm run build
```

El binario queda en `dist/index.js`.

### Opción B — npm install global (cuando se publique)

```bash
npm install -g @sharktalents/mcp
```

## Configuración en Claude Desktop

Editá `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) o el equivalente en Windows:

```json
{
  "mcpServers": {
    "sharktalents": {
      "command": "node",
      "args": ["/Users/usuario/sharktalentsapp/mcp/dist/index.js"],
      "env": {
        "SHARKTALENTS_API_KEY": "st_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "SHARKTALENTS_API_BASE": "https://sharktalentsapp-883996440.development.catalystserverless.com/server/api"
      }
    }
  }
}
```

Reiniciá Claude Desktop. El MCP server se ve en el ícono de "tools" abajo del chat.

## Tools disponibles (12)

### Jobs
- `jobs_list` — lista puestos del tenant (default solo activos)
- `jobs_get` — un puesto por ID con todos sus campos
- `jobs_create` — crea puesto nuevo
- `jobs_archive` — archiva (soft delete)

### Candidates
- `candidates_list` — lista del tenant
- `candidates_get` — uno por ID

### Applications (un candidato aplicando a un puesto)
- `applications_list` — filtrable por job_id
- `applications_get` — aplicación + histórico de transiciones
- `applications_get_with_scores` — aplicación + scores completos (DISC, VELNA, técnica, integridad, emocional)
- `applications_transition` — cambia stage del pipeline (valida state machine)

### Bot decisor
- `bot_review_queue_list` — items pendientes de revisión humana
- `bot_review_queue_decide` — confirma o overridea una sugerencia (queda como training example)

## Permisos y seguridad

El MCP server respeta los permisos asignados a la API key. Si la key tiene `'jobs:read'` solo, los tools de write fallarán con 403. Configurar permisos al crear la key.

## Troubleshooting

**"SHARKTALENTS_API_KEY no seteada"** → falta la env var en `claude_desktop_config.json`. Reiniciar Claude Desktop después de editar.

**"API error unauthorized: Invalid API key"** → la key fue revocada o no existe. Generar una nueva en Settings → API keys.

**"API error feature_disabled"** → la feature `api` no está habilitada para tu tenant. Activar en `Tenants.features_enabled`.

**"API error table_not_ready"** → alguna tabla deferred (Block 2) no fue creada en Catalyst. Ver `MIGRATIONS_BLOCK2.md`.

## Desarrollo

```bash
npm run watch    # rebuild on save
npm test         # vitest
```

## Licencia

MIT
