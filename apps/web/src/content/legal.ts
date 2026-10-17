/**
 * What a client accepts on signing in (TASK-0064, ADR-0028).
 *
 * Two things, kept apart because data-protection law requires a consent to be distinguishable from
 * other matters: the terms of use, which include being an adult, and the consent to process images.
 * Both are accepted together with one button, but they are shown, versioned and recorded separately.
 *
 * DRAFT. Written by the studio's developer, not by a lawyer. It must be reviewed before the studio is
 * opened to clients; `LEGAL_DRAFT` shows that on the legal pages until then.
 */

/** Bump a version whenever its text changes: everyone signs in to accept it again. */
export const TERMS_VERSION = '2026-10-01';
// TASK-0068: Brave Search added as a processor, so the consent and privacy text is asked again.
// TASK-0097 (ADR-0032): sharing a design with a tattooer through a link.
// TASK-0131: who receives the client's IP (thumbnails, fonts), the search text, the consultation's
// life, cookies and automated decisions, checked against the code.
export const IMAGES_VERSION = '2026-10-16';

export const LEGAL_DRAFT = true;

/**
 * Who is responsible, as the owner gave it. Spanish law (LSSI art. 10) asks a service with economic
 * activity for the holder's name or company name, tax id (NIF), postal address and email, and for a
 * company its entry in the Registro Mercantil. Only the owner can give them (TASK-0131): they are
 * never filled in here by guesswork. Empty fields are left out of the text rather than shown as
 * gaps, and `legal.test.ts` refuses to drop `LEGAL_DRAFT` while the tax id or the address is empty.
 */
export const LEGAL_ENTITY = {
  /** The holder: the company name, or the self-employed person's full name. */
  name: 'Aurevanta Labs',
  taxId: '',
  address: '',
  /** For a company: «Registro Mercantil de …, tomo …, folio …, hoja …». Empty otherwise. */
  registry: '',
  email: 'info@aurevanta.es',
  country: 'España',
};

/** "Aurevanta Labs (NIF …, dirección …, registro …)", with only what is known. */
const EXTRA = [
  LEGAL_ENTITY.taxId && `NIF ${LEGAL_ENTITY.taxId}`,
  LEGAL_ENTITY.address,
  LEGAL_ENTITY.registry,
]
  .filter(Boolean)
  .join(', ');
const IDENTITY = EXTRA ? `${LEGAL_ENTITY.name} (${EXTRA})` : LEGAL_ENTITY.name;

/** The two parts of the sign-in dialog: short, with the full text one link away. */
export const SIGN_IN_TERMS = [
  'Soy mayor de 18 años.',
  'Acepto las condiciones de uso del estudio: los diseños y las vistas en piel son orientativos y un tatuador profesional debe revisarlos antes de tatuar.',
  'Usaré el estudio solo con ideas, imágenes y fotos que tenga derecho a usar, y no pediré imitar el estilo de un artista concreto.',
];

export const SIGN_IN_IMAGES = [
  'Autorizo que se procesen las imágenes que suba (referencias y, si la añado, una foto de mi propio cuerpo) y las fotos que guarde con la cámara, para crear mis diseños.',
  'Eso incluye una revisión automática de su contenido y su envío a los proveedores de inteligencia artificial que indica la política de privacidad.',
  'Las fotos de mi cuerpo se guardan cifradas, se borran a las 24 horas y nunca se envían al generador de imágenes.',
  'Puedo retirar este consentimiento en cualquier momento borrando mis datos con «Eliminar sesión y archivos».',
];

export interface LegalSection {
  title: string;
  paragraphs: string[];
}

export const TERMS: LegalSection[] = [
  {
    title: '1. Quién presta el servicio',
    paragraphs: [
      `Inkcraft es un estudio de diseño de tatuajes asistido por inteligencia artificial, ofrecido por ${IDENTITY}. Contacto: ${LEGAL_ENTITY.email}.`,
    ],
  },
  {
    title: '2. Acceso',
    paragraphs: [
      'Las cuentas las crea el estudio por invitación. Para usarlo debes ser mayor de 18 años. Tu cuenta es personal: no la compartas.',
      'Cada vez que entras aceptas estas condiciones y el tratamiento de imágenes en su versión vigente.',
    ],
  },
  {
    title: '3. Qué ofrece el estudio, y qué no',
    paragraphs: [
      'El estudio propone diseños, una plantilla (stencil) y una vista orientativa sobre piel. Las vistas en piel, el tamaño, el envejecimiento y la curación son ilustrativos: no predicen el resultado de un tatuaje real.',
      'Nada de lo que produce el estudio es consejo médico ni sustituye el criterio de un tatuador profesional, que debe revisar el diseño y la plantilla antes de usarlos.',
    ],
  },
  {
    title: '4. Uso aceptable',
    paragraphs: [
      'Solo puedes subir imágenes y fotos que tengas derecho a usar. No subas fotos de otras personas ni contenido ilegal, sexual explícito o que vulnere derechos de terceros.',
      'No pidas imitar el estilo de un artista vivo concreto ni copiar el tatuaje de otra persona.',
      'Podemos suspender una cuenta que incumpla estas reglas o haga un uso abusivo del servicio.',
    ],
  },
  {
    title: '5. Tus contenidos y tus diseños',
    paragraphs: [
      'Lo que subes sigue siendo tuyo. Nos autorizas a procesarlo solo para prestarte el servicio, como explica la política de privacidad.',
      'Puedes usar los diseños que generes para tu tatuaje. Al crearse con inteligencia artificial, no podemos garantizar que sean únicos ni que generen derechos de propiedad intelectual a tu favor.',
      'Las referencias que el estudio encuentra proceden de Wikimedia Commons y Openverse, con la licencia que se indica junto a cada una. Cuando falta la imagen de algo concreto, como un logo, el estudio puede buscarla en la web: esas imágenes tienen los derechos de su autor y se usan solo como referencia para tu diseño personal.',
    ],
  },
  {
    title: '6. Responsabilidad',
    paragraphs: [
      'El servicio se ofrece tal cual, en fase de demostración, y puede tener interrupciones o errores. En la medida en que la ley lo permita, no respondemos de las decisiones que tomes a partir de los diseños, ni del trabajo de quien te tatúe.',
      'Nada de lo anterior limita los derechos que la ley te reconoce como consumidor.',
    ],
  },
  {
    title: '7. Cambios y ley aplicable',
    paragraphs: [
      'Si estas condiciones cambian, cambiará su versión y te las mostraremos de nuevo al entrar.',
      `Se rigen por la ley de ${LEGAL_ENTITY.country}. Si eres consumidor, puedes acudir a los tribunales de tu domicilio.`,
    ],
  },
];

