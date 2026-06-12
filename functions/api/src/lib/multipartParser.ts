/**
 * Parser minimalista de multipart/form-data.
 *
 * Por qué hecho a mano y no `busboy`/`multer`: Catalyst Advanced I/O tiene
 * restricciones en algunos módulos npm + queremos cero dependencias extra.
 * Para nuestro caso (1-2 archivos pequeños + algunos campos de texto) es
 * suficiente.
 *
 * Límites razonables: body total ≤ 15MB, archivos individuales ≤ 10MB.
 */
import type { IncomingMessage } from 'http';
import { ValidationError } from './errors';

const MAX_BODY = 15 * 1024 * 1024;

export type ParsedFile = {
  fieldName: string;
  filename: string;
  mimeType: string;
  data: Buffer;
};

export type ParsedMultipart = {
  fields: Record<string, string>;
  files: ParsedFile[];
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > MAX_BODY) throw new ValidationError(`body exceeds ${MAX_BODY} bytes`);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function getBoundary(contentType: string | undefined): string {
  if (!contentType) throw new ValidationError('Content-Type missing');
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) throw new ValidationError('boundary missing in Content-Type');
  return boundary.trim();
}

/** Divide un buffer por un separador (boundary). */
function splitBufferByBoundary(body: Buffer, boundary: string): Buffer[] {
  const sep = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let start = 0;
  while (start < body.length) {
    const idx = body.indexOf(sep, start);
    if (idx === -1) break;
    if (start > 0) {
      // Recortar `\r\n` antes del boundary.
      parts.push(body.slice(start, idx - 2));
    }
    start = idx + sep.length;
  }
  return parts;
}

/** Parsea las cabeceras de UNA parte y devuelve fieldName/filename/mimeType. */
function parsePartHeaders(headerSection: string): { fieldName: string; filename?: string; mimeType?: string } {
  const disposition = /Content-Disposition:\s*form-data;\s*([^\r\n]+)/i.exec(headerSection);
  if (!disposition) throw new ValidationError('multipart part missing Content-Disposition');
  const nameMatch = /name="([^"]+)"/i.exec(disposition[1]);
  const filenameMatch = /filename="([^"]+)"/i.exec(disposition[1]);
  const fieldName = nameMatch?.[1] ?? '';
  const filename = filenameMatch?.[1];
  const mimeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerSection);
  const mimeType = mimeMatch?.[1]?.trim();
  if (!fieldName) throw new ValidationError('multipart part missing field name');
  return { fieldName, filename, mimeType };
}

export async function parseMultipart(req: IncomingMessage): Promise<ParsedMultipart> {
  const contentType = typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    throw new ValidationError('expected Content-Type: multipart/form-data');
  }
  const boundary = getBoundary(contentType);
  const body = await readBody(req);

  const rawParts = splitBufferByBoundary(body, boundary);
  const fields: Record<string, string> = {};
  const files: ParsedFile[] = [];

  for (const partBuf of rawParts) {
    // Saltar parts vacías o el cierre final (`--`).
    if (partBuf.length < 4) continue;
    if (partBuf.length >= 2 && partBuf[0] === 0x2d && partBuf[1] === 0x2d) continue; // ends with `--`

    // Cabeceras hasta `\r\n\r\n`, después datos.
    const sepIdx = partBuf.indexOf('\r\n\r\n');
    if (sepIdx === -1) continue;
    const headerSection = partBuf.slice(0, sepIdx).toString('utf-8');
    const data = partBuf.slice(sepIdx + 4);
    const { fieldName, filename, mimeType } = parsePartHeaders(headerSection);

    if (filename) {
      files.push({ fieldName, filename, mimeType: mimeType ?? 'application/octet-stream', data });
    } else {
      // Recortar el `\r\n` final si existe.
      const trimmed = data.length >= 2 && data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a
        ? data.slice(0, -2)
        : data;
      fields[fieldName] = trimmed.toString('utf-8');
    }
  }

  return { fields, files };
}
