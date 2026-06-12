import { Link } from 'react-router-dom';
import { PublicPortalFooter } from './PublicPortalFooter';
import './client-portal.css';
import './legal.css';

export default function LegalPrivacidad() {
  return (
    <div className="cp-root">
      <header className="cp-header">
        <div className="cp-header-brand">
          <span className="cp-brand">SharkTalents.AI</span>
          <span className="cp-brand-tag">Política de privacidad</span>
        </div>
      </header>

      <main className="legal-main">
        <h1>Política de privacidad</h1>
        <p className="legal-lead">
          En SharkTalents (operado por Kuno Digital) protegemos los datos personales que nos
          confías para gestionar procesos de selección. Este documento explica qué datos
          recogemos, cómo los usamos y los derechos que tenés sobre ellos.
        </p>

        <h2>1. Quiénes somos</h2>
        <p>
          SharkTalents es una plataforma de evaluación de talento operada por <strong>Kuno
          Digital</strong>, con domicilio en Panamá. Datos de contacto:
          <a href="mailto:proyectos@kunodigital.com"> proyectos@kunodigital.com</a>.
        </p>

        <h2>2. Datos que recogemos</h2>
        <ul>
          <li>
            <strong>De candidatos:</strong> nombre, email, teléfono, CV, respuestas a pruebas
            (DISC, técnica, integridad, video), resultados de evaluación.
          </li>
          <li>
            <strong>De clientes:</strong> nombre del responsable, email, empresa, descripción
            del puesto, decisiones tomadas en el portal.
          </li>
          <li>
            <strong>Técnicos:</strong> dirección IP, navegador, idioma, timestamps de eventos
            del portal. No usamos cookies de tracking de terceros.
          </li>
        </ul>

        <h2>3. Cómo los usamos</h2>
        <ul>
          <li>Para ejecutar el proceso de selección que el cliente nos contrata.</li>
          <li>Para generar reportes automatizados con IA (Anthropic Claude).</li>
          <li>Para comunicarnos con candidatos y clientes vía email o WhatsApp.</li>
          <li>Para mantener la seguridad, prevenir fraude y cumplir obligaciones legales.</li>
        </ul>

        <h2>4. Con quién compartimos</h2>
        <ul>
          <li><strong>Cliente que contrata la búsqueda</strong> — recibe el reporte de finalistas.</li>
          <li><strong>Proveedores tecnológicos</strong> — Zoho Catalyst (hosting), Anthropic (IA), Zoho Recruit (ATS), Twilio (WhatsApp), ZeptoMail (email).</li>
          <li><strong>Autoridades</strong> — solo cuando la ley lo exige.</li>
        </ul>
        <p>Ningún dato se vende ni se cede a terceros con fines de marketing.</p>

        <h2>5. Tus derechos</h2>
        <p>Podés solicitar en cualquier momento:</p>
        <ul>
          <li><strong>Acceso</strong> — qué datos tuyos tenemos.</li>
          <li><strong>Rectificación</strong> — corregir datos incorrectos.</li>
          <li><strong>Eliminación</strong> — borrar tus datos (excepto cuando la ley exige conservarlos).</li>
          <li><strong>Portabilidad</strong> — recibir tus datos en un formato leíble.</li>
          <li><strong>Oposición</strong> — pedir que no procesemos ciertos datos.</li>
        </ul>
        <p>
          Para ejercer cualquiera, escribinos a <a href="mailto:proyectos@kunodigital.com">proyectos@kunodigital.com</a>.
          Respondemos dentro de 30 días corridos.
        </p>

        <h2>6. Cuánto tiempo conservamos los datos</h2>
        <ul>
          <li><strong>Procesos activos:</strong> mientras dura la búsqueda.</li>
          <li><strong>Candidatos no contratados:</strong> 12 meses por defecto, para futuros matches. Podés pedir borrado antes.</li>
          <li><strong>Datos contables (clientes):</strong> 5 años, por exigencia fiscal.</li>
        </ul>

        <h2>7. Seguridad</h2>
        <p>
          Encriptamos en tránsito (TLS 1.3) y en reposo. Acceso al sistema con autenticación
          multifactor. Logs de auditoría de toda operación sensible. Si detectamos una brecha
          que pueda afectarte, te avisamos en menos de 72 horas.
        </p>

        <h2>8. Cambios a esta política</h2>
        <p>
          Si modificamos esta política, te avisamos por email antes de que entre en vigor. La
          versión actual es del {new Date().toLocaleDateString('es', { year: 'numeric', month: 'long', day: 'numeric' })}.
        </p>

        <p className="legal-back">
          <Link to="/">← Volver al inicio</Link>
        </p>
      </main>

      <PublicPortalFooter />
    </div>
  );
}
