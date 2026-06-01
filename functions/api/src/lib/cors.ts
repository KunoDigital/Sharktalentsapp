import type { IncomingMessage, ServerResponse } from 'http';

const ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'X-Trace-Id',
  'X-Internal-Key',
  // Landing de marketing
  'X-Marketing-Site-Key',
  'X-Visit-Id',
  'X-Meta-Event-Id',
  // Webhooks Clerk (svix)
  'svix-id',
  'svix-signature',
  'svix-timestamp',
].join(', ');

const ALLOWED_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';

/**
 * Aplica headers CORS si el origin del request matchea con la lista permitida.
 * Lista de allowed origins: var de entorno ALLOWED_ORIGINS, comma-separated.
 *
 * NUNCA usar `*` con credentials (CLAUDE.md).
 *
 * FIX 2026-05-12: Catalyst Gateway (ZGS) parece duplicar Access-Control-Allow-Origin
 * y Allow-Credentials cuando los seteamos nosotros. Usamos `removeHeader()` defensivo
 * antes de cada `setHeader()` para garantizar que nuestro código no contribuye a la
 * duplicación. Si la duplicación viene post-handler del runtime, queda como prioridad
 * para reportar a Zoho.
 */
export function applyCors(req: IncomingMessage, res: ServerResponse, allowedOrigins: string): boolean {
  const origin = (req.headers.origin as string | undefined) ?? '';
  const list = allowedOrigins.split(',').map((s) => s.trim()).filter(Boolean);
  const isAllowed = list.includes(origin);

  if (isAllowed) {
    // FIX 2026-05-12: El runtime/gateway de Catalyst Functions duplica `Allow-Origin`
    // y `Allow-Credentials` cuando los seteamos nosotros (los serializa lowercased y
    // los agrega además del nuestro). Por eso NO los seteamos desde acá — Catalyst
    // los inyecta automático basado en su config interna del proyecto.
    // Los demás (Methods, Headers, Max-Age, Vary) sí los manejamos nosotros porque
    // Catalyst no los agrega por su cuenta.
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    res.setHeader('Access-Control-Max-Age', '600');
  }
  return isAllowed;
}

export function handlePreflight(res: ServerResponse): void {
  res.statusCode = 204;
  res.end();
}
