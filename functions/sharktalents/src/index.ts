import { IncomingMessage, ServerResponse } from 'http';
import { handleRequest } from './router';
import { registerAdminJobRoutes } from './routes/adminJobs';
import { registerAdminAssessmentRoutes } from './routes/adminAssessments';
import { registerAdminResultRoutes } from './routes/adminResults';
import { registerAdminCandidateRoutes } from './routes/adminCandidates';
import { registerAdminLibraryRoutes } from './routes/adminLibrary';
import { registerPublicTestRoutes } from './routes/publicTest';
import { registerPublicReportRoutes } from './routes/publicReport';
import { registerAdminReportRoutes } from './routes/adminReports';
import { registerAuthRoutes } from './routes/auth';

console.log('[INIT] Registering routes...');
registerAuthRoutes();
registerAdminReportRoutes();
registerAdminJobRoutes();
registerAdminAssessmentRoutes();
registerAdminResultRoutes();
registerAdminCandidateRoutes();
registerAdminLibraryRoutes();
registerPublicTestRoutes();
registerPublicReportRoutes();
console.log('[INIT] Routes registered');

module.exports = async (req: IncomingMessage, res: ServerResponse) => {
  const ts = Date.now();
  console.log(`[REQ] ${req.method} ${req.url}`);
  console.log(`[REQ] Headers:`, JSON.stringify({
    'content-type': (req.headers as any)['content-type'],
    'cookie': (req.headers as any)['cookie'] ? 'PRESENT' : 'ABSENT',
    'x-zc-project': (req.headers as any)['x-zc-project'],
    'x-catalyst-org': (req.headers as any)['x-catalyst-org'],
    'user-agent': ((req.headers as any)['user-agent'] || '').substring(0, 50),
  }));

  try {
    await handleRequest(req, res);
    console.log(`[REQ] Completed in ${Date.now() - ts}ms`);
  } catch (err: any) {
    console.error(`[REQ] UNHANDLED ERROR:`, err.message);
    console.error(`[REQ] Stack:`, err.stack?.split('\n').slice(0, 5).join('\n'));
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'Internal server error', detail: err.message }));
  }
};
