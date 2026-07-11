import type { IncomingMessage, ServerResponse } from 'http';

export type AuthUser = {
  id: string;
  clerk_user_id: string;
  clerk_org_id: string | null;
  clerk_org_role: string | null;
  email: string | null;
  // Rol a nivel usuario (independiente de org). Se lee de Clerk publicMetadata.role.
  // Valores esperados hoy: 'freelance' | null. Se usa para separar freelance del ATS.
  role: string | null;
};

export type TenantSummary = {
  id: string;
  clerk_org_id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'deleted';
};

export type RequestContext = {
  req: IncomingMessage;
  res: ServerResponse;
  traceId: string;
  startedAt: number;
  user: AuthUser | null;
  tenantId: string | null;
  tenant: TenantSummary | null;
};

export function createContext(req: IncomingMessage, res: ServerResponse): RequestContext {
  const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomTraceId();
  res.setHeader('X-Trace-Id', traceId);
  return {
    req,
    res,
    traceId,
    startedAt: Date.now(),
    user: null,
    tenantId: null,
    tenant: null,
  };
}

function randomTraceId(): string {
  return `trc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
