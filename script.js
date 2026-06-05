// ════════════════════════════════════════════════════════
//  CONFIGURACIÓN FIREBASE — viene de config.js
// ════════════════════════════════════════════════════════
firebase.initializeApp(SITE_CONFIG.firebase);
const db = firebase.firestore();
// Cada producto es un documento en la subcolección "productos"
// La metadata (categorías, orden, etc.) va en un doc separado "__meta__"
const PRODS_COL = db.collection('catalogo').doc('productos').collection('items');
const META_REF  = db.collection('catalogo').doc('_meta');
const auth = firebase.auth();


//MANTENER SESIÓN
auth.onAuthStateChanged(user => {
  if(user && ADMIN_REQUEST){
    ADMIN_MODE = true;
    document.body.classList.add('admin');
    document.getElementById('admin-bar').style.display = 'flex';
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
let productos = [];
let carrito = []; // Variable global para guardar el pedido
let posCarrusel = {};       // { catId: posicion }
let carruselProds = {};     // { catId: [productos del carrusel] }

// ── PAGINACIÓN por carrusel ────────────────────────────────────
// catKey = nombre de categoría (o 'todos')
const paginacion = {};
// paginacion[catKey] = { lastDoc, agotado, cargando }

let categoriasOcultas = []; // nombres de categorías ocultas
let categoriaOrden = [];    // orden personalizado de categorías
let ordenCategorias = {};
let productosOcultos = [];  // IDs de productos ocultos individualmente

const params = new URLSearchParams(location.search);
const ADMIN_REQUEST = params.has('admin');
let ADMIN_MODE = false;



// ════════════════════════════════════════════════════════
//  APLICAR CONFIG — llena todos los textos y colores
//  desde config.js al cargar la página
// ════════════════════════════════════════════════════════
function applyConfig() {
  const C = SITE_CONFIG;

  // Título del browser
  document.title = `${C.marcaPrincipal} ${C.marcaItalica}`;

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
    gfonts.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  }

  document.body.style.fontFamily = `'${T.cuerpo || 'Jost'}', sans-serif`;

  // Colores CSS (sobreescribe el :root del CSS)
  applyColores(C.colores);

  // ── NAV ──────────────────────────────────────────────
  const navLogoContainer = document.getElementById('nav-logo');
  if (C._navLogoImg) {
    navLogoContainer.innerHTML = `<img src="${C._navLogoImg}" class="nav-logo-img" alt="Logo"> ${C.marcaPrincipal} <span>${C.marcaItalica}</span>`;
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
  if(C._heroLogoImg){
    heroTitleText.style.display = 'none';
    heroTitleImgWrap.style.display = 'block';
    heroTitleImg.src = C._heroLogoImg;
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
  document.getElementById('nosotros-parrafos').innerHTML =
    C.nosotros.parrafos.map(p => `<p>${p}</p>`).join('');
  document.getElementById('nosotros-stats').innerHTML =
    C.nosotros.stats.map(s => `
      <div class="about-stat" style="display:inline-flex">
        <span class="stat-num">${s.num}</span>
        <span class="stat-label">${s.label}</span>
      </div>`).join('');

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
// Carga metadata + primer batch de cada categoría conocida
async function cargarDesdeFirebase(){
  // 1. Metadata (1 lectura)
  try {
    const metaSnap = await META_REF.get({ source: 'server' });
    if(metaSnap.exists){
      const m = metaSnap.data();
      categoriasOcultas = Array.isArray(m.categoriasOcultas) ? m.categoriasOcultas : [];
      categoriaOrden    = Array.isArray(m.categoriaOrden)    ? m.categoriaOrden    : [];
      ordenCategorias   = m.ordenCategorias || {};
      productosOcultos  = Array.isArray(m.productosOcultos)  ? m.productosOcultos  : [];
      // Categorías conocidas vienen del meta para no necesitar un query extra
      if(Array.isArray(m.categorias) && m.categorias.length){
        // Cargar primer batch por cada categoría en paralelo
        const batches = await Promise.all(
          m.categorias.map(cat => cargarBatchCategoria(cat))
        );
        batches.forEach((prods, i) => {
          prods.forEach(p => {
            if(!productos.find(x => x.id === p.id)) productos.push(p);
          });
        });
        return productos;
      }
    } else {
      await META_REF.set({ categoriasOcultas: [], categoriaOrden: [], ordenCategorias: {}, productosOcultos: [], categorias: [] });
    }
  } catch(err) {
    console.warn('No se pudo cargar metadata:', err);
  }

  // Fallback: si no hay categorías en meta, carga todo (primera vez o base vieja)
  const prodsSnap = await PRODS_COL.get({ source: 'server' });
  if(prodsSnap.empty) return [];
  return prodsSnap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
}

// Carga un batch de N productos para UNA categoría
async function cargarBatchCategoria(cat, lastDoc = null){
  const BATCH = (SITE_CONFIG.paginacionBatch || 6);
  let q = PRODS_COL
    .where('tipos', 'array-contains', cat)
    .orderBy('nombre')
    .limit(BATCH);
  if(lastDoc) q = q.startAfter(lastDoc);

  const snap = await q.get({ source: 'server' });
  const docs  = snap.docs;
  const prods = docs.map(d => ({ ...d.data(), id: d.id }));

  // Guardar cursor para siguiente batch
  if(!paginacion[cat]) paginacion[cat] = {};
  paginacion[cat].lastDoc  = docs.length ? docs[docs.length - 1] : paginacion[cat].lastDoc;
  paginacion[cat].agotado  = docs.length < BATCH;
  paginacion[cat].cargando = false;

  return prods;
}

// Carga el siguiente batch para una categoría y agrega al carrusel
async function cargarMasEnCategoria(cat){
  const estado = paginacion[cat];
  if(!estado || estado.agotado || estado.cargando) return;

  estado.cargando = true;
  const nuevos = await cargarBatchCategoria(cat, estado.lastDoc);

  if(!nuevos.length){ estado.agotado = true; return; }

  // Agregar a la lista global sin duplicados
  nuevos.forEach(p => {
    if(!productos.find(x => x.id === p.id)) productos.push(p);
  });

  // Agregar las cards nuevas directamente al track (sin reconstruir todo)
  const catId  = getCatId(cat);
  const track  = document.getElementById('carrusel-track-' + catId);
  if(!track) return;
  const cardW = getCardWidth();
  nuevos.forEach(p => {
    if(productosOcultos.includes(p.id) && !ADMIN_MODE) return;
    const card = crearCard(p, false);
    card.style.flex = `0 0 ${cardW}px`;
    track.appendChild(card);
    carruselProds[catId].push(p);
  });

  // Actualizar botones (podrían haberse ocultado si solo había 1 pantalla)
  const visible = visiblePorPantalla();
  const total   = carruselProds[catId].length;
  const btnPrev = document.getElementById('btn-prev-' + catId);
  const btnNext = document.getElementById('btn-next-' + catId);
  if(btnPrev) btnPrev.style.display = total <= visible ? 'none' : '';
  if(btnNext) btnNext.style.display = total <= visible ? 'none' : '';
}

// Guarda SOLO la metadata (categorías, orden, visibilidad)
async function guardarMetaEnFirebase(){
  // Recalcular lista de categorías conocidas para el loader paginado
  const cats = getCategorias();
  await META_REF.set({
    categoriasOcultas,
    categoriaOrden,
    ordenCategorias,
    productosOcultos,
    categorias: cats
  });
}

// Guarda/actualiza UN producto en su propio documento
async function guardarProductoEnFirebase(prod){
  const docRef = prod.id
    ? PRODS_COL.doc(prod.id)
    : PRODS_COL.doc();                // nuevo ID automático
  if(!prod.id) prod.id = docRef.id;   // guardar el ID en el objeto
  await docRef.set(prod);
  return prod;
}

// Elimina UN producto de Firestore
async function eliminarProductoEnFirebase(prodId){
  await PRODS_COL.doc(prodId).delete();
}

// Guarda TODO (batch): útil para restaurar o migrar desde formato legacy
async function guardarEnFirebase(){
  try {
    const batch = db.batch();

    // 1. Metadata
    batch.set(META_REF, {
      categoriasOcultas,
      categoriaOrden,
      ordenCategorias,
      productosOcultos
    });

    // 2. Obtener IDs actuales en Firestore para detectar eliminados
    const existentes = await PRODS_COL.get({ source: 'server' });
    const idsEnFirestore = new Set(existentes.docs.map(d => d.id));
    const idsActuales    = new Set(productos.map(p => p.id).filter(Boolean));

    // Eliminar los que ya no están en memoria
    existentes.docs.forEach(doc => {
      if(!idsActuales.has(doc.id)) batch.delete(doc.ref);
    });

    // Crear o actualizar cada producto
    productos.forEach(p => {
      if(!p.id){
        const ref = PRODS_COL.doc();
        p.id = ref.id;
        batch.set(ref, p);
      } else {
        batch.set(PRODS_COL.doc(p.id), p);
      }
    });

    await batch.commit();
    return true;
  } catch(err) {
    console.error('Error guardando en Firebase:', err);
    mostrarToastError('⚠ Error al guardar. Mala conexión, límite excedido de imágenes o superposicion de pestañas.<br>Revise conexión a internet, cierre las demás pestañas y vuelva a iniciar sesión en modo administrador.', 20000);
    return false;
  }
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
    document.getElementById('admin-bar').style.display = 'flex';
    buildAllCarousels(); // reconstruir cards con botones de admin
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

  // CAMBIO 2 — mostrar caché inmediatamente si existe
  const cache = localStorage.getItem('productos_cache');
  if (cache) {
    try {
      productos = JSON.parse(cache);
      const loadingEl = document.getElementById('carrusel-loading');
      if (loadingEl) loadingEl.style.display = 'none';
      buildAllCarousels();
    } catch(e) {}
  }

  try {
    productos = await cargarDesdeFirebase();
    productos.forEach((p, i) => {
      if(!p.id){
        p.id = 'prod_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2,8);
      }
    });
    // CAMBIO 1 — guardar en caché
    try {
      localStorage.setItem('productos_cache', JSON.stringify(productos));
    } catch(e) {}
    //if(ADMIN_MODE){
    //  await guardarEnFirebase();
    //}

    // CAMBIO 3 — redibujar solo si Firebase trajo algo distinto al caché
    if (cache !== JSON.stringify(productos)) {
      const loadingEl = document.getElementById('carrusel-loading');
      if (loadingEl) loadingEl.style.display = 'none';
      buildAllCarousels();
    }

  } catch(err){
    console.warn('Primer intento fallido, reintentando...', err);
    try {
      await new Promise(r => setTimeout(r, 1200));
      productos = await cargarDesdeFirebase();
      try {
        localStorage.setItem('productos_cache', JSON.stringify(productos));
      } catch(e) {}
    } catch(err2){
      console.error('Error cargando Firebase:', err2);
      productos = productosDefault.map(p => ({...p}));
    }
  }

  const loadingEl = document.getElementById('carrusel-loading');
  if (loadingEl) loadingEl.style.display = 'none';
  buildAllCarousels();
}

document.addEventListener('DOMContentLoaded', async () => {
  await cargarConfigEditable();
  applyConfig();
  await inicializar();      
  if(ADMIN_REQUEST){ pedirLoginAdmin(); }
  animarHero();
});

// ════════════════════════════════════════════════════════
//  ANIMACIÓN HERO — entrada única y armoniosa
//  Espera a que la imagen del logo esté lista antes de
//  arrancar, para que todo aparezca junto en cascada.
// ════════════════════════════════════════════════════════
function animarHero(){
  const elementos = [
    document.getElementById('hero-eyebrow-1'),
    document.getElementById('hero-eyebrow-2'),
    document.getElementById('hero-title'),
    document.getElementById('hero-title-img-wrap'),
    document.getElementById('hero-subtitle'),
    document.querySelector('.hero-cta'),
    document.querySelector('.hero-scroll'),
  ].filter(Boolean);

  const DELAY_BASE  = 110; // ms entre cada elemento
  const DELAY_START = 80;  // ms antes de arrancar

  function disparar(){
    // Filtramos primero los visibles para que el offset sea continuo sin huecos
    const visibles = elementos.filter(el => el.style.display !== 'none');
    visibles.forEach((el, i) => {
      setTimeout(() => el.classList.add('hero-visible'), DELAY_START + i * DELAY_BASE);
    });
  }

  // Si hay imagen en el hero, esperamos a que cargue antes de animar
  const heroImg = document.getElementById('hero-title-img');
  const imgWrap = document.getElementById('hero-title-img-wrap');
  if(imgWrap && imgWrap.style.display !== 'none' && heroImg && heroImg.src && heroImg.src !== window.location.href){
    if(heroImg.complete && heroImg.naturalWidth > 0){
      disparar();
    } else {
      let fired = false;
      const once = () => { if(!fired){ fired = true; disparar(); } };
      heroImg.addEventListener('load',  once, { once: true });
      heroImg.addEventListener('error', once, { once: true });
      // Safety: si tarda más de 1.5s arrancamos igual
      setTimeout(once, 1500);
    }
  } else {
    disparar();
  }
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => buildAllCarousels(), 150);
});



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
  if(categoriaOrden.length > 0){
    const ordenadas = categoriaOrden.filter(c => cats.includes(c));
    const nuevas = cats.filter(c => !categoriaOrden.includes(c));
    return [...ordenadas, ...nuevas];
  }
  return cats;
}

function visiblePorPantalla(){
  if(window.innerWidth <= 768)  return 1;
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

    // ← catNombre agregado
    toInit.push({ catId, catNombre: cat, prods: [...prods] });
  });

  // "Todos los productos" al final
  if(productos.length > 0){
    const section = crearSeccionCarrusel('Todos los productos', 'todos', visibles.length > 0);
    container.appendChild(section);

    // ← catNombre: 'todos' (no pagina contra Firestore)
    toInit.push({ catId: 'todos', catNombre: 'todos', prods: [...productos] });
  }

  // Construir tracks + eventos
  toInit.forEach(({ catId, catNombre, prods }) => {

    buildTrack(catId, prods);

    const track = document.getElementById('carrusel-track-' + catId);
    if(!track) return;

    // ── Touch (mobile) ──────────────────────────────────────────
    let startX = 0;
    track.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
    }, { passive: true });

    track.addEventListener('touchend', e => {
      const diff = startX - e.changedTouches[0].clientX;
      if(Math.abs(diff) > 40) moverCarrusel(catId, diff > 0 ? 1 : -1);
    });

    // ── Lazy load al scroll horizontal ─────────────────────────
    // Solo para categorías reales (no "todos", que ya está en memoria)
    if(catNombre === 'todos') return;

    const outer = track.closest('.carrusel-track-outer');
    if(!outer) return;

    outer.addEventListener('scroll', () => {
      const total   = carruselProds[catId]?.length || 0;
      const pos     = posCarrusel[catId] || 0;
      const visible = visiblePorPantalla();
      // Dispara cuando quedan ≤2 cards para llegar al final
      if(total - pos - visible <= 2){
        cargarMasEnCategoria(catNombre);
      }
    }, { passive: true });

  });
}

