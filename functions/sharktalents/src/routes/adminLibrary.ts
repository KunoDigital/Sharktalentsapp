import { GET, POST, DELETE } from '../router';
import { parseBody, sendJson, sendError } from '../helpers';
import * as db from '../db';

export function registerAdminLibraryRoutes(): void {
  GET('/api/admin/library', async (req, res) => {
    const items = await db.queryAll(req, `SELECT * FROM TechLibrary ORDER BY created_at DESC`, 'TechLibrary');
    sendJson(res, 200, items);
  });

  POST('/api/admin/library', async (req, res) => {
    const body = await parseBody(req);
    if (!body.name || !body.prompt) return sendError(res, 400, 'name and prompt are required');
    const item = await db.insert(req, 'TechLibrary', { name: body.name, company: body.company || '', prompt: body.prompt, origin: 'manual', created_at: db.now() });
    sendJson(res, 201, item);
  });

  DELETE('/api/admin/library/:id', async (req, res, params) => {
    await db.deleteRow(req, 'TechLibrary', params.id);
    sendJson(res, 200, { success: true });
  });
}
