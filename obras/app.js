'use strict';

/*
 * Obras Slavon: de la venta a la post-venta.
 *
 * Venta (administrativo) → se cumple la condición (contado: saldo cobrado · financiado: contrato firmado)
 * → se habilita la entrega → instalación por etapas (encargado de obra) → acta de entrega → post-venta y garantía.
 *
 * Permisos:
 * - Admin: todo.
 * - Administrativo (ventas y cobros): todo menos eliminar obras. Ve precios, señas y saldos.
 * - Encargado de obra: entrega, agenda, equipos, etapas, fotos, checklist, logística e incidencias.
 *   No ve nada de la plata: los datos de la venta están aparte (colección «ventas») y las reglas no se los dejan leer.
 */

(() => {
  const { h, icon } = UI;
  const TIPOS = window.OBRAS_TIPOS;
  const CALC = window.OBRAS_CALC;

  let me = null;
  let cloud = null;
  let isAdmin = false;   // puede eliminar obras
  let canVenta = false;  // admin o administrativo: ve y maneja la venta y la plata
  let obras = [];
  let ventas = {};       // datos de plata por id de obra (sólo admin y administrativo)
  let pagosPorObra = {}; // cobros registrados, por id de obra (sólo admin y administrativo)
  // Catálogos (sólo admin y administrativo). Las bajas quedan con activo = false.
  const cat = { vendedores: [], revendedores: [], clientes: [], proveedores: [], cuentas: [], cespedes: [] };
  let users = [];
  let config = {};
  let fotos = [];        // fotos de la obra abierta
  let fotosObraId = null;
  let stopFotos = null;
  let remitos = [];      // remitos firmados de la obra abierta (archivos en Storage)
  let remitosObraId = null;
  let stopRemitos = null;
  const ui = { obrasFiltro: 'en_curso', q: '', pvFiltro: 'pendientes', agendaMes: null };

  const AVISO_DIAS = 7;        // días antes de la entrega para avisar lo que falta (saldo o contrato)
  const SIN_AVANCE_DIAS = 7;   // obra «quieta»
  const EQUIPOS_DEFAULT = ['Equipo AMBA 1', 'Equipo AMBA 2', 'Equipo AMBA 3', 'Instalador interior 1', 'Instalador interior 2'];

  const main = h('main');
  const setMain = (...kids) => main.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  const tabsEl = document.getElementById('tabs');

  /* ---------- Arranque ---------- */

  SG.boot({
    app: 'obras',
    start(ctx) {
      me = ctx.me;
      cloud = ctx.cloud;
      isAdmin = me.role === 'admin';
      canVenta = isAdmin || me.role === 'administrativo';
      cloud.setWriteErrorHandler((e) => UI.toast('No se pudo guardar: ' + (e.code === 'permission-denied' ? 'no tenés permiso.' : e.message), 5000));
      if (cloud.demo) seedDemo();
      document.getElementById('app').replaceChildren(main);
      buildTabs();
      cloud.subscribe('obras', (items) => { obras = items.map(conBase); render(); }, (e) => UI.toast(e.message, 5000));
      if (canVenta) { loadBNA(); setInterval(loadBNA, 15 * 60 * 1000); }
      if (canVenta) cloud.subscribe('ventas', (items) => { ventas = Object.fromEntries(items.map((v) => [v._id, v])); render(); }, (e) => UI.toast(e.message, 5000));
      if (canVenta) {
        // Los pagos están adentro de cada venta (ventas/{obra}/pagos): se leen todos juntos.
        cloud.subscribeGroup('pagos', (items) => {
          pagosPorObra = {};
          const orden = (p) => `${p.fecha || ''} ${String(p.recibo || 0).padStart(8, '0')}`;
          for (const p of items.sort((a, b) => orden(a).localeCompare(orden(b)))) (pagosPorObra[p.obraId] = pagosPorObra[p.obraId] || []).push(p);
          render();
        }, (e) => UI.toast(e.message, 5000));
        for (const k of Object.keys(cat)) cloud.subscribe(k, (items) => { cat[k] = items; render(); }, () => {});
      }
      cloud.subscribe('users', (items) => { users = items; render(); }, () => {});
      cloud.subscribeDoc('config', 'obras', (d) => { config = d || {}; render(); }, () => {});
      window.addEventListener('hashchange', render);
      render();
    },
  });

  // Las 4 áreas del circuito. Cada obra está en una sola por vez y pasa a la siguiente con un botón.
  const AREAS = {
    ventas: { nombre: 'Ventas', corto: 'Venta', icono: 'tag', quien: 'Melina y Delfina' },
    admin: { nombre: 'Administración', corto: 'Admin.', icono: 'clip', quien: 'Delfina y administración' },
    entregas: { nombre: 'Entregas', corto: 'Entrega', icono: 'calendar', quien: 'Beto y Carajo' },
    postventa: { nombre: 'Post-venta', corto: 'Post-v.', icono: 'phone', quien: 'Delfina' },
  };
  const ORDEN = ['ventas', 'admin', 'entregas', 'postventa'];
  const areaDe = (o) => (o.estado === 'venta' ? 'ventas' : o.estado === 'vendida' ? 'admin' : o.estado === 'terminada' ? 'postventa' : 'entregas');
  const areasMias = () => (canVenta ? ORDEN : ['entregas']);
  const areaInicial = () => (isAdmin ? 'resumen' : canVenta ? 'admin' : 'entregas');

  function buildTabs() {
    // [ruta, ícono, nombre, sólo en la compu]
    const tabs = [];
    if (isAdmin) tabs.push(['resumen', 'grid', 'Resumen', true]);
    for (const k of areasMias()) tabs.push([k, AREAS[k].icono, AREAS[k].nombre]);
    tabs.push(['mas', 'menu', 'Más']);
    tabsEl.replaceChildren(...tabs.map(([id, ic, label, pc]) => h('button', { type: 'button', 'data-tab': id, class: pc ? 'pc-tab' : '', onclick: () => go(id) }, icon(ic), h('span', label))),
      h('div.side-only.side-apps', h('div.side-title', 'Otras apps'),
        h('a', { href: 'https://caixx32.github.io/flota-slavon/' }, 'Flota'),
        h('a.off', 'Depósito'), h('a.off', 'Personal')));
    tabsEl.hidden = false;
  }

  const go = (r) => { location.hash = '#/' + r; };
  const route = () => (location.hash.replace(/^#\/?/, '') || areaInicial()).split('/');

  // Si se estaba escribiendo en el buscador cuando llegan datos nuevos, se vuelve a poner el cursor donde estaba.
  function render() {
    const act = document.activeElement;
    const buscando = act && act.matches && act.matches('main input.search') ? act.selectionStart : null;
    renderView();
    if (buscando == null) return;
    const s = main.querySelector('input.search');
    if (s) { s.focus(); try { s.setSelectionRange(buscando, buscando); } catch (e) { /* nada */ } }
  }

  function renderView() {
    const [r, id, tab] = route();
    document.body.classList.toggle('acta-mode', r === 'acta' || r === 'recibo');
    const activa = r === 'obra' ? (obras.find((x) => x._id === id) ? areaDe(obras.find((x) => x._id === id)) : '') : r;
    tabsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === activa));
    if (r !== 'obra' && r !== 'acta') watchFotos(null);
    if (r === 'recibo') watchComprobantes(id);
    document.querySelectorAll('.fab').forEach((f) => f.remove());
    document.body.classList.toggle('wide', r === 'resumen' || r === 'entregas');
    if (r === 'obra') return viewObra(id, tab);
    if (r === 'acta') return viewActa(id);
    if (r === 'recibo' && canVenta) return viewRecibo(id, tab);
    if (r === 'catalogos' && canVenta) return viewCatalogos(id);
    if (r === 'resumen' && isAdmin) return viewResumen();
    if (r === 'ventas' && canVenta) return viewVentas();
    if (r === 'admin' && canVenta) return viewAdmin();
    if (r === 'postventa' && canVenta) return viewPostventa();
    if (r === 'mas') return viewMas();
    if (r === 'usuarios' && me.super) return SG.usersScreen(main, () => go('mas'));
    return viewEntregas();
  }

  function watchRemitos(obraId) {
    if (obraId === remitosObraId) return;
    if (stopRemitos) stopRemitos();
    stopRemitos = null;
    remitos = [];
    remitosObraId = obraId;
    if (obraId) {
      stopRemitos = cloud.subscribe(`obras/${obraId}/remitos`, (items) => {
        remitos = items.sort((a, b) => (b.fechaEntrega || '').localeCompare(a.fechaEntrega || '') || (b.subidoEn || '').localeCompare(a.subidoEn || ''));
        if (['obra', 'acta'].includes(route()[0])) render();
      }, (e) => UI.toast(e.message));
    }
  }

  function watchFotos(obraId) {
    watchRemitos(obraId);
    if (obraId === fotosObraId) return;
    if (stopFotos) stopFotos();
    stopFotos = null;
    fotos = [];
    fotosObraId = obraId;
    if (obraId) {
      stopFotos = cloud.subscribe('fotos', (items) => {
        const todo = items.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
        fotos = todo.filter((f) => f.tipo !== 'plano'); // los planos ahora van al almacenamiento de archivos
        if (['obra', 'acta'].includes(route()[0])) render();
      }, (e) => UI.toast(e.message), [['obraId', '==', obraId]]);
    }
  }

  /* ---------- Tipo de cambio: dólar oficial Banco Nación, vendedor ---------- */

  // Lo baja solo, cada 15 minutos en horario bancario, una tarea automática del repo (.github/workflows/dolar-bna.yml)
  // directo de bna.com.ar, y lo deja en shared/bna.json. Se usa la cotización BILLETE, columna VENTA.
  const BNA_URL = 'https://www.bna.com.ar/Personas';
  const BNA_JSON = 'https://raw.githubusercontent.com/Caixx32/slavon-gestion/main/shared/bna.json';
  const TC_TIPO = 'billete';
  let bna = null;

  async function loadBNA() {
    try {
      const res = await fetch(BNA_JSON + '?t=' + Date.now(), { cache: 'no-store' });
      const d = await res.json();
      if (d && d[TC_TIPO] && Number(d[TC_TIPO].venta)) {
        bna = d;
        try { localStorage.setItem('sg-bna', JSON.stringify(d)); } catch (e) { /* nada */ }
        render();
      }
    } catch (e) {
      try { bna = bna || JSON.parse(localStorage.getItem('sg-bna') || 'null'); } catch (e2) { /* nada */ }
      if (bna) render();
    }
  }

  // Dólar BNA vendedor vigente hoy (el último publicado por el banco).
  const tcHoy = () => (bna && bna[TC_TIPO] ? Number(bna[TC_TIPO].venta) : 0);
  // Dólar BNA vendedor vigente en una fecha (el último leído ese día o antes).
  function tcDe(fecha) {
    if (!bna || !fecha) return 0;
    if (fecha >= (bna.fecha || '')) return tcHoy();
    const dias = Object.keys(bna.historico || {}).filter((d) => d <= fecha).sort();
    const d = dias.pop();
    return d && bna.historico[d][TC_TIPO] ? Number(bna.historico[d][TC_TIPO].venta) : 0;
  }

  function tcBox() {
    const tc = tcHoy();
    const act = bna && bna.actualizado ? new Date(bna.actualizado) : null;
    return h('div.card.row.wrap', { style: { gap: '10px', padding: '10px 14px' } },
      h('div.grow', tc
        ? [h('b', `Dólar BNA vendedor: ${tcFmt(tc)}`), h('div.small.muted', `Billete, columna Venta · leído de bna.com.ar${act && !isNaN(act) ? ' el ' + UI.fmtStamp(act.toISOString()) : ''}`)]
        : [h('b', { style: { color: 'var(--red)' } }, 'Todavía no se pudo leer el dólar del Banco Nación'), h('div.small.muted', 'Sin eso no se muestran los montos en pesos.')]),
      h('a.btn.small', { href: BNA_URL, target: '_blank', rel: 'noopener' }, 'Ver en BNA'));
  }

  /* ---------- Cálculos ---------- */

  const uid = () => Math.random().toString(36).slice(2, 10);
  // Lee números escritos a la argentina («1.475,50», «1475,5»), guardados con punto decimal («1475.5») o numéricos.
  const num = CALC.num;
  const fmtNum = CALC.fmtNum;
  // Importes con punto de miles y el signo de la moneda: «US$ 10.000», «$ 1.500.000». Vacío si es 0.
  const money = (n, moneda = 'USD') => (n ? CALC.money(n, moneda) : '');
  const usd = (n) => money(n, 'USD');
  const ars = (n) => money(Math.round(n), 'ARS');
  // Tipo de cambio con sus centavos, tal cual lo publica el banco.
  const tcFmt = (n) => {
    if (!n) return '';
    const [e, d] = Number(n).toFixed(2).split('.');
    return '$ ' + e.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
  };
  // Suma importes que pueden estar en monedas distintas: «US$ 12.000 + $ 3.500.000».
  function sumaMonedas(pares) {
    const t = { USD: 0, ARS: 0 };
    for (const [m, n] of pares) t[m === 'ARS' ? 'ARS' : 'USD'] += n;
    return ['USD', 'ARS'].filter((m) => t[m]).map((m) => CALC.money(t[m], m)).join(' + ') || 'US$ 0';
  }
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  /* ----- Cliente y contactos ----- */

  // Cómo se muestra el cliente: «Club Ferro (Sr. Ruiz)», o sólo el club, o sólo el nombre.
  const clienteTexto = (club, nombre) => (club && nombre ? `${club} (${nombre})` : club || nombre || '');
  // N° de pedido siempre al lado del cliente o club (listas, fichas, buscador, PDF y recibos).
  const pedidoTexto = (o) => (o && o.pedido ? `Pedido N° ${o.pedido}` : '');
  const clientePed = (o) => [o.cliente, pedidoTexto(o)].filter(Boolean).join(' · ');
  const pedidoChip = (o) => (o && o.pedido ? h('span.pedido', 'N° ' + o.pedido) : null);
  // Título de una obra en las listas: nombre (con el cliente o club) y el n° de pedido al lado.
  const tituloObra = (o, extra) => h('div.titulo-obra', h('span.ellipsis', extra ? `${extra}${o.nombre}` : o.nombre), pedidoChip(o),
    faltaPlano(o) ? h('span.badge.red.chico', 'Falta plano') : null);
  // Obras viejas: el cliente estaba en un solo campo.
  const clienteNombreDe = (o) => (o.clienteNombre != null || o.club != null ? o.clienteNombre || '' : o.cliente || '');
  // Teléfonos y mails con de quién es cada uno. Las obras viejas tenían un solo teléfono.
  const contactosDe = (o) => (Array.isArray(o.contactos) ? o.contactos
    : [o.telefono ? { id: 't', tipo: 'tel', valor: o.telefono, quien: '' } : null, o.email ? { id: 'm', tipo: 'mail', valor: o.email, quien: '' } : null].filter(Boolean));
  const telDe = (o) => (contactosDe(o).find((c) => c.tipo !== 'mail') || {}).valor || '';
  const telHref = (t) => 'tel:' + String(t).replace(/[^\d+]/g, '');

  /* ----- Cancha y césped ----- */

  const medidaDe = (tipo) => (TIPOS[tipo] || TIPOS.otro).medida || 'm2';
  const m2Texto = (n) => (num(n) ? fmtNum(num(n)) + ' m²' : '');
  const kgTexto = (n) => (num(n) ? fmtNum(num(n)) + ' kg' : '');
  const defaultsBlanco = () => ({ ...window.OBRAS_DEFAULTS.blanco, ...((config && config.blanco) || {}) });
  const padelM2Default = () => num(config && config.padelM2) || window.OBRAS_DEFAULTS.padelM2;
  // Catálogo de césped: el cargado, o la lista inicial mientras no se cargó.
  function cespedesCatalogo() {
    if (cat.cespedes.length) return [...cat.cespedes].sort((a, b) => (num(a.orden) - num(b.orden)) || (a.nombre || '').localeCompare(b.nombre || ''));
    return window.OBRAS_CESPEDES_INICIAL.map((x, i) => Object.defineProperty({ ...x, orden: i, activo: true }, '_id', { value: x.id, enumerable: false }));
  }
  const cespedDe = (id) => (id ? cespedesCatalogo().find((x) => x._id === id) || null : null);
  // Modelos del deporte elegido (los dados de baja no, salvo el que ya tenía la obra).
  function cespedesDe(tipo, actualId) {
    const dep = (TIPOS[tipo] || {}).deporte;
    if (!dep) return [];
    return cespedesCatalogo().filter((x) => (x.activo !== false || x._id === actualId) && (x.deportes || []).includes(dep));
  }
  const PROVEE = { slavon: 'Slavon', cliente: 'Cliente' };
  const ENVIOS = [['definir', 'A definir'], ['si', 'Sí'], ['no', 'No']];
  // Envío: 'si' | 'no' | 'definir'. Las obras de antes tenían un tilde (sí o nada).
  const envioNorm = (e) => (e === 'si' || e === true ? 'si' : e === 'no' ? 'no' : 'definir');
  const envioTexto = (e) => ({ si: 'con envío', no: 'sin envío', definir: 'envío a definir' }[envioNorm(e)]);

  /*
   * Todo lo de la cancha a partir de lo cargado en la venta: superficie, blanco, m² de césped, arena, caucho,
   * qué incluye y garantía. Lo usan el formulario, las fichas, el acta y la demo, para que las cuentas den igual.
   * d: { tipo, formato, cantidad, ancho, largo, m2Padel, m2Manual, cespedId, cespedOtro, altura, color, colores,
   *      bicolorExtra, demarcacion, s, anchoLineaCm, desperdicio, mlExtra, blancoManual, clienteColocaArena, incluye }
   */
  function calcularCancha(d) {
    const t = TIPOS[d.tipo] || TIPOS.otro;
    const cantidad = Math.max(1, Math.round(num(d.cantidad)) || 1);
    const modelo = d.cespedId && d.cespedId !== 'otro' ? cespedDe(d.cespedId) : null;
    const def = defaultsBlanco();
    const val = (x, porDefecto) => (x === undefined || x === null || x === '' ? porDefecto : num(x));
    let ancho = 0;
    let largo = 0;
    let m2Padel = 0;
    let superficie = 0; // por cancha
    if (t.medida === 'cancha') { ancho = num(d.ancho); largo = num(d.largo); superficie = CALC.round2(ancho * largo); }
    if (t.medida === 'padel') { m2Padel = val(d.m2Padel, padelM2Default()); superficie = m2Padel; }
    const formato = d.tipo === 'futbol' ? (window.OBRAS_FORMATOS[d.formato] ? d.formato : 'F5') : '';

    // Blanco (por cancha)
    let blanco = { modo: t.blanco || 'no', demarcacion: '', m2: 0 };
    if (blanco.modo === 'calculo' || blanco.modo === 'manual') {
      blanco.demarcacion = d.demarcacion === 'doble' ? 'doble' : 'simple';
      const calcula = blanco.modo === 'calculo' && window.OBRAS_FORMATOS[formato].calcula;
      if (calcula) {
        const p = { s: val(d.s, def.s), anchoLineaCm: val(d.anchoLineaCm, def.anchoLineaCm), desperdicio: val(d.desperdicio, def.desperdicio) };
        const mlExtra = blanco.demarcacion === 'doble' ? num(d.mlExtra) : 0;
        const r = CALC.blancoFutbol({ formato, ancho, largo, ...p, mlExtra });
        blanco = { ...blanco, ...p, mlExtra, calculado: !!r, desglose: r, m2: r ? r.m2 : 0, pendiente: false };
      } else {
        const m = num(d.blancoManual);
        // F8, F9, F11: el blanco lo pasa Tomás; queda pendiente hasta que se cargue.
        blanco = { ...blanco, manual: true, m2: m, pendiente: blanco.modo === 'calculo' && !m, pedirATomas: blanco.modo === 'calculo' };
      }
    }
    const admiteBicolor = modelo ? !!modelo.admiteBicolor : true;
    const bicolor = admiteBicolor && d.color === 'bicolor';
    const bicolorExtraM2 = bicolor ? num(d.bicolorExtra) : 0;

    let m2PorCancha;
    let m2;
    let superficieTotal;
    if (t.medida === 'm2') {
      m2 = num(d.m2Manual);
      m2PorCancha = m2;
      superficieTotal = m2;
    } else {
      m2PorCancha = CALC.round2(superficie + num(blanco.m2) + bicolorExtraM2);
      m2 = CALC.round2(m2PorCancha * cantidad);
      superficieTotal = CALC.round2(superficie * cantidad);
    }

    // Qué incluye: cantidad, quién lo provee y envío. Arena y caucho se calculan aunque los ponga el cliente.
    const inc0 = d.incluye || {};
    const arenaKgM2 = modelo ? num(modelo.arenaKgM2) : 0;
    const cauchoKgM2 = modelo ? num(modelo.cauchoKgM2) : 0;
    const item = (id, base) => {
      const x = { ...base, ...(inc0[id] || {}) };
      x.aplica = base.aplica;
      if (base.cantidadAuto !== undefined) x.cantidad = x.auto === false ? num(x.cantidad) : base.cantidadAuto;
      delete x.cantidadAuto;
      return x;
    };
    // Envío de cada ítem: 'si' | 'no' | 'definir' (por defecto «A definir»). Lo completa Ventas o Entregas.
    const envios = {};
    for (const it of window.OBRAS_INCLUYE) if (!it.sinEnvio) envios[it.id] = envioNorm((d.envios || {})[it.id] ?? (inc0[it.id] || {}).envio);
    const incluye = {
      cesped: { aplica: true, cantidad: m2, unidad: 'm²', provee: 'slavon' },
      blanco: item('blanco', { aplica: blanco.modo === 'calculo' || blanco.modo === 'manual', cantidadAuto: CALC.round2(num(blanco.m2) * cantidad), auto: true, unidad: 'm²', provee: 'slavon' }),
      arena: item('arena', { aplica: arenaKgM2 > 0, cantidadAuto: CALC.kgMaterial(superficieTotal, arenaKgM2), auto: true, unidad: 'kg', provee: window.OBRAS_PROVEE.arena }),
      caucho: item('caucho', { aplica: cauchoKgM2 > 0, cantidadAuto: CALC.kgMaterial(superficieTotal, cauchoKgM2), auto: true, unidad: 'kg', provee: window.OBRAS_PROVEE.caucho }),
      pegamento: item('pegamento', { aplica: true, unidad: '', provee: 'slavon' }),
      cinta: item('cinta', { aplica: true, unidad: '', provee: 'slavon' }),
      instalacion: item('instalacion', { aplica: true, provee: 'slavon' }),
    };
    incluye.cesped.provee = 'slavon';
    for (const [id, e] of Object.entries(envios)) incluye[id].envio = e;
    for (const k of ['blanco', 'arena', 'caucho']) if (incluye[k].auto === false && !num(incluye[k].cantidad)) incluye[k].auto = true;
    const conInstalacion = incluye.instalacion.provee !== 'cliente';
    // Multisport en residencial lleva arena: sin arena no tiene garantía.
    const multisportResidencial = d.tipo === 'residencial' && !!(modelo && modelo.multisport);
    const clienteColocaArena = multisportResidencial && !!d.clienteColocaArena;
    const cesped = {
      modeloId: modelo ? modelo._id : '', nombre: modelo ? modelo.nombre : (d.cespedOtro || '').trim(), modeloFabrica: modelo ? modelo.modeloFabrica || '' : '',
      alturaMm: modelo ? (modelo.alturas && modelo.alturas.length ? num(d.altura) || modelo.alturas[0] : num(modelo.alturaMm) || 0) : 0,
      color: bicolor ? 'bicolor' : 'mono', colores: (d.colores || '').trim(), multisport: !!(modelo && modelo.multisport),
    };
    return {
      tipo: d.tipo, formato, cantidad, ancho, largo, m2Padel, superficie: superficieTotal, m2, m2PorCancha,
      blanco, bicolorExtraM2, cespedDet: cesped,
      cespedModelo: cesped.modeloId ? cesped.nombre : '', cespedOtro: cesped.modeloId ? '' : cesped.nombre, bicolor, colores: cesped.colores,
      cesped: [cesped.nombre, cesped.alturaMm ? cesped.alturaMm + ' mm' : '', bicolor ? 'bicolor' : cesped.nombre ? 'monocolor' : '', cesped.colores].filter(Boolean).join(' · '),
      incluye, envios, multisportResidencial, clienteColocaArena,
      sinGarantia: !conInstalacion,
      demarcacion: blanco.demarcacion,
      conInstalacion,
      conArena: conInstalacion && incluye.arena.aplica && num(incluye.arena.cantidad) > 0 && !clienteColocaArena,
      conCaucho: conInstalacion && incluye.caucho.aplica && num(incluye.caucho.cantidad) > 0,
    };
  }

  // Lo cargado en una obra, como entrada de calcularCancha (también para obras viejas).
  function datosCanchaDe(o) {
    const b = o.blanco && typeof o.blanco === 'object' ? o.blanco : { m2: num(o.blanco) };
    const cd = o.cespedDet || {};
    let cespedId = cd.modeloId || '';
    if (!cespedId && o.cespedModelo) { const m = cespedesCatalogo().find((x) => norm(x.nombre) === norm(o.cespedModelo)); if (m) cespedId = m._id; }
    let incluye = o.incluye;
    if (!incluye) { // obras viejas: instalación sí/no y arena/caucho 'cliente' | 'slavon' | 'no'
      incluye = { instalacion: { provee: o.conInstalacion === false ? 'cliente' : 'slavon' } };
      for (const m of ['arena', 'caucho']) if (['cliente', 'slavon'].includes(o[m])) incluye[m] = { provee: o[m] };
    }
    return {
      tipo: o.tipo, formato: o.formato, cantidad: o.cantidad, ancho: o.ancho, largo: o.largo, m2Padel: o.m2Padel,
      m2Manual: medidaDe(o.tipo) === 'm2' ? o.m2 : '', cespedId: cespedId || (cd.nombre || o.cespedOtro || o.cesped ? 'otro' : ''),
      cespedOtro: cd.modeloId ? '' : cd.nombre || o.cespedOtro || (!cespedId ? o.cesped : '') || '', altura: cd.alturaMm, color: cd.color || (o.bicolor ? 'bicolor' : 'mono'),
      colores: cd.colores ?? o.colores ?? '', bicolorExtra: o.bicolorExtraM2, demarcacion: b.demarcacion || o.demarcacion, s: b.s, anchoLineaCm: b.anchoLineaCm,
      desperdicio: b.desperdicio, mlExtra: b.mlExtra, blancoManual: b.manual ? b.m2 : '', clienteColocaArena: o.clienteColocaArena, incluye, envios: o.envios,
    };
  }
  // La cancha de una obra ya calculada (con lo guardado, sin recalcular cantidades corregidas a mano).
  const canchaDe = (o) => calcularCancha(datosCanchaDe(o));

  // «Pedir blanco a Tomás», plano obligatorio y demás avisos de la cancha.
  const FORMATOS_SIN_CALCULO = ['F8', 'F9', 'F11'];
  const requierePlano = (o) => o.tipo === 'residencial' || o.demarcacion === 'doble' || (o.tipo === 'futbol' && FORMATOS_SIN_CALCULO.includes(o.formato));
  const faltaPlano = (o) => requierePlano(o) && !(o.planos || []).length;
  function porQuePlano(o) {
    if (o.tipo === 'residencial') return 'residencial';
    if (o.demarcacion === 'doble') return 'doble demarcación';
    return o.formato;
  }

  function medidasTexto(o) {
    const k = canchaDe(o);
    const t = TIPOS[o.tipo] || TIPOS.otro;
    if (t.medida === 'cancha' && k.ancho && k.largo) return [`${fmtNum(k.ancho)} × ${fmtNum(k.largo)} m`, k.formato].filter(Boolean).join(' · ');
    if (t.medida === 'padel') return `${m2Texto(k.m2Padel)} por cancha`;
    return '';
  }
  function blancoTexto(o) {
    const b = canchaDe(o).blanco;
    if (b.modo === 'incluido') return 'Incluido en la cancha';
    if (b.modo === 'no') return '';
    const dem = `demarcación ${b.demarcacion}`;
    if (b.pedirATomas && b.pendiente) return `Pedir blanco a Tomás (pendiente) · ${dem}`;
    if (b.manual) return [b.m2 ? `${m2Texto(b.m2)} por cancha (a mano)` : 'Sin cargar', dem].join(' · ');
    if (!b.desglose) return `Cargá ancho y largo · ${dem}`;
    const r = b.desglose;
    return `${fmtNum(r.ml)} ml × ${fmtNum(b.anchoLineaCm)} cm + ${fmtNum(b.desperdicio)} % = ${m2Texto(r.m2)} por cancha · ${dem}`;
  }
  // Una línea por ítem de «qué incluye»: «Arena: 18.000 kg · la pone el cliente · sin envío».
  function incluyeLineas(o, conEnvio = true) {
    const k = canchaDe(o);
    return window.OBRAS_INCLUYE.filter((it) => k.incluye[it.id] && k.incluye[it.id].aplica).map((it) => {
      const x = k.incluye[it.id];
      const cargada = ((o.materialesEntrega || {})[it.id] || {}).cantidad;
      const cant = it.id === 'pegamento' || it.id === 'cinta' ? (x.provee === 'cliente' && !num(cargada) ? '' : cantidadEntrega(o, it.id)) : num(x.cantidad) ? `${fmtNum(num(x.cantidad))} ${x.unidad}` : '';
      return { id: it.id, nombre: it.nombre, texto: [cant, it.id === 'instalacion' ? (x.provee === 'cliente' ? 'a cargo del cliente' : 'la hace Slavon') : `la provee ${x.provee === 'cliente' ? 'el cliente' : 'Slavon'}`,
        conEnvio && !it.sinEnvio ? envioTexto(x.envio) : ''].filter(Boolean).join(' · '), cliente: x.provee === 'cliente', envio: it.sinEnvio ? null : envioNorm(x.envio) };
    });
  }
  // Pegamento y cinta: la cantidad la carga Federico en Entregas.
  function cantidadEntrega(o, id) {
    const m = (o.materialesEntrega || {})[id];
    return m && num(m.cantidad) ? `${fmtNum(num(m.cantidad))}${m.unidad ? ' ' + m.unidad : ''}` : 'cantidad a cargar en Entregas';
  }
  const plazoTexto = (o) => (o.plazo === 'otro' ? o.plazoOtro || 'Otro' : (window.OBRAS_PLAZOS[o.plazo] || {}).nombre || '');

  /* ----- Garantía (en años; las obras viejas la tenían en meses) ----- */

  const garantiaMesesDe = (o) => (o.garantiaAnios !== undefined && o.garantiaAnios !== '' && o.garantiaAnios !== null ? num(o.garantiaAnios) * 12 : num(o.garantiaMeses));
  function garantiaTexto(o) {
    const m = garantiaMesesDe(o);
    if (!m) return '';
    if (m % 12) return `${fmtNum(m)} meses`;
    return m === 12 ? '1 año' : `${fmtNum(m / 12)} años`;
  }
  const tipoNombre = (t) => (TIPOS[t] || TIPOS.otro).nombre;
  const userName = (email) => (users.find((u) => u._id === email) || {}).nombre || email;
  const stamp = () => ({ editadoPor: me.email, editadoPorNombre: me.nombre, editadoEn: cloud.serverTime() });
  const esVendida = (o) => o.estado === 'vendida';
  const esCurso = (o) => !o.estado || o.estado === 'en_curso';
  const esTerminada = (o) => o.estado === 'terminada';
  /* ----- Etapa 1 «Base apta» ----- */
  // Va siempre primera cuando instala Slavon (no en mantenimiento ni «otro»). Sin base apta no se instala.
  const instalaSlavon = (o) => (o.incluye && o.incluye.instalacion ? o.incluye.instalacion.provee !== 'cliente' : o.conInstalacion !== false);
  function requiereBase(o) {
    const t = TIPOS[o.tipo];
    return !!t && !t.mantenimiento && o.tipo !== 'otro' && instalaSlavon(o);
  }
  const esEtapaBase = (e) => !!e && (e.tipo === 'base' || /base apta/i.test(e.nombre || ''));
  const etapaBase = (o) => (o.etapas || []).find(esEtapaBase) || null;
  const baseApta = (o) => { const b = etapaBase(o); return !!b && b.estado === 'hecha'; };
  const baseNoApta = (o) => (o.incidencias || []).filter((x) => x.tipo === 'Base no apta' && !x.resuelta);
  // Etapa de instalación que espera la base apta (flete, envío y entrega de materiales no esperan).
  const esperaBase = (o, e) => requiereBase(o) && !esEtapaBase(e) && !window.OBRAS_ETAPA_SIN_BASE.test(e.nombre || '') && !baseApta(o);
  // Obras ya cargadas: la etapa «Control de base apta» pasa a ser la Etapa 1 (si estaba hecha, queda hecha); si no la tienen, se agrega.
  // Se acomoda al leer; queda guardado la próxima vez que se toquen las etapas.
  function conBase(o) {
    if (o.estado === 'terminada' || !requiereBase(o)) return o;
    const list = (o.etapas || []).slice();
    const i = list.findIndex(esEtapaBase);
    if (i === 0 && list[0].tipo === 'base' && list[0].nombre === window.OBRAS_BASE_APTA) return o;
    const b = i >= 0 ? list.splice(i, 1)[0] : { id: 'base', nombre: window.OBRAS_BASE_APTA, estado: 'pendiente', nota: '' };
    // Se cambia la copia recién leída (no la base de datos), así conserva su _id.
    o.etapas = [{ ...b, tipo: 'base', nombre: window.OBRAS_BASE_APTA, estado: b.estado === 'hecha' ? 'hecha' : 'pendiente' }, ...list];
    return o;
  }
  const avisoTexto = (i) => (i.avisadoCliente ? ['Cliente avisado', i.avisoFecha ? 'el ' + UI.fmtDay(i.avisoFecha) : '', i.avisoMedio ? 'por ' + i.avisoMedio : '', i.avisoA ? 'a ' + i.avisoA : ''].filter(Boolean).join(' ') : 'Falta avisar al cliente');

  // Fecha de entrega que manda: la real (coordinada con el cliente) si está; si no, la estimada de la venta.
  const fechaEnt = (o) => o.fechaEntregaReal || o.fechaEntrega || '';
  // «Estimada 20/11 · Real 25/11 (5 días después)».
  function fechasEntregaTexto(o) {
    if (!o.fechaEntrega && !o.fechaEntregaReal) return '—';
    if (!o.fechaEntregaReal) return h('span', h('b', UI.fmtDay(o.fechaEntrega)), h('span.muted', ' · estimada (falta coordinar con el cliente)'));
    const dif = o.fechaEntrega ? Math.round((new Date(o.fechaEntregaReal) - new Date(o.fechaEntrega)) / 86400000) : 0;
    const difTxt = !o.fechaEntrega ? '' : dif === 0 ? ' (la misma)' : ` (${Math.abs(dif)} día${Math.abs(dif) > 1 ? 's' : ''} ${dif > 0 ? 'después' : 'antes'})`;
    return h('span', o.fechaEntrega ? h('span.muted', `Estimada ${UI.fmtDay(o.fechaEntrega)} · `) : null, h('b', `Real ${UI.fmtDay(o.fechaEntregaReal)}`), h('span.muted', difTxt));
  }
  const ESTADOS = { vendida: 'Vendida', en_curso: 'En entrega', terminada: 'Entregada' };
  const equipos = () => (config.equipos && config.equipos.length ? config.equipos : EQUIPOS_DEFAULT);

  const progreso = (o) => {
    const et = o.etapas || [];
    if (!et.length) return 0;
    return Math.round((et.filter((e) => e.estado === 'hecha').length / et.length) * 100);
  };
  const etapaActual = (o) => (o.etapas || []).find((e) => e.estado === 'en_curso') || (o.etapas || []).find((e) => e.estado !== 'hecha');

  /* ----- Plata de la venta: precio, seña o anticipo, cuotas y cobros ----- */

  const monedaDe = (v) => (v && v.moneda === 'ARS' ? 'ARS' : 'USD');
  // Las ventas viejas tenían el precio y la seña siempre en dólares (precioUSD, senaUSD).
  const precioDe = (v) => num(v && (v.precio ?? v.precioUSD));
  const senaDe = (v) => num(v && (v.sena ?? v.senaUSD));
  const esFinanciado = (v) => !!v && v.formaPago === 'financiado';
  const planDe = (v) => CALC.planCuotas({ saldo: Math.max(0, precioDe(v) - senaDe(v)), cuotas: v.cuotas, tasa: v.tasaMensual, primera: v.primeraCuota });

  /*
   * Todo lo que hay que saber de la plata de una obra. El saldo SIEMPRE sale de la cuenta:
   * saldo = total − suma de los pagos registrados (la seña o anticipo también es un pago). Ningún tilde lo cierra.
   * Total: contado = precio · financiado = anticipo + cuotas (con el interés).
   * Cheques: cuentan desde que se reciben; cobrados, con el dólar del día del cobro; rechazados, no cuentan.
   */
  function cobro(o) {
    const v = ventas[o._id] || {};
    const moneda = monedaDe(v);
    const precio = precioDe(v);
    const sena = senaDe(v);
    const fin = esFinanciado(v);
    const plan = fin ? planDe(v) : null;
    const total = fin ? CALC.round2(sena + plan.total) : precio;
    const pagos = pagosPorObra[o._id] || [];
    let acum = 0;
    const filas = pagos.map((p) => {
      const valor = CALC.valorPago(p, moneda);
      acum = CALC.round2(acum + valor);
      return { p, valor, aCobrar: CALC.aCobrarPago(p, moneda), saldoDespues: CALC.round2(total - acum) };
    });
    const cobrado = acum;
    const pendiente = Math.max(0, CALC.round2(total - cobrado));
    return {
      v, moneda, precio, sena, fin, plan, total, pagos, filas, cobrado, pendiente,
      aCobrar: CALC.round2(filas.reduce((a, f) => a + f.aCobrar, 0)),
      // Seña o anticipo: lo PACTADO es el de la venta; lo que cuenta es lo PAGADO con pagos de tipo seña.
      senaCobrada: CALC.round2(filas.filter((f) => f.p.tipo === 'sena').reduce((a, f) => a + f.valor, 0)),
      get senaFalta() { return Math.max(0, CALC.round2(this.sena - this.senaCobrada)); },
      get senaSinRegistrar() { return this.senaFalta > 0.005; },
      pct: total ? Math.min(100, Math.round((cobrado / total) * 100)) : 0,
      // Lo cobrado cubre primero el anticipo y después las cuotas, en orden.
      cuotas: plan ? CALC.estadoCuotas(plan.cuotas, Math.max(0, cobrado - sena)) : [],
      M: (n) => CALC.money(n, moneda),
    };
  }
  // Próxima cuota sin pagar del todo.
  const proximaCuota = (c) => c.cuotas.find((q) => q.pendiente > 0);

  /*
   * Marca «Saldo cobrado»: sólo se pone con saldo 0 y deja quién y cuándo.
   * Si después el saldo vuelve a subir (un cheque rechazado, un pago borrado, un precio mayor), deja de valer:
   * se avisa y se borra al guardar el cambio.
   */
  function estadoCobro(o) {
    const c = cobro(o);
    const marca = (ventas[o._id] || {}).saldoCobrado || null;
    const enCero = c.precio > 0 && c.pendiente <= 0;
    return { c, marca, enCero, valida: !!marca && enCero, vencida: !!marca && !enCero, paraMarcar: !marca && enCero };
  }
  // Borra la marca si con el cambio el saldo deja de ser 0.
  const opsQuitarMarca = (o, saldoNuevo) => ((ventas[o._id] || {}).saldoCobrado && saldoNuevo > 0.005
    ? [{ op: 'update', col: 'ventas', id: o._id, data: { saldoCobrado: null, saldoCobradoQuitado: { fecha: UI.today(), porNombre: me.nombre, saldo: saldoNuevo } } }] : []);

  // ¿Se cumple la condición para entregar? Contado: saldo 0 y marcado «Saldo cobrado». Financiado: contrato firmado.
  function condicionOk(o) {
    const v = ventas[o._id];
    if (!v) return false;
    if (esFinanciado(v)) return !!v.contratoFirmado;
    return estadoCobro(o).valida;
  }

  /* ----- Facturación: monto a facturar (a mano) y facturas cargadas ----- */
  const EMISORES = [['wmax', 'W. MAX SRL'], ['atlantis', 'Atlantis'], ['otro', 'Otro']];
  function facturacionDe(o) {
    const v = ventas[o._id] || {};
    const sinFactura = !v.iva || v.iva.tipo === 'sin';
    const f = v.facturacion || {};
    const facturas = f.facturas || [];
    const aFacturar = sinFactura ? 0 : num(f.aFacturar);
    const facturado = CALC.round2(facturas.reduce((a, x) => a + num(x.monto), 0));
    return { sinFactura, aFacturar, facturas, facturado, pendiente: Math.max(0, CALC.round2(aFacturar - facturado)), cargado: f.aFacturar !== undefined && f.aFacturar !== null && f.aFacturar !== '' };
  }

  /* ----- Checklist administrativo ----- */
  // Lo que sale de los pagos: ¿a qué cuenta transfirió? (W. MAX, Atlantis u otro).
  function transfirioSegunPagos(o) {
    const ps = (pagosPorObra[o._id] || []).filter((p) => p.forma === 'cuenta' || p.forma === 'proveedor' || (p.forma === 'cheque' && (p.destino || {}).cuentaId));
    if (!ps.length) return '';
    const nombres = ps.map((p) => norm((p.destino || {}).cuentaNombre || ''));
    if (nombres.some((n) => /w\.?\s*max/.test(n))) return 'wmax';
    if (nombres.some((n) => n.includes('atlantis'))) return 'atlantis';
    return 'otro';
  }
  const pagoPorTransferencia = (o) => (pagosPorObra[o._id] || []).some((p) => p.forma === 'cuenta' || p.forma === 'proveedor');
  const tributoPercepcion = (o) => ((ventas[o._id] || {}).tributos || []).some((t) => /percep/i.test(t.nombre || ''));
  // El checklist de una obra con lo que aplica, lo hecho y lo que falta. Las respuestas que salen de los datos cuentan.
  function checklistAdmin(o) {
    const v = ventas[o._id] || {};
    const ch = v.checklistAdmin || {};
    const tildes = ch.tildes || {};
    const fac = ch.factura || {};
    const c = cobro(o);
    const sugTransfirio = transfirioSegunPagos(o);
    const transfirio = fac.transfirioA || sugTransfirio;
    const percepciones = ch.percepciones || (tributoPercepcion(o) ? 'si' : '');
    const pasos = [];
    for (const it of window.OBRAS_CHECKLIST_ADMIN) {
      if (it.cuando === 'saldo' && !(c.pendiente > 0)) continue;
      if (it.cuando === 'transferencia' && !pagoPorTransferencia(o)) continue;
      let hecho = false;
      if (it.tipo === 'tilde') hecho = !!(tildes[it.id] && tildes[it.id].ok);
      if (it.tipo === 'mail') hecho = ch.confirmoMail === 'si' || ch.confirmoMail === 'no';
      if (it.tipo === 'percepciones') hecho = percepciones === 'si' || percepciones === 'no';
      if (it.tipo === 'factura') {
        if (fac.tiene === 'si') hecho = !!(fac.razonSocial && fac.cuit);
        if (fac.tiene === 'no') hecho = transfirio === 'otro' ? !!(fac.pedirRazonSocial && fac.pedirRazonSocial.ok) : !!transfirio && !!(fac.pedirFactura && fac.pedirFactura.ok);
      }
      pasos.push({ ...it, hecho });
    }
    let aviso = '';
    if (fac.tiene === 'no' && (transfirio === 'wmax' || transfirio === 'atlantis') && !(fac.pedirFactura && fac.pedirFactura.ok)) aviso = 'Pedir factura';
    if (fac.tiene === 'no' && transfirio === 'otro' && !(fac.pedirRazonSocial && fac.pedirRazonSocial.ok)) aviso = 'Pedir razón social';
    return { ch, tildes, fac, transfirio, sugTransfirio, percepciones, pasos, hechos: pasos.filter((x) => x.hecho).length, total: pasos.length, aviso };
  }
  const faltaTexto = (o) => {
    const v = ventas[o._id];
    if (!v) return 'Faltan los datos de la venta';
    if (esFinanciado(v)) return 'Falta el contrato firmado';
    const e = estadoCobro(o);
    if (e.enCero) return 'Falta marcar «Saldo cobrado»';
    return `Falta cobrar el saldo: ${e.c.M(e.c.pendiente)}`;
  };

  // Ventas con la entrega cerca (o pasada) y la condición sin cumplir.
  const alertasEntrega = () => obras
    .filter((o) => esVendida(o) && fechaEnt(o) && UI.daysUntil(fechaEnt(o)) <= AVISO_DIAS && !condicionOk(o))
    .sort((a, b) => fechaEnt(a).localeCompare(fechaEnt(b)));
  // Ventas que ya cumplen la condición pero todavía no se habilitó la entrega.
  const paraHabilitar = () => obras.filter((o) => esVendida(o) && condicionOk(o));
  const proximasInstalaciones = (dias) => obras
    .filter((o) => !esTerminada(o) && o.instInicio && (o.instFin || o.instInicio) >= UI.today() && UI.daysUntil(o.instInicio) <= dias)
    .sort((a, b) => a.instInicio.localeCompare(b.instInicio));
  const incidenciasAbiertas = () => {
    const out = [];
    for (const o of obras) for (const i of o.incidencias || []) if (!i.resuelta && !esTerminada(o)) out.push({ obra: o, i });
    return out;
  };
  const garantiaVence = (o) => (o.fin && garantiaMesesDe(o) ? UI.addMonths(o.fin, garantiaMesesDe(o)) : '');
  const garantiasPorVencer = (dias) => obras
    .filter((o) => esTerminada(o) && garantiaVence(o) && UI.daysUntil(garantiaVence(o)) >= -30 && UI.daysUntil(garantiaVence(o)) <= dias)
    .sort((a, b) => garantiaVence(a).localeCompare(garantiaVence(b)));

  function llamadosPendientes() {
    const out = [];
    for (const o of obras) {
      if (!esTerminada(o)) continue;
      for (const p of o.postventa || []) if (!p.hecho) out.push({ obra: o, p });
    }
    return out.sort((a, b) => a.p.fecha.localeCompare(b.p.fecha));
  }

  function ultimoAvance(o) {
    const f = (o.etapas || []).filter((e) => e.estado === 'hecha' && e.fecha).map((e) => e.fecha).sort().pop();
    return f || o.instInicio || o.inicio || UI.today();
  }

  // Obras del mismo equipo que se superponen en fechas.
  function superpuestas(o, equipo, desde, hasta) {
    if (!equipo || !desde) return [];
    const fin = hasta || desde;
    return obras.filter((x) => x._id !== o._id && !esTerminada(x) && x.equipo === equipo && x.instInicio
      && x.instInicio <= fin && (x.instFin || x.instInicio) >= desde);
  }

  function progressBar(pct) {
    return h(`div.progress${pct === 100 ? '.done' : ''}`, h('span', { style: { width: pct + '%' } }));
  }
  function kpi(n, label, to, cls) {
    return h('div.kpi', { class: [to ? 'tap' : '', cls || ''].join(' '), onclick: to ? () => go(to) : null }, h('b', n), h('span', label));
  }
  const fechasInst = (o) => (o.instInicio ? UI.fmtDay(o.instInicio) + (o.instFin && o.instFin !== o.instInicio ? ' – ' + UI.fmtDay(o.instFin) : '') : '');

  /* ---------- Piezas comunes ---------- */

  // Encabezado de cada área: qué es, quién la lleva y cuándo termina.
  function areaHead(k, texto, extra) {
    return h('div.area-head',
      h('div.row', { style: { alignItems: 'flex-start' } },
        h('div.grow', h('div.area-kicker', `Área ${ORDEN.indexOf(k) + 1} de 4 · ${AREAS[k].quien}`), h('h1', { style: { margin: '2px 0 4px' } }, AREAS[k].nombre)),
        extra || null),
      h('p.muted.small', { style: { margin: 0 } }, texto));
  }

  // Las 4 áreas en fila, con la actual marcada (en la ficha de la obra).
  // Las 4 áreas en fila: muestran dónde está la obra y, tocándolas, abren lo de cada área.
  const TAB_DE = { ventas: 'venta', admin: 'admin', entregas: 'entrega', postventa: 'postventa' };
  function stepper(o, tabSel, permitidas) {
    const cur = ORDEN.indexOf(areaDe(o));
    return h('div.stepper', ORDEN.map((k, i) => {
      const tab = TAB_DE[k];
      const ok = permitidas.includes(tab);
      return h('button.step', {
        type: 'button', disabled: !ok,
        class: [i < cur ? 'done' : i === cur ? 'on' : '', tab === tabSel ? 'sel' : ''].join(' '),
        onclick: ok ? () => go(`obra/${o._id}/${tab}`) : null,
      }, h('span.step-dot', i < cur ? icon('check') : String(i + 1)), h('span.step-name', AREAS[k].nombre), h('span.step-short', AREAS[k].corto));
    }));
  }

  function section(title, items, empty, extra) {
    return [h('div.row', { style: { marginTop: '22px' } }, h('h2.grow', { style: { margin: '0 0 10px' } }, title, items && items.length ? h('span.count', items.length) : null), extra || null),
      items && items.length ? h('div.list', items) : h('div.card.empty.small', empty)];
  }

  function obraRow(o, right, sub) {
    return h('div.item', { onclick: () => go('obra/' + o._id) },
      h('div.grow', { style: { minWidth: 0 } },
        tituloObra(o),
        h('div.small.muted.ellipsis', sub || [tipoNombre(o.tipo), o.cliente, o.ubicacion].filter(Boolean).join(' · '))),
      right || null, icon('chev'));
  }

  function urgencia(fecha) {
    if (!fecha) return h('span.badge', 'Sin fecha');
    const d = UI.daysUntil(fecha);
    return h('span.badge', { class: d < 0 ? 'red' : d <= AVISO_DIAS ? 'warn' : '' }, d < 0 ? `Vencida ${UI.fmtDay(fecha)}` : `${UI.fmtDay(fecha)} · ${UI.relDays(fecha)}`);
  }

  function addFab() {
    if (!canVenta) return;
    document.body.append(h('button.fab', { type: 'button', 'aria-label': 'Nueva venta', onclick: () => editObra(null) }, icon('plus')));
  }

  // Texto donde se busca: obra, cliente, club, ubicación, teléfonos, mails y de quién es cada uno.
  const textoBusqueda = (o) => norm([o.nombre, o.cliente, o.club, o.clienteNombre, o.ubicacion, o.telefono, o.pedido, o.pedido ? 'pedido ' + o.pedido : '',
    ...contactosDe(o).flatMap((c) => [c.valor, c.quien])].join(' '));
  // Teléfonos sólo con los números, para encontrar «1155550101» aunque esté cargado «11 5555 0101».
  const telefonosDe = (o) => [o.telefono, ...contactosDe(o).filter((c) => c.tipo !== 'mail').map((c) => c.valor)].map((t) => String(t || '').replace(/\D/g, '')).filter(Boolean);

  // Buscador de clientes y obras: busca en todas las áreas, sin importar dónde esté la obra.
  function buscador() {
    const inp = h('input.search', { type: 'search', placeholder: 'Buscar cliente, club, teléfono, mail o n° de pedido…', 'aria-label': 'Buscar cliente' });
    inp.value = ui.q || '';
    const res = h('div.list');
    const vacio = h('div.card.empty.small');
    const paint = () => {
      ui.q = inp.value;
      const q = norm(inp.value.trim());
      const palabras = q.split(/\s+/).filter(Boolean);
      const digitos = q.replace(/\D/g, '');
      const items = q.length < 2 ? [] : obras.filter((o) => {
        const t = textoBusqueda(o);
        return palabras.every((w) => t.includes(w)) || (digitos.length >= 4 && telefonosDe(o).some((tel) => tel.includes(digitos)));
      }).sort((a, b) => (b.fechaVenta || '').localeCompare(a.fechaVenta || '')).slice(0, 25);
      res.hidden = !items.length;
      res.replaceChildren(...items.map((o) => obraRow(o, h('span.badge', AREAS[areaDe(o)].nombre))));
      vacio.hidden = !(q.length >= 2 && !items.length);
      vacio.textContent = `No hay clientes ni obras con «${inp.value.trim()}».`;
    };
    inp.addEventListener('input', paint);
    paint();
    return h('div.buscador', inp, h('div', { style: { marginTop: '8px' } }, res, vacio));
  }

  /* ---------- Resumen (sólo admin, en la compu) ---------- */

  function viewResumen() {
    const cols = ORDEN.map((k) => {
      let list = obras.filter((o) => areaDe(o) === k);
      if (k === 'postventa') list = list.filter((o) => (o.postventa || []).some((p) => !p.hecho));
      return [k, list];
    });
    const pend = {
      ventas: obras.filter((o) => o.estado === 'venta').length,
      admin: alertasEntrega().length,
      entregas: obras.filter((o) => esCurso(o) && !o.instInicio).length + incidenciasAbiertas().length,
      postventa: llamadosPendientes().filter((x) => UI.daysUntil(x.p.fecha) <= 0).length,
    };
    const pendTxt = {
      ventas: 'ventas incompletas',
      admin: 'saldos o contratos urgentes',
      entregas: 'sin fecha o con incidencia',
      postventa: 'llamados para hoy',
    };
    setMain(
      h('div.row', h('h1.grow', 'Resumen'), h('button.btn.primary.small', { type: 'button', onclick: () => editObra(null) }, icon('plus'), 'Nueva venta')),
      h('p.muted.small', 'Cada obra está en una sola área y pasa a la siguiente cuando se cumple su paso.'),
      buscador(),
      h('div.flow', cols.map(([k, list]) => h('div.flow-col',
        h('div.flow-head', { onclick: () => go(k) },
          h('div.row', h('b.grow', `${ORDEN.indexOf(k) + 1}. ${AREAS[k].nombre}`), h('span.count', list.length)),
          h('div.small.muted', AREAS[k].quien),
          pend[k] ? h('div.small', { style: { color: 'var(--red)', fontWeight: 600, marginTop: '4px' } }, `${pend[k]} ${pendTxt[k]}`) : h('div.small.muted', { style: { marginTop: '4px' } }, 'Al día')),
        list.length ? list.slice(0, 12).map((o) => flowCard(o, k)) : h('div.small.muted', { style: { padding: '8px 4px' } }, 'Nada acá'),
        list.length > 12 ? h('button.btn.small.ghost', { type: 'button', onclick: () => go(k) }, `Ver las ${list.length}`) : null))));
  }

  function flowCard(o, k) {
    const v = ventas[o._id];
    let linea = null;
    if (k === 'ventas') linea = h('span.badge.warn', 'Incompleta');
    if (k === 'admin') linea = condicionOk(o) ? h('span.badge.ok', 'Lista para Entregas') : urgencia(fechaEnt(o));
    if (k === 'entregas') linea = [progressBar(progreso(o)), h('div.small.muted', { style: { marginTop: '4px' } }, o.instInicio ? fechasInst(o) : 'Sin fecha de instalación')];
    if (k === 'postventa') { const p = (o.postventa || []).find((x) => !x.hecho); linea = p ? h('span.small', `Llamado ${p.label}: `, urgencia(p.fecha)) : null; }
    return h('div.board-card', { onclick: () => go('obra/' + o._id) },
      tituloObra(o),
      h('div.small.muted.ellipsis', { style: { marginBottom: '6px' } }, tipoNombre(o.tipo)),
      linea);
  }

  /* ---------- 1. Ventas ---------- */

  function viewVentas() {
    const mes = UI.today().slice(0, 7);
    const incompletas = obras.filter((o) => o.estado === 'venta');
    const delMes = obras.filter((o) => (o.fechaVenta || '').startsWith(mes)).sort((a, b) => (b.fechaVenta || '').localeCompare(a.fechaVenta || ''));
    const total = sumaMonedas(delMes.map((o) => [monedaDe(ventas[o._id]), precioDe(ventas[o._id])]));
    const m2 = delMes.reduce((a, o) => a + num(o.m2), 0);
    setMain(
      areaHead('ventas', 'Se carga la venta con los datos de la cancha, el precio, la seña y la fecha de entrega. Cuando está completa pasa sola a Administración.',
        h('button.btn.primary', { type: 'button', onclick: () => editObra(null) }, icon('plus'), 'Nueva venta')),
      buscador(),
      h('div.kpis', { style: { marginTop: '14px' } },
        kpi(delMes.length, 'Ventas del mes'),
        kpi(total, 'Vendido en el mes'),
        kpi(fmtNum(m2) + ' m²', 'm² vendidos en el mes')),
      section('Incompletas (faltan datos para pasar a Administración)', incompletas.map((o) => obraRow(o, h('span.badge.warn', 'Completar'))), 'No hay ventas incompletas.'),
      section('Ventas del mes', delMes.map((o) => obraRow(o, h('span.badge', { class: areaDe(o) === 'ventas' ? 'warn' : '' }, 'En ' + AREAS[areaDe(o)].nombre),
        [UI.fmtDay(o.fechaVenta), tipoNombre(o.tipo), m2Texto(o.m2), money(precioDe(ventas[o._id]), monedaDe(ventas[o._id])), (ventas[o._id] || {}).vendio ? 'vendió ' + ventas[o._id].vendio : ''].filter(Boolean).join(' · '))), 'Todavía no hay ventas este mes.'));
    addFab();
  }

  /* ---------- 2. Administración ---------- */

  function viewAdmin() {
    if (!ui.adminTab) ui.adminTab = 'cobrar';
    const conVenta = obras.filter((o) => ventas[o._id]);
    const enAdmin = conVenta.filter((o) => o.estado === 'vendida').sort((a, b) => (fechaEnt(a) || '9').localeCompare(fechaEnt(b) || '9'));
    const enEntrega = conVenta.filter((o) => esCurso(o) && o.estado !== 'vendida' && o.estado !== 'venta');
    const entregadas = conVenta.filter(esTerminada).sort((a, b) => (b.fin || '').localeCompare(a.fin || ''));
    const cuotasVencidas = conVenta.filter((o) => { const c = cobro(o); return c.fin && c.cuotas.some((q) => q.pendiente > 0 && q.fecha && UI.daysUntil(q.fecha) < 0); });

    // Una fila de Administración: saldo, cuotas, checklist y lo que falta.
    const fila = (o, boton) => {
      const e = estadoCobro(o);
      const c = e.c;
      const k = checklistAdmin(o);
      const venc = c.fin ? c.cuotas.filter((q) => q.pendiente > 0 && q.fecha && UI.daysUntil(q.fecha) < 0).length : 0;
      const enPesos = c.moneda === 'USD' && tcHoy() && c.pendiente ? ' = ' + ars(c.pendiente * tcHoy()) : '';
      const estado = c.pendiente > 0 ? `saldo ${c.M(c.pendiente)}${enPesos}` : e.valida ? 'saldo cobrado' : c.fin ? 'saldo 0' : 'saldo 0, falta marcar «Saldo cobrado»';
      return h('div.item', { onclick: () => go('obra/' + o._id + '/admin') },
        h('span.dot', { class: c.pendiente <= 0 ? 'done' : UI.daysUntil(fechaEnt(o) || '9999-12-31') <= AVISO_DIAS && esVendida(o) ? 'late' : '' }, c.fin ? '✎' : '$'),
        h('div.grow', { style: { minWidth: 0 } },
          tituloObra(o),
          h('div.small.muted.ellipsis', [c.fin ? (c.v.contratoFirmado ? 'Financiado' : 'Financiado · falta el contrato') : 'Contado', estado].join(' · ')),
          h('div.row.wrap', { style: { gap: '4px', marginTop: '4px' } },
            h('span.badge', { class: k.hechos === k.total ? 'ok' : '' }, `Checklist ${k.hechos} de ${k.total}`),
            k.aviso ? h('span.badge.red', k.aviso) : null,
            venc ? h('span.badge.red', venc > 1 ? `${venc} cuotas vencidas` : '1 cuota vencida') : null,
            !esVendida(o) ? h('span.badge.blue', AREAS[areaDe(o)].nombre) : null)),
        boton || null);
    };
    const botonCobro = (o) => {
      const e = estadoCobro(o);
      if (e.c.fin) return e.c.v.contratoFirmado ? null : h('button.btn.small', { type: 'button', onclick: (ev) => { ev.stopPropagation(); registrarContrato(o); } }, 'Contrato recibido');
      if (e.paraMarcar) return h('button.btn.small', { type: 'button', onclick: (ev) => { ev.stopPropagation(); marcarSaldoCobrado(o); } }, icon('check'), 'Saldo cobrado');
      if (e.c.pendiente > 0) return h('button.btn.small', { type: 'button', onclick: (ev) => { ev.stopPropagation(); registrarPago(o); } }, 'Registrar pago');
      return null;
    };

    const seg = h('div.seg.seg-scroll', { style: { marginTop: '14px' } }, [['cobrar', `Por cobrar (${enAdmin.length})`], ['entrega', `Cobradas / en entrega (${enEntrega.length})`], ['entregadas', `Entregadas (${entregadas.length})`], ['todas', 'Todas']].map(([val, t]) =>
      h('button', { type: 'button', class: ui.adminTab === val ? 'on' : '', onclick: () => { ui.adminTab = val; render(); } }, t)));

    let contenido;
    if (ui.adminTab === 'cobrar') {
      const listas = enAdmin.filter((o) => condicionOk(o));
      const paraMarcar = enAdmin.filter((o) => !esFinanciado(ventas[o._id]) && estadoCobro(o).paraMarcar);
      const urgentes = enAdmin.filter((o) => !condicionOk(o) && !paraMarcar.includes(o) && fechaEnt(o) && UI.daysUntil(fechaEnt(o)) <= AVISO_DIAS);
      const resto = enAdmin.filter((o) => !listas.includes(o) && !paraMarcar.includes(o) && !urgentes.includes(o));
      const aCobrar = sumaMonedas(enAdmin.filter((o) => !esFinanciado(ventas[o._id])).map((o) => { const c = cobro(o); return [c.moneda, c.pendiente]; }));
      contenido = [
        h('div.kpis',
          kpi(urgentes.length, `Urgentes (entrega en ${AVISO_DIAS} días o menos)`, null, urgentes.length ? 'bad' : ''),
          kpi(aCobrar, 'Saldos de contado a cobrar'),
          kpi(enAdmin.filter((o) => esFinanciado(ventas[o._id]) && !condicionOk(o)).length, 'Contratos por firmar'),
          kpi(cuotasVencidas.length, 'Obras con cuotas vencidas', null, cuotasVencidas.length ? 'bad' : '')),
        section('Listas para pasar a Entregas', listas.map((o) => fila(o, faltaPlano(o)
          ? h('button.btn.small', { type: 'button', onclick: (e) => { e.stopPropagation(); editObra(o); } }, 'Adjuntar plano')
          : h('button.btn.small.primary', { type: 'button', onclick: (e) => { e.stopPropagation(); habilitar(o); } }, 'Pasar a Entregas'))), 'Nada listo para pasar.'),
        paraMarcar.length ? section('Saldo en cero: falta marcar «Saldo cobrado»', paraMarcar.map((o) => fila(o, botonCobro(o))), '') : null,
        section('Urgentes', urgentes.map((o) => fila(o, botonCobro(o))), 'No hay entregas próximas con saldo o contrato pendiente.'),
        section('Pendientes, con entrega más adelante', resto.map((o) => fila(o, botonCobro(o))), 'No hay otras ventas pendientes.'),
      ];
    } else if (ui.adminTab === 'entrega') {
      contenido = [
        h('p.small.muted', { style: { marginTop: '12px' } }, 'Ya pasaron a Entregas. Siguen acá para el saldo, las cuotas, la facturación y el checklist administrativo.'),
        section('En entrega', enEntrega.map((o) => fila(o, botonCobro(o))), 'No hay obras en entrega.'),
      ];
    } else if (ui.adminTab === 'entregadas') {
      contenido = section('Entregadas', entregadas.map((o) => fila(o, botonCobro(o))), 'Todavía no hay obras entregadas.');
    } else {
      const todas = [...conVenta].sort((a, b) => (b.fechaVenta || '').localeCompare(a.fechaVenta || ''));
      contenido = section('Todas las ventas', todas.map((o) => fila(o, botonCobro(o))), 'Todavía no hay ventas.');
    }

    setMain(
      areaHead('admin', `Antes de entregar: contado → saldo en cero y marcado «Saldo cobrado» · financiado → contrato firmado en nuestro poder. ${AVISO_DIAS} días antes de la entrega avisa lo que falte. Después de pasar a Entregas, la obra sigue acá para el saldo, la facturación y el checklist.`),
      buscador(),
      h('div', { style: { marginTop: '14px' } }, tcBox()),
      seg,
      contenido);
  }

  /* ---------- 3. Entregas ---------- */

  function viewEntregas() {
    if (!ui.entTab) ui.entTab = 'obras';
    const enCurso = obras.filter(esCurso).sort((a, b) => (a.instInicio || '9').localeCompare(b.instInicio || '9'));
    const sinFecha = enCurso.filter((o) => !o.instInicio && o.conInstalacion !== false);
    const semana = proximasInstalaciones(7);
    const inc = incidenciasAbiertas();
    const proximas = obras.filter((o) => o.estado === 'vendida' && fechaEnt(o) && UI.daysUntil(fechaEnt(o)) <= 14).sort((a, b) => fechaEnt(a).localeCompare(fechaEnt(b)));
    const seg = h('div.seg', { style: { marginTop: '14px' } }, [['obras', `Obras en entrega (${enCurso.length})`], ['agenda', 'Agenda'], ['equipos', 'Equipos']].map(([v, t]) =>
      h('button', { type: 'button', class: ui.entTab === v ? 'on' : '', onclick: () => { ui.entTab = v; render(); } }, t)));
    let content;
    if (ui.entTab === 'agenda') content = calendario();
    else if (ui.entTab === 'equipos') content = equiposBlock();
    else {
      content = [
        h('div.kpis',
          kpi(semana.length, 'Instalan esta semana'),
          kpi(sinFecha.length, 'Para programar', null, sinFecha.length ? 'warn' : ''),
          kpi(inc.length, 'Incidencias abiertas', null, inc.length ? 'bad' : '')),
        sinFecha.length ? section('Para programar', sinFecha.map((o) => obraRow(o, h('button.btn.small.primary', { type: 'button', onclick: (e) => { e.stopPropagation(); programar(o); } }, 'Programar'),
          [tipoNombre(o.tipo), o.ubicacion, fechaEnt(o) ? 'entrega ' + UI.fmtDay(fechaEnt(o)) : ''].filter(Boolean).join(' · '))), '') : null,
        inc.length ? section('Incidencias abiertas', inc.map(incItem), '') : null,
        h('h2', { style: { marginTop: '22px' } }, 'En curso'),
        enCurso.length ? enCurso.map(obraCard) : h('div.card.empty', 'No hay obras en entrega.'),
        proximas.length ? section('Próximas (todavía en Administración)', proximas.map((o) => obraRow(o, h('span.row', { style: { gap: '4px' } }, cantidadesUrgentes(o) ? h('span.badge.red', 'Faltan cantidades') : null, h('span.badge', 'Entrega ' + UI.fmtDay(fechaEnt(o)))))), '') : null,
      ];
    }
    setMain(areaHead('entregas', 'Coordinar e instalar: agenda, equipo, flete, logística del interior, etapas con fotos, incidencias y checklist. Al terminar se marca entregada y pasa a Post-venta.'), buscador(), seg, content);
  }

  function obraCard(o) {
    const pct = progreso(o);
    const act = etapaActual(o);
    return h('div.card.tap.obra-card', { onclick: () => go('obra/' + o._id) },
      h('div.row',
        h('div.grow',
          h('h3.titulo-obra', h('span.ellipsis', o.nombre), pedidoChip(o)),
          h('div.small.muted.ellipsis', [tipoNombre(o.tipo), o.ubicacion, o.equipo, o.responsable ? userName(o.responsable) : ''].filter(Boolean).join(' · '))),
        h('b.pct', pct + '%')),
      h('div', { style: { margin: '10px 0 6px' } }, progressBar(pct)),
      h('div.small.row.wrap', { style: { gap: '6px' } },
        act ? [h('span.muted', act.estado === 'en_curso' ? 'En curso:' : 'Sigue:'), act.nombre] : null,
        h('span.grow'),
        o.instInicio ? h('span.badge.blue', fechasInst(o)) : h('span.badge.warn', 'Sin fecha'),
        baseNoApta(o).length ? h('span.badge.red', 'Base no apta') : (o.incidencias || []).some((i) => !i.resuelta) ? h('span.badge.red', 'Incidencia') : null,
        cantidadesUrgentes(o) ? h('span.badge.red', 'Faltan cantidades') : null));
  }

  function instItem(o) {
    const sup = superpuestas(o, o.equipo, o.instInicio, o.instFin);
    return h('div.item', { onclick: () => go('obra/' + o._id) },
      h('span.dot.doing', icon('calendar')),
      h('div.grow', { style: { minWidth: 0 } },
        tituloObra(o),
        h('div.small.muted.ellipsis', [tipoNombre(o.tipo), o.ubicacion, o.equipo, o.responsable ? userName(o.responsable) : ''].filter(Boolean).join(' · '))),
      sup.length ? h('span.badge.warn', { title: 'Mismo equipo en: ' + sup.map((x) => x.nombre).join(', ') }, 'Equipo doble') : null,
      h('span.badge.blue', fechasInst(o)));
  }

  function incItem({ obra: o, i }) {
    return h('div.item', { onclick: () => go('obra/' + o._id + '/entrega') },
      h('span.dot.late', '!'),
      h('div.grow',
        tituloObra(o, `${i.tipo} · `),
        h('div.small.muted.ellipsis', [UI.fmtDay(i.fecha), i.porNombre, i.detalle, i.avisadoCliente ? 'cliente avisado' : 'cliente sin avisar'].filter(Boolean).join(' · '))),
      icon('chev'));
  }

  function garantiaItem(o) {
    const vence = garantiaVence(o);
    const d = UI.daysUntil(vence);
    return h('div.item', { onclick: () => go('obra/' + o._id + '/postventa') },
      h('span.dot', icon('clip')),
      h('div.grow', { style: { minWidth: 0 } },
        tituloObra(o),
        h('div.small.muted.ellipsis', `Garantía de ${garantiaTexto(o)} · vence ${UI.fmtDay(vence)}`)),
      h('span.badge', { class: d < 0 ? 'red' : d <= 60 ? 'warn' : '' }, d < 0 ? 'Vencida' : UI.relDays(vence)));
  }

  /* ---------- Detalle de una obra ---------- */

  function viewObra(id, tabPedida) {
    const o = obras.find((x) => x._id === id);
    if (!o) {
      setMain(backBtn(), h('div.card.empty', obras.length ? 'La obra no existe o se eliminó.' : 'Cargando…'));
      return;
    }
    watchFotos(id);
    const tabs = canVenta ? [['venta', 'Venta'], ['admin', 'Administración'], ['entrega', 'Entrega'], ['postventa', 'Post-venta']] : [['entrega', 'Entrega']];
    const porArea = { ventas: 'venta', admin: 'admin', entregas: 'entrega', postventa: 'postventa' }[areaDe(o)];
    const tab = tabs.some(([k]) => k === tabPedida) ? tabPedida : tabs.some(([k]) => k === porArea) ? porArea : tabs[0][0];
    const tel = telDe(o);
    const wa = UI.waLink(tel);

    let content;
    if (tab === 'venta') content = ventaTab(o);
    else if (tab === 'admin') content = adminTab(o);
    else if (tab === 'postventa') content = postventaTab(o);
    else content = entregaTab(o);

    setMain(
      backBtn(),
      h('div.row', { style: { alignItems: 'flex-start' } },
        h('div.grow',
          h('h1', { style: { marginBottom: '2px' } }, o.nombre),
          h('div.muted', [tipoNombre(o.tipo) + (num(o.cantidad) > 1 ? ` × ${o.cantidad}` : ''), clientePed(o)].filter(Boolean).join(' · '))),
        h('div.row', { style: { gap: '6px' } },
          tel ? h('a.btn.small', { href: telHref(tel), 'aria-label': 'Llamar' }, icon('phone')) : null,
          wa ? h('a.btn.small', { href: wa, target: '_blank', rel: 'noopener' }, icon('whatsapp')) : null)),
      stepper(o, tab, tabs.map(([k]) => k)),
      content);
  }

  function datosCancha(o) {
    const k = canchaDe(o);
    const t = TIPOS[o.tipo] || TIPOS.otro;
    const medidas = medidasTexto(o);
    const bl = blancoTexto(o);
    const varias = k.cantidad > 1;
    const lineas = incluyeLineas(o);
    return h('div.card.info',
      infoRow('Tipo', [tipoNombre(o.tipo), k.formato ? ` · ${window.OBRAS_FORMATOS[k.formato].nombre}` : '', varias ? ` · ${k.cantidad} canchas` : '']),
      medidas ? infoRow('Medidas', medidas + (varias && t.medida === 'cancha' ? ' (cada cancha)' : '')) : null,
      bl ? infoRow('Blanco', [h('div', bl), k.blanco.pedirATomas && k.blanco.pendiente ? h('span.badge.warn', 'Pedir blanco a Tomás') : null]) : null,
      k.bicolorExtraM2 ? infoRow('Bicolor', `${m2Texto(k.bicolorExtraM2)} extra por desperdicio${varias ? ' (cada cancha)' : ''}`) : null,
      num(k.m2) ? infoRow('Césped', [h('b', m2Texto(k.m2)), t.medida !== 'm2' && k.m2 !== k.superficie ? h('span.muted', ` · superficie ${m2Texto(k.superficie)}`) : null]) : null,
      k.cesped ? infoRow('Modelo', [k.cesped, k.cespedDet.modeloFabrica && k.cespedDet.modeloFabrica !== k.cespedDet.nombre ? h('span.muted', ` (fábrica ${k.cespedDet.modeloFabrica})`) : null]) : null,
      k.multisportResidencial ? infoRow('Arena', [h('div', 'Lleva arena. Sin arena no tiene garantía.'), h('div', { style: { fontWeight: 600 } }, k.clienteColocaArena ? 'El cliente coloca la arena.' : 'La arena la colocamos nosotros.')]) : null,
      infoRow('Incluye', h('div', lineas.map((l) => h('div.incluye-ver', h('b', l.nombre + ': '), l.texto)))),
      k.sinGarantia ? infoRow('Garantía', h('b', { style: { color: 'var(--red)' } }, 'SIN GARANTÍA: la instalación está a cargo del cliente.')) : null,
      o.conStock ? infoRow('Stock', 'Sale de stock (no se fabrica)') : null,
      infoRow((o.planos || []).length > 1 ? 'Planos' : 'Plano', [
        ...(o.planos || []).map((p) => h('div', h('a', { href: '#', onclick: (e) => { e.preventDefault(); verPlano(p); } }, icon(p.mime === 'application/pdf' ? 'file' : 'eye'), ' ', p.nombre || 'Plano'),
          h('span.small.muted', ` · ${UI.fmtDay((p.fecha || '').slice(0, 10))}`))),
        faltaPlano(o) ? h('span.badge.red', `Falta el plano (obligatorio en ${porQuePlano(o)})`) : !(o.planos || []).length ? h('span.muted', 'Sin plano') : null]),
      o.consideraciones ? infoRow('Consideraciones', h('div', { style: { whiteSpace: 'pre-wrap' } }, o.consideraciones)) : null,
      infoRow('Cliente', [o.club ? h('div', h('b', o.club)) : null, o.clienteNombre ? h('div', o.clienteNombre) : null, !o.club && !o.clienteNombre ? h('div', o.cliente) : null, o.pedido ? h('div.small', h('span.pedido', { style: { marginLeft: 0 } }, pedidoTexto(o))) : null]),
      contactosDe(o).length ? infoRow('Contactos', contactosVer(o)) : null,
      o.ubicacion ? infoRow('Ubicación', h('a', { href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.ubicacion), target: '_blank', rel: 'noopener' }, o.ubicacion, o.interior ? ' (interior)' : '')) : null,
      o.notas ? infoRow('Notas', h('div', { style: { whiteSpace: 'pre-wrap' } }, o.notas)) : null);
  }

  // Plano guardado en el almacenamiento de archivos: en la obra queda sólo el link, el nombre y la fecha.
  async function verPlano(p) {
    let url = p.url;
    try { if (!url || url.startsWith('demo:')) url = await cloud.fileURL(p.path); } catch (e) { return UI.toast('No se pudo abrir el archivo: ' + e.message, 5000); }
    if (!url) return UI.toast('No se encontró el archivo.', 5000);
    if ((p.mime || '').startsWith('image/')) return UI.showPhoto(url, p.nombre);
    if (url.startsWith('data:')) {
      const blob = await (await fetch(url)).blob();
      url = URL.createObjectURL(blob);
    }
    if (!window.open(url, '_blank')) location.href = url;
  }

  // Teléfonos y mails con de quién es cada uno, y botones para llamar, mandar WhatsApp o mail.
  function contactosVer(o) {
    return h('div', contactosDe(o).map((c) => {
      const mail = c.tipo === 'mail';
      const wa = mail ? null : UI.waLink(c.valor);
      return h('div.contacto-ver',
        h('div.grow', h('span', c.valor), c.quien ? h('span.muted', ' · ' + c.quien) : null),
        mail ? h('a.btn.small.ghost', { href: 'mailto:' + c.valor, 'aria-label': 'Mandar mail' }, icon('mail'))
          : [h('a.btn.small.ghost', { href: telHref(c.valor), 'aria-label': 'Llamar' }, icon('phone')),
            wa ? h('a.btn.small.ghost', { href: wa, target: '_blank', rel: 'noopener', 'aria-label': 'WhatsApp' }, icon('whatsapp')) : null]);
    }));
  }

  function verArchivo(p) {
    if (p.mime === 'application/pdf') {
      const bin = atob(p.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      if (!window.open(url, '_blank')) location.href = url;
      return;
    }
    UI.showPhoto('data:image/jpeg;base64,' + p.data, p.nombre);
  }

  function pasoBox(texto, boton) {
    return h('div.paso', h('div.grow', texto), boton || null);
  }

  /* ----- Solapa Venta ----- */
  function ventaTab(o) {
    const v = ventas[o._id] || {};
    const falta = faltanDatosVenta(o, v);
    return [
      faltaPlano(o) ? h('div', { style: { marginBottom: '10px' } }, pasoBox(`Falta el plano (obligatorio en ${porQuePlano(o)}). Sin plano no pasa a Entregas.`, h('button.btn.primary.small', { type: 'button', onclick: () => editObra(o) }, 'Adjuntar plano'))) : null,
      o.estado === 'venta'
        ? pasoBox(falta.length ? `Faltan datos para pasar a Administración: ${falta.join(', ')}.` : 'La venta está completa.',
          h('button.btn.primary.small', { type: 'button', onclick: () => (falta.length ? editObra(o) : pasarAAdmin(o)) }, falta.length ? 'Completar' : 'Pasar a Administración'))
        : null,
      h('div.row', { style: { marginTop: '16px' } }, h('h2.grow', { style: { margin: 0 } }, 'Datos de la venta'), h('button.btn.small', { type: 'button', onclick: () => editObra(o) }, icon('edit'), 'Editar')),
      h('div.card.info', { style: { marginTop: '10px' } },
        infoRow('Fecha de venta', [UI.fmtDay(o.fechaVenta) || '—', o.creadoPorNombre ? h('span.muted', ' · cargó ' + o.creadoPorNombre) : null]),
        o.pedido ? infoRow('N° de pedido', o.pedido) : null,
        infoRow('Vendió', vendedoresTexto(v) || '—'),
        v.revendedor ? infoRow('Revendedor', [h('div', v.revendedor.nombre), h('div.small.muted', comisionTexto(v.revendedor) ? `Comisión: ${comisionTexto(v.revendedor)}` : 'Comisión sin cargar')]) : null,
        infoRow('Plazo', plazoTexto(o) || '—'),
        infoRow('Fecha de entrega', fechasEntregaTexto(o)),
        infoRow('Garantía', garantiaTexto(o) || '—'),
        v.notasVenta ? infoRow('Notas de la venta', h('div', { style: { whiteSpace: 'pre-wrap' } }, v.notasVenta)) : null),
      cobrosBlock(o),
      h('h2', 'La cancha y el cliente'),
      datosCancha(o),
    ];
  }

  /* ----- Cobros: precio, financiación, pagos registrados y cuotas ----- */
  function cobrosBlock(o) {
    const c = cobro(o);
    const v = c.v;
    const enPesos = (n) => (c.moneda === 'USD' && tcHoy() && n ? h('span.muted', ' = ' + ars(n * tcHoy()) + ' hoy') : null);
    const prox = c.fin ? proximaCuota(c) : null;
    const senaTxt = c.fin ? 'Anticipo' : 'Seña';
    return [
      h('div.row', { style: { marginTop: '22px' } },
        h('h2.grow', { style: { margin: 0 } }, 'Cobros'),
        c.total && c.pendiente > 0 ? h('button.btn.small.primary', { type: 'button', onclick: () => registrarPago(o) }, icon('money'), 'Registrar pago') : null),
      h('div.card.info', { style: { marginTop: '10px' } },
        infoRow('Forma de pago', c.fin ? 'Financiado' : 'Contado'),
        infoRow('Presupuesto', c.precio ? [h('b', c.M(c.precio)), enPesos(c.precio)] : '—'),
        infoRow('Factura', !v.iva || v.iva.tipo === 'sin' ? 'Sin factura' : [h('div', `${v.iva.tipo === 'total' ? 'IVA total' : 'IVA mínimo'}: ${c.M(num(v.iva.monto))}`), h('div.small.muted', 'Incluido en el precio total')]),
        (v.tributos || []).length ? infoRow('Tributos', [...v.tributos.map((t) => h('div', `${t.nombre}: ${c.M(num(t.monto))}`)), h('div.small.muted', 'Incluidos en el precio total')]) : null,
        infoRow(`${senaTxt} pactad${c.fin ? 'o' : 'a'}`, c.sena ? [c.M(c.sena), v.senaFecha ? h('span.muted', ' · ' + UI.fmtDay(v.senaFecha)) : null] : '—'),
        c.sena ? infoRow(`Cobrado de ${senaTxt.toLowerCase()}`, c.senaCobrada ? c.M(c.senaCobrada) : 'Nada todavía') : null,
        c.sena ? infoRow(`Falta de ${senaTxt.toLowerCase()}`, c.senaFalta > 0.005 ? h('b', { style: { color: 'var(--red)' } }, c.M(c.senaFalta)) : h('span.badge.ok', c.fin ? 'Anticipo completo' : 'Seña completa')) : null,
        c.fin ? infoRow('Financiación', [
          h('div', `Saldo ${c.M(c.plan.saldo)} + ${fmtNum(c.plan.tasaTotal)} % (${fmtNum(c.plan.tasaMensual)} % mensual) = ${c.M(c.plan.total)}`),
          h('div', h('b', `${c.plan.cantidad} cuotas de ${c.M(c.plan.cuota)}`), v.primeraCuota ? h('span.muted', ` · la primera el ${UI.fmtDay(v.primeraCuota)}`) : null)]) : null,
        c.fin ? infoRow('Total a cobrar', c.M(c.total)) : null,
        c.total ? infoRow('Pagado', [h('div', `${c.M(c.cobrado)} (${c.pct} %)`), c.aCobrar ? h('div.small.muted', `de eso, ${c.M(c.aCobrar)} en cheques a cobrar`) : null, h('div', { style: { marginTop: '6px' } }, progressBar(c.pct))]) : null,
        c.total ? infoRow('Saldo', c.pendiente > 0 ? [h('b', { style: { color: 'var(--red)' } }, c.M(c.pendiente)), enPesos(c.pendiente)] : h('span.badge.ok', 'Saldo 0: todo cobrado')) : null,
        prox ? infoRow('Próxima cuota', `N° ${prox.n} · ${prox.fecha ? UI.fmtDay(prox.fecha) + ' · ' : ''}${c.M(prox.pendiente)}${prox.pagado ? ' (resto)' : ''}`) : null),
      c.senaSinRegistrar && c.pendiente > 0 ? h('div', { style: { marginTop: '12px' } }, pasoBox(`${senaTxt} pactad${c.fin ? 'o' : 'a'} ${c.M(c.sena)}: ${c.senaCobrada ? `cobrado ${c.M(c.senaCobrada)}, falta ${c.M(c.senaFalta)}` : 'falta registrarlo como pago (cómo y dónde se pagó)'}.`,
        h('button.btn.small.primary', { type: 'button', onclick: () => pagoForm(o, null, { tipo: 'sena', monto: Math.min(c.senaFalta, c.pendiente) }) }, `Registrar ${senaTxt.toLowerCase()}`))) : null,
      h('h3', { style: { margin: '16px 0 8px' } }, 'Pagos'),
      h('div.list',
        c.filas.map((f) => pagoItem(c, f, o)),
        !c.filas.length ? h('div.item.small.muted', { style: { cursor: 'default' } }, 'Todavía no hay pagos registrados.') : null),
      c.fin && c.cuotas.length ? cuotasBlock(c) : null,
    ];
  }

  // Cuotas plegadas: arriba el resumen (pagadas y vencidas); se abre solo si hay alguna vencida.
  function cuotasBlock(c, abierto) {
    const pagadas = c.cuotas.filter((q) => q.pendiente <= 0).length;
    const vencidas = c.cuotas.filter((q) => q.pendiente > 0 && q.fecha && UI.daysUntil(q.fecha) < 0).length;
    return h('details.cuotas', { open: abierto || vencidas > 0 },
      h('summary', h('b', 'Cuotas'), h('span.muted', ` · ${pagadas} de ${c.cuotas.length} pagadas`),
        vencidas ? h('span.badge.red', { style: { marginLeft: '8px' } }, vencidas > 1 ? `${vencidas} vencidas` : '1 vencida') : null),
      h('div.list', c.cuotas.map((q) => cuotaItem(c, q, q === proximaCuota(c)))));
  }

  // Estado de cada cuota: pagada / vencida / próxima (la siguiente sin pagar) / pendiente.
  function cuotaItem(c, q, esProxima) {
    const vencida = q.pendiente > 0 && q.fecha && UI.daysUntil(q.fecha) < 0;
    const badge = q.pendiente <= 0 ? h('span.badge.ok', 'Pagada')
      : vencida ? h('span.badge.red', q.pagado ? `Vencida · falta ${c.M(q.pendiente)}` : 'Vencida')
        : q.pagado ? h('span.badge.warn', `Falta ${c.M(q.pendiente)}`)
          : esProxima ? h('span.badge.blue', `Próxima · ${q.fecha ? UI.relDays(q.fecha) : ''}`)
            : q.fecha ? h('span.badge', UI.relDays(q.fecha)) : null;
    return h('div.item', { style: { cursor: 'default' } },
      h('span.dot', { class: q.pendiente <= 0 ? 'done' : vencida ? 'late' : '' }, String(q.n)),
      h('div.grow', h('div', { style: { fontWeight: 600 } }, c.M(q.monto)), h('div.small.muted', q.fecha ? 'Vence el ' + UI.fmtDay(q.fecha) : 'Sin fecha de la primera cuota')),
      badge);
  }

  /* ----- Pagos: forma, dónde, cheques, comprobantes y recibo ----- */

  const FORMAS = window.OBRAS_FORMAS_PAGO;
  const formaNombre = (f) => (FORMAS.find(([k]) => k === f) || [f, f || ''])[1];
  const ESTADOS_CHEQUE = [['pendiente', 'Pendiente'], ['cobrado', 'Cobrado'], ['rechazado', 'Rechazado']];
  const reciboTexto = (n) => (n ? 'N° ' + String(n).padStart(4, '0') : '');
  const activos = (lista, actualId) => lista.filter((x) => x.activo !== false || x._id === actualId).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

  // Dónde se pagó, armado solo a partir de la forma: «Transferencia a Polimetal», «Depósito en Atlantis».
  function dondeTexto(p) {
    const d = p.destino || {};
    if (p.forma === 'proveedor') return `Transferencia a ${d.proveedorNombre || 'proveedor'}${d.cuentaTexto ? ` (${d.cuentaTexto})` : ''}`;
    if (p.forma === 'cuenta') return `Depósito en ${d.cuentaNombre || 'cuenta nuestra'}`;
    if (p.forma === 'efectivo_ars' || p.forma === 'efectivo_usd') return formaNombre(p.forma) + (d.cuentaNombre ? ' · ' + d.cuentaNombre : '');
    if (p.forma === 'cheque') {
      const n = (p.cheques || []).length;
      return `${n === 1 ? '1 cheque' : n + ' cheques'}${d.cuentaNombre ? ' · depositado en ' + d.cuentaNombre : d.proveedorNombre ? ' · endosado a ' + d.proveedorNombre : ''}`;
    }
    return p.medio || p.donde || '';
  }
  const chequeTexto = (p, ch) => [`Cheque ${ch.numero || 's/n'}`, ch.banco, CALC.money(num(ch.monto), p.moneda), ch.fechaCobro ? 'cobro ' + UI.fmtDay(ch.fechaCobro) : ''].filter(Boolean).join(' · ');
  const chequeBadge = (ch) => (ch.estado === 'cobrado' ? h('span.badge.ok', 'Cobrado') : ch.estado === 'rechazado' ? h('span.badge.red', 'Rechazado') : h('span.badge.warn', 'A cobrar'));

  function pagoItem(c, f, o) {
    const p = f.p;
    const otra = p.moneda !== c.moneda;
    return h('div.item.pago-item', { onclick: () => pagoForm(o, p) },
      h('span.dot.done', '$'),
      h('div.grow', { style: { minWidth: 0 } },
        h('div', { style: { fontWeight: 600 } }, CALC.money(num(p.monto), p.moneda), otra ? h('span.muted', ` = ${c.M(f.valor)}`) : null,
          p.tipo === 'sena' ? h('span.badge', { style: { marginLeft: '6px' } }, c.fin ? 'Anticipo' : 'Seña') : null),
        h('div.small.muted', [UI.fmtDay(p.fecha), dondeTexto(p), num(p.tc) ? 'TC ' + tcFmt(num(p.tc)) : '', reciboTexto(p.recibo) ? 'recibo ' + reciboTexto(p.recibo) : ''].filter(Boolean).join(' · ')),
        (p.cheques || []).map((ch) => h('div.small', { style: { marginTop: '3px' } }, chequeTexto(p, ch), ' ', chequeBadge(ch))),
        h('div.small', { style: { marginTop: '3px' } }, h('span.muted', 'Saldo después: '), f.saldoDespues > 0 ? c.M(f.saldoDespues) : h('b', 'cero')),
        p.retiro && p.retiro.buscado ? h('div.small', { style: { marginTop: '3px' } }, `Lo fuimos a buscar: ${p.retiro.quien}${p.retiro.donde ? ' · ' + p.retiro.donde : ''}`) : null,
        !p.registrado ? h('div.small', { style: { color: 'var(--warn)', marginTop: '2px' } }, 'Falta cargarlo en nuestros registros') : null,
        p.factura === 'solicitar' ? h('div.small', { style: { color: 'var(--warn)', marginTop: '2px' } }, 'Hay que solicitar la factura') : null),
      h('button.btn.small.ghost', { type: 'button', onclick: (e) => { e.stopPropagation(); go(`recibo/${o._id}/${p._id}`); } }, icon('file'), 'Recibo'));
  }

  // Comprobantes de cada obra (se bajan la primera vez que se abren los pagos de esa obra).
  const comprobantesPorObra = {};
  const comprobantesSubs = {};
  function watchComprobantes(obraId) {
    if (!canVenta || !obraId || comprobantesSubs[obraId]) return;
    comprobantesSubs[obraId] = cloud.subscribe(`ventas/${obraId}/comprobantes`, (items) => { comprobantesPorObra[obraId] = items; }, () => {});
  }
  function verComprobante(obraId, meta) {
    const f = (comprobantesPorObra[obraId] || []).find((x) => x._id === meta.id);
    if (!f) return UI.toast('Bajando el comprobante, probá de nuevo en un momento…');
    verArchivo(f);
  }

  // Cheques de un pago: n°, a nombre de, banco, fecha de cobro, monto y estado.
  function chequesEditor(lista, onChange) {
    const rows = h('div');
    const add = (ch = {}) => {
      const f = {
        numero: UI.field({ label: 'N° de cheque', name: '', value: ch.numero || '' }),
        aNombreDe: UI.field({ label: 'A nombre de', name: '', value: ch.aNombreDe || '' }),
        banco: UI.field({ label: 'Banco', name: '', value: ch.banco || '' }),
        fechaCobro: UI.field({ label: 'Fecha de cobro', name: '', type: 'date', value: ch.fechaCobro || '' }),
        monto: UI.field({ label: 'Monto', name: '', value: ch.monto ? fmtNum(num(ch.monto)) : '' }),
        estado: UI.field({ label: 'Estado', name: '', type: 'select', value: ch.estado || 'pendiente', options: ESTADOS_CHEQUE }),
        cobradoFecha: UI.field({ label: 'Fecha real de cobro', name: '', type: 'date', value: ch.cobradoFecha || '' }),
        cobradoTC: UI.field({ label: 'Dólar BNA del día del cobro ($)', name: '', value: ch.cobradoTC ? fmtNum(num(ch.cobradoTC)) : '' }),
      };
      // Los campos no llevan «name»: se leen acá, no con el resto del pago.
      for (const k of Object.keys(f)) f[k].querySelector('input,select').removeAttribute('name');
      const inp = (k) => f[k].querySelector('input,select');
      numeroInput(inp('monto'));
      numeroInput(inp('cobradoTC'));
      const cobradoBox = h('div', fila2(f.cobradoFecha, f.cobradoTC));
      const ponerCobro = () => {
        cobradoBox.hidden = inp('estado').value !== 'cobrado';
        if (inp('estado').value === 'cobrado' && !inp('cobradoFecha').value) inp('cobradoFecha').value = UI.today();
        if (inp('estado').value === 'cobrado' && !inp('cobradoTC').value && tcDe(inp('cobradoFecha').value)) inp('cobradoTC').value = fmtNum(tcDe(inp('cobradoFecha').value));
      };
      inp('estado').addEventListener('change', () => { ponerCobro(); onChange(); });
      inp('cobradoFecha').addEventListener('change', () => { const tc = tcDe(inp('cobradoFecha').value); if (tc) inp('cobradoTC').value = fmtNum(tc); onChange(); });
      const row = h('div.cheque',
        h('div.row', h('b.grow', 'Cheque'), h('button.btn.small.ghost', { type: 'button', 'aria-label': 'Quitar cheque', onclick: () => { row.remove(); onChange(); } }, icon('trash'))),
        fila2(f.numero, f.banco), f.aNombreDe, fila2(f.fechaCobro, f.monto), f.estado, cobradoBox);
      row.leer = () => ({
        id: ch.id || uid(), numero: inp('numero').value.trim(), aNombreDe: inp('aNombreDe').value.trim(), banco: inp('banco').value.trim(),
        fechaCobro: inp('fechaCobro').value, monto: num(inp('monto').value), estado: inp('estado').value,
        cobradoFecha: inp('estado').value === 'cobrado' ? inp('cobradoFecha').value : '',
        cobradoTC: inp('estado').value === 'cobrado' ? num(inp('cobradoTC').value) : 0,
      });
      ponerCobro();
      rows.append(row);
    };
    (lista.length ? lista : [{}]).forEach(add);
    const el = h('div', rows, h('button.btn.small', { type: 'button', style: { marginBottom: '14px' }, onclick: () => { add(); onChange(); } }, icon('plus'), 'Otro cheque'));
    el.addEventListener('input', onChange);
    return { el, leer: () => [...rows.children].map((r) => r.leer()) };
  }
  const fila2 = (a, b) => h('div.row', { style: { gap: '10px', alignItems: 'flex-start' } }, h('div.grow', { style: { minWidth: 0 } }, a), h('div.grow', { style: { minWidth: 0 } }, b));

  // Qué cambió en un pago (queda en su historial).
  function cambiosPago(a, b) {
    const out = [];
    const cmp = (k, txt) => { const x = txt(a); const y = txt(b); if (x !== y) out.push(`${k}: ${x || '—'} → ${y || '—'}`); };
    cmp('fecha', (p) => UI.fmtDay(p.fecha));
    cmp('monto', (p) => CALC.money(num(p.monto), p.moneda));
    cmp('dólar', (p) => (num(p.tc) ? tcFmt(num(p.tc)) : ''));
    cmp('forma', (p) => dondeTexto(p));
    cmp('cheques', (p) => (p.cheques || []).map((ch) => `${ch.numero || 's/n'} ${CALC.money(num(ch.monto), p.moneda)} ${ch.estado || 'pendiente'}`).join(', '));
    cmp('registrado', (p) => (p.registrado ? 'sí' : 'no'));
    cmp('factura', (p) => ({ tiene: 'ya tiene', solicitar: 'hay que solicitarla' }[p.factura] || ''));
    cmp('comprobantes', (p) => String((p.comprobantes || []).length));
    cmp('retiro', (p) => (p.retiro && p.retiro.buscado ? `lo retiró ${p.retiro.quien}${p.retiro.donde ? ' en ' + p.retiro.donde : ''}` : ''));
    cmp('nota', (p) => p.nota || '');
    return out;
  }

  /*
   * Registrar o editar un pago (también la seña o el anticipo): parcial o total, en dólares o pesos.
   * preset: { tipo: 'sena', monto } para la seña.
   */
  function pagoForm(o, p, preset = {}) {
    const c = cobro(o);
    const nuevo = !p;
    if (nuevo && !c.total) return UI.toast('Primero cargá el presupuesto de la venta.');
    const tipo = p ? p.tipo || 'pago' : preset.tipo || 'pago';
    const valorAntes = p ? CALC.valorPago(p, c.moneda) : 0;
    const pendiente = CALC.round2(c.pendiente + valorAntes); // lo que falta sin contar este pago
    if (nuevo && pendiente <= 0) return UI.toast('El saldo ya es cero.');
    const prox = c.fin && tipo !== 'sena' ? proximaCuota(c) : null;
    const sugerido = preset.monto ?? (prox ? Math.min(prox.pendiente, pendiente) : pendiente);
    watchComprobantes(o._id);
    const senaTxt = c.fin ? 'anticipo' : 'seña';
    const p0 = p || { tipo, fecha: UI.today(), moneda: c.moneda, forma: 'cuenta', destino: {}, cheques: [], comprobantes: [], registrado: false, factura: 'solicitar', nota: '' };

    const fechaF = UI.field({ label: 'Fecha del pago', name: 'fecha', type: 'date', value: p0.fecha || UI.today() });
    const formaF = UI.field({ label: 'Forma de pago', name: 'forma', type: 'select', value: p0.forma || 'cuenta', options: FORMAS });
    const destinoBox = h('div');
    const monedaF = UI.field({ label: 'Moneda', name: 'moneda', type: 'select', value: p0.moneda || c.moneda, options: [['USD', 'US$'], ['ARS', '$']] });
    const montoF = UI.field({ label: 'Monto', name: 'monto', value: p ? fmtNum(num(p.monto)) : '' });
    const tcF = UI.field({ label: 'Dólar BNA vendedor del día ($)', name: 'tc', value: '' });
    const tcNota = h('p.small.muted', { style: { marginTop: '-8px' } });
    const equiv = h('div.calc');
    const facturaF = UI.field({ label: 'Factura', name: 'factura', type: 'select', value: p0.factura || 'solicitar', options: [['solicitar', 'Hay que solicitarla'], ['tiene', 'Ya tiene factura']] });
    const facturaBox = h('div', facturaF);
    const metaComp = (p0.comprobantes || []);
    const comp = adjuntosEditor({
      existentes: metaComp.map((m) => ({ ...m, _id: m.id })), label: 'Comprobantes', boton: 'Adjuntar comprobante (foto o PDF)',
      ver: (m) => (m.data ? verArchivo(m) : verComprobante(o._id, { id: m._id })),
    });
    let chequesEd = null;
    const chequesBox = h('div');
    // Seña o anticipo: lo pactado, lo cobrado y lo que falta, con el equivalente en la moneda elegida.
    const senaAntes = tipo === 'sena' && p && p.tipo === 'sena' ? valorAntes : 0;
    const senaCobradaSin = CALC.round2(c.senaCobrada - senaAntes); // cobrado de seña sin contar este pago
    const senaBox = h('div.card.info.sena-box', { style: { marginBottom: '14px' } });
    // Efectivo: ¿lo fuimos a buscar? Quién lo retiró y dónde.
    const r0 = p0.retiro || {};
    const retiroF = UI.field({ label: '¿Lo fuimos a buscar?', name: 'retiroBuscado', type: 'select', value: r0.buscado ? 'si' : 'no', options: [['no', 'No'], ['si', 'Sí']] });
    const quienes = [...new Set([...users.map((u) => u.nombre), ...cat.vendedores.map((x) => x.nombre), ...Object.values(pagosPorObra).flat().map((x) => (x.retiro || {}).quien)].filter(Boolean))].sort();
    const quienListId = 'retiro-' + uid();
    const retiroDatos = h('div', fila2(
      h('label.field', h('span', 'Quién lo retiró'), h('input', { name: 'retiroQuien', type: 'text', list: quienListId, value: r0.quien || '', placeholder: 'Ej: Fede Ferrari', autocomplete: 'off' }), h('datalist', { id: quienListId }, quienes.map((q) => h('option', { value: q })))),
      UI.field({ label: 'Dónde', name: 'retiroDonde', value: r0.donde || '', placeholder: 'Ej: en la obra, oficina del club' })));
    const retiroBox = h('div', retiroF, retiroDatos);
    const montoInp = numeroInput(montoF.querySelector('input'));
    const tcInp = numeroInput(tcF.querySelector('input'));
    const monedaSel = monedaF.querySelector('select');
    const formaSel = formaF.querySelector('select');
    const fechaInp = fechaF.querySelector('input');
    let montoTocado = !!p;
    let tcTocado = !!(p && p.tcManual);
    montoInp.addEventListener('input', () => { montoTocado = true; });
    tcInp.addEventListener('input', () => { tcTocado = true; });
    tcInp.value = p && num(p.tc) ? fmtNum(num(p.tc)) : tcDe(fechaInp.value) ? fmtNum(tcDe(fechaInp.value)) : '';

    const body = h('div',
      h('div.row', { style: { marginTop: '-8px', marginBottom: '10px' } }, h('p.muted.grow', { style: { margin: 0 } }, o.nombre),
        p ? h('button.btn.small', { type: 'button', onclick: () => { document.querySelectorAll('dialog.sheet[open]').forEach((dl) => dl.close()); go(`recibo/${o._id}/${p._id}`); } }, icon('file'), 'Recibo') : null),
      h('div.card.info', { style: { marginBottom: '14px' } },
        infoRow('Total a cobrar', c.M(c.total)),
        infoRow('Pagado', `${c.M(CALC.round2(c.cobrado - valorAntes))}`),
        infoRow(p ? 'Saldo sin este pago' : 'Saldo', h('b', c.M(pendiente))),
        prox ? infoRow('Próxima cuota', `N° ${prox.n}${prox.fecha ? ' · ' + UI.fmtDay(prox.fecha) : ''} · ${c.M(prox.pendiente)}`) : null),
      tipo === 'sena' ? senaBox : null,
      fila2(fechaF, formaF),
      destinoBox,
      retiroBox,
      h('div.row', { style: { gap: '10px', alignItems: 'flex-start' } }, h('div', { style: { width: '34%' } }, monedaF), h('div.grow', montoF)),
      chequesBox,
      tcF, tcNota,
      equiv,
      facturaBox,
      comp.el,
      h('label.check', h('input', { type: 'checkbox', name: 'registrado', checked: !!p0.registrado }), 'Registrado en nuestros registros'),
      UI.field({ label: 'Nota (opcional)', name: 'nota', value: p0.nota || '', placeholder: 'Ej: cuota 3, pagó el hijo del dueño' }),
      p && (p.historial || []).length ? h('details.historial', h('summary.small.muted', 'Historial del pago'),
        h('div.small.muted', (p.historial || []).map((x) => h('div', `${UI.fmtStamp(x.fecha)} · ${x.porNombre || ''} · ${x.accion}${(x.cambios || []).length ? ': ' + x.cambios.join('; ') : ''}`)))) : null);

    // Dónde: depende de la forma de pago.
    const destino0 = p0.destino || {};
    const cuentaDe = (id) => cat.cuentas.find((x) => x._id === id);
    const pintarDestino = () => {
      const forma = formaSel.value;
      let campos = [];
      if (forma === 'proveedor') {
        const provs = activos(cat.proveedores, destino0.proveedorId);
        const provF = UI.field({ label: 'Proveedor', name: 'proveedorId', type: 'select', value: destino0.proveedorId || '', options: [['', 'Elegí…'], ...provs.map((x) => [x._id, x.nombre])] });
        const ctaF = UI.field({ label: 'Cuenta del proveedor', name: 'cuentaProveedorId', type: 'select', value: destino0.cuentaProveedorId || '', options: [] });
        const llenar = () => {
          const pr = cat.proveedores.find((x) => x._id === provF.querySelector('select').value);
          const cts = (pr && pr.cuentas) || [];
          ctaF.querySelector('select').replaceChildren(...[['', cts.length ? 'Elegí…' : 'Sin cuentas cargadas'], ...cts.map((x) => [x.id, cuentaProvTexto(x)])]
            .map(([val, t]) => h('option', { value: val, selected: val === destino0.cuentaProveedorId || (cts.length === 1 && val === cts[0].id) }, t)));
        };
        provF.querySelector('select').addEventListener('change', llenar);
        llenar();
        campos = [fila2(provF, ctaF), provs.length ? null : h('p.small.muted', { style: { marginTop: '-8px' } }, 'No hay proveedores cargados: agregalos en Más → Catálogos.')];
      } else if (forma === 'cuenta' || forma === 'efectivo_ars' || forma === 'efectivo_usd') {
        const efectivo = forma !== 'cuenta';
        const lista = activos(cat.cuentas, destino0.cuentaId).filter((x) => (x.tipo === 'efectivo') === efectivo);
        const def = destino0.cuentaId || (lista.length === 1 ? lista[0]._id : '');
        campos = [UI.field({ label: efectivo ? 'Caja' : 'Cuenta nuestra', name: 'cuentaId', type: 'select', value: def, options: [['', efectivo ? 'Sin indicar' : 'Elegí…'], ...lista.map((x) => [x._id, x.nombre])] }),
          lista.length ? null : h('p.small.muted', { style: { marginTop: '-8px' } }, `No hay ${efectivo ? 'cajas de efectivo' : 'cuentas'} cargadas: agregalas en Más → Catálogos.`)];
      } else if (forma === 'cheque') {
        const val0 = destino0.cuentaId ? 'cuenta:' + destino0.cuentaId : destino0.proveedorId ? 'proveedor:' + destino0.proveedorId : '';
        const sel = h('select', { name: 'chequeDestino' },
          h('option', { value: '' }, 'En cartera (sin depositar)'),
          h('optgroup', { label: 'Depositado en' }, activos(cat.cuentas, destino0.cuentaId).filter((x) => x.tipo !== 'efectivo').map((x) => h('option', { value: 'cuenta:' + x._id, selected: val0 === 'cuenta:' + x._id }, x.nombre))),
          h('optgroup', { label: 'Endosado a proveedor' }, activos(cat.proveedores, destino0.proveedorId).map((x) => h('option', { value: 'proveedor:' + x._id, selected: val0 === 'proveedor:' + x._id }, x.nombre))));
        campos = [h('label.field', h('span', 'Dónde quedó el cheque'), sel)];
      }
      destinoBox.replaceChildren(...campos.filter(Boolean));
      // Cheques
      if (forma === 'cheque') {
        if (!chequesEd) chequesEd = chequesEditor(p0.cheques || [], refresh);
        chequesBox.replaceChildren(chequesEd.el);
      } else chequesBox.replaceChildren();
      // Efectivo: la moneda es la del efectivo.
      if (forma === 'efectivo_ars') monedaSel.value = 'ARS';
      if (forma === 'efectivo_usd') monedaSel.value = 'USD';
      monedaSel.disabled = forma === 'efectivo_ars' || forma === 'efectivo_usd';
      montoInp.readOnly = forma === 'cheque';
    };

    // El pago tal como está en el formulario.
    const borrador = () => {
      const val = UI.values(body);
      const forma = val.forma;
      const destino = {};
      if (forma === 'proveedor') {
        const pr = cat.proveedores.find((x) => x._id === val.proveedorId);
        const ct = pr && (pr.cuentas || []).find((x) => x.id === val.cuentaProveedorId);
        Object.assign(destino, { proveedorId: val.proveedorId || '', proveedorNombre: pr ? pr.nombre : destino0.proveedorNombre || '', cuentaProveedorId: val.cuentaProveedorId || '', cuentaTexto: ct ? cuentaProvTexto(ct) : '' });
      } else if (forma === 'cheque') {
        const [k, id] = (val.chequeDestino || '').split(':');
        if (k === 'cuenta') { const ct = cuentaDe(id); Object.assign(destino, { cuentaId: id, cuentaNombre: ct ? ct.nombre : '' }); }
        if (k === 'proveedor') { const pr = cat.proveedores.find((x) => x._id === id); Object.assign(destino, { proveedorId: id, proveedorNombre: pr ? pr.nombre : '' }); }
      } else if (val.cuentaId) {
        const ct = cuentaDe(val.cuentaId);
        Object.assign(destino, { cuentaId: val.cuentaId, cuentaNombre: ct ? ct.nombre : destino0.cuentaNombre || '' });
      }
      const cheques = forma === 'cheque' && chequesEd ? chequesEd.leer() : [];
      const moneda = monedaSel.value;
      const monto = forma === 'cheque' ? CALC.round2(cheques.reduce((a, ch) => a + num(ch.monto), 0)) : num(val.monto);
      const tc = num(val.tc);
      const ct = destino.cuentaId && cuentaDe(destino.cuentaId);
      const efectivo = forma === 'efectivo_ars' || forma === 'efectivo_usd';
      const retiro = efectivo ? { buscado: val.retiroBuscado === 'si', quien: val.retiroBuscado === 'si' ? (val.retiroQuien || '').trim() : '', donde: val.retiroBuscado === 'si' ? (val.retiroDonde || '').trim() : '' } : null;
      return { val, forma, destino, cheques, moneda, monto, tc, retiro, pideFactura: !!(ct && ct.pideFactura) };
    };

    const refresh = () => {
      const b = borrador();
      if (b.forma === 'cheque') montoInp.value = b.monto ? fmtNum(b.monto) : '';
      montoF.querySelector('span').textContent = b.forma === 'cheque' ? `Monto (suma de los cheques, ${b.moneda === 'ARS' ? '$' : 'US$'})` : `Monto (${b.moneda === 'ARS' ? '$' : 'US$'})`;
      const tcBNA = tcDe(fechaInp.value);
      tcNota.textContent = !b.tc ? 'Sin dato del BNA para ese día: escribilo.' : tcBNA && Math.abs(b.tc - tcBNA) > 0.001 ? `Cambiado a mano (el BNA de ese día es ${tcFmt(tcBNA)}).` : 'Billete, columna venta, del día del pago.';
      const draft = { forma: b.forma, moneda: b.moneda, monto: b.monto, tc: b.tc, cheques: b.cheques };
      const valor = CALC.valorPago(draft, c.moneda);
      const queda = CALC.round2(pendiente - valor);
      const partes = [];
      if (b.monto && b.tc) partes.push(h('div', `Equivale a ${CALC.money(CALC.equivalente(b.monto, b.moneda, b.tc), b.moneda === 'USD' ? 'ARS' : 'USD')}`));
      if (b.moneda !== c.moneda && !b.tc) partes.push(h('div', 'Falta el dólar para pasarlo a la moneda de la venta.'));
      if (b.monto && (b.moneda === c.moneda || b.tc)) {
        if (queda < -0.005) partes.push(h('div', { style: { color: 'var(--red)', fontWeight: 600 } }, `Supera el saldo (${c.M(pendiente)}).`));
        else if (queda <= 0.005) partes.push(h('div', { style: { color: 'var(--ok)', fontWeight: 600 } }, 'Con este pago el saldo queda en cero.'));
        else partes.push(h('div', `Saldo después de este pago: ${c.M(queda)}.`));
      }
      equiv.replaceChildren(...partes);
      equiv.hidden = !partes.length;
      facturaBox.hidden = !b.pideFactura;
      const efectivo = b.forma === 'efectivo_ars' || b.forma === 'efectivo_usd';
      retiroBox.hidden = !efectivo;
      retiroDatos.hidden = !(efectivo && b.val.retiroBuscado === 'si');
      if (tipo === 'sena') {
        // Lo pactado pasado a la moneda en que paga: «US$ 7.500 = $ 11.775.000 a TC 1.570».
        const enOtra = (n) => (b.moneda !== c.moneda && b.tc ? ` = ${CALC.money(c.moneda === 'USD' ? n * b.tc : n / b.tc, b.moneda)} a TC ${fmtNum(b.tc)}` : '');
        const falta = Math.max(0, CALC.round2(c.sena - senaCobradaSin));
        senaBox.replaceChildren(...[
          infoRow(`${c.fin ? 'Anticipo pactado' : 'Seña pactada'}`, h('b', c.M(c.sena) + enOtra(c.sena))),
          senaCobradaSin ? infoRow(`Cobrado de ${senaTxt}`, c.M(senaCobradaSin)) : null,
          senaCobradaSin ? infoRow(`Falta de ${senaTxt}`, c.M(falta) + enOtra(falta)) : null].filter(Boolean));
      }
    };

    // Monto propuesto: el saldo (o la próxima cuota, o la seña) en la moneda en que paga.
    const proponer = () => {
      if (montoTocado || formaSel.value === 'cheque') return;
      const tc = num(tcInp.value);
      let n = sugerido;
      if (monedaSel.value !== c.moneda) n = tc ? (monedaSel.value === 'ARS' ? sugerido * tc : sugerido / tc) : 0;
      n = monedaSel.value === 'ARS' ? Math.round(n) : CALC.round2(n);
      montoInp.value = n ? fmtNum(n) : '';
    };
    fechaInp.addEventListener('change', () => { if (!tcTocado) { const tc = tcDe(fechaInp.value); tcInp.value = tc ? fmtNum(tc) : ''; } proponer(); refresh(); });
    formaSel.addEventListener('change', () => { pintarDestino(); proponer(); refresh(); });
    monedaSel.addEventListener('change', () => { proponer(); refresh(); });
    body.addEventListener('input', refresh);
    body.addEventListener('change', refresh);
    pintarDestino();
    proponer();
    refresh();

    const guardar = async () => {
      const b = borrador();
      const { val } = b;
      if (!val.fecha) throw new Error('Poné la fecha del pago.');
      if (b.forma === 'proveedor' && !b.destino.proveedorId) throw new Error('Elegí a qué proveedor se transfirió.');
      if (b.forma === 'cuenta' && !b.destino.cuentaId) throw new Error('Elegí en qué cuenta nuestra entró.');
      if (b.forma === 'cheque') {
        if (!b.cheques.length) throw new Error('Cargá al menos un cheque.');
        const mal = b.cheques.find((ch) => !(ch.monto > 0) || !ch.fechaCobro);
        if (mal) throw new Error('Cada cheque necesita monto y fecha de cobro.');
        if (b.cheques.some((ch) => ch.estado === 'cobrado' && b.moneda !== c.moneda && !ch.cobradoTC)) throw new Error('Falta el dólar del día del cobro del cheque.');
      }
      if (!(b.monto > 0)) throw new Error('Poné el monto del pago.');
      if (b.moneda !== c.moneda && !b.tc) throw new Error('Falta el dólar de ese día para pasar el pago a la moneda de la venta.');
      const draft = { forma: b.forma, moneda: b.moneda, monto: b.monto, tc: b.tc, cheques: b.cheques };
      const valor = CALC.valorPago(draft, c.moneda);
      if (valor > pendiente + 0.01) throw new Error(`El pago (${c.M(valor)}) supera el saldo (${c.M(pendiente)}). Revisá el monto o el presupuesto de la venta.`);
      if (b.retiro && b.retiro.buscado && !b.retiro.quien) throw new Error('Poné quién lo fue a buscar.');
      // Seña: si lo cobrado de seña no coincide con lo pactado, ¿se actualiza lo pactado?
      let nuevaSena = null;
      if (tipo === 'sena') {
        const senaDespues = CALC.round2(senaCobradaSin + Math.min(valor, pendiente));
        if (Math.abs(senaDespues - c.sena) > 0.01) {
          const r = await elegir(`¿Actualizar ${c.fin ? 'el anticipo pactado' : 'la seña pactada'}?`,
            `${c.fin ? 'El anticipo pactado' : 'La seña pactada'} es ${c.M(c.sena)} y con este pago lo cobrado de ${senaTxt} queda en ${c.M(senaDespues)}. ¿Actualizar ${c.fin ? 'el anticipo pactado' : 'la seña pactada'} a ${c.M(senaDespues)}?${c.fin ? ' Las cuotas se recalculan.' : ''}`,
            [['no', senaDespues < c.sena ? `No, falta cobrar ${c.M(CALC.round2(c.sena - senaDespues))}` : `No, dejar ${c.M(c.sena)}`], ['si', 'Sí, actualizar', 'primary']]);
          if (!r) return false;
          if (r === 'si') nuevaSena = senaDespues;
        }
      }
      const col = `ventas/${o._id}/pagos`;
      const id = p ? p._id : cloud.newId();
      // Comprobantes: los nuevos se guardan aparte; en el pago queda la lista.
      const nuevos = comp.nuevos.map((a) => ({ ...a, id: cloud.newId() }));
      const comprobantes = [...metaComp.filter((m) => !comp.quitados.has(m.id)), ...nuevos.map((a) => ({ id: a.id, nombre: a.nombre, mime: a.mime }))];
      const tcBNA = tcDe(val.fecha);
      const data = {
        ...(p || {}),
        obraId: o._id, tipo, fecha: val.fecha, moneda: b.moneda, monto: b.monto, tc: b.tc,
        tcManual: !!b.tc && (!tcBNA || Math.abs(b.tc - tcBNA) > 0.001), equivalente: CALC.equivalente(b.monto, b.moneda, b.tc),
        monedaVenta: c.moneda, valor, forma: b.forma, destino: b.destino, cheques: b.cheques, comprobantes,
        registrado: !!val.registrado, factura: b.pideFactura ? val.factura : '', nota: val.nota, retiro: b.retiro,
        editadoPor: me.email, editadoPorNombre: me.nombre, editadoEn: cloud.serverTime(),
      };
      if (nuevo) {
        let n;
        try { n = await cloud.nextNumber('recibo'); } catch (e) { throw new Error('No se pudo sacar el número de recibo: hace falta conexión a internet.'); }
        Object.assign(data, { recibo: n, creadoPor: me.email, creadoPorNombre: me.nombre, creadoEn: cloud.serverTime() });
      }
      const cambios = nuevo ? [] : cambiosPago(p, data);
      if (!nuevo && !cambios.length) return; // no cambió nada
      data.historial = [...((p && p.historial) || []), { fecha: new Date().toISOString(), por: me.email, porNombre: me.nombre, accion: nuevo ? 'registrado' : 'editado', cambios }];
      const queda = CALC.round2(pendiente - valor);
      const quitarMarca = opsQuitarMarca(o, queda);
      cloud.write([
        { op: 'set', col, id, data },
        ...(nuevaSena != null ? [{ op: 'update', col: 'ventas', id: o._id, data: { sena: nuevaSena, ...stamp() } }] : []),
        ...quitarMarca,
        ...nuevos.map((a) => ({ op: 'set', col: `ventas/${o._id}/comprobantes`, id: a.id, data: { obraId: o._id, pagoId: id, nombre: a.nombre, mime: a.mime, data: a.data, por: me.email, porNombre: me.nombre, fecha: new Date().toISOString() } })),
        ...[...comp.quitados].map((cid) => ({ op: 'delete', col: `ventas/${o._id}/comprobantes`, id: cid })),
      ]);
      const txt = nuevo ? `Pago registrado (recibo ${reciboTexto(data.recibo)}).` : 'Pago corregido.';
      if (quitarMarca.length) UI.toast(`${txt} El saldo volvió a ${c.M(queda)}: se quitó la marca «Saldo cobrado».`, 5000);
      else if (queda > 0.005) UI.toast(`${txt} Saldo: ${c.M(queda)}.`, 3500);
      else UI.toast(`${txt} El saldo quedó en cero${esFinanciado(c.v) ? '' : ': ya se puede marcar «Saldo cobrado»'}.`, 4000);
    };

    const actions = [{ label: 'Cancelar' }, { label: nuevo ? 'Guardar pago' : 'Guardar', kind: 'primary', onClick: guardar }];
    if (p) {
      actions.unshift({
        label: 'Borrar', kind: 'danger', onClick: async () => {
          if (!(await UI.confirm('¿Borrar el pago?', `${CALC.money(num(p.monto), p.moneda)} del ${UI.fmtDay(p.fecha)}. Deja de contar como pagado y se borran sus comprobantes. No se puede deshacer.`, 'Borrar', 'danger'))) return false;
          const quitarMarca = opsQuitarMarca(o, CALC.round2(c.pendiente + valorAntes));
          cloud.write([{ op: 'delete', col: `ventas/${o._id}/pagos`, id: p._id }, ...(p.comprobantes || []).map((m) => ({ op: 'delete', col: `ventas/${o._id}/comprobantes`, id: m.id })), ...quitarMarca]);
          if (quitarMarca.length) { UI.toast('Pago borrado: el saldo dejó de ser 0 y se quitó la marca «Saldo cobrado».', 5000); return; }
          UI.toast('Pago borrado');
        },
      });
    }
    UI.sheet({ title: p ? `Pago ${reciboTexto(p.recibo)}`.trim() : tipo === 'sena' ? `Registrar ${senaTxt}` : 'Registrar pago', body: [body], actions });
  }

  const cuentaProvTexto = (x) => [x.banco, x.alias || x.cbu, x.titular].filter(Boolean).join(' · ');

  /* ----- Solapa Administración ----- */
  function adminTab(o) {
    const e = estadoCobro(o);
    const c = e.c;
    const v = c.v;
    const fin = c.fin;
    const enAdmin = o.estado === 'vendida';
    const d = fechaEnt(o) ? UI.daysUntil(fechaEnt(o)) : null;
    watchComprobantes(o._id);
    let paso = null;
    if (o.estado === 'venta') paso = pasoBox('Todavía está en Ventas: falta completar la venta.', h('button.btn.small', { type: 'button', onclick: () => editObra(o) }, 'Completar'));
    else if (e.vencida) paso = pasoBox(h('span', { style: { color: 'var(--red)' } }, `Se había marcado «Saldo cobrado», pero el saldo volvió a ${c.M(c.pendiente)}. La marca ya no vale.`), h('button.btn.small', { type: 'button', onclick: () => quitarMarcaCobrado(o) }, 'Quitar la marca'));
    else if (enAdmin && condicionOk(o) && faltaPlano(o)) paso = pasoBox(`${fin ? 'Contrato firmado' : 'Saldo cobrado'}, pero falta el plano (obligatorio en ${porQuePlano(o)}): no puede pasar a Entregas.`, h('button.btn.primary.small', { type: 'button', onclick: () => editObra(o) }, 'Adjuntar plano'));
    else if (enAdmin && condicionOk(o)) paso = pasoBox(fin ? 'Contrato firmado. Ya se puede pasar a Entregas.' : 'Saldo cobrado. Ya se puede pasar a Entregas.', null);
    else if (enAdmin && !fin && e.paraMarcar) paso = pasoBox('El saldo está en cero: falta marcar «Saldo cobrado».', null);
    else if (enAdmin) {
      paso = pasoBox(h('span', fin ? 'Falta el contrato firmado en nuestro poder.' : `Falta cobrar el saldo antes de la entrega de materiales: ${c.M(c.pendiente)}.`,
        d != null && d <= AVISO_DIAS ? h('b', { style: { color: 'var(--red)' } }, ` Entrega ${UI.relDays(fechaEnt(o))}: si no está, se retrasa.`) : null),
      h('button.btn.primary.small', { type: 'button', onclick: () => (fin ? registrarContrato(o) : registrarPago(o)) }, fin ? 'Contrato recibido' : 'Registrar pago'));
    } else paso = pasoBox(`Ya pasó a ${AREAS[areaDe(o)].nombre}. ${c.pendiente > 0 ? `Saldo pendiente: ${c.M(c.pendiente)}.` : 'Saldo 0.'}`, null);

    // Botones de cierre, separados: «Saldo cobrado» (sólo con saldo 0) y «Pasar a Entregas».
    const puedeMarcar = !fin && e.paraMarcar;
    const puedePasar = enAdmin && condicionOk(o) && !faltaPlano(o);
    const cierre = h('div.cierre',
      fin ? null : e.valida
        ? h('div.cierre-ok', icon('check'), h('div.grow', h('b', 'Saldo cobrado'), h('div.small.muted', `Marcado el ${UI.fmtDay(e.marca.fecha)} por ${e.marca.porNombre || ''}`)),
          h('button.btn.small.ghost', { type: 'button', onclick: () => quitarMarcaCobrado(o) }, 'Quitar'))
        : h('button.btn', { type: 'button', disabled: !puedeMarcar, title: puedeMarcar ? '' : 'Se habilita cuando el saldo es 0', onclick: () => marcarSaldoCobrado(o) }, icon('check'), 'Saldo cobrado'),
      enAdmin ? h('button.btn.primary', { type: 'button', disabled: !puedePasar, title: puedePasar ? '' : faltaTexto(o), onclick: () => habilitar(o) }, 'Pasar a Entregas') : null);
    const ayuda = !puedePasar && enAdmin ? h('p.small.muted', { style: { margin: '6px 0 0' } },
      fin ? (v.contratoFirmado ? (faltaPlano(o) ? 'Falta el plano para pasar a Entregas.' : '') : '«Pasar a Entregas» se habilita con el contrato firmado.')
        : e.valida ? (faltaPlano(o) ? 'Falta el plano para pasar a Entregas.' : '') : '«Saldo cobrado» se habilita con saldo 0; «Pasar a Entregas», con el saldo marcado como cobrado.') : null;

    return [
      paso,
      h('div.row', { style: { marginTop: '16px' } }, h('h2.grow', { style: { margin: 0 } }, fin ? 'Financiado' : 'Contado'),
        h('button.btn.small', { type: 'button', onclick: () => editObra(o) }, icon('edit'), 'Editar venta')),
      h('div', { style: { marginTop: '10px' } }, cierre, ayuda),
      fin ? h('div.card.info', { style: { marginTop: '12px' } },
        infoRow('Contrato', v.contratoFirmado ? h('span', h('span.badge.ok', 'Firmado'), ' ', UI.fmtDay(v.contratoFecha), v.contratoPorNombre ? h('span.muted', ' · ' + v.contratoPorNombre) : null)
          : h('span.row.wrap', { style: { gap: '8px' } }, h('span.badge.red', 'Falta firmado'), h('button.btn.small', { type: 'button', onclick: () => registrarContrato(o) }, 'Contrato recibido')))) : null,
      estadoSaldoBlock(o),
      facturacionBlock(o),
      detalleSaldoBlock(o),
      comprobantesBlock(o),
      checklistAdminBlock(o),
      h('div', { style: { marginTop: '16px' } }, tcBox()),
    ];
  }

  function marcarSaldoCobrado(o) {
    const e = estadoCobro(o);
    if (!e.paraMarcar) return UI.toast('«Saldo cobrado» se habilita sólo con saldo 0.');
    cloud.patch('ventas', o._id, { saldoCobrado: { fecha: UI.today(), por: me.email, porNombre: me.nombre }, ...stamp() });
    UI.toast('Marcado «Saldo cobrado». Ya se puede pasar a Entregas.');
  }
  async function quitarMarcaCobrado(o) {
    if (!(await UI.confirm('¿Quitar «Saldo cobrado»?', 'La obra no va a poder pasar a Entregas hasta volver a marcarla.', 'Quitar', 'danger'))) return;
    cloud.patch('ventas', o._id, { saldoCobrado: null, ...stamp() });
    UI.toast('Se quitó la marca');
  }

  // Lo pagado separado por moneda en que se pagó (sin cheques rechazados).
  function pagadoPorMoneda(c) {
    const t = { USD: 0, ARS: 0 };
    for (const p of c.pagos) {
      if (p.forma === 'cheque' && Array.isArray(p.cheques) && p.cheques.length) {
        for (const ch of p.cheques) if (ch.estado !== 'rechazado') t[p.moneda === 'ARS' ? 'ARS' : 'USD'] += num(ch.monto);
      } else t[p.moneda === 'ARS' ? 'ARS' : 'USD'] += num(p.monto);
    }
    return { USD: CALC.round2(t.USD), ARS: CALC.round2(t.ARS) };
  }

  // Estado de saldo: presupuesto, IVA, pagado (en US$ y en $), saldo, saldo pendiente de facturar y cuotas.
  function estadoSaldoBlock(o) {
    const c = cobro(o);
    const v = c.v;
    const f = facturacionDe(o);
    const pm = pagadoPorMoneda(c);
    const enOtra = (n) => (c.moneda === 'USD' && tcHoy() && n ? h('span.muted', ' = ' + ars(n * tcHoy()) + ' hoy') : c.moneda === 'ARS' && tcHoy() && n ? h('span.muted', ' = ' + usd(n / tcHoy()) + ' hoy') : null);
    const prox = c.fin ? proximaCuota(c) : null;
    return [
      h('h3', { style: { margin: '18px 0 8px' } }, 'Estado de saldo'),
      h('div.card.info',
        infoRow('Presupuesto', c.precio ? [h('b', c.M(c.precio)), enOtra(c.precio)] : '—'),
        c.fin ? infoRow('Total a cobrar', [c.M(c.total), h('div.small.muted', `${c.fin ? 'Anticipo' : 'Seña'} ${c.M(c.sena)} + ${c.plan.cantidad} cuotas de ${c.M(c.plan.cuota)}`)]) : null,
        c.sena ? infoRow(c.fin ? 'Anticipo pactado' : 'Seña pactada', [c.M(c.sena), v.senaFecha ? h('span.muted', ' · ' + UI.fmtDay(v.senaFecha)) : null]) : null,
        c.sena ? infoRow(`Cobrado de ${c.fin ? 'anticipo' : 'seña'}`, c.senaCobrada ? c.M(c.senaCobrada) : 'Nada todavía') : null,
        c.sena ? infoRow(`Falta de ${c.fin ? 'anticipo' : 'seña'}`, c.senaFalta > 0.005 ? h('b', { style: { color: 'var(--red)' } }, c.M(c.senaFalta)) : h('span.badge.ok', c.fin ? 'Anticipo completo' : 'Seña completa')) : null,
        infoRow('IVA', f.sinFactura ? 'Sin factura' : [h('div', `${v.iva.tipo === 'total' ? 'IVA total' : 'IVA mínimo'}: ${c.M(num(v.iva.monto))}`), h('div.small.muted', 'Incluido en el precio total')]),
        (v.tributos || []).length ? infoRow('Tributos', v.tributos.map((t) => h('div', `${t.nombre}: ${c.M(num(t.monto))}`))) : null,
        infoRow('Total pagado', [
          h('div', h('b', `${c.M(c.cobrado)} (${c.pct} %)`)),
          pm.USD ? h('div.small', `En dólares: ${CALC.money(pm.USD, 'USD')}`) : null,
          pm.ARS ? h('div.small', `En pesos: ${CALC.money(pm.ARS, 'ARS')}`) : null,
          c.aCobrar ? h('div.small.muted', `de eso, ${c.M(c.aCobrar)} en cheques a cobrar`) : null,
          h('div', { style: { marginTop: '6px' } }, progressBar(c.pct))]),
        infoRow('Saldo pendiente', c.pendiente > 0 ? [h('b', { style: { color: 'var(--red)' } }, c.M(c.pendiente)), enOtra(c.pendiente)] : h('span.badge.ok', 'Saldo 0')),
        infoRow('Pendiente de facturar', f.sinFactura ? 'No se factura' : !f.cargado ? h('span.badge.warn', 'Falta el monto a facturar') : f.pendiente > 0 ? h('b', c.M(f.pendiente)) : h('span.badge.ok', 'Todo facturado')),
        prox ? infoRow('Próxima cuota', `N° ${prox.n} · ${prox.fecha ? UI.fmtDay(prox.fecha) + ' · ' : ''}${c.M(prox.pendiente)}${prox.pagado ? ' (resto)' : ''}`) : null),
      c.fin && c.cuotas.length ? cuotasBlock(c, true) : null,
    ];
  }

  // Facturación: monto a facturar (a mano), facturas cargadas y lo que falta facturar.
  function facturacionBlock(o) {
    const c = cobro(o);
    const f = facturacionDe(o);
    if (f.sinFactura) return null;
    return [
      h('div.cabecera', h('h3', 'Facturación'),
        h('button.btn.small', { type: 'button', onclick: () => facturaForm(o, null) }, icon('plus'), 'Agregar factura')),
      h('div.card.info',
        infoRow('Monto a facturar', [f.cargado ? h('b', c.M(f.aFacturar)) : h('span.badge.warn', 'Sin cargar'), ' ', h('button.btn.small.ghost', { type: 'button', onclick: () => editAFacturar(o) }, icon('edit'))]),
        infoRow('Facturado', c.M(f.facturado) || c.M(0)),
        infoRow('Pendiente de facturar', f.cargado ? (f.pendiente > 0 ? h('b', c.M(f.pendiente)) : h('span.badge.ok', 'Todo facturado')) : '—')),
      f.facturas.length ? h('div.list', { style: { marginTop: '10px' } }, f.facturas.map((x) => h('div.item', { onclick: () => facturaForm(o, x) },
        h('span.dot.done', icon('file')),
        h('div.grow', { style: { minWidth: 0 } }, h('div', { style: { fontWeight: 600 } }, `${c.M(num(x.monto))} · ${(EMISORES.find(([k]) => k === x.emisor) || [, x.emisorOtro || 'Otro'])[1]}${x.emisor === 'otro' && x.emisorOtro ? ' (' + x.emisorOtro + ')' : ''}`),
          h('div.small.muted', [UI.fmtDay(x.fecha), x.numero ? 'N° ' + x.numero : '', x.pagoId ? 'del pago ' + reciboTexto(((pagosPorObra[o._id] || []).find((p) => p._id === x.pagoId) || {}).recibo) : ''].filter(Boolean).join(' · '))),
        icon('chev')))) : null,
    ];
  }

  function editAFacturar(o) {
    const c = cobro(o);
    const f = facturacionDe(o);
    const fld = UI.field({ label: `Monto a facturar (${c.moneda === 'ARS' ? '$' : 'US$'})`, name: 'aFacturar', value: f.cargado ? fmtNum(f.aFacturar) : '' });
    numeroInput(fld.querySelector('input'));
    UI.sheet({
      title: 'Monto a facturar',
      body: [h('p.muted', { style: { marginTop: '-8px' } }, o.nombre), fld, h('p.small.muted', 'Se carga a mano. El saldo pendiente de facturar es este monto menos las facturas cargadas.')],
      actions: [{ label: 'Cancelar' }, {
        label: 'Guardar', kind: 'primary', onClick: () => {
          const val = UI.values(fld);
          cloud.patch('ventas', o._id, { facturacion: { ...(c.v.facturacion || {}), aFacturar: val.aFacturar === '' ? '' : num(val.aFacturar) }, ...stamp() });
          UI.toast('Guardado');
        },
      }],
    });
  }

  function facturaForm(o, x) {
    const c = cobro(o);
    const nueva = !x;
    const x0 = x || { fecha: UI.today(), emisor: transfirioSegunPagos(o) === 'atlantis' ? 'atlantis' : 'wmax' };
    const pagos = (pagosPorObra[o._id] || []);
    const montoF = UI.field({ label: `Monto (${c.moneda === 'ARS' ? '$' : 'US$'})`, name: 'monto', value: x ? fmtNum(num(x.monto)) : '' });
    numeroInput(montoF.querySelector('input'));
    const emisorF = UI.field({ label: 'La emite', name: 'emisor', type: 'select', value: x0.emisor || 'wmax', options: EMISORES });
    const otroF = UI.field({ label: 'Cuál', name: 'emisorOtro', value: x0.emisorOtro || '' });
    const otroBox = h('div', otroF);
    const body = h('div', h('p.muted', { style: { marginTop: '-8px' } }, o.nombre),
      fila2(UI.field({ label: 'Fecha', name: 'fecha', type: 'date', value: x0.fecha || UI.today() }), UI.field({ label: 'N° de factura', name: 'numero', value: x0.numero || '', placeholder: 'Ej: 0003-00001234' })),
      fila2(emisorF, montoF), otroBox,
      UI.field({ label: 'Pago (opcional)', name: 'pagoId', type: 'select', value: x0.pagoId || '', options: [['', 'Sin asociar'], ...pagos.map((p) => [p._id, `${reciboTexto(p.recibo)} · ${UI.fmtDay(p.fecha)} · ${CALC.money(num(p.monto), p.moneda)}`])] }));
    const pintar = () => { otroBox.hidden = emisorF.querySelector('select').value !== 'otro'; };
    emisorF.querySelector('select').addEventListener('change', pintar);
    pintar();
    const guardar = (lista) => cloud.patch('ventas', o._id, { facturacion: { ...(c.v.facturacion || {}), facturas: lista }, ...stamp() });
    const actions = [{ label: 'Cancelar' }, {
      label: 'Guardar', kind: 'primary', onClick: () => {
        const val = UI.values(body);
        if (!(num(val.monto) > 0)) throw new Error('Poné el monto de la factura.');
        const dato = { id: x ? x.id : uid(), fecha: val.fecha, numero: val.numero, emisor: val.emisor, emisorOtro: val.emisor === 'otro' ? val.emisorOtro : '', monto: num(val.monto), pagoId: val.pagoId, porNombre: me.nombre };
        const lista = facturacionDe(o).facturas.filter((y) => y.id !== dato.id);
        guardar([...lista, dato].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')));
        UI.toast(nueva ? 'Factura cargada' : 'Guardado');
      },
    }];
    if (x) actions.unshift({ label: 'Borrar', kind: 'danger', onClick: async () => {
      if (!(await UI.confirm('¿Borrar la factura?', `${c.M(num(x.monto))} del ${UI.fmtDay(x.fecha)}.`, 'Borrar', 'danger'))) return false;
      guardar(facturacionDe(o).facturas.filter((y) => y.id !== x.id));
      UI.toast('Factura borrada');
    } });
    UI.sheet({ title: nueva ? 'Agregar factura' : 'Factura', body: [body], actions });
  }

  // Detalle de saldo: cada pago con fecha, qué pagó, TC, equivalente en US$, dónde y cómo, y saldo después.
  function detalleSaldoBlock(o) {
    const c = cobro(o);
    const fila = (f) => {
      const p = f.p;
      const eqUSD = p.moneda === 'USD' ? CALC.valorPago(p, 'USD') : CALC.round2(CALC.valorPago({ ...p }, 'USD'));
      return h('tr', { onclick: () => pagoForm(o, p) },
        h('td', UI.fmtDay(p.fecha)),
        h('td', h('b', CALC.money(num(p.monto), p.moneda)), p.tipo === 'sena' ? h('div.small.muted', c.fin ? 'Anticipo' : 'Seña') : null),
        h('td', num(p.tc) ? tcFmt(num(p.tc)) : '—'),
        h('td', eqUSD ? CALC.money(eqUSD, 'USD') : '—', p.forma === 'cheque' && f.aCobrar ? h('div.small.muted', 'con cheques a cobrar') : null),
        h('td', dondeTexto(p), (p.cheques || []).map((ch) => h('div.small', chequeTexto(p, ch), ' ', chequeBadge(ch)))),
        h('td', h('b', f.saldoDespues > 0 ? c.M(f.saldoDespues) : 'Cero')));
    };
    return [
      h('div.cabecera', h('h3', 'Detalle de saldo'),
        h('button.btn.small', { type: 'button', onclick: () => detalleSaldoPDF(o) }, icon('file'), 'Detalle de saldo PDF'),
        c.total && c.pendiente > 0 ? h('button.btn.small.primary', { type: 'button', onclick: () => registrarPago(o) }, icon('money'), 'Registrar pago') : null),
      c.filas.length ? h('div.table-wrap', h('table.tabla.tabla-saldo',
        h('thead', h('tr', ['Fecha', 'Qué pagó', 'TC del día', 'Equivalente US$', 'Dónde y cómo', 'Saldo después'].map((t) => h('th', t)))),
        h('tbody', c.filas.map(fila))))
        : h('div.card.empty.small', 'Todavía no hay pagos registrados.'),
      c.senaSinRegistrar && c.pendiente > 0 ? h('div', { style: { marginTop: '10px' } }, pasoBox(`${c.fin ? 'Anticipo' : 'Seña'} pactad${c.fin ? 'o' : 'a'} ${c.M(c.sena)}: ${c.senaCobrada ? `cobrado ${c.M(c.senaCobrada)}, falta ${c.M(c.senaFalta)}` : 'falta registrarlo como pago'}.`,
        h('button.btn.small.primary', { type: 'button', onclick: () => pagoForm(o, null, { tipo: 'sena', monto: Math.min(c.senaFalta, c.pendiente) }) }, `Registrar ${c.fin ? 'anticipo' : 'seña'}`))) : null,
    ];
  }

  // Carpeta de comprobantes: todos los de la obra, para ver y descargar (uno o todos juntos en .zip).
  function comprobantesDeObra(o) {
    const out = [];
    for (const p of pagosPorObra[o._id] || []) for (const m of p.comprobantes || []) out.push({ ...m, pago: p });
    return out;
  }
  function comprobantesBlock(o) {
    const lista = comprobantesDeObra(o);
    return [
      h('div.cabecera', h('h3', 'Comprobantes'),
        lista.length > 1 ? h('button.btn.small', { type: 'button', onclick: () => descargarComprobantes(o) }, icon('down'), 'Descargar todos (.zip)') : null),
      lista.length ? h('div.list', lista.map((m) => h('div.item', { style: { cursor: 'default' } },
        icon(m.mime === 'application/pdf' ? 'file' : 'eye'),
        h('div.grow', { style: { minWidth: 0 } }, h('div.ellipsis', m.nombre || 'Comprobante'), h('div.small.muted', [UI.fmtDay(m.pago.fecha), CALC.money(num(m.pago.monto), m.pago.moneda), reciboTexto(m.pago.recibo)].filter(Boolean).join(' · '))),
        h('button.btn.small.ghost', { type: 'button', onclick: () => verComprobante(o._id, m) }, 'Ver'),
        h('button.btn.small.ghost', { type: 'button', onclick: () => descargarComprobante(o._id, m) }, 'Descargar'))))
        : h('div.card.empty.small', 'Todavía no hay comprobantes. Se adjuntan al registrar cada pago.'),
    ];
  }
  const nombreArchivo = (t) => String(t || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w .()-]/g, '').trim().slice(0, 80) || 'archivo';
  function bajarBlob(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: nombre, style: { display: 'none' } });
    document.body.append(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
  }
  const b64Blob = (b64, mime) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  };
  function descargarComprobante(obraId, m) {
    const f = (comprobantesPorObra[obraId] || []).find((x) => x._id === m.id);
    if (!f) return UI.toast('Bajando el comprobante, probá de nuevo en un momento…');
    bajarBlob(b64Blob(f.data, f.mime), nombreArchivo(f.nombre));
  }
  let jszipCarga = null;
  function cargarJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (!jszipCarga) {
      jszipCarga = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = '../shared/vendor/jszip.min.js';
        sc.onload = () => (window.JSZip ? resolve(window.JSZip) : reject(new Error('No se pudo cargar el compresor.')));
        sc.onerror = () => { jszipCarga = null; reject(new Error('No se pudo cargar el compresor.')); };
        document.head.append(sc);
      });
    }
    return jszipCarga;
  }
  async function descargarComprobantes(o) {
    const lista = comprobantesDeObra(o);
    const datos = comprobantesPorObra[o._id] || [];
    if (lista.some((m) => !datos.some((x) => x._id === m.id))) return UI.toast('Bajando los comprobantes, probá de nuevo en un momento…');
    let Zip;
    try { Zip = await cargarJSZip(); } catch (e) { return UI.toast(e.message, 5000); }
    const zip = new Zip();
    const usados = new Set();
    for (const m of lista) {
      const f = datos.find((x) => x._id === m.id);
      const ext = f.mime === 'application/pdf' ? '.pdf' : '.jpg';
      let nombre = nombreArchivo(`${m.pago.fecha} ${reciboTexto(m.pago.recibo).replace('N° ', 'Recibo ')} ${(f.nombre || '').replace(/\.[^.]+$/, '')}`) + ext;
      for (let i = 2; usados.has(nombre); i++) nombre = nombre.replace(/( \(\d+\))?(\.\w+)$/, ` (${i})$2`);
      usados.add(nombre);
      zip.file(nombre, f.data, { base64: true });
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    bajarBlob(blob, nombreArchivo(`Comprobantes - ${o.cliente || o.nombre}${o.pedido ? ' - Pedido ' + o.pedido : ''}`) + '.zip');
  }

  // Detalle de saldo en PDF, para mandar al cliente.
  async function detalleSaldoPDF(o) {
    let lib;
    try { lib = await cargarJsPDF(); } catch (e) { return UI.toast(e.message, 5000); }
    const c = cobro(o);
    const v = c.v;
    const pm = pagadoPorMoneda(c);
    const doc = new lib.jsPDF({ unit: 'mm', format: 'a4' });
    const M = 16;
    const W = 210 - 2 * M;
    let y = M;
    const nueva = () => { doc.addPage(); y = M; };
    const espacio = (n) => { if (y + n > 297 - M) nueva(); };
    try {
      const logo = await imagenDataURL('../shared/icons/logo.png');
      doc.addImage(logo.url, 'PNG', M, y, 48, (48 * logo.h) / logo.w);
    } catch (e) { doc.setFont('helvetica', 'bold').setFontSize(18).text('SLAVON', M, y + 7); }
    doc.setFont('helvetica', 'bold').setFontSize(17).text('DETALLE DE SALDO', 210 - M, y + 6, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(10).text(pdfTxt(UI.fmtDay(UI.today())), 210 - M, y + 12, { align: 'right' });
    y += 22;
    doc.setDrawColor(200).line(M, y, 210 - M, y);
    y += 8;
    const fila = (k, val, bold) => {
      if (!val) return;
      espacio(7);
      doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(90).text(pdfTxt(k), M, y);
      doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(11).setTextColor(0).text(pdfTxt(val), M + 55, y);
      y += 6.5;
    };
    fila('Cliente', clientePed(o) || o.nombre);
    fila('Obra', o.nombre);
    fila('Forma de pago', c.fin ? `Financiado · ${c.plan.cantidad} cuotas de ${c.M(c.plan.cuota)}` : 'Contado');
    fila('Presupuesto', c.M(c.precio), true);
    if (c.fin) fila('Total a cobrar', c.M(c.total), true);
    fila('IVA', !v.iva || v.iva.tipo === 'sin' ? 'Sin factura' : `${v.iva.tipo === 'total' ? 'IVA total' : 'IVA mínimo'} ${c.M(num(v.iva.monto))} (incluido)`);
    for (const t of v.tributos || []) fila(t.nombre, `${c.M(num(t.monto))} (incluido)`);
    fila('Total pagado', `${c.M(c.cobrado)}${pm.USD && pm.ARS ? ` (US$ ${fmtNum(pm.USD)} + $ ${fmtNum(pm.ARS)})` : ''}`, true);
    fila('Saldo pendiente', c.pendiente > 0 ? c.M(c.pendiente) : 'Cero', true);
    y += 4;
    // Tabla de pagos
    const cols = [['Fecha', 20], ['Qué pagó', 34], ['TC', 22], ['Equiv. US$', 26], ['Dónde y cómo', 46], ['Saldo después', 30]];
    const encabezado = () => {
      espacio(10);
      doc.setFillColor(244, 245, 246).rect(M, y - 4.5, W, 7, 'F');
      let x = M + 1;
      doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(60);
      for (const [t, w] of cols) { doc.text(pdfTxt(t), x, y); x += w; }
      y += 6;
    };
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(0).text('Pagos', M, y);
    y += 7;
    if (!c.filas.length) { doc.setFont('helvetica', 'normal').setFontSize(10).text('Todavía no hay pagos registrados.', M, y); y += 7; } else {
      encabezado();
      for (const f of c.filas) {
        const p = f.p;
        const eq = CALC.valorPago(p, 'USD');
        const celdas = [UI.fmtDay(p.fecha), CALC.money(num(p.monto), p.moneda) + (p.tipo === 'sena' ? (c.fin ? ' (anticipo)' : ' (seña)') : ''), num(p.tc) ? tcFmt(num(p.tc)) : '-',
          eq ? CALC.money(eq, 'USD') : '-', dondeTexto(p) + (p.cheques || []).map((ch) => `\n${chequeTexto(p, ch)} (${ch.estado || 'pendiente'})`).join(''), f.saldoDespues > 0 ? c.M(f.saldoDespues) : 'Cero'];
        const partes = celdas.map((t, i) => doc.splitTextToSize(pdfTxt(t), cols[i][1] - 2));
        const alto = Math.max(...partes.map((x) => x.length)) * 4.2 + 2;
        if (y + alto > 297 - M) { nueva(); encabezado(); }
        let x = M + 1;
        doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(0);
        partes.forEach((t, i) => { doc.text(t, x, y); x += cols[i][1]; });
        y += alto;
        doc.setDrawColor(230).line(M, y - 3, 210 - M, y - 3);
      }
    }
    // Cuotas
    if (c.fin && c.cuotas.length) {
      y += 4;
      espacio(14);
      doc.setFont('helvetica', 'bold').setFontSize(12).text('Cuotas', M, y);
      y += 7;
      doc.setFont('helvetica', 'normal').setFontSize(9.5);
      for (const q of c.cuotas) {
        espacio(6);
        const est = q.pendiente <= 0 ? 'Pagada' : q.pagado ? `Falta ${c.M(q.pendiente)}` : q.fecha && UI.daysUntil(q.fecha) < 0 ? 'Vencida' : 'Pendiente';
        doc.text(pdfTxt(`${q.n}.  ${q.fecha ? UI.fmtDay(q.fecha) : '-'}`), M, y);
        doc.text(pdfTxt(c.M(q.monto)), M + 40, y);
        doc.text(pdfTxt(est), M + 80, y);
        y += 5.5;
      }
    }
    doc.setFontSize(8.5).setTextColor(120).text(pdfTxt('SLAVON · Detalle de saldo generado por el sistema de gestión.'), M, 297 - 10);
    doc.save(`${nombreArchivo(`Detalle de saldo - ${o.cliente || o.nombre}${o.pedido ? ' - Pedido ' + o.pedido : ''}`)}.pdf`);
  }

  // Checklist administrativo de la obra, con la lógica de la factura.
  function checklistAdminBlock(o) {
    const k = checklistAdmin(o);
    const v = ventas[o._id] || {};
    const guardar = (cambios) => cloud.patch('ventas', o._id, { checklistAdmin: { ...(v.checklistAdmin || {}), ...cambios }, ...stamp() });
    const marca = (ok) => (ok ? { ok: true, fecha: UI.today(), por: me.email, porNombre: me.nombre } : { ok: false, fecha: '', por: '', porNombre: '' });
    const quien = (t) => (t && t.ok ? h('div.small.muted', `${t.porNombre || ''} · ${UI.fmtDay(t.fecha)}`) : null);
    const siNo = (valor, onchange, sugerido) => h('select.sino', { onchange: (e) => onchange(e.target.value) },
      [['', '—'], ['si', 'Sí'], ['no', 'No']].map(([val, txt]) => h('option', { value: val, selected: val === (valor || '') }, txt)), sugerido ? null : null);
    const filas = k.pasos.map((it) => {
      if (it.tipo === 'tilde') {
        const t = k.tildes[it.id] || {};
        return h('label.item.check-item',
          h('input', { type: 'checkbox', checked: !!t.ok, onchange: (e) => guardar({ tildes: { ...k.tildes, [it.id]: marca(e.target.checked) } }) }),
          h('div.grow', h('div', it.texto), quien(t)));
      }
      if (it.tipo === 'mail') {
        return h('div.item.check-item', { style: { cursor: 'default' } }, h('span.dot', { class: it.hecho ? 'done' : '' }, it.hecho ? icon('check') : '?'),
          h('div.grow', it.texto), siNo(k.ch.confirmoMail, (x) => guardar({ confirmoMail: x })));
      }
      if (it.tipo === 'percepciones') {
        return h('div.item.check-item', { style: { cursor: 'default' } }, h('span.dot', { class: it.hecho ? 'done' : '' }, it.hecho ? icon('check') : '?'),
          h('div.grow', h('div', it.texto), !k.ch.percepciones && k.percepciones ? h('div.small.muted', 'Según los tributos de la venta') : null),
          siNo(k.percepciones, (x) => guardar({ percepciones: x })));
      }
      // Factura: ¿tiene? Sí → razón social y CUIT · No → ¿a dónde transfirió? → W. MAX o Atlantis: pedir la factura · otro: pedir la razón social
      const fac = k.fac;
      const gFac = (cambios) => guardar({ factura: { ...fac, ...cambios } });
      const sub = [];
      if (fac.tiene === 'si') {
        const rs = h('input', { type: 'text', placeholder: 'Razón social', value: fac.razonSocial || '', 'aria-label': 'Razón social' });
        const cuit = h('input', { type: 'text', placeholder: 'CUIT', inputMode: 'numeric', value: fac.cuit || '', 'aria-label': 'CUIT' });
        const guardarDatos = () => {
          if (!rs.value.trim() || !cuit.value.trim()) return UI.toast('Poné la razón social y el CUIT.');
          gFac({ razonSocial: rs.value.trim(), cuit: cuit.value.trim() });
          UI.toast('Razón social y CUIT guardados');
          // Al cliente del catálogo, si no los tenía.
          const cl = cat.clientes.find((x) => x._id === o.clienteId);
          if (cl && ((!cl.cuit && cuit.value.trim()) || (!cl.razonSocial && rs.value.trim()))) {
            cloud.patch('clientes', cl._id, { cuit: cl.cuit || cuit.value.trim(), razonSocial: cl.razonSocial || rs.value.trim(), ...stamp() });
          }
        };
        // Se guardan con el botón (si se guardara al salir de cada campo, la pantalla se refresca mientras se escribe).
        const listo = fac.razonSocial && fac.cuit && rs.value.trim() === fac.razonSocial && cuit.value.trim() === fac.cuit;
        sub.push(h('div.factura-datos', rs, cuit, h('button.btn.small', { type: 'button', class: listo ? '' : 'primary', onclick: guardarDatos }, listo ? 'Guardado' : 'Guardar')));
      }
      if (fac.tiene === 'no') {
        sub.push(h('div.factura-datos', h('span.small', '¿Transfirió a…?'),
          h('select', { onchange: (e) => gFac({ transfirioA: e.target.value }) }, [['', '—'], ...EMISORES].map(([val, txt]) => h('option', { value: val, selected: val === (k.transfirio || '') }, txt))),
          !fac.transfirioA && k.sugTransfirio ? h('span.small.muted', 'según los pagos') : null));
        if (k.transfirio === 'wmax' || k.transfirio === 'atlantis') {
          sub.push(h('label.check.sub', h('input', { type: 'checkbox', checked: !!(fac.pedirFactura && fac.pedirFactura.ok), onchange: (e) => gFac({ pedirFactura: marca(e.target.checked) }) }), `Pedir la factura a ${k.transfirio === 'wmax' ? 'W. MAX' : 'Atlantis'}`, quien(fac.pedirFactura)));
        }
        if (k.transfirio === 'otro') {
          sub.push(h('label.check.sub', h('input', { type: 'checkbox', checked: !!(fac.pedirRazonSocial && fac.pedirRazonSocial.ok), onchange: (e) => gFac({ pedirRazonSocial: marca(e.target.checked) }) }), 'Pedir la razón social igual', quien(fac.pedirRazonSocial)));
        }
      }
      return h('div.item.check-item.factura', { style: { cursor: 'default', display: 'block' } },
        h('div.row', h('span.dot', { class: it.hecho ? 'done' : '' }, it.hecho ? icon('check') : '?'), h('div.grow', it.texto), siNo(fac.tiene, (x) => gFac({ tiene: x }))),
        sub.length ? h('div', { style: { marginTop: '8px' } }, sub) : null);
    });
    return [
      h('div.row', { style: { margin: '18px 0 8px' } }, h('h3.grow', { style: { margin: 0 } }, 'Checklist administrativo'),
        h('span.badge', { class: k.hechos === k.total ? 'ok' : '' }, `${k.hechos} de ${k.total}`), k.aviso ? h('span.badge.red', { style: { marginLeft: '6px' } }, k.aviso) : null),
      h('div.list.checklist-admin', filas),
      h('p.small.muted', 'Las planillas por ahora se tildan a mano (la conexión con Drive es la Fase 5).'),
    ];
  }

  /* ----- Solapa Entrega ----- */

  function entregaTab(o) {
    const term = esTerminada(o);
    const pct = progreso(o);
    const hechas = (o.etapas || []).filter((e) => e.estado === 'hecha').length;
    let paso = null;
    if (o.estado === 'venta' || o.estado === 'vendida') paso = pasoBox(`Todavía está en ${AREAS[areaDe(o)].nombre}. Se puede ir programando, pero no se entrega hasta que administración la pase a Entregas.`, null);
    else if (term) paso = pasoBox(`Entregada el ${UI.fmtDay(o.fin)}.`, h('button.btn.small', { type: 'button', onclick: () => go('acta/' + o._id) }, icon('clip'), 'Acta de entrega'));
    else if (requiereBase(o) && !baseApta(o)) {
      const no = baseNoApta(o);
      const k = (o.etapas || []).findIndex(esEtapaBase);
      paso = pasoBox(no.length
        ? h('span', { style: { color: 'var(--red)' } }, h('b', 'Base no apta: no se instala. '), avisoTexto(no[0]) + '.')
        : 'Falta la Etapa 1 «Base apta» (con fotos o constancia en WhatsApp). Hasta que no esté, no se instala ni se puede marcar entregada.',
      h('button.btn.primary.small', { type: 'button', onclick: () => editEtapa(o, k) }, 'Base apta'));
    } else paso = pasoBox(`${hechas} de ${(o.etapas || []).length} etapas hechas.`, h('button.btn.dark.small', { type: 'button', onclick: () => terminar(o) }, icon('check'), 'Marcar entregada'));
    return [
      paso,
      !term && esCurso(o) ? h('div', { style: { margin: '12px 0 0' } }, progressBar(pct)) : null,
      h('h2', 'Agenda y equipo'),
      entregaCard(o),
      h('div.row', h('h2.grow', 'Materiales'), !term ? h('button.btn.small', { type: 'button', onclick: () => editMateriales(o) }, icon('edit'), 'Cantidades y envío') : null),
      materialesCard(o),
      h('div.row', h('h2.grow', 'Remitos firmados'), h('button.btn.small', { type: 'button', onclick: () => subirRemitos(o) }, icon('camera'), 'Subir remito')),
      remitosCard(o),
      o.interior ? [h('h2', 'Logística del interior'), logisticaCard(o)] : null,
      h('div.row', h('h2.grow', 'Etapas'), h('button.btn.small.ghost', { type: 'button', onclick: () => editEtapas(o) }, icon('edit'), 'Editar')),
      (o.etapas || []).length ? h('div.list', (o.etapas || []).map((e, i) => etapaItem(o, e, i))) : h('div.card.empty.small', 'Sin etapas.'),
      h('div.row', h('h2.grow', 'Incidencias'), !term ? h('button.btn.small', { type: 'button', onclick: () => nuevaIncidencia(o) }, icon('plus'), 'Agregar') : null),
      incidenciasCard(o),
      h('div.row', h('h2.grow', 'Fotos'), h('button.btn.small', { type: 'button', onclick: () => addFotos(o, '') }, icon('camera'), 'Agregar')),
      fotosGrid(fotos, o, true),
      h('div.row', h('h2.grow', 'Checklist de entrega'), h('button.btn.small.ghost', { type: 'button', onclick: () => editChecklist(o) }, icon('edit'), 'Editar')),
      checklistCard(o),
      h('div.row', { style: { marginTop: '14px' } }, h('span.grow'), h('button.btn.small', { type: 'button', onclick: () => go('acta/' + o._id) }, icon('clip'), 'Ver acta de entrega')),
      h('h2', 'La cancha y el cliente'),
      datosCancha(o),
    ];
  }

  /* ----- Solapa Post-venta ----- */
  function postventaTab(o) {
    if (!esTerminada(o)) return [pasoBox(`Todavía está en ${AREAS[areaDe(o)].nombre}. Al marcarla entregada se agendan los llamados y empieza la garantía.`, null)];
    const pend = (o.postventa || []).filter((p) => !p.hecho).length;
    return [
      pasoBox(pend ? `${pend} llamado${pend > 1 ? 's' : ''} pendiente${pend > 1 ? 's' : ''}.` : 'Post-venta completo.', h('button.btn.small', { type: 'button', onclick: () => go('acta/' + o._id) }, icon('clip'), 'Acta de entrega')),
      h('h2', 'Llamados'),
      h('div.list', (o.postventa || []).map((p) => llamadoItem({ obra: o, p }, true))),
      h('h2', 'Garantía'),
      h('div.card.info', infoRow('Garantía', garantiaMesesDe(o) ? `${garantiaTexto(o)} · vence ${UI.fmtDay(garantiaVence(o))} (${UI.relDays(garantiaVence(o))})` : 'Sin cargar'), infoRow('Entregada', UI.fmtDay(o.fin))),
      canVenta ? h('div', { style: { marginTop: '20px' } }, h('button.btn.small.ghost', { type: 'button', onclick: () => reabrir(o) }, 'Reabrir la obra (vuelve a Entregas)')) : null,
    ];
  }

  // Datos mínimos para que una venta pase a Administración.
  function faltanDatosVenta(o, v) {
    const f = [];
    if (!o.cliente) f.push('cliente o club');
    if (!o.fechaEntrega) f.push('fecha de entrega');
    if (!precioDe(v)) f.push('precio');
    return f;
  }

  // Espera a que llegue una obra recién guardada (y su venta) para seguir con ella.
  function esperarObra(id, fn, intentos = 50) {
    const o = obras.find((x) => x._id === id);
    if (o && ventas[id]) return fn(o);
    if (intentos > 0) setTimeout(() => esperarObra(id, fn, intentos - 1), 100);
  }

  function pasarAAdmin(o) {
    cloud.patch('obras', o._id, { estado: 'vendida', ...stamp() });
    UI.toast('Pasó a Administración');
  }

  function backBtn() {
    return h('button.btn.ghost.small', { type: 'button', style: { marginBottom: '6px', paddingLeft: 0 }, onclick: () => (history.length > 1 ? history.back() : go('obras')) }, icon('back'), 'Volver');
  }
  function infoRow(label, value) {
    return h('div.info-row', h('span.muted', label), h('div', value == null || value === '' ? '—' : value));
  }

  /* ---------- Administración: contrato, cobros y paso a Entregas ---------- */

  function registrarContrato(o) {
    const body = h('div',
      h('p.muted', { style: { marginTop: '-8px' } }, o.nombre),
      UI.field({ label: 'Fecha en que se recibió el contrato firmado', name: 'fecha', type: 'date', value: UI.today() }),
      h('p.small.muted', 'Después, «Pasar a Entregas» es un botón aparte.'));
    UI.sheet({
      title: 'Contrato firmado',
      body: [body],
      actions: [{ label: 'Cancelar' }, {
        label: 'Guardar', kind: 'primary', onClick: () => {
          const val = UI.values(body);
          cloud.write([{ op: ventas[o._id] ? 'update' : 'set', col: 'ventas', id: o._id, data: { contratoFirmado: true, contratoFecha: val.fecha || UI.today(), contratoPor: me.email, contratoPorNombre: me.nombre, ...stamp() } }]);
          UI.toast('Contrato registrado. Ya se puede pasar a Entregas.');
        },
      }],
    });
  }

  // Campo de número o importe: pone los puntos de miles mientras se escribe («10000» → «10.000»). La coma es para los decimales.
  function numeroInput(inp) {
    inp.inputMode = 'decimal';
    inp.autocomplete = 'off';
    if (inp.value) inp.value = num(inp.value) ? fmtNum(num(inp.value)) : '';
    inp.addEventListener('input', () => {
      const pos = inp.selectionStart ?? inp.value.length;
      const antes = inp.value.slice(0, pos).replace(/[^\d,]/g, '').length;
      inp.value = CALC.formatTyping(inp.value);
      let i = 0;
      for (let n = 0; i < inp.value.length && n < antes; i++) if (/[\d,]/.test(inp.value[i])) n++;
      try { inp.setSelectionRange(i, i); } catch (e) { /* nada */ }
    });
    return inp;
  }

  // Registrar un pago desde las listas: si la seña no está registrada, se propone primero la seña.
  function registrarPago(o) {
    const c = cobro(o);
    pagoForm(o, null, c.senaSinRegistrar ? { tipo: 'sena', monto: Math.min(c.senaFalta, c.pendiente) } : {});
  }

  function habilitar(o, force) {
    if (faltaPlano(o)) return UI.toast(`Falta el plano (obligatorio en ${porQuePlano(o)}): adjuntalo en «Editar» antes de pasar a Entregas.`, 5000);
    if (!force && !condicionOk(o)) return UI.toast(faltaTexto(o));
    const body = h('div',
      h('p.muted', { style: { marginTop: '-8px' } }, o.nombre),
      responsableField(o.responsable),
      h('p.small.muted', 'La obra pasa al área de Entregas y el encargado la programa en la agenda.'));
    UI.sheet({
      title: 'Pasar a Entregas',
      body: [body],
      actions: [{ label: 'Cancelar' }, {
        label: 'Pasar a Entregas', kind: 'primary', onClick: () => {
          const v = UI.values(body);
          cloud.patch('obras', o._id, { estado: 'en_curso', habilitadaFecha: UI.today(), habilitadaPorNombre: me.nombre, responsable: v.responsable || o.responsable || '', inicio: o.instInicio || UI.today(), ...stamp() });
          UI.toast('Pasó a Entregas');
        },
      }],
    });
  }

  /* ---------- Entrega, agenda y equipos ---------- */

  // Materiales de la obra: lo calculado en la venta y, para pegamento y cinta, la cantidad que carga Entregas.
  // Pegamento y cinta que pone Slavon y todavía no tienen la cantidad cargada.
  function faltanCantidades(o) {
    if (esTerminada(o)) return [];
    const k = canchaDe(o);
    return ['pegamento', 'cinta'].filter((id) => k.incluye[id] && k.incluye[id].aplica && k.incluye[id].provee !== 'cliente'
      && !num(((o.materialesEntrega || {})[id] || {}).cantidad));
  }
  // Para la etiqueta «Faltan cantidades» de las listas: sólo cuando la entrega es en 7 días o menos (o ya pasó).
  const cantidadesUrgentes = (o) => faltanCantidades(o).length > 0 && !!fechaEnt(o) && UI.daysUntil(fechaEnt(o)) <= AVISO_DIAS;
  // Aviso del cuadro Materiales: rojo si la entrega es en 7 días o menos (o ya pasó), amarillo si falta más.
  function avisoCantidades(o) {
    const f = faltanCantidades(o);
    if (!f.length) return null;
    const que = f.map((id) => (id === 'cinta' ? 'cinta' : 'pegamento')).join(' y ');
    const fe = fechaEnt(o);
    const d = fe ? UI.daysUntil(fe) : null;
    const urgente = d != null && d <= AVISO_DIAS;
    const cuando = fe ? `la entrega es ${d < 0 ? 'desde el ' + UI.fmtDay(fe) + ' (ya pasó)' : 'el ' + UI.fmtDay(fe) + ' (' + UI.relDays(fe) + ')'}` : 'todavía no hay fecha de entrega';
    return h('div.aviso' + (urgente ? '.rojo' : ''), { style: { margin: '0 0 8px' } },
      `${urgente ? '⚠ ' : ''}Faltan las cantidades de ${que}: ${cuando}.`,
      !esTerminada(o) ? h('button.btn.small.ghost', { type: 'button', style: { marginLeft: '6px', padding: '2px 6px' }, onclick: () => editMateriales(o) }, 'Cargar') : null);
  }

  function materialesCard(o) {
    const lineas = incluyeLineas(o).filter((l) => l.id !== 'instalacion');
    return h('div', avisoCantidades(o), h('div.card.info', lineas.map((l) => infoRow(l.nombre, [h('div', l.texto),
      h('div.row.wrap', { style: { gap: '4px', marginTop: '3px' } }, l.cliente ? h('span.badge.warn', 'Lo pone el cliente') : null)]))));
  }

  /* ----- Remitos firmados por el cliente al recibir los materiales (no hace falta que esté instalada) ----- */
  // En la base: obras/{obra}/remitos/{id} con el link; el archivo (foto o PDF) en Storage: obras/{obra}/remitos/.

  const puedeBorrarRemito = (r) => canVenta || r.por === me.email;
  function remitosCard(o) {
    if (remitosObraId !== o._id) return h('div.card.empty.small', 'Cargando…');
    if (!remitos.length) return h('div.card.empty.small', 'Todavía no hay remitos firmados. Se suben al entregar los materiales (no hace falta que esté instalada).');
    return h('div.list', remitos.map((r) => h('div.item', { style: { cursor: 'default' } },
      h('span.dot.done', icon(r.mime === 'application/pdf' ? 'file' : 'camera')),
      h('div.grow', { style: { minWidth: 0 } },
        h('div.ellipsis', r.nota || r.nombre),
        h('div.small.muted.ellipsis', [`Entrega ${UI.fmtDay(r.fechaEntrega)}`, r.porNombre, r.nota ? r.nombre : ''].filter(Boolean).join(' · '))),
      h('button.btn.small.ghost', { type: 'button', onclick: () => verPlano(r) }, 'Ver'),
      puedeBorrarRemito(r) ? h('button.btn.small.ghost', { type: 'button', 'aria-label': 'Borrar remito', onclick: () => borrarRemito(o, r) }, icon('trash')) : null)));
  }

  function subirRemitos(o) {
    const nuevos = [];
    const list = h('div.list', { style: { marginBottom: '8px' } });
    const paint = () => {
      list.hidden = !nuevos.length;
      list.replaceChildren(...nuevos.map((a) => h('div.item', { style: { cursor: 'default', padding: '9px 12px' } },
        icon(a.mime === 'application/pdf' ? 'file' : 'eye'),
        h('div.grow.ellipsis', a.nombre),
        h('button.btn.small.ghost', { type: 'button', 'aria-label': 'Quitar', onclick: () => { nuevos.splice(nuevos.indexOf(a), 1); paint(); } }, icon('trash')))));
    };
    paint();
    const elegir = () => elegirArchivos(async (files) => {
      for (const f of files) {
        try { nuevos.push(await archivoParaSubir(f)); } catch (e) { UI.toast(e.message, 6000); }
      }
      paint();
    });
    const body = h('div',
      h('p.muted', { style: { marginTop: '-8px' } }, o.nombre),
      UI.field({ label: 'Día en que se entregaron los materiales', name: 'fechaEntrega', type: 'date', value: UI.today() }),
      UI.field({ label: 'N° de remito o qué se entregó (opcional)', name: 'nota', placeholder: 'Ej: Remito 0001-00012345 · césped y blanco' }),
      list,
      h('button.btn.small', { type: 'button', onclick: elegir }, icon('camera'), 'Elegir fotos o PDF'),
      h('p.small.muted', 'Foto de uno o varios remitos firmados por el cliente, o el PDF. Se guardan en el almacenamiento de archivos, como los planos.'));
    UI.sheet({
      title: 'Subir remitos firmados',
      body: [body],
      actions: [{ label: 'Cancelar' }, {
        label: 'Subir', kind: 'primary', onClick: async ({ error }) => {
          if (!nuevos.length) { error('Elegí al menos una foto o un PDF del remito firmado.'); return false; }
          const v = UI.values(body);
          const total = nuevos.length;
          UI.toast(total > 1 ? `Subiendo ${total} archivos…` : 'Subiendo…', 20000);
          while (nuevos.length) {
            const a = nuevos[0];
            const path = `obras/${o._id}/remitos/${a.id}-${nombreSeguro(a.nombre)}`;
            let url;
            try { url = await cloud.upload(path, a.blob, a.mime, { por: me.email }); } catch (e) { paint(); throw new Error('No se pudo subir «' + a.nombre + '» (hace falta conexión): ' + (e.message || e)); }
            cloud.put(`obras/${o._id}/remitos`, a.id, {
              obraId: o._id, nombre: a.nombre, mime: a.mime, path, url, tamano: a.blob.size,
              fechaEntrega: v.fechaEntrega || UI.today(), nota: (v.nota || '').trim(), por: me.email, porNombre: me.nombre, subidoEn: new Date().toISOString(),
            });
            nuevos.shift();
          }
          UI.toast(total > 1 ? `${total} remitos guardados` : 'Remito guardado');
        },
      }],
    });
  }

  async function borrarRemito(o, r) {
    if (!(await UI.confirm('¿Borrar el remito?', `Se borra «${r.nota || r.nombre}». No se puede deshacer.`, 'Borrar'))) return;
    cloud.del(`obras/${o._id}/remitos`, r._id);
    cloud.removeFile(r.path).catch(() => {});
    UI.toast('Remito borrado');
  }

  // Entregas completa cuánto pegamento y cinta lleva, y el envío de cada ítem (Sí / No / A definir).
  function editMateriales(o) {
    const m0 = o.materialesEntrega || {};
    const k = canchaDe(o);
    const campos = [['pegamento', 'Pegamento', 'Ej: baldes, kg'], ['cinta', 'Cinta de unión', 'Ej: m, rollos']].map(([id, nombre, ph]) => {
      const cant = UI.field({ label: `${nombre}: cantidad`, name: id + 'Cant', value: m0[id] && num(m0[id].cantidad) ? fmtNum(num(m0[id].cantidad)) : '' });
      numeroInput(cant.querySelector('input'));
      const uni = UI.field({ label: 'Unidad', name: id + 'Uni', value: (m0[id] && m0[id].unidad) || '', placeholder: ph });
      return fila2(cant, uni);
    });
    const envios = window.OBRAS_INCLUYE.filter((it) => !it.sinEnvio && k.incluye[it.id] && k.incluye[it.id].aplica).map((it) =>
      UI.field({ label: `${it.nombre}: envío`, name: 'env_' + it.id, type: 'select', value: envioNorm(k.envios[it.id]), options: ENVIOS }));
    const body = h('div', h('p.muted', { style: { marginTop: '-8px' } }, o.nombre),
      h('div.field-title', 'Pegamento y cinta'), ...campos,
      h('div.field-title', 'Envío incluido'), ...envios.map((f, i) => (i % 2 ? null : fila2(f, envios[i + 1] || h('div')))),
      h('p.small.muted', 'Quién lo provee se define en la venta.'));
    UI.sheet({
      title: 'Materiales',
      body: [body],
      actions: [{ label: 'Cancelar' }, {
        label: 'Guardar', kind: 'primary', onClick: () => {
          const v = UI.values(body);
          const materialesEntrega = {
            pegamento: { cantidad: num(v.pegamentoCant), unidad: v.pegamentoUni, porNombre: me.nombre, fecha: UI.today() },
            cinta: { cantidad: num(v.cintaCant), unidad: v.cintaUni, porNombre: me.nombre, fecha: UI.today() },
          };
          const env = { ...(o.envios || {}) };
          for (const key of Object.keys(v)) if (key.startsWith('env_')) env[key.slice(4)] = envioNorm(v[key]);
          cloud.patch('obras', o._id, { materialesEntrega, envios: env, ...stamp() });
          UI.toast('Guardado');
        },
      }],
    });
  }

  function entregaCard(o) {
    const sup = superpuestas(o, o.equipo, o.instInicio, o.instFin);
    return h('div.card.info',
      infoRow('Entrega estimada', o.fechaEntrega ? [UI.fmtDay(o.fechaEntrega), h('div.small.muted', 'Sale de la venta según el plazo' + (plazoTexto(o) ? ` (${plazoTexto(o)})` : ''))] : '—'),
      infoRow('Entrega real', h('span.row.wrap', { style: { gap: '8px' } },
        o.fechaEntregaReal ? h('span', h('b', UI.fmtDay(o.fechaEntregaReal)), h('span.muted', ' · ' + UI.relDays(o.fechaEntregaReal))) : h('span.badge.warn', 'Sin coordinar'),
        !esTerminada(o) ? h('button.btn.small', { type: 'button', onclick: () => coordinarFecha(o) }, icon('calendar'), o.fechaEntregaReal ? 'Cambiar' : 'Coordinar fecha') : null)),
      (o.cambiosEntrega || []).length ? h('details.cambios', h('summary.small.muted', `${o.cambiosEntrega.length} cambio${o.cambiosEntrega.length > 1 ? 's' : ''} de fecha`),
        h('div.small', [...o.cambiosEntrega].reverse().map((c) => h('div', { style: { margin: '4px 0' } },
          `${UI.fmtDay(c.fecha)} · ${c.porNombre || ''}: ${c.anterior ? UI.fmtDay(c.anterior) + ' → ' : ''}${UI.fmtDay(c.nueva)}`, c.motivo ? h('span.muted', ` · «${c.motivo}»`) : null)))) : null,
      infoRow('Instalación', h('span.row.wrap', { style: { gap: '8px' } }, o.instInicio ? fechasInst(o) : 'Sin programar',
        !esTerminada(o) && o.conInstalacion !== false ? h('button.btn.small', { type: 'button', onclick: () => programar(o) }, icon('calendar'), o.instInicio ? 'Cambiar' : 'Programar') : null)),
      o.conInstalacion !== false ? infoRow('Equipo', [o.equipo || '—', sup.length ? h('div.small', { style: { color: 'var(--warn)' } }, '⚠ Ese equipo también está en: ' + sup.map((x) => x.nombre).join(', ')) : null]) : null,
      infoRow('Responsable de entrega', o.responsable ? userName(o.responsable) : '—'),
      infoRow('Flete', h('span.row.wrap', { style: { gap: '8px' } }, o.flete || '—', !esTerminada(o) ? h('button.btn.small.ghost', { type: 'button', onclick: () => editFlete(o) }, icon('edit')) : null)),
      o.habilitadaFecha ? h('div.small.muted', { style: { marginTop: '6px' } }, `Entrega habilitada el ${UI.fmtDay(o.habilitadaFecha)}${o.habilitadaPorNombre ? ' por ' + o.habilitadaPorNombre : ''}`) : null);
  }

  // Fecha real de entrega: la que se coordina con el cliente. Cada cambio queda registrado (antes, después, motivo, quién).
  function coordinarFecha(o) {
    const fecha = UI.field({ label: 'Fecha real de entrega (coordinada con el cliente)', name: 'fecha', type: 'date', value: o.fechaEntregaReal || o.fechaEntrega || UI.today() });
    const motivo = UI.field({ label: o.fechaEntregaReal ? 'Por qué cambia' : 'Nota (opcional)', name: 'motivo', type: 'textarea', placeholder: o.fechaEntregaReal ? 'Ej: el cliente pidió pasarla, la base no estaba lista, llovió…' : 'Ej: coordinado por WhatsApp con el cliente' });
    const body = h('div', h('p.muted', { style: { marginTop: '-8px' } }, o.nombre),
      o.fechaEntrega ? h('p.small.muted', `Estimada según la venta: ${UI.fmtDay(o.fechaEntrega)}.`) : null,
      fecha, motivo);
    UI.sheet({
      title: o.fechaEntregaReal ? 'Cambiar la fecha de entrega' : 'Coordinar la fecha de entrega',
      body: [body],
      actions: [{ label: 'Cancelar' }, {
        label: 'Guardar', kind: 'primary', onClick: ({ error }) => {
          const v = UI.values(body);
          if (!v.fecha) { error('Poné la fecha.'); return false; }
          if (o.fechaEntregaReal && v.fecha !== o.fechaEntregaReal && !String(v.motivo || '').trim()) { error('Contá por qué cambia la fecha: queda en el historial.'); return false; }
          if (v.fecha === o.fechaEntregaReal) return;
          const cambiosEntrega = [...(o.cambiosEntrega || []), { anterior: o.fechaEntregaReal || '', nueva: v.fecha, motivo: String(v.motivo || '').trim(), por: me.email, porNombre: me.nombre, fecha: UI.today() }];
          cloud.patch('obras', o._id, { fechaEntregaReal: v.fecha, cambiosEntrega, ...stamp() });
          UI.toast('Fecha de entrega guardada');
        },
      }],
    });
  }

  function responsableField(value) {
    const posibles = users.filter((u) => u.activo !== false && u.apps && u.apps.obras);
    const opts = posibles.map((u) => [u._id, u.nombre || u._id]);
    if (value && !opts.some(([k]) => k === value)) opts.push([value, userName(value)]);
    return UI.field({ label: 'Responsable de entrega', name: 'responsable', type: 'select', value: value || '', options: [['', 'Sin asignar'], ...opts] });
  }

  function programar(o) {
    const t = TIPOS[o.tipo] || TIPOS.otro;
    const sugeridos = t.dias ? t.dias * Math.max(1, num(o.cantidad) || 1) : 0;
    const desde = UI.field({ label: 'Instalación desde', name: 'instInicio', type: 'date', value: o.instInicio || fechaEnt(o) || UI.today() });
    const hasta = UI.field({ label: 'Hasta (estimado)', name: 'instFin', type: 'date', value: o.instFin || '' });
    const aviso = h('div.small', { style: { color: 'var(--warn)', marginBottom: '10px' } });
    const eqSel = UI.field({ label: 'Equipo de instalación', name: 'equipo', type: 'select', value: o.equipo || '', options: [['', 'Sin asignar'], ...equipos().map((e) => [e, e]), ...(o.equipo && !equipos().includes(o.equipo) ? [[o.equipo, o.equipo]] : [])] });
    const body = h('div',
      h('p.muted', { style: { marginTop: '-8px' } }, o.nombre),
      h('div.row', { style: { gap: '10px' } }, h('div.grow', desde), h('div.grow', hasta)),
      sugeridos ? h('p.small.muted', { style: { marginTop: '-6px' } }, `Sugerido: ${sugeridos} día${sugeridos > 1 ? 's' : ''} (${t.dias} por cancha${num(o.cantidad) > 1 ? ' × ' + o.cantidad : ''}).`) : null,
      eqSel, aviso, responsableField(o.responsable));
    const inpDesde = desde.querySelector('input');
    const inpHasta = hasta.querySelector('input');
    function check() {
      const v = UI.values(body);
      const sup = superpuestas(o, v.equipo, v.instInicio, v.instFin);
      aviso.textContent = sup.length ? `⚠ ${v.equipo} también está en ${sup.map((x) => `${x.nombre} (${fechasInst(x)})`).join(', ')}. Se puede, pero revisalo.` : '';
    }
    inpDesde.addEventListener('change', () => {
      if (sugeridos && inpDesde.value && (!inpHasta.value || inpHasta.value < inpDesde.value)) inpHasta.value = UI.addDays(inpDesde.value, sugeridos - 1);
      check();
    });
    body.addEventListener('change', check);
    if (sugeridos && !inpHasta.value && inpDesde.value) inpHasta.value = UI.addDays(inpDesde.value, sugeridos - 1);
    check();
    UI.sheet({
      title: 'Agenda de instalación',
      body: [body],
      actions: [
        o.instInicio ? { label: 'Quitar fecha', kind: 'danger', onClick: () => { cloud.patch('obras', o._id, { instInicio: '', instFin: '', ...stamp() }); } } : { label: 'Cancelar' },
        {
          label: 'Guardar', kind: 'primary', onClick: () => {
            const v = UI.values(body);
            if (!v.instInicio) throw new Error('Poné la fecha de inicio.');
            if (v.instFin && v.instFin < v.instInicio) throw new Error('La fecha «hasta» no puede ser antes de «desde».');
            const data = { instInicio: v.instInicio, instFin: v.instFin || v.instInicio, equipo: v.equipo, responsable: v.responsable, ...stamp() };
            cloud.patch('obras', o._id, data);
            UI.toast('Instalación agendada');
          },
        },
      ],
    });
  }

  function editFlete(o) {
    const f = UI.field({ label: 'Flete', name: 'flete', value: o.flete || '', placeholder: 'Ej: Transporte X, sale el 14/11, llega el 15/11' });
    UI.sheet({
      title: 'Flete del césped',
      body: [h('p.muted.small', 'El envío lo hace un flete: anotá quién lo lleva y cuándo.'), f],
      actions: [{ label: 'Cancelar' }, { label: 'Guardar', kind: 'primary', onClick: () => { cloud.patch('obras', o._id, { flete: UI.values(f).flete, ...stamp() }); } }],
    });
  }

  function calendario() {
    if (!ui.agendaMes) ui.agendaMes = UI.today().slice(0, 7);
    const [y, m] = ui.agendaMes.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const days = new Date(y, m, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    const iso = (d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const mesNombre = first.toLocaleDateString('es-AR', { month: 'long' }).replace(/^./, (c) => c.toUpperCase()) + ' ' + y;
    const conFecha = obras.filter((o) => !esTerminada(o) && o.instInicio);
    const entregas = obras.filter((o) => (esVendida(o) || esCurso(o)) && fechaEnt(o) && !o.instInicio);
    const moveMonth = (n) => { const d = new Date(y, m - 1 + n, 1); ui.agendaMes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; render(); };

    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(h('div.cal-day.out'));
    for (let d = 1; d <= days; d++) {
      const day = iso(d);
      const inst = conFecha.filter((o) => day >= o.instInicio && day <= (o.instFin || o.instInicio));
      const ent = entregas.filter((o) => fechaEnt(o) === day);
      cells.push(h('div.cal-day', { class: day === UI.today() ? 'today' : '' },
        h('div.cal-num', d),
        inst.map((o) => h('button.cal-chip', { type: 'button', class: (TIPOS[o.tipo] || {}).estructura ? 'full' : '', title: [o.nombre, o.equipo].filter(Boolean).join(' · '), onclick: () => go('obra/' + o._id) }, (o.equipo ? o.equipo.replace(/^Equipo\s*/i, '') + ' · ' : '') + o.nombre)),
        ent.map((o) => h('button.cal-chip.ent', { type: 'button', title: 'Entrega comprometida (sin instalación programada): ' + o.nombre, onclick: () => go('obra/' + o._id) }, '⏳ ' + o.nombre))));
    }

    const proximas = conFecha.filter((o) => (o.instFin || o.instInicio) >= UI.today()).sort((a, b) => a.instInicio.localeCompare(b.instInicio));
    const sinFecha = obras.filter((o) => esCurso(o) && !o.instInicio && o.conInstalacion !== false);

    return [
      h('div.row.cal-nav',
        h('button.btn.small', { type: 'button', onclick: () => moveMonth(-1) }, icon('back')),
        h('b.grow', { style: { textAlign: 'center', fontSize: '17px' } }, mesNombre),
        h('button.btn.small', { type: 'button', onclick: () => moveMonth(1) }, icon('chev'))),
      h('div.cal-legend.small.muted', h('span.cal-chip', 'Césped'), h('span.cal-chip.full', 'Cancha completa'), h('span.cal-chip.ent', '⏳ Entrega comprometida, todavía en Administración')),
      h('div.cal', ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => h('div.cal-head', d)), cells),
      section('Próximas instalaciones', proximas.map(instItem), 'No hay instalaciones programadas.'),
      sinFecha.length ? section('Para programar', sinFecha.map((o) => obraRow(o, h('button.btn.small.primary', { type: 'button', onclick: (e) => { e.stopPropagation(); programar(o); } }, 'Programar'))), '') : null,
    ];
  }

  function equiposBlock() {
    const proximas = obras.filter((o) => !esTerminada(o) && o.instInicio && (o.instFin || o.instInicio) >= UI.today()).sort((a, b) => a.instInicio.localeCompare(b.instInicio));
    return [
      h('div.row', { style: { marginBottom: '10px' } }, h('p.muted.small.grow', { style: { margin: 0 } }, '3 equipos de AMBA con su gente, y los instaladores que viajan al interior (el cliente pone ayudantes y herramientas).'),
        canVenta ? h('button.btn.small', { type: 'button', onclick: editEquipos }, icon('edit'), 'Editar equipos') : null),
      h('div.list', equipos().map((e) => {
        const list = proximas.filter((o) => o.equipo === e);
        return h('div.item', { style: { cursor: 'default' } },
          h('span.dot', { class: list.length ? 'doing' : '' }, icon('users')),
          h('div.grow', h('div', { style: { fontWeight: 600 } }, e), h('div.small.muted', list.length ? list.map((o) => `${o.nombre} (${fechasInst(o)})`).join(' · ') : 'Libre')));
      })),
    ];
  }

  /* ---------- Logística del interior ---------- */

  function logisticaCard(o) {
    const items = o.logistica && o.logistica.length ? o.logistica : window.OBRAS_LOGISTICA.map((texto) => ({ id: uid(), texto, ok: false }));
    const done = items.filter((c) => c.ok).length;
    return h('div.list',
      h('div.item', { style: { cursor: 'default' } }, h('div.grow.small.muted', `Viático, estadía, comida y ayudantes a cargo del instalador · ${done} de ${items.length} listos`)),
      items.map((c, i) => h('label.item.check-item',
        h('input', {
          type: 'checkbox', checked: !!c.ok, onchange: (ev) => {
            const logistica = items.map((x) => ({ ...x }));
            logistica[i] = ev.target.checked ? { ...c, ok: true, porNombre: me.nombre, fecha: UI.today() } : { ...c, ok: false, porNombre: '', fecha: '' };
            cloud.patch('obras', o._id, { logistica, ...stamp() });
          },
        }),
        h('div.grow', h('div', c.texto), c.ok ? h('div.small.muted', `${c.porNombre || ''} · ${UI.fmtDay(c.fecha)}`) : null))));
  }

  /* ---------- Incidencias ---------- */

  function incidenciasCard(o) {
    const list = o.incidencias || [];
    if (!list.length) return h('div.card.empty.small', 'Sin incidencias.');
    return h('div.list', list.map((i) => h('div.item', { onclick: () => editIncidencia(o, i) },
      h('span.dot', { class: i.resuelta ? 'done' : 'late' }, i.resuelta ? icon('check') : '!'),
      h('div.grow',
        h('div', { style: { fontWeight: 600 } }, i.tipo),
        h('div.small.muted', [UI.fmtDay(i.fecha), i.porNombre, i.detalle].filter(Boolean).join(' · ')),
        !i.resuelta ? h('div.small', { style: { color: i.avisadoCliente ? 'var(--ok)' : 'var(--red)' } }, avisoTexto(i)) : h('div.small.muted', i.resolucion || 'Resuelta ' + UI.fmtDay(i.resueltaFecha))),
      icon('chev'))));
  }

  function nuevaIncidencia(o, tipo) { editIncidencia(o, null, tipo); }

  function editIncidencia(o, inc, tipoInicial) {
    const isNew = !inc;
    const tipoF = UI.field({ label: 'Qué pasó', name: 'tipo', type: 'select', value: inc ? inc.tipo : tipoInicial || window.OBRAS_INCIDENCIAS[0], options: window.OBRAS_INCIDENCIAS.map((t) => [t, t]) });
    const avisadoChk = h('input', { type: 'checkbox', name: 'avisadoCliente', checked: !!(inc && inc.avisadoCliente) });
    const avisoBox = h('div',
      fila2(UI.field({ label: 'Cuándo se le avisó', name: 'avisoFecha', type: 'date', value: (inc && inc.avisoFecha) || UI.today() }),
        UI.field({ label: 'Cómo', name: 'avisoMedio', type: 'select', value: (inc && inc.avisoMedio) || window.OBRAS_AVISO_MEDIOS[0], options: window.OBRAS_AVISO_MEDIOS.map((m) => [m, m]) })),
      UI.field({ label: 'A quién', name: 'avisoA', value: (inc && inc.avisoA) || '', placeholder: 'Ej: Juan (el dueño), el arquitecto' }));
    const notaBase = h('div.aviso.rojo', 'Si la base no está apta no se instala. Hay que avisarle al cliente y dejar registrado cuándo, cómo y a quién.');
    const pintar = () => {
      const base = tipoF.querySelector('select').value === 'Base no apta';
      notaBase.hidden = !base;
      avisoBox.hidden = !avisadoChk.checked;
    };
    tipoF.querySelector('select').addEventListener('change', pintar);
    avisadoChk.addEventListener('change', pintar);
    const body = h('div',
      h('p.muted', { style: { marginTop: '-8px' } }, o.nombre),
      tipoF, notaBase,
      UI.field({ label: 'Detalle', name: 'detalle', type: 'textarea', value: inc ? inc.detalle : '', placeholder: 'Ej: la base tiene desnivel en el sector norte, no se puede instalar' }),
      h('label.check', avisadoChk, 'Cliente avisado'),
      avisoBox,
      !isNew ? h('label.check', h('input', { type: 'checkbox', name: 'resuelta', checked: !!inc.resuelta }), 'Resuelta') : null,
      inc && inc.resolucion ? h('p.small.muted', inc.resolucion) : null);
    pintar();
    UI.sheet({
      title: isNew ? 'Nueva incidencia' : 'Incidencia',
      body: [body],
      actions: [
        !isNew && canVenta ? { label: 'Eliminar', kind: 'danger', onClick: () => { cloud.patch('obras', o._id, { incidencias: (o.incidencias || []).filter((x) => x.id !== inc.id), ...stamp() }); } } : { label: 'Cancelar' },
        {
          label: 'Guardar', kind: 'primary', onClick: ({ error }) => {
            const v = UI.values(body);
            if (v.tipo === 'Base no apta') {
              if (!v.detalle) { error('Contá qué tiene la base.'); return false; }
              if (!v.avisadoCliente) { error('Si la base no está apta hay que avisarle al cliente: tildá «Cliente avisado» y completá cuándo, cómo y a quién.'); return false; }
              if (!v.avisoA) { error('Poné a quién se le avisó.'); return false; }
            }
            const aviso = v.avisadoCliente ? { avisoFecha: v.avisoFecha || UI.today(), avisoMedio: v.avisoMedio, avisoA: v.avisoA } : { avisoFecha: '', avisoMedio: '', avisoA: '' };
            const list = (o.incidencias || []).map((x) => ({ ...x }));
            if (isNew) {
              list.unshift({ id: uid(), tipo: v.tipo, detalle: v.detalle, avisadoCliente: v.avisadoCliente, ...aviso, resuelta: false, fecha: UI.today(), por: me.email, porNombre: me.nombre });
            } else {
              const k = list.findIndex((x) => x.id === inc.id);
              list[k] = { ...inc, tipo: v.tipo, detalle: v.detalle, avisadoCliente: v.avisadoCliente, ...aviso, resuelta: v.resuelta, resueltaFecha: v.resuelta && !inc.resuelta ? UI.today() : v.resuelta ? inc.resueltaFecha : '' };
            }
            cloud.patch('obras', o._id, { incidencias: list, ...stamp() });
            UI.toast('Incidencia guardada');
          },
        },
      ],
    });
  }

  /* ---------- Etapas ---------- */

  function etapaItem(o, e, i) {
    const n = fotos.filter((f) => f.etapaId === e.id).length;
    if (esEtapaBase(e) && requiereBase(o)) {
      const no = baseNoApta(o);
      const ok = e.estado === 'hecha';
      return h('div.item.etapa', { onclick: () => editEtapa(o, i) },
        h('span.dot', { class: ok ? 'done' : no.length ? 'late' : '' }, ok ? icon('check') : no.length ? '!' : '1'),
        h('div.grow',
          h('div', { style: { fontWeight: 700 } }, e.nombre, h('span.badge.chico', { style: { marginLeft: '6px' } }, 'Obligatoria')),
          h('div.small', { class: ok ? 'muted' : '', style: ok ? null : { color: no.length ? 'var(--red)' : 'var(--warn)' } },
            ok ? [`Apta ${UI.fmtDay(e.fecha)}${e.porNombre ? ' · ' + e.porNombre : ''}`, n ? `${n} foto${n > 1 ? 's' : ''}` : '',
              e.whatsapp ? `constancia en WhatsApp (la tiene ${e.whatsapp.quien}, ${UI.fmtDay(e.whatsapp.fecha)})` : ''].filter(Boolean).join(' · ')
              : no.length ? `No apta: no se instala · ${avisoTexto(no[0])}` : 'Pendiente: hace falta una foto o la constancia en WhatsApp')),
        icon('chev'));
    }
    const espera = esperaBase(o, e) && e.estado === 'pendiente';
    const cls = e.estado === 'hecha' ? 'done' : e.estado === 'en_curso' ? 'doing' : '';
    return h('div.item.etapa', { onclick: () => editEtapa(o, i) },
      h('span.dot', { class: cls }, e.estado === 'hecha' ? icon('check') : String(i + 1)),
      h('div.grow',
        h('div', { style: { fontWeight: e.estado === 'en_curso' ? 700 : 500 } }, e.nombre),
        espera ? h('div.small.muted', '🔒 Espera la base apta') : null,
        e.estado !== 'pendiente' || e.nota || n ? h('div.small.muted',
          [e.estado === 'hecha' ? `Hecha ${UI.fmtDay(e.fecha)}${e.porNombre ? ' · ' + e.porNombre : ''}` : e.estado === 'en_curso' ? 'En curso' : '',
            n ? `${n} foto${n > 1 ? 's' : ''}` : '',
            e.nota ? '“' + e.nota + '”' : ''].filter(Boolean).join(' · ')) : null),
      icon('chev'));
  }

  function editEtapa(o, i) {
    const e = o.etapas[i];
    if (!e) return;
    if (esEtapaBase(e) && requiereBase(o)) return editBase(o, i);
    let estado = e.estado;
    const bloq = esperaBase(o, e);
    const segEl = h('div.seg');
    const paintSeg = () => segEl.replaceChildren(...[['pendiente', 'Pendiente'], ['en_curso', 'En curso'], ['hecha', 'Hecha']].map(([v, t]) =>
      h('button', { type: 'button', class: estado === v ? 'on' : '', disabled: bloq && v !== 'pendiente' && v !== e.estado, onclick: () => { estado = v; paintSeg(); fechaWrap.hidden = estado !== 'hecha'; } }, t)));
    paintSeg();
    const fechaWrap = UI.field({ label: 'Fecha en que se terminó', name: 'fecha', type: 'date', value: e.fecha || UI.today() });
    fechaWrap.hidden = estado !== 'hecha';
    const nota = UI.field({ label: 'Nota', name: 'nota', type: 'textarea', value: e.nota, placeholder: 'Ej: faltó material, llovió, se reprogramó…' });
    const propias = fotos.filter((f) => f.etapaId === e.id);
    const body = h('div', h('p.muted', { style: { marginTop: '-8px' } }, o.nombre),
      bloq ? h('div.aviso' + (baseNoApta(o).length ? '.rojo' : ''), '🔒 Primero la Etapa 1 «Base apta»: sin base apta no se instala.') : null,
      segEl, fechaWrap, nota,
      h('div.row', { style: { marginBottom: '10px' } }, h('b.grow', 'Fotos de esta etapa'),
        h('button.btn.small', { type: 'button', onclick: async () => { await guardar(); sh.close(); addFotos(o, e.id); } }, icon('camera'), 'Agregar')),
      fotosGrid(propias, o, false));
    async function guardar() {
      const v = UI.values(body);
      if (bloq && estado !== 'pendiente' && estado !== e.estado) throw new Error('Primero la Etapa 1 «Base apta»: sin base apta no se instala.');
      const etapas = o.etapas.map((x) => ({ ...x }));
      const nueva = { ...e, estado, nota: v.nota };
      if (estado === 'hecha') {
        nueva.fecha = v.fecha || UI.today();
        if (e.estado !== 'hecha') { nueva.por = me.email; nueva.porNombre = me.nombre; }
      } else {
        nueva.fecha = '';
        nueva.por = '';
        nueva.porNombre = '';
      }
      etapas[i] = nueva;
      if (JSON.stringify(etapas[i]) !== JSON.stringify(e)) cloud.patch('obras', o._id, { etapas, ...stamp() });
    }
    const sh = UI.sheet({
      title: e.nombre,
      body: [body],
      actions: [{ label: 'Cancelar' }, { label: 'Guardar', kind: 'primary', onClick: async () => { await guardar(); UI.toast('Guardado'); } }],
    });
  }

  // Etapa 1 «Base apta»: obligatoria. Apta = al menos una foto de la base o la constancia en WhatsApp (fecha y quién la tiene).
  function editBase(o, i) {
    const e = o.etapas[i];
    let apta = e.estado === 'hecha';
    const wa0 = e.whatsapp || null;
    const propias = fotos.filter((f) => f.etapaId === e.id);
    const no = baseNoApta(o);
    const segEl = h('div.seg');
    const fechaWrap = UI.field({ label: 'Fecha del control', name: 'fecha', type: 'date', value: e.fecha || UI.today() });
    const paintSeg = () => {
      segEl.replaceChildren(...[[false, 'Pendiente'], [true, 'Base apta']].map(([v, t]) =>
        h('button', { type: 'button', class: apta === v ? 'on' : '', onclick: () => { apta = v; paintSeg(); } }, t)));
      fechaWrap.hidden = !apta;
    };
    paintSeg();
    const waChk = h('input', { type: 'checkbox', name: 'wa', checked: !!wa0 });
    const waBox = fila2(UI.field({ label: 'Fecha de las fotos', name: 'waFecha', type: 'date', value: wa0 ? wa0.fecha : UI.today() }),
      UI.field({ label: 'Quién las tiene', name: 'waQuien', value: wa0 ? wa0.quien : me.nombre, placeholder: 'Ej: Beto, en su WhatsApp' }));
    waBox.hidden = !wa0;
    waChk.addEventListener('change', () => { waBox.hidden = !waChk.checked; });
    const body = h('div',
      h('p.muted', { style: { marginTop: '-8px' } }, o.nombre),
      h('p.small.muted', 'Etapa 1, obligatoria. Para marcarla apta hace falta al menos una foto de la base o la constancia en WhatsApp. Sin base apta no se instala.'),
      no.length ? h('div.aviso.rojo', `Base no apta (${UI.fmtDay(no[0].fecha)}): ${no[0].detalle || ''} · ${avisoTexto(no[0])}. Al marcarla apta se cierra sola.`) : null,
      segEl, fechaWrap,
      h('div.row', { style: { margin: '4px 0 10px' } }, h('b.grow', `Fotos de la base (${propias.length})`),
        h('button.btn.small', { type: 'button', onclick: agregarFotos }, icon('camera'), 'Agregar')),
      fotosGrid(propias, o, false),
      h('label.check', { style: { marginTop: '12px' } }, waChk, 'Constancia en WhatsApp (las fotos están en un WhatsApp)'),
      waBox,
      UI.field({ label: 'Nota', name: 'nota', type: 'textarea', value: e.nota, placeholder: 'Ej: nivelada, con la pendiente bien' }),
      h('button.btn.danger.small', { type: 'button', style: { marginBottom: '4px', paddingLeft: 0 }, onclick: () => { sh.close(); nuevaIncidencia(o, 'Base no apta'); } }, '⚠ La base no está apta: registrar que se avisó al cliente'));
    async function agregarFotos() {
      await guardar(false);
      sh.close();
      await addFotos(o, e.id);
      setTimeout(() => { const ob = obras.find((x) => x._id === o._id); const k = ob ? (ob.etapas || []).findIndex(esEtapaBase) : -1; if (k >= 0) editBase(ob, k); }, 400);
    }
    // validar = false: guarda lo escrito sin marcarla apta si todavía falta la constancia (al ir a sacar fotos).
    async function guardar(validar = true) {
      const v = UI.values(body);
      const whatsapp = v.wa ? { fecha: v.waFecha || UI.today(), quien: v.waQuien, por: me.email, porNombre: me.nombre } : null;
      if (validar && whatsapp && !whatsapp.quien) throw new Error('Poné quién tiene las fotos de la base en su WhatsApp.');
      const constancia = propias.length || (whatsapp && whatsapp.quien);
      if (validar && apta && !constancia) throw new Error('Para marcar la base apta hace falta al menos una foto de la base, o tildar «Constancia en WhatsApp» con la fecha y quién la tiene.');
      const estado = apta && constancia ? 'hecha' : 'pendiente';
      const nueva = { ...e, tipo: 'base', estado, nota: v.nota, whatsapp: whatsapp && whatsapp.quien ? { ...(wa0 && wa0.quien === whatsapp.quien && wa0.fecha === whatsapp.fecha ? wa0 : whatsapp) } : null };
      if (estado === 'hecha') {
        nueva.fecha = v.fecha || UI.today();
        if (e.estado !== 'hecha') { nueva.por = me.email; nueva.porNombre = me.nombre; }
      } else { nueva.fecha = ''; nueva.por = ''; nueva.porNombre = ''; }
      const etapas = o.etapas.map((x) => ({ ...x }));
      etapas[i] = nueva;
      const cambios = {};
      if (JSON.stringify(etapas) !== JSON.stringify(o.etapas)) cambios.etapas = etapas;
      // Al quedar apta se cierran solas las incidencias «Base no apta».
      if (estado === 'hecha' && no.length) {
        cambios.incidencias = (o.incidencias || []).map((x) => (x.tipo === 'Base no apta' && !x.resuelta
          ? { ...x, resuelta: true, resueltaFecha: nueva.fecha, resolucion: `Base apta el ${UI.fmtDay(nueva.fecha)}${nueva.porNombre ? ' (' + nueva.porNombre + ')' : ''}` } : x));
      }
      if (Object.keys(cambios).length) cloud.patch('obras', o._id, { ...cambios, ...stamp() });
      return estado;
    }
    const sh = UI.sheet({
      title: 'Etapa 1 · Base apta',
      body: [body],
      actions: [{ label: 'Cancelar' }, { label: 'Guardar', kind: 'primary', onClick: async () => { const est = await guardar(); UI.toast(est === 'hecha' ? 'Base apta: ya se puede instalar' : 'Guardado'); } }],
    });
  }

  function editEtapas(o) {
    let etapas = (o.etapas || []).map((e) => ({ ...e }));
    const fijaBase = requiereBase(o);
    const listEl = h('div');
    function paint() {
      // La Etapa 1 «Base apta» queda fija: no se borra ni se mueve, y nada se pone antes.
      const fija = (e) => fijaBase && esEtapaBase(e);
      listEl.replaceChildren(...etapas.map((e, i) => {
        if (fija(e)) {
          return h('div.edit-row',
            h('span.small.muted', { style: { width: '20px' } }, i + 1),
            h('input', { value: e.nombre, disabled: true, 'aria-label': 'Etapa 1' }),
            h('span.small.muted', { style: { whiteSpace: 'nowrap' } }, '🔒 Obligatoria'));
        }
        const inp = h('input', { value: e.nombre, placeholder: 'Nombre de la etapa' });
        inp.addEventListener('input', () => { e.nombre = inp.value; });
        return h('div.edit-row',
          h('span.small.muted', { style: { width: '20px' } }, i + 1),
          inp,
          h('button.btn.small.ghost', { type: 'button', disabled: i === 0 || fija(etapas[i - 1]), onclick: () => { [etapas[i - 1], etapas[i]] = [etapas[i], etapas[i - 1]]; paint(); } }, icon('up')),
          h('button.btn.small.ghost', { type: 'button', disabled: i === etapas.length - 1, onclick: () => { [etapas[i + 1], etapas[i]] = [etapas[i], etapas[i + 1]]; paint(); } }, icon('down')),
          h('button.btn.small.danger', { type: 'button', onclick: () => { etapas.splice(i, 1); paint(); } }, icon('trash')));
      }));
    }
    paint();
    UI.sheet({
      title: 'Editar etapas',
      body: [h('p.muted.small', 'Cambiá nombres, ordená, sacá o agregá pasos sólo para esta obra.'), listEl,
        h('button.btn.small', { type: 'button', onclick: () => { etapas.push({ id: uid(), nombre: '', estado: 'pendiente', nota: '' }); paint(); listEl.lastChild.querySelector('input').focus(); } }, icon('plus'), 'Agregar etapa')],
      actions: [{ label: 'Cancelar' }, {
        label: 'Guardar', kind: 'primary', onClick: () => {
          etapas = etapas.map((e) => ({ ...e, nombre: e.nombre.trim() })).filter((e) => e.nombre);
          cloud.patch('obras', o._id, { etapas, ...stamp() });
          UI.toast('Etapas guardadas');
        },
      }],
    });
  }

  /* ---------- Fotos ---------- */

  function fotosGrid(list, o, showEtapa) {
    if (!list.length) return h('div.card.empty.small', 'Todavía no hay fotos.');
    return h('div.fotos', list.map((f) => {
      const et = (o.etapas || []).find((e) => e.id === f.etapaId);
      const src = 'data:image/jpeg;base64,' + f.data;
      const caption = [et ? et.nombre : 'General', f.porNombre, UI.fmtDay((f.fecha || '').slice(0, 10)), f.nota].filter(Boolean).join(' · ');
      return h('button.foto', { type: 'button', onclick: () => fotoMenu(f, src, caption) },
        h('img', { src, alt: caption, loading: 'lazy' }),
        showEtapa && et ? h('span', et.nombre) : null);
    }));
  }

  function fotoMenu(f, src, caption) {
    const canDelete = isAdmin || f.por === me.email;
    if (!canDelete) return UI.showPhoto(src, caption);
    UI.sheet({
      title: 'Foto',
      body: [h('img', { src, style: { width: '100%', borderRadius: '12px' } }), h('p.small.muted', caption)],
      actions: [
        { label: 'Eliminar', kind: 'danger', onClick: async () => { if (await UI.confirm('¿Eliminar la foto?', 'No se puede deshacer.', 'Eliminar', 'primary')) { cloud.del('fotos', f._id); UI.toast('Foto eliminada'); } } },
        { label: 'Ver grande', onClick: () => UI.showPhoto(src, caption) },
      ],
    });
  }

  async function addFotos(o, etapaId) {
    const files = await UI.pickPhotos(true);
    if (!files.length) return;
    UI.toast(files.length > 1 ? `Subiendo ${files.length} fotos…` : 'Subiendo foto…', 10000);
    let ok = 0;
    for (const file of files) {
      try {
        const data = await UI.compressImage(file);
        cloud.put('fotos', cloud.newId(), {
          obraId: o._id, etapaId: etapaId || '', data, nota: '',
          por: me.email, porNombre: me.nombre, fecha: new Date().toISOString(), en: cloud.serverTime(),
        });
        ok++;
      } catch (e) {
        UI.toast(e.message, 5000);
      }
    }
    if (ok) UI.toast(ok > 1 ? `${ok} fotos guardadas` : 'Foto guardada');
  }

  /* ---------- Checklist de entrega ---------- */

  function checklistCard(o) {
    const items = o.checklist || [];
    if (!items.length) return h('div.card.empty.small', 'Sin checklist.');
    const done = items.filter((c) => c.ok).length;
    return h('div.list',
      h('div.item', { style: { cursor: 'default' } }, h('div.grow.small.muted', `${done} de ${items.length} controlados`), done === items.length ? h('span.badge.ok', 'Completo') : null),
      items.map((c, i) => h('label.item.check-item',
        h('input', {
          type: 'checkbox', checked: !!c.ok, onchange: (ev) => {
            const checklist = items.map((x) => ({ ...x }));
            checklist[i] = ev.target.checked
              ? { ...c, ok: true, por: me.email, porNombre: me.nombre, fecha: UI.today() }
              : { ...c, ok: false, por: '', porNombre: '', fecha: '' };
            cloud.patch('obras', o._id, { checklist, ...stamp() });
          },
        }),
        h('div.grow', h('div', c.texto), c.ok ? h('div.small.muted', `${c.porNombre || ''} · ${UI.fmtDay(c.fecha)}`) : null))));
  }

  function editChecklist(o) {
    const ta = UI.field({ label: 'Un control por renglón', name: 'items', type: 'textarea', value: (o.checklist || []).map((c) => c.texto).join('\n') });
    ta.querySelector('textarea').style.minHeight = '240px';
    UI.sheet({
      title: 'Editar checklist',
      body: [h('p.muted.small', 'Los controles que ya estaban tildados siguen tildados si no les cambiás el texto.'), ta],
      actions: [{ label: 'Cancelar' }, {
        label: 'Guardar', kind: 'primary', onClick: () => {
          const prev = o.checklist || [];
          const checklist = ta.querySelector('textarea').value.split('\n').map((s) => s.trim()).filter(Boolean)
            .map((texto) => prev.find((c) => c.texto === texto) || { id: uid(), texto, ok: false });
          cloud.patch('obras', o._id, { checklist, ...stamp() });
          UI.toast('Checklist guardado');
        },
      }],
    });
  }

  function checklistDefault(tipo, { conInstalacion = true, conArena, conCaucho } = {}) {
    const c = window.OBRAS_CHECKLIST;
    const t = TIPOS[tipo] || TIPOS.otro;
    const list = !conInstalacion ? c.sinInstalacion : [
      ...c.comun,
      ...(conArena ? c.arena : []),
      ...(conCaucho ? c.caucho : []),
      ...(t.estructura ? c.estructura : []),
    ];
    return list.map((texto) => ({ id: uid(), texto, ok: false }));
  }

  /* ---------- Entregar / reabrir ---------- */

  function terminar(o) {
    // Sin base apta no se instala: no se puede marcar entregada.
    if (requiereBase(o) && !baseApta(o)) {
      const k = (o.etapas || []).findIndex(esEtapaBase);
      const no = baseNoApta(o);
      UI.sheet({
        title: 'Todavía no se puede entregar',
        body: [h('div.aviso.rojo', no.length ? `La base no está apta (${avisoTexto(no[0])}): no se instala.` : 'Falta la Etapa 1 «Base apta».'),
          h('p.muted', 'Para marcar la obra entregada, primero la base tiene que estar apta, con al menos una foto o la constancia en WhatsApp.')],
        actions: [{ label: 'Cerrar' }, { label: 'Ir a la base', kind: 'primary', onClick: () => editEtapa(o, k) }],
      });
      return;
    }
    const faltanEt = (o.etapas || []).filter((e) => e.estado !== 'hecha').length;
    const faltanCh = (o.checklist || []).filter((c) => !c.ok).length;
    const incAb = (o.incidencias || []).filter((i) => !i.resuelta).length;
    const avisos = [];
    if (faltanEt) avisos.push(`${faltanEt} etapa${faltanEt > 1 ? 's' : ''} sin terminar`);
    if (faltanCh) avisos.push(`${faltanCh} control${faltanCh > 1 ? 'es' : ''} del checklist sin tildar`);
    if (incAb) avisos.push(`${incAb} incidencia${incAb > 1 ? 's' : ''} sin resolver`);
    if (remitosObraId === o._id && !remitos.length) avisos.push('ningún remito firmado cargado');
    const fecha = UI.field({ label: 'Fecha de entrega', name: 'fin', type: 'date', value: UI.today() });
    UI.sheet({
      title: 'Marcar como entregada',
      body: [
        avisos.length ? h('div.form-error', 'Ojo: quedan ' + avisos.join(', ') + '.') : null,
        fecha,
        h('p.muted.small', 'Se agendan solos los llamados de post-venta (al mes, a los 6 meses y al año) y empieza a correr la garantía. Después podés generar el acta de entrega para que firme el cliente.'),
      ],
      actions: [{ label: 'Cancelar' }, {
        label: 'Entregada', kind: 'primary', onClick: () => {
          const fin = UI.values(fecha).fin || UI.today();
          const postventa = window.OBRAS_POSTVENTA.map((p) => ({ id: p.id, label: p.label, fecha: UI.addMonths(fin, p.meses), hecho: false, nota: '' }));
          cloud.patch('obras', o._id, { estado: 'terminada', fin, postventa, ...stamp() });
          UI.toast('Obra entregada. Post-venta agendado.');
        },
      }],
    });
  }

  async function reabrir(o) {
    if (!(await UI.confirm('¿Reabrir la obra?', 'Vuelve a «en entrega» y se borran los llamados de post-venta agendados.', 'Reabrir'))) return;
    cloud.patch('obras', o._id, { estado: 'en_curso', fin: '', postventa: [], ...stamp() });
  }

  /* ---------- Post-venta y garantías ---------- */

  function viewPostventa() {
    const seg = h('div.seg', [['pendientes', 'Llamados pendientes'], ['hechos', 'Hechos'], ['garantias', 'Garantías']].map(([v, t]) =>
      h('button', { type: 'button', class: ui.pvFiltro === v ? 'on' : '', onclick: () => { ui.pvFiltro = v; render(); } }, t)));
    let content;
    if (ui.pvFiltro === 'garantias') {
      const list = obras.filter((o) => esTerminada(o) && garantiaVence(o)).sort((a, b) => garantiaVence(a).localeCompare(garantiaVence(b)));
      content = list.length ? h('div.list', list.map(garantiaItem)) : h('div.card.empty', 'No hay obras entregadas con garantía cargada.');
    } else {
      let items;
      if (ui.pvFiltro === 'pendientes') items = llamadosPendientes();
      else {
        items = [];
        for (const o of obras) for (const p of o.postventa || []) if (p.hecho) items.push({ obra: o, p });
        items.sort((a, b) => (b.p.hechoFecha || '').localeCompare(a.p.hechoFecha || ''));
      }
      content = items.length ? h('div.list', items.map((x) => llamadoItem(x, false))) : h('div.card.empty', ui.pvFiltro === 'pendientes' ? 'No hay llamados pendientes.' : 'Todavía no se hizo ningún llamado.');
    }
    setMain(
      areaHead('postventa', 'Al entregar una obra se agendan llamados al cliente al mes, a los 6 meses y al año, y empieza a correr la garantía. Delfina los canaliza y le da la orden al responsable si hace falta algo.'),
      buscador(),
      h('div', { style: { marginTop: '14px' } }, seg), content);
  }

  function llamadoItem({ obra: o, p }, enDetalle) {
    const d = UI.daysUntil(p.fecha);
    const badge = p.hecho ? h('span.badge.ok', 'Hecho')
      : d < 0 ? h('span.badge.red', 'Vencido')
        : d <= 7 ? h('span.badge.warn', UI.relDays(p.fecha))
          : h('span.badge', UI.fmtDay(p.fecha));
    return h('div.item', { onclick: () => llamadoSheet(o, p) },
      h('span.dot', { class: p.hecho ? 'done' : d <= 0 ? 'late' : '' }, icon(p.hecho ? 'check' : 'phone')),
      h('div.grow',
        h('div.ellipsis', { style: { fontWeight: 600 } }, enDetalle ? `Llamado de ${p.label}` : o.nombre),
        h('div.small.muted.ellipsis', enDetalle
          ? (p.hecho ? `${p.porNombre || ''} · ${UI.fmtDay(p.hechoFecha)}${p.nota ? ' · “' + p.nota + '”' : ''}` : UI.fmtDay(p.fecha))
          : `${p.label} · ${clientePed(o) || 'sin cliente'} · ${UI.fmtDay(p.fecha)}`)),
      badge);
  }

  function llamadoSheet(o, p) {
    const saludo = clienteNombreDe(o) ? ' ' + clienteNombreDe(o).split(' ')[0] : '';
    const msg = `Hola${saludo}, te escribimos de SLAVON. Queríamos saber cómo viene la cancha de ${o.nombre} y si necesitás algo. ¡Saludos!`;
    const tel = telDe(o);
    const wa = UI.waLink(tel, msg);
    const nota = UI.field({ label: 'Cómo le fue / qué dijo el cliente', name: 'nota', type: 'textarea', value: p.nota, placeholder: 'Ej: todo bien, pide recarga de arena en marzo' });
    UI.sheet({
      title: `Llamado de ${p.label}`,
      body: [
        h('p', h('b', o.nombre), h('br'), h('span.muted', `${clientePed(o) || 'Sin cliente cargado'} · agendado para el ${UI.fmtDay(p.fecha)}`)),
        tel ? h('div.row', { style: { marginBottom: '16px' } },
          h('a.btn.grow', { href: telHref(tel) }, icon('phone'), 'Llamar'),
          wa ? h('a.btn.grow', { href: wa, target: '_blank', rel: 'noopener' }, icon('whatsapp'), 'WhatsApp') : null)
          : h('p.small.muted', 'La obra no tiene teléfono cargado. Agregalo desde «Editar».'),
        contactosDe(o).length > 1 ? h('div', { style: { marginBottom: '14px' } }, contactosVer(o)) : null,
        nota,
        h('button.btn.ghost.small', { type: 'button', onclick: () => go('obra/' + o._id) }, 'Ver la obra'),
      ],
      actions: [
        { label: 'Cancelar' },
        p.hecho
          ? { label: 'Marcar pendiente', kind: 'dark', onClick: () => savePV(o, p, { hecho: false, nota: UI.values(nota).nota, por: '', porNombre: '', hechoFecha: '' }) }
          : { label: 'Marcar hecho', kind: 'primary', onClick: () => savePV(o, p, { hecho: true, nota: UI.values(nota).nota, por: me.email, porNombre: me.nombre, hechoFecha: UI.today() }) },
      ],
    });
  }

  function savePV(o, p, changes) {
    const postventa = (o.postventa || []).map((x) => (x.id === p.id ? { ...x, ...changes } : x));
    cloud.patch('obras', o._id, { postventa, ...stamp() });
    UI.toast('Guardado');
  }

  /* ---------- Acta de entrega (para imprimir o guardar en PDF) ---------- */

  // Lo que va en el acta (en pantalla, para imprimir y en el PDF).
  function actaDatos(o) {
    const k = canchaDe(o);
    const fecha = o.fin || UI.today();
    const vence = garantiaMesesDe(o) ? UI.addMonths(fecha, garantiaMesesDe(o)) : '';
    // A cargo del cliente: lo que provee él, la instalación si la hace él y los envíos que no están incluidos.
    const aCargo = [];
    for (const it of window.OBRAS_INCLUYE) {
      const x = k.incluye[it.id];
      if (!x || !x.aplica || x.provee !== 'cliente') continue;
      if (it.id === 'instalacion') aCargo.push('Instalación: la hace el cliente.');
      else aCargo.push(`${it.nombre}: la provee el cliente${!it.entregas && num(x.cantidad) ? ` (${fmtNum(num(x.cantidad))} ${x.unidad})` : ''}.`);
    }
    if (k.multisportResidencial && k.clienteColocaArena) aCargo.push('Colocación de la arena: la hace el cliente. Sin arena no tiene garantía.');
    const sinEnvio = window.OBRAS_INCLUYE.filter((it) => !it.sinEnvio && k.incluye[it.id] && k.incluye[it.id].aplica && k.incluye[it.id].provee !== 'cliente' && envioNorm(k.incluye[it.id].envio) === 'no');
    if (sinEnvio.length) aCargo.push(`Envío no incluido (a cargo del cliente): ${sinEnvio.map((it) => it.nombre.toLowerCase()).join(', ')}.`);
    const b = requiereBase(o) ? etapaBase(o) : null;
    const nFotosBase = b ? fotos.filter((f) => f.etapaId === b.id).length : 0;
    const base = !b ? '' : b.estado !== 'hecha' ? 'Pendiente' : [`Apta, controlada el ${UI.fmtDay(b.fecha)}${b.porNombre ? ' por ' + b.porNombre : ''}`,
      nFotosBase ? `${nFotosBase} foto${nFotosBase > 1 ? 's' : ''}` : '', b.whatsapp ? `constancia en WhatsApp (la tiene ${b.whatsapp.quien}, ${UI.fmtDay(b.whatsapp.fecha)})` : ''].filter(Boolean).join(' · ');
    const rem = remitosObraId === o._id ? remitos : [];
    const fechasRem = [...new Set(rem.map((r) => r.fechaEntrega).filter(Boolean))].sort().map((f) => UI.fmtDay(f));
    const remitosTxt = rem.length ? `${rem.length} remito${rem.length > 1 ? 's' : ''} firmado${rem.length > 1 ? 's' : ''}${fechasRem.length ? ` (entrega de materiales: ${fechasRem.join(', ')})` : ''}` : 'Sin remitos cargados';
    const finales = fotos.filter((f) => /cepillado|entregado|informe/i.test(((o.etapas || []).find((e) => e.id === f.etapaId) || {}).nombre || ''));
    return {
      numero: o._id.slice(0, 8).toUpperCase(),
      fecha,
      cliente: clientePed(o),
      telefono: telDe(o),
      obra: o.nombre,
      ubicacion: o.ubicacion,
      tipo: tipoNombre(o.tipo) + (k.formato ? ` · ${window.OBRAS_FORMATOS[k.formato].nombre}` : '') + (num(o.cantidad) > 1 ? ` · ${o.cantidad} canchas` : ''),
      medidas: medidasTexto(o),
      blanco: blancoTexto(o),
      superficie: m2Texto(k.m2),
      cesped: k.cesped,
      incluye: incluyeLineas(o, false).map((l) => `${l.nombre}: ${l.texto}`),
      arena: k.multisportResidencial ? (k.clienteColocaArena ? 'El cliente coloca la arena. Sin arena no tiene garantía.' : 'La arena la colocamos nosotros. Sin arena no tiene garantía.') : '',
      instalacion: fechasInst(o),
      base,
      remitos: remitosTxt,
      aCargo,
      sinGarantia: k.sinGarantia,
      garantia: k.sinGarantia ? '' : (vence ? `Garantía de ${garantiaTexto(o)} desde la fecha de entrega, válida hasta el ${UI.fmtDay(vence)}, según las condiciones del certificado de garantía.` : 'Garantía según las condiciones del certificado de garantía.')
        + ' Se entregan al cliente el certificado de garantía y el manual de mantenimiento. El mantenimiento periódico indicado en el manual es condición para la garantía.',
      checklist: (o.checklist || []).map((c) => ({ ok: !!c.ok, texto: c.texto })),
      observaciones: (o.incidencias || []).filter((i) => !i.resuelta).map((i) => `${i.tipo}: ${i.detalle}`).join('\n') || 'Sin observaciones.',
      fotos: (finales.length ? finales : fotos.filter((f) => !b || f.etapaId !== b.id)).slice(0, 6),
      pedido: o.pedido || '',
      clienteNombre: o.cliente || o.nombre,
    };
  }
  const SIN_GARANTIA_TXT = 'SIN GARANTÍA: la instalación estuvo a cargo del cliente.';
  const RECIBE_TXT = 'El cliente recibe el trabajo descripto, en las condiciones indicadas, y deja constancia de que se le explicó el uso y el mantenimiento de la cancha.';

  function viewActa(id) {
    const o = obras.find((x) => x._id === id);
    if (!o) { setMain(backBtn(), h('div.card.empty', 'Cargando…')); return; }
    watchFotos(id);
    const d = actaDatos(o);
    const row = (k, v) => (v ? h('tr', h('th', k), h('td', v)) : null);
    // Las observaciones se escriben antes de imprimir o descargar; si la pantalla se redibuja, no se pierden.
    if (ui.actaObs && ui.actaObs.id !== id) ui.actaObs = null;
    const obs = h('div.acta-edit', { contentEditable: 'true' }, ui.actaObs ? ui.actaObs.texto : d.observaciones);
    obs.addEventListener('input', () => { ui.actaObs = { id, texto: obs.innerText }; });
    setMain(
      h('div.acta-tools.no-print',
        backBtn(),
        h('span.grow'),
        h('button.btn', { type: 'button', onclick: () => window.print() }, 'Imprimir'),
        h('button.btn.primary', { type: 'button', onclick: () => actaPDF(o, obs.innerText) }, icon('file'), 'Descargar PDF')),
      h('p.small.muted.no-print', 'Revisá el acta. Las observaciones se pueden escribir acá antes de imprimir o descargar el PDF (para mandarla por WhatsApp).'),
      h('div.acta',
        h('div.acta-head',
          h('img', { src: '../shared/icons/logo.png', alt: 'SLAVON' }),
          h('div', h('div.acta-title', 'Acta de entrega'), h('div.acta-sub', `N° ${d.numero} · ${UI.fmtDay(d.fecha)}`))),
        h('h3', 'Cliente y obra'),
        h('table.acta-table', h('tbody',
          row('Cliente', d.cliente), row('Teléfono', d.telefono), row('Obra', d.obra), row('Ubicación', d.ubicacion))),
        h('h3', 'Trabajo entregado'),
        h('table.acta-table', h('tbody',
          row('Tipo', d.tipo),
          row('Medidas', d.medidas),
          row('Blanco', d.blanco),
          row('Superficie de césped', d.superficie),
          row('Césped', d.cesped),
          row('Incluye', h('div', d.incluye.map((t) => h('div', t)))),
          row('Arena', d.arena),
          row('Instalación', d.instalacion),
          row('Base', d.base),
          row('Remitos', d.remitos),
          row('Fecha de entrega', UI.fmtDay(d.fecha)))),
        d.aCargo.length ? [h('h3', 'A cargo del cliente'), h('ul.acta-cargo', d.aCargo.map((t) => h('li', t)))] : null,
        h('h3', 'Controles de entrega'),
        h('ul.acta-check', d.checklist.map((c) => h('li', { class: c.ok ? 'ok' : '' }, (c.ok ? '☑ ' : '☐ ') + c.texto))),
        d.fotos.length ? [h('h3', 'Fotos'), h('div.acta-fotos', d.fotos.map((f) => h('img', { src: 'data:image/jpeg;base64,' + f.data })))] : null,
        h('h3', 'Garantía y mantenimiento'),
        d.sinGarantia ? h('div.acta-sin-garantia', SIN_GARANTIA_TXT) : h('p', d.garantia),
        h('h3', 'Observaciones'),
        obs,
        h('p.small', RECIBE_TXT),
        h('div.acta-firmas',
          h('div', h('div.line'), 'Por SLAVON', h('div.small', 'Firma y aclaración')),
          h('div', h('div.line'), 'Cliente', h('div.small', 'Firma, aclaración y DNI')))),
    );
  }

  // Acta de entrega en PDF (para mandar por WhatsApp o mail). Usa jsPDF, que va incluido: funciona sin conexión.
  async function actaPDF(o, observaciones) {
    let lib;
    try { lib = await cargarJsPDF(); } catch (e) { return UI.toast(e.message, 5000); }
    const d = actaDatos(o);
    const doc = new lib.jsPDF({ unit: 'mm', format: 'a4' });
    const M = 16;
    const W = 210 - 2 * M;
    const ALTO = 297 - M;
    let y = M;
    const lugar = (alto) => { if (y + alto > ALTO) { doc.addPage(); y = M; } };
    const LH = (pt) => pt * 1.2 * 0.3528; // alto de una línea en mm
    const alto = (t, ancho, pt) => doc.setFontSize(pt).splitTextToSize(pdfTxt(t), ancho).length * LH(pt);
    try {
      const logo = await imagenDataURL('../shared/icons/logo.png');
      const lw = 46;
      doc.addImage(logo.url, 'PNG', M, y, lw, (lw * logo.h) / logo.w);
    } catch (e) { doc.setFont('helvetica', 'bold').setFontSize(18).text('SLAVON', M, y + 7); }
    doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(0).text('ACTA DE ENTREGA', 210 - M, y + 6, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(100).text(pdfTxt(`N° ${d.numero}   ·   ${UI.fmtDay(d.fecha)}`), 210 - M, y + 12, { align: 'right' });
    y += 18;
    doc.setDrawColor(229, 13, 45).setLineWidth(0.8).line(M, y, 210 - M, y);
    doc.setLineWidth(0.2);
    y += 7;
    const titulo = (t) => {
      lugar(14);
      y += 2;
      doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(34, 40, 44).text(pdfTxt(t.toUpperCase()), M, y);
      y += 1.8;
      doc.setDrawColor(225).line(M, y, 210 - M, y);
      y += 5;
    };
    const fila = (k, v) => {
      if (!v || (Array.isArray(v) && !v.length)) return;
      doc.setFont('helvetica', 'normal').setFontSize(10);
      const vs = (Array.isArray(v) ? v : [v]).flatMap((t) => doc.splitTextToSize(pdfTxt(t), W - 44));
      lugar(vs.length * LH(10) + 2);
      doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(100).text(pdfTxt(k), M, y);
      doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(0).text(vs, M + 44, y, { lineHeightFactor: 1.2 });
      y += vs.length * LH(10) + 2;
    };
    const parrafo = (t, tam = 10) => {
      doc.setFont('helvetica', 'normal').setFontSize(tam);
      const ls = doc.splitTextToSize(pdfTxt(t), W);
      lugar(ls.length * LH(tam) + 2);
      doc.setTextColor(0).text(ls, M, y, { lineHeightFactor: 1.2 });
      y += ls.length * LH(tam) + 2;
    };
    titulo('Cliente y obra');
    fila('Cliente', d.cliente); fila('Teléfono', d.telefono); fila('Obra', d.obra); fila('Ubicación', d.ubicacion);
    titulo('Trabajo entregado');
    fila('Tipo', d.tipo); fila('Medidas', d.medidas); fila('Blanco', d.blanco); fila('Superficie de césped', d.superficie); fila('Césped', d.cesped);
    fila('Incluye', d.incluye); fila('Arena', d.arena); fila('Instalación', d.instalacion); fila('Base', d.base); fila('Remitos', d.remitos);
    fila('Fecha de entrega', UI.fmtDay(d.fecha));
    if (d.aCargo.length) {
      titulo('A cargo del cliente');
      for (const t of d.aCargo) { parrafo('•  ' + t); y -= 0.6; }
    }
    titulo('Controles de entrega');
    const col = (W - 6) / 2;
    for (let i = 0; i < d.checklist.length; i += 2) {
      doc.setFont('helvetica', 'normal').setFontSize(9);
      const par = d.checklist.slice(i, i + 2).map((c) => doc.splitTextToSize(pdfTxt(`[${c.ok ? 'x' : '  '}] ${c.texto}`), col));
      const h2 = Math.max(...par.map((l) => l.length)) * LH(9) + 1.4;
      lugar(h2);
      par.forEach((l, j) => doc.setTextColor(d.checklist[i + j].ok ? 0 : 120).text(l, M + j * (col + 6), y, { lineHeightFactor: 1.2 }));
      y += h2;
    }
    if (d.fotos.length) {
      const gap = 4;
      const fw = (W - 2 * gap) / 3;
      const fh = fw * 0.75;
      lugar(fh + 16); // el título no queda solo al pie de la hoja
      titulo('Fotos');
      for (let i = 0; i < d.fotos.length; i += 3) {
        lugar(fh + gap);
        for (let j = 0; j < 3 && i + j < d.fotos.length; j++) {
          try {
            const url = 'data:image/jpeg;base64,' + d.fotos[i + j].data;
            const img = await imagenDataURL(url);
            const r = Math.min(fw / img.w, fh / img.h);
            const w = img.w * r;
            const hh = img.h * r;
            doc.addImage(url, 'JPEG', M + j * (fw + gap) + (fw - w) / 2, y + (fh - hh) / 2, w, hh);
          } catch (e) { /* una foto que no se puede leer no frena el acta */ }
        }
        y += fh + gap;
      }
    }
    titulo('Garantía y mantenimiento');
    if (d.sinGarantia) {
      lugar(14);
      doc.setDrawColor(229, 13, 45).setLineWidth(0.6).setFillColor(253, 236, 238).roundedRect(M, y - 4, W, 11, 1.5, 1.5, 'FD');
      doc.setLineWidth(0.2);
      doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(200, 10, 40).text(pdfTxt(SIN_GARANTIA_TXT), M + 4, y + 2.6);
      y += 12;
    } else parrafo(d.garantia);
    // Observaciones, la constancia y las firmas van juntas en la misma hoja.
    const obsTxt = String(observaciones || '').trim() || 'Sin observaciones.';
    lugar(14 + alto(obsTxt, W, 10) + 4 + alto(RECIBE_TXT, W, 9) + 32);
    titulo('Observaciones');
    parrafo(obsTxt);
    y += 2;
    parrafo(RECIBE_TXT, 9);
    y += 20;
    const fw2 = (W - 30) / 2;
    doc.setDrawColor(40).line(M, y, M + fw2, y);
    doc.line(210 - M - fw2, y, 210 - M, y);
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(0).text('Por SLAVON', M + fw2 / 2, y + 5, { align: 'center' });
    doc.text('Cliente', 210 - M - fw2 / 2, y + 5, { align: 'center' });
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(110).text(pdfTxt('Firma y aclaración'), M + fw2 / 2, y + 9.5, { align: 'center' });
    doc.text(pdfTxt('Firma, aclaración y DNI'), 210 - M - fw2 / 2, y + 9.5, { align: 'center' });
    // Nombre del archivo sin acentos ni eñes (algunos celulares los cambian por «download»).
    const nombre = pdfTxt(`Acta de entrega - ${d.clienteNombre}${d.pedido ? ' - Pedido ' + d.pedido : ''}`)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w .()-]/g, '').slice(0, 80);
    doc.save(`${nombre}.pdf`);
  }

  /* ---------- Recibo de un pago (PDF para descargar o imprimir) ---------- */

  function reciboDatos(o, p) {
    const c = cobro(o);
    const f = c.filas.find((x) => x.p._id === p._id) || { valor: CALC.valorPago(p, c.moneda), saldoDespues: c.pendiente };
    const cli = cat.clientes.find((x) => x._id === o.clienteId) || {};
    const concepto = p.tipo === 'sena' ? (c.fin ? 'anticipo' : 'seña') : c.fin ? 'pago a cuenta de las cuotas' : 'pago a cuenta del saldo';
    return {
      numero: reciboTexto(p.recibo),
      fecha: UI.fmtDay(p.fecha),
      cliente: o.cliente || o.nombre,
      clientePedido: [o.cliente || o.nombre, pedidoTexto(o)].filter(Boolean).join(' · '),
      retiro: p.retiro && p.retiro.buscado ? `Lo retiró ${p.retiro.quien}${p.retiro.donde ? ' en ' + p.retiro.donde : ''}` : '',
      cuit: cli.cuit || '',
      obra: o.nombre,
      pedido: o.pedido || '',
      monto: CALC.money(num(p.monto), p.moneda),
      letras: CALC.enLetras(num(p.monto), p.moneda),
      concepto: `${concepto} de la obra «${o.nombre}»`,
      forma: dondeTexto(p),
      cheques: (p.cheques || []).map((ch) => ({ numero: ch.numero || 's/n', banco: ch.banco || '', aNombreDe: ch.aNombreDe || '', fechaCobro: UI.fmtDay(ch.fechaCobro), monto: CALC.money(num(ch.monto), p.moneda) })),
      tc: num(p.tc) ? tcFmt(num(p.tc)) : '',
      equivalente: num(p.tc) && num(p.equivalente) ? CALC.money(num(p.equivalente), p.moneda === 'USD' ? 'ARS' : 'USD') : '',
      total: c.M(c.total),
      pagado: c.M(CALC.round2(c.total - f.saldoDespues)),
      saldo: f.saldoDespues > 0 ? c.M(f.saldoDespues) : 'Cero',
      nota: p.nota || '',
    };
  }

  function viewRecibo(obraId, pagoId) {
    const o = obras.find((x) => x._id === obraId);
    const p = (pagosPorObra[obraId] || []).find((x) => x._id === pagoId);
    if (!o || !p) { setMain(backBtn(), h('div.card.empty', obras.length ? 'No se encontró el pago.' : 'Cargando…')); return; }
    const d = reciboDatos(o, p);
    const row = (k, v) => (v ? h('tr', h('th', k), h('td', v)) : null);
    setMain(
      h('div.acta-tools.no-print',
        backBtn(),
        h('span.grow'),
        h('button.btn', { type: 'button', onclick: () => window.print() }, 'Imprimir'),
        h('button.btn.primary', { type: 'button', onclick: () => reciboPDF(o, p) }, icon('file'), 'Descargar PDF')),
      h('div.acta.recibo',
        h('div.acta-head',
          h('img', { src: '../shared/icons/logo.png', alt: 'SLAVON' }),
          h('div', h('div.acta-title', 'Recibo'), h('div.acta-sub', `${d.numero} · ${d.fecha}`))),
        h('p.recibo-texto', 'Recibimos de ', h('b', d.cliente), d.pedido ? ` (Pedido N° ${d.pedido})` : '', d.cuit ? ` (CUIT ${d.cuit})` : '', ' la suma de ', h('b', d.monto), ` (son ${d.letras}) en concepto de ${d.concepto}.`),
        h('table.acta-table', h('tbody',
          row('Forma de pago', d.forma),
          row('Retiro', d.retiro),
          row('Dólar BNA del día', d.tc),
          row('Equivale a', d.equivalente),
          row('Nota', d.nota))),
        d.cheques.length ? [h('h3', 'Cheques'), h('table.acta-table', h('tbody', d.cheques.map((ch) => h('tr', h('th', `N° ${ch.numero}`), h('td', [ch.banco, ch.aNombreDe ? 'a nombre de ' + ch.aNombreDe : '', 'cobro ' + ch.fechaCobro, ch.monto].filter(Boolean).join(' · '))))))] : null,
        h('h3', 'Estado de la cuenta'),
        h('table.acta-table', h('tbody', row('Total de la venta', d.total), row('Total pagado, con este recibo', d.pagado), row('Saldo pendiente', d.saldo))),
        h('div.acta-firmas', { style: { gridTemplateColumns: '1fr' } }, h('div', { style: { maxWidth: '260px', marginLeft: 'auto' } }, h('div.line'), 'Por SLAVON', h('div.small', 'Firma y aclaración')))));
  }

  // jsPDF va incluido en el repo (shared/vendor) y se carga sólo cuando se pide un PDF: funciona sin conexión.
  let jspdfCarga = null;
  function cargarJsPDF() {
    if (window.jspdf) return Promise.resolve(window.jspdf);
    if (!jspdfCarga) {
      jspdfCarga = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = '../shared/vendor/jspdf.umd.min.js';
        sc.onload = () => (window.jspdf ? resolve(window.jspdf) : reject(new Error('No se pudo cargar el generador de PDF.')));
        sc.onerror = () => { jspdfCarga = null; reject(new Error('No se pudo cargar el generador de PDF.')); };
        document.head.append(sc);
      });
    }
    return jspdfCarga;
  }
  async function imagenDataURL(src) {
    const blob = await (await fetch(src)).blob();
    const url = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    return { url, w: img.width, h: img.height };
  }
  // Las letras estándar del PDF no tienen todos los signos: se cambian los que faltan.
  const pdfTxt = (t) => String(t ?? '').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/×/g, 'x');

  async function reciboPDF(o, p) {
    let lib;
    try { lib = await cargarJsPDF(); } catch (e) { return UI.toast(e.message, 5000); }
    const d = reciboDatos(o, p);
    const doc = new lib.jsPDF({ unit: 'mm', format: 'a4' });
    const M = 18;
    const W = 210 - 2 * M;
    let y = M;
    try {
      const logo = await imagenDataURL('../shared/icons/logo.png');
      const lw = 52;
      doc.addImage(logo.url, 'PNG', M, y, lw, (lw * logo.h) / logo.w);
    } catch (e) { doc.setFont('helvetica', 'bold').setFontSize(18).text('SLAVON', M, y + 7); }
    doc.setFont('helvetica', 'bold').setFontSize(20).text('RECIBO', 210 - M, y + 6, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(11).text(pdfTxt(`${d.numero}   ·   ${d.fecha}`), 210 - M, y + 13, { align: 'right' });
    y += 22;
    doc.setDrawColor(200).line(M, y, 210 - M, y);
    y += 10;
    doc.setFontSize(12);
    const parrafo = `Recibimos de ${d.cliente}${d.pedido ? ` (Pedido N° ${d.pedido})` : ''}${d.cuit ? ` (CUIT ${d.cuit})` : ''} la suma de ${d.monto} (son ${d.letras}) en concepto de ${d.concepto}.`;
    const lineas = doc.splitTextToSize(pdfTxt(parrafo), W);
    doc.text(lineas, M, y);
    y += lineas.length * 6 + 6;
    const fila = (k, v) => {
      if (!v) return;
      const vs = doc.splitTextToSize(pdfTxt(v), W - 48);
      doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(90).text(pdfTxt(k), M, y);
      doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(0).text(vs, M + 48, y);
      y += Math.max(1, vs.length) * 5.5 + 2;
    };
    fila('Forma de pago', d.forma);
    fila('Retiro', d.retiro);
    fila('Dólar BNA del día', d.tc);
    fila('Equivale a', d.equivalente);
    fila('Nota', d.nota);
    if (d.cheques.length) {
      y += 3;
      doc.setFont('helvetica', 'bold').setFontSize(12).text('Cheques', M, y);
      y += 7;
      for (const ch of d.cheques) fila(`N° ${ch.numero}`, [ch.banco, ch.aNombreDe ? 'a nombre de ' + ch.aNombreDe : '', 'cobro ' + ch.fechaCobro, ch.monto].filter(Boolean).join(' · '));
    }
    y += 4;
    doc.setFillColor(244, 245, 246).roundedRect(M, y, W, 30, 2, 2, 'F');
    y += 8;
    doc.setFont('helvetica', 'bold').setFontSize(12).text('Estado de la cuenta', M + 5, y);
    y += 7;
    for (const [k, v] of [['Total de la venta', d.total], ['Total pagado, con este recibo', d.pagado], ['Saldo pendiente', d.saldo]]) {
      doc.setFont('helvetica', 'normal').setFontSize(11).text(pdfTxt(k), M + 5, y);
      doc.setFont('helvetica', 'bold').text(pdfTxt(v), 210 - M - 5, y, { align: 'right' });
      y += 6;
    }
    const yf = 297 - M - 24;
    doc.setDrawColor(120).line(210 - M - 70, yf, 210 - M, yf);
    doc.setFont('helvetica', 'normal').setFontSize(10).text('Por SLAVON', 210 - M - 35, yf + 6, { align: 'center' });
    doc.setFontSize(9).setTextColor(110).text('Firma y aclaración', 210 - M - 35, yf + 11, { align: 'center' });
    // Nombre del archivo sin acentos ni eñes (algunos celulares los cambian por «download»).
    const nombre = pdfTxt(`Recibo ${d.numero.replace('N° ', '')} - ${d.cliente}${d.pedido ? ' - Pedido ' + d.pedido : ''}`)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w .()-]/g, '').slice(0, 80);
    doc.save(`${nombre}.pdf`);
  }

  /* ---------- Alta / edición de venta-obra ---------- */

  /* ---------- Catálogos: vendedores, revendedores, clientes, proveedores y cuentas propias ---------- */

  const CATALOGOS = {
    vendedores: { titulo: 'Vendedores', uno: 'vendedor' },
    revendedores: { titulo: 'Revendedores', uno: 'revendedor' },
    clientes: { titulo: 'Clientes', uno: 'cliente' },
    proveedores: { titulo: 'Proveedores', uno: 'proveedor' },
    cuentas: { titulo: 'Cuentas propias', uno: 'cuenta' },
    cespedes: { titulo: 'Césped', uno: 'modelo de césped' },
  };
  const catNombre = (k, x) => (k === 'clientes' ? clienteTexto(x.club, x.clienteNombre) : x.nombre) || 'Sin nombre';
  const obrasDeCliente = (id) => obras.filter((o) => o.clienteId === id);
  function catSub(k, x) {
    if (k === 'revendedores') return [...(x.contactos || []).map((c) => c.valor), x.notas].filter(Boolean).join(' · ') || 'Sin contactos';
    if (k === 'clientes') {
      const n = obrasDeCliente(x._id).length;
      return [...(x.contactos || []).map((c) => c.valor), x.cuit ? 'CUIT ' + x.cuit : '', n ? (n === 1 ? '1 obra' : n + ' obras') : 'sin obras'].filter(Boolean).join(' · ');
    }
    if (k === 'proveedores') return (x.cuentas || []).map(cuentaProvTexto).join(' / ') || 'Sin cuentas cargadas';
    if (k === 'cespedes') {
      return [x.modeloFabrica && x.modeloFabrica !== x.nombre ? x.modeloFabrica : '', (x.deportes || []).map((d) => window.OBRAS_DEPORTES[d] || d).join(', '),
        x.alturas && x.alturas.length ? x.alturas.join('/') + ' mm' : x.alturaMm ? x.alturaMm + ' mm' : '', num(x.arenaKgM2) ? `arena ${fmtNum(num(x.arenaKgM2))} kg/m²` : '',
        num(x.cauchoKgM2) ? `caucho ${fmtNum(num(x.cauchoKgM2))} kg/m²` : '', x.admiteBicolor ? 'bicolor' : '', x.multisport ? 'multisport' : ''].filter(Boolean).join(' · ');
    }
    if (k === 'cuentas') return [x.tipo === 'efectivo' ? 'Efectivo' : 'Banco', x.banco, x.alias || x.cbu, { ARS: 'en $', USD: 'en US$' }[x.moneda], x.pideFactura ? 'hay que ver la factura' : ''].filter(Boolean).join(' · ');
    return '';
  }

  function viewCatalogos(k) {
    if (!CATALOGOS[k]) k = 'vendedores';
    ui.catQ = ui.catQ || {};
    const seg = h('div.seg.seg-scroll', Object.entries(CATALOGOS).map(([id, c]) => h('button', { type: 'button', class: id === k ? 'on' : '', onclick: () => go('catalogos/' + id) }, c.titulo)));
    const search = h('input.search', { type: 'search', placeholder: `Buscar en ${CATALOGOS[k].titulo.toLowerCase()}…` });
    search.value = ui.catQ[k] || '';
    const list = h('div');
    const row = (x) => h('div.item.catalogo-item', { class: x.activo === false ? 'baja' : '', onclick: () => editCatalogo(k, x) },
      h('div.grow', { style: { minWidth: 0 } }, h('div.ellipsis', { style: { fontWeight: 600 } }, catNombre(k, x)), h('div.small.muted.ellipsis', catSub(k, x))),
      x.activo === false ? h('span.badge', 'De baja') : null, icon('chev'));
    const paint = () => {
      ui.catQ[k] = search.value;
      const q = norm(search.value.trim());
      const items = cat[k].filter((x) => !q || norm([catNombre(k, x), catSub(k, x), x.notas, ...(x.contactos || []).map((c) => c.quien)].join(' ')).includes(q))
        .sort((a, b) => (k === 'cespedes' ? num(a.orden) - num(b.orden) : 0) || catNombre(k, a).localeCompare(catNombre(k, b)));
      const act = items.filter((x) => x.activo !== false);
      const baja = items.filter((x) => x.activo === false);
      list.replaceChildren(
        act.length ? h('div.list', act.map(row)) : h('div.card.empty.small', q ? 'No hay coincidencias.' : `Todavía no hay ${CATALOGOS[k].titulo.toLowerCase()} cargados.`),
        ...(baja.length ? [h('h3', 'Dados de baja'), h('div.list', baja.map(row))] : []));
    };
    search.addEventListener('input', paint);
    paint();
    setMain(
      backBtn(),
      h('div.row', h('h1.grow', 'Catálogos'), h('button.btn.primary.small', { type: 'button', onclick: () => editCatalogo(k, null) }, icon('plus'), 'Agregar')),
      h('p.small.muted', 'Las listas que se usan al cargar ventas y pagos. Lo que se da de baja no se borra: deja de aparecer para elegir, pero las ventas viejas lo siguen mostrando.'),
      seg, k === 'cespedes' ? cespedExtras() : null, h('div', { style: { margin: '12px 0' } }, search), list);
  }

  // Césped: valores por defecto del blanco y del pádel, y la carga inicial del catálogo.
  function cespedExtras() {
    const b = defaultsBlanco();
    return [
      !cat.cespedes.length ? h('div.paso', { style: { margin: '12px 0' } },
        h('div.grow', 'Todavía no hay modelos cargados. Mientras tanto, la venta usa la lista inicial de Slavon.'),
        h('button.btn.primary.small', { type: 'button', onclick: cargarCespedesInicial }, 'Cargar la lista inicial')) : null,
      h('div.card.row', { style: { margin: '12px 0', gap: '10px' } },
        h('div.grow', h('b', 'Valores por defecto'), h('div.small.muted', `Blanco: separación al borde ${fmtNum(b.s)} m · línea ${fmtNum(b.anchoLineaCm)} cm · desperdicio ${fmtNum(b.desperdicio)} % · Pádel: ${m2Texto(padelM2Default())} por cancha`)),
        h('button.btn.small', { type: 'button', onclick: editDefaultsCesped }, icon('edit'), 'Cambiar')),
    ];
  }

  function cargarCespedesInicial() {
    const ops = window.OBRAS_CESPEDES_INICIAL.map(({ id, ...x }, i) => ({ op: 'set', col: 'cespedes', id, data: { ...x, orden: i, activo: true, notas: '', ...stamp() } }));
    cloud.write(ops);
    UI.toast(`Se cargaron ${ops.length} modelos de césped`);
  }

  function editDefaultsCesped() {
    const b = defaultsBlanco();
    const f = (label, name, value) => { const x = UI.field({ label, name, value: fmtNum(value) }); numeroInput(x.querySelector('input')); return x; };
    const body = h('div',
      h('div.field-title', 'Blanco'),
      fila2(f('Separación al borde (m)', 's', b.s), f('Ancho de línea (cm)', 'anchoLineaCm', b.anchoLineaCm)),
      f('Desperdicio (%)', 'desperdicio', b.desperdicio),
      h('div.field-title', 'Pádel'),
      f('m² por cancha', 'padelM2', padelM2Default()),
      h('p.small.muted', 'Se usan en las ventas nuevas. En cada venta se pueden cambiar.'));
    UI.sheet({
      title: 'Valores por defecto',
      body: [body],
      actions: [{ label: 'Cancelar' }, {
        label: 'Guardar', kind: 'primary', onClick: () => {
          const v = UI.values(body);
          if (!(num(v.anchoLineaCm) > 0) || !(num(v.padelM2) > 0)) throw new Error('Revisá los valores.');
          cloud.put('config', 'obras', { ...config, blanco: { s: num(v.s), anchoLineaCm: num(v.anchoLineaCm), desperdicio: num(v.desperdicio) }, padelM2: num(v.padelM2), ...stamp() });
          UI.toast('Guardado');
        },
      }],
    });
  }

  // Cuentas bancarias de un proveedor: banco, titular, CBU, alias y moneda.
  function cuentasProvEditor(lista) {
    const rows = h('div');
    const add = (c = {}) => {
      const f = {
        banco: UI.field({ label: 'Banco', name: '', value: c.banco || '' }),
        titular: UI.field({ label: 'Titular', name: '', value: c.titular || '' }),
        cbu: UI.field({ label: 'CBU / CVU', name: '', value: c.cbu || '', inputMode: 'numeric' }),
        alias: UI.field({ label: 'Alias', name: '', value: c.alias || '' }),
        moneda: UI.field({ label: 'Moneda', name: '', type: 'select', value: c.moneda || 'ARS', options: [['ARS', '$'], ['USD', 'US$']] }),
      };
      for (const k of Object.keys(f)) f[k].querySelector('input,select').removeAttribute('name');
      const inp = (k) => f[k].querySelector('input,select');
      const row = h('div.cheque',
        h('div.row', h('b.grow', 'Cuenta'), h('button.btn.small.ghost', { type: 'button', 'aria-label': 'Quitar cuenta', onclick: () => row.remove() }, icon('trash'))),
        fila2(f.banco, f.moneda), f.titular, fila2(f.cbu, f.alias));
      row.leer = () => ({ id: c.id || uid(), banco: inp('banco').value.trim(), titular: inp('titular').value.trim(), cbu: inp('cbu').value.trim(), alias: inp('alias').value.trim(), moneda: inp('moneda').value });
      rows.append(row);
    };
    lista.forEach(add);
    const el = h('div.field', h('span', 'Cuentas bancarias'), rows, h('button.btn.small', { type: 'button', onclick: () => add() }, icon('plus'), 'Agregar cuenta'));
    return { el, leer: () => [...rows.children].map((r) => r.leer()).filter((c) => c.banco || c.cbu || c.alias) };
  }

  // Alta o edición de un elemento de catálogo. onSaved(id, data) sirve para elegirlo enseguida desde la venta o el pago.
  function editCatalogo(k, x, onSaved) {
    const nuevo = !x;
    const d = x || {};
    const C = CATALOGOS[k];
    let extra = null;
    const nombreF = UI.field({ label: 'Nombre', name: 'nombre', value: d.nombre || '', required: true });
    const notasF = UI.field({ label: 'Notas', name: 'notas', type: 'textarea', value: d.notas || '' });
    let campos;
    if (k === 'vendedores') campos = [nombreF];
    else if (k === 'revendedores') {
      extra = contactosEditor(d.contactos || []);
      campos = [nombreF, h('p.small.muted', { style: { marginTop: '-8px' } }, 'La comisión es un monto fijo que se carga en cada venta.'), extra.el, notasF];
    } else if (k === 'clientes') {
      extra = contactosEditor(d.contactos || []);
      const os = x ? obrasDeCliente(x._id) : [];
      campos = [
        fila2(UI.field({ label: 'Nombre del cliente', name: 'clienteNombre', value: d.clienteNombre || '', placeholder: 'Ej: Juan Pérez' }), UI.field({ label: 'Club', name: 'club', value: d.club || '', placeholder: 'Ej: Club Huracán' })),
        h('p.small.muted', { style: { marginTop: '-8px' } }, 'Con uno alcanza. Si cambiás un dato, se actualiza en todas sus obras.'),
        extra.el,
        UI.field({ label: 'CUIT', name: 'cuit', value: d.cuit || '', inputMode: 'numeric' }),
        notasF,
        os.length ? h('div.field', h('span', 'Obras'), h('div.list', os.map((o) => h('div.item', { onclick: () => { document.querySelectorAll('dialog.sheet[open]').forEach((dl) => dl.close()); go('obra/' + o._id); } }, h('div.grow.ellipsis', o.nombre), h('span.badge', AREAS[areaDe(o)].nombre))))) : null,
      ];
    } else if (k === 'cespedes') {
      const n = (label, name, value, ph) => { const x = UI.field({ label, name, value: value != null && value !== '' ? fmtNum(num(value)) : '', placeholder: ph || '' }); numeroInput(x.querySelector('input')); return x; };
      const deps = h('div.row.wrap', { style: { gap: '0 16px' } }, Object.entries(window.OBRAS_DEPORTES).map(([id, nombre]) =>
        h('label.check', h('input', { type: 'checkbox', name: 'dep_' + id, checked: (d.deportes || []).includes(id) }), nombre)));
      campos = [
        fila2(UI.field({ label: 'Modelo Slavon', name: 'nombre', value: d.nombre || '', required: true }), UI.field({ label: 'Modelo de fábrica', name: 'modeloFabrica', value: d.modeloFabrica || '' })),
        h('div.field', h('span', 'Deportes'), deps),
        fila2(UI.field({ label: 'Altura (mm)', name: 'altura', value: d.alturas && d.alturas.length ? d.alturas.join('/') : d.alturaMm ? String(d.alturaMm) : '', placeholder: 'Ej: 52 · o 20/30/40 para elegir' }), n('Rollo (m)', 'rolloM', d.rolloM ?? 4)),
        fila2(n('Arena (kg/m²)', 'arenaKgM2', d.arenaKgM2, 'Vacío = no lleva'), n('Caucho (kg/m²)', 'cauchoKgM2', d.cauchoKgM2, 'Vacío = no lleva')),
        h('label.check', h('input', { type: 'checkbox', name: 'blanco', checked: !!d.blanco }), 'Viene en blanco (para las líneas)'),
        h('label.check', h('input', { type: 'checkbox', name: 'multisport', checked: !!d.multisport }), 'Es multisport'),
        h('label.check', h('input', { type: 'checkbox', name: 'admiteBicolor', checked: !!d.admiteBicolor }), 'Puede ser bicolor'),
        notasF,
      ];
    } else if (k === 'proveedores') {
      extra = cuentasProvEditor(d.cuentas || []);
      campos = [nombreF, UI.field({ label: 'CUIT', name: 'cuit', value: d.cuit || '', inputMode: 'numeric' }), extra.el, notasF];
    } else {
      campos = [
        nombreF,
        h('p.small.muted', { style: { marginTop: '-8px' } }, 'Ej: W. MAX SRL, Atlantis, Efectivo oficina.'),
        fila2(UI.field({ label: 'Tipo', name: 'tipo', type: 'select', value: d.tipo || 'banco', options: [['banco', 'Cuenta de banco'], ['efectivo', 'Caja de efectivo']] }),
          UI.field({ label: 'Moneda', name: 'moneda', type: 'select', value: d.moneda || 'ARS', options: [['ARS', '$'], ['USD', 'US$'], ['ambas', '$ y US$']] })),
        fila2(UI.field({ label: 'Banco', name: 'banco', value: d.banco || '' }), UI.field({ label: 'Titular', name: 'titular', value: d.titular || '' })),
        fila2(UI.field({ label: 'CBU / CVU', name: 'cbu', value: d.cbu || '', inputMode: 'numeric' }), UI.field({ label: 'Alias', name: 'alias', value: d.alias || '' })),
        h('label.check', h('input', { type: 'checkbox', name: 'pideFactura', checked: !!d.pideFactura }), 'Si el cliente paga acá, hay que ver la factura (ya tiene / hay que solicitarla)'),
        notasF,
      ];
    }
    const body = h('div', campos.filter(Boolean));
    const guardar = (activo) => {
      const v = UI.values(body);
      let data;
      if (k === 'clientes') {
        if (!v.clienteNombre && !v.club) throw new Error('Poné el nombre del cliente o el club.');
        data = { clienteNombre: v.clienteNombre, club: v.club, nombre: clienteTexto(v.club, v.clienteNombre), contactos: extra.leer(), cuit: v.cuit, notas: v.notas };
      } else {
        if (!v.nombre) throw new Error('Poné el nombre.');
        data = { nombre: v.nombre };
        if (k === 'revendedores') Object.assign(data, { contactos: extra.leer(), notas: v.notas });
        if (k === 'proveedores') Object.assign(data, { cuit: v.cuit, cuentas: extra.leer(), notas: v.notas });
        if (k === 'cespedes') {
          const deportes = Object.keys(window.OBRAS_DEPORTES).filter((id) => v['dep_' + id]);
          if (!deportes.length) throw new Error('Marcá al menos un deporte.');
          const alts = String(v.altura || '').split(/[\/,\s]+/).map((x) => num(x)).filter((x) => x > 0);
          Object.assign(data, {
            modeloFabrica: v.modeloFabrica, deportes, alturaMm: alts.length === 1 ? alts[0] : null, alturas: alts.length > 1 ? alts : [],
            arenaKgM2: v.arenaKgM2 === '' ? null : num(v.arenaKgM2), cauchoKgM2: v.cauchoKgM2 === '' ? null : num(v.cauchoKgM2),
            blanco: !!v.blanco, multisport: !!v.multisport, admiteBicolor: !!v.admiteBicolor, rolloM: num(v.rolloM) || 4, notas: v.notas,
            orden: x ? x.orden ?? cat.cespedes.length : cat.cespedes.length,
          });
        }
        if (k === 'cuentas') Object.assign(data, { tipo: v.tipo, moneda: v.moneda, banco: v.banco, titular: v.titular, cbu: v.cbu, alias: v.alias, pideFactura: v.pideFactura, notas: v.notas });
      }
      const id = x ? x._id : cloud.newId();
      const doc = { ...(x || {}), ...data, activo, ...stamp(), ...(nuevo ? { creadoPor: me.email, creadoPorNombre: me.nombre, creadoEn: cloud.serverTime() } : {}) };
      const ops = [{ op: 'set', col: k, id, data: doc }];
      if (k === 'clientes' && x) ops.push(...copiaClienteOps(id, doc));
      cloud.write(ops);
      UI.toast(nuevo ? `${C.uno[0].toUpperCase() + C.uno.slice(1)} agregado` : 'Guardado');
      if (onSaved) onSaved(id, doc);
    };
    const actions = [{ label: 'Cancelar' }];
    if (x) actions.push(x.activo === false ? { label: 'Reactivar', onClick: () => guardar(true) } : { label: 'Dar de baja', kind: 'danger', onClick: () => guardar(false) });
    actions.push({ label: nuevo ? 'Agregar' : 'Guardar', kind: 'primary', onClick: () => guardar(x ? x.activo !== false : true) });
    UI.sheet({ title: nuevo ? `Nuevo ${C.uno}` : catNombre(k, x), body: [body], actions });
  }

  // Los datos del cliente se copian en cada obra (los encargados los ven ahí sin leer el catálogo).
  function copiaClienteOps(clienteId, cl, salvo) {
    const tel = (cl.contactos || []).find((c) => c.tipo !== 'mail');
    const mail = (cl.contactos || []).find((c) => c.tipo === 'mail');
    const copia = { clienteId, clienteNombre: cl.clienteNombre || '', club: cl.club || '', cliente: clienteTexto(cl.club, cl.clienteNombre), contactos: cl.contactos || [], telefono: tel ? tel.valor : '', email: mail ? mail.valor : '' };
    return obrasDeCliente(clienteId).filter((o) => o._id !== salvo).map((o) => ({ op: 'update', col: 'obras', id: o._id, data: copia }));
  }

  // ¿Ya hay un cliente parecido? (mismo club y nombre, mismo teléfono o mismo mail)
  function clienteParecido(club, nombre, contactos) {
    const digitos = (t) => String(t || '').replace(/\D/g, '');
    const tels = contactos.filter((c) => c.tipo !== 'mail').map((c) => digitos(c.valor)).filter((t) => t.length >= 6);
    const mails = contactos.filter((c) => c.tipo === 'mail').map((c) => norm(c.valor)).filter(Boolean);
    return cat.clientes.find((x) => {
      if (x.activo === false) return false;
      if ((club || nombre) && norm(x.club) === norm(club) && norm(x.clienteNombre) === norm(nombre)) return true;
      return (x.contactos || []).some((c) => (c.tipo === 'mail' ? mails.includes(norm(c.valor)) : tels.some((t) => digitos(c.valor).endsWith(t.slice(-8)))));
    });
  }

  // Pregunta con varias respuestas. Devuelve la clave elegida o null.
  function elegir(title, text, opciones) {
    return new Promise((resolve) => {
      let r = null;
      UI.sheet({ title, body: [h('p.muted', text)], actions: [{ label: 'Cancelar' }, ...opciones.map(([k, label, kind]) => ({ label, kind, onClick: () => { r = k; } }))], onClose: () => resolve(r) });
    });
  }

  /* ----- En la venta: vendedores y revendedor ----- */

  const vendedoresTexto = (v) => ((v.vendedores || []).length ? v.vendedores.map((x) => x.nombre).join(', ') : v.vendio || '');

  // Vendedores: botones para marcar uno o varios, y alta rápida.
  function vendedoresPicker(v) {
    let sel = (v.vendedores || []).map((x) => ({ ...x }));
    if (!sel.length && v.vendio) { // ventas viejas: el vendedor era texto libre
      const m = cat.vendedores.find((x) => norm(x.nombre) === norm(v.vendio));
      if (m) sel = [{ id: m._id, nombre: m.nombre }];
    }
    const box = h('div.row.wrap', { style: { gap: '6px' } });
    const paint = () => {
      const lista = activos(cat.vendedores, null);
      for (const s of sel) if (!lista.some((x) => x._id === s.id)) lista.push({ _id: s.id, nombre: s.nombre });
      box.replaceChildren(
        ...lista.map((x) => {
          const on = sel.some((s) => s.id === x._id);
          return h('button.chip-toggle', { type: 'button', class: on ? 'on' : '', 'aria-pressed': on ? 'true' : 'false', onclick: () => {
            sel = on ? sel.filter((s) => s.id !== x._id) : [...sel, { id: x._id, nombre: x.nombre }];
            paint();
          } }, on ? icon('check') : null, x.nombre);
        }),
        h('button.chip-toggle.nuevo', { type: 'button', onclick: () => editCatalogo('vendedores', null, (id, doc) => { sel = [...sel, { id, nombre: doc.nombre }]; setTimeout(paint, 50); }) }, icon('plus'), 'Nuevo'));
    };
    paint();
    const el = h('div.field', h('span', 'Quién vendió (uno o varios)'), box,
      !(v.vendedores || []).length && v.vendio && !sel.length ? h('p.small.muted', { style: { margin: '6px 0 0' } }, `Antes figuraba: «${v.vendio}». Elegilo de la lista o agregalo.`) : null);
    return { el, leer: () => sel };
  }

  // Revendedor (opcional) con su comisión: un monto fijo por venta, en US$ o $.
  const comisionTexto = (r) => (r && num(r.comisionMonto) ? CALC.money(num(r.comisionMonto), r.comisionMoneda === 'ARS' ? 'ARS' : 'USD') : '');
  function revendedorPicker(v, getPrecio) {
    const r0 = v.revendedor || null;
    const chk = h('input', { type: 'checkbox', checked: !!r0 });
    const selF = UI.field({ label: 'Revendedor', name: '', type: 'select', value: r0 ? r0.id : '', options: [] });
    const monF = UI.field({ label: 'Moneda', name: '', type: 'select', value: (r0 && r0.comisionMoneda) || monedaDe(v), options: [['USD', 'US$'], ['ARS', '$']] });
    const montoF = UI.field({ label: 'Comisión (monto fijo)', name: '', value: r0 && num(r0.comisionMonto) ? fmtNum(num(r0.comisionMonto)) : '' });
    [selF, monF, montoF].forEach((f) => f.querySelector('input,select').removeAttribute('name'));
    const sel = selF.querySelector('select');
    const mon = monF.querySelector('select');
    const monto = numeroInput(montoF.querySelector('input'));
    const box = h('div', selF, h('div.row', { style: { gap: '10px', alignItems: 'flex-start' } }, h('div', { style: { width: '34%' } }, monF), h('div.grow', montoF)));
    let monedaTocada = !!(r0 && r0.comisionMoneda);
    mon.addEventListener('change', () => { monedaTocada = true; });
    const llenar = (elegido) => {
      const lista = activos(cat.revendedores, elegido);
      if (elegido && !lista.some((x) => x._id === elegido) && r0) lista.push({ _id: r0.id, nombre: r0.nombre });
      sel.replaceChildren(h('option', { value: '' }, lista.length ? 'Elegí…' : 'No hay revendedores cargados'),
        ...lista.map((x) => h('option', { value: x._id, selected: x._id === elegido }, x.nombre)), h('option', { value: '__nuevo' }, '+ Nuevo revendedor…'));
      sel.value = elegido || '';
    };
    // La moneda de la comisión sigue a la de la venta mientras no se elija otra.
    const refresh = () => {
      box.hidden = !chk.checked;
      if (!monedaTocada) mon.value = getPrecio().moneda;
    };
    sel.addEventListener('change', () => {
      if (sel.value === '__nuevo') {
        llenar('');
        editCatalogo('revendedores', null, (id) => setTimeout(() => { llenar(id); refresh(); }, 50));
        return;
      }
      refresh();
    });
    chk.addEventListener('change', refresh);
    llenar(r0 ? r0.id : '');
    refresh();
    const el = h('div', h('label.check', chk, 'Lo vendió un revendedor'), box);
    return {
      el, refresh,
      leer: () => {
        if (!chk.checked) return null;
        const x = cat.revendedores.find((r) => r._id === sel.value) || (r0 && r0.id === sel.value ? r0 : null);
        if (!x) throw new Error('Elegí el revendedor o destildá «Lo vendió un revendedor».');
        if (!(num(monto.value) > 0)) throw new Error('Poné el monto de la comisión del revendedor.');
        return { id: sel.value, nombre: x.nombre, comisionMonto: num(monto.value), comisionMoneda: mon.value === 'ARS' ? 'ARS' : 'USD' };
      },
    };
  }

  /* ----- En la venta: elegir el cliente del catálogo o crear uno nuevo ----- */
  function clientePicker(o, onElegir) {
    let clienteId = (o && o.clienteId) || '';
    const inp = h('input', { type: 'search', placeholder: 'Buscar por nombre, club, teléfono o mail…', autocomplete: 'off', 'aria-label': 'Buscar cliente en el catálogo' });
    const res = h('div.list', { hidden: true, style: { margin: '8px 0 0' } });
    const chip = h('div');
    const pintarChip = () => {
      const x = cat.clientes.find((c) => c._id === clienteId);
      chip.replaceChildren(clienteId
        ? h('div.cliente-elegido', icon('check'), h('div.grow', h('b', x ? catNombre('clientes', x) : 'Cliente del catálogo'), h('div.small.muted', 'Del catálogo. Si cambiás algún dato, se actualiza en el catálogo y en sus otras obras.')),
          h('button.btn.small.ghost', { type: 'button', onclick: () => { clienteId = ''; pintarChip(); onElegir(null); } }, 'Es otro'))
        : h('p.small.muted', { style: { margin: '6px 0 0' } }, 'Si no está, completá los datos de abajo y se agrega solo al catálogo.'));
      inp.parentNode && (inp.parentNode.hidden = !!clienteId);
    };
    inp.addEventListener('input', () => {
      const q = norm(inp.value.trim());
      const dig = q.replace(/\D/g, '');
      const items = q.length < 2 ? [] : cat.clientes.filter((x) => x.activo !== false).filter((x) => {
        const t = norm([x.club, x.clienteNombre, x.cuit, ...(x.contactos || []).flatMap((c) => [c.valor, c.quien])].join(' '));
        return q.split(/\s+/).every((w) => t.includes(w)) || (dig.length >= 4 && (x.contactos || []).some((c) => String(c.valor).replace(/\D/g, '').includes(dig)));
      }).slice(0, 8);
      res.hidden = !items.length;
      res.replaceChildren(...items.map((x) => h('div.item', { onclick: () => { clienteId = x._id; inp.value = ''; res.hidden = true; pintarChip(); onElegir(x); } },
        h('div.grow', { style: { minWidth: 0 } }, h('div.ellipsis', { style: { fontWeight: 600 } }, catNombre('clientes', x)), h('div.small.muted.ellipsis', catSub('clientes', x))), icon('chev'))));
    });
    const el = h('div.field', h('span', 'Cliente del catálogo'), h('div', inp, res), chip);
    pintarChip();
    return { el, id: () => clienteId, setId: (id) => { clienteId = id; pintarChip(); } };
  }

  // Teléfonos y mails del cliente, cada uno con de quién es (ej: «Juan, dueño», «Pepe, encargado»).
  function contactosEditor(lista) {
    const rows = h('div');
    const add = (c = {}) => {
      const mail = c.tipo === 'mail';
      const valor = h('input', { type: mail ? 'email' : 'tel', inputMode: mail ? 'email' : 'tel', placeholder: mail ? 'mail@ejemplo.com' : 'Ej: 11 5555 5555', autocomplete: 'off', 'aria-label': mail ? 'Mail' : 'Teléfono' });
      const quien = h('input', { type: 'text', placeholder: 'De quién', autocomplete: 'off', 'aria-label': 'De quién es' });
      valor.value = c.valor || '';
      quien.value = c.quien || '';
      const row = h('div.contacto',
        h('span.contacto-ico', icon(mail ? 'mail' : 'phone')), valor, quien,
        h('button.btn.small.ghost', { type: 'button', 'aria-label': 'Quitar', onclick: () => row.remove() }, icon('trash')));
      row.leer = () => ({ id: c.id || uid(), tipo: mail ? 'mail' : 'tel', valor: valor.value.trim(), quien: quien.value.trim() });
      row.dataset.tipo = mail ? 'mail' : 'tel';
      // Los teléfonos quedan juntos y los mails juntos.
      const ultimo = [...rows.children].filter((r) => r.dataset.tipo === row.dataset.tipo).pop();
      if (ultimo) ultimo.after(row);
      else if (mail) rows.append(row);
      else rows.prepend(row);
      return valor;
    };
    const cargar = (l) => {
      rows.replaceChildren();
      l.forEach(add);
      if (!l.some((c) => c.tipo !== 'mail')) add({ tipo: 'tel' });
      if (!l.some((c) => c.tipo === 'mail')) add({ tipo: 'mail' });
    };
    cargar(lista);
    const el = h('div.field',
      h('span', 'Teléfonos y mails'),
      rows,
      h('p.small.muted', { style: { margin: '-2px 0 8px' } }, 'En «de quién» poné el nombre y qué es. Ej: Juan, dueño · Pepe, encargado.'),
      h('div.row', { style: { gap: '8px' } },
        h('button.btn.small', { type: 'button', onclick: () => add({ tipo: 'tel' }).focus() }, icon('plus'), 'Otro teléfono'),
        h('button.btn.small', { type: 'button', onclick: () => add({ tipo: 'mail' }).focus() }, icon('plus'), 'Otro mail')));
    return { el, set: cargar, leer: () => [...rows.children].map((r) => r.leer()).filter((c) => c.valor) };
  }

  // Archivos adjuntos (planos y comprobantes): foto (se achica) o PDF de hasta ~650 KB, guardados como texto.
  const ARCHIVO_MAX = 880000; // largo máximo en base64 (~650 KB), para que entre en un documento
  async function leerArchivo(file) {
    if (/^image\//.test(file.type)) return { nombre: file.name, mime: 'image/jpeg', data: await UI.compressImage(file, 2400, 0.82, 650000) };
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(new Error('No se pudo leer el PDF.'));
        r.readAsDataURL(file);
      });
      if (data.length > ARCHIVO_MAX) throw new Error(`«${file.name}» pesa más de 650 KB. Achicalo o sacale una foto.`);
      return { nombre: file.name, mime: 'application/pdf', data };
    }
    throw new Error(`«${file.name}» no es una foto ni un PDF.`);
  }

  // Lista de adjuntos con «Ver» y «Quitar», y botón para agregar. Lo nuevo y lo quitado se guarda al guardar.
  function adjuntosEditor({ existentes, label, boton, ver }) {
    const quitados = new Set();
    const nuevos = [];
    const list = h('div.list', { style: { marginBottom: '8px' } });
    const paint = () => {
      const items = [...existentes.filter((a) => !quitados.has(a._id)), ...nuevos];
      list.hidden = !items.length;
      list.replaceChildren(...items.map((a) => h('div.item', { style: { cursor: 'default', padding: '9px 12px' } },
        icon(a.mime === 'application/pdf' ? 'file' : 'eye'),
        h('div.grow.ellipsis', a.nombre || label, a._id ? null : h('span.muted', ' · nuevo')),
        h('button.btn.small.ghost', { type: 'button', onclick: () => (a.data ? verArchivo(a) : ver(a)) }, 'Ver'),
        h('button.btn.small.ghost', { type: 'button', 'aria-label': 'Quitar', onclick: () => { if (a._id) quitados.add(a._id); else nuevos.splice(nuevos.indexOf(a), 1); paint(); } }, icon('trash')))));
    };
    const agregar = () => {
      const inp = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, style: { display: 'none' } });
      inp.addEventListener('change', async () => {
        for (const file of [...inp.files]) {
          try { nuevos.push(await leerArchivo(file)); } catch (e) { UI.toast(e.message, 6000); }
        }
        inp.remove();
        paint();
      });
      document.body.append(inp);
      inp.click();
    };
    paint();
    return { el: h('div.field', h('span', label), list, h('button.btn.small', { type: 'button', onclick: agregar }, icon('clip'), boton)), nuevos, quitados };
  }

  /*
   * La cancha en la venta: tipo, formato, medidas, césped del catálogo, blanco (con su desglose),
   * bicolor y qué incluye. onCambio(k) avisa cada vez que cambia algo (para la garantía y el plano).
   */
  function canchaEditor(o, onCambio) {
    const d0 = o ? datosCanchaDe(o) : { tipo: 'futbol', formato: 'F5', cantidad: 1, demarcacion: 'simple', color: 'mono', incluye: {} };
    const def = defaultsBlanco();
    const n0 = (x) => (num(x) ? fmtNum(num(x)) : '');
    const sel = (name, value, options) => UI.field({ label: '', name, type: 'select', value, options });
    const tiposOpts = Object.entries(TIPOS).filter(([k, t]) => !t.oculto || k === d0.tipo).map(([k, t]) => [k, t.nombre]);

    const tipoF = UI.field({ label: 'Tipo', name: 'tipo', type: 'select', value: d0.tipo, options: tiposOpts });
    const cantF = UI.field({ label: 'Canchas', name: 'cantidad', type: 'number', inputMode: 'numeric', value: d0.cantidad || 1 });
    const formatoF = UI.field({ label: 'Formato', name: 'formato', type: 'select', value: d0.formato || 'F5', options: Object.entries(window.OBRAS_FORMATOS).map(([k, f]) => [k, `${k} · ${f.nombre}`]) });
    const anchoF = UI.field({ label: 'Ancho (m)', name: 'ancho', value: n0(d0.ancho) });
    const largoF = UI.field({ label: 'Largo (m)', name: 'largo', value: n0(d0.largo) });
    const padelF = UI.field({ label: 'm² por cancha', name: 'm2Padel', value: n0(d0.m2Padel) || fmtNum(padelM2Default()) });
    const m2F = UI.field({ label: 'm²', name: 'm2Manual', value: n0(d0.m2Manual) });
    const cespedF = UI.field({ label: 'Tipo de césped', name: 'cespedId', type: 'select', value: '', options: [] });
    const cespedOtroF = UI.field({ label: 'Cuál', name: 'cespedOtro', value: d0.cespedOtro || '', placeholder: 'Modelo y altura' });
    const alturaF = UI.field({ label: 'Altura', name: 'altura', type: 'select', value: '', options: [] });
    const colorF = UI.field({ label: 'Color', name: 'color', type: 'select', value: d0.color || 'mono', options: [['mono', 'Monocolor'], ['bicolor', 'Bicolor']] });
    const coloresF = UI.field({ label: 'Colores', name: 'colores', value: d0.colores || '', placeholder: 'Ej: verde y blanco' });
    const bicolorF = UI.field({ label: 'm² extra por desperdicio bicolor', name: 'bicolorExtra', value: n0(d0.bicolorExtra), placeholder: 'A mano, por cancha' });
    const colocaF = UI.field({ label: 'El cliente coloca la arena', name: 'clienteColocaArena', type: 'select', value: d0.clienteColocaArena ? 'si' : 'no', options: [['no', 'No'], ['si', 'Sí']] });
    const demF = UI.field({ label: 'Demarcación', name: 'demarcacion', type: 'select', value: d0.demarcacion || 'simple', options: [['simple', 'Simple'], ['doble', 'Doble']] });
    const sF = UI.field({ label: 'Separación al borde (m)', name: 's', value: d0.s != null && d0.s !== '' ? fmtNum(num(d0.s)) : fmtNum(def.s) });
    const lineaF = UI.field({ label: 'Ancho de línea (cm)', name: 'anchoLineaCm', value: d0.anchoLineaCm != null && d0.anchoLineaCm !== '' ? fmtNum(num(d0.anchoLineaCm)) : fmtNum(def.anchoLineaCm) });
    const despF = UI.field({ label: 'Desperdicio (%)', name: 'desperdicio', value: d0.desperdicio != null && d0.desperdicio !== '' ? fmtNum(num(d0.desperdicio)) : fmtNum(def.desperdicio) });
    const mlExtraF = UI.field({ label: 'ml extra de la otra demarcación (según plano)', name: 'mlExtra', value: n0(d0.mlExtra) });
    const blancoManualF = UI.field({ label: 'Blanco (m² por cancha)', name: 'blancoManual', value: n0(d0.blancoManual) });
    [anchoF, largoF, padelF, m2F, bicolorF, sF, lineaF, despF, mlExtraF, blancoManualF].forEach((f) => numeroInput(f.querySelector('input')));
    const q = (f) => f.querySelector('input,select');
    const wrap = (...x) => h('div', ...x);

    const tomasNota = h('div.aviso', 'F8, F9 y F11: el blanco no se calcula. Pedir blanco a Tomás y cargarlo cuando lo pase. El plano es obligatorio.');
    const desglose = h('div.calc');
    const paramsBox = h('details.parametros', h('summary.small', 'Parámetros del blanco (separación, ancho de línea, desperdicio)'), fila2(sF, lineaF), despF);
    const blancoBox = h('div.cancha-bloque',
      h('div.field-title', 'Blanco (césped blanco de las líneas)'),
      demF, tomasNota, wrap(blancoManualF), paramsBox, wrap(mlExtraF), desglose);
    const multiNota = h('div.aviso', 'Multisport en residencial lleva arena (40 kg/m²). Sin arena no tiene garantía.');
    const multiBox = h('div', multiNota, colocaF);
    const m2Box = h('div.calc');

    // Qué incluye: una fila por ítem con cantidad, quién lo provee y envío.
    const filas = {};
    const incBox = h('div.list.incluye');
    for (const it of window.OBRAS_INCLUYE) {
      const x0 = (d0.incluye || {})[it.id] || {};
      const prov = sel(`inc_${it.id}_provee`, it.id === 'cesped' ? 'slavon' : x0.provee || (it.id === 'arena' || it.id === 'caucho' ? window.OBRAS_PROVEE[it.id] : 'slavon'), [['slavon', it.id === 'instalacion' ? 'La hace Slavon' : 'Slavon'], ['cliente', it.id === 'instalacion' ? 'A cargo del cliente' : 'Cliente']]);
      if (it.id === 'cesped') q(prov).disabled = true;
      const envio = it.sinEnvio ? null : h('label.envio', h('span.small.muted', 'Envío'), h('select', { name: `inc_${it.id}_envio` },
        ENVIOS.map(([val, txt]) => h('option', { value: val, selected: val === envioNorm((d0.envios || {})[it.id] ?? x0.envio) }, txt))));
      let cant = null;
      let recalcular = null;
      if (it.id === 'arena' || it.id === 'caucho') {
        cant = numeroInput(h('input', { name: `inc_${it.id}_cantidad`, value: x0.auto === false && num(x0.cantidad) ? fmtNum(num(x0.cantidad)) : '', 'aria-label': `${it.nombre} (kg)` }));
        cant.dataset.auto = x0.auto === false ? 'no' : 'si';
        cant.addEventListener('input', () => { cant.dataset.auto = cant.value ? 'no' : 'si'; });
        recalcular = h('button.btn.small.ghost', { type: 'button', onclick: () => { cant.dataset.auto = 'si'; refresh(); } }, 'Recalcular');
      }
      const info = h('span.small.muted');
      const row = h('div.item.incluye-row', { style: { cursor: 'default' } },
        h('div.incluye-a', h('b', it.nombre), cant ? h('span.incluye-cant', cant, h('span.small.muted', ' kg')) : null, info, recalcular),
        h('div.incluye-b', prov, envio));
      filas[it.id] = { row, prov: q(prov), envio: envio && envio.querySelector('select'), cant, info, recalcular };
      incBox.append(row);
    }
    const soloCesped = h('button.btn.small', { type: 'button', onclick: () => {
      for (const [id, f] of Object.entries(filas)) {
        if (id === 'cesped') continue;
        f.prov.value = 'cliente';
        if (f.envio) f.envio.value = 'no';
      }
      refresh();
    } }, 'Solo césped');
    const sinGarantiaNota = h('div.aviso.rojo', 'SIN GARANTÍA: la instalación está a cargo del cliente. La garantía queda en 0 y se deja escrito en la venta y en el acta.');

    const el = h('div',
      h('div.row', { style: { gap: '10px', alignItems: 'flex-start' } }, h('div.grow', tipoF), h('div', { style: { width: '30%' } }, cantF)),
      wrap(formatoF),
      wrap(fila2(anchoF, largoF)),
      wrap(padelF),
      wrap(m2F),
      cespedF, wrap(cespedOtroF), wrap(alturaF),
      wrap(fila2(colorF, coloresF)), wrap(bicolorF),
      multiBox,
      blancoBox,
      m2Box,
      h('div.row', { style: { margin: '6px 0 8px' } }, h('div.field-title.grow', { style: { margin: 0 } }, 'Qué incluye'), soloCesped),
      incBox,
      sinGarantiaNota);

    const cespedSel = q(cespedF);
    const tipoSel = q(tipoF);
    const llenarCesped = () => {
      const lista = cespedesDe(tipoSel.value, d0.cespedId);
      const actual = cespedSel.value || d0.cespedId || '';
      const elegido = lista.some((x) => x._id === actual) ? actual : actual === 'otro' || !lista.length ? 'otro' : lista[0]._id;
      cespedSel.replaceChildren(...lista.map((x) => h('option', { value: x._id }, x.nombre + (x.alturaMm ? ` · ${x.alturaMm} mm` : ''))),
        h('option', { value: 'otro' }, lista.length ? 'Otro (especificar)' : 'Escribir el modelo'));
      cespedSel.value = elegido;
    };
    const llenarAltura = () => {
      const m = cespedDe(cespedSel.value);
      const alturas = (m && m.alturas) || [];
      const a = q(alturaF);
      const actual = num(a.value) || num(d0.altura);
      a.replaceChildren(...alturas.map((x) => h('option', { value: x }, x + ' mm')));
      if (alturas.length) a.value = alturas.includes(actual) ? actual : alturas[0];
    };

    const leerInputs = () => {
      const v = UI.values(el);
      const incluye = {};
      const envios = {};
      for (const [id, f] of Object.entries(filas)) {
        incluye[id] = { provee: f.prov.value };
        if (f.envio) envios[id] = f.envio.value;
        if (f.cant) { incluye[id].auto = f.cant.dataset.auto !== 'no'; if (!incluye[id].auto) incluye[id].cantidad = num(f.cant.value); }
      }
      return { ...v, clienteColocaArena: v.clienteColocaArena === 'si', incluye, envios };
    };

    const refresh = () => {
      const t = TIPOS[tipoSel.value] || TIPOS.otro;
      const k = calcularCancha(leerInputs());
      const m = cespedDe(cespedSel.value);
      formatoF.parentNode.hidden = tipoSel.value !== 'futbol';
      anchoF.closest('div.row').parentNode.hidden = t.medida !== 'cancha';
      padelF.parentNode.hidden = t.medida !== 'padel';
      m2F.parentNode.hidden = t.medida !== 'm2';
      cespedOtroF.parentNode.hidden = cespedSel.value !== 'otro';
      alturaF.parentNode.hidden = !(m && m.alturas && m.alturas.length);
      colorF.querySelector('select').disabled = !!m && !m.admiteBicolor;
      if (m && !m.admiteBicolor) colorF.querySelector('select').value = 'mono';
      bicolorF.parentNode.hidden = !k.bicolor;
      multiBox.hidden = !k.multisportResidencial;
      // Blanco
      const b = k.blanco;
      blancoBox.hidden = b.modo !== 'calculo' && b.modo !== 'manual';
      const calcula = b.modo === 'calculo' && !b.manual;
      tomasNota.hidden = !b.pedirATomas;
      blancoManualF.parentNode.hidden = !b.manual;
      blancoManualF.querySelector('span').textContent = b.pedirATomas ? 'Blanco que pasó Tomás (m² por cancha)' : 'Blanco (m² por cancha, a mano)';
      paramsBox.hidden = !calcula;
      mlExtraF.parentNode.hidden = !(calcula && b.demarcacion === 'doble');
      desglose.hidden = !calcula;
      if (calcula) {
        const r = b.desglose;
        desglose.replaceChildren(...(r ? [
          h('div', `Perímetro 2 × [(${fmtNum(k.ancho)} − ${fmtNum(2 * b.s)}) + (${fmtNum(k.largo)} − ${fmtNum(2 * b.s)})] = ${fmtNum(r.perimetro)} ml`),
          h('div', `Línea del medio ${fmtNum(r.medio)} ml · áreas ${k.formato} ${fmtNum(r.areas)} ml${r.extra ? ` · extra ${fmtNum(r.extra)} ml` : ''}`),
          h('div', `${fmtNum(r.ml)} ml × ${fmtNum(b.anchoLineaCm / 100)} m = ${m2Texto(r.m2Neto)} + ${fmtNum(b.desperdicio)} % de desperdicio`),
          h('b', `Blanco: ${m2Texto(r.m2)} por cancha`),
        ] : [h('div', 'Cargá ancho y largo para calcular el blanco.')]));
      }
      // m² de césped
      const partes = [];
      if (t.medida === 'cancha') {
        partes.push(h('div', k.ancho && k.largo ? `Superficie ${fmtNum(k.ancho)} × ${fmtNum(k.largo)} = ${m2Texto(k.ancho * k.largo)}${num(b.m2) ? ` + blanco ${m2Texto(b.m2)}` : ''}${k.bicolorExtraM2 ? ` + bicolor ${m2Texto(k.bicolorExtraM2)}` : ''} = ${m2Texto(k.m2PorCancha)}${k.cantidad > 1 ? ' por cancha' : ''}` : 'Cargá ancho y largo para calcular los m².'));
      } else if (t.medida === 'padel') {
        partes.push(h('div', `${m2Texto(k.m2Padel)} por cancha · blanco incluido`));
      }
      if (k.m2) partes.push(h('b', `Césped: ${m2Texto(k.m2)}${k.cantidad > 1 && t.medida !== 'm2' ? ` (${k.cantidad} canchas)` : ''}`));
      m2Box.replaceChildren(...partes);
      m2Box.hidden = !partes.length;
      // Qué incluye
      for (const [id, f] of Object.entries(filas)) {
        const x = k.incluye[id];
        f.row.hidden = !x.aplica;
        if (id === 'cesped') f.info.textContent = k.m2 ? ' ' + m2Texto(k.m2) : ' Falta la medida';
        else if (id === 'blanco') f.info.textContent = num(x.cantidad) ? ' ' + m2Texto(x.cantidad) : b.pedirATomas ? ' Pedir a Tomás' : ' Sin cargar';
        else if (id === 'pegamento' || id === 'cinta') f.info.textContent = ' La cantidad la carga Entregas';
        else if (f.cant) {
          if (f.cant.dataset.auto !== 'no') f.cant.value = num(x.cantidad) ? fmtNum(num(x.cantidad)) : '';
          f.info.textContent = m ? ` ${fmtNum(num(id === 'arena' ? m.arenaKgM2 : m.cauchoKgM2))} kg/m² × ${m2Texto(k.superficie)}${f.cant.dataset.auto === 'no' ? ' · corregido a mano' : ''}` : '';
          f.recalcular.hidden = f.cant.dataset.auto !== 'no';
        }
      }
      sinGarantiaNota.hidden = !k.sinGarantia;
      if (onCambio) onCambio(k);
      return k;
    };

    tipoSel.addEventListener('change', () => {
      if ((TIPOS[tipoSel.value] || {}).medida === 'padel' && !q(padelF).value) q(padelF).value = fmtNum(padelM2Default());
      llenarCesped();
      llenarAltura();
      for (const id of ['arena', 'caucho']) if (filas[id].cant) filas[id].cant.dataset.auto = 'si';
      refresh();
    });
    cespedSel.addEventListener('change', () => { llenarAltura(); for (const id of ['arena', 'caucho']) filas[id].cant.dataset.auto = 'si'; refresh(); });
    el.addEventListener('input', () => refresh());
    el.addEventListener('change', () => refresh());
    llenarCesped();
    llenarAltura();
    return { el, refresh, leer: () => calcularCancha(leerInputs()) };
  }

  // Planos: se suben al almacenamiento de archivos (Firebase Storage); en la obra queda el link, el nombre y la fecha.
  const PLANO_MAX_MB = 15;
  // Foto (se achica un poco y sigue legible) o PDF, listo para subir al almacenamiento de archivos (planos y remitos).
  async function archivoParaSubir(file) {
    const id = uid() + uid();
    if (/^image\//.test(file.type)) {
      const b64 = await UI.compressImage(file, 3200, 0.85, 3000000);
      return { id, nombre: file.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', blob: b64Blob(b64, 'image/jpeg') };
    }
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      if (file.size > PLANO_MAX_MB * 1024 * 1024) throw new Error(`«${file.name}» pesa más de ${PLANO_MAX_MB} MB.`);
      return { id, nombre: file.name, mime: 'application/pdf', blob: file };
    }
    throw new Error(`«${file.name}» no es una foto ni un PDF.`);
  }
  function elegirArchivos(fn) {
    const inp = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, style: { display: 'none' } });
    inp.addEventListener('change', async () => { const files = [...inp.files]; inp.remove(); await fn(files); });
    document.body.append(inp);
    inp.click();
  }
  // Nombre de archivo sin acentos ni caracteres raros, para la ruta en el almacenamiento.
  const nombreSeguro = (n) => String(n || 'archivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);

  function planosEditor(o, onCambio) {
    const existentes = (o && o.planos) || [];
    const quitados = new Set();
    const nuevos = [];
    const list = h('div.list', { style: { marginBottom: '8px' } });
    const obligatorio = h('span.badge.red', { style: { marginLeft: '6px' } }, 'Obligatorio');
    const nota = h('p.small', { style: { margin: '-4px 0 10px', color: 'var(--red)', fontWeight: 600 } });
    const paint = () => {
      const items = [...existentes.filter((p) => !quitados.has(p.id)), ...nuevos];
      list.hidden = !items.length;
      list.replaceChildren(...items.map((p) => h('div.item', { style: { cursor: 'default', padding: '9px 12px' } },
        icon(p.mime === 'application/pdf' ? 'file' : 'eye'),
        h('div.grow.ellipsis', p.nombre || 'Plano', p.blob ? h('span.muted', ' · nuevo') : h('span.muted', ' · ' + UI.fmtDay((p.fecha || '').slice(0, 10)))),
        h('button.btn.small.ghost', { type: 'button', onclick: () => (p.blob ? window.open(URL.createObjectURL(p.blob), '_blank') : verPlano(p)) }, 'Ver'),
        h('button.btn.small.ghost', { type: 'button', 'aria-label': 'Quitar', onclick: () => { if (p.blob) nuevos.splice(nuevos.indexOf(p), 1); else quitados.add(p.id); paint(); if (onCambio) onCambio(); } }, icon('trash')))));
    };
    const agregar = () => elegirArchivos(async (files) => {
      for (const file of files) {
        try { nuevos.push(await archivoParaSubir(file)); } catch (e) { UI.toast(e.message, 6000); }
      }
      paint();
      if (onCambio) onCambio();
    });
    paint();
    const titulo = h('span', 'Plano');
    return {
      el: h('div.field', h('div.row', { style: { gap: 0 } }, titulo, obligatorio), list, nota, h('button.btn.small', { type: 'button', onclick: agregar }, icon('clip'), 'Adjuntar plano (foto o PDF)')),
      cantidad: () => existentes.filter((p) => !quitados.has(p.id)).length + nuevos.length,
      marcar: (requiere, porque) => {
        obligatorio.hidden = !requiere;
        const falta = requiere && !(existentes.filter((p) => !quitados.has(p.id)).length + nuevos.length);
        nota.hidden = !falta;
        nota.textContent = falta ? `Falta el plano (obligatorio en ${porque}). Se puede guardar, pero no pasa a Entregas hasta adjuntarlo.` : '';
      },
      // Sube los nuevos y devuelve la lista para guardar en la obra, y los archivos a borrar.
      async guardar(obraId) {
        const subidos = [];
        for (const p of nuevos) {
          const path = `obras/${obraId}/planos/${p.id}-${nombreSeguro(p.nombre)}`;
          const url = await cloud.upload(path, p.blob, p.mime);
          subidos.push({ id: p.id, nombre: p.nombre, mime: p.mime, path, url, tamano: p.blob.size, fecha: new Date().toISOString(), por: me.email, porNombre: me.nombre });
        }
        return { planos: [...existentes.filter((p) => !quitados.has(p.id)), ...subidos], borrar: existentes.filter((p) => quitados.has(p.id)).map((p) => p.path) };
      },
    };
  }

  // Tributos incluidos en el precio (percepciones u otros): nombre y monto.
  function tributosEditor(lista) {
    const rows = h('div');
    const add = (t = {}) => {
      const nombre = h('input', { type: 'text', placeholder: 'Ej: Percepción IIBB', autocomplete: 'off', 'aria-label': 'Tributo' });
      nombre.value = t.nombre || '';
      const monto = numeroInput(h('input', { type: 'text', placeholder: 'Monto', 'aria-label': 'Monto del tributo' }));
      monto.value = num(t.monto) ? fmtNum(num(t.monto)) : '';
      const row = h('div.tributo', nombre, monto, h('button.btn.small.ghost', { type: 'button', 'aria-label': 'Quitar', onclick: () => row.remove() }, icon('trash')));
      row.leer = () => ({ id: t.id || uid(), nombre: nombre.value.trim(), monto: num(monto.value) });
      rows.append(row);
      return nombre;
    };
    lista.forEach(add);
    const el = h('div.field', h('span', 'Tributos (percepciones u otros)'), rows,
      h('button.btn.small', { type: 'button', onclick: () => add().focus() }, icon('plus'), 'Agregar tributo'),
      h('p.small.muted', { style: { margin: '6px 0 0' } }, 'Incluidos en el precio total (no se suman).'));
    return { el, leer: () => [...rows.children].map((r) => r.leer()).filter((t) => t.nombre || t.monto) };
  }

  function editObra(o) {
    if (!canVenta) return;
    const isNew = !o;
    const v = (o && ventas[o._id]) || {};
    const hayPagos = !!(o && (pagosPorObra[o._id] || []).length);
    const contactos = contactosEditor(o ? contactosDe(o) : []);
    const planosEd = planosEditor(o, () => cancha.refresh());
    let body = null;
    const clientePk = clientePicker(o, (x) => {
      if (!x) return;
      $('clienteNombre').value = x.clienteNombre || '';
      $('club').value = x.club || '';
      contactos.set(x.contactos || []);
    });
    const vendPk = vendedoresPicker(v);
    let leerPrecio = () => ({ monto: precioDe(v), moneda: monedaDe(v) }); // se reemplaza cuando el formulario está armado
    const revPk = revendedorPicker(v, () => leerPrecio());
    const fila = (...campos) => h('div.row', { style: { gap: '10px', alignItems: 'flex-start' } }, campos.map((c) => h('div.grow', { style: { minWidth: 0 } }, c)));
    const n0 = (x) => (num(x) ? fmtNum(num(x)) : '');

    /* --- La cancha (tipo, medidas, césped, blanco, qué incluye) --- */
    let garantiaAntes = null; // la garantía cargada, para devolverla si se vuelve a «instalación Slavon»
    const cancha = canchaEditor(o, (k) => {
      const g = body && body.querySelector('[name=garantiaAnios]');
      if (g) {
        if (k.sinGarantia && !g.disabled) { garantiaAntes = g.value; g.value = '0'; g.disabled = true; }
        if (!k.sinGarantia && g.disabled) { g.disabled = false; g.value = garantiaAntes && garantiaAntes !== '0' ? garantiaAntes : ''; }
        garantiaNota.hidden = !k.sinGarantia;
      }
      planosEd.marcar(requierePlano(k), porQuePlano(k));
    });
    const garantiaNota = h('p.small', { style: { marginTop: '-8px', color: 'var(--red)', fontWeight: 600 }, hidden: true }, 'Sin garantía: la instalación está a cargo del cliente.');

    /* --- Plazo, garantía y plata --- */
    const plazoF = UI.field({ label: 'Plazo', name: 'plazo', type: 'select', value: (o && o.plazo) || 'inmediata', options: Object.entries(window.OBRAS_PLAZOS).map(([k, p]) => [k, p.nombre]) });
    const plazoOtroF = UI.field({ label: 'Cuál', name: 'plazoOtro', value: o ? o.plazoOtro || '' : '', placeholder: 'Ej: 45 días · cuando el cliente termine la base' });
    const gm = o ? garantiaMesesDe(o) : 0;
    const formaF = UI.field({ label: 'Forma de pago', name: 'formaPago', type: 'select', value: v.formaPago || 'contado', options: [['contado', 'Contado (saldo antes de la entrega)'], ['financiado', 'Financiado (contrato firmado antes de la entrega)']] });
    const monedaF = UI.field({ label: 'Moneda', name: 'moneda', type: 'select', value: monedaDe(v), options: [['USD', 'US$'], ['ARS', '$']] });
    const precioF = UI.field({ label: 'Precio total', name: 'precio', value: n0(precioDe(v)) });
    const senaF = UI.field({ label: 'Seña', name: 'sena', value: n0(senaDe(v)) });
    const senaFechaF = UI.field({ label: 'Fecha de la seña', name: 'senaFecha', type: 'date', value: v.senaFecha || (isNew ? UI.today() : '') });
    [precioF, senaF].forEach((f) => numeroInput(f.querySelector('input')));
    if (hayPagos) monedaF.querySelector('select').disabled = true;
    const fechaVenta0 = (o && o.fechaVenta) || UI.today();
    const cuotasF = UI.field({ label: 'Cuotas', name: 'cuotas', type: 'number', inputMode: 'numeric', value: v.cuotas || 11 });
    const tasaF = UI.field({ label: 'Interés mensual (%)', name: 'tasaMensual', value: fmtNum(v.tasaMensual ?? 1) });
    const primeraF = UI.field({ label: 'Primera cuota', name: 'primeraCuota', type: 'date', value: v.primeraCuota || UI.addMonths(fechaVenta0, 1) });
    numeroInput(tasaF.querySelector('input'));
    const finPrev = h('div.calc');
    const finBox = h('div', h('div.field-title', 'Financiación'), fila(cuotasF, tasaF), primeraF, finPrev);
    let primeraTocada = !!v.primeraCuota;
    primeraF.querySelector('input').addEventListener('input', () => { primeraTocada = true; });

    const chk = (name, label, checked) => h('label.check', h('input', { type: 'checkbox', name, checked }), label);
    // Factura: sin factura, IVA mínimo o IVA total (monto a mano, incluido en el precio), y otros tributos.
    const iva0 = v.iva || { tipo: 'sin', monto: 0 };
    const ivaF = UI.field({ label: 'Factura', name: 'ivaTipo', type: 'select', value: iva0.tipo || 'sin', options: [['sin', 'Sin factura'], ['minimo', 'IVA mínimo'], ['total', 'IVA total']] });
    const ivaMontoF = UI.field({ label: 'Monto del IVA', name: 'ivaMonto', value: num(iva0.monto) ? fmtNum(num(iva0.monto)) : '' });
    numeroInput(ivaMontoF.querySelector('input'));
    const fac0 = v.facturacion || {};
    const aFacturarF = UI.field({ label: 'Monto a facturar (a mano)', name: 'aFacturar', value: num(fac0.aFacturar) ? fmtNum(num(fac0.aFacturar)) : '' });
    numeroInput(aFacturarF.querySelector('input'));
    const ivaBox = h('div', ivaMontoF, h('p.small.muted', { style: { marginTop: '-8px' } }, 'Incluido en el precio total (no se suma).'), aFacturarF,
      h('p.small.muted', { style: { marginTop: '-8px' } }, 'Con esto se calcula el saldo pendiente de facturar en Administración.'));
    const tributos = tributosEditor(v.tributos || []);

    body = h('div',
      h('h3', { style: { margin: '0 0 10px' } }, 'Cliente'),
      clientePk.el,
      fila(
        UI.field({ label: 'Nombre del cliente', name: 'clienteNombre', value: o ? clienteNombreDe(o) : '', placeholder: 'Ej: Juan Pérez' }),
        UI.field({ label: 'Club', name: 'club', value: o ? o.club || '' : '', placeholder: 'Ej: Club Huracán' })),
      h('p.small.muted', { style: { marginTop: '-8px' } }, 'Con uno alcanza. Si tenés los dos, cargá los dos.'),
      contactos.el,
      UI.field({ label: 'Ubicación', name: 'ubicacion', value: o ? o.ubicacion : '', placeholder: 'Dirección o localidad' }),
      chk('interior', 'Obra en el interior (viaja el instalador)', !!(o && o.interior)),

      h('h3', { style: { margin: '18px 0 10px' } }, 'La cancha'),
      UI.field({ label: 'Nombre de la obra', name: 'nombre', value: o ? o.nombre : '', placeholder: 'Si queda vacío: club o cliente + tipo' }),
      cancha.el,
      planosEd.el,
      UI.field({ label: 'Consideraciones especiales', name: 'consideraciones', type: 'textarea', value: o ? o.consideraciones : '', placeholder: 'Ej: base de hormigón existente, acceso angosto' }),
      isNew ? null : h('p.small.muted', 'Cambiar el tipo o lo que incluye no cambia las etapas ya armadas: para eso usá «Editar etapas».'),

      h('h3', { style: { margin: '18px 0 10px' } }, 'Vendedor'),
      vendPk.el,
      revPk.el,

      h('h3', { style: { margin: '18px 0 10px' } }, 'Venta'),
      fila(
        UI.field({ label: 'Fecha de venta', name: 'fechaVenta', type: 'date', value: o ? o.fechaVenta : UI.today() }),
        UI.field({ label: 'N° de pedido (opcional)', name: 'pedido', value: o ? o.pedido || '' : '', placeholder: 'Ej: 1234' })),
      plazoF,
      h('div', plazoOtroF),
      chk('conStock', 'Con stock (sale de stock, no se fabrica)', !!(o && o.conStock)),
      fila(
        UI.field({ label: 'Fecha de entrega estimada', name: 'fechaEntrega', type: 'date', value: o ? o.fechaEntrega : UI.addDays(UI.today(), 5) }),
        UI.field({ label: 'Garantía (años)', name: 'garantiaAnios', inputMode: 'decimal', value: gm ? String(CALC.round2(gm / 12)).replace('.', ',') : '', placeholder: 'Ej: 2' })),
      garantiaNota,
      formaF,
      h('div.row', { style: { gap: '10px', alignItems: 'flex-start' } }, h('div', { style: { width: '34%' } }, monedaF), h('div.grow', precioF)),
      hayPagos ? h('p.small.muted', { style: { marginTop: '-8px' } }, 'Ya hay pagos registrados: la moneda no se puede cambiar.') : null,
      ivaF,
      ivaBox,
      tributos.el,
      fila(senaF, senaFechaF),
      finBox,
      UI.field({ label: 'Notas de la venta', name: 'notasVenta', type: 'textarea', value: v.notasVenta || '', placeholder: 'Sólo la ven admin y administración' }),

      h('h3', { style: { margin: '18px 0 10px' } }, 'Otras notas'),
      UI.field({ label: 'Notas de la obra', name: 'notas', type: 'textarea', value: o ? o.notas : '', placeholder: 'Las ven todos, también los encargados de obra' }),
      h('p.small.muted', 'Con cliente o club, precio y fecha de entrega la venta queda completa y pasa sola a Administración.'));

    const $ = (n) => body.querySelector(`[name=${n}]`);
    leerPrecio = () => ({ monto: num($('precio').value), moneda: $('moneda').value === 'ARS' ? 'ARS' : 'USD' });

    // Recalcula lo que depende de otros campos: plazo, IVA, comisión y cuotas (la cancha se recalcula sola).
    const refresh = () => {
      const val = UI.values(body);
      plazoOtroF.parentNode.hidden = val.plazo !== 'otro';
      revPk.refresh();
      ivaBox.hidden = val.ivaTipo === 'sin';
      ivaMontoF.querySelector('span').textContent = `Monto del ${val.ivaTipo === 'total' ? 'IVA total' : 'IVA mínimo'} (${val.moneda === 'ARS' ? '$' : 'US$'})`;

      const fin = val.formaPago === 'financiado';
      const moneda = val.moneda === 'ARS' ? 'ARS' : 'USD';
      const signo = moneda === 'ARS' ? '$' : 'US$';
      precioF.querySelector('span').textContent = `Precio total (${signo})`;
      senaF.querySelector('span').textContent = `${fin ? 'Anticipo' : 'Seña'} (${signo})`;
      senaFechaF.querySelector('span').textContent = fin ? 'Fecha del anticipo' : 'Fecha de la seña';
      finBox.hidden = !fin;
      if (fin) {
        const precio = num(val.precio);
        const sena = num(val.sena);
        const plan = CALC.planCuotas({ saldo: Math.max(0, precio - sena), cuotas: val.cuotas, tasa: val.tasaMensual === '' ? 0 : val.tasaMensual, primera: val.primeraCuota });
        const M = (n) => CALC.money(n, moneda);
        finPrev.replaceChildren(...(precio ? [
          h('div', `Saldo ${M(plan.saldo)} + ${fmtNum(plan.tasaTotal)} % de interés (${M(plan.interes)}) = ${M(plan.total)}`),
          h('b', `${plan.cantidad} cuotas de ${M(plan.cuota)}`),
          h('div.cuotas-mini', plan.cuotas.map((q) => h('div', h('span.muted', `${q.n}. ${UI.fmtDay(q.fecha) || '—'}`), ' ', M(q.monto)))),
        ] : [h('div', 'Poné el precio para ver las cuotas.')]));
      }
    };
    body.addEventListener('input', refresh);
    body.addEventListener('change', refresh);

    // Al cambiar el plazo o la fecha de venta, propone la fecha de entrega (y la de la primera cuota).
    const proponer = () => {
      const p = window.OBRAS_PLAZOS[$('plazo').value];
      if ($('fechaVenta').value && p && p.dias) $('fechaEntrega').value = UI.addDays($('fechaVenta').value, p.dias);
    };
    $('plazo').addEventListener('change', proponer);
    $('fechaVenta').addEventListener('change', () => {
      proponer();
      if (!primeraTocada && $('fechaVenta').value) $('primeraCuota').value = UI.addMonths($('fechaVenta').value, 1);
      refresh();
    });
    refresh();
    cancha.refresh();

    const actions = [{ label: 'Cancelar' }, {
      label: isNew ? 'Cargar venta' : 'Guardar', kind: 'primary', onClick: async () => {
        const val = UI.values(body);
        let club = val.club;
        let clienteNombre = val.clienteNombre;
        if (!club && !clienteNombre) throw new Error('Poné el nombre del cliente o el club (al menos uno).');
        let cts = contactos.leer();
        const malMail = cts.find((c) => c.tipo === 'mail' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.valor));
        if (malMail) throw new Error(`Revisá el mail «${malMail.valor}».`);
        const vendedores = vendPk.leer();
        if (!vendedores.length) throw new Error('Elegí quién vendió.');
        const revendedor = revPk.leer();

        // Cliente: el del catálogo (se actualiza con lo cargado acá) o uno nuevo, avisando si ya hay uno parecido.
        let clienteId = clientePk.id();
        const opsCliente = [];
        if (!clienteId) {
          const par = clienteParecido(club, clienteNombre, cts);
          if (par) {
            const r = await elegir('¿Es el mismo cliente?', `En el catálogo ya está «${catNombre('clientes', par)}» (${catSub('clientes', par)}).`, [['nuevo', 'Es otro, crear nuevo'], ['usar', 'Usar ese', 'primary']]);
            if (!r) return false;
            if (r === 'usar') {
              clienteId = par._id;
              clienteNombre = clienteNombre || par.clienteNombre || '';
              club = club || par.club || '';
              cts = [...(par.contactos || []), ...cts.filter((c) => !(par.contactos || []).some((pc) => norm(pc.valor) === norm(c.valor)))];
            }
          }
        }
        const datosCliente = { clienteNombre, club, nombre: clienteTexto(club, clienteNombre), contactos: cts };
        if (clienteId) {
          const x = cat.clientes.find((c) => c._id === clienteId);
          if (x && (x.clienteNombre !== clienteNombre || x.club !== club || JSON.stringify(x.contactos || []) !== JSON.stringify(cts))) {
            const docCl = { ...x, ...datosCliente, ...stamp() };
            opsCliente.push({ op: 'set', col: 'clientes', id: clienteId, data: docCl }, ...copiaClienteOps(clienteId, docCl, o && o._id));
          }
        } else {
          clienteId = cloud.newId();
          opsCliente.push({ op: 'set', col: 'clientes', id: clienteId, data: { ...datosCliente, cuit: '', notas: '', activo: true, creadoPor: me.email, creadoPorNombre: me.nombre, creadoEn: cloud.serverTime(), ...stamp() } });
        }
        const precio = num(val.precio);
        const sena = num(val.sena);
        const fin = val.formaPago === 'financiado';
        if (sena > precio && precio) throw new Error(`${fin ? 'El anticipo' : 'La seña'} no puede ser mayor que el precio.`);
        if (fin && !(Math.round(num(val.cuotas)) >= 1)) throw new Error('Poné la cantidad de cuotas.');
        if (val.plazo === 'otro' && !val.plazoOtro) throw new Error('Escribí cuál es el plazo.');
        const k = cancha.leer();
        if (!k.cespedDet.nombre) throw new Error('Elegí el tipo de césped.');
        if (val.ivaTipo !== 'sin' && !num(val.ivaMonto)) throw new Error('Poné el monto del IVA (o elegí «Sin factura»).');
        const tribs = tributos.leer();
        if (tribs.some((t) => !t.nombre || !(t.monto > 0))) throw new Error('Cada tributo necesita nombre y monto.');
        const anios = k.sinGarantia ? 0 : val.garantiaAnios === '' ? '' : num(val.garantiaAnios);
        const { multisportResidencial, ...datosK } = k;
        const obra = {
          nombre: val.nombre || [club || clienteNombre, tipoNombre(k.tipo)].filter(Boolean).join(' – '),
          ...datosK, conStock: !!val.conStock, consideraciones: val.consideraciones,
          clienteId, clienteNombre, club, cliente: clienteTexto(club, clienteNombre), contactos: cts, pedido: val.pedido,
          telefono: (cts.find((c) => c.tipo === 'tel') || {}).valor || '', email: (cts.find((c) => c.tipo === 'mail') || {}).valor || '',
          ubicacion: val.ubicacion, interior: val.interior,
          fechaVenta: val.fechaVenta, plazo: val.plazo, plazoOtro: val.plazo === 'otro' ? val.plazoOtro : '', fechaEntrega: val.fechaEntrega,
          garantiaAnios: anios, garantiaMeses: anios === '' ? '' : CALC.round2(anios * 12),
          notas: val.notas, ...stamp(),
        };
        const venta = {
          moneda: val.moneda === 'ARS' ? 'ARS' : 'USD', precio, sena, senaFecha: val.senaFecha, formaPago: val.formaPago,
          cuotas: fin ? Math.round(num(val.cuotas)) : null, tasaMensual: fin ? (val.tasaMensual === '' ? 0 : num(val.tasaMensual)) : null, primeraCuota: fin ? val.primeraCuota : '',
          vendedores, vendio: vendedores.map((x) => x.nombre).join(', '), revendedor, notasVenta: val.notasVenta,
          iva: { tipo: val.ivaTipo, monto: val.ivaTipo === 'sin' ? 0 : num(val.ivaMonto) }, tributos: tribs,
          facturacion: { ...(v.facturacion || {}), aFacturar: val.ivaTipo === 'sin' ? 0 : val.aFacturar === '' ? '' : num(val.aFacturar) }, ...stamp(),
        };
        // Si con los cambios el total sube y el saldo deja de ser 0, la marca «Saldo cobrado» deja de valer.
        let marcaQuitada = false;
        if (!isNew && v.saldoCobrado) {
          const vNueva = { ...v, ...venta };
          const totalNuevo = esFinanciado(vNueva) ? CALC.round2(senaDe(vNueva) + planDe(vNueva).total) : precioDe(vNueva);
          if (totalNuevo - cobro(o).cobrado > 0.005) { venta.saldoCobrado = null; marcaQuitada = true; }
        }
        // Planos: se suben antes de guardar (hace falta conexión); en la obra queda el link, el nombre y la fecha.
        const id = isNew ? cloud.newId() : o._id;
        let pl;
        try { pl = await planosEd.guardar(id); } catch (e) { throw new Error('No se pudo subir el plano (hace falta conexión): ' + (e.message || e)); }
        obra.planos = pl.planos;
        const sinPlano = faltaPlano(obra);
        if (isNew) {
          const opts = { conInstalacion: k.conInstalacion, conArena: k.conArena, conCaucho: k.conCaucho };
          cloud.write([
            {
              op: 'set', col: 'obras', id, data: {
                ...obra, estado: faltanDatosVenta(obra, venta).length ? 'venta' : 'vendida', fin: '', postventa: [], incidencias: [], responsable: '', equipo: '', flete: '',
                instInicio: '', instFin: '', inicio: '',
                etapas: window.obrasEtapas(k.tipo, opts).map((nombre) => ({ id: uid(), nombre, estado: 'pendiente', nota: '', ...(nombre === window.OBRAS_BASE_APTA ? { tipo: 'base' } : {}) })),
                checklist: checklistDefault(k.tipo, opts),
                logistica: val.interior ? window.OBRAS_LOGISTICA.map((texto) => ({ id: uid(), texto, ok: false })) : [],
                creadoPor: me.email, creadoPorNombre: me.nombre, creadoEn: cloud.serverTime(),
              },
            },
            { op: 'set', col: 'ventas', id, data: { ...venta, contratoFirmado: false } },
            ...opsCliente,
          ]);
          go('obra/' + id + '/venta');
          UI.toast(faltanDatosVenta(obra, venta).length ? 'Venta guardada: faltan datos para pasar a Administración' : 'Venta cargada: pasó a Administración');
          // La seña o el anticipo es un pago: se registra enseguida con cómo y dónde se pagó.
          if (sena > 0) esperarObra(id, (o2) => pagoForm(o2, null, { tipo: 'sena', monto: Math.min(sena, cobro(o2).pendiente) }));
        } else {
          if (o.estado === 'venta' && !faltanDatosVenta(obra, venta).length) obra.estado = 'vendida';
          if (obra.interior && !(o.logistica || []).length) obra.logistica = window.OBRAS_LOGISTICA.map((texto) => ({ id: uid(), texto, ok: false }));
          cloud.write([
            { op: 'update', col: 'obras', id: o._id, data: obra },
            { op: ventas[o._id] ? 'update' : 'set', col: 'ventas', id: o._id, data: venta },
            ...opsCliente,
          ]);
          UI.toast(marcaQuitada ? 'Guardado. El saldo dejó de ser 0: se quitó la marca «Saldo cobrado».' : obra.estado === 'vendida' ? 'Venta completa: pasó a Administración' : 'Guardado', marcaQuitada ? 5000 : 2600);
        }
        for (const path of pl.borrar) cloud.removeFile(path).catch(() => {});
        if (sinPlano) setTimeout(() => UI.toast(`Falta el plano (obligatorio en ${porQuePlano(obra)}): no va a poder pasar a Entregas hasta adjuntarlo.`, 6000), isNew ? 3200 : 2800);
      },
    }];
    if (!isNew && isAdmin) {
      actions.unshift({
        label: 'Eliminar', kind: 'danger', onClick: async () => {
          if (!(await UI.confirm('¿Eliminar la obra?', `Se borra «${o.nombre}» con su venta, sus pagos, planos, remitos y todas sus fotos. No se puede deshacer.`, 'Eliminar'))) return false;
          const ops = [{ op: 'delete', col: 'obras', id: o._id }, { op: 'delete', col: 'ventas', id: o._id },
            ...fotos.filter((f) => f.obraId === o._id).map((f) => ({ op: 'delete', col: 'fotos', id: f._id })),
            ...(remitosObraId === o._id ? remitos : []).map((r) => ({ op: 'delete', col: `obras/${o._id}/remitos`, id: r._id })),
            ...(pagosPorObra[o._id] || []).flatMap((p) => [{ op: 'delete', col: `ventas/${o._id}/pagos`, id: p._id },
              ...(p.comprobantes || []).map((m) => ({ op: 'delete', col: `ventas/${o._id}/comprobantes`, id: m.id }))])];
          for (let i = 0; i < ops.length; i += 400) cloud.write(ops.slice(i, i + 400));
          for (const p of [...(o.planos || []), ...(remitosObraId === o._id ? remitos : [])]) cloud.removeFile(p.path).catch(() => {});
          go('ventas');
          UI.toast('Obra eliminada');
        },
      });
    }
    UI.sheet({ title: isNew ? 'Nueva venta' : 'Editar venta y obra', body: [body], actions });
  }

  /* ---------- Más ---------- */

  function viewMas() {
    const roleName = window.SG_CONFIG.apps.obras.roles[me.role];
    setMain(
      h('h1', 'Más'),
      h('div.card', h('b', me.nombre), h('div.small.muted', `${me.email} · ${roleName}`)),
      h('div.list',
        isAdmin ? h('div.item.mobile-only', { onclick: () => go('resumen') }, icon('grid'), h('div.grow', 'Resumen de las 4 áreas'), icon('chev')) : null,
        canVenta ? h('div.item', { onclick: () => go('catalogos') }, icon('list'), h('div.grow', 'Catálogos', h('div.small.muted', 'Vendedores, revendedores, clientes, proveedores y cuentas propias')), icon('chev')) : null,
        canVenta ? h('div.item', { onclick: editEquipos }, icon('users'), h('div.grow', 'Equipos de instalación'), icon('chev')) : null,
        me.super ? h('div.item', { onclick: () => go('usuarios') }, icon('users'), h('div.grow', 'Usuarios y permisos'), icon('chev')) : null,
        h('a.item', { href: '../', style: { color: 'inherit', textDecoration: 'none' } }, icon('home'), h('div.grow', 'Otras apps de Slavon'), icon('chev')),
        h('div.item', { onclick: () => cloud.signOut() }, icon('logout'), h('div.grow', cloud.demo ? 'Salir de la demo' : 'Cerrar sesión'))),
      h('p.small.muted', { style: { textAlign: 'center', marginTop: '24px' } }, 'Obras Slavon · Funciona sin señal: lo que cargues se sube solo cuando vuelva la conexión.'));
  }

  function editEquipos() {
    const ta = UI.field({ label: 'Un equipo por renglón', name: 'equipos', type: 'textarea', value: equipos().join('\n') });
    ta.querySelector('textarea').style.minHeight = '180px';
    UI.sheet({
      title: 'Equipos de instalación',
      body: [h('p.muted.small', 'Los equipos que se asignan en la agenda. Ej: «Equipo AMBA 1 – Juan Pérez», «Interior – Carlos».'), ta],
      actions: [{ label: 'Cancelar' }, {
        label: 'Guardar', kind: 'primary', onClick: () => {
          const list = UI.values(ta).equipos.split('\n').map((s) => s.trim()).filter(Boolean);
          cloud.put('config', 'obras', { ...config, equipos: list, ...stamp() });
          config = { ...config, equipos: list };
          UI.toast('Equipos guardados');
          render();
        },
      }],
    });
  }

  /* ---------- Datos de ejemplo (sólo modo demo) ---------- */

  // Foto de ejemplo dibujada en el navegador (una cancha vista desde arriba con un texto).
  function fotoEjemplo(texto, tono = '#2f8f46', padel = false) {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 420;
    const x = c.getContext('2d');
    for (let i = 0; i < 12; i++) { x.fillStyle = i % 2 ? tono : shade(tono, -14); x.fillRect(i * 54, 0, 54, 420); }
    x.strokeStyle = '#fff'; x.lineWidth = 5;
    if (padel) { x.strokeRect(70, 40, 500, 340); x.beginPath(); x.moveTo(320, 40); x.lineTo(320, 380); x.moveTo(180, 40); x.lineTo(180, 380); x.moveTo(460, 40); x.lineTo(460, 380); x.stroke(); x.strokeStyle = 'rgba(200,230,255,.8)'; x.lineWidth = 10; x.strokeRect(60, 30, 520, 360); }
    else { x.strokeRect(40, 30, 560, 360); x.beginPath(); x.moveTo(320, 30); x.lineTo(320, 390); x.stroke(); x.beginPath(); x.arc(320, 210, 60, 0, Math.PI * 2); x.stroke(); x.strokeRect(40, 130, 70, 160); x.strokeRect(530, 130, 70, 160); }
    x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, 360, 640, 60);
    x.fillStyle = '#fff'; x.font = 'bold 24px sans-serif'; x.fillText(texto, 18, 398);
    return c.toDataURL('image/jpeg', 0.7).split(',')[1];
    function shade(hex, d) {
      const n = parseInt(hex.slice(1), 16);
      const f = (v) => Math.max(0, Math.min(255, v + d));
      return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
    }
  }

  function seedDemo() {
    cloud.seedOnce('v10', (put) => {
      const t = UI.today();
      const d = (n) => UI.addDays(t, n);
      const DEL = 'administrativo@demo.slavon';
      const BETO = 'encargado@demo.slavon';
      const CAR = 'carajo@demo.slavon';
      const TOM = 'tomas@demo.slavon';
      put('users', DEL, { nombre: 'Delfina (demo)', apps: { obras: 'administrativo' }, activo: true, super: false });
      put('users', 'melina@demo.slavon', { nombre: 'Melina (demo)', apps: { obras: 'administrativo' }, activo: true, super: false });
      put('users', BETO, { nombre: 'Beto (demo)', apps: { obras: 'encargado' }, activo: true, super: false });
      put('users', CAR, { nombre: 'Carajo (demo)', apps: { obras: 'encargado' }, activo: true, super: false });
      put('users', TOM, { nombre: 'Tomás (demo)', apps: { obras: 'encargado' }, activo: true, super: false });
      put('config', 'obras', { equipos: ['Equipo AMBA 1', 'Equipo AMBA 2', 'Equipo AMBA 3', 'Instalador interior 1', 'Instalador interior 2'] });

      // Etapas: las primeras «hechas» con fecha, la siguiente «en curso» si corresponde.
      const optsDef = (tipo) => ({ conInstalacion: true, conArena: !['residencial', 'mantenimiento', 'otro'].includes(tipo), conCaucho: tipo === 'futbol' });
      const etapas = (tipo, hechas, enCurso, opts = {}, desde = -2 * hechas, quien = 'Beto (demo)') => window.obrasEtapas(tipo, { ...optsDef(tipo), ...opts }).map((nombre, i) => ({
        id: 'e' + i, nombre,
        estado: i < hechas ? 'hecha' : i === hechas && enCurso ? 'en_curso' : 'pendiente',
        fecha: i < hechas ? d(desde + i * 2) : '', porNombre: i < hechas ? quien : '', por: '', nota: '',
      }));
      const check = (tipo, todo, opts) => checklistDefault(tipo, { ...optsDef(tipo), ...opts }).map((c) => (todo ? { ...c, ok: true, porNombre: 'Carajo (demo)', fecha: t } : c));
      const pv = (fin, hechos) => window.OBRAS_POSTVENTA.map((p, i) => ({ id: p.id, label: p.label, fecha: UI.addMonths(fin, p.meses), hecho: i < hechos, nota: i < hechos ? 'Todo bien, contentos con la cancha.' : '', porNombre: i < hechos ? 'Delfina (demo)' : '', hechoFecha: i < hechos ? UI.addMonths(fin, p.meses) : '' }));
      const base = {
        incidencias: [], flete: '', editadoPorNombre: 'Delfina (demo)', creadoPorNombre: 'Delfina (demo)', cantidad: 1, interior: false, logistica: [],
        garantiaAnios: 1, garantiaMeses: 12, postventa: [], responsable: '', equipo: '', instInicio: '', instFin: '', fin: '',
        ancho: 0, largo: 0, demarcacion: '', blanco: 0, bicolor: false, colores: '', cespedOtro: '', plazoOtro: '',
      };
      // Cliente: club y/o nombre, con sus teléfonos y mails ([tipo, valor, de quién]).
      const cli = (club, nombre, ...cts) => ({
        club, clienteNombre: nombre, cliente: clienteTexto(club, nombre),
        contactos: cts.map(([tipo, valor, quien], i) => ({ id: 'c' + i, tipo, valor, quien })),
        telefono: (cts.find((c) => c[0] === 'tel') || [])[1] || '', email: (cts.find((c) => c[0] === 'mail') || [])[1] || '',
      });
      // Cancha: ancho × largo + blanco, por la cantidad de canchas.
      const cancha = (tipo, ancho, largo, blanco = 0, demarcacion = 'simple', cantidad = 1) => ({ tipo, ancho, largo, blanco, demarcacion, cantidad, m2: CALC.round2(CALC.m2Cancha({ ancho, largo, blanco }) * cantidad) });
      const cesp = (cespedModelo, colores, bicolor = false) => ({ cespedModelo, bicolor, colores });
      // Catálogos de ejemplo.
      const VEND = { melina: 'Melina', delfina: 'Delfina', juan: 'Juan' };
      for (const [k, nombre] of Object.entries(VEND)) put('vendedores', 'vd_' + k, { nombre, activo: true });
      put('vendedores', 'vd_tomas', { nombre: 'Tomás (ya no vende)', activo: false });
      put('revendedores', 'rv_sur', { nombre: 'Deportes del Sur', contactos: [{ id: 'c0', tipo: 'tel', valor: '11 5555 0300', quien: 'Gustavo' }], notas: '', activo: true });
      put('revendedores', 'rv_rosario', { nombre: 'Canchas Rosario', contactos: [], notas: 'Revende en Santa Fe.', activo: true });
      put('proveedores', 'pv_polimetal', { nombre: 'Polimetal', cuit: '30-12345678-9', notas: 'Estructuras de pádel.', activo: true,
        cuentas: [{ id: 'pvc1', banco: 'Banco Galicia', titular: 'Polimetal SA', cbu: '0070000000000000000001', alias: 'polimetal.pagos', moneda: 'ARS' }] });
      put('proveedores', 'pv_fibras', { nombre: 'Fibras del Plata', cuit: '30-98765432-1', notas: '', activo: true,
        cuentas: [{ id: 'pvc2', banco: 'Banco Santander', titular: 'Fibras del Plata SRL', cbu: '0720000000000000000002', alias: 'fibras.plata', moneda: 'ARS' },
          { id: 'pvc3', banco: 'Banco Santander', titular: 'Fibras del Plata SRL', cbu: '0720000000000000000003', alias: 'fibras.dolares', moneda: 'USD' }] });
      put('cuentas', 'ct_wmax', { nombre: 'W. MAX SRL', tipo: 'banco', moneda: 'ambas', banco: 'Banco Galicia', titular: 'W. MAX SRL', cbu: '', alias: 'wmax.srl', pideFactura: true, activo: true });
      put('cuentas', 'ct_atlantis', { nombre: 'Atlantis', tipo: 'banco', moneda: 'ambas', banco: 'Banco Nación', titular: 'Atlantis', cbu: '', alias: 'atlantis.cobros', pideFactura: true, activo: true });
      put('cuentas', 'ct_caja_ars', { nombre: 'Efectivo oficina $', tipo: 'efectivo', moneda: 'ARS', pideFactura: false, activo: true });
      put('cuentas', 'ct_caja_usd', { nombre: 'Efectivo oficina US$', tipo: 'efectivo', moneda: 'USD', pideFactura: false, activo: true });
      window.OBRAS_CESPEDES_INICIAL.forEach(({ id, ...x }, i) => put('cespedes', id, { ...x, orden: i, activo: true, notas: '' }));
      const DEST = {
        wmax: { cuentaId: 'ct_wmax', cuentaNombre: 'W. MAX SRL' },
        atlantis: { cuentaId: 'ct_atlantis', cuentaNombre: 'Atlantis' },
        caja_ars: { cuentaId: 'ct_caja_ars', cuentaNombre: 'Efectivo oficina $' },
        caja_usd: { cuentaId: 'ct_caja_usd', cuentaNombre: 'Efectivo oficina US$' },
        polimetal: { proveedorId: 'pv_polimetal', proveedorNombre: 'Polimetal', cuentaProveedorId: 'pvc1', cuentaTexto: 'Banco Galicia · polimetal.pagos · Polimetal SA' },
        cartera: {},
      };
      // Pagos: adentro de cada venta. El número de recibo es correlativo.
      let nRec = 0;
      const pago = (obraId, fecha, moneda, monto, tc, forma, destino, nota = '', extra = {}) => {
        const id = 'p' + (++nRec);
        const p = {
          obraId, tipo: 'pago', fecha, moneda, monto, tc, tcManual: false, equivalente: CALC.equivalente(monto, moneda, tc), monedaVenta: 'USD',
          forma, destino: DEST[destino] || {}, cheques: [], comprobantes: [], registrado: true,
          factura: ['wmax', 'atlantis'].includes(destino) ? 'tiene' : '', nota, recibo: nRec,
          creadoPor: DEL, creadoPorNombre: 'Delfina (demo)', creadoEn: new Date(Date.now() - 864e5).toISOString(), editadoPorNombre: 'Delfina (demo)',
          historial: [{ fecha: new Date(Date.now() - 864e5).toISOString(), por: DEL, porNombre: 'Delfina (demo)', accion: 'registrado', cambios: [] }],
          ...extra,
        };
        if (extra.comprobante) {
          const cid = id + '_c1';
          put(`ventas/${obraId}/comprobantes`, cid, { obraId, pagoId: id, nombre: extra.comprobante, mime: 'image/jpeg', data: fotoEjemplo(extra.comprobante, '#5b6770'), por: DEL, porNombre: 'Delfina (demo)', fecha: p.creadoEn });
          p.comprobantes = [{ id: cid, nombre: extra.comprobante, mime: 'image/jpeg' }];
          delete p.comprobante;
        }
        p.valor = CALC.valorPago(p, 'USD');
        put(`ventas/${obraId}/pagos`, id, p);
      };
      // Clientes: uno por club o nombre (si dos obras son del mismo cliente, comparten el registro).
      const clientes = {};
      // Cada venta: obra (sin plata), venta (plata) y la seña registrada como pago (salvo sinSenaPago).
      const obra = (id, o, v, ex = {}) => {
        const key = norm(o.club || o.clienteNombre);
        if (key && !clientes[key]) {
          clientes[key] = 'cl_' + id;
          put('clientes', clientes[key], { clienteNombre: o.clienteNombre, club: o.club, nombre: clienteTexto(o.club, o.clienteNombre), contactos: o.contactos, cuit: ex.cuit || '', notas: '', activo: true });
        }
        // Los modelos de la demo vieja, pasados al catálogo de césped de Slavon.
        const MODELOS = { 'Fibrilado 12 mm': 'cs_fibpadel', 'Textil pádel': 'cs_monotexnac', 'Monofilamento 50 mm': 'cs_52pro', 'Monofilamento 40 mm': 'cs_44pro',
          'Paisajismo 35 mm': 'cs_spring', 'Paisajismo 40 mm': 'cs_fairway', 'Hockey arena 22 mm': 'cs_multi', 'Tenis arena 20 mm': 'cs_multi', Multisport: 'cs_multi' };
        const formato = o.tipo === 'futbol' ? ex.formato || (/F7/.test(o.nombre) ? 'F7' : /F5/.test(o.nombre) ? 'F5' : num(o.ancho) <= 22 ? 'F5' : 'F7') : '';
        const k = calcularCancha({
          tipo: o.tipo, formato, cantidad: o.cantidad || 1, ancho: o.ancho, largo: o.largo, m2Padel: '', m2Manual: o.m2,
          cespedId: ex.cespedId || MODELOS[o.cespedModelo] || 'otro', cespedOtro: o.cespedModelo || '', color: o.bicolor ? 'bicolor' : 'mono', colores: o.colores,
          bicolorExtra: ex.bicolorExtra, demarcacion: o.demarcacion, mlExtra: ex.mlExtra, blancoManual: ex.blancoManual, clienteColocaArena: ex.clienteColocaArena,
          incluye: { instalacion: { provee: o.conInstalacion === false ? 'cliente' : 'slavon' }, ...(ex.incluye || {}) },
          envios: { cesped: 'si', ...(ex.envios || {}) },
        });
        const { multisportResidencial, ...cancha } = k;
        const garantia = k.sinGarantia ? { garantiaAnios: 0, garantiaMeses: 0 } : {};
        put('obras', id, { ...base, ...o, ...cancha, ...garantia, conStock: !!ex.conStock, planos: ex.planos || [], materialesEntrega: ex.materiales || o.materialesEntrega || null, clienteId: clientes[key] || '', pedido: ex.pedido || '' });
        const vend = (ex.vendedores || ['melina']).map((k) => ({ id: 'vd_' + k, nombre: VEND[k] }));
        // Las de contado que ya pasaron a Entregas tienen la marca «Saldo cobrado».
        const marca = v.formaPago === 'contado' && ['en_curso', 'terminada'].includes(o.estado) ? { fecha: o.habilitadaFecha || o.fechaEntrega || t, por: DEL, porNombre: 'Delfina (demo)' } : null;
        const tilde = (dias = -1) => ({ ok: true, fecha: d(dias), por: DEL, porNombre: 'Delfina (demo)' });
        const checklistAdmin = ex.checklist ? { tildes: Object.fromEntries((ex.checklist.tildes || []).map((k) => [k, tilde()])), confirmoMail: ex.checklist.mail || '', percepciones: ex.checklist.percepciones || '', factura: ex.checklist.factura || {} } : null;
        put('ventas', id, { moneda: 'USD', vendedores: vend, vendio: vend.map((x) => x.nombre).join(', '), revendedor: ex.revendedor || null, iva: ex.iva || { tipo: 'sin', monto: 0 }, tributos: ex.tributos || [],
          saldoCobrado: marca, checklistAdmin, facturacion: ex.facturacion || null, ...v });
        if (num(v.sena) > 0 && !ex.sinSenaPago) pago(id, v.senaFecha || o.fechaVenta, 'USD', num(v.sena), 1570, ex.senaForma || 'cuenta', ex.senaDestino || 'wmax', '', { tipo: 'sena' });
      };
      const foto = (obraId, etapaId, texto, padel, dias = 0, quien = 'Beto (demo)') => put('fotos', obraId + '_' + etapaId + '_' + texto.length, {
        obraId, etapaId, data: fotoEjemplo(texto, padel ? '#2b6cb0' : '#2f8f46', padel), nota: '', por: '', porNombre: quien, fecha: new Date(Date.now() + dias * 864e5).toISOString(),
      });
      // Planos de la demo: el archivo queda en este navegador; en la obra, el link, el nombre y la fecha.
      const planoDemo = (obraId, texto, nombre) => {
        const path = `obras/${obraId}/planos/demo-${obraId}.jpg`;
        put('_archivos', path, 'data:image/jpeg;base64,' + fotoEjemplo(texto, '#5b6770'));
        return { id: 'pl_' + obraId, nombre, mime: 'image/jpeg', path, url: 'demo:' + path, tamano: 0, fecha: new Date(Date.now() - 3 * 864e5).toISOString(), por: DEL, porNombre: 'Delfina (demo)' };
      };
      // Remitos firmados de la demo (el archivo queda en este navegador).
      const remitoDemo = (obraId, n, fechaEnt, nota, quien = 'Beto (demo)', por = BETO) => {
        const id = `rm_${obraId}_${n}`;
        const path = `obras/${obraId}/remitos/${id}-remito_${n}.jpg`;
        put('_archivos', path, 'data:image/jpeg;base64,' + fotoEjemplo('Remito firmado · ' + nota, '#8a6d3b'));
        put(`obras/${obraId}/remitos`, id, { obraId, nombre: `Remito ${n}.jpg`, mime: 'image/jpeg', path, url: 'demo:' + path, tamano: 0, fechaEntrega: fechaEnt, nota, por, porNombre: quien, subidoEn: new Date().toISOString() });
      };
      // Etapa 1 apta con la constancia en WhatsApp (las fotos las tiene alguien en su teléfono).
      const baseWA = (list, quien, fecha) => list.map((e, i) => (i === 0 ? { ...e, tipo: 'base', whatsapp: { fecha, quien, por: '', porNombre: quien } } : e));
      const cambio = (anterior, nueva, motivo, porNombre, fecha) => ({ anterior, nueva, motivo, por: '', porNombre, fecha });
      const fin11 = (primeraCuota, cuotas = 11) => ({ formaPago: 'financiado', cuotas, tasaMensual: 1, primeraCuota });

      /* ----- En Ventas (incompleta) ----- */
      obra('v0', { nombre: 'Club Ferro – Pádel 5', ...cancha('padel_cesped', 10, 20), ...cesp('Fibrilado 12 mm', 'azul'),
        ...cli('Club Ferro', 'Sr. Ruiz', ['tel', '11 5555 0100', 'Sr. Ruiz, presidente'], ['mail', 'compras@clubferro.demo', 'Compras del club']),
        ubicacion: 'Caballito, CABA', fechaVenta: t, plazo: 'inmediata', fechaEntrega: '', estado: 'venta', etapas: etapas('padel_cesped', 0), checklist: check('padel_cesped') },
      { precio: 0, sena: 0, formaPago: 'contado', notasVenta: 'Esperando que confirme si es 1 o 2 canchas para pasar precio.' });

      /* ----- En Administración ----- */
      obra('v1', { nombre: 'Club Los Robles – Pádel 1 y 2', ...cancha('padel_cesped', 10, 20, 0, 'simple', 2), ...cesp('Fibrilado 12 mm', 'verde'), conArena: true, conCaucho: false,
        ...cli('Club Los Robles', 'Martín Robles', ['tel', '11 5555 0101', 'Martín, dueño'], ['tel', '11 5555 0111', 'Pepe, encargado'], ['mail', 'martin@losrobles.demo', 'Martín, dueño']),
        ubicacion: 'Tigre, Buenos Aires', fechaVenta: d(-2), plazo: 'inmediata', fechaEntrega: d(3), estado: 'vendida', etapas: etapas('padel_cesped', 0), checklist: check('padel_cesped') },
      { precio: 9600, sena: 4800, senaFecha: d(-2), formaPago: 'contado' }, { pedido: '1041', conStock: true, iva: { tipo: 'minimo', monto: 1000 }, facturacion: { aFacturar: 4800, facturas: [] },
        checklist: { tildes: ['rosaPlanilla', 'rojoCarpeta', 'agendado', 'planillaCompra'], mail: 'si', factura: { tiene: 'no' } } });
      pago('v1', d(-1), 'ARS', 3140000, 1570, 'cuenta', 'wmax', 'Pagó una parte, el resto la semana que viene', { comprobante: 'Comprobante transferencia', registrado: false, factura: 'solicitar' });
      obra('v2', { nombre: 'Escuela San Martín – F7', ...cancha('futbol', 30, 40, 60), ...cesp('Monofilamento 50 mm', 'verde'),
        ...cli('Escuela San Martín', 'Lic. Paz', ['tel', '11 5555 0102', 'Lic. Paz, directora'], ['mail', 'administracion@sanmartin.demo', 'Administración']),
        ubicacion: 'Lanús, Buenos Aires', fechaVenta: d(-6), plazo: 'fabricacion', fechaEntrega: d(19), estado: 'vendida', etapas: etapas('futbol', 0), checklist: check('futbol'), consideraciones: 'Acceso por calle lateral para el camión.' },
      { precio: 24000, sena: 7200, senaFecha: d(-6), ...fin11(d(24)), contratoFirmado: false },
      { pedido: '1042', vendedores: ['melina', 'delfina'], planos: [planoDemo('v2', 'Plano F7 · 30 × 40 m', 'Plano cancha F7.jpg')], iva: { tipo: 'total', monto: 4165 } });
      obra('v3', { nombre: 'Casa Fernández – Jardín', tipo: 'residencial', m2: 90, ...cesp('Paisajismo 35 mm', 'verde'), conArena: false, conCaucho: false,
        ...cli('', 'Laura Fernández', ['tel', '11 5555 0103', 'Laura'], ['mail', 'laura.fernandez@demo.ar', 'Laura']),
        ubicacion: 'Adrogué, Buenos Aires', fechaVenta: d(-20), plazo: 'inmediata', fechaEntrega: d(5), estado: 'vendida', etapas: etapas('residencial', 0), checklist: check('residencial'), garantiaAnios: 2, garantiaMeses: 24 },
      { precio: 2100, sena: 1050, senaFecha: d(-20), formaPago: 'contado' }, { senaForma: 'efectivo_usd', senaDestino: 'caja_usd', envios: { cesped: 'no' } });
      pago('v3', d(-1), 'ARS', 1648500, 1570, 'cuenta', 'atlantis');
      obra('v4', { nombre: 'Club Atlético Ituzaingó – Hockey', ...cancha('hockey', 55, 91.4, 0, 'doble'), ...cesp('Hockey arena 22 mm', 'azul'),
        ...cli('C. A. Ituzaingó', 'Comisión directiva', ['tel', '11 5555 0104', 'Sr. Benítez, presidente'], ['tel', '11 5555 0114', 'Tesorería']),
        ubicacion: 'Ituzaingó, Buenos Aires', fechaVenta: d(-28), plazo: 'fabricacion', fechaEntrega: d(2), estado: 'vendida', etapas: etapas('hockey', 0), checklist: check('hockey') },
      { precio: 86000, sena: 25800, senaFecha: d(-28), ...fin11(d(2), 12), contratoFirmado: false, notasVenta: 'Falta que firme el presidente del club.' },
      { pedido: '1038', vendedores: ['delfina'], blancoManual: 140, incluye: { arena: { provee: 'cliente' } } });
      obra('v5', { nombre: 'Padel Point Rosario – 3 canchas', ...cancha('padel_completa', 10, 20, 0, 'simple', 3), ...cesp('Textil pádel', 'azul'),
        ...cli('Padel Point SRL', '', ['tel', '341 555 0105', 'Oficina']), ubicacion: 'Rosario, Santa Fe', interior: true,
        logistica: window.OBRAS_LOGISTICA.map((texto, i) => ({ id: 'l' + i, texto, ok: false })), fechaVenta: d(-4), plazo: 'fabricacion', fechaEntrega: d(24), estado: 'vendida', etapas: etapas('padel_completa', 0), checklist: check('padel_completa') },
      { precio: 81000, sena: 40500, senaFecha: d(-4), formaPago: 'contado' },
      { pedido: '1040', revendedor: { id: 'rv_rosario', nombre: 'Canchas Rosario', comisionMonto: 4000, comisionMoneda: 'USD' }, senaForma: 'proveedor', senaDestino: 'polimetal',
        iva: { tipo: 'total', monto: 14058 }, tributos: [{ id: 'tr1', nombre: 'Percepción IIBB', monto: 1215 }],
        facturacion: { aFacturar: 81000, facturas: [{ id: 'fa1', fecha: d(-3), numero: '0003-00000412', emisor: 'wmax', emisorOtro: '', monto: 40500, pagoId: '', porNombre: 'Delfina (demo)' }] },
        checklist: { tildes: ['rosaPlanilla', 'rojoCarpeta', 'planillaCompra', 'detalleCompra'], factura: { tiene: 'no' } } });
      pago('v5', d(-2), 'ARS', 1570000, 1570, 'cheque', 'cartera', 'Lo rechazó el banco: avisar al cliente', {
        cheques: [{ id: 'ch1', numero: '00412233', aNombreDe: 'Padel Point SRL', banco: 'Banco Macro', fechaCobro: d(-1), monto: 1570000, estado: 'rechazado', cobradoFecha: '', cobradoTC: 0 }] });
      obra('v6', { nombre: 'Sr. Gómez – césped sin instalación', ...cancha('futbol', 15, 20), ...cesp('Monofilamento 40 mm', 'verde'), conInstalacion: false,
        ...cli('', 'Ricardo Gómez', ['tel', '11 5555 0106', 'Ricardo']), ubicacion: 'Merlo, Buenos Aires', fechaVenta: d(-7), plazo: 'inmediata', fechaEntrega: d(-1), estado: 'vendida',
        etapas: etapas('futbol', 0, false, { conInstalacion: false }), checklist: check('futbol', false, { conInstalacion: false }) },
      { precio: 3900, sena: 1950, senaFecha: d(-7), formaPago: 'contado' },
      { sinSenaPago: true, incluye: { arena: { provee: 'cliente' }, caucho: { provee: 'cliente' }, pegamento: { provee: 'cliente' }, cinta: { provee: 'cliente' }, blanco: { provee: 'cliente' } } });

      /* ----- En entrega ----- */
      obra('e1', { nombre: 'Club Huracán – Cancha 1', ...cancha('futbol', 30, 60), ...cesp('Monofilamento 50 mm', 'verde'), ...cli('C. A. Huracán', 'Intendencia', ['tel', '11 5555 0201', 'Intendencia']),
        ubicacion: 'Parque Patricios, CABA', fechaVenta: d(-40), plazo: 'fabricacion', fechaEntrega: d(-12), fechaEntregaReal: d(-11), cambiosEntrega: [cambio('', d(-11), 'Coordinado con la intendencia del club', 'Carajo (demo)', d(-14))], estado: 'en_curso', habilitadaFecha: d(-14), habilitadaPorNombre: 'Delfina (demo)', instInicio: d(-10), instFin: d(2), equipo: 'Equipo AMBA 1', responsable: CAR, flete: 'Transporte del Sur · llegó el ' + UI.fmtDay(d(-11)), etapas: etapas('futbol', 5, true, {}, -10), checklist: check('futbol') },
      { precio: 38000, sena: 19000, senaFecha: d(-40), formaPago: 'contado' },
      { iva: { tipo: 'total', monto: 6595 }, facturacion: { aFacturar: 38000, facturas: [{ id: 'fa2', fecha: d(-38), numero: '0003-00000377', emisor: 'atlantis', emisorOtro: '', monto: 19000, pagoId: '', porNombre: 'Delfina (demo)' }] },
        checklist: { tildes: ['rosaPlanilla', 'rojoCarpeta', 'agendado', 'planillaCompra', 'detalleCompra', 'detalleSaldo', 'manual', 'garantia', 'ingresarPedido', 'derivarPago', 'calendario'], mail: 'si', percepciones: 'no', factura: { tiene: 'si', razonSocial: 'Club Atlético Huracán', cuit: '30-52654321-8' } },
        formato: 'F9', blancoManual: 120, planos: [planoDemo('e1', 'Plano F9 · 30 × 60 m', 'Plano Huracán F9.jpg')], materiales: { pegamento: { cantidad: 8, unidad: 'baldes', porNombre: 'Carajo (demo)' }, cinta: { cantidad: 120, unidad: 'm', porNombre: 'Carajo (demo)' } } });
      pago('e1', d(-14), 'USD', 19000, 1545, 'efectivo_usd', 'caja_usd');
      obra('e2', { nombre: 'La Finca – Pádel 2 y 3', ...cancha('padel_completa', 10, 20, 0, 'simple', 2), ...cesp('Textil pádel', 'azul'), ...cli('La Finca Country', 'Administración', ['tel', '11 5555 0202', 'Administración']),
        ubicacion: 'Pilar, Buenos Aires', fechaVenta: d(-50), plazo: 'fabricacion', fechaEntrega: d(-6), estado: 'en_curso', habilitadaFecha: d(-8), habilitadaPorNombre: 'Delfina (demo)', instInicio: d(-5), instFin: d(4), equipo: 'Equipo AMBA 2', responsable: BETO, materialesEntrega: { pegamento: { cantidad: 6, unidad: 'baldes', porNombre: 'Beto (demo)' }, cinta: { cantidad: 90, unidad: 'm', porNombre: 'Beto (demo)' } }, etapas: baseWA(etapas('padel_completa', 5, true, {}, -5), 'Beto (demo)', d(-5)), checklist: check('padel_completa') },
      { precio: 52000, sena: 15600, senaFecha: d(-50), ...fin11(d(-20)), contratoFirmado: true, contratoFecha: d(-9), contratoPorNombre: 'Delfina (demo)' });
      pago('e2', d(-20), 'USD', 3673.09, 1550, 'cuenta', 'wmax', 'Cuota 1');
      obra('e3', { nombre: 'Club Norte – Pádel 1', ...cancha('padel_completa', 10, 20), ...cesp('Textil pádel', 'verde'), ...cli('Club Norte', 'Sr. Paredes', ['tel', '351 555 0203', 'Sr. Paredes']),
        ubicacion: 'Córdoba capital', interior: true, logistica: window.OBRAS_LOGISTICA.map((texto, i) => ({ id: 'l' + i, texto, ok: i < 3, porNombre: i < 3 ? 'Carajo (demo)' : '', fecha: i < 3 ? d(-15) : '' })), fechaVenta: d(-45), plazo: 'fabricacion', fechaEntrega: d(-16), estado: 'en_curso', habilitadaFecha: d(-18), instInicio: d(-14), instFin: d(-10), equipo: 'Instalador interior 1', responsable: CAR,
        materialesEntrega: { pegamento: { cantidad: 3, unidad: 'baldes', porNombre: 'Carajo (demo)' }, cinta: { cantidad: 45, unidad: 'm', porNombre: 'Carajo (demo)' } },
        etapas: baseWA(etapas('padel_completa', 3, false, {}, -14, 'Carajo (demo)'), 'Sr. Paredes (cliente), se las mandó a Carajo', d(-14)), checklist: check('padel_completa'),
        incidencias: [{ id: 'i1', tipo: 'Falta material', detalle: 'Faltan 4 vidrios laterales, se pidieron a fábrica', avisadoCliente: true, resuelta: false, fecha: d(-11), porNombre: 'Carajo (demo)' }] },
      { precio: 27000, sena: 13500, senaFecha: d(-45), formaPago: 'contado' });
      pago('e3', d(-18), 'ARS', 20790000, 1540, 'cheque', 'cartera', 'Dos cheques diferidos', {
        cheques: [
          { id: 'ch1', numero: '00098765', aNombreDe: 'Club Norte', banco: 'Banco de Córdoba', fechaCobro: d(-10), monto: 10395000, estado: 'cobrado', cobradoFecha: d(-10), cobradoTC: 1540 },
          { id: 'ch2', numero: '00098766', aNombreDe: 'Club Norte', banco: 'Banco de Córdoba', fechaCobro: d(12), monto: 10395000, estado: 'pendiente', cobradoFecha: '', cobradoTC: 0 },
        ] });
      obra('e4', { nombre: 'Tenis Club Banfield – Cancha 3', ...cancha('tenis', 18.3, 36.6), ...cesp('Tenis arena 20 mm', 'verde'), ...cli('Tenis Club Banfield', '', ['tel', '11 5555 0204', 'Secretaría']),
        ubicacion: 'Banfield, Buenos Aires', fechaVenta: d(-30), plazo: 'fabricacion', fechaEntrega: d(1), fechaEntregaReal: d(8), cambiosEntrega: [cambio('', d(1), 'Coordinado por WhatsApp con la secretaría', 'Beto (demo)', d(-2)), cambio(d(1), d(8), 'La base no está apta: el club tiene que nivelar el sector norte', 'Beto (demo)', t)],
        estado: 'en_curso', habilitadaFecha: d(-2), habilitadaPorNombre: 'Delfina (demo)', instInicio: d(8), instFin: d(10), equipo: 'Equipo AMBA 3', responsable: BETO, flete: 'A coordinar', etapas: etapas('tenis', 0), checklist: check('tenis'),
        incidencias: [{ id: 'i4', tipo: 'Base no apta', detalle: 'Desnivel de 4 cm en el sector norte y falta la pendiente de desagüe', avisadoCliente: true, avisoFecha: t, avisoMedio: 'WhatsApp', avisoA: 'Secretaría del club (Laura)', resuelta: false, fecha: t, por: BETO, porNombre: 'Beto (demo)' }] },
      { precio: 14500, sena: 7250, senaFecha: d(-30), formaPago: 'contado' }, { blancoManual: 70 });
      pago('e4', d(-2), 'ARS', 11382500, 1570, 'cuenta', 'wmax');
      obra('e5', { nombre: 'Complejo La Cantera – F5 1 y 2', ...cancha('futbol', 20, 27.5, 0, 'simple', 2), ...cesp('Monofilamento 50 mm', 'verde'), ...cli('La Cantera SA', '', ['tel', '11 5555 0205', 'Oficina']),
        ubicacion: 'Moreno, Buenos Aires', fechaVenta: d(-22), plazo: 'fabricacion', fechaEntrega: d(6), fechaEntregaReal: d(3), cambiosEntrega: [cambio('', d(3), 'Coordinado con la oficina por teléfono', 'Beto (demo)', t)], estado: 'en_curso', habilitadaFecha: t, habilitadaPorNombre: 'Delfina (demo)', responsable: BETO, etapas: etapas('futbol', 0), checklist: check('futbol') },
      { precio: 30500, sena: 15250, senaFecha: d(-22), formaPago: 'contado' });
      pago('e5', t, 'USD', 15250, 1570, 'efectivo_usd', 'caja_usd');
      obra('e6', { nombre: 'Colegio Sarmiento – Multisport', ...cancha('futbol', 18, 25), ...cesp('Multisport', 'verde y rojo', true), ...cli('Colegio Sarmiento', '', ['tel', '11 5555 0206', 'Secretaría']),
        ubicacion: 'Haedo, Buenos Aires', fechaVenta: d(-25), plazo: 'fabricacion', fechaEntrega: d(1), estado: 'en_curso', habilitadaFecha: d(-1), instInicio: d(1), instFin: d(3), equipo: 'Equipo AMBA 1', responsable: CAR, etapas: etapas('futbol', 0), checklist: check('futbol') },
      { precio: 9800, sena: 4900, senaFecha: d(-25), formaPago: 'contado' }, { bicolorExtra: 12 });
      pago('e6', d(-1), 'USD', 4900, 1570, 'cuenta', 'wmax');
      obra('e7', { nombre: 'Tercer Tiempo – Mantenimiento F5', tipo: 'mantenimiento', m2: 800, ...cli('Tercer Tiempo', 'Diego', ['tel', '11 5555 0207', 'Diego, dueño']),
        ubicacion: 'Morón, Buenos Aires', fechaVenta: d(-3), plazo: 'inmediata', fechaEntrega: d(8), estado: 'en_curso', habilitadaFecha: d(-1), instInicio: d(8), instFin: d(8), equipo: 'Equipo AMBA 3', responsable: TOM, etapas: etapas('mantenimiento', 0),
        checklist: [{ id: 'c1', texto: 'Arena recargada y pareja', ok: false }, { id: 'c2', texto: 'Uniones revisadas', ok: false }, { id: 'c3', texto: 'Informe enviado al cliente', ok: false }], garantiaAnios: '', garantiaMeses: '' },
      { precio: 650, sena: 650, senaFecha: d(-3), formaPago: 'contado' });

      /* ----- Entregadas ----- */
      const fin1 = UI.addMonths(d(3), -1);
      obra('t1', { nombre: 'Tercer Tiempo – F5', ...cancha('futbol', 20, 40), ...cesp('Monofilamento 50 mm', 'verde'), ...cli('Tercer Tiempo', 'Diego', ['tel', '11 5555 0207', 'Diego, dueño']),
        ubicacion: 'Morón, Buenos Aires', fechaVenta: UI.addDays(fin1, -40), fechaEntrega: UI.addDays(fin1, -10), instInicio: UI.addDays(fin1, -6), instFin: fin1, equipo: 'Equipo AMBA 3', responsable: BETO, estado: 'terminada', fin: fin1, etapas: etapas('futbol', 11, false, {}, -40), checklist: check('futbol', true), postventa: pv(fin1, 0) },
      { precio: 18000, sena: 9000, senaFecha: UI.addDays(fin1, -40), formaPago: 'contado' });
      pago('t1', UI.addDays(fin1, -12), 'USD', 9000, 1500, 'efectivo_usd', 'caja_usd');
      const fin2 = UI.addMonths(d(40), -12);
      obra('t2', { nombre: 'Centro Galicia – Pádel', ...cancha('padel_cesped', 10, 20), ...cesp('Fibrilado 12 mm', 'verde'), ...cli('Centro Galicia', '', ['tel', '11 5555 0208', 'Secretaría']),
        ubicacion: 'Avellaneda, Buenos Aires', fechaVenta: UI.addDays(fin2, -30), fechaEntrega: UI.addDays(fin2, -2), instInicio: fin2, instFin: fin2, equipo: 'Equipo AMBA 1', estado: 'terminada', fin: fin2, etapas: etapas('padel_cesped', 9, false, {}, -330), checklist: check('padel_cesped', true), postventa: pv(fin2, 1) },
      { precio: 4800, sena: 2400, senaFecha: UI.addDays(fin2, -30), formaPago: 'contado' });
      pago('t2', UI.addDays(fin2, -5), 'USD', 2400, 1100, 'cuenta', 'atlantis');
      const fin3 = d(-5);
      obra('t3', { nombre: 'Club Mitre – Pádel 1 a 4', ...cancha('padel_completa', 10, 20, 0, 'simple', 4), ...cesp('Textil pádel', 'azul'), ...cli('Club Mitre', 'Sr. Ledesma', ['tel', '11 5555 0209', 'Sr. Ledesma, presidente'], ['mail', 'tesoreria@clubmitre.demo', 'Tesorería']),
        ubicacion: 'San Martín, Buenos Aires', fechaVenta: d(-70), fechaEntrega: d(-26), instInicio: d(-25), instFin: fin3, equipo: 'Equipo AMBA 2', responsable: BETO, estado: 'terminada', fin: fin3, etapas: etapas('padel_completa', 14, false, {}, -25), checklist: check('padel_completa', true), postventa: pv(fin3, 0) },
      { precio: 104000, sena: 31200, senaFecha: d(-70), ...fin11(d(-40)), contratoFirmado: true, contratoFecha: d(-30) });
      pago('t3', d(-40), 'USD', 7346.18, 1550, 'cuenta', 'wmax', 'Cuota 1');
      const fin4 = UI.addMonths(d(-10), -12);
      obra('t4', { nombre: 'Barrio Los Álamos – Residencial', tipo: 'residencial', m2: 140, ...cesp('Multisport', 'verde'), ...cli('', 'Familia Ortiz', ['tel', '11 5555 0210', 'Sra. Ortiz']),
        ubicacion: 'Canning, Buenos Aires', fechaVenta: UI.addDays(fin4, -15), fechaEntrega: fin4, instInicio: fin4, instFin: fin4, equipo: 'Equipo AMBA 3', estado: 'terminada', fin: fin4, etapas: etapas('residencial', 8, false, {}, -380), checklist: check('residencial', true), postventa: pv(fin4, 3), garantiaAnios: 2, garantiaMeses: 24 },
      { precio: 3200, sena: 1600, senaFecha: UI.addDays(fin4, -15), formaPago: 'contado' },
      { clienteColocaArena: true, planos: [planoDemo('t4', 'Plano jardín · 140 m²', 'Plano jardín Ortiz.jpg')] });
      pago('t4', UI.addDays(fin4, -2), 'USD', 1600, 1000, 'efectivo_usd', 'caja_usd');

      /* ----- Fotos ----- */
      foto('e1', 'e0', 'Huracán · base lista', false, -11, 'Carajo (demo)');
      foto('e1', 'e0', 'Huracán · base, sector arco', false, -11, 'Carajo (demo)');
      foto('e4', 'e0', 'Banfield · desnivel en la base', false, 0);

      /* ----- Remitos firmados ----- */
      remitoDemo('e1', 1, d(-11), 'Remito 0001-00004410 · césped y blanco', 'Carajo (demo)', CAR);
      remitoDemo('e1', 2, d(-9), 'Remito 0001-00004433 · arena y caucho', 'Carajo (demo)', CAR);
      remitoDemo('e6', 1, t, 'Remito 0001-00004521 · césped y blanco (falta instalar)');
      foto('e1', 'e3', 'Huracán · tendido', false, -6, 'Carajo (demo)');
      foto('e1', 'e4', 'Huracán · pegado del verde', false, -4, 'Carajo (demo)');
      foto('e2', 'e2', 'La Finca · estructura', true, -3);
      foto('e3', '', 'Club Norte · faltan vidrios', true, -11, 'Carajo (demo)');
      foto('t3', 'e13', 'Club Mitre · cancha 1 terminada', true, -5);
      foto('t3', 'e13', 'Club Mitre · cancha 2 terminada', true, -5);
      foto('t3', 'e13', 'Club Mitre · canchas 3 y 4', true, -5);
      put('config', 'contadores', { recibo: nRec });
    });
  }
})();
