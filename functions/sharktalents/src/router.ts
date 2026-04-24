import { IncomingMessage, ServerResponse } from 'http';
import { parseUrl, matchRoute, sendJson, sendError } from './helpers';
import { verifyToken } from './auth';

type Handler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>, query: Record<string, string>) => Promise<void>;
type RouteEntry = { method: string; pattern: string; handler: Handler };

const routes: RouteEntry[] = [];

export function registerRoute(method: string, pattern: string, handler: Handler): void {
  routes.push({ method: method.toUpperCase(), pattern, handler });
}

export function GET(pattern: string, handler: Handler): void { registerRoute('GET', pattern, handler); }
export function POST(pattern: string, handler: Handler): void { registerRoute('POST', pattern, handler); }
export function PUT(pattern: string, handler: Handler): void { registerRoute('PUT', pattern, handler); }
export function PATCH(pattern: string, handler: Handler): void { registerRoute('PATCH', pattern, handler); }
export function DELETE(pattern: string, handler: Handler): void { registerRoute('DELETE', pattern, handler); }

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { path, query } = parseUrl(req);
  const method = (req.method || 'GET').toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Auth-Token',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  // Auth check: all /api/admin/* routes except /api/admin/login require valid token
  if (path.startsWith('/api/admin') && path !== '/api/admin/login') {
    const token = (req.headers as any)['x-auth-token'] || '';
    const user = token ? verifyToken(token) : null;
    if (!user) {
      sendError(res, 401, 'No autorizado');
      return;
    }
  }

  // Find matching route
  for (const route of routes) {
    if (route.method !== method) continue;
    const { matched, params } = matchRoute(path, route.pattern);
    if (matched) {
      try {
        console.log(`[ROUTER] Matched: ${method} ${path} → ${route.pattern}`);
        await route.handler(req, res, params, query);
        console.log(`[ROUTER] Completed: ${method} ${path}`);
      } catch (err: any) {
        console.error(`[ROUTER] Error in ${method} ${path}:`, err.message);
        console.error(`[ROUTER] Stack:`, err.stack?.split('\n').slice(0, 5).join('\n'));
        sendError(res, 500, err.message || 'Internal server error');
      }
      return;
    }
  }

  // Health check
  if (path === '/health' || path === '/api/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  sendError(res, 404, `Route not found: ${method} ${path}`);
}
