// ════════════════════════════════════════════════════════
//  CONFIGURACIÓN FIREBASE — viene de config.js
// ════════════════════════════════════════════════════════
firebase.initializeApp(SITE_CONFIG.firebase);
const db = firebase.firestore();
// ── MODO BORRADOR (?admin2) ──────────────────────────────
// Con ?admin2 todo se lee y se guarda en la colección "borrador" (una copia
// de la página). Los visitantes siempre leen "catalogo". El botón
// "Publicar" copia el borrador a "catalogo".
const BORRADOR = new URLSearchParams(location.search).has('admin2');
// Cuentas que pueden usar el borrador y publicar. Se guarda el SHA-256 del
// mail (no el mail en sí) para que no quede visible en el código público.
const PUBLICADORES_HASH = [
  'f9665e98bce3b63e11f20877947d2c477c1e6e8d5d2eeefbbddfa5babda6d55a'
];
let ES_PUBLICADOR = null;   // se calcula al iniciar sesión
let resolverBorradorListo;
const BORRADOR_LISTO = new Promise(r => { resolverBorradorListo = r; });
// En el borrador, las cachés del navegador van con otro nombre para no
// mezclarse con las de la página publicada.
const LS = k => BORRADOR ? 'borrador_' + k : k;

function refsDe(raiz){
  const c = db.collection(raiz);
  return {
    prods:   c.doc('productos').collection('items'),
    meta:    c.doc('_meta'),
    indice:  c.doc('_indice'),
    config:  c.doc('siteConfig'),
    marquee: c.doc('marquee')
  };
}
const REFS_PUBLICO  = refsDe('catalogo');
const REFS_BORRADOR = refsDe('borrador');
const REFS = BORRADOR ? REFS_BORRADOR : REFS_PUBLICO;
const ESTADO_BORRADOR_REF = db.collection('borrador').doc('_estado');

// Cada producto es un documento en la subcolección "productos"
// La metadata (categorías, orden, etc.) va en un doc separado "_meta"
const PRODS_COL = REFS.prods;
const META_REF  = REFS.meta;
// UN solo documento con TODO el catálogo público (solo texto + URLs de Cloudinary).
// Los visitantes leen solo este doc → ~4 lecturas por visita en vez de 1 por producto.
const INDICE_REF = REFS.indice;
// {cloudName, preset} de Cloudinary — solo legible por admins (ver reglas de Firestore)
const CLOUDINARY_REF = db.collection('privado').doc('cloudinary');
const auth = firebase.auth();


//MANTENER SESIÓN
auth.onAuthStateChanged(user => {
  if(user && ADMIN_REQUEST){
    const yaEraAdmin = ADMIN_MODE;
    ADMIN_MODE = true;
    document.body.classList.add('admin');
    document.body.classList.add('admin-mode');
    document.getElementById('admin-bar').style.display = 'flex';
    posicionarNavYMarquee();
    // Sesión ya iniciada de antes → no hace falta volver a pedir el login
    const loginModal = document.getElementById('login-modal');
    if(loginModal) loginModal.classList.remove('active');
    if(BORRADOR){
      arrancarBorrador(user);
    } else {
      if(!yaEraAdmin) iniciarSincronizacionAdmin().catch(() => {});
      // En ?admin, a la cuenta que puede publicar se le muestra el acceso al borrador
      calcularEsPublicador(user).then(ok => {
        ES_PUBLICADOR = ok;
        const b = document.getElementById('btn-ir-borrador');
        if(b) b.style.display = ok ? '' : 'none';
      });
    }
  } else if(user && !ADMIN_REQUEST){
    // Sesión activa pero URL normal → cerrar sesión silenciosamente
    auth.signOut();
  }
});

// ════════════════════════════════════════════════════════
//  PRODUCTOS ORIGINALES — vienen de config.js
// ════════════════════════════════════════════════════════
const productosDefault = SITE_CONFIG.productosDefault;

// ════════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ════════════════════════════════════════════════════════
let productos = [];      // TODO el catálogo (viene de catalogo/_indice o de la colección)
let carrito = []; // Variable global para guardar el pedido (se persiste en localStorage)

// Se resuelve cuando termina la primera carga del catálogo (con o sin éxito)
let resolverCargaInicial;
const CARGA_INICIAL = new Promise(r => { resolverCargaInicial = r; });
let ADMIN_SYNC = null;   // promesa de la sincronización inicial del admin
let posCarrusel = {};       // { catId: posicion }
let carruselProds = {};     // { catId: [productos del carrusel] }

// ── OFERTAS ──────────────────────────────────────────────────────
// "Ofertas" se maneja como una categoría más (reutiliza todo el motor
// de carruseles/orden/visibilidad ya existente: si no tiene productos,
// simplemente no se construye su sección y queda invisible), pero se
// gestiona con su propio checkbox en el modal de producto en lugar de
// aparecer en la lista de categorías normales, y siempre se muestra
// primera si tiene al menos un producto.
const OFERTA_CAT = 'Ofertas';

// ── PAGINACIÓN por carrusel ────────────────────────────────────
// catKey = nombre de categoría (o 'todos')


let categoriasOcultas = []; // nombres de categorías ocultas
let categoriaOrden = [];    // orden personalizado de categorías
let ordenCategorias = {};
let productosOcultos = [];  // IDs de productos ocultos individualmente
let imagenesCategorias = {}; // { nombreCategoría: url de Cloudinary } para el carrusel de categorías

const params = new URLSearchParams(location.search);
const ADMIN_REQUEST = params.has('admin') || BORRADOR;
let ADMIN_MODE = false;

let marqueeConfig = {
  activo: false,
  velocidad: 30,       // segundos por vuelta
  altura: 38,           // px
  fondo: '#1a1a1a',
  banners: []           // [{id, texto, icono, color, tamano, separador, link, orden, visible, bold, italic, uppercase, badge, glow}]
};
let marqueeDragSrcIndex = null;



// ════════════════════════════════════════════════════════
//  APLICAR CONFIG — llena todos los textos y colores
//  desde config.js al cargar la página
// ════════════════════════════════════════════════════════
function applyConfig() {
  const C = SITE_CONFIG;

  // El <title> queda el de index.html (más completo para SEO); no se pisa acá.

  // Fuentes — lee tipografia de config.js, inyecta variables CSS y carga Google Fonts
  const T = C.tipografia || {};

  // Mapa de variable CSS → clave en tipografia
  const fontVars = {
    '--font-cuerpo':          T.cuerpo          || 'Jost',
    '--font-nav':             T.nav             || T.cuerpo || 'Jost',
    '--font-titulo-pagina':   T.tituloPagina    || 'Pinyon Script',
    '--font-titulo-seccion':  T.tituloSeccion   || T.tituloPagina || 'Pinyon Script',
    '--font-titulo-producto': T.tituloProducto  || T.tituloPagina || 'Pinyon Script',
    '--font-titulo-admin':    T.tituloAdmin     || T.tituloPagina || 'Pinyon Script',
  };

  // Inyectar variables en :root
  const root = document.documentElement;
  Object.entries(fontVars).forEach(([varName, fontName]) => {
    root.style.setProperty(varName, `'${fontName}'`);
  });

  // Actualizar Google Fonts con todas las fuentes únicas
  const gfonts = document.getElementById('gfonts');
  if (gfonts) {
    const uniqueFonts = [...new Set(Object.values(fontVars))];
    const families = uniqueFonts
      .map(f => `family=${f.replace(/ /g, '+')}:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400`)
      .join('&');
    const nuevaUrl = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    // Solo cambiar si difiere de la que ya trae index.html (evita doble descarga)
    if(gfonts.href !== nuevaUrl) gfonts.href = nuevaUrl;
  }

  document.body.style.fontFamily = `'${T.cuerpo || 'Jost'}', sans-serif`;

  // Colores CSS (sobreescribe el :root del CSS)
  applyColores(C.colores);

  // ── NAV ──────────────────────────────────────────────
  const navLogoContainer = document.getElementById('nav-logo');
  const navLogoSrc = C._navLogoImg || C.navLogoImgDefault || null;
  if (navLogoSrc) {
    navLogoContainer.innerHTML = `<img src="${esc(cldUrl(navLogoSrc, CLD_LOGO))}" class="nav-logo-img" alt="Logo"> ${C.marcaPrincipal} <span>${C.marcaItalica}</span>`;
  } else {
    navLogoContainer.innerHTML = `${C.marcaPrincipal} <span>${C.marcaItalica}</span>`;
  }
  // Añadir flex para alinear imagen y texto perfectamente
  navLogoContainer.style.display = 'flex';
  navLogoContainer.style.alignItems = 'center';
  navLogoContainer.style.gap = '10px';
  document.getElementById('nav-ig-link').href =
    `https://instagram.com/${C.instagram}`;
  document.getElementById('nav-wa-link').href =
    `https://wa.me/${C.whatsapp}?text=${encodeURIComponent(C.contacto.waTexto)}`;

  // ── HERO ─────────────────────────────────────────────
  document.getElementById('hero-eyebrow-1').textContent = `· ${C.rubro} ·`;
  document.getElementById('hero-eyebrow-2').textContent = C.ubicacion;

  // Título hero: imagen si existe, texto si no
  const heroTitleText = document.getElementById('hero-title');
  const heroTitleImgWrap = document.getElementById('hero-title-img-wrap');
  const heroTitleImg = document.getElementById('hero-title-img');
  // Firebase/caché primero; si no hay nada, usa el default hardcodeado de config.js
  const heroLogoSrc = C._heroLogoImg || C.heroLogoImgDefault || null;
  if(heroLogoSrc){
    heroTitleText.style.display = 'none';
    heroTitleImgWrap.style.display = 'block';
    const heroSrcFinal = cldUrl(heroLogoSrc, CLD_LOGO);
    // No reasignar si es la misma (evita recargar la imagen y cortar la animación)
    if(heroTitleImg.getAttribute('src') !== heroSrcFinal) heroTitleImg.src = heroSrcFinal;
  } else {
    heroTitleImgWrap.style.display = 'none';
    heroTitleText.style.display = '';
    heroTitleText.innerHTML = `${C.marcaPrincipal}<br><em>${C.marcaItalica}</em>`;
  }

  document.getElementById('hero-subtitle').innerHTML = C.heroSubtitulo;

  // ── NOSOTROS ─────────────────────────────────────────
  document.getElementById('nosotros-label').textContent = C.nosotros.label;
  document.getElementById('nosotros-titulo').textContent = C.nosotros.titulo;
  document.getElementById('nosotros-slogan').textContent = C.nosotros.slogan;
  // Imagen de Nosotros subida desde "Editar página" (antes no se aplicaba al recargar).
  // Si no hay ninguna (o se eligió "usar la original"), queda la de index.html.
  const nosImg = document.querySelector('.about-img-placeholder img');
  if(nosImg){
    if(!nosImg.dataset.srcOriginal) nosImg.dataset.srcOriginal = nosImg.getAttribute('src');
    const src = C._nosotrosImg ? cldUrl(C._nosotrosImg, CLD_LOGO) : nosImg.dataset.srcOriginal;
    if(nosImg.getAttribute('src') !== src) nosImg.src = src;
  }
  document.getElementById('nosotros-parrafos').innerHTML =
    C.nosotros.parrafos.map(p => `<p>${p}</p>`).join('');
  document.getElementById('nosotros-stats').innerHTML =
    C.nosotros.stats.map(s => `
      <div class="about-stat" style="display:inline-flex">
        <span class="stat-num">${esc(s.num)}</span>
        <span class="stat-label">${esc(s.label)}</span>
      </div>`).join('');

  // ── VIDEOS ───────────────────────────────────────────
  renderVideosInicio();

  // ── PRODUCTOS ────────────────────────────────────────
  document.getElementById('productos-label').textContent = C.productos.label;
  document.getElementById('productos-titulo').textContent = C.productos.titulo;

  // ── CONTACTO ─────────────────────────────────────────
  document.getElementById('contacto-label').textContent = C.contacto.label;
  document.getElementById('contacto-titulo').textContent = C.contacto.titulo;

  const waLink = document.getElementById('contacto-wa-link');
  waLink.href = `https://wa.me/${C.whatsapp}?text=${encodeURIComponent(C.contacto.waTexto)}`;
  waLink.textContent = C.contacto.waDisplay;

  const igLink = document.getElementById('contacto-ig-link');
  igLink.href = `https://instagram.com/${C.instagram}`;
  igLink.textContent = `@${C.instagram}`;

  document.getElementById('contacto-social-ig').href = `https://instagram.com/${C.instagram}`;
  document.getElementById('contacto-social-wa').href = `https://wa.me/${C.whatsapp}?text=${encodeURIComponent(C.contacto.waTexto)}`;

  document.getElementById('contacto-cta-titulo').textContent = C.contacto.ctaTitulo;
  document.getElementById('contacto-cta-p').textContent = C.contacto.ctaParrafo;

  const ctaBtn = document.getElementById('contacto-cta-btn');
  ctaBtn.href = `https://wa.me/${C.whatsapp}?text=${encodeURIComponent(C.contacto.waTexto)}`;
  document.getElementById('contacto-cta-btn-texto').textContent = C.contacto.ctaBoton;

  // ── FOOTER ───────────────────────────────────────────
  document.getElementById('footer-logo').innerHTML =
    `${C.marcaPrincipal} <span>${C.marcaItalica}</span>`;
  document.getElementById('footer-tagline').textContent =
    `${C.rubro} · ${C.ubicacion}`;
  document.getElementById('footer-ig-link').href =
    `https://instagram.com/${C.instagram}`;
  document.getElementById('footer-wa-link').href =
    `https://wa.me/${C.whatsapp}?text=${encodeURIComponent(C.contacto.waTexto)}`;
  document.getElementById('footer-copy').textContent = C.footer.copyright;

  // ── ADMIN BAR ────────────────────────────────────────
  document.getElementById('admin-badge-nombre').textContent = C.admin.nombrePanel;
  document.getElementById('login-modal-logo').innerHTML = `${C.marcaPrincipal} <span>${C.marcaItalica}</span>`;

  // ── ADMIN MODAL ──────────────────────────────────────
  document.getElementById('admin-modal-subtitle').textContent =
    `Completá los datos del Producto`;
  document.getElementById('a-nombre').placeholder =
    `Ej: ${C.tipoProductoEjemplo}`;
}

// ════════════════════════════════════════════════════════
//  APLICAR COLORES — sobreescribe variables CSS del :root
// ════════════════════════════════════════════════════════
function applyColores(c) {
  const r = document.documentElement.style;
  r.setProperty('--fondo',      c.fondo);
  r.setProperty('--principal', c.principal);
  r.setProperty('--secciones', c.secciones);
  r.setProperty('--detalles',  c.detalles);
  r.setProperty('--cream',     c.cream);
  r.setProperty('--text',      c.text);
  r.setProperty('--text-soft', c.textSoft);
  r.setProperty('--gold',      c.gold);
  r.setProperty('--white',     c.white);
}

// ════════════════════════════════════════════════════════
//  FIREBASE: cargar y guardar
// ════════════════════════════════════════════════════════
// Visitantes: leen _meta + _indice (UN doc con todo el catálogo).
// Si _indice todavía no existe (primera vez, o tras una restauración vieja),
// se lee la colección completa como respaldo.
async function cargarDesdeFirebase(){
  const [metaRes, indiceRes] = await Promise.allSettled([
    META_REF.get({ source: 'server' }),
    INDICE_REF.get({ source: 'server' })
  ]);

  if(metaRes.status === 'fulfilled'){
    const metaSnap = metaRes.value;
    if(metaSnap.exists){
      const m = metaSnap.data();

      // ── Invalidación de caché por timestamp ──────────────────
      const serverTs = m.lastModified || 0;
      const localTs  = Number(localStorage.getItem(LS('cache_ts')) || '0');
      if(serverTs > localTs){
        try {
          localStorage.removeItem(LS('meta_cache'));
          localStorage.removeItem(LS('config_cache'));
        } catch(e) {}
      }

      categoriasOcultas = Array.isArray(m.categoriasOcultas) ? m.categoriasOcultas : [];
      categoriaOrden    = Array.isArray(m.categoriaOrden)    ? m.categoriaOrden    : [];
      ordenCategorias   = m.ordenCategorias || {};
      productosOcultos  = Array.isArray(m.productosOcultos)  ? m.productosOcultos  : [];
      imagenesCategorias = (m.imagenesCategorias && typeof m.imagenesCategorias === 'object') ? m.imagenesCategorias : {};
    }
  } else {
    console.warn('No se pudo cargar metadata:', metaRes.reason);
  }

  if(indiceRes.status === 'fulfilled' && indiceRes.value.exists){
    const data = indiceRes.value.data();
    if(Array.isArray(data.productos)) return data.productos.map(p => ({ ...p }));
  }
  return leerColeccionCompleta();
}

async function leerColeccionCompleta(){
  const snap = await PRODS_COL.get({ source: 'server' });
  return snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
}

// Forma normalizada de un producto. Se usa tanto para el doc del item
// como para la entrada en catalogo/_indice.
function productoParaIndice(p){
  const imgs = Array.isArray(p.imgs) && p.imgs.length ? p.imgs : (p.img ? [p.img] : []);
  const tipos = Array.isArray(p.tipos) ? p.tipos : (p.tipo ? [p.tipo] : []);
  const out = {
    id:     p.id,
    nombre: p.nombre || '',
    precio: p.precio || '',
    tipo:   p.tipo || tipos[0] || '',
    tipos,
    desc:   p.desc || '',
    img:    imgs[0] || '',   // portada = imgs[0] (antes se guardaba duplicada)
    imgs,
    enOferta: !!p.enOferta
  };
  if(p.enOferta && p.precioOferta){
    out.precioOferta   = p.precioOferta;
    out.precioOriginal = p.precioOriginal || p.precio || '';
  }
  return out;
}

const INDICE_MAX_BYTES = 900000; // margen bajo el límite de 1 MiB por documento

// Devuelve el contenido del doc _indice, o null si no entra (ej: quedan fotos base64)
function construirIndice(ts){
  const data = { productos: productos.map(productoParaIndice), lastModified: ts };
  return new Blob([JSON.stringify(data)]).size <= INDICE_MAX_BYTES ? data : null;
}

// Aplica cambios de productos + regenera _indice + actualiza _meta.
// ops: [{tipo:'set'|'delete', ref, data}] — se parte en lotes de 400 (límite 500/batch).
async function commitCambios(ops = []){
  const ts = Date.now();
  const LOTE = 400;
  const aplicar = (b, op) => op.tipo === 'delete' ? b.delete(op.ref) : b.set(op.ref, op.data);
  const lotes = [];
  for(let i = 0; i < ops.length; i += LOTE) lotes.push(ops.slice(i, i + LOTE));
  const resto = lotes.pop() || [];
  for(const lote of lotes){
    const b = db.batch();
    lote.forEach(op => aplicar(b, op));
    await b.commit();
  }

  const batch = db.batch();
  resto.forEach(op => aplicar(batch, op));
  const indice = construirIndice(ts);
  if(indice) batch.set(INDICE_REF, indice);
  else batch.delete(INDICE_REF);
  const FV = firebase.firestore.FieldValue;
  batch.set(META_REF, {
    lastModified: ts,
    categorias: getCategorias(),
    // Campos del buscador viejo (v4.x) que ya no se usan: se limpian para que _meta sea liviano
    indice: FV.delete(),
    indiceVersion: FV.delete()
  }, { merge: true });
  await batch.commit();
  try { localStorage.setItem(LS('cache_ts'), String(ts)); } catch(e) {}
  if(!indice){
    mostrarToastError('⚠ El catálogo todavía tiene fotos guardadas dentro de la base (formato viejo).<br>Andá a ⚙ Herramientas → "Migrar fotos a Cloudinary".', 12000);
  }
}

// Guarda SOLO la metadata (categorías, orden, visibilidad)
async function guardarMetaEnFirebase(){
  const ts = Date.now();
  await META_REF.set({
    categoriasOcultas,
    categoriaOrden,
    ordenCategorias,
    productosOcultos,
    // Solo las imágenes de categorías que siguen existiendo
    imagenesCategorias: Object.fromEntries(Object.entries(imagenesCategorias).filter(([c]) => getCategorias().includes(c))),
    categorias: getCategorias(),
    lastModified: ts
  }, { merge: true });
  try {
    localStorage.setItem(LS('meta_cache'), JSON.stringify({
      categoriasOcultas, categoriaOrden, ordenCategorias, productosOcultos, imagenesCategorias
    }));
    localStorage.setItem(LS('cache_ts'), String(ts));
  } catch(e) {}
}

// Guarda/actualiza UN producto (doc del item + _indice + _meta, atómico)
async function guardarProductoEnFirebase(prod){
  if(!prod.id) prod.id = PRODS_COL.doc().id;
  const ref = PRODS_COL.doc(prod.id);
  await commitCambios([{ tipo: 'set', ref, data: productoParaIndice(prod) }]);
  return prod;
}

// Elimina UN producto de Firestore
async function eliminarProductoEnFirebase(prodId){
  await commitCambios([{ tipo: 'delete', ref: PRODS_COL.doc(prodId) }]);
}

// ── SINCRONIZACIÓN ADMIN ─────────────────────────────────
// Al entrar como admin se relee la colección completa (fuente de verdad) y se
// regenera _indice. Repara el índice después de una restauración desde backup
// o de ediciones hechas a mano en la consola de Firebase.
function iniciarSincronizacionAdmin(){
  if(ADMIN_SYNC) return ADMIN_SYNC;
  ADMIN_SYNC = (async () => {
    await CARGA_INICIAL;
    productos = await leerColeccionCompleta();
    buildAllCarousels();
    await commitCambios([]);
    const pendientes = contarFotosBase64() + fotosBase64DePagina().length;
    if(pendientes > 0){
      mostrarToastError(`⚠ Hay ${pendientes} foto${pendientes !== 1 ? 's' : ''} en formato viejo.<br>Andá a ⚙ Herramientas → "Migrar fotos a Cloudinary".`, 10000);
    }
  })().catch(err => {
    ADMIN_SYNC = null;
    console.error('Error sincronizando admin:', err);
    mostrarToastError('⚠ No se pudo sincronizar el catálogo. Revisá la conexión y recargá la página.', 8000);
    throw err;
  });
  return ADMIN_SYNC;
}

async function esperarAdminListo(){
  if(!ADMIN_SYNC) iniciarSincronizacionAdmin();
  await ADMIN_SYNC;
}

function esBase64(src){ return typeof src === 'string' && src.startsWith('data:'); }

function contarFotosBase64(){
  let n = 0;
  productos.forEach(p => {
    const lista = Array.isArray(p.imgs) && p.imgs.length ? p.imgs : [p.img];
    n += lista.filter(esBase64).length;
  });
  return n;
}

// ════════════════════════════════════════════════════════
//  CLOUDINARY — las fotos se suben ahí; en Firestore solo
//  se guarda el link. cloudName/preset se cargan desde la
//  página (admin) y viven en privado/cloudinary.
// ════════════════════════════════════════════════════════
let cldConfig = null;

async function obtenerCloudinary(){
  if(cldConfig) return cldConfig;
  const snap = await CLOUDINARY_REF.get({ source: 'server' });
  const d = snap.exists ? snap.data() : null;
  if(d && d.cloudName && d.preset){
    cldConfig = { cloudName: d.cloudName, preset: d.preset };
    return cldConfig;
  }
  return configurarCloudinary();
}

async function configurarCloudinary(){
  const actual = cldConfig || {};
  const cloudName = (prompt('Cloudinary — "Cloud name" (lo ves en el Dashboard de Cloudinary):', actual.cloudName || '') || '').trim();
  if(!cloudName) throw new Error('Falta configurar Cloudinary (cloud name).');
  const preset = (prompt('Cloudinary — nombre del "Upload preset" (modo Unsigned):', actual.preset || '') || '').trim();
  if(!preset) throw new Error('Falta configurar Cloudinary (upload preset).');
  await CLOUDINARY_REF.set({ cloudName, preset });
  cldConfig = { cloudName, preset };
  return cldConfig;
}

// ── LÍMITES DEL PLAN DE CLOUDINARY ─────────────────────────────
// Plan actual: imagen máx 10 MB / 25 MP · video máx 100 MB.
// Se deja un margen de seguridad para no rozar nunca el límite.
const LIMITES = {
  FOTOS_POR_PRODUCTO: 3,
  VIDEOS_INICIO:      3,
  VIDEOS_AUTO:        1,   // máx de videos que se reproducen solos (cuota del plan gratis)
  IMAGENES_DECO:      5,   // máx de imágenes decorativas en la página principal
  IMG_MAX_BYTES:      9 * 1000 * 1000,     // 9 MB  (límite real: 10 MB)
  IMG_MAX_MP:         24,                  // 24 MP (límite real: 25 MP)
  // 40 MB (límite real de subida: 100 MB). Se deja en 40 para que Cloudinary
  // pueda generar al instante la versión liviana del video que ven los visitantes.
  VIDEO_MAX_BYTES:    40 * 1000 * 1000,
  VIDEO_AVISO_BYTES:  20 * 1000 * 1000     // por encima de esto se sugiere comprimir
};
const FORMATOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/avif'];
const FORMATOS_VIDEO  = ['video/mp4', 'video/webm', 'video/quicktime'];

function formatoMB(bytes){ return (bytes / 1000 / 1000).toFixed(1).replace('.', ',') + ' MB'; }

// Tamaño en bytes de un File/Blob o de un dataURL base64
function tamanoArchivo(archivo){
  if(archivo && typeof archivo.size === 'number') return archivo.size;
  if(typeof archivo === 'string' && archivo.startsWith('data:')){
    const coma = archivo.indexOf(',');
    const b64 = archivo.slice(coma + 1);
    const relleno = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.floor(b64.length * 3 / 4) - relleno;
  }
  return 0;
}

