import { POST } from '../router';
import { parseBody, sendJson, sendError } from '../helpers';
import { verifyPassword, createToken } from '../auth';

export function registerAuthRoutes(): void {
  POST('/api/admin/login', async (req, res) => {
    const body = await parseBody(req);
    const { username, password } = body;
    if (!username || !password) return sendError(res, 400, 'Usuario y contraseña requeridos');

    const validUser = username === process.env.ADMIN_USER;
    const validPass = verifyPassword(password);

    if (!validUser || !validPass) {
      return sendError(res, 401, 'Credenciales inválidas');
    }

    const token = createToken(username);
    sendJson(res, 200, { token, username });
  });
}
