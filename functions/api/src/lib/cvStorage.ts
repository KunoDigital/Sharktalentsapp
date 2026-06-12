/**
 * Sube PDFs de CV al Catalyst File Store. Reutiliza el patrón de
 * largeContentStore.ts pero específico para uploads de candidatos.
 *
 * Folder ID: `FILESTORE_CV_FOLDER_ID` (env var — Cris la setea en Catalyst Console).
 */
import type { IncomingMessage } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { filestore } from './db';
import { logger } from './logger';
import { env } from './env';

const log = logger('CV_STORAGE');

/**
 * Sube un PDF al File Store y devuelve el file_id. Si falla, throw error.
 */
export async function uploadCvToFileStore(
  req: IncomingMessage,
  buffer: Buffer,
  filename: string,
): Promise<string> {
  const e = env();
  const folderId = e.FILESTORE_CV_FOLDER_ID;
  if (!folderId) {
    throw new Error('FILESTORE_CV_FOLDER_ID no configurado en env');
  }

  // Mismo workaround que largeContentStore: form-data necesita el path real
  // del archivo en disco para calcular content-length.
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  const tmpPath = path.join(os.tmpdir(), `${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}_${safeName}`);
  fs.writeFileSync(tmpPath, buffer);

  try {
    const folder = (filestore(req) as { folder: (id: string) => unknown }).folder(folderId);
    const stream = fs.createReadStream(tmpPath);
    const result = await (folder as {
      uploadFile: (opts: { name: string; code: fs.ReadStream }) => Promise<{ id?: string; file_id?: string; ROWID?: string }>;
    }).uploadFile({ name: safeName, code: stream });
    const fileId = String(result.id ?? result.file_id ?? result.ROWID ?? '');
    if (!fileId) {
      throw new Error('Catalyst File Store devolvió file_id vacío');
    }
    log.info('cv uploaded', { fileId, size: buffer.length, filename: safeName });
    return fileId;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* best-effort */ }
  }
}

/**
 * Descarga un CV del File Store por fileId. Devuelve el buffer del PDF.
 * Mismo patrón que largeContentStore.downloadFile.
 */
export async function downloadCvFromFileStore(
  req: IncomingMessage,
  fileId: string,
): Promise<Buffer> {
  const e = env();
  const folderId = e.FILESTORE_CV_FOLDER_ID;
  if (!folderId) {
    throw new Error('FILESTORE_CV_FOLDER_ID no configurado en env');
  }
  const folder = (filestore(req) as { folder: (id: string) => unknown }).folder(folderId);
  const buffer = await (folder as { downloadFile: (id: string) => Promise<Buffer> }).downloadFile(fileId);
  log.info('cv downloaded', { fileId, size: buffer.length });
  return buffer;
}
