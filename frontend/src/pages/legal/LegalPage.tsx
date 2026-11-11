import type { ComponentType, ReactNode } from 'react';
import LegalLinks from '../../components/legal/LegalLinks';
import { LegalDocument, LEGAL_DOCUMENTS, legalPath } from './legal-documents';

interface LegalPageProps {
  document: LegalDocument;
  onOpen: (document: LegalDocument) => void;
  onBack: () => void;
}

interface LegalBodyProps {
  onOpen: (document: LegalDocument) => void;
}

function LegalDocLink({
  document,
  onOpen,
  children
}: {
  document: LegalDocument;
  onOpen: (document: LegalDocument) => void;
  children: ReactNode;
}) {
  return (
    <a
      href={legalPath(document)}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        onOpen(document);
      }}
    >
      {children}
    </a>
  );
}

const UPDATED_AT = '11 de noviembre de 2026';
const HOLDER = 'Rafael Culebras Cabeza';
const NIF = '74664121A';
const ADDRESS = 'Los Barrios, España';
const EMAIL = 'rafael.culebras@vera-technology.com';

function AvisoLegal({ onOpen }: LegalBodyProps) {
  return (
    <>
      <h2>1. Datos identificativos del titular</h2>
      <p>
        En cumplimiento del artículo 10 de la Ley 34/2002, de 11 de julio, de servicios de la
        sociedad de la información y de comercio electrónico (LSSI-CE), se ponen a disposición de
        los usuarios los siguientes datos:
      </p>
      <ul>
        <li><strong>Titular:</strong> {HOLDER}</li>
        <li><strong>NIF:</strong> {NIF}</li>
        <li><strong>Domicilio:</strong> {ADDRESS}</li>
        <li><strong>Correo electrónico de contacto:</strong> <a href={`mailto:${EMAIL}`}>{EMAIL}</a></li>
        <li><strong>Nombre comercial:</strong> Vera Technology</li>
        <li><strong>Aplicación:</strong> Catálogo IA</li>
        <li>
          <strong>Actividad:</strong> prestación de servicios de software en línea para la gestión,
          importación, edición y enriquecimiento de catálogos de productos de comercios
          electrónicos.
        </li>
      </ul>

      <h2>2. Objeto</h2>
      <p>
        El presente aviso legal regula el acceso y uso de la aplicación Catálogo IA (en adelante,
        «la Aplicación»), incluidos sus contenidos, funcionalidades e integraciones. La Aplicación
        permite conectar tiendas PrestaShop y Shopify, importar y editar productos, buscar imágenes
        y generar textos o contenidos asistidos por inteligencia artificial.
      </p>
      <p>
        El acceso a la Aplicación implica la aceptación de este aviso legal. Si no estás de acuerdo
        con su contenido, debes abstenerte de utilizarla.
      </p>

      <h2>3. Condiciones de acceso y uso</h2>
      <p>
        La Aplicación es un servicio dirigido a comercios y profesionales. Para utilizarla es
        necesario disponer de una cuenta de usuario facilitada o autorizada por el titular.
      </p>
      <ul>
        <li>El usuario debe proporcionar información veraz y mantenerla actualizada.</li>
        <li>
          Las credenciales de acceso son personales e intransferibles. El usuario es responsable de
          su custodia y de toda actividad realizada con su cuenta.
        </li>
        <li>
          El usuario debe comunicar de inmediato cualquier uso no autorizado de su cuenta o
          cualquier incidente de seguridad.
        </li>
        <li>
          El usuario se compromete a utilizar la Aplicación conforme a la ley, a la buena fe y a
          este aviso legal, y a no realizar actividades que puedan dañar, sobrecargar, inutilizar o
          deteriorar el servicio o los derechos de terceros.
        </li>
        <li>
          Queda prohibido intentar acceder a áreas restringidas, eludir los mecanismos de
          autenticación, extraer datos de forma masiva no autorizada, introducir código malicioso o
          utilizar la Aplicación para fines ilícitos.
        </li>
      </ul>

      <h2>4. Propiedad intelectual e industrial</h2>
      <p>
        El código fuente, la estructura, el diseño, los textos, las marcas, los logotipos y los
        demás elementos de la Aplicación son titularidad de {HOLDER} o se utilizan con licencia. Su
        reproducción, distribución, comunicación pública, transformación o uso no autorizado están
        prohibidos.
      </p>
      <p>
        Los productos, imágenes, descripciones, marcas y demás contenidos que el usuario importe o
        cargue en la Aplicación siguen siendo de su titularidad o de los terceros que correspondan.
        El usuario declara que cuenta con los derechos y autorizaciones necesarios para tratarlos y
        concede al titular únicamente la licencia técnica necesaria para prestar el servicio.
      </p>

      <h2>5. Responsabilidad</h2>
      <p>
        El titular adopta medidas razonables para mantener la Aplicación disponible y segura, pero
        no garantiza la ausencia de interrupciones, errores, pérdidas de datos o incidencias
        derivadas de causas ajenas a su control, como fallos de conectividad, del alojamiento, de la
        tienda del usuario o de servicios de terceros.
      </p>
      <p>
        Los textos, descripciones, títulos, metadatos e imágenes sugeridos por inteligencia
        artificial son propuestas automatizadas que pueden contener errores o no ajustarse al
        producto. El usuario debe revisarlos antes de publicarlos y es responsable del contenido
        final que incorpore a su tienda.
      </p>
      <p>
        El titular no responde de las decisiones comerciales, de precios, de marketing o de otro
        tipo que el usuario adopte a partir de la información generada por la Aplicación, ni del
        contenido publicado en tiendas o canales de terceros.
      </p>

      <h2>6. Enlaces y servicios de terceros</h2>
      <p>
        La Aplicación puede integrarse con servicios de terceros, como PrestaShop, Shopify,
        proveedores de inteligencia artificial y proveedores de búsqueda de imágenes. El uso de
        esos servicios se rige por sus propios términos y políticas. El titular no controla ni
        asume responsabilidad sobre su disponibilidad, contenido o funcionamiento.
      </p>

      <h2>7. Protección de datos y cookies</h2>
      <p>
        El tratamiento de datos personales se describe en la{' '}
        <LegalDocLink document="privacidad" onOpen={onOpen}>Política de privacidad</LegalDocLink>. El
        uso de cookies y tecnologías similares se describe en la{' '}
        <LegalDocLink document="cookies" onOpen={onOpen}>Política de cookies</LegalDocLink>.
      </p>

      <h2>8. Modificaciones</h2>
      <p>
        El titular puede modificar este aviso legal para adaptarlo a cambios normativos, técnicos o
        de negocio. La versión vigente estará siempre publicada en esta página e indicará su fecha
        de actualización.
      </p>

      <h2>9. Legislación aplicable y jurisdicción</h2>
      <p>
        Este aviso legal se rige por la legislación española. Para cualquier controversia derivada
        del acceso o uso de la Aplicación, las partes se someten a los juzgados y tribunales de
        Cádiz, salvo que la normativa aplicable establezca otro fuero imperativo.
      </p>

      <h2>10. Contacto</h2>
      <p>
        Para cualquier consulta relacionada con este aviso legal puedes escribir a{' '}
        <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.
      </p>
    </>
  );
}