function crearSeccionCarrusel(cat, catId, showDivider){
  const section = document.createElement('div');
  section.className = 'cat-section';
  section.id = 'section-' + catId;

  if(showDivider){
    const d = document.createElement('div');
    d.className = 'cat-divider';
    section.appendChild(d);
  }

  const header = document.createElement('div');
  header.className = 'cat-section-header';
  header.innerHTML = `<span class="section-label cat-label">${cat}</span>`;
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

  prodsVisibles.forEach(p => {
    const card = crearCard(p, false);
    card.style.flex = `0 0 ${cardW}px`;
    track.appendChild(card);
  });

  const btnPrev = document.getElementById('btn-prev-' + catId);
  const btnNext = document.getElementById('btn-next-' + catId);
  const ocultar = prodsVisibles.length <= visible;
  if(btnPrev) btnPrev.style.display = ocultar ? 'none' : '';
  if(btnNext) btnNext.style.display = ocultar ? 'none' : '';
}

function crearCard(p, esClonado){
  const card = document.createElement('div');
  const estaOculto = productosOcultos.includes(p.id);
  card.className = 'producto-card' + (estaOculto ? ' producto-oculto' : '');
  card.innerHTML = `
    <div class="prod-img-placeholder">
      <img src="${p.img}" alt="${p.nombre}">
    </div>
    <div class="prod-info">
      <div class="prod-tipo">${Array.isArray(p.tipos) ? p.tipos[0] : p.tipo}</div>
      <div class="prod-name">${p.nombre}</div>
    </div>
    <div class="prod-overlay">
      <h3>${p.nombre}</h3>
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

function getCardWidth(){
  const gap = 20;
  const visible = visiblePorPantalla();
  const padding = window.innerWidth <= 768 ? 48 : 128;
  const containerW = Math.min(window.innerWidth - padding, 1100);
  return (containerW - gap * (visible - 1)) / visible;
}

function actualizarCarrusel(catId){
  const track = document.getElementById('carrusel-track-' + catId);
  if(!track) return;
  const outer  = track.closest('.carrusel-track-outer');
  const cardW  = getCardWidth();
  Array.from(track.children).forEach(c => c.style.flex = `0 0 ${cardW}px`);
  if(outer) outer.scrollLeft = (posCarrusel[catId] || 0) * (cardW + 20);
}

function moverCarrusel(catId, dir){
  const prods   = carruselProds[catId] || [];
  const visible = visiblePorPantalla();
  if(prods.length <= visible) return;

  posCarrusel[catId] = Math.max(0, Math.min((posCarrusel[catId] || 0) + dir, prods.length - visible));

  const track = document.getElementById('carrusel-track-' + catId);
  const outer = track?.closest('.carrusel-track-outer');
  if(outer) outer.scrollLeft = posCarrusel[catId] * (getCardWidth() + 20);
}

// ════════════════════════════════════════════════════════
//  MODAL PRODUCTO
// ════════════════════════════════════════════════════════
function openModal(p){
  document.getElementById('modal-tipo').textContent  = Array.isArray(p.tipos) ? p.tipos.join(' · ') : p.tipo;
  document.getElementById('modal-title').textContent = p.nombre;
  document.getElementById('modal-precio').textContent = p.precio ? p.precio : '';
  document.getElementById('modal-desc').textContent  = p.desc;
  
  const imgContainer = document.getElementById('modal-img');
  const imgs = p.imgs && p.imgs.length > 0 ? p.imgs : [p.img];
  
  if(imgs.length <= 1){
    imgContainer.innerHTML = `<img src="${imgs[0]}" style="width:100%;height:100%;object-fit:cover;">`;
  } else {
    let dotsHTML = imgs.map((_,i) => `<div class="modal-dot${i===0?' active':''}" onclick="modalCarouselGo(${i})"></div>`).join('');
    let imgsHTML = imgs.map((src,i) => `<img src="${src}" class="${i===0?'active':''}" alt="">`).join('');
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
  document.getElementById('modal').classList.add('active');
  document.getElementById('modal-add-cart').onclick = () => agregarAlCarrito(p);
  document.body.style.overflow = 'hidden';
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
  carousel.querySelectorAll('img').forEach((img, i) => img.classList.toggle('active', i === idx));
  carousel.querySelectorAll('.modal-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
}

function closeModal(e){
  if(e.target === document.getElementById('modal')){
    document.getElementById('modal').classList.remove('active');
    document.body.style.overflow = '';
  }
}

document.querySelector('.modal-close').addEventListener('click', () => {
  document.getElementById('modal').classList.remove('active');
  document.body.style.overflow = '';
});

function scrollToSection(id){
  document.getElementById(id).scrollIntoView({behavior:'smooth'});
}

// ════════════════════════════════════════════════════════
//  ADMIN — Eliminar
// ════════════════════════════════════════════════════════
async function eliminarProducto(p){
  if(!confirm(`¿Eliminar "${p.nombre}" del catálogo?`)) return;
  const idx = productos.indexOf(p);
  if(idx > -1) productos.splice(idx, 1);
  buildAllCarousels();
  mostrarToast('Guardando…');
  try {
    if(p.id) await eliminarProductoEnFirebase(p.id);
    await guardarMetaEnFirebase();
    mostrarToast('Producto eliminado ✓');
  } catch(err) {
    console.error('Error eliminando producto:', err);
    mostrarToastError('⚠ Error al eliminar. Revisá la conexión.', 5000);
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
  card.classList.toggle('producto-oculto', ahoraOculto);
  btn.classList.toggle('is-hidden', ahoraOculto);
  btn.title = ahoraOculto ? 'Producto oculto — clic para mostrar' : 'Ocultar producto';
  btn.innerHTML = ahoraOculto
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

  // Actualizar o quitar el badge "No visible"
  const badgeExistente = card.querySelector('.oculto-badge');
  if(ahoraOculto && !badgeExistente){
    const badge = document.createElement('div');
    badge.className = 'oculto-badge';
    badge.textContent = 'No visible';
    card.appendChild(badge);
  } else if(!ahoraOculto && badgeExistente){
    badgeExistente.remove();
  }

  mostrarToast('Guardando…');
  try {
    await guardarMetaEnFirebase();
    mostrarToast(ahoraOculto ? 'Producto ocultado ✓' : 'Producto visible ✓');
  } catch(err) {
    console.error('Error guardando visibilidad:', err);
    mostrarToastError('⚠ Error al guardar. Revisá la conexión.', 5000);
  }
}


let fotosBase64 = [];      // array de todas las fotos
let portadaIdx = 0;        // índice de la foto de portada
let productoEditando = null;

function abrirModalAgregar(){
  productoEditando = null;
  fotosBase64 = [];
  portadaIdx = 0;
  document.getElementById('a-nombre').value = '';
  document.getElementById('a-desc').value   = '';
  poblarSelectTipo('');
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
  renderFotosGrid();
  document.querySelector('.admin-modal h2').textContent = 'Nuevo producto';
}

function agregarFotos(e){
  const files = Array.from(e.target.files);
  if(!files.length) return;
  let pending = files.length;
  files.forEach(file => {
    comprimirImagen(file, base64 => {
      fotosBase64.push(base64);
      pending--;
      if(pending === 0){
        if(fotosBase64.length === files.length) portadaIdx = 0;
        renderFotosGrid();
        document.getElementById('a-foto-texto').textContent = `${fotosBase64.length} imagen${fotosBase64.length!==1?'es':''} cargada${fotosBase64.length!==1?'s':''}`;
      }
    });
  });
  e.target.value = '';
}

function renderFotosGrid(){
  const grid = document.getElementById('fotos-preview-grid');
  if(!grid) return;
  grid.innerHTML = '';
  fotosBase64.forEach((src, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'foto-thumb-wrap' + (i === portadaIdx ? ' is-portada' : '');
    wrap.title = 'Clic para marcar como portada';
    wrap.innerHTML = `
      <img src="${src}" class="${i === portadaIdx ? 'portada-activa' : ''}" alt="">
      <button class="foto-thumb-remove" title="Eliminar foto">×</button>
      ${i === portadaIdx ? '<span class="portada-badge">Portada</span>' : ''}`;
    wrap.querySelector('img').addEventListener('click', () => { portadaIdx = i; renderFotosGrid(); });
    wrap.querySelector('.foto-thumb-remove').addEventListener('click', e => {
      e.stopPropagation();
      fotosBase64.splice(i, 1);
      if(portadaIdx >= fotosBase64.length) portadaIdx = Math.max(0, fotosBase64.length - 1);
      renderFotosGrid();
      document.getElementById('a-foto-texto').textContent = fotosBase64.length === 0
        ? 'Hacé clic para subir imágenes'
        : `${fotosBase64.length} imagen${fotosBase64.length!==1?'es':''} cargada${fotosBase64.length!==1?'s':''}`;
    });
    grid.appendChild(wrap);
  });
}

function comprimirImagen(file, callback){
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const MAX = 900;
      let w = img.width, h = img.height;
      if(w > MAX){ h = Math.round(h * MAX / w); w = MAX; }
      if(h > MAX){ w = Math.round(w * MAX / h); h = MAX; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL('image/jpeg', 0.78));
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// Igual que comprimirImagen pero exporta PNG para preservar transparencia (ej: logo hero)
function comprimirImagenPNG(file, callback){
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const MAX = 600;
      let w = img.width, h = img.height;
      if(w > MAX){ h = Math.round(h * MAX / w); w = MAX; }
      if(h > MAX){ w = Math.round(w * MAX / h); h = MAX; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h); // asegura fondo transparente
      ctx.drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL('image/png'));
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
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
  const todas = [...new Set([...opcionesFijas, ...extras])];

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
  if(nuevaCatInput) tiposSeleccionados.push(nuevaCatInput);

  if(!nombre)    { alert('Por favor ingresá el nombre del producto.'); return; }
  if(!tiposSeleccionados.length){ alert('Por favor seleccioná al menos una categoría.'); return; }
  if(!desc)      { alert('Por favor escribí una descripción.'); return; }
  if(!fotosBase64.length){ alert('Por favor subí al menos una foto del producto.'); return; }

  const reordenadas = [fotosBase64[portadaIdx], ...fotosBase64.filter((_,i)=>i!==portadaIdx)];
  const imgPortada = reordenadas[0];

  if(productoEditando){
    productoEditando.nombre = nombre;
    productoEditando.tipos  = tiposSeleccionados;
    productoEditando.tipo   = tiposSeleccionados[0]; // compatibilidad legacy
    productoEditando.desc   = desc;
    productoEditando.precio = precio;
    productoEditando.img    = imgPortada;
    productoEditando.imgs   = reordenadas;
  } else {
    productos.push({
      nombre,
      precio,
      tipo: tiposSeleccionados[0],
      tipos: tiposSeleccionados,
      desc,
      img: imgPortada,
      imgs: reordenadas
    });
  }

  buildAllCarousels();
  document.getElementById('admin-modal').classList.remove('active');
  mostrarToast('Guardando…');
  try {
    // Guardar solo el producto que cambió (no toda la lista)
    const prodTarget = productoEditando || productos[productos.length - 1];
    await guardarProductoEnFirebase(prodTarget);
    await guardarMetaEnFirebase();
    mostrarToast('Producto guardado ✓');
    setTimeout(() => scrollToSection('productos'), 300);
  } catch(err) {
    console.error('Error guardando producto:', err);
    mostrarToastError('⚠ Error al guardar. Mala conexión, límite excedido de imágenes o superposicion de pestañas.<br>Revise conexión a internet, cierre las demás pestañas y vuelva a iniciar sesión en modo administrador.', 20000);
  }
  productoEditando = null;
  fotosBase64 = [];
  portadaIdx = 0;
  renderFotosGrid();
  document.querySelector('.admin-modal h2').textContent = 'Nuevo producto';
}

function abrirModalEditar(p){
  productoEditando = p;
  document.getElementById('a-nombre').value = p.nombre;
  document.getElementById('a-precio').value = (p.precio || '').replace('$','');
  const tiposActuales = Array.isArray(p.tipos) ? p.tipos : [p.tipo];
  poblarSelectTipo(tiposActuales);
  document.getElementById('a-desc').value   = p.desc;
  fotosBase64 = p.imgs && p.imgs.length > 0 ? [...p.imgs] : [p.img];
  portadaIdx = 0;
  renderFotosGrid();
  document.getElementById('a-foto-texto').textContent = `${fotosBase64.length} imagen${fotosBase64.length!==1?'es':''} cargada${fotosBase64.length!==1?'s':''}`;
  document.querySelector('.admin-modal h2').textContent = 'Editar producto';
  document.getElementById('admin-modal').classList.add('active');
}

// ════════════════════════════════════════════════════════
//  ADMIN — Restaurar originales
// ════════════════════════════════════════════════════════
async function resetearProductos(){
  if(!confirm('¿Restaurar el catálogo original? Se perderán todos los cambios.')) return;
  productos = productosDefault.map(p => ({...p}));
  categoriasOcultas = [];
  productosOcultos = [];
  buildAllCarousels();
  mostrarToast('Guardando…');
  const exito = await guardarEnFirebase();
  if(exito) {
    mostrarToast('Catálogo restaurado ✓');
  }
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
      <img class="reorder-thumb" src="${p.img}" alt="${p.nombre}">
      <div class="reorder-info">
        <div class="reorder-name">${p.nombre}</div>
        <div class="reorder-tipo">${Array.isArray(p.tipos) ? p.tipos.join(', ') : p.tipo}</div>
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
    mostrarToastError('⚠ Error al guardar. Revisá la conexión.', 5000);
  }
}

// ════════════════════════════════════════════════════════
//  ADMIN — Visibilidad de categorías
// ════════════════════════════════════════════════════════
function abrirModalCategorias(){
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
    const item = document.createElement('div');
    item.className = 'cat-toggle-item';
    item.draggable = true;
    item.dataset.cat = cat;
    item.dataset.index = idx;
    item.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
        <span class="cat-drag-handle" title="Arrastrá para reordenar">⠿</span>
        <div>
          <div class="cat-toggle-name">${cat}</div>
          <div class="cat-toggle-count">${count} producto${count !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <div class="cat-toggle-actions">
        <button class="btn-cat-delete" title="Eliminar categoría y sus productos" onclick="eliminarCategoria('${cat.replace(/'/g,"\\'")}')">×</button>
        <label class="toggle-switch">
          <input type="checkbox" data-cat="${cat}" ${visible ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>`;

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
    mostrarToastError('⚠ Error al guardar. Revisá la conexión.', 5000);
  }
}

