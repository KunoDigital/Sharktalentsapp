#!/usr/bin/env node
/**
 * SharkTalents MCP Server.
 *
 * Expone tools que Claude Desktop puede llamar para consultar/modificar la data del tenant.
 * Auth via API key (header `Authorization: Bearer st_live_...`).
 *
 * Setup en Claude Desktop (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "sharktalents": {
 *         "command": "node",
 *         "args": ["/path/to/sharktalents-mcp/dist/index.js"],
 *         "env": {
 *           "SHARKTALENTS_API_KEY": "st_live_xxx",
 *           "SHARKTALENTS_API_BASE": "https://...catalystserverless.com/server/api"
 *         }
 *       }
 *     }
 *   }
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { SharkTalentsClient } from './apiClient.js';
import { TOOLS, dispatchTool } from './tools.js';

const apiKey = process.env.SHARKTALENTS_API_KEY;
const apiBase = process.env.SHARKTALENTS_API_BASE;

if (!apiKey) {
  console.error('[sharktalents-mcp] FATAL: SHARKTALENTS_API_KEY no seteada');
  console.error('[sharktalents-mcp] Configurar en claude_desktop_config.json → mcpServers.sharktalents.env');
  process.exit(1);
}

const client = new SharkTalentsClient({ apiKey, baseUrl: apiBase });

const server = new Server(
  {
    name: 'sharktalents',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await dispatchTool(client, name, args ?? {});
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr no se mezcla con el protocol; podemos loggear acá
  console.error('[sharktalents-mcp] running on stdio');
}

main().catch((err) => {
  console.error('[sharktalents-mcp] fatal:', err);
  process.exit(1);
});