function PoliticaPrivacidad(_props: LegalBodyProps) {
  return (
    <>
      <h2>1. Responsable del tratamiento</h2>
      <ul>
        <li><strong>Responsable:</strong> {HOLDER}</li>
        <li><strong>NIF:</strong> {NIF}</li>
        <li><strong>Domicilio:</strong> {ADDRESS}</li>
        <li><strong>Correo electrónico:</strong> <a href={`mailto:${EMAIL}`}>{EMAIL}</a></li>
      </ul>
      <p>
        Esta política se aplica a los datos personales tratados a través de la aplicación Catálogo
        IA y de las comunicaciones relacionadas con el servicio.
      </p>

      <h2>2. Qué datos tratamos</h2>
      <ul>
        <li>
          <strong>Datos de cuenta:</strong> nombre de usuario, contraseña almacenada como hash,
          rol, nombre del comercio y estado de la cuenta.
        </li>
        <li>
          <strong>Datos de configuración e integración:</strong> URL de la tienda, credenciales o
          claves de API de PrestaShop y Shopify, y configuración de los proveedores de inteligencia
          artificial y de búsqueda de imágenes.
        </li>
        <li>
          <strong>Datos de productos:</strong> referencias, nombres, descripciones, precios,
          metadatos e imágenes que el usuario importa o introduce. Si el catálogo contiene datos
          personales, el usuario es responsable de que su tratamiento sea lícito.
        </li>
        <li>
          <strong>Datos técnicos y de seguridad:</strong> dirección IP, navegador y agente de
          usuario, fecha y hora, identificador de petición, registros de errores y registros de
          intentos de acceso.
        </li>
        <li>
          <strong>Datos de uso:</strong> acciones realizadas en la Aplicación, selección y edición
          de productos, ejecución de importaciones, exportaciones y búsquedas.
        </li>
      </ul>
      <p>
        No se solicitan categorías especiales de datos personales. El usuario no debe introducir
        datos de salud, ideología, religión, origen racial, orientación sexual ni otros datos
        sensibles en los campos de producto.
      </p>

      <h2>3. Finalidades y bases jurídicas</h2>
      <div className="legal-table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Finalidad</th>
              <th>Base jurídica</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Crear y gestionar la cuenta, autenticar al usuario y prestar el servicio contratado.</td>
              <td>Ejecución de un contrato o medidas precontractuales (art. 6.1.b RGPD).</td>
            </tr>
            <tr>
              <td>Ejecutar las acciones solicitadas: importar y exportar productos, buscar imágenes y generar contenidos con IA.</td>
              <td>Ejecución del contrato (art. 6.1.b RGPD).</td>
            </tr>
            <tr>
              <td>Mantener la seguridad, prevenir abusos, investigar incidentes y conservar registros técnicos.</td>
              <td>Interés legítimo en la seguridad del servicio (art. 6.1.f RGPD).</td>
            </tr>
            <tr>
              <td>Atender consultas, solicitudes de derechos y reclamaciones.</td>
              <td>Obligación legal e interés legítimo en atender al usuario (art. 6.1.c y 6.1.f RGPD).</td>
            </tr>
            <tr>
              <td>Cumplir obligaciones legales, contables, fiscales o de atención a autoridades.</td>
              <td>Obligación legal (art. 6.1.c RGPD).</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        No se envían comunicaciones comerciales sin consentimiento. Si en el futuro se ofrecen, se
        solicitará previamente y podrán cancelarse en cualquier momento.
      </p>

      <h2>4. Destinatarios y encargados del tratamiento</h2>
      <p>
        Los datos no se venden ni se ceden a terceros para fines publicitarios. Pueden acceder a
        ellos, en la medida necesaria para prestar el servicio:
      </p>
      <ul>
        <li>
          <strong>OVH:</strong> proveedor de alojamiento de la Aplicación.
        </li>
        <li>
          <strong>OpenAI:</strong> proveedor de inteligencia artificial que recibe los datos del
          producto y las instrucciones necesarias para generar textos, descripciones o metadatos.
          No recibe contraseñas ni datos de acceso.
        </li>
        <li>
          <strong>PrestaShop y Shopify:</strong> solo cuando el usuario configura la integración y
          solicita importar o exportar productos. Los datos se intercambian con la tienda del
          propio usuario.
        </li>
        <li>
          <strong>Proveedores de búsqueda de imágenes:</strong> reciben los términos de búsqueda,
          referencias, códigos EAN o datos del producto necesarios para localizar imágenes, según la
          configuración realizada por el administrador.
        </li>
        <li>
          <strong>Proveedores de servicios técnicos:</strong> herramientas de infraestructura,
          seguridad o soporte estrictamente necesarias, sujetas a obligaciones de confidencialidad.
        </li>
        <li>
          <strong>Usuarios autorizados del comercio y administradores del titular:</strong> pueden
          acceder a los datos de la cuenta y del catálogo según su rol.
        </li>
      </ul>

      <h2>5. Transferencias internacionales</h2>
      <p>
        Algunos proveedores, como OpenAI o determinados servicios de búsqueda de imágenes, pueden
        tratar datos fuera del Espacio Económico Europeo, principalmente en Estados Unidos. En esos
        casos, las transferencias se amparan en el Marco de Privacidad de Datos UE-EE. UU. cuando el
        proveedor está adherido, o en cláusulas contractuales tipo u otra garantía adecuada conforme
        al RGPD. Puedes solicitar más información sobre estas garantías en el correo de contacto.
      </p>

      <h2>6. Plazos de conservación</h2>
      <p>
        Los datos de cuenta y de configuración se conservan mientras la cuenta esté activa y,
        después, durante los plazos necesarios para atender responsabilidades legales o
        contractuales. Los registros técnicos y de seguridad se conservan durante el tiempo mínimo
        necesario para garantizar la seguridad y resolver incidentes. Cuando los datos dejan de ser
        necesarios, se eliminan o se anonimizan de forma segura. Las copias de seguridad, si
        existen, se eliminan conforme a sus ciclos de rotación.
      </p>

      <h2>7. Derechos de las personas</h2>
      <p>
        Puedes ejercer los derechos de acceso, rectificación, supresión, limitación del tratamiento,
        oposición y portabilidad, así como retirar el consentimiento cuando el tratamiento se base
        en él, escribiendo a <a href={`mailto:${EMAIL}`}>{EMAIL}</a> e indicando el derecho que
        deseas ejercer. Podemos pedirte información adicional para verificar tu identidad.
      </p>
      <p>
        Si consideras que el tratamiento no se ajusta a la normativa, puedes presentar una
        reclamación ante la Agencia Española de Protección de Datos (AEPD), en{' '}
        <a href="https://www.aepd.es" target="_blank" rel="noreferrer noopener">www.aepd.es</a>, sin
        perjuicio de acudir previamente al responsable.
      </p>

      <h2>8. Seguridad</h2>
      <p>
        Se aplican medidas técnicas y organizativas razonables para proteger los datos, como el uso
        de HTTPS, el almacenamiento de contraseñas mediante funciones de hash, cookies de sesión
        <em> HttpOnly</em> y <em>SameSite=Strict</em>, control de acceso por roles y registro de
        actividad. Ningún sistema es completamente infalible; si se produce un incidente relevante,
        se actuará conforme a la normativa aplicable.
      </p>

      <h2>9. Decisiones automatizadas</h2>
      <p>
        La Aplicación utiliza inteligencia artificial para proponer textos e imágenes, pero no
        adopta decisiones automatizadas que produzcan efectos jurídicos o afecten significativamente
        al usuario. Las propuestas generadas deben ser revisadas por una persona antes de su
        publicación.
      </p>

      <h2>10. Menores de edad</h2>
      <p>
        El servicio está dirigido a comercios y profesionales y no se ofrece a menores de 14 años.
        Si se detecta una cuenta creada por un menor sin la autorización correspondiente, se
        procederá a su cancelación.
      </p>

      <h2>11. Cambios en esta política</h2>
      <p>
        Esta política puede actualizarse para reflejar cambios normativos, técnicos o en los
        proveedores utilizados. La versión vigente se publica en esta página con su fecha de
        actualización.
      </p>

      <h2>12. Contacto</h2>
      <p>
        Para cualquier duda sobre privacidad puedes escribir a{' '}
        <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.
      </p>
    </>
  );
}

