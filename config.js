// ════════════════════════════════════════════════════════════════
//  CONFIG.JS — Editá SOLO este archivo para adaptar a cada cliente
//  (index.html, style.css y script.js no los tocás nunca más)
// ════════════════════════════════════════════════════════════════

const SITE_CONFIG = {

  // ── MARCA ──────────────────────────────────────────────────────
  // Nombre que aparece en el nav, hero, footer y título del browser
  marcaPrincipal: "Nabila",      // Parte normal del nombre
  marcaItalica:   "Plata 925",   // Parte en cursiva y con color del acento

  // ── DESCRIPCIÓN CORTA ──────────────────────────────────────────
  rubro:     "Joyas de Plata 925", 
  ubicacion: "Córdoba",          // Ej: "Buenos Aires", "Palermo"

  // ── HERO ───────────────────────────────────────────────────────
  heroSubtitulo: "Joyas que reflejan tu esencia y te acompañan en cada momento.",

  // ── SECCIÓN NOSOTROS ───────────────────────────────────────────
  nosotros: {
    label:  "Nuestra esencia",
    titulo: "Cada detalle define tu estilo",
    slogan: "Tu brillo, tu esencia",
    parrafos: [
      "En <strong>Nabila Plata 925</strong> creemos que las joyas son mucho mas que un accesorio, son una forma de expresar quienes somos, celebrar momentos especiales y llevar con nosotros recuerdos que perduran para siempre.",
      "Ofrecemos joyas de plata de excelente calidad, diseños modernos que acompañan cada estilo y ocasión.",
      "Trabajamos con pasión para que cada cliente encuentre una joya especial, brindando una atención cercana y personalizada en cada compra."
    ],
    stats: [
      { num: "100%", label: "Estilo propio" },
      { num: "★",   label: "Tendencias exclusivas" }
    ]
  },

  // ── SECCIÓN PRODUCTOS ──────────────────────────────────────────
  productos: {
    label:  "Lo que ofrecemos",
    titulo: "Nuestros productos"
  },

  // ── CONTACTO ───────────────────────────────────────────────────
  whatsapp:  "543512553298",         // Sin +, sin espacios. Ej: "5491123456789"
  instagram: "nabilaplata925",  // Sin @

  contacto: {
  label:      "Hablemos",
  titulo:     "¿Buscás algo especial?",
  waDisplay:  "+54 351 2553298",           
  waTexto:    "Hola! Como estas? Me gustaria consultarte por tus productos!",
  waTextoProducto: "Hola! Como estas? Me gustaria consultarte por: *{nombre}*",
  ctaTitulo:  "Encontrá tu estilo ideal",
  ctaParrafo: "Te ayudamos a elegir la joya perfecta para expresar tu estilo o celebrar un momento especial. Consultanos por diseños disponibles, combinaciones y asesoramiento personalizado.",
  ctaBoton:   "Escribinos por WhatsApp"
},

  // ── FOOTER ─────────────────────────────────────────────────────
  footer: {
    copyright: "© 2026 Nabila Plata 925 · Tu brillo, tu esencia"
  },

  // ── ADMIN ──────────────────────────────────────────────────────
  admin: {
    nombrePanel: "Nabila Plata 925"   // Aparece en la barra de administrador
  },

  // ── TIPO DE PRODUCTO (para los textos del panel admin) ─────────
  tipoProducto:        "Joyas",               // Ej: "joya", "prenda", "producto"
  tipoProductoEjemplo: "Anillo", // Ej: "Anillo de plata", "Vestido talle M"

  paginacionBatch: 6, // productos por batch por carrusel

  // ── CATEGORÍAS PREDEFINIDAS (panel admin) ──────────────────────
  // Las que aparecen en el dropdown al cargar el panel por primera vez
  categoriasFijas: [],

  // ── FIREBASE ───────────────────────────────────────────────────
  // Creá un proyecto nuevo en https://console.firebase.google.com para cada cliente
  firebase: {
    apiKey: "AIzaSyDLT8sQzGlQV1K3Is-MZcPdwjHdC4Uw1Dk",
    authDomain: "nebila-plata.firebaseapp.com",
    projectId: "nebila-plata",
    storageBucket: "nebila-plata.firebasestorage.app",
    messagingSenderId: "413788775207",
    appId: "1:413788775207:web:52e36bd5176698745fff02"
  },

  // ── TIPOGRAFÍA (Google Fonts) ───────────────────────────────────
  // Usá exactamente el nombre como aparece en fonts.google.com
  // script.js carga todas las fuentes únicas automáticamente y aplica
  // las variables CSS --font-* en todo el sitio. Solo editá este bloque.
  tipografia: {
    // Cuerpo de texto (párrafos, botones, inputs, etiquetas, nav links)
    cuerpo:          "Inter",

    // Logo en el nav (marca del negocio)
    nav:             "Cormorant Garamond",

    // Título grande en el hero (nombre de la marca)
    tituloPagina:    "Pinyon Script",

    // Títulos de secciones (Nosotros, Contacto, etc.)
    tituloSeccion:   "Cormorant Garamond",

    // Nombre del producto en cards y modales
    tituloProducto:  "Cormorant Garamond",

    // Títulos en paneles y modales del admin
    tituloAdmin:     "Cormorant Garamond",
  },

  // ── LEGACY (no tocar — usados internamente por script.js) ──────
  // Se derivan automáticamente de tipografia arriba
  get fontSerif(){ return this.tipografia.tituloPagina },
  get fontSans() { return this.tipografia.cuerpo },

  // ── PALETA DE COLORES ──────────────────────────────────────────
  // Usá coolors.co o palettte.app para generar paletas para cada cliente
  colores: {
    fondo:     "#FCEAEF",  // rosa pastel muy suave
    principal: "#D15B76",  // rosa viejo / frambuesa elegante
    secciones: "#FFF5F7",  // fondo ultra claro rosado
    detalles:  "#ECA1B0",  // intermedio (bordes, líneas)
    cream:     "#FCF9FA",  // fondo general (blanco cálido rosado)
    text:      "#3B1C22",  // texto principal (marrón rojizo muy oscuro)
    textSoft:  "#7D5C63",  // texto secundario
    gold:      "#E4A853",  // acento (dorado suave para destacar botones/iconos)
    white:     "#ffffff"
  },

  // ── CATÁLOGO INICIAL / RESTAURACIÓN ────────────────────────────
  // Estos son los productos que se cargan si Firebase está vacío
  // o cuando el admin presiona "Restaurar originales"
  productosDefault: []
};