// Devuelve un mensaje de error si el archivo elegido NO es una foto válida
function validarArchivoFoto(file){
  if(!file) return 'No se seleccionó ningún archivo.';
  if(file.type && file.type.startsWith('video/')) return `"${file.name}" es un video. En los productos solo se pueden subir fotos.`;
  if(!FORMATOS_IMAGEN.includes(file.type)) return `"${file.name}" no es un formato de foto compatible (usá JPG, PNG o WEBP).`;
  return null;
}

// Devuelve un mensaje de error si el archivo NO es un video válido o supera el límite
function validarArchivoVideo(file){
  if(!file) return 'No se seleccionó ningún archivo.';
  if(!file.type.startsWith('video/') || !FORMATOS_VIDEO.includes(file.type)){
    return `"${file.name}" no es un video compatible (usá MP4, WEBM o MOV).`;
  }
  if(file.size > LIMITES.VIDEO_MAX_BYTES){
    return `"${file.name}" pesa ${formatoMB(file.size)} y el máximo permitido es ${formatoMB(LIMITES.VIDEO_MAX_BYTES)}.\nComprimilo (por ejemplo con HandBrake o un compresor online) y volvé a intentar.`;
  }
  return null;
}

// archivo: File, Blob o dataURL base64 (Cloudinary acepta los tres como "file")
async function subirImagenCloudinary(archivo){
  // Control final antes de subir: nunca mandar algo que supere el plan
  const bytes = tamanoArchivo(archivo);
  if(bytes > LIMITES.IMG_MAX_BYTES){
    throw new Error(`La imagen pesa ${formatoMB(bytes)} y el máximo es ${formatoMB(LIMITES.IMG_MAX_BYTES)}.`);
  }
  if(typeof archivo === 'string' && archivo.startsWith('data:') && !archivo.startsWith('data:image/')){
    throw new Error('Solo se pueden subir imágenes.');
  }
  const { cloudName, preset } = await obtenerCloudinary();
  const fd = new FormData();
  fd.append('file', archivo);
  fd.append('upload_preset', preset);
  const r = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
    method: 'POST',
    body: fd
  });
  const data = await r.json().catch(() => ({}));
  if(!r.ok || !data.secure_url){
    throw new Error('Cloudinary: ' + ((data.error && data.error.message) || ('HTTP ' + r.status)));
  }
  return data.secure_url;
}

// Sube un video (File) a Cloudinary con barra de progreso.
// onProgreso(porcentaje 0-100)
async function subirVideoCloudinary(file, onProgreso){
  const err = validarArchivoVideo(file);
  if(err) throw new Error(err);
  const { cloudName, preset } = await obtenerCloudinary();
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', preset);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/video/upload`);
    xhr.upload.onprogress = ev => {
      if(ev.lengthComputable && onProgreso) onProgreso(Math.round(ev.loaded * 100 / ev.total));
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch(e) {}
      if(xhr.status >= 200 && xhr.status < 300 && data.secure_url) resolve(data.secure_url);
      else reject(new Error('Cloudinary: ' + ((data.error && data.error.message) || ('HTTP ' + xhr.status))));
    };
    xhr.onerror = () => reject(new Error('No se pudo subir el video (revisá la conexión).'));
    xhr.send(fd);
  });
}

// Sube SOLO las fotos base64 de la lista; las que ya son URL se conservan.
async function subirFotosPendientes(lista, onProgreso){
  const pendientes = lista.filter(esBase64).length;
  let hechas = 0;
  const out = [];
  for(const src of lista){
    if(esBase64(src)){
      if(onProgreso) onProgreso(hechas + 1, pendientes);
      out.push(await subirImagenCloudinary(src));
      hechas++;
    } else {
      out.push(src);
    }
  }
  return out;
}

// Inserta transformaciones de Cloudinary (tamaño/formato automático).
// Con base64 u otras URLs devuelve el src sin tocar (compatibilidad).
function cldUrl(src, transf){
  if(typeof src !== 'string' || !src.includes('res.cloudinary.com') || !src.includes('/upload/')) return src;
  return src.replace('/upload/', `/upload/${transf}/`);
}
const CLD_CARD  = 'f_auto,q_auto:eco,c_limit,w_600';
// En celulares alcanza con 1000 px; en compu se usa 1400 px
const CLD_MODAL = (window.innerWidth || 1000) <= 760 ? 'f_auto,q_auto,c_limit,w_1000' : 'f_auto,q_auto,c_limit,w_1400';
const CLD_THUMB = 'f_auto,q_auto,c_fill,w_160,h_160';
const CLD_LOGO  = 'f_auto,q_auto,c_limit,w_800';

// Escapa texto para insertarlo en HTML
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function desEscapar(s){
  const t = document.createElement('textarea');
  t.innerHTML = s || '';
  return t.value;
}

// ════════════════════════════════════════════════════════
//  LOGIN — credenciales vienen de config.js
// ════════════════════════════════════════════════════════
function pedirLoginAdmin(){
  document.getElementById('login-modal').classList.add('active');
  setTimeout(() => document.getElementById('login-email').focus(), 150);
  ['login-email','login-password'].forEach(id => {
    document.getElementById(id).onkeydown = e => { if(e.key === 'Enter') submitLogin(); };
  });
}

function mostrarAyudaContrasena(e){
  e.preventDefault();
  alert('Para restablecer tu contraseña, contactate con el servicio técnico de LUCANSOFT.');
}

function cancelarLogin(){
  document.getElementById('login-modal').classList.remove('active');
  document.getElementById('login-error').textContent = '';
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
}

async function submitLogin(){
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn      = document.getElementById('login-btn');
  const errorEl  = document.getElementById('login-error');

  if(!email || !password){ errorEl.textContent = 'Completá email y contraseña.'; return; }

  btn.textContent = 'Ingresando…';
  btn.disabled    = true;
  errorEl.textContent = '';

  try {
    await auth.signInWithEmailAndPassword(email, password);
    document.getElementById('login-modal').classList.remove('active');
    ADMIN_MODE = true;
    document.body.classList.add('admin');
    document.body.classList.add('admin-mode');
    document.getElementById('admin-bar').style.display = 'flex';
    posicionarNavYMarquee();
    buildAllCarousels(); // reconstruir cards con botones de admin
    if(BORRADOR) arrancarBorrador(auth.currentUser);
    else iniciarSincronizacionAdmin().catch(() => {});
  } catch {
    errorEl.textContent = 'Credenciales incorrectas. Intentá de nuevo.';
    btn.textContent = 'Ingresar';
    btn.disabled    = false;
  }
}

function logoutAdmin(){
  auth.signOut().then(() => {
    location.reload();
  });
}

// ════════════════════════════════════════════════════════
//  INICIALIZAR
// ════════════════════════════════════════════════════════
async function inicializar(){
  if(ADMIN_MODE){
    document.body.classList.add('admin-mode');
    document.getElementById('admin-bar').style.display = 'flex';
  }
  // Primera medición: ya sabemos si hay admin-bar visible o no.
  // El marquee todavía puede no estar renderizado (llega de Firestore),
  // renderMarqueePublico() vuelve a llamar a esta función cuando esté listo.
  posicionarNavYMarquee();

  // Cargar metadata cacheada ANTES de buildAllCarousels — orden de categorías correcto
  try {
    const metaCache = localStorage.getItem(LS('meta_cache'));
    if (metaCache) {
      const m = JSON.parse(metaCache);
      categoriasOcultas = Array.isArray(m.categoriasOcultas) ? m.categoriasOcultas : [];
      categoriaOrden    = Array.isArray(m.categoriaOrden)    ? m.categoriaOrden    : [];
      ordenCategorias   = m.ordenCategorias || {};
      productosOcultos  = Array.isArray(m.productosOcultos)  ? m.productosOcultos  : [];
      imagenesCategorias = (m.imagenesCategorias && typeof m.imagenesCategorias === 'object') ? m.imagenesCategorias : {};
    }
  } catch(e) {}

  // Productos: siempre desde Firestore (sin caché) para garantizar datos actualizados
  // en cualquier dispositivo sin necesidad de borrar datos del navegador.
  try {
    productos = await cargarDesdeFirebase();
    productos.forEach((p, i) => {
      if(!p.id){
        p.id = 'prod_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2,8);
      }
    });
    // Guardar metadata en caché (no los productos) para el orden de categorías
    try {
      localStorage.setItem(LS('meta_cache'), JSON.stringify({
        categoriasOcultas, categoriaOrden, ordenCategorias, productosOcultos, imagenesCategorias
      }));
    } catch(e) {}

  } catch(err){
    console.warn('Primer intento fallido, reintentando...', err);
    try {
      await new Promise(r => setTimeout(r, 1200));
      productos = await cargarDesdeFirebase();
      try {
        localStorage.setItem(LS('meta_cache'), JSON.stringify({
          categoriasOcultas, categoriaOrden, ordenCategorias, productosOcultos, imagenesCategorias
        }));
      } catch(e) {}
    } catch(err2){
      console.error('Error cargando Firebase:', err2);
      productos = productosDefault.map(p => ({...p}));
      if(!productos.length){
        mostrarErrorCarga();
        resolverCargaInicial();
        return;
      }
    }
  }

  const loadingEl = document.getElementById('carrusel-loading');
  if (loadingEl) loadingEl.style.display = 'none';
  buildAllCarousels();
  sincronizarCarritoConCatalogo();
  resolverCargaInicial();
}

// Si Firestore no respondió (sin conexión, cuota agotada, etc.), avisar en vez
// de dejar la sección de productos vacía.
function mostrarErrorCarga(){
  const container = document.getElementById('carrousels-container');
  if(!container) return;
  container.innerHTML = `
    <div class="carga-error">
      <p>No pudimos cargar los productos en este momento.</p>
      <button class="btn-primary" onclick="location.reload()">Reintentar</button>
    </div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  // Aplicar config desde caché inmediatamente si existe
  try {
    const configCache = localStorage.getItem(LS('config_cache'));
    if (configCache) {
      const data = JSON.parse(configCache);
      if(data.rubro)         SITE_CONFIG.rubro         = data.rubro;
      if(data.ubicacion)     SITE_CONFIG.ubicacion      = data.ubicacion;
      if(data.heroSubtitulo) SITE_CONFIG.heroSubtitulo  = data.heroSubtitulo;
      if(data.nosotros)      SITE_CONFIG.nosotros        = { ...SITE_CONFIG.nosotros, ...data.nosotros };
      if(data.whatsapp)      SITE_CONFIG.whatsapp        = data.whatsapp;
      if(data.instagram)     SITE_CONFIG.instagram       = data.instagram;
      if(data.contacto)      SITE_CONFIG.contacto        = { ...SITE_CONFIG.contacto, ...data.contacto };
      if(data.nosotrosImg)   SITE_CONFIG._nosotrosImg    = data.nosotrosImg;
      if(data.heroLogoImg)   SITE_CONFIG._heroLogoImg    = data.heroLogoImg;
      if(data.navLogoImg)    SITE_CONFIG._navLogoImg     = data.navLogoImg;
      if(Array.isArray(data.videosInicio)) SITE_CONFIG._videosInicio = data.videosInicio;
      if(Array.isArray(data.imagenesInicio)) SITE_CONFIG._imagenesInicio = data.imagenesInicio;
    }
  } catch(e) {}

  applyConfig();
  if(ADMIN_REQUEST){ pedirLoginAdmin(); }

  // Hero anima INMEDIATAMENTE — no espera Firebase para nada
  animarHero();

  // Repite la animación del hero cada vez que volvés a esa sección
  initHeroReplay();

  // Animaciones de scroll para el resto de las secciones (Nosotros,
  // Productos, Contacto, Footer). No depende de Firebase.
  initScrollReveal();

  // Carrito guardado de una visita anterior
  cargarCarritoLocal();

  // En el borrador, los datos se leen recién después de iniciar sesión
  // (la colección "borrador" solo la pueden leer los administradores).
  if(BORRADOR){
    document.body.classList.add('modo-borrador');
    await BORRADOR_LISTO;
  }

  // Firebase carga en segundo plano, nunca bloquea la UI ni la animación
  cargarConfigEditable().then(data => {
    if (data) {
      try { localStorage.setItem(LS('config_cache'), JSON.stringify(data)); } catch(e) {}
      applyConfig();
    }
  }).catch(() => {});

  // Agregamos la orden para que traiga los banners apenas entras a la página
  cargarMarqueeConfig();

  inicializar();
});

// ════════════════════════════════════════════════════════
//  ANIMACIÓN HERO — entrada única y armoniosa
//  Espera a que la imagen del logo esté lista antes de
//  arrancar, para que todo aparezca junto en cascada.
//  Se puede volver a disparar cada vez que la sección
//  vuelve a estar en pantalla (ver initHeroReplay más abajo).
// ════════════════════════════════════════════════════════
function animarHero(){
  const DELAY_BASE  = 110;
  const DELAY_START = 80;

  // Anima TODO de inmediato — sin esperar la imagen del logo
  const heroImg = document.getElementById('hero-title-img');
  const imgWrap = document.getElementById('hero-title-img-wrap');

  // Elementos sin la imagen — animan siempre con stagger normal
  const elementos = [
    document.getElementById('hero-eyebrow-1'),
    document.getElementById('hero-eyebrow-2'),
    document.getElementById('hero-title'),
    // imgWrap se maneja aparte ↓
    document.getElementById('hero-subtitle'),
    document.querySelector('.hero-cta'),
    document.querySelector('.hero-scroll'),
  ].filter(Boolean);

  const visibles = elementos.filter(el => el.style.display !== 'none');
  visibles.forEach((el, i) => {
    setTimeout(() => el.classList.add('hero-visible'), DELAY_START + i * DELAY_BASE);
  });

  // imgWrap: espera a que la imagen cargue para disparar la animación junto con ella
  if(imgWrap && imgWrap.style.display !== 'none'){
    // Posición natural en el stagger (después del hero-title, antes del subtitle)
    const staggerDelay = DELAY_START + 2 * DELAY_BASE;
    const revelar = () => { imgWrap.classList.add('hero-visible'); };
    if(heroImg && heroImg.src && heroImg.src !== window.location.href){
      if(heroImg.complete && heroImg.naturalWidth > 0){
        // Ya cargó (caché) — anima en su lugar normal
        setTimeout(revelar, staggerDelay);
      } else {
        // Aún no cargó — espera el evento y anima entonces
        const onLoad = () => { setTimeout(revelar, 80); };
        heroImg.addEventListener('load',  onLoad, { once: true });
        heroImg.addEventListener('error', onLoad, { once: true }); // fallback si falla
      }
    } else {
      setTimeout(revelar, staggerDelay);
    }
  }
}

// Quita la clase hero-visible de todos los elementos del hero,
// dejándolo listo para animarse de nuevo desde cero.
function resetearHero(){
  const elementos = [
    document.getElementById('hero-eyebrow-1'),
    document.getElementById('hero-eyebrow-2'),
    document.getElementById('hero-title'),
    document.getElementById('hero-title-img-wrap'),
    document.getElementById('hero-subtitle'),
    document.querySelector('.hero-cta'),
    document.querySelector('.hero-scroll'),
  ].filter(Boolean);
  elementos.forEach(el => el.classList.remove('hero-visible'));
}

// ════════════════════════════════════════════════════════
//  HERO REPLAY — repite la animación de entrada del hero
//  cada vez que la sección vuelve a estar en pantalla
//  (igual que el resto de las secciones), no solo la
//  primera vez que carga la página.
// ════════════════════════════════════════════════════════
function initHeroReplay(){
  const heroSection = document.getElementById('hero');
  if(!heroSection || !('IntersectionObserver' in window)) return;

  const heroObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        animarHero();
      } else {
        resetearHero();
      }
    });
  }, {
    threshold: 0.2,
    rootMargin: '0px 0px -60px 0px'
  });

  heroObserver.observe(heroSection);
}

// En mobile la barra de direcciones dispara 'resize' al aparecer/ocultarse
// (cambia solo el alto). Reconstruir solo si cambió el ANCHO, si no los
// carruseles vuelven al principio solos mientras se scrollea.
let resizeTimer;
let ultimoAncho = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if(window.innerWidth === ultimoAncho) return;
    ultimoAncho = window.innerWidth;
    buildAllCarousels();
  }, 150);
});

// ════════════════════════════════════════════════════════
//  SCROLL REVEAL — animación de entrada para cada sección
//  Le agrega las clases .reveal / .reveal-visible a los
//  elementos clave de Nosotros, Productos, Contacto y
//  Footer usando IntersectionObserver. No requiere tocar
//  el HTML: se auto-configura al cargar la página.
// ════════════════════════════════════════════════════════
function initScrollReveal(){
  // Si el navegador no soporta IntersectionObserver, mostramos todo sin animar
  if(!('IntersectionObserver' in window)){
    document.querySelectorAll('.reveal, .reveal-stagger, .divider').forEach(el => el.classList.add('reveal-visible'));
    return;
  }

  // Mapa de selector → clase de animación a aplicar
  const targets = [
    // NOSOTROS
    { sel: '#nosotros .about-image',            cls: 'reveal reveal-left'    },
    { sel: '#nosotros .about-text',              cls: 'reveal reveal-right'   },
    { sel: '#nosotros .divider',                 cls: 'reveal-grow'           },
    { sel: '#nosotros-stats',                    cls: 'reveal-stagger'        },

    // CONTACTO
    { sel: '#contacto .contacto-info',            cls: 'reveal reveal-left'    },
    { sel: '#contacto .divider',                  cls: 'reveal-grow'           },
    { sel: '#contacto .contacto-cta',             cls: 'reveal reveal-right'   },
    { sel: '#contacto .contact-item',              cls: 'reveal reveal-up'      },
    { sel: '#contacto .social-strip',             cls: 'reveal reveal-up'      },

    // FOOTER
    { sel: 'footer .footer-logo',                 cls: 'reveal reveal-up'      },
    { sel: 'footer .footer-social',               cls: 'reveal reveal-up'      },
    { sel: 'footer .footer-copy',                 cls: 'reveal reveal-up'      },
  ];

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        entry.target.classList.add('reveal-visible');
      } else {
        entry.target.classList.remove('reveal-visible');
      }
    });
  }, {
    threshold: 0.15,
    rootMargin: '0px 0px -60px 0px'
  });

  targets.forEach(({ sel, cls }) => {
    document.querySelectorAll(sel).forEach((el, i) => {
      cls.split(' ').forEach(c => el.classList.add(c));
      // Pequeño desfasaje entre elementos del mismo selector (ej: varios contact-item)
      if(i > 0) el.style.transitionDelay = (i * 0.12) + 's';
      observer.observe(el);
    });
  });

  // ── PRODUCTOS: caso especial ──────────────────────────────
  // Título y carruseles se activan/desactivan JUNTOS, mirando
  // la SECCIÓN completa (no cada elemento por separado). El
  // orden "título primero, carruseles después" lo da el delay
  // fijo en CSS (#carrousels-container.reveal), así que no
  // depende de seguir bajando el scroll.
  const tituloProductos = document.querySelector('#productos .productos-header');
  const carruselesProductos = document.getElementById('carrousels-container');
  if(tituloProductos) tituloProductos.classList.add('reveal', 'reveal-up');
  if(carruselesProductos) carruselesProductos.classList.add('reveal', 'reveal-up');

  const productosSection = document.getElementById('productos');
  if(productosSection){
    const productosObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if(entry.isIntersecting){
          if(tituloProductos) tituloProductos.classList.add('reveal-visible');
          if(carruselesProductos) carruselesProductos.classList.add('reveal-visible');
        }
        // NOTA: a propósito ya NO se remueve 'reveal-visible' acá.
        // Cuando Firebase termina de cargar y buildAllCarousels() llena
        // #carrousels-container, la sección cambia de alto de golpe
        // (layout shift) y el observer se vuelve a disparar con
        // isIntersecting=false aunque el usuario no se movió. Antes
        // eso volvía a ocultar la sección (classList.remove) y, como
        // no había más scroll, quedaba en blanco para siempre — hasta
        // que abrir DevTools forzaba un resize que "despertaba" todo
        // de nuevo. Ahora, una vez revelada, la sección de productos
        // se queda visible.
      });
    }, {
      // threshold 0 (apenas asoma): la sección de productos es MUY alta (crece con el
      // catálogo) y con un porcentaje (antes 0.15) nunca llegaba a cumplirse →
      // título y carruseles quedaban invisibles para siempre.
      threshold: 0,
      rootMargin: '0px 0px -60px 0px'
    });
    productosObserver.observe(productosSection);
  }

  // ── CADA CARRUSEL individual ──────────────────────────────
  // Además de la animación general del contenedor, cada
  // .cat-section (un carrusel por categoría) anima por separado
  // al entrar en pantalla mientras vas bajando, y se repite
  // cada vez que vuelve a aparecer — igual que el resto.
  const carruselesObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        entry.target.classList.add('reveal-visible');
      }
      // NOTA: igual que en productosObserver, ya no se remueve acá.
      // Los carruseles se reconstruyen todo el tiempo (resize, admin,
      // "cargar más productos"), y ese "remove" por layout shift podía
      // dejar un carrusel oculto para siempre sin que el usuario hiciera
      // nada raro. Una vez revelado, se queda visible.
    });
  }, {
    threshold: 0.12,
    rootMargin: '0px 0px -40px 0px'
  });

  // Observa los carruseles que ya existan al momento de correr esto
  document.querySelectorAll('#carrousels-container .cat-section').forEach(sec => {
    carruselesObserver.observe(sec);
  });

  // Los carruseles se destruyen y recrean todo el tiempo (buildAllCarousels
  // se llama al editar en admin, al hacer resize, al cargar más productos,
  // etc.), así que usamos un MutationObserver para que cualquier .cat-section
  // NUEVA se registre automáticamente sin tener que tocar este archivo de nuevo.
  if(carruselesProductos){
    const carruselesWatcher = new MutationObserver(() => {
      document.querySelectorAll('#carrousels-container .cat-section').forEach(sec => {
        if(!sec.dataset.revealObservado){
          sec.dataset.revealObservado = '1';
          carruselesObserver.observe(sec);
        }
      });
    });
    carruselesWatcher.observe(carruselesProductos, { childList: true });
  }

  // Los carruseles de productos se generan dinámicamente después de
  // cargar Firebase — cuando aparecen, si la sección "productos" ya
  // está visible en pantalla, los revelamos igual (evita que queden
  // ocultos por haberse creado después de que el observer ya disparó).
  if(productosSection){
    const lateObserver = new MutationObserver(() => {
      const rect = productosSection.getBoundingClientRect();
      const enPantalla = rect.top < window.innerHeight && rect.bottom > 0;
      if(enPantalla){
        if(tituloProductos) tituloProductos.classList.add('reveal-visible');
        if(carruselesProductos) carruselesProductos.classList.add('reveal-visible');
      }
    });
    lateObserver.observe(productosSection, { childList: true, subtree: true });
  }
}



// ════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════
function getCatId(cat){
  return 'cat-' + cat.toLowerCase()
    .replace(/[áàâä]/g,'a').replace(/[éèêë]/g,'e')
    .replace(/[íìîï]/g,'i').replace(/[óòôö]/g,'o')
    .replace(/[úùûü]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z0-9]/g,'-');
}

function getCategorias(){
  // Soporta tanto tipo (string legacy) como tipos (array nuevo)
  const cats = [];
  productos.forEach(p => {
    const lista = Array.isArray(p.tipos) ? p.tipos : [p.tipo];
    lista.forEach(c => { if(c && !cats.includes(c)) cats.push(c); });
  });
  // Aplicar orden personalizado si existe
  let resultado = cats;
  if(categoriaOrden.length > 0){
    const ordenadas = categoriaOrden.filter(c => cats.includes(c));
    const nuevas = cats.filter(c => !categoriaOrden.includes(c));
    resultado = [...ordenadas, ...nuevas];
  }
  // "Ofertas" siempre va primera si existe (destacada arriba de todo)
  if(resultado.includes(OFERTA_CAT)){
    resultado = [OFERTA_CAT, ...resultado.filter(c => c !== OFERTA_CAT)];
  }
  return resultado;
}

function esMobile(){ return window.innerWidth <= 768; }

function visiblePorPantalla(){
  if(esMobile())              return 4; // 4 cards por "página" en mobile (grilla 2x2)
  if(window.innerWidth <= 1024) return 2;
  return 3;
}

// ════════════════════════════════════════════════════════
//  CARRUSELES — Construir todos
// ════════════════════════════════════════════════════════
function buildAllCarousels(){
  const container = document.getElementById('carrousels-container');
  if(!container) return;

  container.innerHTML = '';

  const cats = getCategorias();
  const visibles = cats.filter(c => !categoriasOcultas.includes(c));
  const toInit = [];

  // IDs ya incluidos en "todos" para construirlo sin duplicados
  const idsTodos = new Set();
  const categoriasNuevas = [];
  const navLista = [];   // para el carrusel de categorías

  visibles.forEach((cat, idx) => {

    const prods = productos.filter(p => {
      const lista = Array.isArray(p.tipos) ? p.tipos : [p.tipo];
      return lista.includes(cat);
    });

    const orden = ordenCategorias[cat];
    if(orden){
      prods.sort((a,b) => {
        const ia = orden.indexOf(a.id);
        const ib = orden.indexOf(b.id);
        if(ia === -1) return 1;
        if(ib === -1) return -1;
        return ia - ib;
      });
    }

    if(!prods.length) return;

    const catId = getCatId(cat);
    const section = crearSeccionCarrusel(cat, catId, idx > 0);
    container.appendChild(section);

    // Lugar para videos/imágenes decorativas después de esta categoría
    const slot = document.createElement('div');
    slot.className = 'medios-cat';
    slot.dataset.pos = 'cat:' + cat;
    slot.style.display = 'none';
    slot.innerHTML = '<div class="videos-grid"></div>';
    container.appendChild(slot);
    categoriasNuevas.push(cat);
    navLista.push({ cat, prods: [...prods] });

    toInit.push({ catId, catNombre: cat, prods: [...prods] });

    // Acumular IDs para "todos"
    prods.forEach(p => idsTodos.add(p.id));
  });

  // "Todos los productos" — construido desde los productos ya en memoria,
  // sin duplicados, respetando el orden en que aparecen por categoría.
  // Se incluyen también productos sin categoría visible (edge case).
  const prodsTodos = [];
  const idsYaAgregados = new Set();

  // Primero los que aparecen en categorías visibles (en orden de aparición)
  toInit.forEach(({ prods }) => {
    prods.forEach(p => {
      if(!idsYaAgregados.has(p.id)){
        idsYaAgregados.add(p.id);
        prodsTodos.push(p);
      }
    });
  });

  // Luego los que pudieran no estar en ninguna categoría visible (no debería ocurrir,
  // pero los incluimos para que "todos" sea realmente TODOS)
  productos.forEach(p => {
    if(!idsYaAgregados.has(p.id)){
      idsYaAgregados.add(p.id);
      prodsTodos.push(p);
    }
  });

  if(prodsTodos.length > 0){
    const section = crearSeccionCarrusel('Todos los productos', 'todos', visibles.length > 0);
    container.appendChild(section);
    toInit.push({ catId: 'todos', catNombre: 'todos', prods: prodsTodos });
  }

  // Construir tracks + eventos
  toInit.forEach(({ catId, catNombre, prods }) => {

    buildTrack(catId, prods);

  });

  // Volver a ubicar videos/imágenes (los lugares entre categorías se recrearon)
  categoriasEnPagina = categoriasNuevas;
  carruselesConstruidos = true;
  renderCatNav(navLista);
  videosRenderKey = null;
  renderVideosInicio();
}

function crearSeccionCarrusel(cat, catId, showDivider){
  const section = document.createElement('div');
  section.className = 'cat-section reveal' + (cat === OFERTA_CAT ? ' cat-section-ofertas' : '');
  section.id = 'section-' + catId;

  if(showDivider){
    const d = document.createElement('div');
    d.className = 'cat-divider';
    section.appendChild(d);
  }

  const header = document.createElement('div');
  header.className = 'cat-section-header';
  header.innerHTML = cat === OFERTA_CAT
    ? `<span class="section-label cat-label cat-label-ofertas">🏷 ${esc(cat)}</span>`
    : `<span class="section-label cat-label">${esc(cat)}</span>`;
  section.appendChild(header);

  const wrapper = document.createElement('div');
  wrapper.className = 'carrusel-wrapper';
  wrapper.innerHTML = `
    <button class="carrusel-btn prev" id="btn-prev-${catId}" onclick="moverCarrusel('${catId}',-1)">
      <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <div class="carrusel-track-outer">
      <div class="carrusel-track" id="carrusel-track-${catId}"></div>
    </div>
    <button class="carrusel-btn next" id="btn-next-${catId}" onclick="moverCarrusel('${catId}',1)">
      <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
    </button>`;
  section.appendChild(wrapper);
  return section;
}

function buildTrack(catId, prods){
  const track = document.getElementById('carrusel-track-' + catId);
  if(!track || !prods.length) return;

  // En modo visitante, ocultar los productos marcados como no visibles
  const prodsVisibles = ADMIN_MODE
    ? prods
    : prods.filter(p => !productosOcultos.includes(p.id));

  const visible = visiblePorPantalla();
  const cardW   = getCardWidth();

  carruselProds[catId] = prodsVisibles;
  posCarrusel[catId]   = 0;
  track.innerHTML      = '';

  if(esMobile()){
    // Agrupar de a 4 cards en grupos 2x2
    const grupos = [];
    for(let i = 0; i < prodsVisibles.length; i += 4){
      grupos.push(prodsVisibles.slice(i, i + 4));
    }
    grupos.forEach(grupo => {
      const grp = document.createElement('div');
      grp.className = 'carrusel-grupo-mobile';
      grp.style.flex = `0 0 ${getGrupoMobileWidth()}px`;
      grp.style.display = 'grid';
      grp.style.gridTemplateColumns = '1fr 1fr';
      grp.style.gap = '10px'; // debe coincidir con el gap de getCardWidth()
      grupo.forEach(p => {
        const card = crearCard(p, false);
        card.style.flex = '';
        card.style.width = '100%';
        grp.appendChild(card);
      });
      track.appendChild(grp);
    });
  } else {
    prodsVisibles.forEach(p => {
      const card = crearCard(p, false);
      card.style.flex = `0 0 ${cardW}px`;
      track.appendChild(card);
    });
  }

  // Si el usuario desliza con el dedo/trackpad, sincronizar la posición para
  // que las flechas sigan desde donde quedó (antes saltaban a la posición vieja).
  const outer = track.closest('.carrusel-track-outer');
  if(outer){
    let scrollTimer;
    outer.onscroll = () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        posCarrusel[catId] = Math.round(outer.scrollLeft / pasoCarrusel());
      }, 80);
    };
  }

  const btnPrev = document.getElementById('btn-prev-' + catId);
  const btnNext = document.getElementById('btn-next-' + catId);
  const totalGrupos = esMobile() ? Math.ceil(prodsVisibles.length / 4) : prodsVisibles.length;
  const ocultar = totalGrupos <= 1;
  if(btnPrev) btnPrev.style.display = ocultar ? 'none' : '';
  if(btnNext) btnNext.style.display = ocultar ? 'none' : '';
}

// Agrega productos nuevos al final del track "todos" SIN reconstruirlo
// (evita el reset de scroll/posición del carrusel)
function apendarATrackTodos(nuevosVisibles){
  const catId = 'todos';
  const track = document.getElementById('carrusel-track-' + catId);
  if(!track || !nuevosVisibles.length) return;
  if(!carruselProds[catId]) carruselProds[catId] = [];

  const cardW = getCardWidth();
  nuevosVisibles.forEach(p => carruselProds[catId].push(p));

  if(esMobile()){
    const totalAhora = carruselProds[catId].length;
    const totalAntes = totalAhora - nuevosVisibles.length;
    const restoAnterior = totalAntes % 4;
    if(restoAnterior !== 0 && track.lastChild){
      track.removeChild(track.lastChild);
    }
    const aRenderizar = restoAnterior !== 0
      ? carruselProds[catId].slice(totalAntes - restoAnterior)
      : nuevosVisibles;
    for(let i = 0; i < aRenderizar.length; i += 4){
      const grupo = aRenderizar.slice(i, i + 4);
      const grp = document.createElement('div');
      grp.className = 'carrusel-grupo-mobile';
      grp.style.flex = `0 0 ${getGrupoMobileWidth()}px`;
      grp.style.display = 'grid';
      grp.style.gridTemplateColumns = '1fr 1fr';
      grp.style.gap = '10px'; // debe coincidir con el gap de getCardWidth()
      grupo.forEach(p => {
        const card = crearCard(p, false);
        card.style.flex = '';
        card.style.width = '100%';
        grp.appendChild(card);
      });
      track.appendChild(grp);
    }
  } else {
    nuevosVisibles.forEach(p => {
      const card = crearCard(p, false);
      card.style.flex = `0 0 ${cardW}px`;
      track.appendChild(card);
    });
  }

  const visible = visiblePorPantalla();
  const total   = carruselProds[catId].length;
  const btnPrev = document.getElementById('btn-prev-todos');
  const btnNext = document.getElementById('btn-next-todos');
  if(btnPrev) btnPrev.style.display = total <= visible ? 'none' : '';
  if(btnNext) btnNext.style.display = total <= visible ? 'none' : '';
}

function esProductoEnOferta(p){
  return !!p.enOferta && !!p.precioOferta;
}

function crearCard(p, esClonado){
  const card = document.createElement('div');
  card.dataset.prodId = p.id;          
  const estaOculto = productosOcultos.includes(p.id);
  const enOferta = esProductoEnOferta(p);
  card.className = 'producto-card' + (estaOculto ? ' producto-oculto' : '') + (enOferta ? ' producto-oferta' : '');
  const precioHTML = enOferta
    ? `<div class="prod-precio-row"><span class="prod-precio-tachado">${esc(p.precio)}</span><span class="prod-precio-oferta">${esc(p.precioOferta)}</span></div>`
    : (p.precio ? `<div class="prod-precio-row"><span class="prod-precio-normal">${esc(p.precio)}</span></div>` : '');
  card.innerHTML = `
    ${enOferta ? '<div class="oferta-ribbon">Oferta</div>' : ''}
    <div class="prod-img-placeholder">
      <img src="${esc(cldUrl(p.img, CLD_CARD))}" alt="${esc(p.nombre)}" loading="lazy" decoding="async">
    </div>
    <div class="prod-info">
      <div class="prod-tipo">${esc(Array.isArray(p.tipos) ? p.tipos[0] : p.tipo)}</div>
      <div class="prod-name">${esc(p.nombre)}</div>
      ${precioHTML}
    </div>
    <div class="prod-overlay">
      <h3>${esc(p.nombre)}</h3>
      <div class="ver-mas">Ver más</div>
    </div>`;

  if(ADMIN_MODE && !esClonado){
    const btnDel = document.createElement('button');
    btnDel.className = 'admin-delete-btn';
    btnDel.innerHTML = '×';
    btnDel.title = 'Eliminar producto';
    btnDel.addEventListener('click', e => { e.stopPropagation(); eliminarProducto(p); });
    card.appendChild(btnDel);

    const btnEdit = document.createElement('button');
    btnEdit.className = 'admin-edit-btn';
    btnEdit.innerHTML = '✏';
    btnEdit.title = 'Editar producto';
    btnEdit.style.right = '50px';
    btnEdit.addEventListener('click', e => { e.stopPropagation(); abrirModalEditar(p); });
    card.appendChild(btnEdit);

    const btnVis = document.createElement('button');
    btnVis.className = 'admin-visibility-btn' + (estaOculto ? ' is-hidden' : '');
    btnVis.title = estaOculto ? 'Producto oculto — clic para mostrar' : 'Ocultar producto';
    btnVis.innerHTML = estaOculto
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    btnVis.addEventListener('click', e => { e.stopPropagation(); toggleVisibilidadProducto(p, card, btnVis); });
    card.appendChild(btnVis);

    if(estaOculto){
      const badge = document.createElement('div');
      badge.className = 'oculto-badge';
      badge.textContent = 'No visible';
      card.appendChild(badge);
    }
  }

  card.addEventListener('click', () => openModal(p));
  return card;
}

function getGrupoMobileWidth(){
  // Ancho real y exacto del contenedor visible del carrusel (evita desajustes
  // de padding/gap calculados "a mano", que eran la causa de columnas
  // asimétricas y de desbordes horizontales que forzaban el zoom en mobile).
  const outer = document.querySelector('.carrusel-track-outer');
  if(outer) return outer.clientWidth;
  return window.innerWidth - 48; // fallback si aún no existe el contenedor
}

function getCardWidth(){
  const gap = 10;
  if(esMobile()){
    // 2 columnas → cada card ocupa la mitad del contenedor menos el gap central
    const containerW = getGrupoMobileWidth();
    return (containerW - gap) / 2;
  }
  const visibleN = visiblePorPantalla();
  const padding = 128;
  const containerW = Math.min(window.innerWidth - padding, 1100);
  return (containerW - gap * (visibleN - 1)) / visibleN;
}

function actualizarCarrusel(catId){
  const track = document.getElementById('carrusel-track-' + catId);
  if(!track) return;
  const outer  = track.closest('.carrusel-track-outer');
  const cardW  = getCardWidth();
  if(esMobile()){
    const grupoW = getGrupoMobileWidth();
    Array.from(track.children).forEach(c => { c.style.flex = `0 0 ${grupoW}px`; });
    if(outer) outer.scrollLeft = (posCarrusel[catId] || 0) * (grupoW + 20);
  } else {
    Array.from(track.children).forEach(c => c.style.flex = `0 0 ${cardW}px`);
    if(outer) outer.scrollLeft = (posCarrusel[catId] || 0) * (cardW + 20);
  }
}

function moverCarrusel(catId, dir){
  const prods   = carruselProds[catId] || [];
  const visible = visiblePorPantalla();
  // En mobile los items del track son grupos de 4, no cards individuales
  const totalItems = esMobile() ? Math.ceil(prods.length / 4) : prods.length;
  if(totalItems <= 1) return;

  const maxPos = totalItems - 1;
  posCarrusel[catId] = Math.max(0, Math.min((posCarrusel[catId] || 0) + dir, maxPos));

  const track = document.getElementById('carrusel-track-' + catId);
  const outer = track?.closest('.carrusel-track-outer');
  if(outer) outer.scrollLeft = posCarrusel[catId] * pasoCarrusel();
}

// Distancia en px entre un "paso" del carrusel y el siguiente (card o grupo 2x2 + gap)
function pasoCarrusel(){
  return esMobile() ? getGrupoMobileWidth() + 20 : getCardWidth() + 20;
}

// ════════════════════════════════════════════════════════
//  MODAL PRODUCTO
// ════════════════════════════════════════════════════════
function openModal(p){
  const tiposModal = Array.isArray(p.tipos) ? p.tipos.filter(t => t !== OFERTA_CAT) : [p.tipo];
  document.getElementById('modal-tipo').textContent  = tiposModal.join(' · ');
  document.getElementById('modal-title').textContent = p.nombre;

  const modalPrecioEl = document.getElementById('modal-precio');
  if(esProductoEnOferta(p)){
    modalPrecioEl.innerHTML = `<span class="oferta-ribbon-modal">Oferta</span>
      <span class="modal-precio-tachado">${esc(p.precio)}</span>
      <span class="modal-precio-oferta">${esc(p.precioOferta)}</span>`;
  } else {
    modalPrecioEl.textContent = p.precio ? p.precio : '';
  }
  document.getElementById('modal-desc').textContent  = p.desc;
  
  const imgContainer = document.getElementById('modal-img');
  const imgs = p.imgs && p.imgs.length > 0 ? p.imgs : [p.img];
  
  if(imgs.length <= 1){
    imgContainer.innerHTML = `<img src="${esc(cldUrl(imgs[0], CLD_MODAL))}" alt="${esc(p.nombre)}" style="width:100%;height:100%;object-fit:cover;">`;
  } else {
    let dotsHTML = imgs.map((_,i) => `<div class="modal-dot${i===0?' active':''}" onclick="modalCarouselGo(${i})"></div>`).join('');
    // Solo se descarga la primera foto; las demás recién cuando se pasan
    let imgsHTML = imgs.map((src,i) => i === 0
      ? `<img src="${esc(cldUrl(src, CLD_MODAL))}" class="active" alt="">`
      : `<img data-src="${esc(cldUrl(src, CLD_MODAL))}" alt="">`).join('');
    imgContainer.innerHTML = `
      <div class="modal-img-carousel" id="modal-carousel">
        ${imgsHTML}
        <button class="modal-carousel-btn prev-modal" onclick="modalCarouselMove(-1)">
          <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button class="modal-carousel-btn next-modal" onclick="modalCarouselMove(1)">
          <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div class="modal-carousel-dots">${dotsHTML}</div>
      </div>`;
    window._modalCarouselIdx = 0;
    window._modalCarouselTotal = imgs.length;
  }
  
  // WhatsApp link con nombre del producto
  const template = SITE_CONFIG.contacto.waTextoProducto || SITE_CONFIG.contacto.waTexto;
  const msgProducto = template.replace('{nombre}', p.nombre);
  document.getElementById('modal-wa').href = `https://wa.me/${SITE_CONFIG.whatsapp}?text=${encodeURIComponent(msgProducto)}`;

  pintarAccionesAdminModal(p);

  document.getElementById('modal').classList.add('active');
  document.getElementById('modal-add-cart').onclick = () => agregarAlCarrito(p);
  document.body.style.overflow = 'hidden';
}