function PoliticaCookies(_props: LegalBodyProps) {
  return (
    <>
      <h2>1. Qué son las cookies y tecnologías similares</h2>
      <p>
        Las cookies son pequeños archivos que un sitio web guarda en el navegador para recordar
        información. Junto a ellas existen otras tecnologías de almacenamiento, como el
        almacenamiento local del navegador, con finalidades equivalentes.
      </p>

      <h2>2. Qué utilizamos y por qué no mostramos un banner de consentimiento</h2>
      <p>
        Catálogo IA solo utiliza cookies y almacenamiento estrictamente necesarios para prestar el
        servicio solicitado por el usuario: mantener la sesión iniciada y recordar la preferencia de
        idioma. Estas cookies técnicas están exentas del consentimiento previo, pero deben
        informarse, que es el objeto de esta página.
      </p>
      <p>
        No se utilizan cookies de analítica, publicidad, redes sociales, píxeles de seguimiento ni
        fuentes externas. Por ese motivo no se muestra un banner de aceptar o rechazar cookies. Si
        en el futuro se incorporan cookies no necesarias, se solicitará el consentimiento previo y
        se ofrecerá un panel de configuración.
      </p>

      <h2>3. Cookies propias</h2>
      <div className="legal-table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Finalidad</th>
              <th>Duración</th>
              <th>Tipo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>access_token</code></td>
              <td>
                Mantener la sesión autenticada. Es <code>HttpOnly</code>, <code>SameSite=Strict</code>{' '}
                y <code>Secure</code> en producción.
              </td>
              <td>1 hora</td>
              <td>Técnica necesaria</td>
            </tr>
            <tr>
              <td><code>refresh_token</code></td>
              <td>
                Renovar la sesión sin volver a introducir las credenciales. Está limitada a la ruta{' '}
                <code>/api/auth/refresh</code> y es <code>HttpOnly</code>, <code>SameSite=Strict</code>{' '}
                y <code>Secure</code> en producción.
              </td>
              <td>7 días</td>
              <td>Técnica necesaria</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>4. Almacenamiento local</h2>
      <div className="legal-table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Clave</th>
              <th>Finalidad</th>
              <th>Duración</th>
              <th>Tipo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>catalogai_lang</code></td>
              <td>Recordar el idioma de la interfaz elegido por el usuario (español o inglés).</td>
              <td>Hasta que se borra el almacenamiento del navegador</td>
              <td>Funcional</td>
            </tr>
            <tr>
              <td><code>auth_token</code></td>
              <td>
                Clave heredada de versiones anteriores. La versión actual no la crea y se elimina al
                cerrar sesión; si existe en tu navegador puedes borrarla sin afectar al servicio.
              </td>
              <td>Hasta que se borra</td>
              <td>Funcional (heredada)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>5. Cookies de terceros</h2>
      <p>
        Catálogo IA no instala cookies de terceros en el navegador. Las llamadas a OpenAI,
        PrestaShop, Shopify y a los proveedores de búsqueda de imágenes se realizan desde el
        servidor, no desde el navegador, por lo que no generan cookies ni almacenamiento local en el
        dispositivo del usuario.
      </p>

      <h2>6. Cómo gestionar o eliminar cookies</h2>
      <p>
        Puedes eliminar o bloquear las cookies y el almacenamiento local desde la configuración de
        tu navegador. Los menús concretos cambian según el navegador y su versión; normalmente se
        encuentran en las opciones de privacidad o de seguridad.
      </p>
      <ul>
        <li>Google Chrome: Configuración → Privacidad y seguridad → Cookies y otros datos de sitios.</li>
        <li>Mozilla Firefox: Ajustes → Privacidad y seguridad → Cookies y datos del sitio.</li>
        <li>Microsoft Edge: Configuración → Cookies y permisos del sitio.</li>
        <li>Safari: Preferencias → Privacidad → Gestionar datos de sitios web.</li>
      </ul>
      <p>
        Si bloqueas las cookies de sesión, no podrás iniciar sesión ni utilizar las funciones que
        requieren autenticación. Borrar el almacenamiento local solo restablece la preferencia de
        idioma.
      </p>

      <h2>7. Actualización</h2>
      <p>
        Esta política puede actualizarse si cambian las cookies o tecnologías utilizadas. La
        versión vigente se publica en esta página con su fecha de actualización.
      </p>

      <h2>8. Contacto</h2>
      <p>
        Para cualquier duda sobre esta política puedes escribir a{' '}
        <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.
      </p>
    </>
  );
}