async function eliminarCategoria(cat){
  const count = productos.filter(p => p.tipo === cat).length;
  const msg = count > 0
    ? `¿Eliminar la categoría "${cat}" y sus ${count} producto${count !== 1 ? 's' : ''}? Esta acción no se puede deshacer.`
    : `¿Eliminar la categoría "${cat}"?`;
  if(!confirm(msg)) return;
  productos = productos.filter(p => {
    const lista = Array.isArray(p.tipos) ? p.tipos : [p.tipo];
    return !lista.includes(cat) || lista.length > 1;
  }).map(p => {
    if(Array.isArray(p.tipos) && p.tipos.includes(cat)){
      const nuevos = p.tipos.filter(c => c !== cat);
      return { ...p, tipos: nuevos, tipo: nuevos[0] };
    }
    return p;
  });
  categoriasOcultas = categoriasOcultas.filter(c => c !== cat);
  renderCatToggles();
  buildAllCarousels();
  mostrarToast('Guardando…');
  try {
    // Usa batch completo porque hay productos eliminados
    const exito = await guardarEnFirebase();
    if(exito) mostrarToast(`Categoría eliminada ✓`);
  } catch(err) {
    console.error('Error eliminando categoría:', err);
    mostrarToastError('⚠ Error al eliminar. Revisá la conexión.', 5000);
  }
}