// Si estamos en modo admin, agrega dentro del modal de producto los mismos
// botones de editar / ocultar / eliminar que ya existen en las cards del
// carrusel. Esto permite entrar a un producto desde el buscador (en modo
// admin) y administrarlo sin tener que volver a encontrarlo en su carrusel.
function pintarAccionesAdminModal(p){
  const cont = document.getElementById('modal-admin-actions');
  if(!cont) return;
  cont.innerHTML = '';
  if(!ADMIN_MODE) return;

  const svgOculto  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  const svgVisible = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

  const btnEdit = document.createElement('button');
  btnEdit.className = 'admin-edit-btn';
  btnEdit.innerHTML = '✏';
  btnEdit.title = 'Editar producto';
  btnEdit.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('modal').classList.remove('active');
    document.body.style.overflow = '';
    abrirModalEditar(p);
  });

  const estaOculto = productosOcultos.includes(p.id);
  const btnVis = document.createElement('button');
  btnVis.className = 'admin-visibility-btn' + (estaOculto ? ' is-hidden' : '');
  btnVis.title = estaOculto ? 'Producto oculto — clic para mostrar' : 'Ocultar producto';
  btnVis.innerHTML = estaOculto ? svgOculto : svgVisible;
  btnVis.addEventListener('click', e => {
    e.stopPropagation();
    toggleVisibilidadProducto(p, null, btnVis);
    // El array `productosOcultos` ya está actualizado de forma síncrona
    // apenas se llama a toggleVisibilidadProducto (antes del guardado async),
    // así que podemos reflejar el nuevo estado en el botón al toque.
    const ahoraOculto = productosOcultos.includes(p.id);
    btnVis.classList.toggle('is-hidden', ahoraOculto);
    btnVis.title = ahoraOculto ? 'Producto oculto — clic para mostrar' : 'Ocultar producto';
    btnVis.innerHTML = ahoraOculto ? svgOculto : svgVisible;
  });

  const btnDel = document.createElement('button');
  btnDel.className = 'admin-delete-btn';
  btnDel.innerHTML = '×';
  btnDel.title = 'Eliminar producto';
  btnDel.addEventListener('click', async e => {
    e.stopPropagation();
    await eliminarProducto(p);
    document.getElementById('modal').classList.remove('active');
    document.body.style.overflow = '';
  });

  cont.appendChild(btnEdit);
  cont.appendChild(btnVis);
  cont.appendChild(btnDel);
}

function modalCarouselMove(dir){
  const total = window._modalCarouselTotal || 1;
  window._modalCarouselIdx = ((window._modalCarouselIdx || 0) + dir + total) % total;
  modalCarouselGo(window._modalCarouselIdx);
}

function modalCarouselGo(idx){
  window._modalCarouselIdx = idx;
  const carousel = document.getElementById('modal-carousel');
  if(!carousel) return;
  carousel.querySelectorAll('img').forEach((img, i) => {
    // carga la foto actual y la siguiente (para que el cambio sea instantáneo)
    const total = window._modalCarouselTotal || 1;
    if((i === idx || i === (idx + 1) % total) && img.dataset.src && !img.getAttribute('src')) img.src = img.dataset.src;
    img.classList.toggle('active', i === idx);
  });
  carousel.querySelectorAll('.modal-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
}

function closeModal(e){
  if(e.target === document.getElementById('modal')){
    document.getElementById('modal').classList.remove('active');
    document.body.style.overflow = '';
    resetModalZoom();
  }
}

// ════════════════════════════════════════════════════════
//  ZOOM EN IMAGEN DEL MODAL
//  — Desktop: rueda del mouse sobre la imagen
//  — Mobile:  gesto pinch (dos dedos) sobre la imagen
// ════════════════════════════════════════════════════════
const ZOOM_MIN   = 1;
const ZOOM_MAX   = 4;
const ZOOM_STEP  = 0.15;

let zoomState = {
  scale:    1,
  originX:  50,   // % dentro de la imagen
  originY:  50,
  // pinch
  lastDist: null,
};

function getActiveModalImg(){
  const container = document.getElementById('modal-img');
  if(!container) return null;
  // Carrusel múltiple
  const active = container.querySelector('img.active');
  if(active) return active;
  // Imagen única
  return container.querySelector('img');
}

function applyZoom(){
  const img = getActiveModalImg();
  if(!img) return;
  img.style.transformOrigin = `${zoomState.originX}% ${zoomState.originY}%`;
  img.style.transform       = `scale(${zoomState.scale})`;
  img.style.transition      = 'transform 0.12s ease';
  img.style.cursor          = zoomState.scale > 1 ? 'zoom-out' : 'zoom-in';
}

function resetModalZoom(){
  zoomState.scale   = 1;
  zoomState.originX = 50;
  zoomState.originY = 50;
  zoomState.lastDist = null;
  const img = getActiveModalImg();
  if(img){
    img.style.transform       = 'scale(1)';
    img.style.transformOrigin = '50% 50%';
    img.style.cursor          = '';
  }
}

// Calcular origen del zoom relativo a la imagen
function calcOrigin(e, img){
  const rect = img.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width)  * 100;
  const y = ((e.clientY - rect.top)  / rect.height) * 100;
  return {
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y)),
  };
}

// ── Desktop: wheel ──────────────────────────────────────
document.addEventListener('wheel', function(e){
  const container = document.getElementById('modal-img');
  if(!container || !container.contains(e.target)) return;

  const img = getActiveModalImg();
  if(!img) return;

  e.preventDefault();

  const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
  const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomState.scale + delta));

  if(newScale !== zoomState.scale){
    const origin = calcOrigin(e, img);
    zoomState.originX = origin.x;
    zoomState.originY = origin.y;
    zoomState.scale   = newScale;
  }
  applyZoom();
}, { passive: false });

// ── Mobile: pinch ───────────────────────────────────────
document.addEventListener('touchstart', function(e){
  const container = document.getElementById('modal-img');
  if(!container || !container.contains(e.target)) return;
  if(e.touches.length === 2){
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    zoomState.lastDist = Math.hypot(dx, dy);
  }
}, { passive: true });

document.addEventListener('touchmove', function(e){
  const container = document.getElementById('modal-img');
  if(!container || !container.contains(e.target)) return;
  if(e.touches.length !== 2 || zoomState.lastDist === null) return;

  e.preventDefault();

  const dx = e.touches[0].clientX - e.touches[1].clientX;
  const dy = e.touches[0].clientY - e.touches[1].clientY;
  const dist = Math.hypot(dx, dy);

  const ratio    = dist / zoomState.lastDist;
  const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomState.scale * ratio));

  // Origen = punto medio entre los dos dedos
  const img = getActiveModalImg();
  if(img){
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const rect = img.getBoundingClientRect();
    zoomState.originX = Math.max(0, Math.min(100, ((mx - rect.left) / rect.width)  * 100));
    zoomState.originY = Math.max(0, Math.min(100, ((my - rect.top)  / rect.height) * 100));
  }

  zoomState.scale   = newScale;
  zoomState.lastDist = dist;
  applyZoom();
}, { passive: false });

document.addEventListener('touchend', function(e){
  if(e.touches.length < 2) zoomState.lastDist = null;
}, { passive: true });

// Resetear zoom al cambiar de foto en el carrusel del modal
const _origModalCarouselGo = window.modalCarouselGo;
window.modalCarouselGo = function(idx){
  resetModalZoom();
  _origModalCarouselGo(idx);
};

document.querySelector('.modal-close').addEventListener('click', () => {
  document.getElementById('modal').classList.remove('active');
  document.body.style.overflow = '';
});

function scrollToSection(id){
  const el = document.getElementById(id);
  if(!el) return;
  const offset = document.documentElement.style.getPropertyValue('--body-push-top') 
    ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--body-push-top')) 
    : 0;
  const top = el.getBoundingClientRect().top + window.scrollY - offset - 15;
  window.scrollTo({ top, behavior: 'smooth' });
}

// ════════════════════════════════════════════════════════
//  ADMIN — Eliminar
// ════════════════════════════════════════════════════════
async function eliminarProducto(p){
  if(!confirm(`¿Eliminar "${p.nombre}" del catálogo?`)) return;
  mostrarToast('Guardando…');
  try {
    await esperarAdminListo();
    // Por id (no por referencia): tras la sincronización admin los objetos se recrean
    productos = productos.filter(x => x.id !== p.id);
    productosOcultos = productosOcultos.filter(id => id !== p.id);
    buildAllCarousels();
    if(p.id) await eliminarProductoEnFirebase(p.id);
    await guardarMetaEnFirebase();
    mostrarToast('Producto eliminado ✓');
  } catch(err) {
    console.error('Error eliminando producto:', err);
    mostrarToastError('⚠ Error al eliminar. Revisá la conexión, recargar la página.', 7000);
  }
}

// ════════════════════════════════════════════════════════
//  ADMIN — Visibilidad individual de producto
// ════════════════════════════════════════════════════════
async function toggleVisibilidadProducto(p, card, btn){
  const estaOculto = productosOcultos.includes(p.id);

  if(estaOculto){
    // Mostrar → quitar del array
    productosOcultos = productosOcultos.filter(id => id !== p.id);
  } else {
    // Ocultar → agregar al array
    productosOcultos.push(p.id);
  }

// Actualizar visual de la card sin reconstruir todo
const ahoraOculto = !estaOculto;
const svgOculto = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
const svgVisible = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

document.querySelectorAll(`.producto-card[data-prod-id="${p.id}"]`).forEach(c => {
  c.classList.toggle('producto-oculto', ahoraOculto);
  const b = c.querySelector('.admin-visibility-btn');
  if(b){
    b.classList.toggle('is-hidden', ahoraOculto);
    b.title = ahoraOculto ? 'Producto oculto — clic para mostrar' : 'Ocultar producto';
    b.innerHTML = ahoraOculto ? svgOculto : svgVisible;
  }
  const badgeExistente = c.querySelector('.oculto-badge');
  if(ahoraOculto && !badgeExistente){
    const badge = document.createElement('div');
    badge.className = 'oculto-badge';
    badge.textContent = 'No visible';
    c.appendChild(badge);
  } else if(!ahoraOculto && badgeExistente){
    badgeExistente.remove();
  }
});
  


  mostrarToast('Guardando…');
  try {
    await esperarAdminListo();
    await guardarMetaEnFirebase();
    mostrarToast(ahoraOculto ? 'Producto ocultado ✓' : 'Producto visible ✓');
  } catch(err) {
    console.error('Error guardando visibilidad:', err);
    mostrarToastError('⚠ Error al guardar. Revisá la conexión, recargar la página.', 7000);
  }
}