const CONTENT: Record<LegalDocument, ComponentType<LegalBodyProps>> = {
  'aviso-legal': AvisoLegal,
  privacidad: PoliticaPrivacidad,
  cookies: PoliticaCookies
};

export default function LegalPage({ document: documentId, onOpen, onBack }: LegalPageProps) {
  const definition = LEGAL_DOCUMENTS.find((item) => item.id === documentId)!;
  const Content = CONTENT[documentId];

  return (
    <div className="legal-page">
      <header className="legal-header">
        <a
          className="legal-brand"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            onBack();
          }}
        >
          <img src="/VERA-LOGO-icon_only.png" alt="" aria-hidden="true" />
          <span>Catálogo IA</span>
        </a>
        <button type="button" className="btn" onClick={onBack}>
          Volver a la aplicación
        </button>
      </header>

      <main className="legal-main">
        <article className="legal-document">
          <p className="legal-eyebrow">Información legal</p>
          <h1>{definition.label}</h1>
          <p className="legal-updated">Última actualización: {UPDATED_AT}</p>
          <Content onOpen={onOpen} />
          <LegalLinks current={documentId} onOpen={onOpen} className="legal-document-links" />
        </article>
      </main>

      <footer className="legal-footer">
        © 2026 Vera Technology · {HOLDER} · NIF {NIF}
      </footer>
    </div>
  );
}
