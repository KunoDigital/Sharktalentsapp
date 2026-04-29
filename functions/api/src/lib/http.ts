import type { IncomingMessage, ServerResponse } from 'http';

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function sendNoContent(res: ServerResponse, status = 204): void {
  res.statusCode = status;
  res.end();
}

export async function readRawBody(req: IncomingMessage, maxBytes = 1_048_576): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > maxBytes) throw new Error(`Request body too large (>${maxBytes} bytes)`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readJsonBody<T = unknown>(req: IncomingMessage, maxBytes = 1_048_576): Promise<T> {
  const raw = await readRawBody(req, maxBytes);
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`Invalid JSON body: ${(err as Error).message}`);
  }
}