// ════════════════════════════════════════════════════════
//  ADMIN — Editar contenido de la página
// ════════════════════════════════════════════════════════

// Referencia a la config editable (persiste en Firebase)
const CONFIG_REF = db.collection('catalogo').doc('siteConfig');

// Imagen nosotros pendiente de guardar (base64)
let nosotrosImgPendiente = null;
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
    const snap = await CONFIG_REF.get({ source: 'default' });
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
    document.getElementById('ep-hero-logo-actual-img').src = C._heroLogoImg;
    document.getElementById('ep-hero-logo-texto').textContent = 'Clic para cambiar la imagen del título';
  } else if(heroLogoActual){
    heroLogoActual.style.display = 'none';
    document.getElementById('ep-hero-logo-texto').textContent = 'Hacé clic para subir la imagen del título';
  }
  // Rellenar campos Hero
  document.getElementById('ep-rubro').value          = C.rubro || '';
  document.getElementById('ep-ubicacion').value      = C.ubicacion || '';
  // Convertir <br> en salto para textarea
  document.getElementById('ep-hero-subtitulo').value = (C.heroSubtitulo || '').replace(/<br\s*\/?>/gi, '\n');

  // Imagen nosotros
  nosotrosImgPendiente = null;
  const preview = document.getElementById('ep-nosotros-img-preview');
  const thumb   = document.getElementById('ep-nosotros-img-thumb');
  if(C._nosotrosImg){
    thumb.src = C._nosotrosImg;
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
  document.getElementById('ep-nos-p1').value = (ps[0]||'').replace(/<[^>]+>/g,'');
  document.getElementById('ep-nos-p2').value = (ps[1]||'').replace(/<[^>]+>/g,'');
  document.getElementById('ep-nos-p3').value = (ps[2]||'').replace(/<[^>]+>/g,'');
  

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

function cargarImagenNosotros(e){
  const file = e.target.files[0];
  if(!file) return;
  comprimirImagen(file, base64 => {
    nosotrosImgPendiente = base64;
    document.getElementById('ep-nosotros-img-thumb').src = base64;
    document.getElementById('ep-nosotros-img-preview').style.display = 'block';
    document.getElementById('ep-nosotros-img-texto').textContent = 'Imagen cargada — clic para cambiar';
  });
  e.target.value = '';
}

async function guardarEditarPagina(){
  const C = SITE_CONFIG;

  // ── Leer valores ──────────────────────────────────────
  C.rubro      = document.getElementById('ep-rubro').value.trim();
  C.ubicacion  = document.getElementById('ep-ubicacion').value.trim();
  // Textarea usa \n, HTML usa <br>
  C.heroSubtitulo = document.getElementById('ep-hero-subtitulo').value.trim().replace(/\n/g,'<br>');

  C.nosotros.label  = document.getElementById('ep-nos-label').value.trim();
  C.nosotros.titulo = document.getElementById('ep-nos-titulo').value.trim();
  C.nosotros.parrafos = [
    document.getElementById('ep-nos-p1').value.trim(),
    document.getElementById('ep-nos-p2').value.trim(),
    document.getElementById('ep-nos-p3').value.trim()
  ].filter(p => p !== '');
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

  if(nosotrosImgPendiente){
    C._nosotrosImg = nosotrosImgPendiente;
  }
  if(heroLogoImgPendiente){
    C._heroLogoImg = heroLogoImgPendiente;
  }

  // ── Aplicar en vivo a la página ────────────────────────
  applyConfig();
  // Imagen nosotros (si se cambió)
  if(C._nosotrosImg){
    const imgEl = document.querySelector('.about-img-placeholder img');
    if(imgEl) imgEl.src = C._nosotrosImg;
  }

  document.getElementById('edit-pagina-modal').classList.remove('active');
  mostrarToast('Guardando…');

  if(navLogoImgPendiente){
    C._navLogoImg = navLogoImgPendiente;
  }

  // ── Persistir en Firebase ──────────────────────────────
  try {
    await CONFIG_REF.set({
      rubro:        C.rubro,
      ubicacion:    C.ubicacion,
      heroSubtitulo:C.heroSubtitulo,
      nosotros:     C.nosotros,
      whatsapp:     C.whatsapp,
      instagram:    C.instagram,
      contacto:     C.contacto,
      nosotrosImg:  C._nosotrosImg || null,
      heroLogoImg:  C._heroLogoImg || null,
      navLogoImg: C._navLogoImg || null
    });
    mostrarToast('Cambios guardados ✓');
  } catch(err){
    console.error('Error guardando configEditable:', err);
    mostrarToast('⚠ Error al guardar. Revisá la conexión.');
  }
}

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
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-empty').style.display = 'none';
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

function ejecutarBusqueda(query){
  const q = query.trim();
  const resultsEl = document.getElementById('search-results');
  const emptyEl   = document.getElementById('search-empty');
  const countEl   = document.getElementById('search-count');

  if(!q){ resultsEl.innerHTML = ''; emptyEl.style.display='none'; countEl.textContent=''; return; }

  const palabras = q.toLowerCase().split(/\s+/).filter(Boolean);
  const encontrados = productos.filter(p => {
    const titulo = p.nombre.toLowerCase();
    return palabras.some(w => titulo.includes(w));
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
    card.innerHTML = `
      <div class="search-card-img">
        <img src="${p.img}" alt="${p.nombre}">
      </div>
      <div class="search-card-info">
        <div class="search-card-cat">${cats}</div>
        <div class="search-card-name">${resaltarPalabras(p.nombre, palabras)}</div>
        <div class="search-card-desc">${p.desc ? p.desc.substring(0,80)+'…' : ''}</div>
      </div>
      <button class="search-card-btn">Ver</button>`;
    card.addEventListener('click', () => { cerrarBuscador(); openModal(p); });
    resultsEl.appendChild(card);
  });
}

function resaltarPalabras(texto, palabras){
  let result = texto;
  palabras.forEach(w => {
    const regex = new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
    result = result.replace(regex, '<mark>$1</mark>');
  });
  return result;
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
  if(e.key === 'Escape') cerrarBuscador();
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

  let rafPending = false;

  function aplicar(){
    const scrollY = window.scrollY;
    elementos.forEach(({ el, factor }) => {
      el.style.transform = `translateY(${scrollY * factor}px)`;
    });
    rafPending = false;
  }

  window.addEventListener('scroll', () => {
    if(!rafPending){
      rafPending = true;
      requestAnimationFrame(aplicar);
    }
  }, { passive: true });
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
    // Si no existe, lo agregamos con cantidad inicial de 1
    carrito.push({ ...producto, cantidad: 1 });
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
    const precioNum = Number((p.precio || '0').replace(/\D/g, ''));
    const subtotal = precioNum * p.cantidad;
    total += subtotal;
    
    html += `
      <div class="cart-item">
        <img src="${p.img}" class="cart-item-img">
        <div class="cart-item-info">
          <div class="cart-item-title">${p.nombre}</div>
          <div class="cart-item-price">${p.precio} c/u</div>
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

function enviarPedidoWa() {
  if (carrito.length === 0) {
    mostrarToastError('El carrito está vacío.');
    return;
  }

  let lineas = [`Hola! Como estas? Me gustaria hacer el siguiente pedido:`];
  let total = 0;

  carrito.forEach((p) => {
    const precioNum = Number((p.precio || '0').replace(/\D/g, ''));
    total += precioNum * p.cantidad;
    lineas.push(`• ${p.cantidad}x *${p.nombre}* - ${p.precio} c/u `);
  });

  lineas.push(`*TOTAL A ABONAR: $${total.toLocaleString('es-AR')}*`);

  const mensaje = lineas.join('\n');
  const url = `https://wa.me/${SITE_CONFIG.whatsapp}?text=${encodeURIComponent(mensaje)}`;
  window.open(url, '_blank');
}