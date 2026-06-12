/**
 * Helper para contenido que puede exceder el límite de Catalyst Text (10K chars).
 *
 * **Estrategia:**
 *   - Si el contenido entra en 9_500 chars → guardar inline en la columna (string normal).
 *   - Si excede → subir a Catalyst File Store, guardar `file:<file_id>` como marcador.
 *
 * **Lectura:**
 *   - `loadLargeContent()` detecta el prefijo `file:` y descarga del File Store.
 *   - Si no hay prefijo, devuelve el valor tal cual.
 *
 * **Folder de File Store:** se configura via `FILESTORE_LARGE_CONTENT_FOLDER_ID` en
 * Catalyst Console (File Store → Create Folder → copiar ROWID).
 *
 * Aplica a:
 *   - ClientReports.bundle_payload    (puede ser >9.5K si hay 4 candidatos con notas largas)
 *   - JobProfileDrafts.transcript     (transcripción Whisper de briefing 30-60min)
 *   - JobProfileDrafts.draft_payload  (perfil ideal completo + tech_questions + boss profile)
 *   - Jobs.tech_questions_cache       (4-6 preguntas con explicación detallada)
 *   - Briefings.transcript_text       (transcripción de briefing inicial)
 */

import type { IncomingMessage } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { filestore } from './db.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { AppError } from './errors.js';

const log = logger('LARGE_CONTENT');

const FILE_PREFIX = 'file:';

/** Threshold por debajo del cual se guarda inline (sin tocar File Store). */
export const INLINE_THRESHOLD = 9_500;

/**
 * Persiste contenido grande, eligiendo automáticamente entre inline y File Store.
 *
 * @returns string para guardar en la columna Text:
 *   - Contenido literal si entra en 9_500 chars.
 *   - `file:<file_id>` si fue subido al File Store.
 */
export async function persistLargeContent(
  req: IncomingMessage,
  content: string,
  contextLabel: string,
): Promise<string> {
  if (content.length <= INLINE_THRESHOLD) return content;

  const folderId = env().FILESTORE_LARGE_CONTENT_FOLDER_ID;
  if (!folderId) {
    throw new AppError(
      503,
      'large_content_folder_not_configured',
      `FILESTORE_LARGE_CONTENT_FOLDER_ID no configurado. ${contextLabel} requiere File Store (${content.length} chars).`,
    );
  }

  // Catalyst File Store rechaza filenames con múltiples puntos (INVALID_INPUT).
  // Sanitizar TODO a alfanumérico/underscore + agregar una única extensión.
  const safeLabel = contextLabel.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `${safeLabel}_${Date.now()}.txt`;
  const buffer = Buffer.from(content, 'utf8');

  log.info('uploading large content to file store', {
    contextLabel,
    chars: content.length,
    filename,
  });

  // Catalyst SDK v2.5 espera específicamente fs.ReadStream (no Readable genérico).
  // form-data necesita poder hacer stat() del file para calcular el content-length del
  // multipart. Readable.from(buffer) no expone el path → form-data no calcula longitud
  // → multipart se manda mal → Catalyst responde INVALID_INPUT.
  // Solución: persistir buffer a /tmp y usar fs.createReadStream — el path real permite
  // que form-data lea el size correctamente.
  const tmpPath = path.join(os.tmpdir(), `${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}_${filename}`);
  fs.writeFileSync(tmpPath, buffer);

  let fileId: string;
  try {
    const folder = (filestore(req) as { folder: (id: string) => unknown }).folder(folderId);
    const stream = fs.createReadStream(tmpPath);
    const result = await (folder as {
      uploadFile: (opts: { name: string; code: fs.ReadStream }) => Promise<{ id?: string; file_id?: string; ROWID?: string }>;
    }).uploadFile({ name: filename, code: stream });
    // Catalyst SDK v2.5 devuelve { id, file_name, file_size, ... } — el campo es `id`.
    fileId = String(result.id ?? result.file_id ?? result.ROWID ?? '');
  } catch (err) {
    // El SDK de Catalyst a veces tira objetos sin .message — extraemos lo que podamos.
    const errAny = err as Record<string, unknown> | null;
    const errDetail = errAny
      ? (typeof errAny['message'] === 'string' && errAny['message']) ||
        (typeof errAny['error_message'] === 'string' && errAny['error_message']) ||
        (typeof errAny['error_code'] === 'string' && `code ${errAny['error_code']}`) ||
        JSON.stringify(errAny).slice(0, 300) ||
        String(err)
      : String(err);
    log.error('file store upload failed', {
      contextLabel,
      chars: content.length,
      folderId,
      filename,
      error: errDetail,
      raw: JSON.stringify(err)?.slice(0, 500),
    });
    throw new AppError(
      502,
      'large_content_upload_failed',
      `Failed to upload ${contextLabel} to File Store (folder ${folderId}): ${errDetail}`,
    );
  } finally {
    // Cleanup tmp file pase lo que pase.
    try { fs.unlinkSync(tmpPath); } catch { /* no-op */ }
  }

  if (!fileId) {
    throw new AppError(502, 'large_content_no_file_id', `File Store no devolvió file_id para ${contextLabel}`);
  }

  return `${FILE_PREFIX}${fileId}`;
}