export const PRIVACY: LegalSection[] = [
  {
    title: '1. Responsable',
    paragraphs: [`${IDENTITY}. Contacto para privacidad: ${LEGAL_ENTITY.email}.`],
  },
  {
    title: '2. Qué datos tratamos',
    paragraphs: [
      'Tu correo y los datos de tu cuenta; los mensajes de la consulta; tus diseños y sus versiones; las imágenes que subes como referencia; si la añades, una foto de tu propio cuerpo; las fotos que guardas con la cámara; y un registro del uso del estudio (tiempos, consumo y errores).',
      'Las fotos de tu cuerpo nunca se incluyen en el registro de uso, y el administrador del estudio no puede verlas.',
    ],
  },
  {
    title: '3. Para qué y con qué base',
    paragraphs: [
      'Para prestarte el servicio que pides (ejecución del contrato): la consulta, la búsqueda de referencias y la generación de tus diseños.',
      'Para procesar tus imágenes y fotos, incluida la de tu cuerpo, con tu consentimiento, que das al entrar y puedes retirar.',
      'Para mantener el estudio seguro, medir su uso y mejorarlo (interés legítimo).',
      'Sin los datos de tu cuenta y sin tu consentimiento para tratar imágenes no podemos prestarte el servicio. No tomamos decisiones automatizadas que produzcan efectos jurídicos sobre ti.',
    ],
  },
  {
    title: '4. Con quién se comparten',
    paragraphs: [
      'Con los proveedores que hacen funcionar el estudio, como encargados del tratamiento: Supabase (cuentas), OpenAI (revisión de contenido, análisis de referencias y generación de imágenes), Anthropic (la consulta y la búsqueda de referencias), Black Forest Labs (generación de imágenes) y Brave Search (búsqueda de imágenes de referencia en la web; recibe el texto de la búsqueda).',
      'Para buscar referencias, el texto de la búsqueda también se envía a Wikimedia Commons y a Openverse. Las miniaturas de las referencias se muestran desde sus sitios de origen (Wikimedia, los sitios que enlaza Openverse y Brave), y las tipografías se cargan desde Google Fonts: esos sitios reciben tu dirección IP, como en cualquier visita web.',
      'Algunos de ellos pueden tratar datos fuera del Espacio Económico Europeo; en ese caso se hace con las garantías que exige el Reglamento General de Protección de Datos.',
      'Las fotos de tu cuerpo solo pasan por la revisión de contenido; nunca se envían al generador de imágenes.',
      'Si tú lo decides, puedes compartir un diseño con tu tatuador mediante un enlace: quien lo tenga verá ese diseño, su plantilla, sus medidas, tu idea y su descripción, pero nunca fotos de tu cuerpo ni tu cuenta. Puedes retirar el enlace cuando quieras.',
    ],
  },
  {
    title: '5. Cuánto tiempo',
    paragraphs: [
      'Las fotos de tu cuerpo, y lo que se compone sobre ellas, se borran a las 24 horas. Tus diseños se guardan hasta que los borres. El registro de uso se conserva hasta 365 días; al borrar tus datos deja de estar asociado a ti. Un enlace para tu tatuador deja de funcionar a los 30 días, cuando lo retiras o cuando borras tus datos.',
      'La consulta en curso se borra 24 horas después de tu último cambio; la idea y la descripción de cada diseño se guardan con él.',
    ],
  },
  {
    title: '6. Tus derechos',
    paragraphs: [
      'Puedes acceder a tus datos, rectificarlos, borrarlos, oponerte o limitar su tratamiento, pedir su portabilidad y retirar tu consentimiento escribiendo a la dirección de contacto. El botón «Eliminar sesión y archivos» borra al momento todo lo que has creado.',
      'Si crees que no hemos tratado bien tus datos, puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).',
    ],
  },
  {
    title: '7. Cookies',
    paragraphs: [
      'El estudio solo usa cookies técnicas, necesarias para que funcione: inkcraft_at (tu sesión, 1 hora), inkcraft_rt (para renovar la sesión, 30 días) e inkcraft_ok (que has aceptado las condiciones vigentes, 30 días). Se borran al cerrar la sesión. No usa cookies de análisis ni de publicidad.',
    ],
  },
];
