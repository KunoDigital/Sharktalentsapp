import { Link } from 'react-router-dom';
import { PublicPortalFooter } from './PublicPortalFooter';
import './client-portal.css';
import './legal.css';

export default function LegalTerminos() {
  return (
    <div className="cp-root">
      <header className="cp-header">
        <div className="cp-header-brand">
          <span className="cp-brand">SharkTalents.AI</span>
          <span className="cp-brand-tag">Términos de uso</span>
        </div>
      </header>

      <main className="legal-main">
        <h1>Términos de uso</h1>
        <p className="legal-lead">
          Al usar SharkTalents (web, portal del cliente, links del candidato) aceptas estos
          términos. Si no estás de acuerdo, no uses la plataforma.
        </p>

        <h2>1. Quién opera el servicio</h2>
        <p>
          SharkTalents.AI es una plataforma operada por <strong>Kuno Digital</strong>, con
          domicilio en Panamá. Contacto: <a href="mailto:proyectos@kunodigital.com">proyectos@kunodigital.com</a>.
        </p>

        <h2>2. Naturaleza del servicio</h2>
        <p>
          SharkTalents brinda evaluación de talento asistida por IA — pruebas (DISC, técnica,
          integridad, video), scoring automatizado, generación de reportes y comunicación con
          candidatos. No somos el empleador final: facilitamos la decisión, no la tomamos por el cliente.
        </p>

        <h2>3. Cuentas y portales</h2>
        <ul>
          <li>
            <strong>Cliente:</strong> recibe un link único al portal donde aprueba perfiles y
            revisa finalistas. El link es personal e intransferible.
          </li>
          <li>
            <strong>Candidato:</strong> recibe un link único para hacer las pruebas. No requiere
            registrarse con clave: el link mismo autentica.
          </li>
        </ul>
        <p>
          Cualquiera de los dos puede pedir invalidar su link en cualquier momento escribiendo
          a <a href="mailto:proyectos@kunodigital.com">proyectos@kunodigital.com</a>.
        </p>

        <h2>4. Uso aceptable</h2>
        <p>Te comprometés a NO:</p>
        <ul>
          <li>Compartir tu link de portal o de candidato con terceros.</li>
          <li>Intentar acceder a datos de otros usuarios.</li>
          <li>Hacer ingeniería inversa, scrapear o automatizar el uso de la plataforma sin autorización escrita.</li>
          <li>Subir contenido ilegal, ofensivo o que viole derechos de terceros.</li>
          <li>Suplantar la identidad de otra persona.</li>
        </ul>

        <h2>5. Propiedad intelectual</h2>
        <p>
          El software, marcas, pruebas, diseño y código de SharkTalents son propiedad de Kuno
          Digital. Los reportes generados son propiedad del cliente que contrató la búsqueda.
          Los datos personales del candidato siguen siendo del candidato.
        </p>

        <h2>6. Resultados de la IA</h2>
        <p>
          Los scores, narrativas y recomendaciones que genera la IA son orientativos. La
          decisión final de contratación es responsabilidad del cliente. SharkTalents no
          garantiza que un candidato seleccionado vaya a tener buen desempeño en el puesto.
        </p>

        <h2>7. Disponibilidad</h2>
        <p>
          Hacemos lo razonable para que el servicio esté disponible 24/7, pero puede haber
          ventanas de mantenimiento o caídas imprevistas. No garantizamos disponibilidad
          continua salvo acuerdo SLA específico con el cliente.
        </p>

        <h2>8. Limitación de responsabilidad</h2>
        <p>
          En la medida que la ley lo permita, Kuno Digital no responde por daños indirectos,
          lucro cesante, pérdida de oportunidades o decisiones tomadas en base a los reportes
          de la plataforma. La responsabilidad total queda limitada al monto pagado por el
          cliente en los últimos 12 meses.
        </p>

        <h2>9. Modificaciones</h2>
        <p>
          Podemos actualizar estos términos. Si el cambio es material, te avisamos por email
          con al menos 15 días de anticipación. El uso continuado después de la fecha de
          vigencia implica aceptación.
        </p>

        <h2>10. Ley aplicable</h2>
        <p>
          Estos términos se rigen por las leyes de la República de Panamá. Cualquier disputa
          se resolverá en tribunales de la Ciudad de Panamá, salvo acuerdo distinto firmado
          por escrito.
        </p>

        <p className="legal-back">
          <Link to="/">← Volver al inicio</Link>
        </p>
      </main>

      <PublicPortalFooter />
    </div>
  );
}