/**
 * Carga contenido grande, detectando si es inline o referencia a File Store.
 *
 * @param storedValue lo que está en la columna (string inline, `file:<id>`, o null)
 * @returns el contenido completo, o null si no había nada
 */
export async function loadLargeContent(
  req: IncomingMessage,
  storedValue: string | null | undefined,
): Promise<string | null> {
  if (!storedValue) return null;
  if (!storedValue.startsWith(FILE_PREFIX)) return storedValue;

  const fileId = storedValue.slice(FILE_PREFIX.length);
  const folderId = env().FILESTORE_LARGE_CONTENT_FOLDER_ID;
  if (!folderId) {
    throw new AppError(
      503,
      'large_content_folder_not_configured',
      'FILESTORE_LARGE_CONTENT_FOLDER_ID no configurado, no se puede leer contenido del File Store.',
    );
  }

  try {
    const folder = (filestore(req) as { folder: (id: string) => unknown }).folder(folderId);
    // Catalyst SDK v2.5: el download se hace directo desde folder.downloadFile(id),
    // NO folder.file(id).downloadFile(). El primer patrón fue de una versión vieja.
    const buffer = await (folder as { downloadFile: (id: string) => Promise<Buffer> }).downloadFile(fileId);
    return buffer.toString('utf8');
  } catch (err) {
    log.error('file store download failed', {
      fileId,
      error: (err as Error).message,
    });
    throw new AppError(
      502,
      'large_content_download_failed',
      `Failed to download from File Store: ${(err as Error).message}`,
    );
  }
}

/** Borra el archivo asociado si el valor era una referencia a File Store. No-op si era inline. */
export async function deleteLargeContent(
  req: IncomingMessage,
  storedValue: string | null | undefined,
): Promise<void> {
  if (!storedValue || !storedValue.startsWith(FILE_PREFIX)) return;
  const fileId = storedValue.slice(FILE_PREFIX.length);
  const folderId = env().FILESTORE_LARGE_CONTENT_FOLDER_ID;
  if (!folderId) return;

  try {
    // Catalyst SDK v2.5: folder.deleteFile(id) directo, mismo patrón que downloadFile.
    const folder = (filestore(req) as { folder: (id: string) => unknown; deleteFile?: never }).folder(folderId);
    await (folder as { deleteFile: (id: string) => Promise<unknown> }).deleteFile(fileId);
  } catch (err) {
    log.warn('file store delete failed (non-fatal)', {
      fileId,
      error: (err as Error).message,
    });
  }
}

/** Helper para JSON: stringifica + persiste con la estrategia correcta. */
export async function persistLargeJson(
  req: IncomingMessage,
  obj: unknown,
  contextLabel: string,
): Promise<string> {
  const json = JSON.stringify(obj);
  return persistLargeContent(req, json, contextLabel);
}

/** Helper inverso: load + JSON.parse. Devuelve null si no había nada. */
export async function loadLargeJson<T = unknown>(
  req: IncomingMessage,
  storedValue: string | null | undefined,
): Promise<T | null> {
  const raw = await loadLargeContent(req, storedValue);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** True si el valor guardado apunta al File Store (vs inline). Útil para tests. */
export function isFileStoreRef(value: string | null | undefined): boolean {
  return Boolean(value && value.startsWith(FILE_PREFIX));
}
