import { IncomingMessage, ServerResponse } from 'http';

// ── Parse body (replaces express.json()) ──
export function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    // Catalyst may pre-parse the body
    if ((req as any).body) return resolve((req as any).body);
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

// ── Send JSON response (replaces res.json()) ──
export function sendJson(res: ServerResponse, status: number, data: any): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Auth-Token',
  });
  res.end(JSON.stringify(data));
}

// ── Send PDF response ──
export function sendPdf(res: ServerResponse, buffer: Buffer, filename: string): void {
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(buffer);
}

// ── Send error ──
export function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

// ── Parse URL path and query ──
export function parseUrl(req: IncomingMessage): { path: string; query: Record<string, string> } {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  // Strip the Catalyst function prefix: /server/sharktalents
  let path = url.pathname.replace(/^\/server\/sharktalents/, '');
  if (!path.startsWith('/')) path = '/' + path;
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (query[k] = v));
  return { path, query };
}

// ── Simple route matcher ──
export function matchRoute(
  path: string,
  pattern: string
): { matched: boolean; params: Record<string, string> } {
  const pathParts = path.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);

  if (pathParts.length !== patternParts.length) return { matched: false, params: {} };

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return { matched: false, params: {} };
    }
  }
  return { matched: true, params };
}
