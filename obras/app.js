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
  const cat = { vendedores: [], revendedores: [], clientes: [], proveedores: [], cuentas: [] };
  let users = [];
  let config = {};
  let fotos = [];        // fotos de la obra abierta
  let planos = [];       // planos adjuntos de la obra abierta (se guardan junto a las fotos)
  let fotosObraId = null;
  let stopFotos = null;
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
      cloud.subscribe('obras', (items) => { obras = items; render(); }, (e) => UI.toast(e.message, 5000));
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

  function watchFotos(obraId) {
    if (obraId === fotosObraId) return;
    if (stopFotos) stopFotos();
    stopFotos = null;
    fotos = [];
    planos = [];
    fotosObraId = obraId;
    if (obraId) {
      stopFotos = cloud.subscribe('fotos', (items) => {
        const todo = items.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
        fotos = todo.filter((f) => f.tipo !== 'plano');
        planos = todo.filter((f) => f.tipo === 'plano').reverse();
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
  const tituloObra = (o, extra) => h('div.titulo-obra', h('span.ellipsis', extra ? `${extra}${o.nombre}` : o.nombre), pedidoChip(o));
  // Obras viejas: el cliente estaba en un solo campo.
  const clienteNombreDe = (o) => (o.clienteNombre != null || o.club != null ? o.clienteNombre || '' : o.cliente || '');
  // Teléfonos y mails con de quién es cada uno. Las obras viejas tenían un solo teléfono.
  const contactosDe = (o) => (Array.isArray(o.contactos) ? o.contactos
    : [o.telefono ? { id: 't', tipo: 'tel', valor: o.telefono, quien: '' } : null, o.email ? { id: 'm', tipo: 'mail', valor: o.email, quien: '' } : null].filter(Boolean));
  const telDe = (o) => (contactosDe(o).find((c) => c.tipo !== 'mail') || {}).valor || '';
  const telHref = (t) => 'tel:' + String(t).replace(/[^\d+]/g, '');

  /* ----- Cancha y césped ----- */

  const medidaDe = (tipo) => ((TIPOS[tipo] || TIPOS.otro).medida === 'cancha' ? 'cancha' : 'm2');
  const cespedesDe = (tipo) => window.OBRAS_CESPEDES[(TIPOS[tipo] || {}).cesped] || [];
  function cespedTexto({ cespedModelo, cespedOtro, bicolor, colores }) {
    const modelo = cespedModelo || cespedOtro || '';
    if (!modelo && !colores) return '';
    return [modelo, bicolor ? 'bicolor' : modelo ? 'monocolor' : '', colores].filter(Boolean).join(' · ');
  }
  const m2Texto = (n) => (num(n) ? fmtNum(num(n)) + ' m²' : '');
  function medidasTexto(o) {
    if (medidaDe(o.tipo) !== 'cancha' || !num(o.ancho) || !num(o.largo)) return '';
    return [`${fmtNum(num(o.ancho))} × ${fmtNum(num(o.largo))} m`, o.demarcacion ? `demarcación ${o.demarcacion}` : '', num(o.blanco) ? `blanco ${m2Texto(o.blanco)}` : ''].filter(Boolean).join(' · ');
  }
  // Arena y caucho: 'no' (no lleva) · 'cliente' (la compra el cliente) · 'slavon' (la vendemos nosotros).
  // Si la obra tiene instalación, la instalamos nosotros en los dos casos.
  function materialDe(o, m) {
    if (['no', 'cliente', 'slavon'].includes(o[m])) return o[m];
    const t = TIPOS[o.tipo] || TIPOS.otro;
    const lleva = m === 'arena' ? (o.conArena ?? t.arena) : (o.conCaucho ?? t.caucho);
    return lleva ? window.OBRAS_PROVEE[m] : 'no';
  }
  function materialTexto(m, valor, conInstalacion) {
    const fem = m === 'arena';
    if (valor === 'no') return 'No lleva';
    if (valor === 'cliente') return `${fem ? 'La' : 'Lo'} compra el cliente${conInstalacion ? `, ${fem ? 'la' : 'lo'} instalamos nosotros` : ''}`;
    return `${fem ? 'La' : 'Lo'} vendemos nosotros${conInstalacion ? ` y ${fem ? 'la' : 'lo'} instalamos` : ' (sin instalar)'}`;
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

  // ¿Se cumple la condición para entregar? Contado: saldo cobrado completo. Financiado: contrato firmado en nuestro poder.
  function condicionOk(o) {
    const v = ventas[o._id];
    if (!v) return false;
    if (esFinanciado(v)) return !!v.contratoFirmado;
    const c = cobro(o);
    return c.precio > 0 && c.pendiente <= 0;
  }
  const faltaTexto = (o) => {
    const v = ventas[o._id];
    if (!v) return 'Faltan los datos de la venta';
    if (esFinanciado(v)) return 'Falta el contrato firmado';
    const c = cobro(o);
    return `Falta cobrar el saldo: ${c.M(c.pendiente)}`;
  };

  // Ventas con la entrega cerca (o pasada) y la condición sin cumplir.
  const alertasEntrega = () => obras
    .filter((o) => esVendida(o) && o.fechaEntrega && UI.daysUntil(o.fechaEntrega) <= AVISO_DIAS && !condicionOk(o))
    .sort((a, b) => a.fechaEntrega.localeCompare(b.fechaEntrega));
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
    if (k === 'admin') linea = condicionOk(o) ? h('span.badge.ok', 'Lista para Entregas') : urgencia(o.fechaEntrega);
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
    const enAdmin = obras.filter((o) => o.estado === 'vendida').sort((a, b) => (a.fechaEntrega || '9').localeCompare(b.fechaEntrega || '9'));
    const listas = enAdmin.filter((o) => condicionOk(o));
    const urgentes = enAdmin.filter((o) => !condicionOk(o) && o.fechaEntrega && UI.daysUntil(o.fechaEntrega) <= AVISO_DIAS);
    const resto = enAdmin.filter((o) => !listas.includes(o) && !urgentes.includes(o));
    const aCobrar = sumaMonedas(enAdmin.filter((o) => !esFinanciado(ventas[o._id]) && !condicionOk(o)).map((o) => { const c = cobro(o); return [c.moneda, c.pendiente]; }));
    const pendRow = (o) => {
      const c = cobro(o);
      const enPesos = c.moneda === 'USD' && tcHoy() && c.pendiente ? ' = ' + ars(c.pendiente * tcHoy()) : '';
      return h('div.item', { onclick: () => go('obra/' + o._id) },
        h('span.dot', { class: UI.daysUntil(o.fechaEntrega || '9999-12-31') <= AVISO_DIAS ? 'late' : '' }, c.fin ? '✎' : '$'),
        h('div.grow', { style: { minWidth: 0 } },
          tituloObra(o),
          h('div.small.muted.ellipsis', c.fin ? 'Financiado · falta el contrato firmado'
            : `Contado · saldo ${c.M(c.pendiente)}${enPesos}${c.cobrado ? ` · pagado ${c.M(c.cobrado)} de ${c.M(c.total)}` : ''}`)),
        urgencia(o.fechaEntrega),
        h('button.btn.small', { type: 'button', onclick: (e) => { e.stopPropagation(); if (c.fin) registrarContrato(o); else registrarPago(o); } }, c.fin ? 'Contrato recibido' : 'Registrar pago'));
    };
    setMain(
      areaHead('admin', `Antes de entregar: contado → cobrar el saldo completo · financiado → contrato firmado en nuestro poder. ${AVISO_DIAS} días antes de la entrega avisa lo que falte. Cuando está, la obra pasa a Entregas.`),
      buscador(),
      h('div', { style: { marginTop: '14px' } }, tcBox()),
      h('div.kpis',
        kpi(urgentes.length, `Urgentes (entrega en ${AVISO_DIAS} días o menos)`, null, urgentes.length ? 'bad' : ''),
        kpi(aCobrar, 'Saldos de contado a cobrar'),
        kpi(enAdmin.filter((o) => esFinanciado(ventas[o._id]) && !condicionOk(o)).length, 'Contratos por firmar')),
      section('Listas para pasar a Entregas', listas.map((o) => h('div.item', { onclick: () => go('obra/' + o._id) },
        h('span.dot.done', icon('check')),
        h('div.grow', { style: { minWidth: 0 } }, tituloObra(o), h('div.small.muted', [esFinanciado(ventas[o._id]) ? 'Contrato firmado' : 'Saldo cobrado', 'entrega ' + UI.fmtDay(o.fechaEntrega)].join(' · '))),
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
        (o.incidencias || []).some((i) => !i.resuelta) ? h('span.badge.red', 'Incidencia') : null));
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
    const medidas = medidasTexto(o);
    const pl = planos.filter((p) => p.obraId === o._id);
    return h('div.card.info',
      infoRow('Tipo', [tipoNombre(o.tipo), num(o.cantidad) > 1 ? ` · ${o.cantidad} canchas` : '']),
      medidas ? infoRow('Medidas', medidas + (num(o.cantidad) > 1 ? ' (cada cancha)' : '')) : null,
      num(o.m2) ? infoRow('Superficie', m2Texto(o.m2) + (num(o.cantidad) > 1 ? ' en total' : '')) : null,
      o.cesped ? infoRow('Césped', o.cesped) : null,
      infoRow('Instalación', o.conInstalacion === false ? 'No incluida (sólo se entrega el césped)' : 'Incluida en el presupuesto'),
      infoRow('Arena', materialTexto('arena', materialDe(o, 'arena'), o.conInstalacion !== false)),
      infoRow('Caucho', materialTexto('caucho', materialDe(o, 'caucho'), o.conInstalacion !== false)),
      pl.length ? infoRow(pl.length > 1 ? 'Planos' : 'Plano', h('div', pl.map((p) => h('div', h('a', { href: '#', onclick: (e) => { e.preventDefault(); verArchivo(p); } }, icon(p.mime === 'application/pdf' ? 'file' : 'eye'), ' ', p.nombre || 'Plano'))))) : null,
      o.consideraciones ? infoRow('Consideraciones', h('div', { style: { whiteSpace: 'pre-wrap' } }, o.consideraciones)) : null,
      infoRow('Cliente', [o.club ? h('div', h('b', o.club)) : null, o.clienteNombre ? h('div', o.clienteNombre) : null, !o.club && !o.clienteNombre ? h('div', o.cliente) : null, o.pedido ? h('div.small', h('span.pedido', { style: { marginLeft: 0 } }, pedidoTexto(o))) : null]),
      contactosDe(o).length ? infoRow('Contactos', contactosVer(o)) : null,
      o.ubicacion ? infoRow('Ubicación', h('a', { href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.ubicacion), target: '_blank', rel: 'noopener' }, o.ubicacion, o.interior ? ' (interior)' : '')) : null,
      o.notas ? infoRow('Notas', h('div', { style: { whiteSpace: 'pre-wrap' } }, o.notas)) : null);
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
      o.estado === 'venta'
        ? pasoBox(falta.length ? `Faltan datos para pasar a Administración: ${falta.join(', ')}.` : 'La venta está completa.',
          h('button.btn.primary.small', { type: 'button', onclick: () => (falta.length ? editObra(o) : pasarAAdmin(o)) }, falta.length ? 'Completar' : 'Pasar a Administración'))
        : null,
      h('div.row', { style: { marginTop: '16px' } }, h('h2.grow', { style: { margin: 0 } }, 'Datos de la venta'), h('button.btn.small', { type: 'button', onclick: () => editObra(o) }, icon('edit'), 'Editar')),
      h('div.card.info', { style: { marginTop: '10px' } },
        infoRow('Fecha de venta', [UI.fmtDay(o.fechaVenta) || '—', o.creadoPorNombre ? h('span.muted', ' · cargó ' + o.creadoPorNombre) : null]),
        o.pedido ? infoRow('N° de pedido', o.pedido) : null,
        infoRow('Vendió', vendedoresTexto(v) || '—'),
        v.revendedor ? infoRow('Revendedor', [h('div', v.revendedor.nombre), h('div.small.muted', `Comisión ${fmtNum(num(v.revendedor.comisionPct))} %${precioDe(v) ? ' = ' + CALC.money(CALC.round2((precioDe(v) * num(v.revendedor.comisionPct)) / 100), monedaDe(v)) : ''}`)]) : null,
        infoRow('Plazo', plazoTexto(o) || '—'),
        infoRow('Fecha de entrega', o.fechaEntrega ? h('b', UI.fmtDay(o.fechaEntrega)) : '—'),
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
  function cuotasBlock(c) {
    const pagadas = c.cuotas.filter((q) => q.pendiente <= 0).length;
    const vencidas = c.cuotas.filter((q) => q.pendiente > 0 && q.fecha && UI.daysUntil(q.fecha) < 0).length;
    return h('details.cuotas', { open: vencidas > 0 },
      h('summary', h('b', 'Cuotas'), h('span.muted', ` · ${pagadas} de ${c.cuotas.length} pagadas`),
        vencidas ? h('span.badge.red', { style: { marginLeft: '8px' } }, vencidas > 1 ? `${vencidas} vencidas` : '1 vencida') : null),
      h('div.list', c.cuotas.map((q) => cuotaItem(c, q))));
  }

  function cuotaItem(c, q) {
    const vencida = q.pendiente > 0 && q.fecha && UI.daysUntil(q.fecha) < 0;
    const badge = q.pendiente <= 0 ? h('span.badge.ok', 'Pagada')
      : q.pagado ? h('span.badge.warn', `Falta ${c.M(q.pendiente)}`)
        : vencida ? h('span.badge.red', 'Vencida')
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
      !c.fin && esVendida(o) ? h('label.check', h('input', { type: 'checkbox', name: 'habilitar', checked: true }), 'Si con este pago el saldo queda en cero, pasar a Entregas') : null,
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
      cloud.write([
        { op: 'set', col, id, data },
        ...(nuevaSena != null ? [{ op: 'update', col: 'ventas', id: o._id, data: { sena: nuevaSena, ...stamp() } }] : []),
        ...nuevos.map((a) => ({ op: 'set', col: `ventas/${o._id}/comprobantes`, id: a.id, data: { obraId: o._id, pagoId: id, nombre: a.nombre, mime: a.mime, data: a.data, por: me.email, porNombre: me.nombre, fecha: new Date().toISOString() } })),
        ...[...comp.quitados].map((cid) => ({ op: 'delete', col: `ventas/${o._id}/comprobantes`, id: cid })),
      ]);
      const queda = CALC.round2(pendiente - valor);
      const txt = nuevo ? `Pago registrado (recibo ${reciboTexto(data.recibo)}).` : 'Pago corregido.';
      if (queda > 0.005) UI.toast(`${txt} Saldo: ${c.M(queda)}.`, 3500);
      else if (val.habilitar && esVendida(o)) setTimeout(() => habilitar(o, true), 0);
      else UI.toast(`${txt} El saldo quedó en cero.`, 3500);
    };

    const actions = [{ label: 'Cancelar' }, { label: nuevo ? 'Guardar pago' : 'Guardar', kind: 'primary', onClick: guardar }];
    if (p) {
      actions.unshift({
        label: 'Borrar', kind: 'danger', onClick: async () => {
          if (!(await UI.confirm('¿Borrar el pago?', `${CALC.money(num(p.monto), p.moneda)} del ${UI.fmtDay(p.fecha)}. Deja de contar como pagado y se borran sus comprobantes. No se puede deshacer.`, 'Borrar', 'danger'))) return false;
          cloud.write([{ op: 'delete', col: `ventas/${o._id}/pagos`, id: p._id }, ...(p.comprobantes || []).map((m) => ({ op: 'delete', col: `ventas/${o._id}/comprobantes`, id: m.id }))]);
          UI.toast('Pago borrado');
        },
      });
    }
    UI.sheet({ title: p ? `Pago ${reciboTexto(p.recibo)}`.trim() : tipo === 'sena' ? `Registrar ${senaTxt}` : 'Registrar pago', body: [body], actions });
  }

  const cuentaProvTexto = (x) => [x.banco, x.alias || x.cbu, x.titular].filter(Boolean).join(' · ');

  /* ----- Solapa Administración ----- */
  function adminTab(o) {
    const c = cobro(o);
    const v = c.v;
    const fin = c.fin;
    const enAdmin = o.estado === 'vendida';
    const d = o.fechaEntrega ? UI.daysUntil(o.fechaEntrega) : null;
    let paso = null;
    if (o.estado === 'venta') paso = pasoBox('Todavía está en Ventas: falta completar la venta.', null);
    else if (enAdmin && condicionOk(o)) paso = pasoBox(fin ? 'Contrato firmado. Ya se puede entregar.' : 'Saldo cobrado completo. Ya se puede entregar.', h('button.btn.primary.small', { type: 'button', onclick: () => habilitar(o) }, 'Pasar a Entregas'));
    else if (enAdmin) {
      paso = pasoBox(h('span', fin ? 'Falta el contrato firmado en nuestro poder.' : `Falta cobrar el saldo antes de la entrega de materiales: ${c.M(c.pendiente)}.`,
        d != null && d <= AVISO_DIAS ? h('b', { style: { color: 'var(--red)' } }, ` Entrega ${UI.relDays(o.fechaEntrega)}: si no está, se retrasa.`) : null),
      h('button.btn.primary.small', { type: 'button', onclick: () => (fin ? registrarContrato(o) : registrarPago(o)) }, fin ? 'Contrato recibido' : 'Registrar pago'));
    } else paso = pasoBox(`Listo: ${fin ? 'contrato firmado' : 'saldo cobrado'}. La obra ya pasó a ${AREAS[areaDe(o)].nombre}.`, null);
    return [
      paso,
      h('h2', fin ? 'Financiado' : 'Contado'),
      h('div.card.info',
        infoRow('Fecha de entrega', o.fechaEntrega ? [UI.fmtDay(o.fechaEntrega), !esTerminada(o) ? h('span.muted', ' (' + UI.relDays(o.fechaEntrega) + ')') : null] : '—'),
        fin
          ? infoRow('Contrato', v.contratoFirmado ? h('span', h('span.badge.ok', 'Firmado'), ' ', UI.fmtDay(v.contratoFecha), v.contratoPorNombre ? h('span.muted', ' · ' + v.contratoPorNombre) : null)
            : h('span.row.wrap', { style: { gap: '8px' } }, h('span.badge.red', 'Falta firmado'), enAdmin ? null : h('button.btn.small', { type: 'button', onclick: () => registrarContrato(o) }, 'Contrato recibido')))
          : infoRow('Saldo', c.pendiente > 0 ? h('span', h('b', c.M(c.pendiente)), ' ', h('span.badge.red', 'Pendiente')) : h('span.badge.ok', 'Cobrado'))),
      cobrosBlock(o),
      h('div', { style: { marginTop: '16px' } }, tcBox()),
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
      esVendida(o) ? h('label.check', h('input', { type: 'checkbox', name: 'habilitar', checked: true }), 'Pasar a Entregas ahora') : null);
    UI.sheet({
      title: 'Contrato firmado',
      body: [body],
      actions: [{ label: 'Cancelar' }, {
        label: 'Guardar', kind: 'primary', onClick: () => {
          const val = UI.values(body);
          cloud.write([{ op: ventas[o._id] ? 'update' : 'set', col: 'ventas', id: o._id, data: { contratoFirmado: true, contratoFecha: val.fecha || UI.today(), contratoPor: me.email, contratoPorNombre: me.nombre, ...stamp() } }]);
          if (val.habilitar) setTimeout(() => habilitar(o, true), 0);
          else UI.toast('Guardado');
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

  function viewActa(id) {
    const o = obras.find((x) => x._id === id);
    if (!o) { setMain(backBtn(), h('div.card.empty', 'Cargando…')); return; }
    watchFotos(id);
    const finales = fotos.filter((f) => /cepillado|entregado|informe/i.test(((o.etapas || []).find((e) => e.id === f.etapaId) || {}).nombre || ''));
    const fotosActa = (finales.length ? finales : fotos).slice(0, 6);
    const fecha = o.fin || UI.today();
    const vence = garantiaMesesDe(o) ? UI.addMonths(fecha, garantiaMesesDe(o)) : '';
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
          row('Cliente', clientePed(o)), row('Teléfono', telDe(o)), row('Obra', o.nombre), row('Ubicación', o.ubicacion))),
        h('h3', 'Trabajo entregado'),
        h('table.acta-table', h('tbody',
          row('Tipo', tipoNombre(o.tipo) + (num(o.cantidad) > 1 ? ` · ${o.cantidad} canchas` : '')),
          row('Medidas', medidasTexto(o)),
          row('Superficie', m2Texto(o.m2)),
          row('Césped', o.cesped),
          row('Incluye', o.conInstalacion === false ? 'Provisión del césped, sin instalación' : 'Provisión e instalación del césped'),
          materialDe(o, 'arena') !== 'no' ? row('Arena', materialTexto('arena', materialDe(o, 'arena'), o.conInstalacion !== false)) : null,
          materialDe(o, 'caucho') !== 'no' ? row('Caucho', materialTexto('caucho', materialDe(o, 'caucho'), o.conInstalacion !== false)) : null,
          row('Instalación', fechasInst(o)),
          row('Fecha de entrega', UI.fmtDay(fecha)))),
        h('h3', 'Controles de entrega'),
        h('ul.acta-check', (o.checklist || []).map((c) => h('li', { class: c.ok ? 'ok' : '' }, (c.ok ? '☑ ' : '☐ ') + c.texto))),
        fotosActa.length ? [h('h3', 'Fotos'), h('div.acta-fotos', fotosActa.map((f) => h('img', { src: 'data:image/jpeg;base64,' + f.data })))] : null,
        h('h3', 'Garantía y mantenimiento'),
        h('p', vence ? `Garantía de ${garantiaTexto(o)} desde la fecha de entrega, válida hasta el ${UI.fmtDay(vence)}, según las condiciones del certificado de garantía.` : 'Garantía según las condiciones del certificado de garantía.',
          ' Se entregan al cliente el certificado de garantía y el manual de mantenimiento. El mantenimiento periódico indicado en el manual es condición para la garantía.'),
        h('h3', 'Observaciones'),
        editable((o.incidencias || []).filter((i) => !i.resuelta).map((i) => `${i.tipo}: ${i.detalle}`).join('\n') || 'Sin observaciones.'),
        h('p.small', 'El cliente recibe el trabajo descripto, en las condiciones indicadas, y deja constancia de que se le explicó el uso y el mantenimiento de la cancha.'),
        h('div.acta-firmas',
          h('div', h('div.line'), 'Por SLAVON', h('div.small', 'Firma y aclaración')),
          h('div', h('div.line'), 'Cliente', h('div.small', 'Firma, aclaración y DNI')))),
    );
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
  };
  const catNombre = (k, x) => (k === 'clientes' ? clienteTexto(x.club, x.clienteNombre) : x.nombre) || 'Sin nombre';
  const obrasDeCliente = (id) => obras.filter((o) => o.clienteId === id);
  function catSub(k, x) {
    if (k === 'revendedores') return [`Comisión ${fmtNum(num(x.comisionPct))} %`, ...(x.contactos || []).map((c) => c.valor)].join(' · ');
    if (k === 'clientes') {
      const n = obrasDeCliente(x._id).length;
      return [...(x.contactos || []).map((c) => c.valor), x.cuit ? 'CUIT ' + x.cuit : '', n ? (n === 1 ? '1 obra' : n + ' obras') : 'sin obras'].filter(Boolean).join(' · ');
    }
    if (k === 'proveedores') return (x.cuentas || []).map(cuentaProvTexto).join(' / ') || 'Sin cuentas cargadas';
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
        .sort((a, b) => catNombre(k, a).localeCompare(catNombre(k, b)));
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
      seg, h('div', { style: { margin: '12px 0' } }, search), list);
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
      const pct = UI.field({ label: 'Comisión por defecto (%)', name: 'comisionPct', value: d.comisionPct != null ? fmtNum(num(d.comisionPct)) : '', placeholder: 'Ej: 10' });
      numeroInput(pct.querySelector('input'));
      campos = [nombreF, pct, extra.el, notasF];
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
        if (k === 'revendedores') Object.assign(data, { comisionPct: num(v.comisionPct), contactos: extra.leer(), notas: v.notas });
        if (k === 'proveedores') Object.assign(data, { cuit: v.cuit, cuentas: extra.leer(), notas: v.notas });
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

  // Revendedor (opcional) con su comisión: % editable en cada venta y monto calculado sobre el presupuesto.
  function revendedorPicker(v, getPrecio) {
    const r0 = v.revendedor || null;
    const chk = h('input', { type: 'checkbox', checked: !!r0 });
    const selF = UI.field({ label: 'Revendedor', name: '', type: 'select', value: r0 ? r0.id : '', options: [] });
    const pctF = UI.field({ label: 'Comisión (%)', name: '', value: r0 ? fmtNum(num(r0.comisionPct)) : '' });
    [selF, pctF].forEach((f) => f.querySelector('input,select').removeAttribute('name'));
    const sel = selF.querySelector('select');
    const pct = numeroInput(pctF.querySelector('input'));
    const calc = h('div.calc');
    const box = h('div', fila2(selF, pctF), calc);
    const llenar = (elegido) => {
      const lista = activos(cat.revendedores, elegido);
      if (elegido && !lista.some((x) => x._id === elegido) && r0) lista.push({ _id: r0.id, nombre: r0.nombre, comisionPct: r0.comisionPct });
      sel.replaceChildren(h('option', { value: '' }, lista.length ? 'Elegí…' : 'No hay revendedores cargados'),
        ...lista.map((x) => h('option', { value: x._id, selected: x._id === elegido }, x.nombre)), h('option', { value: '__nuevo' }, '+ Nuevo revendedor…'));
      sel.value = elegido || '';
    };
    const refresh = () => {
      box.hidden = !chk.checked;
      const precio = getPrecio();
      const p = num(pct.value);
      calc.replaceChildren(h('div', precio.monto && p ? `Comisión: ${CALC.money(CALC.round2((precio.monto * p) / 100), precio.moneda)} (${fmtNum(p)} % de ${CALC.money(precio.monto, precio.moneda)})` : 'Poné el presupuesto y el % para ver la comisión.'));
    };
    sel.addEventListener('change', () => {
      if (sel.value === '__nuevo') {
        llenar('');
        editCatalogo('revendedores', null, (id, doc) => setTimeout(() => { llenar(id); pct.value = fmtNum(num(doc.comisionPct)); refresh(); }, 50));
        return;
      }
      const x = cat.revendedores.find((r) => r._id === sel.value);
      if (x) pct.value = fmtNum(num(x.comisionPct));
      refresh();
    });
    chk.addEventListener('change', refresh);
    pct.addEventListener('input', refresh);
    llenar(r0 ? r0.id : '');
    refresh();
    const el = h('div', h('label.check', chk, 'Lo vendió un revendedor'), box);
    return {
      el, refresh,
      leer: () => {
        if (!chk.checked) return null;
        const x = cat.revendedores.find((r) => r._id === sel.value) || (r0 && r0.id === sel.value ? r0 : null);
        if (!x) throw new Error('Elegí el revendedor o destildá «Lo vendió un revendedor».');
        return { id: sel.value, nombre: x.nombre, comisionPct: num(pct.value) };
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

  // Planos adjuntos de la venta (se guardan junto a las fotos de la obra, con tipo «plano»).
  function planosEditor(o) {
    const ed = adjuntosEditor({ existentes: o ? planos.filter((p) => p.obraId === o._id) : [], label: 'Plano', boton: 'Adjuntar plano (foto o PDF)', ver: verArchivo });
    return {
      el: ed.el,
      ops: (obraId) => [
        ...ed.nuevos.map((a) => ({ op: 'set', col: 'fotos', id: cloud.newId(), data: { ...a, obraId, tipo: 'plano', etapaId: '', nota: '', por: me.email, porNombre: me.nombre, fecha: new Date().toISOString(), en: cloud.serverTime() } })),
        ...[...ed.quitados].map((id) => ({ op: 'delete', col: 'fotos', id })),
      ],
    };
  }

  function editObra(o) {
    if (!canVenta) return;
    const isNew = !o;
    const v = (o && ventas[o._id]) || {};
    const tipo0 = o ? o.tipo : 'futbol';
    const t0 = TIPOS[tipo0] || TIPOS.otro;
    const hayPagos = !!(o && (pagosPorObra[o._id] || []).length);
    const contactos = contactosEditor(o ? contactosDe(o) : []);
    const planosEd = planosEditor(o);
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

    /* --- Medidas: ancho × largo + blanco (canchas) o m² directo (residencial) --- */
    const m2F = UI.field({ label: 'm²', name: 'm2', value: o && medidaDe(tipo0) === 'm2' ? n0(o.m2) : '' });
    const anchoF = UI.field({ label: 'Ancho (m)', name: 'ancho', value: o ? n0(o.ancho) : '' });
    const largoF = UI.field({ label: 'Largo (m)', name: 'largo', value: o ? n0(o.largo) : '' });
    const demF = UI.field({ label: 'Demarcación', name: 'demarcacion', type: 'select', value: (o && o.demarcacion) || 'simple', options: [['simple', 'Simple'], ['doble', 'Doble']] });
    const blancoF = UI.field({ label: 'Blanco (m²)', name: 'blanco', value: o ? n0(o.blanco) : '' });
    const blancoNota = h('p.small.muted', { style: { marginTop: '-8px' } });
    const m2Calc = h('div.calc');
    const medM2 = h('div', m2F);
    const medCancha = h('div', fila(anchoF, largoF), fila(demF, blancoF), blancoNota, m2Calc);
    [m2F, anchoF, largoF, blancoF].forEach((f) => numeroInput(f.querySelector('input')));
    const blancoInp = blancoF.querySelector('input');
    let blancoTocado = !!(o && num(o.blanco));
    blancoInp.addEventListener('input', () => { blancoTocado = !!blancoInp.value; });

    /* --- Césped: modelo según el deporte, monocolor o bicolor --- */
    let modelo0 = o ? o.cespedModelo || '' : '';
    let otro0 = o ? o.cespedOtro || '' : '';
    if (o && !o.cespedModelo && !o.cespedOtro && o.cesped) { // obras viejas: el césped era texto libre
      if (cespedesDe(tipo0).includes(o.cesped)) modelo0 = o.cesped;
      else otro0 = o.cesped;
    }
    const cespedF = UI.field({ label: 'Tipo de césped', name: 'cespedModelo', type: 'select', value: '', options: [] });
    const cespedSel = cespedF.querySelector('select');
    const cespedOtroF = UI.field({ label: 'Cuál', name: 'cespedOtro', value: otro0, placeholder: 'Modelo y altura. Ej: Monofilamento 60 mm' });
    const llenarCesped = (tipo, elegido) => {
      const lista = cespedesDe(tipo);
      const sel = lista.includes(elegido) ? elegido : elegido === 'otro' || !lista.length ? 'otro' : lista[0];
      cespedSel.replaceChildren(...[...lista.map((m) => [m, m]), ['otro', lista.length ? 'Otro (especificar)' : 'Escribir el modelo']]
        .map(([val, txt]) => h('option', { value: val, selected: val === sel }, txt)));
      cespedSel.value = sel;
    };
    llenarCesped(tipo0, modelo0 || (otro0 ? 'otro' : ''));
    const colorF = UI.field({ label: 'Color', name: 'color', type: 'select', value: o && o.bicolor ? 'bicolor' : 'mono', options: [['mono', 'Monocolor'], ['bicolor', 'Bicolor']] });
    const coloresF = UI.field({ label: 'Colores', name: 'colores', value: o ? o.colores || '' : '', placeholder: 'Ej: verde y blanco' });
    const bicolorNota = h('div.calc');

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
    const materialF = (m) => UI.field({ label: m === 'arena' ? 'Arena' : 'Caucho', name: m, type: 'select',
      value: o ? materialDe(o, m) : t0[m] ? window.OBRAS_PROVEE[m] : 'no', options: [['cliente', ''], ['slavon', ''], ['no', '']] });
    const arenaF = materialF('arena');
    const cauchoF = materialF('caucho');
    // El texto de cada opción dice si la instalamos o no, según esté incluida la instalación.
    const textosMaterial = () => {
      const inst = $('conInstalacion').checked;
      for (const [m, f] of [['arena', arenaF], ['caucho', cauchoF]]) {
        for (const op of f.querySelectorAll('option')) op.textContent = materialTexto(m, op.value, inst);
      }
    };
    const tiposOpts = Object.entries(TIPOS).filter(([k, t]) => !t.oculto || k === tipo0).map(([k, t]) => [k, t.nombre]);

    const body = h('div',
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
      h('div.row', { style: { gap: '10px', alignItems: 'flex-start' } },
        h('div.grow', UI.field({ label: 'Tipo', name: 'tipo', type: 'select', value: tipo0, options: tiposOpts })),
        h('div', { style: { width: '34%' } }, UI.field({ label: 'Canchas', name: 'cantidad', type: 'number', inputMode: 'numeric', value: o ? o.cantidad || 1 : 1 }))),
      medM2,
      medCancha,
      cespedF,
      h('div', cespedOtroF),
      fila(colorF, coloresF),
      bicolorNota,
      h('div.field-title', 'Incluye el presupuesto'),
      chk('conInstalacion', 'Instalación', !o || o.conInstalacion !== false),
      arenaF,
      cauchoF,
      h('p.small.muted', { style: { marginTop: '-8px' } }, 'Con esto se arman las etapas de la obra.'),
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
      fila(
        UI.field({ label: 'Fecha de entrega', name: 'fechaEntrega', type: 'date', value: o ? o.fechaEntrega : UI.addDays(UI.today(), 5) }),
        UI.field({ label: 'Garantía (años)', name: 'garantiaAnios', inputMode: 'decimal', value: gm ? String(CALC.round2(gm / 12)).replace('.', ',') : '', placeholder: 'Ej: 2' })),
      formaF,
      h('div.row', { style: { gap: '10px', alignItems: 'flex-start' } }, h('div', { style: { width: '34%' } }, monedaF), h('div.grow', precioF)),
      hayPagos ? h('p.small.muted', { style: { marginTop: '-8px' } }, 'Ya hay pagos registrados: la moneda no se puede cambiar.') : null,
      fila(senaF, senaFechaF),
      finBox,
      UI.field({ label: 'Notas de la venta', name: 'notasVenta', type: 'textarea', value: v.notasVenta || '', placeholder: 'Sólo la ven admin y administración' }),

      h('h3', { style: { margin: '18px 0 10px' } }, 'Otras notas'),
      UI.field({ label: 'Notas de la obra', name: 'notas', type: 'textarea', value: o ? o.notas : '', placeholder: 'Las ven todos, también los encargados de obra' }),
      h('p.small.muted', 'Con cliente o club, precio y fecha de entrega la venta queda completa y pasa sola a Administración.'));

    const $ = (n) => body.querySelector(`[name=${n}]`);
    leerPrecio = () => ({ monto: num($('precio').value), moneda: $('moneda').value === 'ARS' ? 'ARS' : 'USD' });

    // Recalcula lo que depende de otros campos: m², blanco, bicolor, plazo y cuotas.
    const refresh = () => {
      const val = UI.values(body);
      const porM2 = medidaDe(val.tipo) === 'm2';
      const cant = Math.max(1, Math.round(num(val.cantidad)) || 1);
      medM2.hidden = !porM2;
      medCancha.hidden = porM2;
      m2F.querySelector('span').textContent = cant > 1 ? 'm² (en total)' : 'm²';
      let m2Total = 0;
      if (porM2) m2Total = num(val.m2);
      else {
        const ancho = num(val.ancho);
        const largo = num(val.largo);
        const auto = CALC.blanco({ tipo: val.tipo, ancho, largo, demarcacion: val.demarcacion });
        if (auto != null && !blancoTocado) blancoInp.value = fmtNum(auto);
        blancoNota.textContent = auto == null ? 'La fórmula del blanco todavía no está cargada: por ahora va a mano.' : blancoTocado ? 'Cargado a mano.' : `Calculado con demarcación ${val.demarcacion}.`;
        const b = num(blancoInp.value);
        if (ancho && largo) {
          const porCancha = CALC.m2Cancha({ ancho, largo, blanco: b });
          m2Total = CALC.round2(porCancha * cant);
          m2Calc.replaceChildren(
            h('div', `${fmtNum(ancho)} × ${fmtNum(largo)} = ${m2Texto(CALC.round2(ancho * largo))}${b ? ` + blanco ${m2Texto(b)}` : ''}${b || cant > 1 ? ` = ${m2Texto(porCancha)}${cant > 1 ? ' por cancha' : ''}` : ''}`),
            h('b', `Total: ${m2Texto(m2Total)}${cant > 1 ? ` (${cant} canchas)` : ''}`));
        } else {
          m2Calc.replaceChildren(h('div', o && num(o.m2) && !num(o.ancho) ? `Cargá ancho y largo. Hasta ahora tenía ${m2Texto(o.m2)} cargados a mano.` : 'Cargá ancho y largo para calcular los m².'));
        }
      }
      cespedOtroF.parentNode.hidden = cespedSel.value !== 'otro';
      cespedOtroF.querySelector('span').textContent = cespedesDe(val.tipo).length ? 'Cuál' : 'Modelo de césped';
      if (val.color === 'bicolor') {
        const d = CALC.bicolor({ m2: m2Total, ancho: num(val.ancho), largo: num(val.largo) });
        bicolorNota.replaceChildren(h('div', d == null ? 'Bicolor: la fórmula del desperdicio todavía no está cargada.' : `Con el desperdicio del bicolor: ${m2Texto(d)}.`));
      }
      bicolorNota.hidden = val.color !== 'bicolor';
      plazoOtroF.parentNode.hidden = val.plazo !== 'otro';
      textosMaterial();
      revPk.refresh();

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

    // Al cambiar el tipo: lo que incluye normalmente y la lista de céspedes de ese deporte.
    $('tipo').addEventListener('change', () => {
      const t = TIPOS[$('tipo').value] || TIPOS.otro;
      $('arena').value = t.arena ? window.OBRAS_PROVEE.arena : 'no';
      $('caucho').value = t.caucho ? window.OBRAS_PROVEE.caucho : 'no';
      llenarCesped($('tipo').value, cespedSel.value);
      refresh();
    });
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
        const cantidad = Math.max(1, Math.round(num(val.cantidad)) || 1);
        const porM2 = medidaDe(val.tipo) === 'm2';
        const ancho = porM2 ? 0 : num(val.ancho);
        const largo = porM2 ? 0 : num(val.largo);
        const blanco = porM2 ? 0 : num(val.blanco);
        const m2 = porM2 ? num(val.m2)
          : ancho && largo ? CALC.round2(CALC.m2Cancha({ ancho, largo, blanco }) * cantidad)
            : o ? num(o.m2) : 0;
        const modelo = cespedSel.value === 'otro' ? '' : cespedSel.value;
        const cesped = { cespedModelo: modelo, cespedOtro: modelo ? '' : val.cespedOtro, bicolor: val.color === 'bicolor', colores: val.colores };
        const anios = val.garantiaAnios === '' ? '' : num(val.garantiaAnios);
        const obra = {
          nombre: val.nombre || [club || clienteNombre, tipoNombre(val.tipo)].filter(Boolean).join(' – '),
          tipo: val.tipo, cantidad, ancho, largo, demarcacion: porM2 ? '' : val.demarcacion, blanco, m2,
          ...cesped, cesped: cespedTexto(cesped),
          conInstalacion: val.conInstalacion, arena: val.arena, caucho: val.caucho, conArena: val.arena !== 'no', conCaucho: val.caucho !== 'no', consideraciones: val.consideraciones,
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
          vendedores, vendio: vendedores.map((x) => x.nombre).join(', '), revendedor, notasVenta: val.notasVenta, ...stamp(),
        };
        if (isNew) {
          const id = cloud.newId();
          const opts = { conInstalacion: val.conInstalacion, conArena: val.arena !== 'no', conCaucho: val.caucho !== 'no' };
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
            { op: 'set', col: 'ventas', id, data: { ...venta, contratoFirmado: false } },
            ...planosEd.ops(id),
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
            ...planosEd.ops(o._id),
            ...opsCliente,
          ]);
          UI.toast(obra.estado === 'vendida' ? 'Venta completa: pasó a Administración' : 'Guardado');
        }
      },
    }];
    if (!isNew && isAdmin) {
      actions.unshift({
        label: 'Eliminar', kind: 'danger', onClick: async () => {
          if (!(await UI.confirm('¿Eliminar la obra?', `Se borra «${o.nombre}» con su venta, sus pagos, planos y todas sus fotos. No se puede deshacer.`, 'Eliminar'))) return false;
          const ops = [{ op: 'delete', col: 'obras', id: o._id }, { op: 'delete', col: 'ventas', id: o._id },
            ...[...fotos, ...planos].filter((f) => f.obraId === o._id).map((f) => ({ op: 'delete', col: 'fotos', id: f._id })),
            ...(pagosPorObra[o._id] || []).flatMap((p) => [{ op: 'delete', col: `ventas/${o._id}/pagos`, id: p._id },
              ...(p.comprobantes || []).map((m) => ({ op: 'delete', col: `ventas/${o._id}/comprobantes`, id: m.id }))])];
          for (let i = 0; i < ops.length; i += 400) cloud.write(ops.slice(i, i + 400));
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
    cloud.seedOnce('v6', (put) => {
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
      const cesp = (cespedModelo, colores, bicolor = false) => { const c = { cespedModelo, cespedOtro: '', bicolor, colores }; return { ...c, cesped: cespedTexto(c) }; };
      // Catálogos de ejemplo.
      const VEND = { melina: 'Melina', delfina: 'Delfina', juan: 'Juan' };
      for (const [k, nombre] of Object.entries(VEND)) put('vendedores', 'vd_' + k, { nombre, activo: true });
      put('vendedores', 'vd_tomas', { nombre: 'Tomás (ya no vende)', activo: false });
      put('revendedores', 'rv_sur', { nombre: 'Deportes del Sur', comisionPct: 10, contactos: [{ id: 'c0', tipo: 'tel', valor: '11 5555 0300', quien: 'Gustavo' }], notas: '', activo: true });
      put('revendedores', 'rv_rosario', { nombre: 'Canchas Rosario', comisionPct: 8, contactos: [], notas: 'Revende en Santa Fe.', activo: true });
      put('proveedores', 'pv_polimetal', { nombre: 'Polimetal', cuit: '30-12345678-9', notas: 'Estructuras de pádel.', activo: true,
        cuentas: [{ id: 'pvc1', banco: 'Banco Galicia', titular: 'Polimetal SA', cbu: '0070000000000000000001', alias: 'polimetal.pagos', moneda: 'ARS' }] });
      put('proveedores', 'pv_fibras', { nombre: 'Fibras del Plata', cuit: '30-98765432-1', notas: '', activo: true,
        cuentas: [{ id: 'pvc2', banco: 'Banco Santander', titular: 'Fibras del Plata SRL', cbu: '0720000000000000000002', alias: 'fibras.plata', moneda: 'ARS' },
          { id: 'pvc3', banco: 'Banco Santander', titular: 'Fibras del Plata SRL', cbu: '0720000000000000000003', alias: 'fibras.dolares', moneda: 'USD' }] });
      put('cuentas', 'ct_wmax', { nombre: 'W. MAX SRL', tipo: 'banco', moneda: 'ambas', banco: 'Banco Galicia', titular: 'W. MAX SRL', cbu: '', alias: 'wmax.srl', pideFactura: true, activo: true });
      put('cuentas', 'ct_atlantis', { nombre: 'Atlantis', tipo: 'banco', moneda: 'ambas', banco: 'Banco Nación', titular: 'Atlantis', cbu: '', alias: 'atlantis.cobros', pideFactura: true, activo: true });
      put('cuentas', 'ct_caja_ars', { nombre: 'Efectivo oficina $', tipo: 'efectivo', moneda: 'ARS', pideFactura: false, activo: true });
      put('cuentas', 'ct_caja_usd', { nombre: 'Efectivo oficina US$', tipo: 'efectivo', moneda: 'USD', pideFactura: false, activo: true });
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
        put('obras', id, { ...base, ...o, clienteId: clientes[key] || '', pedido: ex.pedido || '' });
        const vend = (ex.vendedores || ['melina']).map((k) => ({ id: 'vd_' + k, nombre: VEND[k] }));
        put('ventas', id, { moneda: 'USD', vendedores: vend, vendio: vend.map((x) => x.nombre).join(', '), revendedor: ex.revendedor || null, ...v });
        if (num(v.sena) > 0 && !ex.sinSenaPago) pago(id, v.senaFecha || o.fechaVenta, 'USD', num(v.sena), 1570, ex.senaForma || 'cuenta', ex.senaDestino || 'wmax', '', { tipo: 'sena' });
      };
      const foto = (obraId, etapaId, texto, padel, dias = 0, quien = 'Beto (demo)') => put('fotos', obraId + '_' + etapaId + '_' + texto.length, {
        obraId, etapaId, data: fotoEjemplo(texto, padel ? '#2b6cb0' : '#2f8f46', padel), nota: '', por: '', porNombre: quien, fecha: new Date(Date.now() + dias * 864e5).toISOString(),
      });
      const plano = (obraId, texto, nombre) => put('fotos', obraId + '_plano', {
        obraId, tipo: 'plano', mime: 'image/jpeg', nombre, etapaId: '', data: fotoEjemplo(texto, '#5b6770'), nota: '', por: DEL, porNombre: 'Delfina (demo)', fecha: new Date().toISOString(),
      });
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
      { precio: 9600, sena: 4800, senaFecha: d(-2), formaPago: 'contado' }, { pedido: '1041' });
      pago('v1', d(-1), 'ARS', 3140000, 1570, 'cuenta', 'wmax', 'Pagó una parte, el resto la semana que viene', { comprobante: 'Comprobante transferencia', registrado: false, factura: 'solicitar' });
      obra('v2', { nombre: 'Escuela San Martín – F7', ...cancha('futbol', 30, 40, 60), ...cesp('Monofilamento 50 mm', 'verde'),
        ...cli('Escuela San Martín', 'Lic. Paz', ['tel', '11 5555 0102', 'Lic. Paz, directora'], ['mail', 'administracion@sanmartin.demo', 'Administración']),
        ubicacion: 'Lanús, Buenos Aires', fechaVenta: d(-6), plazo: 'fabricacion', fechaEntrega: d(19), estado: 'vendida', etapas: etapas('futbol', 0), checklist: check('futbol'), consideraciones: 'Acceso por calle lateral para el camión.' },
      { precio: 24000, sena: 7200, senaFecha: d(-6), ...fin11(d(24)), contratoFirmado: false }, { pedido: '1042', vendedores: ['melina', 'delfina'] });
      plano('v2', 'Plano F7 · 30 × 40 m', 'Plano cancha F7.jpg');
      obra('v3', { nombre: 'Casa Fernández – Jardín', tipo: 'residencial', m2: 90, ...cesp('Paisajismo 35 mm', 'verde'), conArena: false, conCaucho: false,
        ...cli('', 'Laura Fernández', ['tel', '11 5555 0103', 'Laura'], ['mail', 'laura.fernandez@demo.ar', 'Laura']),
        ubicacion: 'Adrogué, Buenos Aires', fechaVenta: d(-20), plazo: 'inmediata', fechaEntrega: d(5), estado: 'vendida', etapas: etapas('residencial', 0), checklist: check('residencial'), garantiaAnios: 2, garantiaMeses: 24 },
      { precio: 2100, sena: 1050, senaFecha: d(-20), formaPago: 'contado' }, { senaForma: 'efectivo_usd', senaDestino: 'caja_usd' });
      pago('v3', d(-1), 'ARS', 1648500, 1570, 'cuenta', 'atlantis');
      obra('v4', { nombre: 'Club Atlético Ituzaingó – Hockey', ...cancha('hockey', 55, 91.4, 0, 'doble'), ...cesp('Hockey arena 22 mm', 'azul'),
        ...cli('C. A. Ituzaingó', 'Comisión directiva', ['tel', '11 5555 0104', 'Sr. Benítez, presidente'], ['tel', '11 5555 0114', 'Tesorería']),
        ubicacion: 'Ituzaingó, Buenos Aires', fechaVenta: d(-28), plazo: 'fabricacion', fechaEntrega: d(2), estado: 'vendida', etapas: etapas('hockey', 0), checklist: check('hockey') },
      { precio: 86000, sena: 25800, senaFecha: d(-28), ...fin11(d(2), 12), contratoFirmado: false, notasVenta: 'Falta que firme el presidente del club.' }, { pedido: '1038', vendedores: ['delfina'] });
      obra('v5', { nombre: 'Padel Point Rosario – 3 canchas', ...cancha('padel_completa', 10, 20, 0, 'simple', 3), ...cesp('Textil pádel', 'azul'),
        ...cli('Padel Point SRL', '', ['tel', '341 555 0105', 'Oficina']), ubicacion: 'Rosario, Santa Fe', interior: true,
        logistica: window.OBRAS_LOGISTICA.map((texto, i) => ({ id: 'l' + i, texto, ok: false })), fechaVenta: d(-4), plazo: 'fabricacion', fechaEntrega: d(24), estado: 'vendida', etapas: etapas('padel_completa', 0), checklist: check('padel_completa') },
      { precio: 81000, sena: 40500, senaFecha: d(-4), formaPago: 'contado' },
      { pedido: '1040', revendedor: { id: 'rv_rosario', nombre: 'Canchas Rosario', comisionPct: 8 }, senaForma: 'proveedor', senaDestino: 'polimetal' });
      pago('v5', d(-2), 'ARS', 1570000, 1570, 'cheque', 'cartera', 'Lo rechazó el banco: avisar al cliente', {
        cheques: [{ id: 'ch1', numero: '00412233', aNombreDe: 'Padel Point SRL', banco: 'Banco Macro', fechaCobro: d(-1), monto: 1570000, estado: 'rechazado', cobradoFecha: '', cobradoTC: 0 }] });
      obra('v6', { nombre: 'Sr. Gómez – césped sin instalación', ...cancha('futbol', 15, 20), ...cesp('Monofilamento 40 mm', 'verde'), conInstalacion: false,
        ...cli('', 'Ricardo Gómez', ['tel', '11 5555 0106', 'Ricardo']), ubicacion: 'Merlo, Buenos Aires', fechaVenta: d(-7), plazo: 'inmediata', fechaEntrega: d(-1), estado: 'vendida',
        etapas: etapas('futbol', 0, false, { conInstalacion: false }), checklist: check('futbol', false, { conInstalacion: false }) },
      { precio: 3900, sena: 1950, senaFecha: d(-7), formaPago: 'contado' }, { sinSenaPago: true });

      /* ----- En entrega ----- */
      obra('e1', { nombre: 'Club Huracán – Cancha 1', ...cancha('futbol', 30, 60), ...cesp('Monofilamento 50 mm', 'verde'), ...cli('C. A. Huracán', 'Intendencia', ['tel', '11 5555 0201', 'Intendencia']),
        ubicacion: 'Parque Patricios, CABA', fechaVenta: d(-40), plazo: 'fabricacion', fechaEntrega: d(-12), estado: 'en_curso', habilitadaFecha: d(-14), habilitadaPorNombre: 'Delfina (demo)', instInicio: d(-10), instFin: d(2), equipo: 'Equipo AMBA 1', responsable: CAR, flete: 'Transporte del Sur · llegó el ' + UI.fmtDay(d(-11)), etapas: etapas('futbol', 5, true, {}, -10), checklist: check('futbol') },
      { precio: 38000, sena: 19000, senaFecha: d(-40), formaPago: 'contado' });
      pago('e1', d(-14), 'USD', 19000, 1545, 'efectivo_usd', 'caja_usd');
      obra('e2', { nombre: 'La Finca – Pádel 2 y 3', ...cancha('padel_completa', 10, 20, 0, 'simple', 2), ...cesp('Textil pádel', 'azul'), ...cli('La Finca Country', 'Administración', ['tel', '11 5555 0202', 'Administración']),
        ubicacion: 'Pilar, Buenos Aires', fechaVenta: d(-50), plazo: 'fabricacion', fechaEntrega: d(-6), estado: 'en_curso', habilitadaFecha: d(-8), habilitadaPorNombre: 'Delfina (demo)', instInicio: d(-5), instFin: d(4), equipo: 'Equipo AMBA 2', responsable: BETO, etapas: etapas('padel_completa', 5, true, {}, -5), checklist: check('padel_completa') },
      { precio: 52000, sena: 15600, senaFecha: d(-50), ...fin11(d(-20)), contratoFirmado: true, contratoFecha: d(-9), contratoPorNombre: 'Delfina (demo)' });
      pago('e2', d(-20), 'USD', 3673.09, 1550, 'cuenta', 'wmax', 'Cuota 1');
      obra('e3', { nombre: 'Club Norte – Pádel 1', ...cancha('padel_completa', 10, 20), ...cesp('Textil pádel', 'verde'), ...cli('Club Norte', 'Sr. Paredes', ['tel', '351 555 0203', 'Sr. Paredes']),
        ubicacion: 'Córdoba capital', interior: true, logistica: window.OBRAS_LOGISTICA.map((texto, i) => ({ id: 'l' + i, texto, ok: i < 3, porNombre: i < 3 ? 'Carajo (demo)' : '', fecha: i < 3 ? d(-15) : '' })), fechaVenta: d(-45), plazo: 'fabricacion', fechaEntrega: d(-16), estado: 'en_curso', habilitadaFecha: d(-18), instInicio: d(-14), instFin: d(-10), equipo: 'Instalador interior 1', responsable: CAR,
        etapas: etapas('padel_completa', 3, false, {}, -14, 'Carajo (demo)'), checklist: check('padel_completa'),
        incidencias: [{ id: 'i1', tipo: 'Falta material', detalle: 'Faltan 4 vidrios laterales, se pidieron a fábrica', avisadoCliente: true, resuelta: false, fecha: d(-11), porNombre: 'Carajo (demo)' }] },
      { precio: 27000, sena: 13500, senaFecha: d(-45), formaPago: 'contado' });
      pago('e3', d(-18), 'ARS', 20790000, 1540, 'cheque', 'cartera', 'Dos cheques diferidos', {
        cheques: [
          { id: 'ch1', numero: '00098765', aNombreDe: 'Club Norte', banco: 'Banco de Córdoba', fechaCobro: d(-10), monto: 10395000, estado: 'cobrado', cobradoFecha: d(-10), cobradoTC: 1540 },
          { id: 'ch2', numero: '00098766', aNombreDe: 'Club Norte', banco: 'Banco de Córdoba', fechaCobro: d(12), monto: 10395000, estado: 'pendiente', cobradoFecha: '', cobradoTC: 0 },
        ] });
      obra('e4', { nombre: 'Tenis Club Banfield – Cancha 3', ...cancha('tenis', 18.3, 36.6), ...cesp('Tenis arena 20 mm', 'verde'), ...cli('Tenis Club Banfield', '', ['tel', '11 5555 0204', 'Secretaría']),
        ubicacion: 'Banfield, Buenos Aires', fechaVenta: d(-30), plazo: 'fabricacion', fechaEntrega: d(1), estado: 'en_curso', habilitadaFecha: d(-2), habilitadaPorNombre: 'Delfina (demo)', instInicio: d(2), instFin: d(4), equipo: 'Equipo AMBA 3', responsable: BETO, flete: 'A coordinar', etapas: etapas('tenis', 0), checklist: check('tenis') },
      { precio: 14500, sena: 7250, senaFecha: d(-30), formaPago: 'contado' });
      pago('e4', d(-2), 'ARS', 11382500, 1570, 'cuenta', 'wmax');
      obra('e5', { nombre: 'Complejo La Cantera – F5 1 y 2', ...cancha('futbol', 20, 27.5, 0, 'simple', 2), ...cesp('Monofilamento 50 mm', 'verde'), ...cli('La Cantera SA', '', ['tel', '11 5555 0205', 'Oficina']),
        ubicacion: 'Moreno, Buenos Aires', fechaVenta: d(-22), plazo: 'fabricacion', fechaEntrega: d(6), estado: 'en_curso', habilitadaFecha: t, habilitadaPorNombre: 'Delfina (demo)', responsable: BETO, etapas: etapas('futbol', 0), checklist: check('futbol') },
      { precio: 30500, sena: 15250, senaFecha: d(-22), formaPago: 'contado' });
      pago('e5', t, 'USD', 15250, 1570, 'efectivo_usd', 'caja_usd');
      obra('e6', { nombre: 'Colegio Sarmiento – Multisport', ...cancha('futbol', 18, 25), ...cesp('Multisport', 'verde y rojo', true), ...cli('Colegio Sarmiento', '', ['tel', '11 5555 0206', 'Secretaría']),
        ubicacion: 'Haedo, Buenos Aires', fechaVenta: d(-25), plazo: 'fabricacion', fechaEntrega: d(1), estado: 'en_curso', habilitadaFecha: d(-1), instInicio: d(1), instFin: d(3), equipo: 'Equipo AMBA 1', responsable: CAR, etapas: etapas('futbol', 0), checklist: check('futbol') },
      { precio: 9800, sena: 4900, senaFecha: d(-25), formaPago: 'contado' });
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
      obra('t4', { nombre: 'Barrio Los Álamos – Residencial', tipo: 'residencial', m2: 140, ...cesp('Paisajismo 40 mm', 'verde'), conArena: false, ...cli('', 'Familia Ortiz', ['tel', '11 5555 0210', 'Sra. Ortiz']),
        ubicacion: 'Canning, Buenos Aires', fechaVenta: UI.addDays(fin4, -15), fechaEntrega: fin4, instInicio: fin4, instFin: fin4, equipo: 'Equipo AMBA 3', estado: 'terminada', fin: fin4, etapas: etapas('residencial', 8, false, {}, -380), checklist: check('residencial', true), postventa: pv(fin4, 3), garantiaAnios: 2, garantiaMeses: 24 },
      { precio: 3200, sena: 1600, senaFecha: UI.addDays(fin4, -15), formaPago: 'contado' });
      pago('t4', UI.addDays(fin4, -2), 'USD', 1600, 1000, 'efectivo_usd', 'caja_usd');

      /* ----- Fotos ----- */
      foto('e1', 'e2', 'Huracán · base lista', false, -8, 'Carajo (demo)');
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