let fotosBase64 = [];      // array de todas las fotos
let portadaIdx = 0;        // índice de la foto de portada
let productoEditando = null;

// Muestra/oculta el campo "Precio final con descuento" según el checkbox de oferta
function toggleCampoOferta(){
  const checked = document.getElementById('a-es-oferta').checked;
  document.getElementById('a-oferta-wrap').style.display = checked ? 'block' : 'none';
}

function resetCampoOferta(){
  document.getElementById('a-es-oferta').checked = false;
  document.getElementById('a-precio-oferta').value = '';
  document.getElementById('a-oferta-wrap').style.display = 'none';
}

function abrirModalAgregar(){
  productoEditando = null;
  fotosBase64 = [];
  portadaIdx = 0;
  document.getElementById('a-nombre').value = '';
  document.getElementById('a-precio').value = '';
  document.getElementById('a-desc').value   = '';
  poblarSelectTipo('');
  resetCampoOferta();
  document.querySelector('.admin-modal h2').textContent = 'Nuevo producto';
  renderFotosGrid();
  document.getElementById('admin-modal').classList.add('active');
}

function cerrarAdminModal(e){
  if(e.target.id !== 'admin-modal') return;
  document.getElementById('admin-modal').classList.remove('active');
  productoEditando = null;
  fotosBase64 = [];
  portadaIdx = 0;
  document.getElementById('a-nombre').value = '';
  document.getElementById('a-desc').value   = '';
  poblarSelectTipo([]);
  resetCampoOferta();
  renderFotosGrid();
  document.getElementById('a-foto-texto').textContent = textoFotosCargadas();
  document.querySelector('.admin-modal h2').textContent = 'Nuevo producto';
}

function textoFotosCargadas(){
  const n = fotosBase64.length;
  if(n === 0) return `Hacé clic para subir imágenes (máximo ${LIMITES.FOTOS_POR_PRODUCTO})`;
  const base = `${n} imagen${n!==1?'es':''} cargada${n!==1?'s':''} de ${LIMITES.FOTOS_POR_PRODUCTO}`;
  return n >= LIMITES.FOTOS_POR_PRODUCTO ? base + ' — llegaste al máximo' : base;
}

function agregarFotos(e){
  let files = Array.from(e.target.files);
  e.target.value = '';
  if(!files.length) return;

  // 1) Solo fotos: se descartan videos y formatos no compatibles
  const errores = [];
  files = files.filter(f => {
    const err = validarArchivoFoto(f);
    if(err) errores.push(err);
    return !err;
  });

  // 2) Máximo de fotos por producto
  const lugares = LIMITES.FOTOS_POR_PRODUCTO - fotosBase64.length;
  if(lugares <= 0){
    alert(`Cada producto puede tener como máximo ${LIMITES.FOTOS_POR_PRODUCTO} fotos.\nEliminá alguna para agregar otra.`);
    return;
  }
  if(files.length > lugares){
    errores.push(`Cada producto puede tener como máximo ${LIMITES.FOTOS_POR_PRODUCTO} fotos: se agregaron solo ${lugares} de las ${files.length} elegidas.`);
    files = files.slice(0, lugares);
  }
  if(errores.length) alert(errores.join('\n\n'));
  if(!files.length) return;

  const eraVacio = fotosBase64.length === 0;
  const resultados = new Array(files.length).fill(null);
  let pending = files.length;
  const terminar = () => {
    if(--pending > 0) return;
    resultados.filter(Boolean).forEach(b64 => {
      if(fotosBase64.length < LIMITES.FOTOS_POR_PRODUCTO) fotosBase64.push(b64);
    });
    if(eraVacio) portadaIdx = 0;
    renderFotosGrid();
    document.getElementById('a-foto-texto').textContent = textoFotosCargadas();
  };
  files.forEach((file, i) => {
    comprimirImagen(file, base64 => { resultados[i] = base64; terminar(); }, terminar);
  });
}

function renderFotosGrid(){
  const grid = document.getElementById('fotos-preview-grid');
  if(!grid) return;
  const txt = document.getElementById('a-foto-texto');
  if(txt) txt.textContent = textoFotosCargadas();
  grid.innerHTML = '';
  fotosBase64.forEach((src, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'foto-thumb-wrap' + (i === portadaIdx ? ' is-portada' : '');
    wrap.title = 'Clic para marcar como portada';
    wrap.innerHTML = `
      <img src="${esc(cldUrl(src, CLD_THUMB))}" class="${i === portadaIdx ? 'portada-activa' : ''}" alt="">
      <button class="foto-thumb-remove" title="Eliminar foto">×</button>
      ${i === portadaIdx ? '<span class="portada-badge">Portada</span>' : ''}`;
    wrap.querySelector('img').addEventListener('click', () => { portadaIdx = i; renderFotosGrid(); });
    wrap.querySelector('.foto-thumb-remove').addEventListener('click', e => {
      e.stopPropagation();
      fotosBase64.splice(i, 1);
      if(portadaIdx >= fotosBase64.length) portadaIdx = Math.max(0, fotosBase64.length - 1);
      renderFotosGrid();
      document.getElementById('a-foto-texto').textContent = textoFotosCargadas();
    });
    grid.appendChild(wrap);
  });
}

// Lee un archivo de imagen y lo redimensiona en un canvas.
// Siempre devuelve algo MUY por debajo de los límites de Cloudinary
// (lado máx 1600 px ≈ 2,6 MP, y se baja la calidad si hiciera falta).
function leerImagenEnCanvas(file, maxLado, onListo, onError){
  const fallar = msg => { alert(msg); if(onError) onError(); };
  const err = validarArchivoFoto(file);
  if(err){ fallar(err); return; }
  const reader = new FileReader();
  reader.onerror = () => fallar(`No se pudo leer "${file.name}".`);
  reader.onload = ev => {
    const img = new Image();
    img.onerror = () => fallar(`"${file.name}" no se pudo abrir como imagen. Probá guardarla como JPG o PNG.`);
    img.onload = () => {
      let w = img.width, h = img.height;
      if(w > maxLado){ h = Math.round(h * maxLado / w); w = maxLado; }
      if(h > maxLado){ w = Math.round(w * maxLado / h); h = maxLado; }
      if(w * h > LIMITES.IMG_MAX_MP * 1e6){ fallar(`"${file.name}" es demasiado grande.`); return; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      onListo(canvas, img);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function comprimirImagen(file, callback, onError){
  leerImagenEnCanvas(file, 1600, (canvas, img) => {
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    // Ahora la foto va a Cloudinary: se sube con buena calidad y Cloudinary
    // después entrega versiones livianas según el tamaño de pantalla.
    let calidad = 0.85;
    let out = canvas.toDataURL('image/jpeg', calidad);
    while(tamanoArchivo(out) > LIMITES.IMG_MAX_BYTES && calidad > 0.4){
      calidad -= 0.1;
      out = canvas.toDataURL('image/jpeg', calidad);
    }
    callback(out);
  }, onError);
}

// Igual que comprimirImagen pero exporta PNG para preservar transparencia (ej: logo hero)
function comprimirImagenPNG(file, callback, onError){
  leerImagenEnCanvas(file, 1000, (canvas, img) => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height); // asegura fondo transparente
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let out = canvas.toDataURL('image/png');
    // Si el PNG quedara pesado de más (muy raro a 1000 px), se usa WEBP con transparencia
    if(tamanoArchivo(out) > LIMITES.IMG_MAX_BYTES) out = canvas.toDataURL('image/webp', 0.9);
    callback(out);
  }, onError);
}

// Mostrar/ocultar input de nueva categoría
function toggleNuevaCat(){
  const wrap = document.getElementById('a-tipo-nueva-wrap');
  const input = document.getElementById('a-tipo-nueva');
  const visible = wrap.style.display === 'block';
  if(visible){
    wrap.style.display = 'none';
    input.value = '';
  } else {
    wrap.style.display = 'block';
    input.focus();
  }
}

// Poblar checkboxes de categorías (selección múltiple)
function poblarSelectTipo(seleccionados = []){
  const selArr = Array.isArray(seleccionados) ? seleccionados : [seleccionados];
  const opcionesFijas = SITE_CONFIG.categoriasFijas;
  const existentes = getCategorias();
  const extras = existentes.filter(c => !opcionesFijas.includes(c));
  // "Ofertas" no se elige acá como categoría normal: se gestiona con el
  // checkbox dedicado "Agregar a la sección OFERTAS" del mismo modal.
  const todas = [...new Set([...opcionesFijas, ...extras])].filter(c => c !== OFERTA_CAT);

  const container = document.getElementById('a-tipos-checks');
  container.innerHTML = '';

  todas.forEach(c => {
    const label = document.createElement('label');
    label.className = 'cat-checkbox-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = c;
    cb.checked = selArr.includes(c);
    label.appendChild(cb);
    label.append(' ' + c);
    container.appendChild(label);
  });

  // Mostrar/ocultar "nueva categoría"
  document.getElementById('a-tipo-nueva-wrap').style.display = 'none';
  document.getElementById('a-tipo-nueva').value = '';
}

async function guardarProducto(){
  const nombre = document.getElementById('a-nombre').value.trim();
  const precioInput = document.getElementById('a-precio').value.trim();
  const precio = precioInput ? '$' + Number(precioInput.replace(/\D/g, '')).toLocaleString('es-AR') : '';
  const desc   = document.getElementById('a-desc').value.trim();

  // Categorías seleccionadas (checkboxes múltiples)
  const tiposSeleccionados = Array.from(
    document.querySelectorAll('#a-tipos-checks input[type=checkbox]:checked')
  ).map(cb => cb.value);

  // Nueva categoría escrita a mano
  const nuevaCatInput = document.getElementById('a-tipo-nueva').value.trim();
  if(nuevaCatInput && nuevaCatInput !== OFERTA_CAT && !tiposSeleccionados.includes(nuevaCatInput)){
    tiposSeleccionados.push(nuevaCatInput);
  }

  if(!nombre)    { alert('Por favor ingresá el nombre del producto.'); return; }
  if(!tiposSeleccionados.length){ alert('Por favor seleccioná al menos una categoría.'); return; }
  if(!fotosBase64.length){ alert('Por favor subí al menos una foto del producto.'); return; }
  // Límite de fotos: se controla solo si hay fotos nuevas (productos viejos con
  // más fotos ya subidas se pueden seguir editando sin tocar sus fotos).
  if(fotosBase64.length > LIMITES.FOTOS_POR_PRODUCTO && fotosBase64.some(esBase64)){
    alert(`Cada producto puede tener como máximo ${LIMITES.FOTOS_POR_PRODUCTO} fotos. Eliminá ${fotosBase64.length - LIMITES.FOTOS_POR_PRODUCTO} para poder guardar.`);
    return;
  }

  // ── OFERTA ────────────────────────────────────────────────────
  const esOferta = document.getElementById('a-es-oferta').checked;
  const precioOfertaInput = document.getElementById('a-precio-oferta').value.trim();
  if(esOferta){
    if(!precio){ alert('Para agregar el producto a Ofertas, ingresá primero el precio original.'); return; }
    if(!precioOfertaInput){ alert('Ingresá el precio final con descuento para la oferta.'); return; }
  }
  const precioOferta = (esOferta && precioOfertaInput)
    ? '$' + Number(precioOfertaInput.replace(/\D/g, '')).toLocaleString('es-AR')
    : '';

  const precioOriginal = precio;

  // "Ofertas" se agrega/quita del listado de categorías del producto
  // al final, para no pisar la categoría principal que se muestra en la card
  const tiposFinal = tiposSeleccionados.filter(t => t !== OFERTA_CAT);
  if(esOferta) tiposFinal.push(OFERTA_CAT);

  const reordenadas = [fotosBase64[portadaIdx], ...fotosBase64.filter((_,i)=>i!==portadaIdx)];

  const btnGuardar = document.querySelector('#admin-modal .btn-guardar');
  if(btnGuardar){ btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando…'; }
  const restaurarBoton = () => {
    if(btnGuardar){ btnGuardar.disabled = false; btnGuardar.textContent = 'Guardar producto'; }
  };

  try {
    await esperarAdminListo();

    // 1) Subir a Cloudinary las fotos nuevas ANTES de tocar nada en memoria.
    //    Si falla la subida, no se modifica el catálogo.
    const urls = await subirFotosPendientes(reordenadas, (n, total) => {
      mostrarToast(`Subiendo foto ${n} de ${total}…`);
    });

    // 2) Aplicar los cambios en memoria (buscando por id, no por referencia)
    let prod = productoEditando ? productos.find(x => x.id === productoEditando.id) : null;
    if(!prod){
      prod = {};
      productos.push(prod);
    }
    Object.assign(prod, {
      nombre,
      precio: precioOriginal,      // siempre el precio original (se tacha si está en oferta)
      tipo: tiposFinal[0],         // compatibilidad legacy
      tipos: tiposFinal,
      desc,
      img: urls[0],
      imgs: urls,
      enOferta: esOferta
    });
    if(esOferta){
      prod.precioOferta   = precioOferta;   // precio con descuento (se destaca)
      prod.precioOriginal = precioOriginal;
    } else {
      delete prod.precioOferta;
      delete prod.precioOriginal;
    }

    // 3) Guardar (item + índice + meta)
    mostrarToast('Guardando…');
    await guardarProductoEnFirebase(prod);
    await guardarMetaEnFirebase();

    buildAllCarousels();
    document.getElementById('admin-modal').classList.remove('active');
    productoEditando = null;
    fotosBase64 = [];
    portadaIdx = 0;
    renderFotosGrid();
    document.querySelector('.admin-modal h2').textContent = 'Nuevo producto';
    mostrarToast('Producto guardado ✓');
    setTimeout(() => scrollToSection('productos'), 300);
  } catch(err) {
    console.error('Error guardando producto:', err);
    // El modal queda abierto con los datos cargados para poder reintentar
    mostrarToastError('⚠ No se pudo guardar el producto.<br>' + esc(err && err.message ? err.message : 'Revisá la conexión a internet.') , 12000);
  } finally {
    restaurarBoton();
  }
}

function abrirModalEditar(p){
  productoEditando = p;
  document.getElementById('a-nombre').value = p.nombre;
  document.getElementById('a-precio').value = (p.precio || '').replace('$','');
  const tiposActuales = Array.isArray(p.tipos) ? p.tipos : [p.tipo];
  poblarSelectTipo(tiposActuales);
  document.getElementById('a-desc').value   = p.desc;
  const estaEnOferta = esProductoEnOferta(p);
  document.getElementById('a-es-oferta').checked = estaEnOferta;
  document.getElementById('a-precio-oferta').value = estaEnOferta ? (p.precioOferta || '').replace('$','') : '';
  document.getElementById('a-oferta-wrap').style.display = estaEnOferta ? 'block' : 'none';
  fotosBase64 = p.imgs && p.imgs.length > 0 ? [...p.imgs] : [p.img];
  portadaIdx = 0;
  renderFotosGrid();
  document.getElementById('a-foto-texto').textContent = textoFotosCargadas();
  document.querySelector('.admin-modal h2').textContent = 'Editar producto';
  document.getElementById('admin-modal').classList.add('active');
}

// ════════════════════════════════════════════════════════
//  ADMIN — Reordenar por categoría
// ════════════════════════════════════════════════════════
let ordenTemporal  = [];
let dragSrcIndex   = null;
let reorderCatActual = null;

function abrirModalReorden(){
  const select = document.getElementById('reorder-cat-select');
  select.innerHTML = '';

  getCategorias().forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });

  reorderCatActual = select.value;
  cargarOrdenTemporal();
  renderizarListaReorden();
  document.getElementById('reorder-modal').classList.add('active');
}

function cambiarCatReorden(){
  reorderCatActual = document.getElementById('reorder-cat-select').value;
  cargarOrdenTemporal();
  renderizarListaReorden();
}

function cargarOrdenTemporal(){
  ordenTemporal = reorderCatActual === '__todos__'
    ? [...productos]
    : productos.filter(p => {
        const lista = Array.isArray(p.tipos) ? p.tipos : [p.tipo];
        return lista.includes(reorderCatActual);
      });
}

function cerrarModalReorden(e){
  if(e.target.id !== 'reorder-modal') return;
  document.getElementById('reorder-modal').classList.remove('active');
}

function renderizarListaReorden(){
  const lista = document.getElementById('reorder-list');
  lista.innerHTML = '';

  ordenTemporal.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'reorder-item';
    li.draggable = true;
    li.dataset.index = i;
    li.innerHTML = `
      <span class="reorder-handle">⠿</span>
      <span class="reorder-num">${i + 1}</span>
      <img class="reorder-thumb" src="${esc(cldUrl(p.img, CLD_THUMB))}" alt="${esc(p.nombre)}" loading="lazy">
      <div class="reorder-info">
        <div class="reorder-name">${esc(p.nombre)}</div>
        <div class="reorder-tipo">${esc(Array.isArray(p.tipos) ? p.tipos.join(', ') : p.tipo)}</div>
      </div>`;

    li.addEventListener('dragstart', e => {
      dragSrcIndex = parseInt(li.dataset.index);
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      lista.querySelectorAll('.reorder-item').forEach(el => el.classList.remove('drag-over'));
    });
    li.addEventListener('dragover', e => {
      e.preventDefault();
      lista.querySelectorAll('.reorder-item').forEach(el => el.classList.remove('drag-over'));
      li.classList.add('drag-over');
    });
    li.addEventListener('drop', e => {
      e.preventDefault();
      const destIndex = parseInt(li.dataset.index);
      if(dragSrcIndex === null || dragSrcIndex === destIndex) return;
      const [moved] = ordenTemporal.splice(dragSrcIndex, 1);
      ordenTemporal.splice(destIndex, 0, moved);
      dragSrcIndex = null;
      renderizarListaReorden();
    });

    lista.appendChild(li);
  });
}

async function guardarReorden(){
  try { await esperarAdminListo(); } catch(e) { return; }

  ordenCategorias[reorderCatActual] =
    ordenTemporal.map(p => p.id);

  buildAllCarousels();

  document.getElementById('reorder-modal')
    .classList.remove('active');

  mostrarToast('Guardando orden…');
  try {
    await guardarMetaEnFirebase();
    mostrarToast('Orden guardado ✓');
  } catch(err) {
    console.error('Error guardando orden:', err);
    mostrarToastError('⚠ Error al guardar. Revisá la conexión, recargar la página.', 7000);
  }
}

// ════════════════════════════════════════════════════════
//  CARRUSEL DE CATEGORÍAS (debajo de "Nuestros productos")
//  Un círculo con imagen por categoría; al tocarlo lleva a esa categoría.
//  Imagen: la elegida en el admin (👁 Categorías) o, si no hay, la foto
//  del primer producto de la categoría.
// ════════════════════════════════════════════════════════
const CLD_CATNAV = 'f_auto,q_auto,c_fill,w_260,h_260';

function imagenDeCategoria(cat, prods){
  if(imagenesCategorias[cat]) return imagenesCategorias[cat];
  const primero = (prods || []).find(p => p.img && !productosOcultos.includes(p.id)) || (prods || []).find(p => p.img);
  return primero ? primero.img : '';
}

// lista: [{ cat, prods }] en el orden en que se muestran las categorías
function renderCatNav(lista){
  const nav = document.getElementById('cat-nav');
  const track = document.getElementById('cat-nav-track');
  if(!nav || !track) return;
  if(!lista.length){ nav.style.display = 'none'; track.innerHTML = ''; return; }
  track.innerHTML = lista.map(({ cat, prods }) => {
    const src = imagenDeCategoria(cat, prods);
    return `<button type="button" class="cat-nav-item" data-cat="${esc(cat)}" title="Ver ${esc(cat)}">
      <span class="cat-nav-circulo">${src ? `<img src="${esc(cldUrl(src, CLD_CATNAV))}" alt="" loading="lazy" decoding="async" draggable="false">` : ''}</span>
      <span class="cat-nav-nombre">${esc(cat)}</span>
    </button>`;
  }).join('');
  track.querySelectorAll('.cat-nav-item').forEach(b => {
    b.addEventListener('click', () => irACategoria(b.dataset.cat));
  });
  nav.style.display = '';
  actualizarFlechasCatNav();
}

// Flechas solo cuando las categorías no entran en el ancho (en compu)
function actualizarFlechasCatNav(){
  const scroll = document.getElementById('cat-nav-scroll');
  const nav = document.getElementById('cat-nav');
  if(!scroll || !nav) return;
  const desborda = scroll.scrollWidth > scroll.clientWidth + 2;
  nav.classList.toggle('desborda', desborda);
  // margen de 10 px: el "imán" del desplazamiento puede dejarlo corrido unos píxeles
  nav.classList.toggle('al-inicio', scroll.scrollLeft <= 10);
  nav.classList.toggle('al-final', scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 10);
}

function moverCatNav(dir){
  const scroll = document.getElementById('cat-nav-scroll');
  if(!scroll) return;
  const inicio = scroll.scrollLeft;
  const destino = Math.max(0, Math.min(scroll.scrollWidth - scroll.clientWidth, inicio + dir * scroll.clientWidth * 0.8));
  scroll.scrollTo({ left: destino, behavior: 'smooth' });
  // Respaldo: si el navegador no animó, se mueve directo
  setTimeout(() => {
    if(Math.abs(scroll.scrollLeft - inicio) < 5) scroll.scrollLeft = destino;
    actualizarFlechasCatNav();
  }, 450);
}

document.addEventListener('DOMContentLoaded', () => {
  const scroll = document.getElementById('cat-nav-scroll');
  if(scroll) scroll.addEventListener('scroll', actualizarFlechasCatNav, { passive: true });
  window.addEventListener('resize', actualizarFlechasCatNav);
});

// ── Admin: imagen de cada categoría (en el modal 👁 Categorías) ──
// Se suben a Cloudinary recién al tocar "Guardar".
let catImgPendientes = {};   // { cat: base64 }
let catImgQuitar = new Set(); // categorías que vuelven a usar la foto del primer producto

function elegirImagenCategoria(cat){
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.onchange = () => {
    const file = input.files[0];
    if(!file) return;
    const err = validarArchivoFoto(file);
    if(err){ alert(err); return; }
    // 600 px alcanza de sobra para un círculo; PNG/WEBP conservan la transparencia
    const transparente = file.type === 'image/png' || file.type === 'image/webp';
    leerImagenEnCanvas(file, 600, (canvas, img) => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      catImgPendientes[cat] = transparente ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.88);
      catImgQuitar.delete(cat);
      renderCatToggles();
    });
  };
  input.click();
}

function quitarImagenCategoria(cat){
  delete catImgPendientes[cat];
  catImgQuitar.add(cat);
  renderCatToggles();
}

// Miniatura que se ve en el modal para una categoría
function miniaturaCategoriaAdmin(cat){
  if(catImgPendientes[cat]) return { src: catImgPendientes[cat], propia: true, nueva: true };
  if(!catImgQuitar.has(cat) && imagenesCategorias[cat]) return { src: cldUrl(imagenesCategorias[cat], CLD_CATNAV), propia: true };
  const prods = productos.filter(p => (Array.isArray(p.tipos) ? p.tipos : [p.tipo]).includes(cat));
  const src = (prods.find(p => p.img && !productosOcultos.includes(p.id)) || prods.find(p => p.img) || {}).img;
  return { src: src ? cldUrl(src, CLD_CATNAV) : '', propia: false };
}

// Sube las imágenes elegidas y aplica los cambios (se llama al guardar)
async function aplicarImagenesCategorias(){
  const cats = Object.keys(catImgPendientes);
  for(let i = 0; i < cats.length; i++){
    mostrarToast(`Subiendo imagen de categoría ${i + 1} de ${cats.length}…`);
    imagenesCategorias[cats[i]] = await subirImagenCloudinary(catImgPendientes[cats[i]]);
  }
  catImgQuitar.forEach(cat => { delete imagenesCategorias[cat]; });
  catImgPendientes = {};
  catImgQuitar = new Set();
}

// ════════════════════════════════════════════════════════
//  ADMIN — Visibilidad de categorías
// ════════════════════════════════════════════════════════
function abrirModalCategorias(){
  catImgPendientes = {};
  catImgQuitar = new Set();
  renderCatToggles();
  document.getElementById('cat-modal').classList.add('active');
}

function cerrarModalCategorias(e){
  if(e.target.id !== 'cat-modal') return;
  document.getElementById('cat-modal').classList.remove('active');
}

let catDragSrc = null;

