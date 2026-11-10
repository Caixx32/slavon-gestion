'use strict';

/*
 * Obras Slavon: avance de cada obra por etapas, fotos, checklist de entrega y post-venta.
 * Admin: todo. Encargado de obra: ve las obras, actualiza etapas, sube fotos y tilda el checklist.
 */

(() => {
  const { h, icon } = UI;
  const TIPOS = window.OBRAS_TIPOS;

  let me = null;
  let cloud = null;
  let isAdmin = false;
  let obras = [];
  let users = [];
  let fotos = [];          // fotos de la obra abierta
  let fotosObraId = null;
  let stopFotos = null;
  const ui = { obrasFiltro: 'en_curso', busqueda: '', pvFiltro: 'pendientes' };

  const main = h('main');
  // Reemplaza el contenido de la pantalla (acepta listas y null).
  const setMain = (...kids) => main.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  const tabsEl = document.getElementById('tabs');

  /* ---------- Arranque ---------- */

  SG.boot({
    app: 'obras',
    start(ctx) {
      me = ctx.me;
      cloud = ctx.cloud;
      isAdmin = me.role === 'admin';
      cloud.setWriteErrorHandler((e) => UI.toast('No se pudo guardar: ' + (e.code === 'permission-denied' ? 'no tenés permiso.' : e.message), 5000));
      if (cloud.demo) seedDemo();
      document.getElementById('app').replaceChildren(main);
      buildTabs();
      cloud.subscribe('obras', (items) => { obras = items; render(); }, (e) => UI.toast(e.message, 5000));
      cloud.subscribe('users', (items) => { users = items; render(); }, () => {});
      window.addEventListener('hashchange', render);
      render();
    },
  });

  function buildTabs() {
    // [ruta, ícono, nombre, sólo en la compu]
    const tabs = [['inicio', 'home', 'Inicio']];
    if (isAdmin) tabs.push(['panel', 'grid', 'Panel', true], ['ventas', 'tag', 'Ventas']);
    tabs.push(['agenda', 'calendar', 'Agenda'], ['obras', 'list', 'Obras']);
    if (isAdmin) tabs.push(['postventa', 'phone', 'Post-venta', true]);
    tabs.push(['mas', 'menu', 'Más']);
    tabsEl.replaceChildren(...tabs.map(([id, ic, label, pc]) => h('button', { type: 'button', 'data-tab': id, class: pc ? 'pc-tab' : '', onclick: () => go(id) }, icon(ic), h('span', label))),
      // Sólo en la compu: accesos a las otras apps de Slavon, abajo del menú.
      h('div.side-only.side-apps', h('div.side-title', 'Otras apps'),
        h('a', { href: 'https://caixx32.github.io/flota-slavon/' }, 'Flota'),
        h('a.off', 'Administración'), h('a.off', 'Depósito'), h('a.off', 'Personal')));
    tabsEl.hidden = false;
  }

  const go = (route) => { location.hash = '#/' + route; };
  const route = () => (location.hash.replace(/^#\/?/, '') || 'inicio').split('/');

  function render() {
    const [r, id] = route();
    tabsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === (r === 'obra' ? 'obras' : r)));
    if (r !== 'obra') watchFotos(null);
    document.querySelectorAll('.fab').forEach((f) => f.remove());
    document.body.classList.toggle('wide', r === 'panel' || r === 'agenda');
    if (r === 'obra') return viewObra(id);
    if (r === 'obras') return viewObras();
    if (r === 'postventa' && isAdmin) return viewPostventa();
    if (r === 'panel' && isAdmin) return viewPanel();
    if (r === 'ventas' && isAdmin) return viewVentas();
    if (r === 'agenda') return viewAgenda();
    if (r === 'mas') return viewMas();
    if (r === 'usuarios' && me.super) return SG.usersScreen(main, () => go('mas'));
    return viewInicio();
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
        if (route()[0] === 'obra') render();
      }, (e) => UI.toast(e.message), [['obraId', '==', obraId]]);
    }
  }

  /* ---------- Cálculos ---------- */

  const progreso = (o) => {
    const et = o.etapas || [];
    if (!et.length) return 0;
    return Math.round((et.filter((e) => e.estado === 'hecha').length / et.length) * 100);
  };
  const etapaActual = (o) => (o.etapas || []).find((e) => e.estado === 'en_curso') || (o.etapas || []).find((e) => e.estado !== 'hecha');
  const tipoNombre = (t) => (TIPOS[t] || TIPOS.otro).nombre;
  const userName = (email) => (users.find((u) => u._id === email) || {}).nombre || email;
  const stamp = () => ({ editadoPor: me.email, editadoPorNombre: me.nombre, editadoEn: cloud.serverTime() });
  const misObras = () => obras.filter((o) => (o.encargados || []).includes(me.email));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const esVendida = (o) => o.estado === 'vendida';
  const esCurso = (o) => !o.estado || o.estado === 'en_curso';
  const esTerminada = (o) => o.estado === 'terminada';
  const ESTADOS = { vendida: 'Vendida', en_curso: 'En entrega', terminada: 'Terminada' };
  // Cuántos días antes de la fecha de entrega avisa que hay que cobrar el saldo.
  const AVISO_SALDO_DIAS = 7;
  const fmtPlata = (v) => {
    const n = Number(String(v || '').replace(/[^\d,]/g, '').replace(',', '.'));
    return n ? '$ ' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '';
  };
  // Ventas con la entrega cerca (o pasada) y el saldo sin cobrar.
  const cobrosPendientes = () => obras
    .filter((o) => esVendida(o) && o.fechaEntrega && UI.daysUntil(o.fechaEntrega) <= AVISO_SALDO_DIAS)
    .sort((a, b) => a.fechaEntrega.localeCompare(b.fechaEntrega));
  const proximasInstalaciones = (dias) => obras
    .filter((o) => !esTerminada(o) && o.instInicio && UI.daysUntil(o.instInicio) >= 0 && UI.daysUntil(o.instInicio) <= dias)
    .sort((a, b) => a.instInicio.localeCompare(b.instInicio));

  // Llamados de post-venta no hechos de todas las obras terminadas, ordenados por fecha.
  function llamadosPendientes() {
    const out = [];
    for (const o of obras) {
      if (o.estado !== 'terminada') continue;
      for (const p of o.postventa || []) if (!p.hecho) out.push({ obra: o, p });
    }
    return out.sort((a, b) => a.p.fecha.localeCompare(b.p.fecha));
  }

  function progressBar(pct) {
    return h(`div.progress${pct === 100 ? '.done' : ''}`, h('span', { style: { width: pct + '%' } }));
  }

  /* ---------- Inicio ---------- */

  function viewInicio() {
    const enCurso = obras.filter(esCurso);
    const mias = isAdmin ? enCurso : misObras().filter(esCurso);
    const cobros = isAdmin ? cobrosPendientes() : [];
    const inst = proximasInstalaciones(7);
    const mostrar = (isAdmin || mias.length ? mias : enCurso).sort((a, b) => (a.inicio || '').localeCompare(b.inicio || ''));
    const pend = isAdmin ? llamadosPendientes().filter((x) => UI.daysUntil(x.p.fecha) <= 7) : [];

    setMain(
      h('h1', `Hola, ${me.nombre.split(' ')[0]}`),
      h('div.kpis',
        isAdmin ? kpi(obras.filter(esVendida).length, 'Vendidas', 'ventas') : null,
        kpi(enCurso.length, 'En entrega', 'obras'),
        isAdmin ? h('div.kpi.tap', { class: cobros.length ? 'bad' : '', onclick: () => go('ventas') }, h('b', cobros.length), h('span', 'Saldos a cobrar')) : null,
        isAdmin ? kpi(llamadosPendientes().filter((x) => UI.daysUntil(x.p.fecha) <= 0).length, 'Llamados para hoy', 'postventa') : null),
      cobros.length ? [h('h2', 'Cobrar saldo'), h('div.list', cobros.map(cobroItem))] : null,
      inst.length ? [h('h2', 'Instalaciones de los próximos 7 días'), h('div.list', inst.map(instItem))] : null,
      pend.length ? [h('h2', 'Llamados de post-venta'), h('div.list', pend.map((x) => llamadoItem(x, false)))] : null,
      h('h2', isAdmin || !mias.length ? 'Obras en entrega' : 'Mis obras'),
      mostrar.length ? mostrar.map(obraCard) : h('div.card.empty', isAdmin ? 'No hay obras en curso. Tocá + para cargar una.' : 'No hay obras en curso.'),
    );
    if (isAdmin) addFab();
  }

  function kpi(n, label, to) {
    return h('div.kpi', { class: to ? 'tap' : '', onclick: to ? () => go(to) : null }, h('b', n), h('span', label));
  }

  function obraCard(o) {
    if (esVendida(o)) {
      const d = o.fechaEntrega ? UI.daysUntil(o.fechaEntrega) : null;
      return h('div.card.tap.obra-card', { onclick: () => go('obra/' + o._id) },
        h('div.row',
          h('div.grow', h('h3.ellipsis', o.nombre), h('div.small.muted.ellipsis', [tipoNombre(o.tipo), o.cliente].filter(Boolean).join(' · '))),
          h('span.badge.blue', 'Vendida')),
        h('div.small', { style: { marginTop: '8px' } },
          o.fechaEntrega ? [h('span.muted', 'Entrega: '), UI.fmtDay(o.fechaEntrega), ' ', d <= AVISO_SALDO_DIAS ? h('span.badge.red', 'Cobrar saldo') : h('span.muted', '(' + UI.relDays(o.fechaEntrega) + ')')] : h('span.muted', 'Sin fecha de entrega')));
    }
    const pct = progreso(o);
    const act = etapaActual(o);
    return h('div.card.tap.obra-card', { onclick: () => go('obra/' + o._id) },
      h('div.row',
        h('div.grow',
          h('h3.ellipsis', o.nombre),
          h('div.small.muted.ellipsis', [tipoNombre(o.tipo), o.ubicacion].filter(Boolean).join(' · '))),
        o.estado === 'terminada' ? h('span.badge.ok', 'Terminada') : h('b.pct', pct + '%')),
      h('div', { style: { margin: '10px 0 6px' } }, progressBar(o.estado === 'terminada' ? 100 : pct)),
      o.estado !== 'terminada' && act ? h('div.small', h('span.muted', act.estado === 'en_curso' ? 'En curso: ' : 'Sigue: '), act.nombre) : null);
  }

  function addFab() {
    document.body.append(h('button.fab', { type: 'button', 'aria-label': 'Nueva obra', onclick: () => editObra(null) }, icon('plus')));
  }

  /* ---------- Panel (para la compu) ---------- */

  // Fase de la obra según la etapa en la que está, para el tablero.
  const FASES = [
    ['prep', 'Preparación', /base|env[ií]o|pintura/i],
    ['estr', 'Estructura y luces', /estructura|cableado|luces|vidrio/i],
    ['cesp', 'Césped', /tendido|verde|corte|blanco/i],
    ['term', 'Terminación', /arena|caucho|cepillado/i],
  ];
  function faseDe(o) {
    if (esVendida(o)) return 'venta';
    if (o.estado === 'terminada') return 'fin';
    const act = etapaActual(o);
    if (!act) return 'term';
    const f = FASES.find(([, , re]) => re.test(act.nombre));
    return f ? f[0] : 'prep';
  }
  // Último avance: la fecha más reciente de una etapa hecha (o el inicio).
  function ultimoAvance(o) {
    const fechas = (o.etapas || []).filter((e) => e.estado === 'hecha' && e.fecha).map((e) => e.fecha);
    return fechas.sort().pop() || o.inicio || UI.today();
  }
  const SIN_AVANCE_DIAS = 7;

  function viewPanel() {
    const enCurso = obras.filter(esCurso);
    const cobros = cobrosPendientes();
    const mes = UI.today().slice(0, 7);
    const terminadasMes = obras.filter((o) => o.estado === 'terminada' && (o.fin || '').startsWith(mes));
    const quietas = enCurso.filter((o) => -UI.daysUntil(ultimoAvance(o)) > SIN_AVANCE_DIAS);
    const vencidos = llamadosPendientes().filter((x) => UI.daysUntil(x.p.fecha) < 0);
    const semana = llamadosPendientes().filter((x) => { const d = UI.daysUntil(x.p.fecha); return d >= 0 && d <= 7; });
    const promedio = enCurso.length ? Math.round(enCurso.reduce((a, o) => a + progreso(o), 0) / enCurso.length) : 0;

    // Tablero por fase
    const cols = [['venta', 'Vendidas'], ...FASES.map(([k, n]) => [k, n]), ['fin', 'Terminadas']];
    const board = h('div.board', cols.map(([k, n]) => {
      const items = obras.filter((o) => faseDe(o) === k)
        .filter((o) => k !== 'fin' || -UI.daysUntil(o.fin || UI.today()) <= 60)
        .sort((a, b) => progreso(b) - progreso(a));
      return h('div.board-col',
        h('div.board-head', h('b', n), h('span.badge', items.length)),
        items.length ? items.map((o) => {
          if (esVendida(o)) {
            return h('div.board-card', { onclick: () => go('obra/' + o._id) },
              h('div.ellipsis', { style: { fontWeight: 700 } }, o.nombre),
              h('div.small.muted.ellipsis', tipoNombre(o.tipo)),
              h('div.row.small', { style: { marginTop: '8px' } },
                h('span.grow', o.fechaEntrega ? 'Entrega ' + UI.fmtDay(o.fechaEntrega) : 'Sin fecha'),
                cobros.includes(o) ? h('span.badge.red', 'Cobrar') : null));
          }
          const pct = progreso(o);
          const act = etapaActual(o);
          const quieta = esCurso(o) && -UI.daysUntil(ultimoAvance(o)) > SIN_AVANCE_DIAS;
          return h('div.board-card', { onclick: () => go('obra/' + o._id) },
            h('div.ellipsis', { style: { fontWeight: 700 } }, o.nombre),
            h('div.small.muted.ellipsis', tipoNombre(o.tipo)),
            h('div', { style: { margin: '8px 0 6px' } }, progressBar(o.estado === 'terminada' ? 100 : pct)),
            h('div.row.small',
              h('span.grow.ellipsis', o.estado === 'terminada' ? 'Terminada ' + UI.fmtDay(o.fin) : act ? act.nombre : ''),
              quieta ? h('span.badge.warn', 'Quieta') : h('b', { style: { color: 'var(--muted)' } }, (o.estado === 'terminada' ? 100 : pct) + '%')));
        }) : h('div.small.muted', { style: { padding: '8px 2px' } }, 'Sin obras'));
    }));

    // Tabla
    const rows = [...enCurso].sort((a, b) => progreso(b) - progreso(a));
    const table = h('div.table-wrap', h('table.tabla',
      h('thead', h('tr', ['Obra', 'Tipo', 'Avance', 'Etapa actual', 'Encargados', 'Días en obra', 'Último avance'].map((t) => h('th', t)))),
      h('tbody', rows.length ? rows.map((o) => {
        const pct = progreso(o);
        const act = etapaActual(o);
        const dias = -UI.daysUntil(o.inicio || UI.today());
        const ult = -UI.daysUntil(ultimoAvance(o));
        return h('tr', { onclick: () => go('obra/' + o._id) },
          h('td', h('b', o.nombre), h('div.small.muted', o.ubicacion || '')),
          h('td', tipoNombre(o.tipo)),
          h('td', h('div.row', h('div.grow', { style: { minWidth: '80px' } }, progressBar(pct)), h('b', pct + '%'))),
          h('td', act ? [act.nombre, act.estado === 'en_curso' ? h('span.badge.warn', { style: { marginLeft: '6px' } }, 'en curso') : null] : '—'),
          h('td', (o.encargados || []).map(userName).join(', ') || '—'),
          h('td', dias),
          h('td', ult > SIN_AVANCE_DIAS ? h('span.badge.warn', `hace ${ult} días`) : ult <= 0 ? 'hoy' : `hace ${ult} día${ult > 1 ? 's' : ''}`));
      }) : h('tr', h('td', { colSpan: 7, class: 'muted' }, 'No hay obras en curso.')))));

    setMain(
      h('div.row', h('h1.grow', 'Panel de obras'), h('button.btn.primary.small', { type: 'button', onclick: () => editObra(null) }, icon('plus'), 'Nueva obra')),
      h('div.kpis.kpis-wide',
        kpi(obras.filter(esVendida).length, 'Vendidas', 'ventas'),
        h('div.kpi.tap', { class: cobros.length ? 'bad' : '', onclick: () => go('ventas') }, h('b', cobros.length), h('span', 'Saldos a cobrar')),
        kpi(enCurso.length, 'En entrega', 'obras'),
        kpi(promedio + '%', 'Avance promedio'),
        h('div.kpi', { class: quietas.length ? 'warn' : '' }, h('b', quietas.length), h('span', `Sin avance hace +${SIN_AVANCE_DIAS} días`)),
        kpi(terminadasMes.length, 'Terminadas este mes'),
        h('div.kpi.tap', { class: vencidos.length ? 'bad' : '', onclick: () => go('postventa') }, h('b', vencidos.length), h('span', 'Llamados vencidos')),
        kpi(semana.length, 'Llamados esta semana', 'postventa')),
      h('h2', 'Tablero por etapa'),
      board,
      h('h2', 'Obras en entrega'),
      table,
      quietas.length ? [h('h2', `Sin avance hace más de ${SIN_AVANCE_DIAS} días`), h('div.list', quietas.map((o) => h('div.item', { onclick: () => go('obra/' + o._id) },
        h('span.dot.late', '!'), h('div.grow', h('div', { style: { fontWeight: 600 } }, o.nombre), h('div.small.muted', `Último avance ${UI.fmtDay(ultimoAvance(o))} · ${etapaActual(o) ? etapaActual(o).nombre : ''}`)), icon('chev'))))] : null);
  }

  /* ---------- Lista de obras ---------- */

  function viewObras() {
    const seg = h('div.seg', [['vendida', 'Vendidas'], ['en_curso', 'En entrega'], ['terminada', 'Terminadas'], ['todas', 'Todas']].map(([v, t]) =>
      h('button', { type: 'button', class: ui.obrasFiltro === v ? 'on' : '', onclick: () => { ui.obrasFiltro = v; render(); } }, t)));
    const search = h('input.search', { type: 'search', placeholder: 'Buscar obra, cliente o lugar', value: ui.busqueda });
    const listEl = h('div');
    search.addEventListener('input', () => { ui.busqueda = search.value; fill(); });
    function fill() {
      const q = ui.busqueda.trim().toLowerCase();
      const items = obras
        .filter((o) => ui.obrasFiltro === 'todas' || (o.estado || 'en_curso') === ui.obrasFiltro)
        .filter((o) => !q || [o.nombre, o.cliente, o.ubicacion].join(' ').toLowerCase().includes(q))
        .sort((a, b) => (b.inicio || '').localeCompare(a.inicio || ''));
      listEl.replaceChildren(...(items.length ? items.map(obraCard) : [h('div.card.empty', 'No hay obras.')]));
    }
    setMain(h('h1', 'Obras'), seg, h('div', { style: { marginBottom: '14px' } }, search), listEl);
    fill();
    if (isAdmin) addFab();
  }

  /* ---------- Detalle de una obra ---------- */

  function viewObra(id) {
    const o = obras.find((x) => x._id === id);
    if (!o) {
      setMain(backBtn(), h('div.card.empty', obras.length ? 'La obra no existe o se eliminó.' : 'Cargando…'));
      return;
    }
    watchFotos(id);
    const pct = progreso(o);
    const terminada = o.estado === 'terminada';
    const hechas = (o.etapas || []).filter((e) => e.estado === 'hecha').length;
    const wa = UI.waLink(o.telefono);

    setMain(
      backBtn(),
      h('div.row', { style: { alignItems: 'flex-start' } },
        h('div.grow', h('h1', { style: { marginBottom: '4px' } }, o.nombre), h('div.muted', tipoNombre(o.tipo))),
        isAdmin ? h('button.btn.small', { type: 'button', onclick: () => editObra(o) }, icon('edit'), 'Editar') : null),
      h('div.row', { style: { margin: '6px 0 0' } }, h('span.badge', { class: esVendida(o) ? 'blue' : terminada ? 'ok' : 'warn' }, ESTADOS[o.estado || 'en_curso'])),
      ventaCard(o),
      esVendida(o) ? null : h('div.card', { style: { marginTop: '14px' } },
        h('div.row', h('b.grow', terminada ? 'Obra terminada' : `${hechas} de ${(o.etapas || []).length} etapas`), terminada ? h('span.badge.ok', 'Terminada ' + UI.fmtDay(o.fin)) : h('b.pct', pct + '%')),
        h('div', { style: { marginTop: '10px' } }, progressBar(terminada ? 100 : pct))),
      h('div.card.info',
        infoRow('Cliente', o.cliente),
        o.telefono ? infoRow('Teléfono', h('span.row.wrap', { style: { gap: '6px' } }, o.telefono,
          h('a.btn.small', { href: 'tel:' + o.telefono.replace(/\s/g, '') }, icon('phone')),
          wa ? h('a.btn.small', { href: wa, target: '_blank', rel: 'noopener' }, icon('whatsapp')) : null)) : null,
        o.ubicacion ? infoRow('Ubicación', h('a', { href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.ubicacion), target: '_blank', rel: 'noopener' }, o.ubicacion)) : null,
        infoRow('Encargados', (o.encargados || []).map(userName).join(', ') || '—'),
        o.notas ? infoRow('Notas', o.notas) : null,
        o.editadoPorNombre ? h('div.small.muted', { style: { marginTop: '8px' } }, 'Último cambio: ' + [o.editadoPorNombre, UI.fmtStamp(o.editadoEn)].filter(Boolean).join(' · ')) : null),

      h('div.row', h('h2.grow', 'Etapas'), isAdmin ? h('button.btn.small.ghost', { type: 'button', onclick: () => editEtapas(o) }, icon('edit'), 'Editar etapas') : null),
      (o.etapas || []).length
        ? h('div.list', (o.etapas || []).map((e, i) => etapaItem(o, e, i)))
        : h('div.card.empty', 'Esta obra no tiene etapas.', isAdmin ? h('div', h('button.btn.small', { type: 'button', style: { marginTop: '10px' }, onclick: () => editEtapas(o) }, 'Agregar etapas')) : null),

      h('div.row', h('h2.grow', 'Fotos'), h('button.btn.small', { type: 'button', onclick: () => addFotos(o, '') }, icon('camera'), 'Agregar')),
      fotosGrid(fotos, o, true),

      h('div.row', h('h2.grow', 'Checklist de entrega'), isAdmin ? h('button.btn.small.ghost', { type: 'button', onclick: () => editChecklist(o) }, icon('edit'), 'Editar') : null),
      checklistCard(o),

      terminada ? [h('h2', 'Post-venta'), h('div.list', (o.postventa || []).map((p) => llamadoItem({ obra: o, p }, true)))] : null,

      isAdmin && esVendida(o) ? h('div', { style: { margin: '24px 0 8px' } },
        h('button.btn.primary.block', { type: 'button', onclick: () => cobrarSaldo(o) }, icon('check'), 'Saldo cobrado: pasar a entrega')) : null,
      isAdmin && !esVendida(o) ? h('div', { style: { margin: '24px 0 8px' } },
        terminada
          ? h('button.btn.block', { type: 'button', onclick: () => reabrir(o) }, 'Reabrir obra')
          : h('button.btn.dark.block', { type: 'button', onclick: () => terminar(o) }, icon('check'), 'Marcar obra como terminada')) : null,
    );
  }

  /* ---------- Venta, cobro del saldo y agenda de instalación ---------- */

  function ventaCard(o) {
    const d = o.fechaEntrega ? UI.daysUntil(o.fechaEntrega) : null;
    const alerta = esVendida(o) && d != null && d <= AVISO_SALDO_DIAS;
    const instTxt = o.instInicio ? UI.fmtDay(o.instInicio) + (o.instFin && o.instFin !== o.instInicio ? ' al ' + UI.fmtDay(o.instFin) : '') : 'Sin programar';
    return h('div.card.info', { style: { marginTop: '14px' } },
      alerta ? h('div.form-error', `Entrega ${UI.relDays(o.fechaEntrega)}: hay que cobrar el saldo.`) : null,
      infoRow('Venta', [UI.fmtDay(o.fechaVenta) || '—', o.creadoPorNombre ? h('span.muted', ' · cargó ' + o.creadoPorNombre) : null]),
      infoRow('Entrega', o.fechaEntrega ? [UI.fmtDay(o.fechaEntrega), !esTerminada(o) ? h('span.muted', ' (' + UI.relDays(o.fechaEntrega) + ')') : null] : '—'),
      isAdmin ? infoRow('Saldo', o.saldoCobrado
        ? h('span', h('span.badge.ok', 'Cobrado'), ' ', UI.fmtDay(o.saldoCobradoFecha), o.saldoCobradoPorNombre ? h('span.muted', ' · ' + o.saldoCobradoPorNombre) : null)
        : h('span', fmtPlata(o.saldo) || 'Sin monto cargado', ' ', esVendida(o) ? h('span.badge.red', 'Pendiente') : null)) : null,
      infoRow('Instalación', h('span.row.wrap', { style: { gap: '8px' } }, instTxt,
        isAdmin && !esTerminada(o) ? h('button.btn.small', { type: 'button', onclick: () => programar(o) }, icon('calendar'), o.instInicio ? 'Cambiar' : 'Programar') : null)),
      infoRow('Responsable de entrega', o.responsable ? userName(o.responsable) : '—'));
  }

  function responsableField(value) {
    const posibles = users.filter((u) => u.activo !== false && u.apps && u.apps.obras);
    return UI.field({
      label: 'Responsable de entrega', name: 'responsable', type: 'select', value: value || '',
      options: [['', 'Sin asignar'], ...posibles.map((u) => [u._id, u.nombre || u._id])],
    });
  }

  function cobrarSaldo(o) {
    const body = h('div',
      h('p.muted', { style: { marginTop: '-8px' } }, o.nombre),
      UI.field({ label: 'Fecha en que se cobró', name: 'fecha', type: 'date', value: UI.today() }),
      responsableField(o.responsable),
      h('div.row', { style: { gap: '10px' } },
        h('div.grow', UI.field({ label: 'Instalación desde', name: 'instInicio', type: 'date', value: o.instInicio || '' })),
        h('div.grow', UI.field({ label: 'Hasta (estimado)', name: 'instFin', type: 'date', value: o.instFin || '' }))),
      h('p.small.muted', 'La obra pasa a «En entrega» y aparece en la agenda de instalación.'));
    UI.sheet({
      title: 'Saldo cobrado',
      body: [body],
      actions: [{ label: 'Cancelar' }, {
        label: 'Pasar a entrega', kind: 'primary', onClick: () => {
          const v = UI.values(body);
          if (v.instFin && v.instInicio && v.instFin < v.instInicio) throw new Error('La fecha «hasta» no puede ser antes de «desde».');
          cloud.patch('obras', o._id, {
            estado: 'en_curso', saldoCobrado: true, saldoCobradoFecha: v.fecha || UI.today(),
            saldoCobradoPor: me.email, saldoCobradoPorNombre: me.nombre,
            responsable: v.responsable, instInicio: v.instInicio, instFin: v.instFin || v.instInicio,
            inicio: v.instInicio || o.inicio || UI.today(), ...stamp(),
          });
          UI.toast('Listo: la obra pasó a entrega');
        },
      }],
    });
  }

  function programar(o) {
    const body = h('div',
      h('p.muted', { style: { marginTop: '-8px' } }, o.nombre),
      h('div.row', { style: { gap: '10px' } },
        h('div.grow', UI.field({ label: 'Instalación desde', name: 'instInicio', type: 'date', value: o.instInicio || o.fechaEntrega || UI.today() })),
        h('div.grow', UI.field({ label: 'Hasta (estimado)', name: 'instFin', type: 'date', value: o.instFin || '' }))),
      responsableField(o.responsable));
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
            const data = { instInicio: v.instInicio, instFin: v.instFin || v.instInicio, responsable: v.responsable, ...stamp() };
            if (esCurso(o) && !o.inicio) data.inicio = v.instInicio;
            cloud.patch('obras', o._id, data);
            UI.toast('Instalación agendada');
          },
        },
      ],
    });
  }

  function cobroItem(o) {
    const d = UI.daysUntil(o.fechaEntrega);
    return h('div.item', { onclick: () => go('obra/' + o._id) },
      h('span.dot.late', '$'),
      h('div.grow',
        h('div.ellipsis', { style: { fontWeight: 600 } }, o.nombre),
        h('div.small.muted.ellipsis', [`Entrega ${UI.fmtDay(o.fechaEntrega)}`, fmtPlata(o.saldo), o.cliente].filter(Boolean).join(' · '))),
      h('span.badge', { class: d < 0 ? 'red' : 'warn' }, d < 0 ? 'Entrega vencida' : UI.relDays(o.fechaEntrega)));
  }

  function instItem(o) {
    return h('div.item', { onclick: () => go('obra/' + o._id) },
      h('span.dot', { class: 'doing' }, icon('calendar')),
      h('div.grow',
        h('div.ellipsis', { style: { fontWeight: 600 } }, o.nombre),
        h('div.small.muted.ellipsis', [tipoNombre(o.tipo), o.ubicacion, o.responsable ? userName(o.responsable) : ''].filter(Boolean).join(' · '))),
      h('span.badge.blue', UI.fmtDay(o.instInicio) + (o.instFin && o.instFin !== o.instInicio ? ' – ' + UI.fmtDay(o.instFin) : '')));
  }

  /* ---------- Ventas ---------- */

  function viewVentas() {
    const vendidas = obras.filter(esVendida).sort((a, b) => (a.fechaEntrega || '9').localeCompare(b.fechaEntrega || '9'));
    const cobros = cobrosPendientes();
    const resto = vendidas.filter((o) => !cobros.includes(o));
    setMain(
      h('div.row', h('h1.grow', 'Ventas'), h('button.btn.primary.small', { type: 'button', onclick: () => editObra(null) }, icon('plus'), 'Nueva venta')),
      h('p.muted.small', `Se carga la venta con su fecha de entrega. ${AVISO_SALDO_DIAS} días antes de la entrega avisa que hay que cobrar el saldo; cuando se cobra, la obra pasa a entrega.`),
      h('h2', 'Cobrar saldo'),
      cobros.length ? h('div.list', cobros.map(cobroItem)) : h('div.card.empty.small', 'No hay saldos para cobrar por ahora.'),
      h('h2', 'Vendidas, con entrega más adelante'),
      resto.length ? resto.map(obraCard) : h('div.card.empty.small', 'No hay otras ventas pendientes.'));
  }

  /* ---------- Agenda de instalación ---------- */

  function viewAgenda() {
    if (!ui.agendaMes) ui.agendaMes = UI.today().slice(0, 7);
    const [y, m] = ui.agendaMes.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const days = new Date(y, m, 0).getDate();
    const offset = (first.getDay() + 6) % 7; // lunes primero
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
        inst.map((o) => h('button.cal-chip', { type: 'button', class: o.tipo === 'padel_completa' ? 'full' : '', title: o.nombre, onclick: () => go('obra/' + o._id) }, o.nombre)),
        ent.map((o) => h('button.cal-chip.ent', { type: 'button', title: 'Entrega comprometida (sin instalación programada): ' + o.nombre, onclick: () => go('obra/' + o._id) }, '⏳ ' + o.nombre))));
    }

    const proximas = conFecha.filter((o) => (o.instFin || o.instInicio) >= UI.today()).sort((a, b) => a.instInicio.localeCompare(b.instInicio));
    const sinFecha = obras.filter((o) => esCurso(o) && !o.instInicio);

    setMain(
      h('h1', 'Agenda de instalación'),
      h('div.row.cal-nav',
        h('button.btn.small', { type: 'button', onclick: () => moveMonth(-1) }, icon('back')),
        h('b.grow', { style: { textAlign: 'center', fontSize: '17px' } }, mesNombre),
        h('button.btn.small', { type: 'button', onclick: () => moveMonth(1) }, icon('chev'))),
      h('div.cal-legend.small.muted', h('span.cal-chip', 'Césped'), h('span.cal-chip.full', 'Cancha completa'), h('span.cal-chip.ent', '⏳ Entrega comprometida sin programar')),
      h('div.cal', ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => h('div.cal-head', d)), cells),
      h('h2', 'Próximas instalaciones'),
      proximas.length ? h('div.list', proximas.map(instItem)) : h('div.card.empty.small', 'No hay instalaciones programadas.'),
      isAdmin && sinFecha.length ? [h('h2', 'En entrega sin fecha de instalación'), h('div.list', sinFecha.map((o) => h('div.item', { onclick: () => programar(o) },
        h('span.dot', icon('calendar')), h('div.grow', h('div', { style: { fontWeight: 600 } }, o.nombre), h('div.small.muted', tipoNombre(o.tipo))), h('span.badge', 'Programar'))))] : null);
  }

  function backBtn() {
    return h('button.btn.ghost.small', { type: 'button', style: { marginBottom: '6px', paddingLeft: 0 }, onclick: () => (history.length > 1 ? history.back() : go('obras')) }, icon('back'), 'Volver');
  }

  function infoRow(label, value) {
    return h('div.info-row', h('span.muted', label), h('div', value || '—'));
  }

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

  function fotosGrid(list, o, showEtapa) {
    if (!list.length) return h('div.card.empty.small', 'Todavía no hay fotos.');
    return h('div.fotos', list.map((f) => {
      const et = (o.etapas || []).find((e) => e.id === f.etapaId);
      const src = 'data:image/jpeg;base64,' + f.data;
      const caption = [et ? et.nombre : 'General', f.porNombre, UI.fmtDay(f.fecha.slice(0, 10)), f.nota].filter(Boolean).join(' · ');
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

  /* ---------- Etapas ---------- */

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
    const body = h('div', h('p.muted', { style: { marginTop: '-8px' } }, o.nombre), segEl, fechaWrap, nota,
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

  function checklistDefault(tipo) {
    const c = window.OBRAS_CHECKLIST;
    return [...c.comun, ...(c[tipo] || [])].map((texto) => ({ id: uid(), texto, ok: false }));
  }

  /* ---------- Terminar / reabrir ---------- */

  function terminar(o) {
    const faltanEt = (o.etapas || []).filter((e) => e.estado !== 'hecha').length;
    const faltanCh = (o.checklist || []).filter((c) => !c.ok).length;
    const avisos = [];
    if (faltanEt) avisos.push(`${faltanEt} etapa${faltanEt > 1 ? 's' : ''} sin terminar`);
    if (faltanCh) avisos.push(`${faltanCh} control${faltanCh > 1 ? 'es' : ''} del checklist sin tildar`);
    const fecha = UI.field({ label: 'Fecha de terminación', name: 'fin', type: 'date', value: UI.today() });
    UI.sheet({
      title: 'Terminar obra',
      body: [
        avisos.length ? h('div.form-error', 'Ojo: quedan ' + avisos.join(' y ') + '.') : null,
        fecha,
        h('p.muted.small', 'Se agendan solos los llamados de post-venta al cliente: al mes, a los 6 meses y al año.'),
      ],
      actions: [{ label: 'Cancelar' }, {
        label: 'Terminar obra', kind: 'primary', onClick: () => {
          const fin = UI.values(fecha).fin || UI.today();
          const postventa = window.OBRAS_POSTVENTA.map((p) => ({ id: p.id, label: p.label, fecha: UI.addMonths(fin, p.meses), hecho: false, nota: '' }));
          cloud.patch('obras', o._id, { estado: 'terminada', fin, postventa, ...stamp() });
          UI.toast('Obra terminada. Post-venta agendado.');
        },
      }],
    });
  }

  async function reabrir(o) {
    if (!(await UI.confirm('¿Reabrir la obra?', 'Vuelve a «en curso» y se borran los llamados de post-venta agendados.', 'Reabrir'))) return;
    cloud.patch('obras', o._id, { estado: 'en_curso', fin: '', postventa: [], ...stamp() });
  }

  /* ---------- Post-venta ---------- */

  function viewPostventa() {
    const seg = h('div.seg', [['pendientes', 'Pendientes'], ['hechos', 'Hechos']].map(([v, t]) =>
      h('button', { type: 'button', class: ui.pvFiltro === v ? 'on' : '', onclick: () => { ui.pvFiltro = v; render(); } }, t)));
    let items;
    if (ui.pvFiltro === 'pendientes') {
      items = llamadosPendientes();
    } else {
      items = [];
      for (const o of obras) for (const p of o.postventa || []) if (p.hecho) items.push({ obra: o, p });
      items.sort((a, b) => (b.p.hechoFecha || '').localeCompare(a.p.hechoFecha || ''));
    }
    setMain(
      h('h1', 'Post-venta'),
      h('p.muted.small', 'Cuando una obra se marca como terminada, se agendan llamados al cliente al mes, a los 6 meses y al año para ver cómo viene la cancha.'),
      seg,
      items.length ? h('div.list', items.map((x) => llamadoItem(x, false))) : h('div.card.empty', ui.pvFiltro === 'pendientes' ? 'No hay llamados pendientes.' : 'Todavía no se hizo ningún llamado.'));
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

  /* ---------- Alta / edición de obra ---------- */

  function editObra(o) {
    const isNew = !o;
    const posibles = users.filter((u) => u.activo !== false && u.apps && u.apps.obras);
    const elegidos = new Set(o ? o.encargados || [] : []);
    const encBox = h('div.field', h('span', 'Encargados de la obra'),
      posibles.length ? posibles.map((u) => h('label.check', h('input', {
        type: 'checkbox', checked: elegidos.has(u._id), onchange: (ev) => { if (ev.target.checked) elegidos.add(u._id); else elegidos.delete(u._id); },
      }), u.nombre || u._id)) : h('div.small.muted', 'Todavía no hay encargados dados de alta (Más → Usuarios y permisos).'));
    const body = h('div',
      UI.field({ label: 'Nombre de la obra', name: 'nombre', value: o ? o.nombre : '', required: true, placeholder: 'Ej: Club Huracán – Cancha 1' }),
      UI.field({ label: 'Tipo', name: 'tipo', type: 'select', value: o ? o.tipo : 'futbol', options: Object.entries(TIPOS).map(([k, t]) => [k, t.nombre]) }),
      isNew ? null : h('p.small.muted', { style: { marginTop: '-8px' } }, 'Cambiar el tipo no cambia las etapas: para eso usá «Editar etapas».'),
      UI.field({ label: 'Cliente', name: 'cliente', value: o ? o.cliente : '', placeholder: 'Nombre y apellido o club' }),
      UI.field({ label: 'Teléfono del cliente', name: 'telefono', type: 'tel', value: o ? o.telefono : '', placeholder: 'Ej: 11 5555 5555' }),
      UI.field({ label: 'Ubicación', name: 'ubicacion', value: o ? o.ubicacion : '', placeholder: 'Dirección o localidad' }),
      h('h3', { style: { margin: '18px 0 10px' } }, 'Venta'),
      isNew ? UI.field({ label: 'Estado', name: 'estado', type: 'select', value: 'vendida', options: [['vendida', 'Vendida (falta cobrar el saldo)'], ['en_curso', 'Saldo cobrado, ya en entrega']] }) : null,
      h('div.row', { style: { gap: '10px' } },
        h('div.grow', UI.field({ label: 'Fecha de venta', name: 'fechaVenta', type: 'date', value: o ? o.fechaVenta : UI.today() })),
        h('div.grow', UI.field({ label: 'Fecha de entrega', name: 'fechaEntrega', type: 'date', value: o ? o.fechaEntrega : '' }))),
      UI.field({ label: 'Saldo a cobrar antes de la entrega ($)', name: 'saldo', inputMode: 'numeric', value: o ? o.saldo : '', placeholder: 'Ej: 1.500.000' }),
      h('h3', { style: { margin: '18px 0 10px' } }, 'Entrega'),
      responsableField(o ? o.responsable : ''),
      h('div.row', { style: { gap: '10px' } },
        h('div.grow', UI.field({ label: 'Instalación desde', name: 'instInicio', type: 'date', value: o ? o.instInicio : '' })),
        h('div.grow', UI.field({ label: 'Hasta (estimado)', name: 'instFin', type: 'date', value: o ? o.instFin : '' }))),
      encBox,
      UI.field({ label: 'Notas', name: 'notas', type: 'textarea', value: o ? o.notas : '' }));
    const actions = [{ label: 'Cancelar' }, {
      label: isNew ? 'Crear obra' : 'Guardar', kind: 'primary', onClick: () => {
        const v = UI.values(body);
        if (!v.nombre) throw new Error('Poné el nombre de la obra.');
        if (v.instFin && v.instInicio && v.instFin < v.instInicio) throw new Error('La instalación «hasta» no puede ser antes de «desde».');
        const data = {
          nombre: v.nombre, tipo: v.tipo, cliente: v.cliente, telefono: v.telefono, ubicacion: v.ubicacion,
          fechaVenta: v.fechaVenta, fechaEntrega: v.fechaEntrega, saldo: v.saldo, responsable: v.responsable,
          instInicio: v.instInicio, instFin: v.instFin || v.instInicio,
          encargados: [...elegidos], notas: v.notas, ...stamp(),
        };
        if (isNew) {
          const id = cloud.newId();
          cloud.put('obras', id, {
            ...data, estado: v.estado || 'vendida', fin: '', postventa: [],
            inicio: v.instInicio || (v.estado === 'en_curso' ? UI.today() : ''),
            saldoCobrado: v.estado === 'en_curso',
            creadoPorNombre: me.nombre,
            etapas: (TIPOS[v.tipo] || TIPOS.otro).etapas.map((nombre) => ({ id: uid(), nombre, estado: 'pendiente', nota: '' })),
            checklist: checklistDefault(v.tipo),
            creadoPor: me.email, creadoEn: cloud.serverTime(),
          });
          go('obra/' + id);
          UI.toast(v.estado === 'en_curso' ? 'Obra creada' : 'Venta cargada');
        } else {
          cloud.patch('obras', o._id, data);
          UI.toast('Guardado');
        }
      },
    }];
    if (!isNew) {
      actions.unshift({
        label: 'Eliminar', kind: 'danger', onClick: async () => {
          if (!(await UI.confirm('¿Eliminar la obra?', `Se borra «${o.nombre}» con todas sus fotos. No se puede deshacer.`, 'Eliminar'))) return false;
          const ops = [{ op: 'delete', col: 'obras', id: o._id }, ...fotos.filter((f) => f.obraId === o._id).map((f) => ({ op: 'delete', col: 'fotos', id: f._id }))];
          for (let i = 0; i < ops.length; i += 400) cloud.write(ops.slice(i, i + 400));
          go('obras');
          UI.toast('Obra eliminada');
        },
      });
    }
    UI.sheet({ title: isNew ? 'Nueva venta / obra' : 'Editar obra', body: [body], actions });
  }

  /* ---------- Más ---------- */

  function viewMas() {
    const roleName = window.SG_CONFIG.apps.obras.roles[me.role];
    setMain(
      h('h1', 'Más'),
      h('div.card', h('b', me.nombre), h('div.small.muted', `${me.email} · ${roleName}`)),
      h('div.list',
        isAdmin ? h('div.item.mobile-only', { onclick: () => go('postventa') }, icon('phone'), h('div.grow', 'Post-venta'), icon('chev')) : null,
        isAdmin ? h('div.item.mobile-only', { onclick: () => go('panel') }, icon('grid'), h('div.grow', 'Panel (mejor en la compu)'), icon('chev')) : null,
        me.super ? h('div.item', { onclick: () => go('usuarios') }, icon('users'), h('div.grow', 'Usuarios y permisos'), icon('chev')) : null,
        h('a.item', { href: '../', style: { color: 'inherit', textDecoration: 'none' } }, icon('home'), h('div.grow', 'Otras apps de Slavon'), icon('chev')),
        h('div.item', { onclick: () => cloud.signOut() }, icon('logout'), h('div.grow', cloud.demo ? 'Salir de la demo' : 'Cerrar sesión'))),
      h('p.small.muted', { style: { textAlign: 'center', marginTop: '24px' } }, 'Obras Slavon · Funciona sin señal: lo que cargues se sube solo cuando vuelva la conexión.'));
  }

  /* ---------- Datos de ejemplo (sólo modo demo) ---------- */

  function seedDemo() {
    cloud.seedOnce((put) => {
      const t = UI.today();
      const mk = (tipo, hechas, enCurso) => TIPOS[tipo].etapas.map((nombre, i) => ({
        id: 'e' + i, nombre,
        estado: i < hechas ? 'hecha' : i === hechas && enCurso ? 'en_curso' : 'pendiente',
        fecha: i < hechas ? UI.addDays(t, -(hechas - i) * 2) : '', porNombre: i < hechas ? 'Encargado (demo)' : '', por: i < hechas ? 'encargado@demo.slavon' : '', nota: '',
      }));
      const ch = (tipo, all) => checklistDefault(tipo).map((c) => (all ? { ...c, ok: true, porNombre: 'Juan', fecha: t } : c));
      const pv = (fin, hechos) => window.OBRAS_POSTVENTA.map((p, i) => ({ id: p.id, label: p.label, fecha: UI.addMonths(fin, p.meses), hecho: i < hechos, nota: i < hechos ? 'Todo bien, contentos con la cancha.' : '', porNombre: i < hechos ? 'Juan' : '', hechoFecha: i < hechos ? UI.addMonths(fin, p.meses) : '' }));
      put('users', 'encargado@demo.slavon', { nombre: 'Encargado (demo)', apps: { obras: 'encargado' }, activo: true, super: false });
      const base = { encargados: ['encargado@demo.slavon'], notas: '', editadoPorNombre: 'Juan' };
      put('obras', 'demo1', { ...base, nombre: 'Club Huracán – Cancha 1 (ejemplo)', tipo: 'futbol', cliente: 'Contacto de ejemplo', telefono: '11 5555 0001', ubicacion: 'Parque Patricios, CABA', inicio: UI.addDays(t, -12), instInicio: UI.addDays(t, -12), instFin: UI.addDays(t, 3), fechaVenta: UI.addDays(t, -40), fechaEntrega: UI.addDays(t, -12), saldoCobrado: true, saldoCobradoFecha: UI.addDays(t, -14), saldoCobradoPorNombre: 'Delfina', creadoPorNombre: 'Delfina', responsable: 'encargado@demo.slavon', estado: 'en_curso', etapas: mk('futbol', 4, true), checklist: ch('futbol'), postventa: [] });
      put('obras', 'demo2', { ...base, nombre: 'La Finca – Pádel 2 y 3 (ejemplo)', tipo: 'padel_completa', cliente: 'Contacto de ejemplo', telefono: '11 5555 0002', ubicacion: 'Pilar, Buenos Aires', inicio: UI.addDays(t, -20), instInicio: UI.addDays(t, -20), instFin: UI.addDays(t, 6), fechaVenta: UI.addDays(t, -60), fechaEntrega: UI.addDays(t, -20), saldoCobrado: true, saldoCobradoFecha: UI.addDays(t, -22), saldoCobradoPorNombre: 'Delfina', creadoPorNombre: 'Delfina', responsable: 'encargado@demo.slavon', estado: 'en_curso', etapas: mk('padel_completa', 6, true), checklist: ch('padel_completa'), postventa: [] });
      const et5 = mk('padel_completa', 3, false).map((e) => (e.fecha ? { ...e, fecha: UI.addDays(e.fecha, -10) } : e));
      put('obras', 'demo5', { ...base, nombre: 'Club Norte – Pádel 1 (ejemplo)', tipo: 'padel_completa', cliente: 'Contacto de ejemplo', telefono: '11 5555 0005', ubicacion: 'San Isidro, Buenos Aires', inicio: UI.addDays(t, -30), estado: 'en_curso', etapas: et5, checklist: ch('padel_completa'), postventa: [] });
      const venta = { ...base, estado: 'vendida', fin: '', postventa: [], creadoPorNombre: 'Delfina', saldoCobrado: false, cliente: 'Contacto de ejemplo' };
      put('obras', 'demo6', { ...venta, nombre: 'Club Los Robles – Pádel 1 y 2 (ejemplo)', tipo: 'padel_cesped', telefono: '11 5555 0006', ubicacion: 'Tigre, Buenos Aires', fechaVenta: UI.addDays(t, -25), fechaEntrega: UI.addDays(t, 4), saldo: '2400000', etapas: mk('padel_cesped', 0), checklist: ch('padel_cesped') });
      put('obras', 'demo7', { ...venta, nombre: 'Escuela San Martín – F7 (ejemplo)', tipo: 'futbol', telefono: '11 5555 0007', ubicacion: 'Lanús, Buenos Aires', fechaVenta: UI.addDays(t, -6), fechaEntrega: UI.addDays(t, 24), saldo: '5100000', etapas: mk('futbol', 0), checklist: ch('futbol') });
      const fin3 = UI.addMonths(UI.addDays(t, 3), -1);
      put('obras', 'demo3', { ...base, nombre: 'Tercer Tiempo – F5 (ejemplo)', tipo: 'futbol', cliente: 'Contacto de ejemplo', telefono: '11 5555 0003', ubicacion: 'Morón, Buenos Aires', inicio: UI.addDays(fin3, -15), estado: 'terminada', fin: fin3, etapas: mk('futbol', 9), checklist: ch('futbol', true), postventa: pv(fin3, 0) });
      const fin4 = UI.addMonths(UI.addDays(t, -17), -6);
      put('obras', 'demo4', { ...base, nombre: 'Centro Galicia – Pádel (ejemplo)', tipo: 'padel_cesped', cliente: 'Contacto de ejemplo', telefono: '11 5555 0004', ubicacion: 'Avellaneda, Buenos Aires', inicio: UI.addDays(fin4, -10), estado: 'terminada', fin: fin4, etapas: mk('padel_cesped', 8), checklist: ch('padel_cesped', true), postventa: pv(fin4, 1) });
    });
  }
})();
