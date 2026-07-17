/**
 * Guard que muestra setup screen si el user no tiene una organización activa.
 *
 * SharkTalents es multi-tenant. La organización (Clerk org) determina el `tenant_id`
 * en el backend (mapeo via webhook Clerk → Tenants). Sin org activa, casi todos los
 * endpoints `/api/...` devuelven 403 — mejor parar acá y guiarlo a elegir/crear org.
 */
import { useOrganization, useUser, OrganizationSwitcher, CreateOrganization } from '@clerk/clerk-react';
import { useState } from 'react';

export default function RequireOrganization({ children }: { children: React.ReactNode }) {
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const { user, isLoaded: userLoaded } = useUser();
  const [showCreate, setShowCreate] = useState(false);

  // Mientras Clerk carga
  if (!orgLoaded || !userLoaded) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  // User signed in con org activa → render normal
  if (organization) {
    return <>{children}</>;
  }

  // User signed in pero SIN organización activa
  const orgsCount = user?.organizationMemberships?.length ?? 0;

  return (
    <div style={{
      minHeight: '60vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
    }}>
      <div style={{
        maxWidth: 540,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '12px',
        padding: '2rem',
      }}>
        <h1 style={{ marginTop: 0 }}>👋 Hola, {user?.firstName ?? user?.username ?? 'tu nombre'}</h1>
        <p style={{ color: 'var(--st-fg-muted)' }}>
          SharkTalents trabaja por organización (tenant). Necesitás seleccionar o crear una para
          empezar.
        </p>

        {orgsCount > 0 ? (
          <>
            <p style={{ marginTop: '1.5rem', marginBottom: '0.5rem', fontWeight: 500 }}>
              Tenés {orgsCount} {orgsCount === 1 ? 'organización' : 'organizaciones'} disponible:
            </p>
            <div style={{ marginBottom: '1.5rem' }}>
              <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/" />
            </div>
          </>
        ) : (
          <>
            <p style={{ marginTop: '1.5rem' }}>
              No tienes organizaciones todavía. Crea la primera para arrancar.
            </p>
          </>
        )}

        {!showCreate ? (
          <button
            className="btn-primary"
            onClick={() => setShowCreate(true)}
            style={{ marginTop: '0.75rem' }}
          >
            + Crear nueva organización
          </button>
        ) : (
          <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
            <CreateOrganization afterCreateOrganizationUrl="/" skipInvitationScreen={false} />
            <button
              className="cd-btn-ghost"
              onClick={() => setShowCreate(false)}
              style={{ marginTop: '0.5rem' }}
            >
              Cancelar
            </button>
          </div>
        )}

        <p className="muted small" style={{ marginTop: '1.5rem' }}>
          💡 La organización mapea a tu <code>tenant_id</code> en el backend. Cada organización
          tiene su data aislada (jobs, candidatos, reportes).
        </p>
      </div>
    </div>
  );
}