function renderCatToggles(){
  const list = document.getElementById('cat-toggle-list');
  list.innerHTML = '';
  const cats = getCategorias();
  cats.forEach((cat, idx) => {
    const count = productos.filter(p => {
      const lista = Array.isArray(p.tipos) ? p.tipos : [p.tipo];
      return lista.includes(cat);
    }).length;
    const visible = !categoriasOcultas.includes(cat);
    const mini = miniaturaCategoriaAdmin(cat);
    const item = document.createElement('div');
    item.className = 'cat-toggle-item';
    item.draggable = true;
    item.dataset.cat = cat;
    item.dataset.index = idx;
    item.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
        <span class="cat-drag-handle" title="Arrastrá para reordenar">⠿</span>
        <button type="button" class="cat-img-btn${mini.nueva ? ' nueva' : ''}" title="Cambiar la imagen de la categoría">
          ${mini.src ? `<img src="${esc(mini.src)}" alt="" draggable="false">` : '<span>+</span>'}
        </button>
        <div style="min-width:0">
          <div class="cat-toggle-name">${esc(cat)}</div>
          <div class="cat-toggle-count">${count} producto${count !== 1 ? 's' : ''}</div>
          <div class="cat-img-estado">${mini.propia ? (mini.nueva ? 'Imagen nueva (se sube al guardar)' : 'Imagen propia') + ' · <a href="#" class="cat-img-quitar">usar la del primer producto</a>' : 'Imagen del primer producto · tocá para cambiarla'}</div>
        </div>
      </div>
      <div class="cat-toggle-actions">
        <button class="btn-cat-delete" title="Eliminar categoría y sus productos">×</button>
        <label class="toggle-switch">
          <input type="checkbox" data-cat="${esc(cat)}" ${visible ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>`;

    item.querySelector('.btn-cat-delete').addEventListener('click', () => eliminarCategoria(cat));
    item.querySelector('.cat-img-btn').addEventListener('click', () => elegirImagenCategoria(cat));
    const linkQuitar = item.querySelector('.cat-img-quitar');
    if(linkQuitar) linkQuitar.addEventListener('click', e => { e.preventDefault(); quitarImagenCategoria(cat); });

    item.addEventListener('dragstart', e => {
      catDragSrc = idx;
      item.classList.add('cat-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('cat-dragging');
      list.querySelectorAll('.cat-toggle-item').forEach(el => el.classList.remove('cat-drag-over'));
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      list.querySelectorAll('.cat-toggle-item').forEach(el => el.classList.remove('cat-drag-over'));
      item.classList.add('cat-drag-over');
    });
    item.addEventListener('drop', e => {
      e.preventDefault();
      const destIdx = parseInt(item.dataset.index);
      if(catDragSrc === null || catDragSrc === destIdx) return;
      const currentCats = getCategorias();
      const [moved] = currentCats.splice(catDragSrc, 1);
      currentCats.splice(destIdx, 0, moved);
      categoriaOrden = currentCats;
      catDragSrc = null;
      renderCatToggles();
    });

    list.appendChild(item);
  });
}

async function guardarCategorias(){
  try { await esperarAdminListo(); } catch(e) { return; }
  // Primero se suben las imágenes nuevas de categorías: si falla, no se guarda nada
  try {
    await aplicarImagenesCategorias();
  } catch(err) {
    console.error('Error subiendo imágenes de categorías:', err);
    mostrarToastError('⚠ No se pudo subir la imagen.<br>' + esc(err && err.message ? err.message : 'Revisá la conexión.'), 8000);
    return;
  }
  const checkboxes = document.querySelectorAll('#cat-toggle-list input[type=checkbox]');
  categoriasOcultas = [];
  checkboxes.forEach(cb => {
    if(!cb.checked) categoriasOcultas.push(cb.dataset.cat);
  });
  buildAllCarousels();
  document.getElementById('cat-modal').classList.remove('active');
  mostrarToast('Guardando…');
  try {
    await guardarMetaEnFirebase();
    mostrarToast('Categorías actualizadas ✓');
  } catch(err) {
    console.error('Error guardando categorías:', err);
    mostrarToastError('⚠ Error al guardar. Revisá la conexión, recargar la página.', 7000);
  }
}

async function eliminarCategoria(cat){
  const tiposDe = p => Array.isArray(p.tipos) ? p.tipos : (p.tipo ? [p.tipo] : []);
  // Se borran los productos cuya ÚNICA categoría es esta; a los que tienen
  // varias solo se les quita esta categoría.
  const aBorrar     = productos.filter(p => { const l = tiposDe(p); return l.includes(cat) && l.length <= 1; });
  const aActualizar = productos.filter(p => { const l = tiposDe(p); return l.includes(cat) && l.length > 1; });

  const partes = [];
  if(aBorrar.length) partes.push(`se eliminarán ${aBorrar.length} producto${aBorrar.length !== 1 ? 's' : ''} que solo están en esta categoría`);
  if(aActualizar.length) partes.push(`${aActualizar.length} producto${aActualizar.length !== 1 ? 's' : ''} con otras categorías se conservan`);
  const msg = `¿Eliminar la categoría "${cat}"?` + (partes.length ? `

${partes.join(' y ')}.
Esta acción no se puede deshacer.` : '');
  if(!confirm(msg)) return;

  mostrarToast('Guardando…');
  try {
    await esperarAdminListo();
    // Recalcular sobre el catálogo sincronizado (por si cambió al sincronizar)
    const idsBorrar = new Set(productos.filter(p => { const l = tiposDe(p); return l.includes(cat) && l.length <= 1; }).map(p => p.id));
    const ops = [];
    productos = productos.filter(p => {
      if(idsBorrar.has(p.id)){
        ops.push({ tipo: 'delete', ref: PRODS_COL.doc(p.id) });
        return false;
      }
      return true;
    });
    productos.forEach(p => {
      const l = tiposDe(p);
      if(!l.includes(cat)) return;
      p.tipos = l.filter(c => c !== cat);
      p.tipo  = p.tipos[0];
      if(cat === OFERTA_CAT){ p.enOferta = false; delete p.precioOferta; delete p.precioOriginal; }
      ops.push({ tipo: 'set', ref: PRODS_COL.doc(p.id), data: productoParaIndice(p) });
    });

    // Limpiar todas las referencias a la categoría y a los productos borrados
    categoriasOcultas = categoriasOcultas.filter(c => c !== cat);
    categoriaOrden    = categoriaOrden.filter(c => c !== cat);
    delete ordenCategorias[cat];
    productosOcultos  = productosOcultos.filter(id => !idsBorrar.has(id));

    renderCatToggles();
    buildAllCarousels();
    await commitCambios(ops);
    await guardarMetaEnFirebase();
    mostrarToast('Categoría eliminada ✓');
  } catch(err) {
    console.error('Error eliminando categoría:', err);
    mostrarToastError('⚠ Error al eliminar. Revisá la conexión y recargá la página.', 7000);
  }
}

// ════════════════════════════════════════════════════════
//  ADMIN — Editar contenido de la página
// ════════════════════════════════════════════════════════

// Referencia a la config editable (persiste en Firebase)
const CONFIG_REF = REFS.config;
const MARQUEE_REF = REFS.marquee;

// Imagen nosotros pendiente de guardar (base64)
let nosotrosImgPendiente = null;
let nosotrosUsarOriginal = false;   // true = volver a la imagen de index.html
// Imagen del logo del hero pendiente de guardar (base64)
let heroLogoImgPendiente = null;
let navLogoImgPendiente = null;

function cargarHeroLogo(e){
  const file = e.target.files[0];
  if(!file) return;
  comprimirImagenPNG(file, base64 => {
    heroLogoImgPendiente = base64;
    document.getElementById('ep-hero-logo-thumb').src = base64;
    document.getElementById('ep-hero-logo-preview').style.display = 'block';
    document.getElementById('ep-hero-logo-texto').textContent = 'Imagen cargada — clic para cambiar';
    const actualEl = document.getElementById('ep-hero-logo-actual');
    if(actualEl) actualEl.style.display = 'none';
  });
  e.target.value = '';
}

function cargarNavLogo(e){
  const file = e.target.files[0];
  if(!file) return;
  comprimirImagenPNG(file, base64 => { // Usa PNG para preservar la transparencia
    navLogoImgPendiente = base64;
    document.getElementById('ep-nav-logo-thumb').src = base64;
    document.getElementById('ep-nav-logo-preview').style.display = 'block';
    document.getElementById('ep-nav-logo-texto').textContent = 'Imagen cargada — clic para cambiar';
    const actualEl = document.getElementById('ep-nav-logo-actual');
    if(actualEl) actualEl.style.display = 'none';
  });
  e.target.value = '';
}

async function cargarConfigEditable(){
  try {
    const snap = await CONFIG_REF.get({ source: 'server' });
    if(snap.exists){
      const data = snap.data();
      // Mezclar sobre SITE_CONFIG
      if(data.rubro)            SITE_CONFIG.rubro           = data.rubro;
      if(data.ubicacion)        SITE_CONFIG.ubicacion        = data.ubicacion;
      if(data.heroSubtitulo)    SITE_CONFIG.heroSubtitulo    = data.heroSubtitulo;
      if(data.nosotros)         SITE_CONFIG.nosotros         = { ...SITE_CONFIG.nosotros, ...data.nosotros };
      if(data.whatsapp)         SITE_CONFIG.whatsapp         = data.whatsapp;
      if(data.instagram)        SITE_CONFIG.instagram        = data.instagram;
      if(data.contacto)         SITE_CONFIG.contacto         = { ...SITE_CONFIG.contacto, ...data.contacto };
      if(data.nosotrosImg)      SITE_CONFIG._nosotrosImg     = data.nosotrosImg;
      if(data.heroLogoImg)      SITE_CONFIG._heroLogoImg     = data.heroLogoImg;
      if(data.navLogoImg)       SITE_CONFIG._navLogoImg      = data.navLogoImg;
      SITE_CONFIG._videosInicio = Array.isArray(data.videosInicio) ? data.videosInicio : [];
      SITE_CONFIG._imagenesInicio = Array.isArray(data.imagenesInicio) ? data.imagenesInicio : [];
      return data;
    }
  } catch(err){
    console.warn('No se pudo cargar configEditable:', err);
  }
}

function abrirModalEditarPagina(){
  const C = SITE_CONFIG;
  // ── Hero logo image ───────────────────────────────
  heroLogoImgPendiente = null;
  const heroLogoPreview = document.getElementById('ep-hero-logo-preview');
  const heroLogoActual  = document.getElementById('ep-hero-logo-actual');
  if(heroLogoPreview) heroLogoPreview.style.display = 'none';
  if(C._heroLogoImg && heroLogoActual){
    heroLogoActual.style.display = 'block';
    document.getElementById('ep-hero-logo-actual-img').src = cldUrl(C._heroLogoImg, CLD_LOGO);
    document.getElementById('ep-hero-logo-texto').textContent = 'Clic para cambiar la imagen del título';
  } else if(heroLogoActual){
    heroLogoActual.style.display = 'none';
    document.getElementById('ep-hero-logo-texto').textContent = 'Hacé clic para subir la imagen del título';
  }

  // ── Nav logo image ────────────────────────────────
  navLogoImgPendiente = null;
  const navLogoPreview = document.getElementById('ep-nav-logo-preview');
  const navLogoActual  = document.getElementById('ep-nav-logo-actual');
  if(navLogoPreview) navLogoPreview.style.display = 'none';
  const navActualSrc = C._navLogoImg || C.navLogoImgDefault;
  if(navActualSrc && navLogoActual){
    navLogoActual.style.display = 'block';
    document.getElementById('ep-nav-logo-actual-img').src = cldUrl(navActualSrc, CLD_LOGO);
    document.getElementById('ep-nav-logo-texto').textContent = 'Clic para cambiar la imagen del NAV';
  } else if(navLogoActual){
    navLogoActual.style.display = 'none';
    document.getElementById('ep-nav-logo-texto').textContent = 'Hacé clic para subir la imagen del NAV';
  }

  // Rellenar campos Hero
  document.getElementById('ep-rubro').value          = C.rubro || '';
  document.getElementById('ep-ubicacion').value      = C.ubicacion || '';
  // Convertir <br> en salto para textarea
  document.getElementById('ep-hero-subtitulo').value = desEscapar((C.heroSubtitulo || '').replace(/<br\s*\/?>/gi, '\n'));

  // Imagen nosotros
  nosotrosImgPendiente = null;
  nosotrosUsarOriginal = false;
  const preview = document.getElementById('ep-nosotros-img-preview');
  const thumb   = document.getElementById('ep-nosotros-img-thumb');
  if(C._nosotrosImg){
    thumb.src = cldUrl(C._nosotrosImg, CLD_LOGO);
    preview.style.display = 'block';
    document.getElementById('ep-nosotros-img-texto').textContent = 'Imagen cargada — clic para cambiar';
  } else {
    preview.style.display = 'none';
    document.getElementById('ep-nosotros-img-texto').textContent = 'Hacé clic para cambiar la imagen';
  }

  // Rellenar campos Nosotros
  document.getElementById('ep-nos-label').value    = C.nosotros.label  || '';
  document.getElementById('ep-nos-titulo').value   = C.nosotros.titulo || '';
  const ps = C.nosotros.parrafos || ['','',''];
  // Strip tags for editing
  document.getElementById('ep-nos-p1').value = desEscapar((ps[0]||'').replace(/<[^>]+>/g,''));
  document.getElementById('ep-nos-p2').value = desEscapar((ps[1]||'').replace(/<[^>]+>/g,''));
  document.getElementById('ep-nos-p3').value = desEscapar((ps[2]||'').replace(/<[^>]+>/g,''));

  document.getElementById('edit-nosotros-slogan').value = C.nosotros.slogan || '';

  const stats = C.nosotros.stats || [{num:'',label:''},{num:'',label:''}];
  document.getElementById('ep-stat1-num').value   = (stats[0]||{}).num   || '';
  document.getElementById('ep-stat1-label').value = (stats[0]||{}).label || '';
  document.getElementById('ep-stat2-num').value   = (stats[1]||{}).num   || '';
  document.getElementById('ep-stat2-label').value = (stats[1]||{}).label || '';

  // Rellenar campos Contacto
  document.getElementById('ep-whatsapp').value          = C.whatsapp || '';
  document.getElementById('ep-wa-display').value        = C.contacto.waDisplay || '';
  document.getElementById('ep-wa-texto').value          = C.contacto.waTexto || '';
  document.getElementById('ep-wa-texto-producto').value = C.contacto.waTextoProducto || '';
  document.getElementById('ep-instagram').value         = C.instagram || '';
  document.getElementById('ep-contacto-label').value    = C.contacto.label || '';
  document.getElementById('ep-contacto-titulo').value   = C.contacto.titulo || '';
  document.getElementById('ep-cta-titulo').value        = C.contacto.ctaTitulo || '';
  document.getElementById('ep-cta-parrafo').value       = C.contacto.ctaParrafo || '';
  document.getElementById('ep-cta-boton').value         = C.contacto.ctaBoton || '';

  // Videos e imágenes de la página principal
  videosEditando = normalizarVideos(C._videosInicio);
  imagenesEditando = normalizarImagenes(C._imagenesInicio);
  renderListaVideosEP();

  // Mostrar tab inicial
  cambiarTabEP('hero');
  document.getElementById('edit-pagina-modal').classList.add('active');
}

function cerrarModalEditarPagina(e){
  if(e.target.id !== 'edit-pagina-modal') return;
  document.getElementById('edit-pagina-modal').classList.remove('active');
}

function cambiarTabEP(tab){
  document.querySelectorAll('.ep-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.ep-panel').forEach(p => p.style.display = 'none');
  document.getElementById('ep-panel-' + tab).style.display = 'block';
}

// "Usar la imagen original": borra la imagen subida y vuelve a la de index.html (img/logo.png)
function usarImagenNosotrosOriginal(){
  nosotrosImgPendiente = null;
  nosotrosUsarOriginal = true;
  const original = document.querySelector('.about-img-placeholder img');
  document.getElementById('ep-nosotros-img-thumb').src = (original && original.dataset.srcOriginal) || 'img/logo.png';
  document.getElementById('ep-nosotros-img-preview').style.display = 'block';
  document.getElementById('ep-nosotros-img-texto').textContent = 'Se va a usar la imagen original — clic para subir otra';
}

function cargarImagenNosotros(e){
  const file = e.target.files[0];
  if(!file) return;
  // PNG (no JPEG): conserva la transparencia del logo. Con JPEG el fondo
  // transparente se volvía negro.
  comprimirImagenPNG(file, base64 => {
    nosotrosImgPendiente = base64;
    nosotrosUsarOriginal = false;
    document.getElementById('ep-nosotros-img-thumb').src = base64;
    document.getElementById('ep-nosotros-img-preview').style.display = 'block';
    document.getElementById('ep-nosotros-img-texto').textContent = 'Imagen cargada — clic para cambiar';
  });
  e.target.value = '';
}

async function guardarEditarPagina(){
  const C = SITE_CONFIG;
  const btnGuardar = document.querySelector('#edit-pagina-modal .btn-guardar');
  if(btnGuardar){ btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando…'; }

  try {
    // ── 1) Subir primero las imágenes nuevas. Si falla, no se guarda nada ──
    const pendientes = [
      ['nosotros', nosotrosImgPendiente],
      ['hero',     heroLogoImgPendiente],
      ['nav',      navLogoImgPendiente]
    ].filter(([, v]) => v);
    const subidas = {};
    for(let i = 0; i < pendientes.length; i++){
      mostrarToast(`Subiendo imagen ${i + 1} de ${pendientes.length}…`);
      subidas[pendientes[i][0]] = await subirImagenCloudinary(pendientes[i][1]);
    }

    // Videos nuevos (máx 3 en total, cada uno controlado contra el límite)
    if(videosEditando.length > LIMITES.VIDEOS_INICIO){
      throw new Error(`Solo se permiten ${LIMITES.VIDEOS_INICIO} videos en la página principal.`);
    }
    if(videosEditando.filter(v => v.auto).length > LIMITES.VIDEOS_AUTO){
      throw new Error('Solo 1 video puede reproducirse automáticamente (cuota del plan gratuito).');
    }
    const videosNuevos = videosEditando.filter(v => v.file);
    let nVideo = 0;
    for(const v of videosEditando){
      if(!v.file) continue;
      nVideo++;
      v.url = await subirVideoCloudinary(v.file, pct => {
        mostrarToast(`Subiendo video ${nVideo} de ${videosNuevos.length}… ${pct}%`);
      });
      URL.revokeObjectURL(v.preview);
      delete v.file; delete v.preview;
    }
    const videosFinal = videosEditando
      .filter(v => v.url)
      .map(v => ({ url: v.url, pos: v.pos, auto: !!v.auto, orden: v.orden ?? 0 }));

    // Imágenes decorativas nuevas (máx 5, ya comprimidas bajo el límite del plan)
    if(imagenesEditando.length > LIMITES.IMAGENES_DECO){
      throw new Error(`Solo se permiten ${LIMITES.IMAGENES_DECO} imágenes decorativas.`);
    }
    const imgsNuevas = imagenesEditando.filter(v => v.b64);
    let nImg = 0;
    for(const v of imagenesEditando){
      if(!v.b64) continue;
      nImg++;
      mostrarToast(`Subiendo imagen decorativa ${nImg} de ${imgsNuevas.length}…`);
      v.url = await subirImagenCloudinary(v.b64);
      delete v.b64;
    }
    const imagenesFinal = imagenesEditando
      .filter(v => v.url)
      .map(v => {
        const o = { url: v.url, pos: v.pos, orden: v.orden ?? 0 };
        if(v.w > 0 && v.h > 0){ o.w = v.w; o.h = v.h; }
        return o;
      });

    // ── 2) Leer valores ──────────────────────────────────
    C.rubro      = document.getElementById('ep-rubro').value.trim();
    C.ubicacion  = document.getElementById('ep-ubicacion').value.trim();
    // Textarea usa \n, HTML usa <br>. Se escapa el texto (se inserta con innerHTML).
    C.heroSubtitulo = esc(document.getElementById('ep-hero-subtitulo').value.trim()).replace(/\n/g,'<br>');

    C.nosotros.label  = document.getElementById('ep-nos-label').value.trim();
    C.nosotros.titulo = document.getElementById('ep-nos-titulo').value.trim();
    C.nosotros.parrafos = [
      document.getElementById('ep-nos-p1').value.trim(),
      document.getElementById('ep-nos-p2').value.trim(),
      document.getElementById('ep-nos-p3').value.trim()
    ].filter(p => p !== '').map(esc);
    C.nosotros.slogan = document.getElementById('edit-nosotros-slogan').value.trim();
    C.nosotros.stats = [
      { num: document.getElementById('ep-stat1-num').value.trim(), label: document.getElementById('ep-stat1-label').value.trim() },
      { num: document.getElementById('ep-stat2-num').value.trim(), label: document.getElementById('ep-stat2-label').value.trim() }
    ];

    C.whatsapp  = document.getElementById('ep-whatsapp').value.trim().replace(/\D/g,'');
    C.instagram = document.getElementById('ep-instagram').value.trim().replace(/^@/,'');
    C.contacto.waDisplay       = document.getElementById('ep-wa-display').value.trim();
    C.contacto.waTexto         = document.getElementById('ep-wa-texto').value.trim();
    C.contacto.waTextoProducto = document.getElementById('ep-wa-texto-producto').value.trim();
    C.contacto.label           = document.getElementById('ep-contacto-label').value.trim();
    C.contacto.titulo          = document.getElementById('ep-contacto-titulo').value.trim();
    C.contacto.ctaTitulo       = document.getElementById('ep-cta-titulo').value.trim();
    C.contacto.ctaParrafo      = document.getElementById('ep-cta-parrafo').value.trim();
    C.contacto.ctaBoton        = document.getElementById('ep-cta-boton').value.trim();

    if(subidas.nosotros) C._nosotrosImg = subidas.nosotros;
    else if(nosotrosUsarOriginal) C._nosotrosImg = null;
    if(subidas.hero)     C._heroLogoImg = subidas.hero;
    if(subidas.nav)      C._navLogoImg  = subidas.nav;
    C._videosInicio = videosFinal;
    C._imagenesInicio = imagenesFinal;

    // ── 3) Persistir en Firebase ──────────────────────────
    mostrarToast('Guardando…');
    const ts = Date.now();
    const data = {
      rubro:        C.rubro,
      ubicacion:    C.ubicacion,
      heroSubtitulo:C.heroSubtitulo,
      nosotros:     C.nosotros,
      whatsapp:     C.whatsapp,
      instagram:    C.instagram,
      contacto:     C.contacto,
      nosotrosImg:  C._nosotrosImg || null,
      heroLogoImg:  C._heroLogoImg || null,
      navLogoImg:   C._navLogoImg  || null,
      videosInicio: C._videosInicio || [],
      imagenesInicio: C._imagenesInicio || []
    };
    await CONFIG_REF.set(data);
    // Invalidar caché de otros dispositivos
    await META_REF.set({ lastModified: ts }, { merge: true });
    try {
      localStorage.setItem(LS('cache_ts'), String(ts));
      localStorage.setItem(LS('config_cache'), JSON.stringify(data));
    } catch(e) {}

    // ── 4) Aplicar en vivo a la página (incluye logos e imagen de Nosotros) ──
    applyConfig();
    nosotrosImgPendiente = heroLogoImgPendiente = navLogoImgPendiente = null;
    nosotrosUsarOriginal = false;
    document.getElementById('edit-pagina-modal').classList.remove('active');
    mostrarToast('Cambios guardados ✓');
  } catch(err){
    console.error('Error guardando configEditable:', err);
    mostrarToastError('⚠ No se pudieron guardar los cambios.<br>' + esc(err && err.message ? err.message : 'Revisá la conexión.'), 10000);
  } finally {
    if(btnGuardar){ btnGuardar.disabled = false; btnGuardar.textContent = 'Guardar cambios'; }
  }
}

// ════════════════════════════════════════════════════════
//  VIDEOS (máx 3) e IMÁGENES DECORATIVAS (máx 5) de la página principal.
//  Solo acá — nunca en los productos. Cada elemento tiene su posición:
//  entre secciones o entre categorías de productos ("cat:<nombre>").
//  "orden" define el orden cuando hay varios en el mismo lugar.
// ════════════════════════════════════════════════════════
const POSICIONES_VIDEO = [
  { id: 'hero',      label: 'Después del título (antes de Nosotros)' },
  { id: 'nosotros',  label: 'Después de Nosotros (antes de Productos)' },
  { id: 'productos', label: 'Después de Productos (antes de Contacto)' },
  { id: 'final',     label: 'Al final de la página' }
];
const POS_VIDEO_DEFAULT = 'nosotros';
const POS_FIJAS = POSICIONES_VIDEO.map(p => p.id);

// Categorías que hoy se muestran en la página (en orden). Lo llena buildAllCarousels.
let categoriasEnPagina = [];
let carruselesConstruidos = false;   // hasta que no estén, lo que va entre categorías no se muestra

function posValida(pos){
  return typeof pos === 'string' && (POS_FIJAS.includes(pos) || (pos.startsWith('cat:') && pos.length > 4));
}

// Acepta el formato viejo (lista de URLs) y el nuevo ({url, pos, auto, orden})
function normalizarVideos(lista){
  if(!Array.isArray(lista)) return [];
  return lista.map((v, i) => {
    if(typeof v === 'string') v = { url: v, pos: POS_VIDEO_DEFAULT, auto: true };
    if(!v || typeof v.url !== 'string') return null;
    return {
      url: v.url,
      pos: posValida(v.pos) ? v.pos : POS_VIDEO_DEFAULT,
      auto: !!v.auto,
      orden: typeof v.orden === 'number' ? v.orden : i
    };
  }).filter(Boolean).map((v, i, arr) => {
    // Nunca más de LIMITES.VIDEOS_AUTO automáticos (los extra pasan a "tocar para ver")
    const autosAntes = arr.slice(0, i).filter(x => x.auto).length;
    return v.auto && autosAntes >= LIMITES.VIDEOS_AUTO ? { ...v, auto: false } : v;
  }).slice(0, LIMITES.VIDEOS_INICIO);
}

function normalizarImagenes(lista){
  if(!Array.isArray(lista)) return [];
  return lista.map((v, i) => {
    if(!v || typeof v.url !== 'string') return null;
    const out = {
      url: v.url,
      pos: posValida(v.pos) ? v.pos : POS_VIDEO_DEFAULT,
      orden: typeof v.orden === 'number' ? v.orden : 100 + i
    };
    // Ancho/alto originales: sirven para reservar el lugar antes de que cargue
    if(v.w > 0 && v.h > 0){ out.w = Math.round(v.w); out.h = Math.round(v.h); }
    return out;
  }).filter(Boolean).slice(0, LIMITES.IMAGENES_DECO);
}

// Versión liviana del video para los visitantes (720 px, calidad "eco", MP4 H.264).
// Se genera una sola vez en Cloudinary y después queda guardada.
const CLD_VIDEO        = 'c_limit,w_720,q_auto:eco,vc_h264';
const CLD_VIDEO_POSTER = 'so_1,c_limit,w_720,q_auto';
function cldVideoUrl(src, transf, ext){
  if(typeof src !== 'string' || !src.includes('res.cloudinary.com') || !src.includes('/video/upload/')) return src;
  let out = src.replace('/upload/', `/upload/${transf}/`);
  if(ext) out = out.replace(/\.[a-z0-9]+(\?.*)?$/i, '.' + ext);
  return out;
}
// Imágenes decorativas: 800 px en celular, 1400 px en compu
const CLD_DECO_CEL  = 'f_auto,q_auto,c_limit,w_800';
const CLD_DECO_PC   = 'f_auto,q_auto,c_limit,w_1400';
const CLD_DECO_MINI = 'f_auto,q_auto,c_fill,w_200,h_200';

// ── Estado del panel "Editar página" ──
// Video:  { url, pos, auto, orden } (subido) o { file, preview, pos, auto, orden } (pendiente)
// Imagen: { url, pos, orden } (subida)      o { b64, pos, orden } (pendiente)
let videosEditando = [];
let imagenesEditando = [];

function siguienteOrden(){
  const todos = [...videosEditando, ...imagenesEditando].map(x => x.orden).filter(n => typeof n === 'number');
  return todos.length ? Math.max(...todos) + 1 : 0;
}

function agregarVideoInicio(e){
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  if(videosEditando.length >= LIMITES.VIDEOS_INICIO){
    alert(`Ya hay ${LIMITES.VIDEOS_INICIO} videos. Eliminá uno para agregar otro.`);
    return;
  }
  const err = validarArchivoVideo(file);
  if(err){ alert(err); return; }
  if(file.size > LIMITES.VIDEO_AVISO_BYTES &&
     !confirm(`El video pesa ${formatoMB(file.size)}. Se puede subir, pero conviene que sea corto y liviano (menos de ${formatoMB(LIMITES.VIDEO_AVISO_BYTES)}).\n\n¿Subirlo igual?`)){
    return;
  }
  // Por defecto: "tocar para ver" (es lo que menos gasta del plan)
  videosEditando.push({ file, preview: URL.createObjectURL(file), pos: POS_VIDEO_DEFAULT, auto: false, orden: siguienteOrden() });
  renderListaVideosEP();
}

function quitarVideoInicio(i){
  const v = videosEditando[i];
  if(v && v.preview) URL.revokeObjectURL(v.preview);
  videosEditando.splice(i, 1);
  renderListaVideosEP();
}

function cambiarAutoVideo(i, auto){
  if(!videosEditando[i]) return;
  const yaAuto = videosEditando.filter((v, k) => k !== i && v.auto).length;
  if(auto && yaAuto >= LIMITES.VIDEOS_AUTO){
    alert('Solo 1 video puede reproducirse automáticamente.\n\nPor la cuota del plan gratuito (Cloudinary, donde se alojan los videos), no se pueden poner 2 o más videos automáticos. Desmarcá "Reproducir solo" en el otro video si querés cambiarlo.');
    renderListaVideosEP();
    return;
  }
  videosEditando[i].auto = auto;
  renderListaVideosEP();
}

// Comprime una imagen decorativa: lado máx 1600 px. PNG/WEBP conservan la
// transparencia; el resto va como JPEG. Siempre queda bajo el límite del plan.
function comprimirImagenDeco(file, callback, onError){
  const conTransparencia = file.type === 'image/png' || file.type === 'image/webp';
  leerImagenEnCanvas(file, 1600, (canvas, img) => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let out;
    if(conTransparencia){
      out = canvas.toDataURL('image/png');
      if(tamanoArchivo(out) > LIMITES.IMG_MAX_BYTES) out = canvas.toDataURL('image/webp', 0.9);
    } else {
      let q = 0.85;
      out = canvas.toDataURL('image/jpeg', q);
      while(tamanoArchivo(out) > LIMITES.IMG_MAX_BYTES && q > 0.4){ q -= 0.1; out = canvas.toDataURL('image/jpeg', q); }
    }
    callback(out, canvas.width, canvas.height);
  }, onError);
}

function agregarImagenDeco(e){
  let files = Array.from(e.target.files);
  e.target.value = '';
  if(!files.length) return;
  const errores = [];
  files = files.filter(f => { const err = validarArchivoFoto(f); if(err) errores.push(err); return !err; });
  const lugares = LIMITES.IMAGENES_DECO - imagenesEditando.length;
  if(lugares <= 0){
    alert(`Ya hay ${LIMITES.IMAGENES_DECO} imágenes. Eliminá una para agregar otra.`);
    return;
  }
  if(files.length > lugares){
    errores.push(`Se pueden poner hasta ${LIMITES.IMAGENES_DECO} imágenes: se agregaron solo ${lugares} de las ${files.length} elegidas.`);
    files = files.slice(0, lugares);
  }
  if(errores.length) alert(errores.join('\n\n'));
  files.forEach(file => {
    comprimirImagenDeco(file, (b64, w, h) => {
      if(imagenesEditando.length >= LIMITES.IMAGENES_DECO) return;
      imagenesEditando.push({ b64, w, h, pos: POS_VIDEO_DEFAULT, orden: siguienteOrden() });
      renderListaVideosEP();
    });
  });
}

function quitarImagenDeco(i){
  imagenesEditando.splice(i, 1);
  renderListaVideosEP();
}

// Número fijo de cada elemento ("Video 1", "Imagen 2") para que no cambie al moverlo
function asignarNumerosVideos(lista){
  const usados = new Set(lista.filter(v => v.num).map(v => v.num));
  lista.forEach(v => {
    if(v.num) return;
    let n = 1;
    while(usados.has(n)) n++;
    v.num = n;
    usados.add(n);
  });
  return lista;
}

function etiquetaPosVideo(pos){
  const p = POSICIONES_VIDEO.find(x => x.id === pos);
  if(p) return p.label;
  if(typeof pos === 'string' && pos.startsWith('cat:')){
    const cat = pos.slice(4);
    return categoriasEnPagina.includes(cat)
      ? `Después de la categoría «${cat}»`
      : `Categoría «${cat}» (no visible: se muestra después de Productos)`;
  }
  return '';
}

function miniaturaVideo(v){
  return v.file
    ? `<video src="${esc(v.preview)}" muted playsinline preload="metadata"></video>`
    : `<img src="${esc(cldVideoUrl(v.url, CLD_VIDEO_POSTER, 'jpg'))}" alt="" draggable="false">`;
}
function miniaturaImagen(v){
  return `<img src="${esc(v.b64 || cldUrl(v.url, CLD_DECO_MINI))}" alt="" draggable="false">`;
}

// Lista de videos + lista de imágenes del panel
function renderListaVideosEP(){
  const lista = document.getElementById('ep-videos-lista');
  if(!lista) return;
  asignarNumerosVideos(videosEditando);
  asignarNumerosVideos(imagenesEditando);
  const n = videosEditando.length;
  const hayAuto = videosEditando.filter(v => v.auto).length >= LIMITES.VIDEOS_AUTO;
  lista.innerHTML = videosEditando.map((v, i) => `
    <div class="ep-video-item">
      ${miniaturaVideo(v)}
      ${v.file ? '<span class="ep-video-pendiente">NUEVO</span>' : ''}
      <button type="button" class="foto-thumb-remove" title="Quitar video" onclick="quitarVideoInicio(${i})">×</button>
      <small><strong>Video ${v.num}</strong>${v.file ? ' · ' + esc(formatoMB(v.file.size)) : ''}</small>
      <div class="ep-video-pos" title="Para cambiarlo usá «Acomodar en la página»">📍 ${esc(etiquetaPosVideo(v.pos))}</div>
      <label class="ep-video-auto${!v.auto && hayAuto ? ' bloqueado' : ''}" title="${!v.auto && hayAuto ? 'Ya hay 1 video automático (máximo permitido por la cuota del plan gratuito)' : ''}"><input type="checkbox" ${v.auto ? 'checked' : ''} onchange="cambiarAutoVideo(${i}, this.checked)"> Reproducir solo</label>
    </div>`).join('');
  const lleno = n >= LIMITES.VIDEOS_INICIO;
  const label = document.getElementById('ep-video-label');
  if(label) label.classList.toggle('deshabilitado', lleno);
  const txt = document.getElementById('ep-video-texto');
  if(txt) txt.textContent = lleno
    ? `Máximo alcanzado (${LIMITES.VIDEOS_INICIO} de ${LIMITES.VIDEOS_INICIO}) — quitá uno para agregar otro`
    : `Hacé clic para agregar un video (${n} de ${LIMITES.VIDEOS_INICIO})`;

  // Imágenes decorativas
  const listaImg = document.getElementById('ep-imagenes-lista');
  const ni = imagenesEditando.length;
  if(listaImg){
    listaImg.innerHTML = imagenesEditando.map((v, i) => `
      <div class="ep-video-item">
        ${miniaturaImagen(v)}
        ${v.b64 ? '<span class="ep-video-pendiente">NUEVA</span>' : ''}
        <button type="button" class="foto-thumb-remove" title="Quitar imagen" onclick="quitarImagenDeco(${i})">×</button>
        <small><strong>Imagen ${v.num}</strong>${v.b64 ? ' · ' + esc(formatoMB(tamanoArchivo(v.b64))) : ''}</small>
        <div class="ep-video-pos" title="Para cambiarlo usá «Acomodar en la página»">📍 ${esc(etiquetaPosVideo(v.pos))}</div>
      </div>`).join('');
  }
  const llenoImg = ni >= LIMITES.IMAGENES_DECO;
  const labelImg = document.getElementById('ep-imagen-label');
  if(labelImg) labelImg.classList.toggle('deshabilitado', llenoImg);
  const txtImg = document.getElementById('ep-imagen-texto');
  if(txtImg) txtImg.textContent = llenoImg
    ? `Máximo alcanzado (${LIMITES.IMAGENES_DECO} de ${LIMITES.IMAGENES_DECO}) — quitá una para agregar otra`
    : `Hacé clic para agregar imágenes (${ni} de ${LIMITES.IMAGENES_DECO})`;

  const btnAcomodar = document.getElementById('ep-btn-acomodar');
  if(btnAcomodar) btnAcomodar.style.display = (n + ni) ? '' : 'none';
}

// ════════════════════════════════════════════════════════
//  ACOMODAR — ventana con un esquema visual de la página.
//  Videos e imágenes se arrastran (compu) o se tocan (celular).
//  Se trabaja sobre una copia: "Aplicar" la confirma, "Cancelar" la descarta.
// ════════════════════════════════════════════════════════
let layoutDraft = [];
let layoutSel = null;    // índice del elemento seleccionado (modo tocar)
let layoutDrag = null;   // índice del elemento que se está arrastrando

function nombreElemento(v){ return (v.tipo === 'imagen' ? 'Imagen ' : 'Video ') + v.num; }

function zonasDisponibles(){
  return [...POS_FIJAS, ...categoriasEnPagina.map(c => 'cat:' + c)];
}

function abrirAcomodarVideos(){
  if(!videosEditando.length && !imagenesEditando.length){ alert('Primero agregá al menos un video o una imagen.'); return; }
  asignarNumerosVideos(videosEditando);
  asignarNumerosVideos(imagenesEditando);
  const zonas = zonasDisponibles();
  layoutDraft = [
    ...videosEditando.map(v => ({ ...v, tipo: 'video' })),
    ...imagenesEditando.map(v => ({ ...v, tipo: 'imagen' }))
  ]
    .map(v => zonas.includes(v.pos) ? v : { ...v, pos: 'productos' })   // categoría que ya no se ve
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  layoutSel = null;
  renderEsquemaVideos();
  document.getElementById('video-layout-modal').classList.add('active');
}

function cerrarAcomodarVideos(aplicar){
  if(aplicar){
    layoutDraft.forEach((v, i) => { v.orden = i; });
    const limpiar = ({ tipo, ...resto }) => resto;
    videosEditando   = layoutDraft.filter(v => v.tipo === 'video').map(limpiar);
    imagenesEditando = layoutDraft.filter(v => v.tipo === 'imagen').map(limpiar);
    renderListaVideosEP();
  }
  layoutDraft = [];
  layoutSel = null;
  document.getElementById('video-layout-modal').classList.remove('active');
}

// Mueve el elemento idx a la posición pos. Si se indica antesDe (índice de otro
// elemento), queda justo antes de él; si no, queda último en esa posición.
function moverVideoEnEsquema(idx, pos, antesDe){
  if(idx == null || !layoutDraft[idx] || idx === antesDe) return;
  const item = layoutDraft[idx];
  const ref = antesDe != null ? layoutDraft[antesDe] : null;
  layoutDraft.splice(idx, 1);
  item.pos = pos;
  let destino;
  if(ref){
    destino = layoutDraft.indexOf(ref);
  } else {
    let ultimo = -1;
    layoutDraft.forEach((v, k) => { if(v.pos === pos) ultimo = k; });
    destino = ultimo === -1 ? layoutDraft.length : ultimo + 1;
  }
  layoutDraft.splice(destino, 0, item);
  layoutSel = null;
  renderEsquemaVideos();
}

function chipVideoHTML(v, idx){
  const esImg = v.tipo === 'imagen';
  return `<div class="vl-chip${esImg ? ' vl-chip-imagen' : ''}${layoutSel === idx ? ' seleccionado' : ''}" draggable="true" data-idx="${idx}"
      title="Arrastralo (o tocalo y después tocá dónde ponerlo)">
    <div class="vl-chip-img">${esImg ? miniaturaImagen(v) : miniaturaVideo(v)}</div>
    <div class="vl-chip-txt">
      <strong>${esc(nombreElemento(v))}</strong>
      <span>${esImg ? '🖼 Imagen' : (v.auto ? '▶ Se reproduce solo' : 'Tocar para ver')}</span>
    </div>
    <span class="vl-chip-grip" aria-hidden="true">⠿</span>
  </div>`;
}

function zonaVideosHTML(pos, extraClase){
  const items = layoutDraft.map((v, i) => ({ v, i })).filter(x => x.v.pos === pos);
  return `<div class="vl-zona${extraClase ? ' ' + extraClase : ''}${items.length ? ' con-videos' : ''}${layoutSel != null ? ' esperando' : ''}" data-pos="${esc(pos)}">
    ${items.map(x => chipVideoHTML(x.v, x.i)).join('')}
    <div class="vl-zona-hint">${layoutSel != null ? '⬇ Tocá acá para ponerlo' : (items.length ? 'Soltá acá para agregar otro' : 'Soltá acá')}</div>
  </div>`;
}

function renderEsquemaVideos(){
  const cont = document.getElementById('vl-esquema');
  if(!cont) return;
  const cats = categoriasEnPagina.map(c => `
      <div class="vl-cat"><span>Categoría: ${esc(c)}</span><div class="vl-prod-grid"><i></i><i></i><i></i><i></i></div></div>
      ${zonaVideosHTML('cat:' + c, 'vl-zona-cat')}`).join('');
  cont.innerHTML = `
    <div class="vl-bloque vl-nav">Barra de menú</div>
    <div class="vl-bloque vl-hero"><span>Título principal</span><small>Portada de la página</small></div>
    ${zonaVideosHTML('hero')}
    <div class="vl-bloque vl-nos"><span>Nosotros</span><div class="vl-nos-fig"><i></i><b></b></div></div>
    ${zonaVideosHTML('nosotros')}
    <div class="vl-bloque vl-prod">
      <span>Productos</span>
      ${cats || '<div class="vl-prod-grid"><i></i><i></i><i></i><i></i></div>'}
      ${categoriasEnPagina.length ? '<div class="vl-cat vl-cat-todos"><span>Todos los productos</span></div>' : ''}
    </div>
    ${zonaVideosHTML('productos')}
    <div class="vl-bloque vl-cont"><span>Contacto</span></div>
    ${zonaVideosHTML('final')}
    <div class="vl-bloque vl-pie">Pie de página</div>`;

  // ── Tocar: seleccionar un elemento y después tocar dónde va ──
  cont.querySelectorAll('.vl-chip').forEach(chip => {
    const idx = Number(chip.dataset.idx);
    chip.addEventListener('click', e => {
      e.stopPropagation();
      if(layoutSel === null || layoutSel === idx){
        layoutSel = layoutSel === idx ? null : idx;
        renderEsquemaVideos();
      } else {
        // con otro seleccionado: se ubica justo antes de este
        moverVideoEnEsquema(layoutSel, layoutDraft[idx].pos, idx);
      }
    });
    // ── Arrastrar (compu) ──
    chip.addEventListener('dragstart', e => {
      layoutDrag = idx;
      chip.classList.add('arrastrando');
      try { e.dataTransfer.setData('text/plain', String(idx)); e.dataTransfer.effectAllowed = 'move'; } catch(err) {}
    });
    chip.addEventListener('dragend', () => {
      layoutDrag = null;
      chip.classList.remove('arrastrando');
      cont.querySelectorAll('.sobre').forEach(el => el.classList.remove('sobre'));
    });
    chip.addEventListener('dragover', e => { if(layoutDrag !== null){ e.preventDefault(); e.stopPropagation(); chip.classList.add('sobre'); } });
    chip.addEventListener('dragleave', () => chip.classList.remove('sobre'));
    chip.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      const desde = layoutDrag;
      layoutDrag = null;
      moverVideoEnEsquema(desde, layoutDraft[idx].pos, idx);
    });
  });

  cont.querySelectorAll('.vl-zona').forEach(zona => {
    const pos = zona.dataset.pos;
    zona.addEventListener('click', () => { if(layoutSel !== null) moverVideoEnEsquema(layoutSel, pos, null); });
    zona.addEventListener('dragover', e => { if(layoutDrag !== null){ e.preventDefault(); zona.classList.add('sobre'); } });
    zona.addEventListener('dragleave', e => { if(!zona.contains(e.relatedTarget)) zona.classList.remove('sobre'); });
    zona.addEventListener('drop', e => {
      e.preventDefault();
      const desde = layoutDrag;
      layoutDrag = null;
      moverVideoEnEsquema(desde, pos, null);
    });
  });

  const ayuda = document.getElementById('vl-ayuda-sel');
  if(ayuda){
    ayuda.textContent = layoutSel !== null
      ? `${nombreElemento(layoutDraft[layoutSel])} seleccionado: tocá el lugar de la página donde lo querés poner (o tocalo de nuevo para soltarlo).`
      : '';
    ayuda.style.display = layoutSel !== null ? 'block' : 'none';
  }
}

// Arma el HTML de un video para la página pública.
// · auto: se reproduce solo, sin sonido, en bucle, y SOLO cuando está en pantalla.
// · al tocar: muestra una imagen de portada liviana; el video se descarga recién al tocar play.
function htmlVideoCard(v){
  const liviano  = cldVideoUrl(v.url, CLD_VIDEO, 'mp4');
  const poster   = cldVideoUrl(v.url, CLD_VIDEO_POSTER, 'jpg');
  // Si la versión liviana todavía no está lista, el navegador usa el original
  const fuentes = `<source data-src="${esc(liviano)}" type="video/mp4"><source data-src="${esc(v.url)}">`;
  if(v.auto){
    return `<div class="video-card" data-auto="1">
      <video muted loop playsinline preload="none" poster="${esc(poster)}">${fuentes}</video>
      <button type="button" class="video-sonido" title="Activar sonido" aria-label="Activar sonido">🔇</button>
    </div>`;
  }
  return `<div class="video-card">
    <video playsinline preload="none" poster="${esc(poster)}">${fuentes}</video>
    <button type="button" class="video-play" aria-label="Reproducir video"><span>▶</span></button>
  </div>`;
}

// Imagen decorativa: se descarga recién cuando se acerca a la pantalla
function htmlImagenDeco(v){
  // Con medidas: el lugar queda reservado (la página no "salta" al cargar).
  // Sin medidas (imágenes viejas): un tamaño mínimo hasta que cargue.
  const medidas = v.w && v.h
    ? `width="${v.w}" height="${v.h}" style="width:${v.w}px"`
    : `class="sin-medidas" onload="this.classList.remove('sin-medidas')"`;
  return `<figure class="deco-img">
    <img ${medidas} src="${esc(cldUrl(v.url, CLD_DECO_PC))}"
         srcset="${esc(cldUrl(v.url, CLD_DECO_CEL))} 800w, ${esc(cldUrl(v.url, CLD_DECO_PC))} 1400w"
         sizes="(max-width: 760px) 100vw, 1100px" alt="" loading="lazy" decoding="async">
  </figure>`;
}

function cargarFuentesVideo(video){
  if(video.dataset.cargado) return;
  video.dataset.cargado = '1';
  video.querySelectorAll('source[data-src]').forEach(s => { s.src = s.dataset.src; });
  video.load();
}

// Dibuja videos + imágenes en sus lugares. Se llama al aplicar la configuración
// y cada vez que se reconstruyen los carruseles (cambian los lugares entre categorías).
let videosRenderKey = null;
let videosObserver = null;
function renderVideosInicio(){
  const slots = document.querySelectorAll('.videos-section[data-pos], .medios-cat[data-pos]');
  if(!slots.length) return;
  const presentes = new Set(Array.from(slots).map(s => s.dataset.pos));
  const ok = u => typeof u === 'string' && u.startsWith('https://res.cloudinary.com/');
  const elementos = [
    ...normalizarVideos(SITE_CONFIG._videosInicio).filter(v => ok(v.url)).map(v => ({ ...v, tipo: 'video' })),
    ...normalizarImagenes(SITE_CONFIG._imagenesInicio).filter(v => ok(v.url)).map(v => ({ ...v, tipo: 'imagen' }))
  ]
    // categoría oculta o sin productos → después de Productos (si los carruseles todavía
    // no se armaron, se espera para no mostrarlo un instante en el lugar equivocado)
    .map(v => presentes.has(v.pos) ? v : (carruselesConstruidos ? { ...v, pos: 'productos' } : null))
    .filter(Boolean)
    .sort((a, b) => a.orden - b.orden);
  const key = JSON.stringify([elementos, [...presentes]]);
  if(key === videosRenderKey) return;
  videosRenderKey = key;
  if(videosObserver){ videosObserver.disconnect(); videosObserver = null; }

  slots.forEach(slot => {
    const grid = slot.querySelector('.videos-grid');
    const propios = elementos.filter(v => v.pos === slot.dataset.pos);
    grid.innerHTML = propios.map(v => v.tipo === 'imagen' ? htmlImagenDeco(v) : htmlVideoCard(v)).join('');
    slot.style.display = propios.length ? '' : 'none';
  });

  const autos = [];
  document.querySelectorAll('.videos-section .video-card, .medios-cat .video-card').forEach(card => {
    const video = card.querySelector('video');
    const btnSonido = card.querySelector('.video-sonido');
    const btnPlay = card.querySelector('.video-play');
    if(btnSonido){
      btnSonido.addEventListener('click', () => {
        video.muted = !video.muted;
        btnSonido.textContent = video.muted ? '🔇' : '🔊';
        btnSonido.title = video.muted ? 'Activar sonido' : 'Silenciar';
        if(video.paused) video.play().catch(() => {});
      });
    }
    if(btnPlay){
      btnPlay.addEventListener('click', () => {
        cargarFuentesVideo(video);
        video.controls = true;
        card.classList.add('reproduciendo');
        video.play().catch(() => {});
      });
    }
    if(card.dataset.auto) autos.push(video);
  });

  // Los automáticos se descargan/reproducen solo cuando están en pantalla
  const activar = video => { cargarFuentesVideo(video); video.play().catch(() => {}); };
  if(!autos.length) return;
  if(!('IntersectionObserver' in window)){ autos.forEach(activar); return; }
  videosObserver = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if(en.isIntersecting) activar(en.target);
      else if(!en.target.paused) en.target.pause();
    });
  }, { rootMargin: '200px 0px', threshold: 0.15 });
  autos.forEach(v => videosObserver.observe(v));
}

// ════════════════════════════════════════════════════════
//  MODO BORRADOR (?admin2)
//  Los cambios se guardan en la colección "borrador" (copia de la página).
//  Los visitantes siguen viendo "catalogo" hasta que se toca "Publicar".
// ════════════════════════════════════════════════════════
function esPublicadorSync(){ return ES_PUBLICADOR === true; }

async function calcularEsPublicador(user){
  try {
    if(!user || !user.email || !(window.crypto && crypto.subtle)) return false;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(user.email.trim().toLowerCase()));
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    return PUBLICADORES_HASH.includes(hex);
  } catch(e){ return false; }
}

// Copia TODO (productos, _meta, _indice, siteConfig, marquee) de una raíz a otra.
// Lo que exista en destino y no en origen se borra, así quedan idénticas.
async function copiarDatosEntre(origen, destino, onProgreso){
  const ts = Date.now();
  const [items, itemsDest, meta, indice, config, marquee] = await Promise.all([
    origen.prods.get({ source: 'server' }),
    destino.prods.get({ source: 'server' }),
    origen.meta.get({ source: 'server' }),
    origen.indice.get({ source: 'server' }),
    origen.config.get({ source: 'server' }),
    origen.marquee.get({ source: 'server' })
  ]);
  const idsOrigen = new Set(items.docs.map(d => d.id));
  const ops = [];
  itemsDest.docs.forEach(d => { if(!idsOrigen.has(d.id)) ops.push(b => b.delete(d.ref)); });
  items.docs.forEach(d => ops.push(b => b.set(destino.prods.doc(d.id), d.data())));
  const docs = [
    [meta,    destino.meta,    data => ({ ...data, lastModified: ts })],
    [indice,  destino.indice,  data => ({ ...data, lastModified: ts })],
    [config,  destino.config,  data => data],
    [marquee, destino.marquee, data => data]
  ];
  docs.forEach(([snap, ref, transformar]) => {
    ops.push(b => snap.exists ? b.set(ref, transformar(snap.data())) : b.delete(ref));
  });
  // Si el origen no tenía _meta, igual se marca el cambio para invalidar cachés
  if(!meta.exists) ops.push(b => b.set(destino.meta, { lastModified: ts }, { merge: true }));

  const LOTE = 400;
  for(let i = 0; i < ops.length; i += LOTE){
    const b = db.batch();
    ops.slice(i, i + LOTE).forEach(op => op(b));
    await b.commit();
    if(onProgreso) onProgreso(Math.min(i + LOTE, ops.length), ops.length);
  }
  return ts;
}

async function lastModifiedPublicado(){
  const s = await REFS_PUBLICO.meta.get({ source: 'server' });
  return s.exists ? (s.data().lastModified || 0) : 0;
}

// Se llama al iniciar sesión en ?admin2. Si no existe el borrador, se crea
// como copia exacta de la página publicada.
async function prepararBorrador(user){
  ES_PUBLICADOR = await calcularEsPublicador(user);
  if(!ES_PUBLICADOR){
    alert('El modo borrador (?admin2) es solo para el administrador técnico.\n\nVas a entrar al modo administrador normal.');
    location.href = location.pathname + '?admin';
    return new Promise(() => {});   // no sigue cargando
  }
  const estado = await ESTADO_BORRADOR_REF.get({ source: 'server' });
  if(!estado.exists){
    mostrarToast('Creando el borrador (copia de la página publicada)…');
    const base = await lastModifiedPublicado();
    await copiarDatosEntre(REFS_PUBLICO, REFS_BORRADOR);
    await ESTADO_BORRADOR_REF.set({ baseTs: base, creado: Date.now() });
  }
  actualizarAvisoBorrador().catch(() => {});
}

// Arranca el borrador una sola vez (se llama desde el login y desde la sesión guardada)
let borradorArrancado = false;
function arrancarBorrador(user){
  if(borradorArrancado || !user) return;
  borradorArrancado = true;
  prepararBorrador(user).then(() => resolverBorradorListo()).catch(err => {
    borradorArrancado = false;
    console.error('Error preparando el borrador:', err);
    mostrarToastError('⚠ No se pudo abrir el borrador. ¿Publicaste las reglas nuevas de Firestore?<br>' + esc(err && err.message ? err.message : ''), 15000);
  });
  iniciarSincronizacionAdmin().catch(() => {});
}

// Muestra en la barra si la página publicada cambió después de empezar el borrador
async function actualizarAvisoBorrador(){
  const el = document.getElementById('borrador-aviso');
  if(!el) return;
  const [estado, pubTs] = await Promise.all([ESTADO_BORRADOR_REF.get({ source: 'server' }), lastModifiedPublicado()]);
  const baseTs = estado.exists ? (estado.data().baseTs || 0) : 0;
  el.style.display = pubTs > baseTs ? '' : 'none';
}

async function publicarBorrador(){
  if(!BORRADOR || !esPublicadorSync()) return;
  const btn = document.getElementById('btn-publicar-borrador');
  try {
    const [estado, pubTs] = await Promise.all([ESTADO_BORRADOR_REF.get({ source: 'server' }), lastModifiedPublicado()]);
    const baseTs = estado.exists ? (estado.data().baseTs || 0) : 0;
    const msg = pubTs > baseTs
      ? '⚠ ATENCIÓN: la página publicada se modificó DESPUÉS de que empezaste este borrador (por ejemplo, alguien editó desde ?admin).\n\nSi publicás, esos cambios se pierden y la página queda exactamente como este borrador.\n\n¿Publicar igual?'
      : '¿Publicar el borrador?\n\nTodo lo que ves acá (productos, textos, videos, cinta, orden y categorías) pasa a la página que ven los visitantes.';
    if(!confirm(msg)) return;
    if(btn){ btn.disabled = true; btn.textContent = 'Publicando…'; }
    const ts = await copiarDatosEntre(REFS_BORRADOR, REFS_PUBLICO, (n, t) => mostrarToast(`Publicando… ${n} de ${t}`));
    await ESTADO_BORRADOR_REF.set({ baseTs: ts, publicado: ts }, { merge: true });
    actualizarAvisoBorrador().catch(() => {});
    mostrarToast('Publicado ✓ — los visitantes ya ven los cambios');
  } catch(err){
    console.error('Error publicando borrador:', err);
    mostrarToastError('⚠ No se pudo publicar.<br>' + esc(err && err.message ? err.message : 'Revisá la conexión.'), 10000);
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = '🚀 Publicar en la página'; }
  }
}

async function descartarBorrador(){
  if(!BORRADOR || !esPublicadorSync()) return;
  if(!confirm('¿Descartar el borrador?\n\nSe pierden los cambios que no publicaste y el borrador vuelve a quedar igual que la página publicada.')) return;
  try {
    mostrarToast('Descartando borrador…');
    const base = await lastModifiedPublicado();
    await copiarDatosEntre(REFS_PUBLICO, REFS_BORRADOR);
    await ESTADO_BORRADOR_REF.set({ baseTs: base, creado: Date.now() });
    location.reload();
  } catch(err){
    mostrarToastError('⚠ No se pudo descartar.<br>' + esc(err && err.message ? err.message : ''), 8000);
  }
}

function verPaginaPublicada(){ window.open(location.pathname, '_blank'); }
function irABorrador(){ location.href = location.pathname + '?admin2'; }

// ════════════════════════════════════════════════════════
//  Toast
// ════════════════════════════════════════════════════════
function mostrarToast(msg){
  const t = document.getElementById('admin-toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

function mostrarToastError(msg, duracion = 2800){
  const t = document.getElementById('admin-toast');
  t.innerHTML = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duracion);
}

// ════════════════════════════════════════════════════════
//  BUSCADOR
// ════════════════════════════════════════════════════════
let searchTimeout = null;

function abrirBuscador(){
  const overlay = document.getElementById('search-overlay');
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
  document.getElementById('search-input').value = '';
  document.getElementById('search-empty').style.display = 'none';
  ejecutarBusqueda('');
  setTimeout(() => document.getElementById('search-input').focus(), 80);
}

function cerrarBuscador(){
  document.getElementById('search-overlay').classList.remove('active');
  document.body.style.overflow = '';
}

function onSearchInput(e){
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => ejecutarBusqueda(e.target.value), 180);
}

// Cuenta cuántos caracteres (multiset) comparten dos strings.
// Ej: "anillo 6 y" vs "anillo 6 y" comparte todo; vs "anillo 6 x" comparte
// todo menos la "y", lo que hace que el match exacto puntúe más alto.
function contarCaracteresComunes(a, b){
  const freq = {};
  for(const ch of a){
    if(ch === ' ') continue;
    freq[ch] = (freq[ch] || 0) + 1;
  }
  let comunes = 0;
  for(const ch of b){
    if(ch === ' ') continue;
    if(freq[ch] > 0){
      comunes++;
      freq[ch]--;
    }
  }
  return comunes;
}

// Puntaje de relevancia de un producto contra la búsqueda.
// Prioridad: 1) coincidencia exacta, 2) el título empieza con la búsqueda,
// 3) el título contiene la búsqueda completa, 4) cantidad de palabras
// sueltas que matchean, 5) cantidad de caracteres en común (desempate fino,
// para que "anillo 6 y" quede antes que "anillo 6 x" al buscar "anillo 6 y").
function calcularScoreBusqueda(tituloLower, qLower, palabras){
  let score = 0;
  if(tituloLower === qLower) score += 5000;
  else if(tituloLower.startsWith(qLower)) score += 2000;
  else if(tituloLower.includes(qLower)) score += 1000;
  palabras.forEach(w => { if(tituloLower.includes(w)) score += 50; });
  score += contarCaracteresComunes(tituloLower, qLower) * 2;
  return score;
}

function ejecutarBusqueda(query){
  const q = query.trim();
  const resultsEl = document.getElementById('search-results');
  const emptyEl   = document.getElementById('search-empty');
  const countEl   = document.getElementById('search-count');

  if(!q){
    // Sin texto → mostrar la primera categoría visible (normalmente "Destacados")
    emptyEl.style.display = 'none';
    const primeraCat = getCategorias().filter(c => !categoriasOcultas.includes(c))[0];
    if(!primeraCat){ resultsEl.innerHTML = ''; countEl.textContent = ''; return; }
    const destacados = productos.filter(p => {
      const lista = Array.isArray(p.tipos) ? p.tipos : [p.tipo];
      return lista.includes(primeraCat);
    });
    countEl.textContent = primeraCat; // muestra el nombre de la categoría como título
    resultsEl.innerHTML = '';
    destacados.forEach(p => {
      const card = document.createElement('div');
      card.className = 'search-card';
      const cats = Array.isArray(p.tipos) ? p.tipos.join(' · ') : (p.tipo || '');
      card.innerHTML = `
        <div class="search-card-img">
          <img src="${esc(cldUrl(p.img, CLD_THUMB))}" alt="${esc(p.nombre)}" loading="lazy">
        </div>
        <div class="search-card-info">
          <div class="search-card-cat">${esc(cats)}</div>
          <div class="search-card-name">${esc(p.nombre)}</div>
          <div class="search-card-desc">${p.desc ? esc(p.desc.substring(0,80))+'…' : ''}</div>
        </div>
        <button class="search-card-btn">Ver</button>`;
      card.addEventListener('click', () => abrirProductoDesdeBuscador(p.id));
      resultsEl.appendChild(card);
    });
    return;
  }

  // `productos` ya contiene TODO el catálogo (viene de catalogo/_indice)
  const fuente = productos;

  const palabras = q.toLowerCase().split(/\s+/).filter(Boolean);
  const qLower = q.toLowerCase();
  const encontrados = fuente.filter(p => {
    if(!ADMIN_MODE && productosOcultos.includes(p.id)) return false;
    const titulo = (p.nombre || '').toLowerCase();
    return palabras.some(w => titulo.includes(w));
  });

  // Ordenamos por relevancia: primero lo que más se parece a lo buscado
  // (coincidencia exacta > empieza igual > lo contiene > más caracteres
  // en común), así "anillo 6 y" aparece antes que "anillo 6 x" al buscar
  // "anillo 6 y".
  encontrados.sort((a, b) => {
    const scoreA = calcularScoreBusqueda((a.nombre || '').toLowerCase(), qLower, palabras);
    const scoreB = calcularScoreBusqueda((b.nombre || '').toLowerCase(), qLower, palabras);
    return scoreB - scoreA;
  });

  countEl.textContent = encontrados.length > 0
    ? `${encontrados.length} resultado${encontrados.length !== 1 ? 's' : ''}`
    : '';

  if(!encontrados.length){
    resultsEl.innerHTML = '';
    emptyEl.style.display = 'block';
    emptyEl.querySelector('.search-empty-term').textContent = `"${q}"`;
    return;
  }

  emptyEl.style.display = 'none';
  resultsEl.innerHTML = '';
  encontrados.forEach(p => {
    const card = document.createElement('div');
    card.className = 'search-card';
    const cats = Array.isArray(p.tipos) ? p.tipos.join(' · ') : (p.tipo || '');
    const imgSrc = p.img || '';
    const imgHtml = imgSrc ? `<img src="${esc(cldUrl(imgSrc, CLD_THUMB))}" alt="${esc(p.nombre)}" loading="lazy">` : '';
    card.innerHTML = `
      <div class="search-card-img">
        ${imgHtml}
      </div>
      <div class="search-card-info">
        <div class="search-card-cat">${esc(cats)}</div>
        <div class="search-card-name">${resaltarPalabras(p.nombre, palabras)}</div>
        <div class="search-card-desc">${p.desc ? esc(p.desc.substring(0,80))+'…' : ''}</div>
      </div>
      <button class="search-card-btn">Ver</button>`;
    card.addEventListener('click', () => abrirProductoDesdeBuscador(p.id));
    resultsEl.appendChild(card);
  });
}

// Abre un producto encontrado en el buscador. Si ya está en memoria (batch cargado)
// lo abre directo; si no, lo trae con UNA lectura puntual a Firestore antes de abrir.
async function abrirProductoDesdeBuscador(prodId){
  cerrarBuscador();
  let prod = productos.find(x => x.id === prodId);
  if(!prod){
    try {
      const doc = await PRODS_COL.doc(prodId).get();
      if(doc.exists){
        prod = { ...doc.data(), id: doc.id };
        productos.push(prod);
      }
    } catch(err){
      console.warn('No se pudo cargar el producto:', err);
    }
  }
  if(prod) openModal(prod);
}

function resaltarPalabras(texto, palabras){
  const unicas = [...new Set((palabras || []).filter(Boolean))]
    // Las más largas primero, para que "collar" no le "gane" el match a "collares", etc.
    .sort((a, b) => b.length - a.length)
    // Se escapa la palabra igual que el texto, así matchea sobre el texto escapado
    .map(w => esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  texto = esc(texto);
  if(!unicas.length) return texto;

  // Un solo pase con alternancia sobre el texto ORIGINAL (nunca sobre el resultado
  // ya resaltado), para no volver a matchear adentro de un <mark> ya insertado.
  const regex = new RegExp(`(${unicas.join('|')})`, 'gi');
  return texto.replace(regex, '<mark>$1</mark>');
}




function toggleLoginPassword() {
  const input = document.getElementById('login-password');
  const iconShow = document.getElementById('eye-icon-show');
  const iconHide = document.getElementById('eye-icon-hide');
  if (input.type === 'password') {
    input.type = 'text';
    iconShow.style.display = 'none';
    iconHide.style.display = '';
  } else {
    input.type = 'password';
    iconShow.style.display = '';
    iconHide.style.display = 'none';
  }
}




document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  cerrarBuscador();
  // Ventana del producto
  const modal = document.getElementById('modal');
  if(modal && modal.classList.contains('active')){
    modal.classList.remove('active');
    document.body.style.overflow = '';
    resetModalZoom();
  }
  // Carrito
  const cart = document.getElementById('cart-overlay');
  if(cart && cart.classList.contains('active')) toggleCarrito();
});

document.addEventListener('DOMContentLoaded', () => {

  const inputPrecio = document.getElementById('a-precio');

  if(!inputPrecio) return;

  inputPrecio.addEventListener('input', function(e){

    let valor = e.target.value.replace(/\D/g, '');

    if(!valor){
      e.target.value = '';
      return;
    }

    e.target.value = Number(valor).toLocaleString('es-AR');
  });

});


// ════════════════════════════════════════════════════════
//  PARALLAX HERO — los círculos se mueven al hacer scroll
//  Cada círculo tiene una velocidad distinta (factor),
//  creando sensación de profundidad. Sutil y elegante.
// ════════════════════════════════════════════════════════
(function iniciarParallax(){
  // factor: qué tan rápido se mueve cada círculo
  // positivo = baja más lento que el scroll (flota hacia arriba)
  // negativo = sube más rápido (se aleja)
  const capas = [
    { selector: '.hc1', factor: 0.18 },  // grande, movimiento suave
    { selector: '.hc2', factor: 0.28 },  // mediano, un poco más rápido
    { selector: '.hc3', factor: 0.12 },  // pequeño, casi inmóvil
  ];

  const elementos = capas.map(c => ({
    el: document.querySelector(c.selector),
    factor: c.factor
  })).filter(c => c.el);

  // ── Parallax imagen "Nosotros" ──────────────────────────
  // La imagen se mueve más lento que el scroll → efecto de profundidad
  const nosotrosImg = document.querySelector('.about-img-placeholder') || document.querySelector('.about-img-main');
  const FACTOR_NOS = window.innerWidth <= 768 ? 0.05 : 0.18; // 0 = sin efecto · 1 = fija · 0.18 = sutil y elegante

  let rafPending = false;

  function aplicar(){
    const scrollY = window.scrollY;

    // Círculos del hero
    elementos.forEach(({ el, factor }) => {
      el.style.transform = `translateY(${scrollY * factor}px)`;
    });

    // Imagen de Nosotros: offset relativo al centro visible de la sección
    if(nosotrosImg){
      const seccion = nosotrosImg.closest('#nosotros');
      const rect    = seccion ? seccion.getBoundingClientRect() : null;
      const centro  = rect ? rect.top + rect.height / 2 - window.innerHeight / 2 : 0;
      nosotrosImg.style.transform = `translateY(${centro * FACTOR_NOS}px) scale(${window.innerWidth <= 768 ? 1.02 : 1.08})`;
    }

    rafPending = false;
  }

  window.addEventListener('scroll', () => {
    if(!rafPending){
      rafPending = true;
      requestAnimationFrame(aplicar);
    }
  }, { passive: true });

  // Aplicar estado inicial sin esperar el primer scroll
  requestAnimationFrame(aplicar);
})();



// ════════════════════════════════════════════════════════
//  CARRITO DE COMPRAS
// ════════════════════════════════════════════════════════

function toggleCarrito() {
  const overlay = document.getElementById('cart-overlay');
  overlay.classList.toggle('active');
  if (overlay.classList.contains('active')) {
    document.body.style.overflow = 'hidden';
    actualizarCarritoUI();
  } else {
    document.body.style.overflow = '';
  }
}

function agregarAlCarrito(producto) {
  if (!producto.precio || producto.precio.trim() === '') {
    mostrarToastError('Este producto no tiene precio asignado.');
    return;
  }
  
  // Revisamos si el producto ya está en el carrito
  const existente = carrito.find(p => p.id === producto.id);
  
  if (existente) {
    // Si existe, solo sumamos 1 a la cantidad
    existente.cantidad += 1;
  } else {
    // Si no existe, lo agregamos con cantidad inicial de 1 (solo datos livianos,
    // sin la lista de fotos, para poder guardarlo en localStorage)
    carrito.push({ ...itemCarrito(producto), cantidad: 1 });
  }

  actualizarCarritoUI();
  mostrarToast('Producto agregado al carrito 🛒');
  closeModal({ target: document.getElementById('modal') }); 
}

// Nueva función para sumar/restar desde el carrito
function cambiarCantidad(index, delta) {
  if (carrito[index]) {
    carrito[index].cantidad += delta;
    // Si la cantidad llega a 0, se elimina del carrito
    if (carrito[index].cantidad <= 0) {
      eliminarDelCarrito(index);
    } else {
      actualizarCarritoUI();
    }
  }
}

function eliminarDelCarrito(index) {
  carrito.splice(index, 1);
  actualizarCarritoUI();
}

function actualizarCarritoUI() {
  const itemsContainer = document.getElementById('cart-items');
  const countBadge = document.getElementById('cart-count');
  const totalEl = document.getElementById('cart-total-price');
  
  // Contamos el total de unidades (no solo la cantidad de productos distintos)
  let totalUnidades = 0;
  carrito.forEach(p => totalUnidades += p.cantidad);

  // Burbuja con el contador en el menú superior
  if (totalUnidades > 0) {
    countBadge.style.display = 'flex';
    countBadge.textContent = totalUnidades;
  } else {
    countBadge.style.display = 'none';
  }

  guardarCarritoLocal();

  // Lista vacía
  if (carrito.length === 0) {
    itemsContainer.innerHTML = '<p class="cart-empty">Tu carrito está vacío.<br><br>¡Agregá algunos productos!</p>';
    totalEl.textContent = '$0';
    return;
  }

  // Renderizar items y calcular total
  let html = '';
  let total = 0;

  carrito.forEach((p, idx) => {
    // Verificamos si está en oferta y definimos el precio que debe cobrarse
    const precioVigente = (p.enOferta && p.precioOferta) ? p.precioOferta : p.precio;
    
    const precioNum = Number((precioVigente || '0').replace(/\D/g, ''));
    const subtotal = precioNum * p.cantidad;
    total += subtotal;
    
    // Armamos el diseño del precio según si está en oferta o no
    let precioMostrarHTML = '';
    if (p.enOferta && p.precioOferta) {
      precioMostrarHTML = `
        <span style="text-decoration: line-through; color: var(--text-soft); opacity: 0.65; margin-right: 6px; font-size: 12px;">${esc(p.precio)}</span>
        <span style="color: var(--principal); font-weight: bold;">${esc(p.precioOferta)}</span>
      `;
    } else {
      precioMostrarHTML = `<span>${esc(p.precio)}</span>`;
    }
    
    html += `
      <div class="cart-item">
        <img src="${esc(cldUrl(p.img, CLD_THUMB))}" class="cart-item-img" alt="">
        <div class="cart-item-info">
          <div class="cart-item-title">${esc(p.nombre)}</div>
          <div class="cart-item-price">${precioMostrarHTML} c/u</div>
          <div style="display:flex; align-items:center; gap:8px; margin-top:8px;">
            <button onclick="cambiarCantidad(${idx}, -1)" style="width:24px; height:24px; border:1px solid var(--detalles); background:transparent; cursor:pointer; border-radius:4px; display:flex; align-items:center; justify-content:center; color:var(--text); font-weight:bold; transition: background 0.2s;">-</button>
            <span style="font-size:13px; font-weight:600; width:18px; text-align:center; color:var(--text);">${p.cantidad}</span>
            <button onclick="cambiarCantidad(${idx}, 1)" style="width:24px; height:24px; border:1px solid var(--detalles); background:transparent; cursor:pointer; border-radius:4px; display:flex; align-items:center; justify-content:center; color:var(--text); font-weight:bold; transition: background 0.2s;">+</button>
          </div>
        </div>
        <button class="cart-item-remove" onclick="eliminarDelCarrito(${idx})" title="Eliminar del carrito">✕</button>
      </div>
    `;
  });

  itemsContainer.innerHTML = html;
  totalEl.textContent = '$' + total.toLocaleString('es-AR');
}

// ── Persistencia del carrito (sobrevive a recargas) ──────────
const CARRITO_KEY = 'carrito_v1';

function itemCarrito(p){
  const it = { id: p.id, nombre: p.nombre || '', precio: p.precio || '', img: p.img || '', enOferta: !!p.enOferta };
  if(p.enOferta && p.precioOferta) it.precioOferta = p.precioOferta;
  return it;
}

function guardarCarritoLocal(){
  // Fotos en formato viejo (base64) no se guardan: pesan demasiado para localStorage.
  // Al recargar, sincronizarCarritoConCatalogo() vuelve a completar la imagen.
  const liviano = carrito.map(p => esBase64(p.img) ? { ...p, img: '' } : p);
  try { localStorage.setItem(CARRITO_KEY, JSON.stringify(liviano)); } catch(e) {}
}

function cargarCarritoLocal(){
  try {
    const data = JSON.parse(localStorage.getItem(CARRITO_KEY) || '[]');
    if(Array.isArray(data)){
      carrito = data.filter(p => p && p.id && p.cantidad > 0);
    }
  } catch(e) { carrito = []; }
  actualizarCarritoUI();
}

// Cuando llega el catálogo: actualizar nombre/precio/oferta de lo guardado y
// sacar productos que ya no existen o que se ocultaron.
function sincronizarCarritoConCatalogo(){
  if(!carrito.length || !productos.length) return;
  carrito = carrito
    .map(item => {
      const p = productos.find(x => x.id === item.id);
      if(!p || (!ADMIN_MODE && productosOcultos.includes(p.id)) || !p.precio) return null;
      return { ...itemCarrito(p), cantidad: item.cantidad };
    })
    .filter(Boolean);
  actualizarCarritoUI();
}

function enviarPedidoWa() {
  if (carrito.length === 0) {
    mostrarToastError('El carrito está vacío.');
    return;
  }

  let lineas = [SITE_CONFIG.contacto.waTextoPedido || 'Hola! Como estas? Me gustaria hacer el siguiente pedido:'];
  let total = 0;

  carrito.forEach((p) => {
    // Hacemos la misma validación para el mensaje final
    const precioVigente = (p.enOferta && p.precioOferta) ? p.precioOferta : p.precio;
    
    const precioNum = Number((precioVigente || '0').replace(/\D/g, ''));
    total += precioNum * p.cantidad;
    lineas.push(`• ${p.cantidad}x *${p.nombre}* - ${precioVigente} c/u `);
  });

  lineas.push(`*TOTAL A ABONAR: $${total.toLocaleString('es-AR')}*`);

  const mensaje = lineas.join('\n');
  const url = `https://wa.me/${SITE_CONFIG.whatsapp}?text=${encodeURIComponent(mensaje)}`;
  window.open(url, '_blank');
}



// ════════════════════════════════════════════════════════
//  CINTA PROMOCIONAL (marquee)
// ════════════════════════════════════════════════════════

async function cargarMarqueeConfig(){
  try {
    const snap = await MARQUEE_REF.get({ source: 'server' });
    if(snap.exists){
      const data = snap.data();
      marqueeConfig.activo    = !!data.activo;
      marqueeConfig.velocidad = data.velocidad || 30;
      marqueeConfig.altura    = data.altura || 38;
      marqueeConfig.fondo     = data.fondo || '#1a1a1a';
      marqueeConfig.banners   = Array.isArray(data.banners) ? data.banners : [];
    }
  } catch(err){
    console.warn('No se pudo cargar la cinta promocional:', err);
  }
  renderMarqueePublico();
}

// Construye el HTML de un item individual (usado tanto en público como en preview)
function renderMarqueeItemHTML(b){
  const clases = [
    'marquee-item',
    b.bold ? 'mq-bold' : '',
    b.italic ? 'mq-italic' : '',
    b.uppercase ? 'mq-uppercase' : '',
    b.badge ? 'mq-badge' : '',
    b.glow ? 'mq-glow' : ''
  ].filter(Boolean).join(' ');

  const style = `color:${b.color || '#ffffff'};font-size:${b.tamano || 14}px`;
  const icono = b.icono ? `<span class="marquee-icon">${b.icono}</span>` : '';
  const texto = `<span>${escaparHTML(b.texto || '')}</span>`;
  const sep = b.separador ? `<span class="marquee-sep" style="color:${b.color || '#ffffff'}">${b.separador}</span>` : '';

  const clickAttr = b.link
    ? `data-clickable="1" onclick="window.open('${b.link.replace(/'/g,"\\'")}','_blank')"`
    : '';

  return `<span class="${clases}" style="${style}" ${clickAttr}>${icono}${texto}</span>${sep}`;
}

function escaparHTML(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Renderiza la cinta en la web pública
function renderMarqueePublico(){
  const wrap = document.getElementById('marquee-wrap');
  const track = document.getElementById('marquee-track');
  
  const visibles = marqueeConfig.banners
    .filter(b => b.visible !== false)
    .sort((a,b) => (a.orden||0) - (b.orden||0));

  if(!marqueeConfig.activo || visibles.length === 0){
    if(wrap) wrap.style.display = 'none';
    document.body.classList.remove('marquee-active');
    posicionarNavYMarquee();
    return;
  }

  // Generamos el HTML una sola vez
  const itemsHTML = visibles.map(renderMarqueeItemHTML).join('');
  
  // Inyectamos 3 bloques para garantizar el loop infinito sin saltos
  track.innerHTML = `
    <div class="marquee-content">${itemsHTML}</div>
    <div class="marquee-content">${itemsHTML}</div>
    <div class="marquee-content">${itemsHTML}</div>
  `;

  // Aplicamos estilos
  wrap.style.display = 'flex';
  wrap.style.height = marqueeConfig.altura + 'px';
  wrap.style.background = marqueeConfig.fondo;
  track.style.setProperty('--marquee-duration', marqueeConfig.velocidad + 's');
  document.body.classList.add('marquee-active');
  posicionarNavYMarquee();
}

// ════════════════════════════════════════════════════════
//  POSICIONAMIENTO DINÁMICO DE NAV + MARQUEE
//  ────────────────────────────────────────────────────────
//  Antes, el "top" del nav y de la cinta promocional estaban
//  hardcodeados en style.css (ej: top:50px, top:94px si admin).
//  Eso asumía que el nav SIEMPRE mide exactamente 50px/56px y
//  el admin-bar siempre 44px. Cualquier variación real (fuentes
//  que tardan en cargar, admin-bar con contenido que ocupa más
//  de una línea, wrap del contenido en pantallas angostas, CSS
//  que todavía no terminó de aplicar en el primer paint, etc.)
//  hacía que el marquee quedara mal ubicado.
//
//  Esta función mide las alturas REALES con getBoundingClientRect
//  y las vuelca a variables CSS, así el layout siempre es correcto
//  sin importar cuánto mida cada barra en cada momento.
// ════════════════════════════════════════════════════════
function posicionarNavYMarquee(){
  const adminBar = document.getElementById('admin-bar');
  const nav      = document.querySelector('nav');
  const marquee  = document.getElementById('marquee-wrap');
  const root     = document.documentElement;

  const adminBarH = (adminBar && getComputedStyle(adminBar).display !== 'none')
    ? adminBar.getBoundingClientRect().height
    : 0;

  root.style.setProperty('--admin-bar-height', adminBarH + 'px');

  const navH = nav ? nav.getBoundingClientRect().height : 0;

  const marqueeVisible = marquee && getComputedStyle(marquee).display !== 'none';
  const marqueeH = marqueeVisible ? marquee.getBoundingClientRect().height : 0;

  root.style.setProperty('--marquee-extra-height', marqueeH + 'px');

  if(marqueeVisible){
    root.style.setProperty('--marquee-top', (adminBarH + navH) + 'px');
  }

  root.style.setProperty('--body-push-top', (adminBarH + navH + marqueeH) + 'px');
}

window.addEventListener('resize', posicionarNavYMarquee);
if(document.fonts && document.fonts.ready){
  document.fonts.ready.then(posicionarNavYMarquee);
}


// ── ADMIN: abrir/cerrar modal principal ──────────────────
let marqueeBannersTemp = []; // copia de trabajo mientras se edita en el modal

function abrirModalMarquee(){
  marqueeBannersTemp = JSON.parse(JSON.stringify(marqueeConfig.banners));
  document.getElementById('mq-activo').checked = marqueeConfig.activo;
  document.getElementById('mq-velocidad').value = marqueeConfig.velocidad;
  document.getElementById('mq-altura').value = marqueeConfig.altura;
  document.getElementById('mq-fondo').value = marqueeConfig.fondo;

  renderMarqueeBannerList();
  previewMarqueeConfig();
  document.getElementById('marquee-modal-overlay').classList.add('active');
}

function cerrarModalMarquee(e){
  if(e.target.id !== 'marquee-modal-overlay') return;
  document.getElementById('marquee-modal-overlay').classList.remove('active');
}

// Actualiza la vista previa en vivo dentro del modal
function previewMarqueeConfig(){
  const track = document.getElementById('mq-preview-track'); // Ajuste: usa el ID correcto del modal
  const wrap  = document.getElementById('mq-preview-wrap');
  if (!track) return;

  // ── Velocidad ──────────────────────────────────────────
  const velocidad = parseInt(document.getElementById('mq-velocidad').value) || 30;
  track.style.animationDuration = velocidad + 's';

  // ── Color de fondo ─────────────────────────────────────
  const fondo = document.getElementById('mq-fondo').value;
  if(wrap) wrap.style.background = fondo;

  // ── Alto de la barra ───────────────────────────────────
  const altura = parseInt(document.getElementById('mq-altura').value) || 38;
  if(wrap) wrap.style.height = altura + 'px';

  const visibles = marqueeBannersTemp.filter(x => x.visible !== false);
  
  if (visibles.length === 0) {
    track.innerHTML = '<span class="marquee-item" style="color:#999">Sin banners activos</span>';
    return;
  }

  const itemsHTML = visibles.map(renderMarqueeItemHTML).join('');

  // Aplicamos la misma lógica de triplicado para la previsualización
  track.innerHTML = `
    <div class="marquee-content">${itemsHTML}</div>
    <div class="marquee-content">${itemsHTML}</div>
    <div class="marquee-content">${itemsHTML}</div>
  `;
}

// ── Lista de banners con drag & drop, ocultar, eliminar ──
function renderMarqueeBannerList(){
  const lista = document.getElementById('mq-banner-list');
  lista.innerHTML = '';

  marqueeBannersTemp
    .sort((a,b) => (a.orden||0) - (b.orden||0))
    .forEach((b, i) => {
      const li = document.createElement('li');
      li.className = 'reorder-item';
      li.draggable = true;
      li.dataset.index = i;
      li.style.opacity = b.visible === false ? '0.5' : '1';

      li.innerHTML = `
        <span class="reorder-handle">⠿</span>
        <span class="reorder-num">${i + 1}</span>
        <div class="reorder-info" style="flex:1">
          <div class="reorder-name">${b.icono || ''} ${escaparHTML(b.texto || '(sin texto)')}</div>
          <div class="reorder-tipo">${b.visible === false ? 'Oculto' : 'Visible'}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" onclick="abrirFormBanner('${b.id}')" title="Editar" style="background:none;border:none;cursor:pointer;font-size:15px">✏️</button>
          <button type="button" onclick="toggleVisibilidadBanner('${b.id}')" title="${b.visible === false ? 'Mostrar' : 'Ocultar'}" style="background:none;border:none;cursor:pointer;font-size:15px">${b.visible === false ? '👁️' : '🙈'}</button>
          <button type="button" onclick="eliminarBanner('${b.id}')" title="Eliminar" style="background:none;border:none;cursor:pointer;font-size:15px">🗑️</button>
        </div>`;

      li.addEventListener('dragstart', e => {
        marqueeDragSrcIndex = parseInt(li.dataset.index);
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        lista.querySelectorAll('.reorder-item').forEach(el => el.classList.remove('drag-over'));
      });
      li.addEventListener('dragover', e => {
        e.preventDefault();
        lista.querySelectorAll('.reorder-item').forEach(el => el.classList.remove('drag-over'));
        li.classList.add('drag-over');
      });
      li.addEventListener('drop', e => {
        e.preventDefault();
        const destIndex = parseInt(li.dataset.index);
        if(marqueeDragSrcIndex === null || marqueeDragSrcIndex === destIndex) return;
        const ordenados = [...marqueeBannersTemp].sort((a,b)=>(a.orden||0)-(b.orden||0));
        const [moved] = ordenados.splice(marqueeDragSrcIndex, 1);
        ordenados.splice(destIndex, 0, moved);
        ordenados.forEach((b, idx) => b.orden = idx);
        marqueeBannersTemp = ordenados;
        marqueeDragSrcIndex = null;
        renderMarqueeBannerList();
        previewMarqueeConfig();
      });

      lista.appendChild(li);
    });
}

function toggleVisibilidadBanner(id){
  const b = marqueeBannersTemp.find(x => x.id === id);
  if(!b) return;
  b.visible = b.visible === false ? true : false;
  renderMarqueeBannerList();
  previewMarqueeConfig();
}

function eliminarBanner(id){
  if(!confirm('¿Eliminar este banner permanentemente? Esta acción no se puede deshacer.')) return;
  marqueeBannersTemp = marqueeBannersTemp.filter(x => x.id !== id);
  marqueeBannersTemp.forEach((b, idx) => b.orden = idx);
  renderMarqueeBannerList();
  previewMarqueeConfig();
}

// ── Sub-modal: agregar / editar un banner ────────────────
function abrirFormBanner(id){
  const esNuevo = !id;
  const b = esNuevo
    ? { id:'', texto:'', icono:'', color:'#ffffff', tamano:14, separador:'•', link:'', visible:true, bold:false, italic:false, uppercase:false, badge:false, glow:false }
    : marqueeBannersTemp.find(x => x.id === id);

  if(!b) return;

  document.getElementById('banner-form-titulo').textContent = esNuevo ? 'Nuevo banner' : 'Editar banner';
  document.getElementById('bf-id').value = b.id || '';
  document.getElementById('bf-texto').value = b.texto || '';
  document.getElementById('bf-icono').value = b.icono || '';
  document.getElementById('bf-separador').value = b.separador || '';
  document.getElementById('bf-color').value = b.color || '#ffffff';
  document.getElementById('bf-tamano').value = b.tamano || 14;
  document.getElementById('bf-link').value = b.link || '';
  document.getElementById('bf-bold').checked = !!b.bold;
  document.getElementById('bf-italic').checked = !!b.italic;
  document.getElementById('bf-uppercase').checked = !!b.uppercase;
  document.getElementById('bf-badge').checked = !!b.badge;
  document.getElementById('bf-glow').checked = !!b.glow;

  document.getElementById('banner-form-overlay').classList.add('active');
  previewBannerFormLive();
}


// Vista previa en vivo mientras se edita el sub-modal de un banner
function previewBannerFormLive(){
  const id = document.getElementById('bf-id').value;

  const bannerLive = {
    id: id || '__preview__',
    texto: document.getElementById('bf-texto').value || '(sin texto)',
    icono: document.getElementById('bf-icono').value.trim(),
    separador: document.getElementById('bf-separador').value,
    color: document.getElementById('bf-color').value,
    tamano: parseInt(document.getElementById('bf-tamano').value) || 14,
    link: document.getElementById('bf-link').value.trim(),
    bold: document.getElementById('bf-bold').checked,
    italic: document.getElementById('bf-italic').checked,
    uppercase: document.getElementById('bf-uppercase').checked,
    badge: document.getElementById('bf-badge').checked,
    glow: document.getElementById('bf-glow').checked,
    visible: true,
    orden: 0
  };

  let listaConLive;
  if(id){
    listaConLive = marqueeBannersTemp.map(b => b.id === id ? bannerLive : b);
  } else {
    listaConLive = [...marqueeBannersTemp, bannerLive];
  }

  const visibles = listaConLive
    .filter(b => b.visible !== false)
    .sort((a,b) => (a.orden||0) - (b.orden||0));

  const html = visibles.map(renderMarqueeItemHTML).join('');
  const contentA = document.getElementById('mq-preview-content');
  const contentB = document.getElementById('mq-preview-content-b');
  contentA.innerHTML = html;
  contentB.innerHTML = html;
}


function cerrarFormBanner(e){
  if(e.target.id !== 'banner-form-overlay') return;
  document.getElementById('banner-form-overlay').classList.remove('active');
}

function guardarBannerForm(){
  const texto = document.getElementById('bf-texto').value.trim();
  if(!texto){
    mostrarToastError('El texto del banner es obligatorio');
    return;
  }

  let id = document.getElementById('bf-id').value;
  const datos = {
    id: id || ('b_' + Date.now()),
    texto,
    icono: document.getElementById('bf-icono').value.trim(),
    separador: document.getElementById('bf-separador').value,
    color: document.getElementById('bf-color').value,
    tamano: parseInt(document.getElementById('bf-tamano').value) || 14,
    link: document.getElementById('bf-link').value.trim(),
    bold: document.getElementById('bf-bold').checked,
    italic: document.getElementById('bf-italic').checked,
    uppercase: document.getElementById('bf-uppercase').checked,
    badge: document.getElementById('bf-badge').checked,
    glow: document.getElementById('bf-glow').checked,
  };

  if(id){
    const idx = marqueeBannersTemp.findIndex(x => x.id === id);
    if(idx > -1){
      datos.visible = marqueeBannersTemp[idx].visible;
      datos.orden = marqueeBannersTemp[idx].orden;
      marqueeBannersTemp[idx] = datos;
    }
  } else {
    datos.visible = true;
    datos.orden = marqueeBannersTemp.length;
    marqueeBannersTemp.push(datos);
  }

  document.getElementById('banner-form-overlay').classList.remove('active');
  renderMarqueeBannerList();
  previewMarqueeConfig();
}

// ── Guardar todo en Firebase ──────────────────────────────
async function guardarMarqueeConfig(){
  marqueeConfig.activo    = document.getElementById('mq-activo').checked;
  marqueeConfig.velocidad = parseInt(document.getElementById('mq-velocidad').value) || 30;
  marqueeConfig.altura    = parseInt(document.getElementById('mq-altura').value) || 38;
  marqueeConfig.fondo     = document.getElementById('mq-fondo').value;
  marqueeConfig.banners   = marqueeBannersTemp;

  mostrarToast('Guardando cinta promocional…');
  try {
    await MARQUEE_REF.set({
      activo: marqueeConfig.activo,
      velocidad: marqueeConfig.velocidad,
      altura: marqueeConfig.altura,
      fondo: marqueeConfig.fondo,
      banners: marqueeConfig.banners
    });
    renderMarqueePublico();
    document.getElementById('marquee-modal-overlay').classList.remove('active');
    mostrarToast('Cinta promocional guardada ✓');
  } catch(err){
    console.error('Error guardando cinta promocional:', err);
    mostrarToastError('⚠ Error al guardar. Revisá la conexión.', 7000);
  }
}




// ════════════════════════════════════════════════════════════════
//  MENÚ HAMBURGUESA (mobile) + DROPDOWN DESKTOP (categorías)
// ════════════════════════════════════════════════════════════════

function initDropdownListeners() {
  // El dropdown ahora es puro CSS :hover — no necesita JS para abrirse/cerrarse.
  // Solo necesitamos poblar las categorías la primera vez que se hace hover.
  const li = document.getElementById('nav-productos-li');
  if (!li) return;
  let built = false;
  li.addEventListener('mouseenter', () => {
    if (!built) { buildNavCategoryMenus(); built = true; }
  });
}

function buildNavCategoryMenus() {
  const cats = getCategorias().filter(c => !categoriasOcultas.includes(c));

  // ── Desktop dropdown ──
  const desktopEl = document.getElementById('nav-dropdown-cats');
  if (desktopEl) {
    desktopEl.innerHTML = '';
    cats.forEach(cat => {
      const a = document.createElement('a');
      a.className = 'nav-dropdown-item';
      a.textContent = cat;
      a.addEventListener('click', () => irACategoria(cat));
      desktopEl.appendChild(a);
    });
  }

  // ── Mobile menu ──
  const mobileEl = document.getElementById('mobile-menu-cats');
  if (mobileEl) {
    mobileEl.innerHTML = '';
    // "Todos los productos" primero
    const btnTodos = document.createElement('button');
    btnTodos.className = 'mobile-menu-cat-item mobile-menu-cat-todos';
    btnTodos.textContent = 'Todos los productos';
    btnTodos.addEventListener('click', () => { closeMobileMenu(); irATodosLosProductos(); });
    mobileEl.appendChild(btnTodos);
    // Separador
    const sep = document.createElement('div');
    sep.className = 'mobile-menu-cat-sep';
    mobileEl.appendChild(sep);
    // Categorías individuales
    cats.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'mobile-menu-cat-item';
      btn.textContent = cat;
      btn.addEventListener('click', () => { closeMobileMenu(); irACategoria(cat); });
      mobileEl.appendChild(btn);
    });
  }
}

function closeDesktopDropdown() {
  // No-op: el dropdown se cierra solo con CSS :hover
}

function irACategoria(catName) {
  const sectionId = 'section-' + getCatId(catName);
  const section = document.getElementById(sectionId);
  if (section) {
    const offset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--body-push-top')) || 0;
    const top = section.getBoundingClientRect().top + window.scrollY - offset - 30;
    window.scrollTo({ top, behavior: 'smooth' });
  } else {
    scrollToSection('productos');
    setTimeout(() => irACategoria(catName), 600);
  }
}

function irATodosLosProductos() {
  const section = document.getElementById('section-todos');
  if (section) {
    const offset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--body-push-top')) || 0;
    const top = section.getBoundingClientRect().top + window.scrollY - offset - 30;
    window.scrollTo({ top, behavior: 'smooth' });
  } else {
    scrollToSection('productos');
  }
}

function toggleMobileMenu() {
  const menu = document.getElementById('mobile-menu');
  const overlay = document.getElementById('mobile-menu-overlay');
  const btn = document.getElementById('nav-hamburger');
  const isOpen = menu.classList.contains('active');
  if (isOpen) {
    closeMobileMenu();
  } else {
    buildNavCategoryMenus();
    menu.classList.add('active');
    overlay.classList.add('active');
    btn.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeMobileMenu() {
  const menu = document.getElementById('mobile-menu');
  const overlay = document.getElementById('mobile-menu-overlay');
  const btn = document.getElementById('nav-hamburger');
  menu.classList.remove('active');
  overlay.classList.remove('active');
  btn.classList.remove('active');
  document.body.style.overflow = '';
}

// Inicializar listeners del dropdown cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDropdownListeners);
} else {
  initDropdownListeners();
}

// Hook sobre buildAllCarousels para reconstruir los menús
(function patchBuildAll() {
  const origFn = window.buildAllCarousels;
  if (origFn) {
    window.buildAllCarousels = function() {
      origFn.apply(this, arguments);
      setTimeout(buildNavCategoryMenus, 200);
    };
  }
})();

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMobileMenu(); });



// ════════════════════════════════════════════════════════
//  ADMIN — Herramientas (Cloudinary, migración, índice)
// ════════════════════════════════════════════════════════
function toolsLog(msg){
  const el = document.getElementById('tools-log');
  if(el) el.innerHTML = msg;
}

// Logos / imagen de Nosotros que todavía están en base64
function fotosBase64DePagina(){
  const C = SITE_CONFIG;
  return [
    ['nosotrosImg', '_nosotrosImg'],
    ['heroLogoImg', '_heroLogoImg'],
    ['navLogoImg',  '_navLogoImg']
  ].filter(([, k]) => esBase64(C[k]));
}

async function actualizarEstadoHerramientas(){
  const cldEl = document.getElementById('tools-cld-estado');
  const b64El = document.getElementById('tools-b64-estado');
  const btnMigrar = document.getElementById('tools-btn-migrar');
  if(cldEl){
    try {
      const snap = await CLOUDINARY_REF.get({ source: 'server' });
      const d = snap.exists ? snap.data() : null;
      if(d && d.cloudName && d.preset){
        cldConfig = { cloudName: d.cloudName, preset: d.preset };
        cldEl.innerHTML = `Configurado ✓ — cloud name: <strong>${esc(d.cloudName)}</strong> · preset: <strong>${esc(d.preset)}</strong>`;
      } else {
        cldEl.textContent = 'Sin configurar. Se te va a pedir la primera vez que subas una foto (o tocá "Configurar Cloudinary").';
      }
    } catch(err){
      cldEl.textContent = 'No se pudo leer la configuración (¿publicaste la regla de "privado" en Firestore?).';
    }
  }
  const nProd = contarFotosBase64();
  const nPag  = fotosBase64DePagina().length;
  if(b64El){
    b64El.textContent = (nProd + nPag) === 0
      ? 'Todas las fotos ya están en Cloudinary ✓'
      : `Pendientes: ${nProd} foto${nProd !== 1 ? 's' : ''} de productos y ${nPag} imagen${nPag !== 1 ? 'es' : ''} de la página (formato viejo base64).`;
  }
  if(btnMigrar) btnMigrar.disabled = (nProd + nPag) === 0;
}

async function abrirModalHerramientas(){
  document.getElementById('tools-modal').classList.add('active');
  toolsLog('');
  const b64El = document.getElementById('tools-b64-estado');
  if(b64El) b64El.textContent = 'Sincronizando catálogo…';
  try { await esperarAdminListo(); } catch(e) {}
  actualizarEstadoHerramientas();
}

function cerrarModalHerramientas(e){
  if(e.target.id !== 'tools-modal') return;
  document.getElementById('tools-modal').classList.remove('active');
}

async function cambiarConfigCloudinary(){
  try {
    await configurarCloudinary();
    mostrarToast('Cloudinary configurado ✓');
  } catch(err){
    mostrarToastError('⚠ ' + esc(err.message), 6000);
  }
  actualizarEstadoHerramientas();
}

// Sube a Cloudinary todas las fotos base64 (productos + logos/Nosotros).
// Guarda producto por producto: si se corta, al volver a tocar el botón
// sigue desde donde quedó.
async function migrarFotosACloudinary(){
  const btn = document.getElementById('tools-btn-migrar');
  if(btn) btn.disabled = true;
  try {
    await esperarAdminListo();
    await obtenerCloudinary();

    const pendientes = productos.filter(p => {
      const lista = Array.isArray(p.imgs) && p.imgs.length ? p.imgs : [p.img];
      return lista.some(esBase64);
    });

    for(let i = 0; i < pendientes.length; i++){
      const p = pendientes[i];
      toolsLog(`Producto ${i + 1} de ${pendientes.length}: <strong>${esc(p.nombre)}</strong>…`);
      const lista = Array.isArray(p.imgs) && p.imgs.length ? p.imgs : [p.img];
      const urls = await subirFotosPendientes(lista.filter(Boolean));
      p.imgs = urls;
      p.img  = urls[0] || '';
      // Solo el doc del item (el índice se regenera una vez al final)
      await PRODS_COL.doc(p.id).set(productoParaIndice(p));
    }

    // Imágenes de la página (siteConfig)
    const pag = fotosBase64DePagina();
    if(pag.length){
      const cambios = {};
      for(let i = 0; i < pag.length; i++){
        const [campo, clave] = pag[i];
        toolsLog(`Imagen de la página ${i + 1} de ${pag.length}…`);
        const url = await subirImagenCloudinary(SITE_CONFIG[clave]);
        SITE_CONFIG[clave] = url;
        cambios[campo] = url;
      }
      await CONFIG_REF.set(cambios, { merge: true });
      try { localStorage.removeItem(LS('config_cache')); } catch(e) {}
    }

    toolsLog('Regenerando el catálogo público…');
    await commitCambios([]);
    buildAllCarousels();
    applyConfig();
    toolsLog(`Listo ✓ — ${pendientes.length} producto${pendientes.length !== 1 ? 's' : ''} migrado${pendientes.length !== 1 ? 's' : ''}${pag.length ? ` y ${pag.length} imagen${pag.length !== 1 ? 'es' : ''} de la página` : ''}.`);
    mostrarToast('Migración completa ✓');
  } catch(err){
    console.error('Error migrando fotos:', err);
    toolsLog('⚠ Se cortó la migración: ' + esc(err.message) + '<br>Lo ya migrado quedó guardado. Volvé a tocar el botón para seguir.');
  } finally {
    actualizarEstadoHerramientas();
  }
}

// Vuelve a armar catalogo/_indice leyendo la colección completa
async function reconstruirIndice(){
  try {
    toolsLog('Leyendo todos los productos…');
    await esperarAdminListo();
    productos = await leerColeccionCompleta();
    await commitCambios([]);
    await guardarMetaEnFirebase();
    buildAllCarousels();
    toolsLog(`Índice regenerado ✓ (${productos.length} productos).`);
  } catch(err){
    console.error('Error regenerando índice:', err);
    toolsLog('⚠ No se pudo regenerar: ' + esc(err.message));
  }
  actualizarEstadoHerramientas();
}
