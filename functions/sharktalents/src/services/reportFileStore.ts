import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const catalyst = require('zcatalyst-sdk-node');

const FOLDER_NAME = 'reports';
let cachedFolderId: string | null = null;

async function getFolderId(app: any): Promise<string> {
  if (cachedFolderId) return cachedFolderId;
  const filestore = app.filestore();
  try {
    const folders = await filestore.getAllFolders();
    const existing = folders.find((f: any) => f._folderDetails?.folder_name === FOLDER_NAME || f.folder_name === FOLDER_NAME);
    if (existing) {
      cachedFolderId = String(existing._folderDetails?.id || existing.id);
      return cachedFolderId!;
    }
  } catch {}
  const created = await filestore.createFolder(FOLDER_NAME);
  cachedFolderId = String(created._folderDetails?.id || created.id);
  return cachedFolderId!;
}

export async function saveReportJson(req: any, reportId: string, candidateId: string, data: any): Promise<string> {
  const app = catalyst.initialize(req);
  const folderId = await getFolderId(app);
  const folder = app.filestore().folder(folderId);

  const fileName = `report_${reportId}_${candidateId}.json`;
  const tmpPath = path.join(os.tmpdir(), fileName);
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 0));

  try {
    const result = await folder.uploadFile({
      code: fs.createReadStream(tmpPath),
      name: fileName,
    });
    const fileId = String(result.id || result.ROWID);
    console.log(`[FILE_STORE] Saved ${fileName}, file_id: ${fileId}, size: ${fs.statSync(tmpPath).size} bytes`);
    return fileId;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

export async function loadReportJson(req: any, fileId: string): Promise<any | null> {
  if (!fileId) return null;
  try {
    const app = catalyst.initialize(req);
    const folderId = await getFolderId(app);
    const folder = app.filestore().folder(folderId);
    const buffer = await folder.downloadFile(fileId);
    return JSON.parse(buffer.toString('utf-8'));
  } catch (err: any) {
    console.warn(`[FILE_STORE] Failed to load file ${fileId}:`, err.message);
    return null;
  }
}

export async function deleteReportJson(req: any, fileId: string): Promise<void> {
  if (!fileId) return;
  try {
    const app = catalyst.initialize(req);
    const folderId = await getFolderId(app);
    const folder = app.filestore().folder(folderId);
    await folder.deleteFile(fileId);
    console.log(`[FILE_STORE] Deleted file ${fileId}`);
  } catch (err: any) {
    console.warn(`[FILE_STORE] Failed to delete file ${fileId}:`, err.message);
  }
}
