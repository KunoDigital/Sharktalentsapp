import { ReactNode } from 'react';
import { useUser } from '@clerk/clerk-react';
import { Navigate } from 'react-router-dom';

/**
 * Guard basado en Clerk publicMetadata.role.
 *
 * Uso:
 *   <RequireRole role="freelance" fallback="/">
 *     <FreelanceLayout />
 *   </RequireRole>
 *
 * Rendering:
 *   - Usuario cargando → null (splash)
 *   - Usuario con rol correcto → children
 *   - Usuario con otro rol o sin rol → Navigate al fallback
 */
export default function RequireRole({
  role,
  fallback = '/',
  children,
}: {
  role: string;
  fallback?: string;
  children: ReactNode;
}) {
  const { user, isLoaded } = useUser();

  if (!isLoaded) return null;

  const userRole = user?.publicMetadata?.role as string | undefined;
  if (userRole !== role) {
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}

/**
 * Helper para leer el rol del usuario Clerk desde otros componentes.
 */
export function useUserRole(): string | null {
  const { user, isLoaded } = useUser();
  if (!isLoaded || !user) return null;
  return (user.publicMetadata?.role as string | undefined) ?? null;
}
