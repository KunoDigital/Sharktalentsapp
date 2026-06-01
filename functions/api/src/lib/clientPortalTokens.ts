/**
 * Tokens firmados para el portal del cliente externo (la empresa que contrata a Cris).
 *
 * El portal NO existe como tabla todavía (sería ClientPortals en Block 2). Mientras tanto,
 * los datos del cliente (nombre, email, agencia, empresa) viven dentro del token mismo:
 * cuando Cris genera el link, embebe quién es el cliente y qué empresa.
 *
 * Ventaja: zero state. Desventaja: para revocar un link hay que rotar URL_SIGNING_SECRET
 * (afecta TODOS los tokens, no solo uno). Cuando se cree ClientPortals, migrar a token
 * con `ref = portal_id` y lookup en BD.
 */
import { signToken, verifyToken, expiresIn, DAY_SEC, type TokenClaims } from './urlSigning';

export type PortalTokenClaims = TokenClaims & {
  kind: 'portal';
  ref: string;            // tenant_id (Cris's agency)
  company: string;        // client company name (matches Jobs.company)
  client_name: string;
  client_email: string;
  agency_name: string;
};

export type PortalTokenInput = {
  ref: string;
  company: string;
  client_name: string;
  client_email: string;
  agency_name: string;
  ttl_days?: number;
};

export function signPortalToken(input: PortalTokenInput, secret?: string): string {
  const ttl = (input.ttl_days ?? 90) * DAY_SEC;
  return signToken({
    kind: 'portal',
    ref: input.ref,
    company: input.company,
    client_name: input.client_name,
    client_email: input.client_email,
    agency_name: input.agency_name,
    exp: expiresIn(ttl),
  }, secret);
}

export function verifyPortalToken(token: string, secret?: string): PortalTokenClaims {
  const claims = verifyToken(token, 'portal', secret) as PortalTokenClaims;
  if (typeof claims.company !== 'string' || !claims.company) {
    throw new Error('Portal token missing company claim');
  }
  if (typeof claims.client_name !== 'string') {
    throw new Error('Portal token missing client_name claim');
  }
  if (typeof claims.agency_name !== 'string') {
    throw new Error('Portal token missing agency_name claim');
  }
  return claims;
}
