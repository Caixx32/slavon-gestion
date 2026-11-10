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

  let me = null;
  let cloud = null;
  let isAdmin = false;   // puede eliminar obras
  let canVenta = false;  // admin o administrativo: ve y maneja la venta y la plata
  let obras = [];
  let ventas = {};       // datos de plata por id de obra (sólo admin y administrativo)
  let users = [];
  let config = {};
  let fotos = [];        // fotos de la obra abierta
  let fotosObraId = null;
  let stopFotos = null;
  const ui = { obrasFiltro: 'en_curso', busqueda: '', pvFiltro: 'pendientes', agendaMes: null };

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
      cloud.subscribe('obras', (items) => { obras = items; render(); }, (e) => UI.toast(e.message, 5000));
      if (canVenta) { loadBNA(); setInterval(loadBNA, 15 * 60 * 1000); }
      if (canVenta) cloud.subscribe('ventas', (items) => { ventas = Object.fromEntries(items.map((v) => [v._id, v])); render(); }, (e) => UI.toast(e.message, 5000));
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

  function render() {
    const [r, id, tab] = route();
    document.body.classList.toggle('acta-mode', r === 'acta');
    const activa = r === 'obra' ? (obras.find((x) => x._id === id) ? areaDe(obras.find((x) => x._id === id)) : '') : r;
    tabsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === activa));
    if (r !== 'obra' && r !== 'acta') watchFotos(null);
    document.querySelectorAll('.fab').forEach((f) => f.remove());
    document.body.classList.toggle('wide', r === 'resumen' || r === 'entregas');
    if (r === 'obra') return viewObra(id, tab);
    if (r === 'acta') return viewActa(id);
    if (r === 'resumen' && isAdmin) return viewResumen();
    if (r === 'ventas' && canVenta) return viewVentas();
    if (r === 'admin' && canVenta) return viewAdmin();
    if (r === 'postventa' && canVenta) return viewPostventa();
    if (r === 'mas') return viewMas();
    if (r === 'usuarios' && me.super) return SG.usersScreen(main, () => go('mas'));
    return viewEntregas();
  }

  function watchFotos(obraId) {
    if (obraId === fotosObraId) return;
    if (stopFotos) stopFotos();
    stopFotos = null;
    fotos = [];
    fotosObraId = obraId;
    if (obraId) {
      stopFotos = cloud.subscribe('fotos', (items) => {
        fotos = items.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
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
  // Lee números escritos a la argentina («1.475,50», «1475,5») o guardados con punto decimal («1475.5»).
  const num = (v) => {
    let t = String(v ?? '').trim().replace(/[^\d.,]/g, '');
    if (!t) return 0;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    return Number(t) || 0;
  };
  const usd = (n) => (n ? 'US$ ' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '');
  const ars = (n) => (n ? '$ ' + Math.round(n).toLocaleString('es-AR') : '');
  // Tipo de cambio con sus centavos, tal cual lo publica el banco.
  const tcFmt = (n) => (n ? '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
  const tipoNombre = (t) => (TIPOS[t] || TIPOS.otro).nombre;
  const userName = (email) => (users.find((u) => u._id === email) || {}).nombre || email;
  const stamp = () => ({ editadoPor: me.email, editadoPorNombre: me.nombre, editadoEn: cloud.serverTime() });
  const esVendida = (o) => o.estado === 'vendida';
  const esCurso = (o) => !o.estado || o.estado === 'en_curso';
  const esTerminada = (o) => o.estado === 'terminada';
  const ESTADOS = { vendida: 'Vendida', en_curso: 'En entrega', terminada: 'Entregada' };
  const equipos = () => (config.equipos && config.equipos.length ? config.equipos : EQUIPOS_DEFAULT);

  const progreso = (o) => {
    const et = o.etapas || [];
    if (!et.length) return 0;
    return Math.round((et.filter((e) => e.estado === 'hecha').length / et.length) * 100);
  };
  const etapaActual = (o) => (o.etapas || []).find((e) => e.estado === 'en_curso') || (o.etapas || []).find((e) => e.estado !== 'hecha');

  const saldoUSD = (v) => Math.max(0, num(v.precioUSD) - num(v.senaUSD));
  // ¿Se cumple la condición para entregar? Contado: saldo cobrado. Financiado: contrato firmado en nuestro poder.
  const condicionOk = (v) => !!v && (v.formaPago === 'financiado' ? !!v.contratoFirmado : !!v.saldoCobrado || saldoUSD(v) === 0 && num(v.precioUSD) > 0);
  const faltaTexto = (v) => (!v ? 'Faltan los datos de la venta' : v.formaPago === 'financiado' ? 'Falta el contrato firmado' : 'Falta cobrar el saldo');

  // Ventas con la entrega cerca (o pasada) y la condición sin cumplir.
  const alertasEntrega = () => obras
    .filter((o) => esVendida(o) && o.fechaEntrega && UI.daysUntil(o.fechaEntrega) <= AVISO_DIAS && !condicionOk(ventas[o._id]))
    .sort((a, b) => a.fechaEntrega.localeCompare(b.fechaEntrega));
  // Ventas que ya cumplen la condición pero todavía no se habilitó la entrega.
  const paraHabilitar = () => obras.filter((o) => esVendida(o) && condicionOk(ventas[o._id]));
  const proximasInstalaciones = (dias) => obras
    .filter((o) => !esTerminada(o) && o.instInicio && (o.instFin || o.instInicio) >= UI.today() && UI.daysUntil(o.instInicio) <= dias)
    .sort((a, b) => a.instInicio.localeCompare(b.instInicio));
  const incidenciasAbiertas = () => {
    const out = [];
    for (const o of obras) for (const i of o.incidencias || []) if (!i.resuelta && !esTerminada(o)) out.push({ obra: o, i });
    return out;
  };
  const garantiaVence = (o) => (o.fin && num(o.garantiaMeses) ? UI.addMonths(o.fin, num(o.garantiaMeses)) : '');
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
      h('div.grow',
        h('div.ellipsis', { style: { fontWeight: 600 } }, o.nombre),
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

  function buscador(onPick) {
    const inp = h('input.search', { type: 'search', placeholder: 'Buscar obra o cliente…' });
    const res = h('div.list', { hidden: true });
    inp.addEventListener('input', () => {
      const q = inp.value.trim().toLowerCase();
      const items = q.length < 2 ? [] : obras.filter((o) => [o.nombre, o.cliente, o.ubicacion].join(' ').toLowerCase().includes(q)).slice(0, 8);
      res.hidden = !items.length;
      res.replaceChildren(...items.map((o) => obraRow(o, h('span.badge', AREAS[areaDe(o)].nombre))));
    });
    return h('div', { style: { margin: '10px 0 4px' } }, inp, h('div', { style: { marginTop: '8px' } }, res));
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
    if (k === 'admin') linea = condicionOk(v) ? h('span.badge.ok', 'Lista para Entregas') : urgencia(o.fechaEntrega);
    if (k === 'entregas') linea = [progressBar(progreso(o)), h('div.small.muted', { style: { marginTop: '4px' } }, o.instInicio ? fechasInst(o) : 'Sin fecha de instalación')];
    if (k === 'postventa') { const p = (o.postventa || []).find((x) => !x.hecho); linea = p ? h('span.small', `Llamado ${p.label}: `, urgencia(p.fecha)) : null; }
    return h('div.board-card', { onclick: () => go('obra/' + o._id) },
      h('div.ellipsis', { style: { fontWeight: 700 } }, o.nombre),
      h('div.small.muted.ellipsis', { style: { marginBottom: '6px' } }, tipoNombre(o.tipo)),
      linea);
  }

  /* ---------- 1. Ventas ---------- */

  function viewVentas() {
    const mes = UI.today().slice(0, 7);
    const incompletas = obras.filter((o) => o.estado === 'venta');
    const delMes = obras.filter((o) => (o.fechaVenta || '').startsWith(mes)).sort((a, b) => (b.fechaVenta || '').localeCompare(a.fechaVenta || ''));
    const totalUSD = delMes.reduce((a, o) => a + num((ventas[o._id] || {}).precioUSD), 0);
    const m2 = delMes.reduce((a, o) => a + num(o.m2), 0);
    setMain(
      areaHead('ventas', 'Se carga la venta con los datos de la cancha, el precio, la seña y la fecha de entrega. Cuando está completa pasa sola a Administración.',
        h('button.btn.primary', { type: 'button', onclick: () => editObra(null) }, icon('plus'), 'Nueva venta')),
      h('div.kpis', { style: { marginTop: '14px' } },
        kpi(delMes.length, 'Ventas del mes'),
        kpi(usd(totalUSD) || 'US$ 0', 'Vendido en el mes'),
        kpi(m2.toLocaleString('es-AR') + ' m²', 'm² vendidos en el mes')),
      section('Incompletas (faltan datos para pasar a Administración)', incompletas.map((o) => obraRow(o, h('span.badge.warn', 'Completar'))), 'No hay ventas incompletas.'),
      section('Ventas del mes', delMes.map((o) => obraRow(o, h('span.badge', { class: areaDe(o) === 'ventas' ? 'warn' : '' }, 'En ' + AREAS[areaDe(o)].nombre),
        [UI.fmtDay(o.fechaVenta), tipoNombre(o.tipo), o.m2 ? o.m2 + ' m²' : '', usd(num((ventas[o._id] || {}).precioUSD)), (ventas[o._id] || {}).vendio ? 'vendió ' + ventas[o._id].vendio : ''].filter(Boolean).join(' · '))), 'Todavía no hay ventas este mes.'));
    addFab();
  }

  /* ---------- 2. Administración ---------- */

  function viewAdmin() {
    const enAdmin = obras.filter((o) => o.estado === 'vendida').sort((a, b) => (a.fechaEntrega || '9').localeCompare(b.fechaEntrega || '9'));
    const listas = enAdmin.filter((o) => condicionOk(ventas[o._id]));
    const urgentes = enAdmin.filter((o) => !condicionOk(ventas[o._id]) && o.fechaEntrega && UI.daysUntil(o.fechaEntrega) <= AVISO_DIAS);
    const resto = enAdmin.filter((o) => !listas.includes(o) && !urgentes.includes(o));
    const aCobrar = enAdmin.filter((o) => (ventas[o._id] || {}).formaPago !== 'financiado' && !condicionOk(ventas[o._id])).reduce((a, o) => a + saldoUSD(ventas[o._id] || {}), 0);
    const pendRow = (o) => {
      const v = ventas[o._id] || {};
      const fin = v.formaPago === 'financiado';
      return h('div.item', { onclick: () => go('obra/' + o._id) },
        h('span.dot', { class: UI.daysUntil(o.fechaEntrega || '9999-12-31') <= AVISO_DIAS ? 'late' : '' }, fin ? '✎' : '$'),
        h('div.grow',
          h('div.ellipsis', { style: { fontWeight: 600 } }, o.nombre),
          h('div.small.muted.ellipsis', fin ? 'Financiado · falta el contrato firmado' : `Contado · saldo ${usd(saldoUSD(v)) || '—'}${tcHoy() && saldoUSD(v) ? ' = ' + ars(saldoUSD(v) * tcHoy()) : ''}`)),
        urgencia(o.fechaEntrega),
        h('button.btn.small', { type: 'button', onclick: (e) => { e.stopPropagation(); registrarCondicion(o); } }, fin ? 'Contrato recibido' : 'Saldo cobrado'));
    };
    setMain(
      areaHead('admin', `Antes de entregar: contado → cobrar el saldo · financiado → contrato firmado en nuestro poder. ${AVISO_DIAS} días antes de la entrega avisa lo que falte. Cuando está, la obra pasa a Entregas.`),
      h('div', { style: { marginTop: '14px' } }, tcBox()),
      h('div.kpis',
        kpi(urgentes.length, `Urgentes (entrega en ${AVISO_DIAS} días o menos)`, null, urgentes.length ? 'bad' : ''),
        kpi(usd(aCobrar) || 'US$ 0', 'Saldos de contado a cobrar'),
        kpi(enAdmin.filter((o) => (ventas[o._id] || {}).formaPago === 'financiado' && !condicionOk(ventas[o._id])).length, 'Contratos por firmar')),
      section('Listas para pasar a Entregas', listas.map((o) => h('div.item', { onclick: () => go('obra/' + o._id) },
        h('span.dot.done', icon('check')),
        h('div.grow', h('div.ellipsis', { style: { fontWeight: 600 } }, o.nombre), h('div.small.muted', [(ventas[o._id] || {}).formaPago === 'financiado' ? 'Contrato firmado' : 'Saldo cobrado', 'entrega ' + UI.fmtDay(o.fechaEntrega)].join(' · '))),
        h('button.btn.small.primary', { type: 'button', onclick: (e) => { e.stopPropagation(); habilitar(o); } }, 'Pasar a Entregas'))), 'Nada listo para pasar.'),
      section('Urgentes', urgentes.map(pendRow), 'No hay entregas próximas con saldo o contrato pendiente.'),
      section('Pendientes, con entrega más adelante', resto.map(pendRow), 'No hay otras ventas pendientes.'));
  }

  /* ---------- 3. Entregas ---------- */

  function viewEntregas() {
    if (!ui.entTab) ui.entTab = 'obras';
    const enCurso = obras.filter(esCurso).sort((a, b) => (a.instInicio || '9').localeCompare(b.instInicio || '9'));
    const sinFecha = enCurso.filter((o) => !o.instInicio && o.conInstalacion !== false);
    const semana = proximasInstalaciones(7);
    const inc = incidenciasAbiertas();
    const proximas = obras.filter((o) => o.estado === 'vendida' && o.fechaEntrega && UI.daysUntil(o.fechaEntrega) <= 14).sort((a, b) => a.fechaEntrega.localeCompare(b.fechaEntrega));
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
          [tipoNombre(o.tipo), o.ubicacion, 'entrega ' + UI.fmtDay(o.fechaEntrega)].filter(Boolean).join(' · '))), '') : null,
        inc.length ? section('Incidencias abiertas', inc.map(incItem), '') : null,
        h('h2', { style: { marginTop: '22px' } }, 'En curso'),
        enCurso.length ? enCurso.map(obraCard) : h('div.card.empty', 'No hay obras en entrega.'),
        proximas.length ? section('Próximas (todavía en Administración)', proximas.map((o) => obraRow(o, h('span.badge', 'Entrega ' + UI.fmtDay(o.fechaEntrega)))), '') : null,
      ];
    }
    setMain(areaHead('entregas', 'Coordinar e instalar: agenda, equipo, flete, logística del interior, etapas con fotos, incidencias y checklist. Al terminar se marca entregada y pasa a Post-venta.'), seg, content);
  }

  function obraCard(o) {
    const pct = progreso(o);
    const act = etapaActual(o);
    return h('div.card.tap.obra-card', { onclick: () => go('obra/' + o._id) },
      h('div.row',
        h('div.grow',
          h('h3.ellipsis', o.nombre),
          h('div.small.muted.ellipsis', [tipoNombre(o.tipo), o.ubicacion, o.equipo, o.responsable ? userName(o.responsable) : ''].filter(Boolean).join(' · '))),
        h('b.pct', pct + '%')),
      h('div', { style: { margin: '10px 0 6px' } }, progressBar(pct)),
      h('div.small.row.wrap', { style: { gap: '6px' } },
        act ? [h('span.muted', act.estado === 'en_curso' ? 'En curso:' : 'Sigue:'), act.nombre] : null,
        h('span.grow'),
        o.instInicio ? h('span.badge.blue', fechasInst(o)) : h('span.badge.warn', 'Sin fecha'),
        (o.incidencias || []).some((i) => !i.resuelta) ? h('span.badge.red', 'Incidencia') : null));
  }

  function instItem(o) {
    const sup = superpuestas(o, o.equipo, o.instInicio, o.instFin);
    return h('div.item', { onclick: () => go('obra/' + o._id) },
      h('span.dot.doing', icon('calendar')),
      h('div.grow',
        h('div.ellipsis', { style: { fontWeight: 600 } }, o.nombre),
        h('div.small.muted.ellipsis', [tipoNombre(o.tipo), o.ubicacion, o.equipo, o.responsable ? userName(o.responsable) : ''].filter(Boolean).join(' · '))),
      sup.length ? h('span.badge.warn', { title: 'Mismo equipo en: ' + sup.map((x) => x.nombre).join(', ') }, 'Equipo doble') : null,
      h('span.badge.blue', fechasInst(o)));
  }

  function incItem({ obra: o, i }) {
    return h('div.item', { onclick: () => go('obra/' + o._id + '/entrega') },
      h('span.dot.late', '!'),
      h('div.grow',
        h('div.ellipsis', { style: { fontWeight: 600 } }, `${i.tipo} · ${o.nombre}`),
        h('div.small.muted.ellipsis', [UI.fmtDay(i.fecha), i.porNombre, i.detalle, i.avisadoCliente ? 'cliente avisado' : 'cliente sin avisar'].filter(Boolean).join(' · '))),
      icon('chev'));
  }

  function garantiaItem(o) {
    const vence = garantiaVence(o);
    const d = UI.daysUntil(vence);
    return h('div.item', { onclick: () => go('obra/' + o._id + '/postventa') },
      h('span.dot', icon('clip')),
      h('div.grow',
        h('div.ellipsis', { style: { fontWeight: 600 } }, o.nombre),
        h('div.small.muted.ellipsis', `Garantía de ${o.garantiaMeses} meses · vence ${UI.fmtDay(vence)}`)),
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
    const wa = UI.waLink(o.telefono);

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
          h('div.muted', [tipoNombre(o.tipo) + (num(o.cantidad) > 1 ? ` × ${o.cantidad}` : ''), o.cliente].filter(Boolean).join(' · '))),
        h('div.row', { style: { gap: '6px' } },
          o.telefono ? h('a.btn.small', { href: 'tel:' + o.telefono.replace(/\s/g, '') }, icon('phone')) : null,
          wa ? h('a.btn.small', { href: wa, target: '_blank', rel: 'noopener' }, icon('whatsapp')) : null)),
      stepper(o, tab, tabs.map(([k]) => k)),
      content);
  }

  function datosCancha(o) {
    const t = TIPOS[o.tipo] || TIPOS.otro;
    return h('div.card.info',
      infoRow('Tipo', [tipoNombre(o.tipo), num(o.cantidad) > 1 ? ` · ${o.cantidad} canchas` : '']),
      o.m2 ? infoRow('Superficie', o.m2 + ' m²') : null,
      o.cesped ? infoRow('Césped', o.cesped) : null,
      infoRow('Lleva', [o.conInstalacion === false ? 'Sin instalación' : 'Con instalación', (o.conArena ?? t.arena) ? 'arena' : 'sin arena', (o.conCaucho ?? t.caucho) ? 'caucho' : 'sin caucho'].join(' · ')),
      o.consideraciones ? infoRow('Consideraciones', h('div', { style: { whiteSpace: 'pre-wrap' } }, o.consideraciones)) : null,
      infoRow('Cliente', [o.cliente, o.telefono ? h('div.small.muted', o.telefono) : null]),
      o.ubicacion ? infoRow('Ubicación', h('a', { href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.ubicacion), target: '_blank', rel: 'noopener' }, o.ubicacion, o.interior ? ' (interior)' : '')) : null,
      o.notas ? infoRow('Notas', h('div', { style: { whiteSpace: 'pre-wrap' } }, o.notas)) : null);
  }

  function pasoBox(texto, boton) {
    return h('div.paso', h('div.grow', texto), boton || null);
  }

  /* ----- Solapa Venta ----- */
  function ventaTab(o) {
    const v = ventas[o._id] || {};
    const falta = faltanDatosVenta(o, v);
    return [
      o.estado === 'venta'
        ? pasoBox(falta.length ? `Faltan datos para pasar a Administración: ${falta.join(', ')}.` : 'La venta está completa.',
          h('button.btn.primary.small', { type: 'button', onclick: () => (falta.length ? editObra(o) : pasarAAdmin(o)) }, falta.length ? 'Completar' : 'Pasar a Administración'))
        : null,
      h('div.row', { style: { marginTop: '16px' } }, h('h2.grow', { style: { margin: 0 } }, 'Datos de la venta'), h('button.btn.small', { type: 'button', onclick: () => editObra(o) }, icon('edit'), 'Editar')),
      h('div.card.info', { style: { marginTop: '10px' } },
        infoRow('Fecha de venta', [UI.fmtDay(o.fechaVenta) || '—', v.vendio ? h('span.muted', ' · vendió ' + v.vendio) : null, o.creadoPorNombre ? h('span.muted', ' · cargó ' + o.creadoPorNombre) : null]),
        infoRow('Plazo', o.plazo ? window.OBRAS_PLAZOS[o.plazo].nombre : '—'),
        infoRow('Fecha de entrega', o.fechaEntrega ? h('b', UI.fmtDay(o.fechaEntrega)) : '—'),
        infoRow('Precio', v.precioUSD ? [usd(num(v.precioUSD)), tcHoy() ? h('span.muted', ' = ' + ars(num(v.precioUSD) * tcHoy()) + ' hoy') : null] : '—'),
        infoRow('Seña', v.senaUSD ? [usd(num(v.senaUSD)), v.senaFecha ? h('span.muted', ' · ' + UI.fmtDay(v.senaFecha)) : null] : '—'),
        infoRow('Forma de pago', v.formaPago === 'financiado' ? 'Financiado' : 'Contado'),
        infoRow('Garantía', o.garantiaMeses ? o.garantiaMeses + ' meses' : '—'),
        v.notasVenta ? infoRow('Notas de la venta', h('div', { style: { whiteSpace: 'pre-wrap' } }, v.notasVenta)) : null),
      h('h2', 'La cancha y el cliente'),
      datosCancha(o),
    ];
  }

  /* ----- Solapa Administración ----- */
  function adminTab(o) {
    const v = ventas[o._id] || {};
    const fin = v.formaPago === 'financiado';
    const saldo = saldoUSD(v);
    const enAdmin = o.estado === 'vendida';
    const d = o.fechaEntrega ? UI.daysUntil(o.fechaEntrega) : null;
    let paso = null;
    if (o.estado === 'venta') paso = pasoBox('Todavía está en Ventas: falta completar la venta.', null);
    else if (enAdmin && condicionOk(v)) paso = pasoBox(fin ? 'Contrato firmado. Ya se puede entregar.' : 'Saldo cobrado. Ya se puede entregar.', h('button.btn.primary.small', { type: 'button', onclick: () => habilitar(o) }, 'Pasar a Entregas'));
    else if (enAdmin) paso = pasoBox(h('span', fin ? 'Falta el contrato firmado en nuestro poder.' : 'Falta cobrar el saldo antes de la entrega de materiales.', d != null && d <= AVISO_DIAS ? h('b', { style: { color: 'var(--red)' } }, ` Entrega ${UI.relDays(o.fechaEntrega)}: si no está, se retrasa.`) : null),
      h('button.btn.primary.small', { type: 'button', onclick: () => registrarCondicion(o) }, fin ? 'Contrato recibido' : 'Saldo cobrado'));
    else paso = pasoBox(`Listo: ${fin ? 'contrato firmado' : 'saldo cobrado'}. La obra ya pasó a ${AREAS[areaDe(o)].nombre}.`, null);
    return [
      paso,
      h('h2', fin ? 'Financiado' : 'Contado'),
      h('div.card.info',
        infoRow('Fecha de entrega', o.fechaEntrega ? [UI.fmtDay(o.fechaEntrega), !esTerminada(o) ? h('span.muted', ' (' + UI.relDays(o.fechaEntrega) + ')') : null] : '—'),
        infoRow('Precio', usd(num(v.precioUSD)) || '—'),
        infoRow('Seña', v.senaUSD ? [usd(num(v.senaUSD)), v.senaFecha ? h('span.muted', ' · ' + UI.fmtDay(v.senaFecha)) : null] : '—'),
        fin
          ? infoRow('Contrato', v.contratoFirmado ? h('span', h('span.badge.ok', 'Firmado'), ' ', UI.fmtDay(v.contratoFecha), v.contratoPorNombre ? h('span.muted', ' · ' + v.contratoPorNombre) : null) : h('span.badge.red', 'Falta firmado'))
          : infoRow('Saldo', v.saldoCobrado
            ? h('span', h('span.badge.ok', 'Cobrado'), ' ', UI.fmtDay(v.saldoCobradoFecha), v.saldoCobradoPorNombre ? h('span.muted', ' · ' + v.saldoCobradoPorNombre) : null)
            : h('span', h('b', usd(saldo) || '—'), tcHoy() && saldo ? h('span.muted', ' = ' + ars(saldo * tcHoy()) + ' hoy') : null, ' ', h('span.badge.red', 'Pendiente'))),
        v.saldoTC ? infoRow('Cobro en pesos', `${ars(num(v.saldoARS))} · TC BNA ${tcFmt(num(v.saldoTC))} del ${UI.fmtDay(v.saldoCobradoFecha)}`) : null),
      tcBox(),
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
    else paso = pasoBox(`${hechas} de ${(o.etapas || []).length} etapas hechas.`, h('button.btn.dark.small', { type: 'button', onclick: () => terminar(o) }, icon('check'), 'Marcar entregada'));
    return [
      paso,
      !term && esCurso(o) ? h('div', { style: { margin: '12px 0 0' } }, progressBar(pct)) : null,
      h('h2', 'Agenda y equipo'),
      entregaCard(o),
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
      h('div.card.info', infoRow('Garantía', o.garantiaMeses ? `${o.garantiaMeses} meses · vence ${UI.fmtDay(garantiaVence(o))} (${UI.relDays(garantiaVence(o))})` : 'Sin cargar'), infoRow('Entregada', UI.fmtDay(o.fin))),
      canVenta ? h('div', { style: { marginTop: '20px' } }, h('button.btn.small.ghost', { type: 'button', onclick: () => reabrir(o) }, 'Reabrir la obra (vuelve a Entregas)')) : null,
    ];
  }

  // Datos mínimos para que una venta pase a Administración.
  function faltanDatosVenta(o, v) {
    const f = [];
    if (!o.cliente) f.push('cliente');
    if (!o.fechaEntrega) f.push('fecha de entrega');
    if (!num(v.precioUSD)) f.push('precio');
    return f;
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

  /* ---------- Administración: cobro o contrato y paso a Entregas ---------- */

  function registrarCondicion(o) {
    const v = ventas[o._id] || {};
    const financiado = v.formaPago === 'financiado';
    const body = h('div',
      h('p.muted', { style: { marginTop: '-8px' } }, o.nombre),
      UI.field({ label: financiado ? 'Fecha en que se recibió el contrato firmado' : 'Fecha en que se cobró el saldo', name: 'fecha', type: 'date', value: UI.today() }),
      financiado ? null : h('div.row', { style: { gap: '10px' } },
        h('div.grow', UI.field({ label: 'Dólar BNA vendedor de ese día ($)', name: 'tc', value: tcDe(UI.today()) ? tcFmt(tcDe(UI.today())) : 'Sin dato del BNA' })),
        h('div.grow', UI.field({ label: 'Cobrado en pesos ($)', name: 'ars', inputMode: 'numeric', value: tcDe(UI.today()) ? Math.round(saldoUSD(v) * tcDe(UI.today())) : '' }))),
      financiado ? null : h('p.small.muted', { style: { marginTop: '-6px' } }, `Saldo: ${usd(saldoUSD(v))}. Si pagó en dólares, dejá los pesos vacíos.`),
      esVendida(o) ? h('label.check', h('input', { type: 'checkbox', name: 'habilitar', checked: true }), 'Pasar a Entregas ahora') : null);
    // El tipo de cambio sale solo del Banco Nación según la fecha del cobro; no se escribe a mano.
    const tcInp = body.querySelector('[name=tc]');
    const fechaInp = body.querySelector('[name=fecha]');
    if (tcInp) {
      tcInp.readOnly = true;
      fechaInp.addEventListener('change', () => {
        const tc = tcDe(fechaInp.value);
        tcInp.value = tc ? tcFmt(tc) : 'Sin dato del BNA';
        body.querySelector('[name=ars]').value = tc ? Math.round(saldoUSD(v) * tc) : '';
      });
    }
    UI.sheet({
      title: financiado ? 'Contrato firmado' : 'Saldo cobrado',
      body: [body],
      actions: [{ label: 'Cancelar' }, {
        label: 'Guardar', kind: 'primary', onClick: () => {
          const val = UI.values(body);
          const data = financiado
            ? { contratoFirmado: true, contratoFecha: val.fecha || UI.today(), contratoPor: me.email, contratoPorNombre: me.nombre }
            : { saldoCobrado: true, saldoCobradoFecha: val.fecha || UI.today(), saldoCobradoPor: me.email, saldoCobradoPorNombre: me.nombre, saldoTC: tcDe(val.fecha || UI.today()) ? String(tcDe(val.fecha || UI.today())) : '', saldoARS: val.ars ? String(num(val.ars)) : '' };
          cloud.write([{ op: ventas[o._id] ? 'update' : 'set', col: 'ventas', id: o._id, data: { ...data, ...stamp() } }]);
          if (val.habilitar) setTimeout(() => habilitar(o, true), 0);
          else UI.toast('Guardado');
        },
      }],
    });
  }

  function habilitar(o, force) {
    if (!force && !condicionOk(ventas[o._id])) return UI.toast(faltaTexto(ventas[o._id]));
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

  function entregaCard(o) {
    const sup = superpuestas(o, o.equipo, o.instInicio, o.instFin);
    return h('div.card.info',
      infoRow('Fecha de entrega', o.fechaEntrega ? UI.fmtDay(o.fechaEntrega) : '—'),
      infoRow('Instalación', h('span.row.wrap', { style: { gap: '8px' } }, o.instInicio ? fechasInst(o) : 'Sin programar',
        !esTerminada(o) && o.conInstalacion !== false ? h('button.btn.small', { type: 'button', onclick: () => programar(o) }, icon('calendar'), o.instInicio ? 'Cambiar' : 'Programar') : null)),
      o.conInstalacion !== false ? infoRow('Equipo', [o.equipo || '—', sup.length ? h('div.small', { style: { color: 'var(--warn)' } }, '⚠ Ese equipo también está en: ' + sup.map((x) => x.nombre).join(', ')) : null]) : null,
      infoRow('Responsable de entrega', o.responsable ? userName(o.responsable) : '—'),
      infoRow('Flete', h('span.row.wrap', { style: { gap: '8px' } }, o.flete || '—', !esTerminada(o) ? h('button.btn.small.ghost', { type: 'button', onclick: () => editFlete(o) }, icon('edit')) : null)),
      o.habilitadaFecha ? h('div.small.muted', { style: { marginTop: '6px' } }, `Entrega habilitada el ${UI.fmtDay(o.habilitadaFecha)}${o.habilitadaPorNombre ? ' por ' + o.habilitadaPorNombre : ''}`) : null);
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
    const desde = UI.field({ label: 'Instalación desde', name: 'instInicio', type: 'date', value: o.instInicio || o.fechaEntrega || UI.today() });
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
    const entregas = obras.filter((o) => esVendida(o) && o.fechaEntrega && !o.instInicio);
    const moveMonth = (n) => { const d = new Date(y, m - 1 + n, 1); ui.agendaMes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; render(); };

    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(h('div.cal-day.out'));
    for (let d = 1; d <= days; d++) {
      const day = iso(d);
      const inst = conFecha.filter((o) => day >= o.instInicio && day <= (o.instFin || o.instInicio));
      const ent = entregas.filter((o) => o.fechaEntrega === day);
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
        !i.resuelta ? h('div.small', { style: { color: i.avisadoCliente ? 'var(--ok)' : 'var(--red)' } }, i.avisadoCliente ? 'Cliente avisado' : 'Falta avisar al cliente') : h('div.small.muted', 'Resuelta ' + UI.fmtDay(i.resueltaFecha))),
      icon('chev'))));
  }

  function nuevaIncidencia(o, tipo) { editIncidencia(o, null, tipo); }

  function editIncidencia(o, inc, tipoInicial) {
    const isNew = !inc;
    const body = h('div',
      h('p.muted', { style: { marginTop: '-8px' } }, o.nombre),
      UI.field({ label: 'Qué pasó', name: 'tipo', type: 'select', value: inc ? inc.tipo : tipoInicial || window.OBRAS_INCIDENCIAS[0], options: window.OBRAS_INCIDENCIAS.map((t) => [t, t]) }),
      UI.field({ label: 'Detalle', name: 'detalle', type: 'textarea', value: inc ? inc.detalle : '', placeholder: 'Ej: la base tiene desnivel en el sector norte, no se puede instalar' }),
      h('label.check', h('input', { type: 'checkbox', name: 'avisadoCliente', checked: !!(inc && inc.avisadoCliente) }), 'Cliente avisado'),
      !isNew ? h('label.check', h('input', { type: 'checkbox', name: 'resuelta', checked: !!inc.resuelta }), 'Resuelta') : null);
    UI.sheet({
      title: isNew ? 'Nueva incidencia' : 'Incidencia',
      body: [body],
      actions: [
        !isNew && canVenta ? { label: 'Eliminar', kind: 'danger', onClick: () => { cloud.patch('obras', o._id, { incidencias: (o.incidencias || []).filter((x) => x.id !== inc.id), ...stamp() }); } } : { label: 'Cancelar' },
        {
          label: 'Guardar', kind: 'primary', onClick: () => {
            const v = UI.values(body);
            const list = (o.incidencias || []).map((x) => ({ ...x }));
            if (isNew) {
              list.unshift({ id: uid(), tipo: v.tipo, detalle: v.detalle, avisadoCliente: v.avisadoCliente, resuelta: false, fecha: UI.today(), por: me.email, porNombre: me.nombre });
            } else {
              const k = list.findIndex((x) => x.id === inc.id);
              list[k] = { ...inc, tipo: v.tipo, detalle: v.detalle, avisadoCliente: v.avisadoCliente, resuelta: v.resuelta, resueltaFecha: v.resuelta && !inc.resuelta ? UI.today() : v.resuelta ? inc.resueltaFecha : '' };
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
    const cls = e.estado === 'hecha' ? 'done' : e.estado === 'en_curso' ? 'doing' : '';
    return h('div.item.etapa', { onclick: () => editEtapa(o, i) },
      h('span.dot', { class: cls }, e.estado === 'hecha' ? icon('check') : String(i + 1)),
      h('div.grow',
        h('div', { style: { fontWeight: e.estado === 'en_curso' ? 700 : 500 } }, e.nombre),
        e.estado !== 'pendiente' || e.nota || n ? h('div.small.muted',
          [e.estado === 'hecha' ? `Hecha ${UI.fmtDay(e.fecha)}${e.porNombre ? ' · ' + e.porNombre : ''}` : e.estado === 'en_curso' ? 'En curso' : '',
            n ? `${n} foto${n > 1 ? 's' : ''}` : '',
            e.nota ? '“' + e.nota + '”' : ''].filter(Boolean).join(' · ')) : null),
      icon('chev'));
  }

  function editEtapa(o, i) {
    const e = o.etapas[i];
    let estado = e.estado;
    const segEl = h('div.seg');
    const paintSeg = () => segEl.replaceChildren(...[['pendiente', 'Pendiente'], ['en_curso', 'En curso'], ['hecha', 'Hecha']].map(([v, t]) =>
      h('button', { type: 'button', class: estado === v ? 'on' : '', onclick: () => { estado = v; paintSeg(); fechaWrap.hidden = estado !== 'hecha'; } }, t)));
    paintSeg();
    const fechaWrap = UI.field({ label: 'Fecha en que se terminó', name: 'fecha', type: 'date', value: e.fecha || UI.today() });
    fechaWrap.hidden = estado !== 'hecha';
    const nota = UI.field({ label: 'Nota', name: 'nota', type: 'textarea', value: e.nota, placeholder: 'Ej: faltó material, llovió, se reprogramó…' });
    const propias = fotos.filter((f) => f.etapaId === e.id);
    const esBase = /base/i.test(e.nombre);
    const body = h('div', h('p.muted', { style: { marginTop: '-8px' } }, o.nombre), segEl, fechaWrap, nota,
      esBase ? h('button.btn.danger.small', { type: 'button', style: { marginBottom: '12px', paddingLeft: 0 }, onclick: () => { sh.close(); nuevaIncidencia(o, 'Base no apta'); } }, '⚠ La base no está apta: registrar y avisar al cliente') : null,
      h('div.row', { style: { marginBottom: '10px' } }, h('b.grow', 'Fotos de esta etapa'),
        h('button.btn.small', { type: 'button', onclick: async () => { await guardar(); sh.close(); addFotos(o, e.id); } }, icon('camera'), 'Agregar')),
      fotosGrid(propias, o, false));
    async function guardar() {
      const v = UI.values(body);
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

  function editEtapas(o) {
    let etapas = (o.etapas || []).map((e) => ({ ...e }));
    const listEl = h('div');
    function paint() {
      listEl.replaceChildren(...etapas.map((e, i) => {
        const inp = h('input', { value: e.nombre, placeholder: 'Nombre de la etapa' });
        inp.addEventListener('input', () => { e.nombre = inp.value; });
        return h('div.edit-row',
          h('span.small.muted', { style: { width: '20px' } }, i + 1),
          inp,
          h('button.btn.small.ghost', { type: 'button', disabled: i === 0, onclick: () => { [etapas[i - 1], etapas[i]] = [etapas[i], etapas[i - 1]]; paint(); } }, icon('up')),
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
      ...((conArena ?? t.arena) ? c.arena : []),
      ...((conCaucho ?? t.caucho) ? c.caucho : []),
      ...(t.estructura ? c.estructura : []),
    ];
    return list.map((texto) => ({ id: uid(), texto, ok: false }));
  }

  /* ---------- Entregar / reabrir ---------- */

  function terminar(o) {
    const faltanEt = (o.etapas || []).filter((e) => e.estado !== 'hecha').length;
    const faltanCh = (o.checklist || []).filter((c) => !c.ok).length;
    const incAb = (o.incidencias || []).filter((i) => !i.resuelta).length;
    const avisos = [];
    if (faltanEt) avisos.push(`${faltanEt} etapa${faltanEt > 1 ? 's' : ''} sin terminar`);
    if (faltanCh) avisos.push(`${faltanCh} control${faltanCh > 1 ? 'es' : ''} del checklist sin tildar`);
    if (incAb) avisos.push(`${incAb} incidencia${incAb > 1 ? 's' : ''} sin resolver`);
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
          : `${p.label} · ${o.cliente || 'sin cliente'} · ${UI.fmtDay(p.fecha)}`)),
      badge);
  }

  function llamadoSheet(o, p) {
    const msg = `Hola${o.cliente ? ' ' + o.cliente.split(' ')[0] : ''}, te escribimos de SLAVON. Queríamos saber cómo viene la cancha de ${o.nombre} y si necesitás algo. ¡Saludos!`;
    const wa = UI.waLink(o.telefono, msg);
    const nota = UI.field({ label: 'Cómo le fue / qué dijo el cliente', name: 'nota', type: 'textarea', value: p.nota, placeholder: 'Ej: todo bien, pide recarga de arena en marzo' });
    UI.sheet({
      title: `Llamado de ${p.label}`,
      body: [
        h('p', h('b', o.nombre), h('br'), h('span.muted', `${o.cliente || 'Sin cliente cargado'} · agendado para el ${UI.fmtDay(p.fecha)}`)),
        o.telefono ? h('div.row', { style: { marginBottom: '16px' } },
          h('a.btn.grow', { href: 'tel:' + o.telefono.replace(/\s/g, '') }, icon('phone'), 'Llamar'),
          wa ? h('a.btn.grow', { href: wa, target: '_blank', rel: 'noopener' }, icon('whatsapp'), 'WhatsApp') : null)
          : h('p.small.muted', 'La obra no tiene teléfono cargado. Agregalo desde «Editar».'),
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

  function viewActa(id) {
    const o = obras.find((x) => x._id === id);
    if (!o) { setMain(backBtn(), h('div.card.empty', 'Cargando…')); return; }
    watchFotos(id);
    const t = TIPOS[o.tipo] || TIPOS.otro;
    const finales = fotos.filter((f) => /cepillado|entregado|informe/i.test(((o.etapas || []).find((e) => e.id === f.etapaId) || {}).nombre || ''));
    const fotosActa = (finales.length ? finales : fotos).slice(0, 6);
    const fecha = o.fin || UI.today();
    const vence = num(o.garantiaMeses) ? UI.addMonths(fecha, num(o.garantiaMeses)) : '';
    const row = (k, v) => (v ? h('tr', h('th', k), h('td', v)) : null);
    const editable = (txt) => h('div.acta-edit', { contentEditable: 'true' }, txt);
    setMain(
      h('div.acta-tools.no-print',
        backBtn(),
        h('span.grow'),
        h('button.btn.primary', { type: 'button', onclick: () => window.print() }, 'Imprimir / Guardar PDF')),
      h('p.small.muted.no-print', 'Revisá el acta. Las observaciones se pueden escribir acá antes de imprimir. Para mandarla por WhatsApp: «Guardar como PDF» en la ventana de impresión.'),
      h('div.acta',
        h('div.acta-head',
          h('img', { src: '../shared/icons/logo.png', alt: 'SLAVON' }),
          h('div', h('div.acta-title', 'Acta de entrega'), h('div.acta-sub', `N° ${o._id.slice(0, 8).toUpperCase()} · ${UI.fmtDay(fecha)}`))),
        h('h3', 'Cliente y obra'),
        h('table.acta-table', h('tbody',
          row('Cliente', o.cliente), row('Teléfono', o.telefono), row('Obra', o.nombre), row('Ubicación', o.ubicacion))),
        h('h3', 'Trabajo entregado'),
        h('table.acta-table', h('tbody',
          row('Tipo', tipoNombre(o.tipo) + (num(o.cantidad) > 1 ? ` · ${o.cantidad} canchas` : '')),
          row('Superficie', o.m2 ? o.m2 + ' m²' : ''),
          row('Césped', o.cesped),
          row('Incluye', [o.conInstalacion === false ? 'Provisión sin instalación' : 'Provisión e instalación', (o.conArena ?? t.arena) ? 'arena' : '', (o.conCaucho ?? t.caucho) ? 'caucho' : ''].filter(Boolean).join(' · ')),
          row('Instalación', fechasInst(o)),
          row('Fecha de entrega', UI.fmtDay(fecha)))),
        h('h3', 'Controles de entrega'),
        h('ul.acta-check', (o.checklist || []).map((c) => h('li', { class: c.ok ? 'ok' : '' }, (c.ok ? '☑ ' : '☐ ') + c.texto))),
        fotosActa.length ? [h('h3', 'Fotos'), h('div.acta-fotos', fotosActa.map((f) => h('img', { src: 'data:image/jpeg;base64,' + f.data })))] : null,
        h('h3', 'Garantía y mantenimiento'),
        h('p', vence ? `Garantía de ${o.garantiaMeses} meses desde la fecha de entrega, válida hasta el ${UI.fmtDay(vence)}, según las condiciones del certificado de garantía.` : 'Garantía según las condiciones del certificado de garantía.',
          ' Se entregan al cliente el certificado de garantía y el manual de mantenimiento. El mantenimiento periódico indicado en el manual es condición para la garantía.'),
        h('h3', 'Observaciones'),
        editable((o.incidencias || []).filter((i) => !i.resuelta).map((i) => `${i.tipo}: ${i.detalle}`).join('\n') || 'Sin observaciones.'),
        h('p.small', 'El cliente recibe el trabajo descripto, en las condiciones indicadas, y deja constancia de que se le explicó el uso y el mantenimiento de la cancha.'),
        h('div.acta-firmas',
          h('div', h('div.line'), 'Por SLAVON', h('div.small', 'Firma y aclaración')),
          h('div', h('div.line'), 'Cliente', h('div.small', 'Firma, aclaración y DNI')))),
    );
  }

  /* ---------- Alta / edición de venta-obra ---------- */

  function editObra(o) {
    if (!canVenta) return;
    const isNew = !o;
    const v = (o && ventas[o._id]) || {};
    const t0 = TIPOS[o ? o.tipo : 'futbol'];
    const body = h('div',
      h('h3', { style: { margin: '0 0 10px' } }, 'La cancha'),
      UI.field({ label: 'Nombre de la obra', name: 'nombre', value: o ? o.nombre : '', required: true, placeholder: 'Ej: Club Huracán – Cancha 1' }),
      UI.field({ label: 'Tipo', name: 'tipo', type: 'select', value: o ? o.tipo : 'futbol', options: Object.entries(TIPOS).map(([k, t]) => [k, t.nombre]) }),
      h('div.row', { style: { gap: '10px' } },
        h('div.grow', UI.field({ label: 'Cantidad de canchas', name: 'cantidad', type: 'number', inputMode: 'numeric', value: o ? o.cantidad || 1 : 1 })),
        h('div.grow', UI.field({ label: 'm²', name: 'm2', inputMode: 'numeric', value: o ? o.m2 : '' }))),
      UI.field({ label: 'Tipo de césped', name: 'cesped', value: o ? o.cesped : '', placeholder: 'Modelo / altura / color' }),
      h('label.check', h('input', { type: 'checkbox', name: 'conInstalacion', checked: !o || o.conInstalacion !== false }), 'Con instalación'),
      h('label.check', h('input', { type: 'checkbox', name: 'conArena', checked: o ? (o.conArena ?? t0.arena) : t0.arena }), 'Lleva arena'),
      h('label.check', h('input', { type: 'checkbox', name: 'conCaucho', checked: o ? (o.conCaucho ?? t0.caucho) : t0.caucho }), 'Lleva caucho'),
      UI.field({ label: 'Plano y consideraciones especiales', name: 'consideraciones', type: 'textarea', value: o ? o.consideraciones : '', placeholder: 'Ej: base de hormigón existente, acceso angosto, plano en la carpeta del cliente en Drive' }),
      isNew ? null : h('p.small.muted', 'Cambiar el tipo o lo que lleva no cambia las etapas ya armadas: para eso usá «Editar etapas».'),

      h('h3', { style: { margin: '18px 0 10px' } }, 'Cliente'),
      UI.field({ label: 'Cliente', name: 'cliente', value: o ? o.cliente : '', placeholder: 'Nombre y apellido o club' }),
      UI.field({ label: 'Teléfono', name: 'telefono', type: 'tel', value: o ? o.telefono : '', placeholder: 'Ej: 11 5555 5555' }),
      UI.field({ label: 'Ubicación', name: 'ubicacion', value: o ? o.ubicacion : '', placeholder: 'Dirección o localidad' }),
      h('label.check', h('input', { type: 'checkbox', name: 'interior', checked: !!(o && o.interior) }), 'Obra en el interior (viaja el instalador)'),

      h('h3', { style: { margin: '18px 0 10px' } }, 'Venta'),
      h('div.row', { style: { gap: '10px' } },
        h('div.grow', UI.field({ label: 'Fecha de venta', name: 'fechaVenta', type: 'date', value: o ? o.fechaVenta : UI.today() })),
        h('div.grow', UI.field({ label: 'Vendió', name: 'vendio', value: v.vendio || '', placeholder: 'Ej: Melina' }))),
      UI.field({ label: 'Plazo', name: 'plazo', type: 'select', value: o ? o.plazo || 'inmediata' : 'inmediata', options: Object.entries(window.OBRAS_PLAZOS).map(([k, p]) => [k, p.nombre]) }),
      UI.field({ label: 'Fecha de entrega', name: 'fechaEntrega', type: 'date', value: o ? o.fechaEntrega : UI.addDays(UI.today(), 5) }),
      h('div.row', { style: { gap: '10px' } },
        h('div.grow', UI.field({ label: 'Precio total (US$)', name: 'precioUSD', inputMode: 'numeric', value: v.precioUSD || '' })),
        h('div.grow', UI.field({ label: 'Seña (US$)', name: 'senaUSD', inputMode: 'numeric', value: v.senaUSD || '' }))),
      UI.field({ label: 'Fecha de la seña', name: 'senaFecha', type: 'date', value: v.senaFecha || (isNew ? UI.today() : '') }),
      UI.field({ label: 'Forma de pago', name: 'formaPago', type: 'select', value: v.formaPago || 'contado', options: [['contado', 'Contado (saldo antes de la entrega)'], ['financiado', 'Financiado (contrato firmado antes de la entrega)']] }),
      UI.field({ label: 'Garantía (meses)', name: 'garantiaMeses', type: 'number', inputMode: 'numeric', value: o ? o.garantiaMeses || '' : '' }),
      UI.field({ label: 'Notas de la venta', name: 'notasVenta', type: 'textarea', value: v.notasVenta || '', placeholder: 'Sólo la ven admin y administración' }),

      h('h3', { style: { margin: '18px 0 10px' } }, 'Otras notas'),
      UI.field({ label: 'Notas de la obra', name: 'notas', type: 'textarea', value: o ? o.notas : '', placeholder: 'Las ven todos, también los encargados de obra' }),
      h('p.small.muted', 'Con cliente, precio y fecha de entrega la venta queda completa y pasa sola a Administración.'));

    // Al cambiar el tipo, ajusta arena y caucho según lo normal de ese tipo.
    const sel = body.querySelector('[name=tipo]');
    sel.addEventListener('change', () => {
      const t = TIPOS[sel.value] || TIPOS.otro;
      body.querySelector('[name=conArena]').checked = t.arena;
      body.querySelector('[name=conCaucho]').checked = t.caucho;
    });
    // Al cambiar el plazo o la fecha de venta, propone la fecha de entrega.
    const plazoSel = body.querySelector('[name=plazo]');
    const fv = body.querySelector('[name=fechaVenta]');
    const fe = body.querySelector('[name=fechaEntrega]');
    const proponer = () => { if (fv.value) fe.value = UI.addDays(fv.value, window.OBRAS_PLAZOS[plazoSel.value].dias); };
    plazoSel.addEventListener('change', proponer);
    fv.addEventListener('change', proponer);

    const actions = [{ label: 'Cancelar' }, {
      label: isNew ? 'Cargar venta' : 'Guardar', kind: 'primary', onClick: () => {
        const val = UI.values(body);
        if (!val.nombre) throw new Error('Poné el nombre de la obra.');
        if (num(val.senaUSD) > num(val.precioUSD) && num(val.precioUSD)) throw new Error('La seña no puede ser mayor que el precio.');
        const obra = {
          nombre: val.nombre, tipo: val.tipo, cantidad: Math.max(1, num(val.cantidad) || 1), m2: val.m2, cesped: val.cesped,
          conInstalacion: val.conInstalacion, conArena: val.conArena, conCaucho: val.conCaucho, consideraciones: val.consideraciones,
          cliente: val.cliente, telefono: val.telefono, ubicacion: val.ubicacion, interior: val.interior,
          fechaVenta: val.fechaVenta, plazo: val.plazo, fechaEntrega: val.fechaEntrega, garantiaMeses: val.garantiaMeses,
          notas: val.notas, ...stamp(),
        };
        const venta = {
          precioUSD: val.precioUSD, senaUSD: val.senaUSD, senaFecha: val.senaFecha, formaPago: val.formaPago, vendio: val.vendio, notasVenta: val.notasVenta, ...stamp(),
        };
        if (isNew) {
          const id = cloud.newId();
          const opts = { conInstalacion: val.conInstalacion, conArena: val.conArena, conCaucho: val.conCaucho };
          cloud.write([
            {
              op: 'set', col: 'obras', id, data: {
                ...obra, estado: faltanDatosVenta(obra, venta).length ? 'venta' : 'vendida', fin: '', postventa: [], incidencias: [], responsable: '', equipo: '', flete: '',
                instInicio: '', instFin: '', inicio: '',
                etapas: window.obrasEtapas(val.tipo, opts).map((nombre) => ({ id: uid(), nombre, estado: 'pendiente', nota: '' })),
                checklist: checklistDefault(val.tipo, opts),
                logistica: val.interior ? window.OBRAS_LOGISTICA.map((texto) => ({ id: uid(), texto, ok: false })) : [],
                creadoPor: me.email, creadoPorNombre: me.nombre, creadoEn: cloud.serverTime(),
              },
            },
            { op: 'set', col: 'ventas', id, data: { ...venta, saldoCobrado: false, contratoFirmado: false } },
          ]);
          go('obra/' + id + '/venta');
          UI.toast(faltanDatosVenta(obra, venta).length ? 'Venta guardada: faltan datos para pasar a Administración' : 'Venta cargada: pasó a Administración');
        } else {
          if (o.estado === 'venta' && !faltanDatosVenta(obra, venta).length) obra.estado = 'vendida';
          if (obra.interior && !(o.logistica || []).length) obra.logistica = window.OBRAS_LOGISTICA.map((texto) => ({ id: uid(), texto, ok: false }));
          cloud.write([
            { op: 'update', col: 'obras', id: o._id, data: obra },
            { op: ventas[o._id] ? 'update' : 'set', col: 'ventas', id: o._id, data: venta },
          ]);
          UI.toast(obra.estado === 'vendida' ? 'Venta completa: pasó a Administración' : 'Guardado');
        }
      },
    }];
    if (!isNew && isAdmin) {
      actions.unshift({
        label: 'Eliminar', kind: 'danger', onClick: async () => {
          if (!(await UI.confirm('¿Eliminar la obra?', `Se borra «${o.nombre}» con su venta y todas sus fotos. No se puede deshacer.`, 'Eliminar'))) return false;
          const ops = [{ op: 'delete', col: 'obras', id: o._id }, { op: 'delete', col: 'ventas', id: o._id }, ...fotos.filter((f) => f.obraId === o._id).map((f) => ({ op: 'delete', col: 'fotos', id: f._id }))];
          for (let i = 0; i < ops.length; i += 400) cloud.write(ops.slice(i, i + 400));
          go('obras');
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
    cloud.seedOnce('v4', (put) => {
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
      const etapas = (tipo, hechas, enCurso, opts = {}, desde = -2 * hechas, quien = 'Beto (demo)') => window.obrasEtapas(tipo, opts).map((nombre, i) => ({
        id: 'e' + i, nombre,
        estado: i < hechas ? 'hecha' : i === hechas && enCurso ? 'en_curso' : 'pendiente',
        fecha: i < hechas ? d(desde + i * 2) : '', porNombre: i < hechas ? quien : '', por: '', nota: '',
      }));
      const check = (tipo, todo, opts) => checklistDefault(tipo, opts).map((c) => (todo ? { ...c, ok: true, porNombre: 'Carajo (demo)', fecha: t } : c));
      const pv = (fin, hechos) => window.OBRAS_POSTVENTA.map((p, i) => ({ id: p.id, label: p.label, fecha: UI.addMonths(fin, p.meses), hecho: i < hechos, nota: i < hechos ? 'Todo bien, contentos con la cancha.' : '', porNombre: i < hechos ? 'Delfina (demo)' : '', hechoFecha: i < hechos ? UI.addMonths(fin, p.meses) : '' }));
      const base = { incidencias: [], flete: '', editadoPorNombre: 'Delfina (demo)', creadoPorNombre: 'Delfina (demo)', cantidad: 1, interior: false, logistica: [], garantiaMeses: '12', postventa: [], responsable: '', equipo: '', instInicio: '', instFin: '', fin: '' };
      const obra = (id, o, v) => { put('obras', id, { ...base, ...o }); put('ventas', id, { vendio: 'Melina', ...v }); };
      const foto = (obraId, etapaId, texto, padel, dias = 0, quien = 'Beto (demo)') => put('fotos', obraId + '_' + etapaId + '_' + texto.length, {
        obraId, etapaId, data: fotoEjemplo(texto, padel ? '#2b6cb0' : '#2f8f46', padel), nota: '', por: '', porNombre: quien, fecha: new Date(Date.now() + dias * 864e5).toISOString(),
      });

      /* ----- En Ventas (incompleta) ----- */
      obra('v0', { nombre: 'Club Ferro – Pádel 5', tipo: 'padel_cesped', m2: '200', cesped: 'Fibrilado 12 mm azul', cliente: 'Club Ferro (Sr. Ruiz)', telefono: '11 5555 0100', ubicacion: 'Caballito, CABA', fechaVenta: t, plazo: 'inmediata', fechaEntrega: '', estado: 'venta', etapas: etapas('padel_cesped', 0), checklist: check('padel_cesped') },
        { precioUSD: '', senaUSD: '', formaPago: 'contado', saldoCobrado: false, notasVenta: 'Esperando que confirme si es 1 o 2 canchas para pasar precio.' });

      /* ----- En Administración ----- */
      obra('v1', { nombre: 'Club Los Robles – Pádel 1 y 2', tipo: 'padel_cesped', cantidad: 2, m2: '400', cesped: 'Fibrilado 12 mm verde', conArena: true, conCaucho: false, cliente: 'Martín Robles', telefono: '11 5555 0101', ubicacion: 'Tigre, Buenos Aires', fechaVenta: d(-2), plazo: 'inmediata', fechaEntrega: d(3), estado: 'vendida', etapas: etapas('padel_cesped', 0), checklist: check('padel_cesped') },
        { precioUSD: '9600', senaUSD: '4800', senaFecha: d(-2), formaPago: 'contado', saldoCobrado: false });
      obra('v2', { nombre: 'Escuela San Martín – F7', tipo: 'futbol', m2: '1200', cesped: 'Monofilamento 50 mm', cliente: 'Escuela San Martín (Lic. Paz)', telefono: '11 5555 0102', ubicacion: 'Lanús, Buenos Aires', fechaVenta: d(-6), plazo: 'fabricacion', fechaEntrega: d(19), estado: 'vendida', etapas: etapas('futbol', 0), checklist: check('futbol'), consideraciones: 'Plano en la carpeta del cliente. Acceso por calle lateral para el camión.' },
        { precioUSD: '24000', senaUSD: '7200', senaFecha: d(-6), formaPago: 'financiado', contratoFirmado: false });
      obra('v3', { nombre: 'Casa Fernández – Jardín', tipo: 'residencial', m2: '90', cesped: 'Paisajismo 35 mm', conArena: false, conCaucho: false, cliente: 'Laura Fernández', telefono: '11 5555 0103', ubicacion: 'Adrogué, Buenos Aires', fechaVenta: d(-20), plazo: 'inmediata', fechaEntrega: d(5), estado: 'vendida', etapas: etapas('residencial', 0), checklist: check('residencial'), garantiaMeses: '24' },
        { precioUSD: '2100', senaUSD: '1050', senaFecha: d(-20), formaPago: 'contado', saldoCobrado: true, saldoCobradoFecha: d(-1), saldoCobradoPorNombre: 'Delfina (demo)', saldoTC: '1570', saldoARS: '1648500' });
      obra('v4', { nombre: 'Club Atlético Ituzaingó – Hockey', tipo: 'hockey', m2: '5200', cesped: 'Hockey arena 22 mm azul', cliente: 'C. A. Ituzaingó (Comisión)', telefono: '11 5555 0104', ubicacion: 'Ituzaingó, Buenos Aires', fechaVenta: d(-28), plazo: 'fabricacion', fechaEntrega: d(2), estado: 'vendida', etapas: etapas('hockey', 0), checklist: check('hockey') },
        { precioUSD: '86000', senaUSD: '25800', senaFecha: d(-28), formaPago: 'financiado', contratoFirmado: false, notasVenta: 'Financiado en 12 cuotas. Falta que firme el presidente del club.' });
      obra('v5', { nombre: 'Padel Point Rosario – 3 canchas', tipo: 'padel_completa', cantidad: 3, m2: '600', cesped: 'Textil pádel azul', cliente: 'Padel Point SRL', telefono: '341 555 0105', ubicacion: 'Rosario, Santa Fe', interior: true, logistica: window.OBRAS_LOGISTICA.map((texto, i) => ({ id: 'l' + i, texto, ok: false })), fechaVenta: d(-4), plazo: 'fabricacion', fechaEntrega: d(24), estado: 'vendida', etapas: etapas('padel_completa', 0), checklist: check('padel_completa') },
        { precioUSD: '81000', senaUSD: '40500', senaFecha: d(-4), formaPago: 'contado', saldoCobrado: false });
      obra('v6', { nombre: 'Sr. Gómez – césped sin instalación', tipo: 'futbol', m2: '300', cesped: 'Monofilamento 40 mm', conInstalacion: false, cliente: 'Ricardo Gómez', telefono: '11 5555 0106', ubicacion: 'Merlo, Buenos Aires', fechaVenta: d(-7), plazo: 'inmediata', fechaEntrega: d(-1), estado: 'vendida', etapas: etapas('futbol', 0, false, { conInstalacion: false }), checklist: check('futbol', false, { conInstalacion: false }) },
        { precioUSD: '3900', senaUSD: '1950', senaFecha: d(-7), formaPago: 'contado', saldoCobrado: false });

      /* ----- En entrega ----- */
      obra('e1', { nombre: 'Club Huracán – Cancha 1', tipo: 'futbol', m2: '1800', cesped: 'Monofilamento 50 mm verde', cliente: 'C. A. Huracán (Intendencia)', telefono: '11 5555 0201', ubicacion: 'Parque Patricios, CABA', fechaVenta: d(-40), plazo: 'fabricacion', fechaEntrega: d(-12), estado: 'en_curso', habilitadaFecha: d(-14), habilitadaPorNombre: 'Delfina (demo)', instInicio: d(-10), instFin: d(2), equipo: 'Equipo AMBA 1', responsable: CAR, flete: 'Transporte del Sur · llegó el ' + UI.fmtDay(d(-11)), etapas: etapas('futbol', 5, true, {}, -10), checklist: check('futbol') },
        { precioUSD: '38000', senaUSD: '19000', senaFecha: d(-40), formaPago: 'contado', saldoCobrado: true, saldoCobradoFecha: d(-14), saldoCobradoPorNombre: 'Delfina (demo)', saldoTC: '1545', saldoARS: '29355000' });
      obra('e2', { nombre: 'La Finca – Pádel 2 y 3', tipo: 'padel_completa', cantidad: 2, m2: '400', cesped: 'Textil pádel azul', cliente: 'La Finca Country (Adm.)', telefono: '11 5555 0202', ubicacion: 'Pilar, Buenos Aires', fechaVenta: d(-50), plazo: 'fabricacion', fechaEntrega: d(-6), estado: 'en_curso', habilitadaFecha: d(-8), habilitadaPorNombre: 'Delfina (demo)', instInicio: d(-5), instFin: d(4), equipo: 'Equipo AMBA 2', responsable: BETO, etapas: etapas('padel_completa', 5, true, {}, -5), checklist: check('padel_completa') },
        { precioUSD: '52000', senaUSD: '15600', formaPago: 'financiado', contratoFirmado: true, contratoFecha: d(-9), contratoPorNombre: 'Delfina (demo)' });
      obra('e3', { nombre: 'Club Norte – Pádel 1', tipo: 'padel_completa', m2: '200', cesped: 'Textil pádel verde', cliente: 'Club Norte (Sr. Paredes)', telefono: '351 555 0203', ubicacion: 'Córdoba capital', interior: true, logistica: window.OBRAS_LOGISTICA.map((texto, i) => ({ id: 'l' + i, texto, ok: i < 3, porNombre: i < 3 ? 'Carajo (demo)' : '', fecha: i < 3 ? d(-15) : '' })), fechaVenta: d(-45), plazo: 'fabricacion', fechaEntrega: d(-16), estado: 'en_curso', habilitadaFecha: d(-18), instInicio: d(-14), instFin: d(-10), equipo: 'Instalador interior 1', responsable: CAR,
        etapas: etapas('padel_completa', 3, false, {}, -14, 'Carajo (demo)'), checklist: check('padel_completa'),
        incidencias: [{ id: 'i1', tipo: 'Falta material', detalle: 'Faltan 4 vidrios laterales, se pidieron a fábrica', avisadoCliente: true, resuelta: false, fecha: d(-11), porNombre: 'Carajo (demo)' }] },
        { precioUSD: '27000', senaUSD: '13500', formaPago: 'contado', saldoCobrado: true, saldoCobradoFecha: d(-18), saldoTC: '1540', saldoARS: '20790000' });
      obra('e4', { nombre: 'Tenis Club Banfield – Cancha 3', tipo: 'tenis', m2: '670', cesped: 'Tenis arena 20 mm', cliente: 'Tenis Club Banfield', telefono: '11 5555 0204', ubicacion: 'Banfield, Buenos Aires', fechaVenta: d(-30), plazo: 'fabricacion', fechaEntrega: d(1), estado: 'en_curso', habilitadaFecha: d(-2), habilitadaPorNombre: 'Delfina (demo)', instInicio: d(2), instFin: d(4), equipo: 'Equipo AMBA 3', responsable: BETO, flete: 'A coordinar', etapas: etapas('tenis', 0), checklist: check('tenis') },
        { precioUSD: '14500', senaUSD: '7250', formaPago: 'contado', saldoCobrado: true, saldoCobradoFecha: d(-2), saldoTC: '1570', saldoARS: '11382500' });
      obra('e5', { nombre: 'Complejo La Cantera – F5 1 y 2', tipo: 'futbol', cantidad: 2, m2: '1100', cesped: 'Monofilamento 50 mm', cliente: 'La Cantera SA', telefono: '11 5555 0205', ubicacion: 'Moreno, Buenos Aires', fechaVenta: d(-22), plazo: 'fabricacion', fechaEntrega: d(6), estado: 'en_curso', habilitadaFecha: t, habilitadaPorNombre: 'Delfina (demo)', responsable: BETO, etapas: etapas('futbol', 0), checklist: check('futbol') },
        { precioUSD: '30500', senaUSD: '15250', formaPago: 'contado', saldoCobrado: true, saldoCobradoFecha: t, saldoTC: '1570', saldoARS: '23942500' });
      obra('e6', { nombre: 'Colegio Sarmiento – Multisport', tipo: 'multisport', m2: '450', cesped: 'Multisport 25 mm verde/rojo', cliente: 'Colegio Sarmiento', telefono: '11 5555 0206', ubicacion: 'Haedo, Buenos Aires', fechaVenta: d(-25), plazo: 'fabricacion', fechaEntrega: d(1), estado: 'en_curso', habilitadaFecha: d(-1), instInicio: d(1), instFin: d(3), equipo: 'Equipo AMBA 1', responsable: CAR, etapas: etapas('multisport', 0), checklist: check('multisport') },
        { precioUSD: '9800', senaUSD: '4900', formaPago: 'contado', saldoCobrado: true, saldoCobradoFecha: d(-1) });
      obra('e7', { nombre: 'Tercer Tiempo – Mantenimiento F5', tipo: 'mantenimiento', m2: '800', cliente: 'Tercer Tiempo (Diego)', telefono: '11 5555 0207', ubicacion: 'Morón, Buenos Aires', fechaVenta: d(-3), plazo: 'inmediata', fechaEntrega: d(8), estado: 'en_curso', habilitadaFecha: d(-1), instInicio: d(8), instFin: d(8), equipo: 'Equipo AMBA 3', responsable: TOM, etapas: etapas('mantenimiento', 0), checklist: [{ id: 'c1', texto: 'Arena recargada y pareja', ok: false }, { id: 'c2', texto: 'Uniones revisadas', ok: false }, { id: 'c3', texto: 'Informe enviado al cliente', ok: false }], garantiaMeses: '' },
        { precioUSD: '650', senaUSD: '650', formaPago: 'contado', saldoCobrado: true });

      /* ----- Entregadas ----- */
      const fin1 = UI.addMonths(d(3), -1);
      obra('t1', { nombre: 'Tercer Tiempo – F5', tipo: 'futbol', m2: '800', cesped: 'Monofilamento 50 mm', cliente: 'Tercer Tiempo (Diego)', telefono: '11 5555 0207', ubicacion: 'Morón, Buenos Aires', fechaVenta: UI.addDays(fin1, -40), fechaEntrega: UI.addDays(fin1, -10), instInicio: UI.addDays(fin1, -6), instFin: fin1, equipo: 'Equipo AMBA 3', responsable: BETO, estado: 'terminada', fin: fin1, etapas: etapas('futbol', 11, false, {}, -40), checklist: check('futbol', true), postventa: pv(fin1, 0) },
        { precioUSD: '18000', senaUSD: '9000', formaPago: 'contado', saldoCobrado: true });
      const fin2 = UI.addMonths(d(40), -12);
      obra('t2', { nombre: 'Centro Galicia – Pádel', tipo: 'padel_cesped', m2: '200', cesped: 'Fibrilado 12 mm', cliente: 'Centro Galicia', telefono: '11 5555 0208', ubicacion: 'Avellaneda, Buenos Aires', fechaVenta: UI.addDays(fin2, -30), fechaEntrega: UI.addDays(fin2, -2), instInicio: fin2, instFin: fin2, equipo: 'Equipo AMBA 1', estado: 'terminada', fin: fin2, etapas: etapas('padel_cesped', 9, false, {}, -330), checklist: check('padel_cesped', true), postventa: pv(fin2, 1) },
        { precioUSD: '4800', senaUSD: '2400', formaPago: 'contado', saldoCobrado: true });
      const fin3 = d(-5);
      obra('t3', { nombre: 'Club Mitre – Pádel 1 a 4', tipo: 'padel_completa', cantidad: 4, m2: '800', cesped: 'Textil pádel azul', cliente: 'Club Mitre (Sr. Ledesma)', telefono: '11 5555 0209', ubicacion: 'San Martín, Buenos Aires', fechaVenta: d(-70), fechaEntrega: d(-26), instInicio: d(-25), instFin: fin3, equipo: 'Equipo AMBA 2', responsable: BETO, estado: 'terminada', fin: fin3, etapas: etapas('padel_completa', 14, false, {}, -25), checklist: check('padel_completa', true), postventa: pv(fin3, 0) },
        { precioUSD: '104000', senaUSD: '31200', formaPago: 'financiado', contratoFirmado: true, contratoFecha: d(-30) });
      const fin4 = UI.addMonths(d(-10), -12);
      obra('t4', { nombre: 'Barrio Los Álamos – Residencial', tipo: 'residencial', m2: '140', cesped: 'Paisajismo 40 mm', conArena: false, cliente: 'Familia Ortiz', telefono: '11 5555 0210', ubicacion: 'Canning, Buenos Aires', fechaVenta: UI.addDays(fin4, -15), fechaEntrega: fin4, instInicio: fin4, instFin: fin4, equipo: 'Equipo AMBA 3', estado: 'terminada', fin: fin4, etapas: etapas('residencial', 8, false, {}, -380), checklist: check('residencial', true), postventa: pv(fin4, 3), garantiaMeses: '24' },
        { precioUSD: '3200', senaUSD: '1600', formaPago: 'contado', saldoCobrado: true });

      /* ----- Fotos ----- */
      foto('e1', 'e2', 'Huracán · base lista', false, -8, 'Carajo (demo)');
      foto('e1', 'e3', 'Huracán · tendido', false, -6, 'Carajo (demo)');
      foto('e1', 'e4', 'Huracán · pegado del verde', false, -4, 'Carajo (demo)');
      foto('e2', 'e2', 'La Finca · estructura', true, -3);
      foto('e3', '', 'Club Norte · faltan vidrios', true, -11, 'Carajo (demo)');
      foto('t3', 'e13', 'Club Mitre · cancha 1 terminada', true, -5);
      foto('t3', 'e13', 'Club Mitre · cancha 2 terminada', true, -5);
      foto('t3', 'e13', 'Club Mitre · canchas 3 y 4', true, -5);
    });
  }
})();
