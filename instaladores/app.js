'use strict';

/*
 * Instaladores Slavon: lo que se le debe y lo que se le pagó a cada equipo de instalación.
 *
 * - Equipos: se le paga al jefe del equipo (él reparte). Se dan de baja, no se borran.
 * - Precios propios de cada equipo: por m² (fútbol, hockey, residencial, con un mínimo de m² por obra, 450 por defecto)
 *   y precio fijo por cancha de pádel (césped). Cambiar un precio no cambia los trabajos ya cargados.
 * - Trabajos: se cargan a mano (obra, fecha y uno o varios renglones: m², canchas de pádel o un adicional/viático).
 * - Pagos: en pesos, parciales o totales. Un pago de más queda como adelanto a favor nuestro.
 * - Saldo de cada equipo = trabajos − pagos. Resumen de cuenta en PDF y aviso por WhatsApp.
 *
 * Sólo la usa administración (permiso «Acceso» en Usuarios y permisos). Lo imponen las reglas de Firestore.
 */

(() => {
  const { h, icon } = UI;

  let me = null;
  let cloud = null;
  let instaladores = [];
  let trabajos = [];
  let pagos = [];
  let cargado = { instaladores: false };
  const ui = { q: '', bajas: false, mes: UI.today().slice(0, 7), movInst: '' };

  const FORMAS = { transferencia: 'Transferencia', efectivo: 'Efectivo', otro: 'Otro' };
  const ZONAS = { amba: 'AMBA', interior: 'Interior' };

  const main = h('main');
  const setMain = (...kids) => main.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  const tabsEl = document.getElementById('tabs');

  /* ---------- Números (punto de miles, coma decimal) ---------- */

  function fmtNum(n, decimales = 2) {
    const x = Number(n) || 0;
    const [ent, dec] = Math.abs(x).toFixed(decimales).split('.');
    const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const conDec = dec && /[1-9]/.test(dec) ? ',' + dec : '';
    return (x < 0 && (Number(ent) || conDec) ? '-' : '') + miles + conDec;
  }
  const plata = (n) => '$ ' + fmtNum(n);
  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  // «10.000» → 10000 · «1.500,5» → 1500.5 · «12.5» → 12.5 · «-3000» → -3000
  function parseNum(s) {
    let t = String(s ?? '').replace(/[\s$]/g, '');
    if (!t) return 0;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }
  // Mientras se escribe un importe: «10000» → «10.000».
  function moneyInput(input) {
    input.addEventListener('input', () => {
      const neg = input.value.trim().startsWith('-');
      const t = input.value.replace(/[^\d,]/g, '');
      const i = t.indexOf(',');
      const ent = (i >= 0 ? t.slice(0, i) : t).replace(/^0+(?=\d)/, '');
      const dec = i >= 0 ? ',' + t.slice(i + 1).replace(/,/g, '').slice(0, 2) : '';
      input.value = (neg ? '-' : '') + ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + dec;
    });
    return input;
  }
  const montoTxt = (n) => (n ? fmtNum(n) : '');

  /* ---------- Arranque ---------- */

  SG.boot({
    app: 'instaladores',
    start(ctx) {
      me = ctx.me;
      cloud = ctx.cloud;
      cloud.setWriteErrorHandler((e) => UI.toast('No se pudo guardar: ' + (e.code === 'permission-denied' ? 'no tenés permiso.' : e.message), 5000));
      document.getElementById('app').replaceChildren(main);
      buildTabs();
      const err = (e) => UI.toast(e.message, 5000);
      cloud.subscribe('instaladores', (items) => {
        instaladores = items;
        if (cloud.demo && !cargado.instaladores && !items.length) seedDemo();
        cargado.instaladores = true;
        render();
      }, err);
      cloud.subscribe('instTrabajos', (items) => { trabajos = items; render(); }, err);
      cloud.subscribe('instPagos', (items) => { pagos = items; render(); }, err);
      window.addEventListener('hashchange', render);
      render();
    },
  });

  function buildTabs() {
    const tabs = [['saldos', 'users', 'Saldos'], ['movimientos', 'list', 'Movimientos'], ['mas', 'menu', 'Más']];
    tabsEl.replaceChildren(...tabs.map(([id, ic, label]) => h('button', { type: 'button', 'data-tab': id, onclick: () => go(id) }, icon(ic), h('span', label))),
      h('div.side-only.side-apps', h('div.side-title', 'Otras apps'),
        h('a', { href: '../obras/' }, 'Obras'),
        h('a', { href: 'https://caixx32.github.io/flota-slavon/' }, 'Flota')));
    tabsEl.hidden = false;
  }

  const go = (r) => { location.hash = '#/' + r; };
  const route = () => (location.hash.replace(/^#\/?/, '') || 'saldos').split('/');

  function render() {
    const act = document.activeElement;
    const buscando = act && act.matches && act.matches('main input.search') ? act.selectionStart : null;
    const [r, id] = route();
    const activa = r === 'inst' ? 'saldos' : r;
    tabsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === activa));
    if (r === 'inst') viewInst(id);
    else if (r === 'movimientos') viewMovimientos();
    else if (r === 'mas') viewMas();
    else if (r === 'usuarios' && me.super) SG.usersScreen(main, () => go('mas'));
    else viewSaldos();
    if (buscando == null) return;
    const s = main.querySelector('input.search');
    if (s) { s.focus(); try { s.setSelectionRange(buscando, buscando); } catch (e) { /* nada */ } }
  }

  const stamp = () => ({ editadoPor: me.email, editadoPorNombre: me.nombre, editadoEn: cloud.serverTime() });
  const creado = (prev) => (prev
    ? { creadoPor: prev.creadoPor || '', creadoEn: prev.creadoEn || '', orden: prev.orden || 0 }
    : { creadoPor: me.email, creadoEn: cloud.serverTime(), orden: Date.now() });

  /* ---------- Cuentas ---------- */

  const instDe = (id) => instaladores.find((i) => i._id === id);
  const nombreInst = (id) => (instDe(id) ? instDe(id).nombre : 'Equipo borrado');

  function movimientos(filtro) {
    const list = [
      ...trabajos.filter(filtro).map((t) => ({ tipo: 'trabajo', fecha: t.fecha || '', orden: t.orden || 0, monto: Number(t.total) || 0, doc: t })),
      ...pagos.filter(filtro).map((p) => ({ tipo: 'pago', fecha: p.fecha || '', orden: p.orden || 0, monto: Number(p.monto) || 0, doc: p })),
    ].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.orden - b.orden);
    return list;
  }

  function cuenta(instId) {
    const movs = movimientos((x) => x.instaladorId === instId);
    let s = 0;
    let tt = 0;
    let tp = 0;
    for (const m of movs) {
      if (m.tipo === 'trabajo') { s += m.monto; tt += m.monto; } else { s -= m.monto; tp += m.monto; }
      m.saldo = r2(s);
    }
    return { movs, saldo: r2(s), trabajos: r2(tt), pagado: r2(tp) };
  }

  function saldoBadge(s) {
    if (s > 0.5) return h('span.badge.red', 'Le debemos ' + plata(s));
    if (s < -0.5) return h('span.badge.blue', 'A favor ' + plata(-s));
    return h('span.badge.ok', 'Al día');
  }

  function conceptoTrabajo(t) {
    const items = (t.items || []).map((it) => {
      if (it.tipo === 'adicional') return it.concepto || 'Adicional';
      const n = Number(it.cantidad) || 0;
      if (it.tipo === 'padel' || (it.tipo === 'tarifa' && it.unidad !== 'm2')) return `${it.concepto || 'Pádel césped'} ${fmtNum(n)} ${n === 1 ? 'cancha' : 'canchas'}`;
      const pag = Number(it.pagados) || n;
      return `${it.concepto} ${fmtNum(n)} m²` + (pag > n ? ` (se pagan ${fmtNum(pag)} m² mínimo)` : '');
    });
    return [t.obra, items.join(' · ')].filter(Boolean).join(' — ');
  }
  const conceptoPago = (p) => ['Pago', FORMAS[p.forma] || '', p.detalle].filter(Boolean).join(' · ');
  const enMes = (f, mes) => (f || '').slice(0, 7) === mes;

  /* ---------- Saldos (inicio) ---------- */

  function viewSaldos() {
    const q = ui.q.toLowerCase();
    const mes = UI.today().slice(0, 7);
    const cuentas = Object.fromEntries(instaladores.map((i) => [i._id, cuenta(i._id)]));
    const totalDeuda = r2(Object.values(cuentas).reduce((a, c) => a + Math.max(0, c.saldo), 0));
    const pagadoMes = r2(pagos.filter((p) => enMes(p.fecha, mes)).reduce((a, p) => a + (Number(p.monto) || 0), 0));
    const trabajosMes = r2(trabajos.filter((t) => enMes(t.fecha, mes)).reduce((a, t) => a + (Number(t.total) || 0), 0));
    const lista = instaladores
      .filter((i) => ui.bajas || i.activo !== false)
      .filter((i) => !q || [i.nombre, i.jefe, i.telefono, i.alias].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (b.activo !== false) - (a.activo !== false) || cuentas[b._id].saldo - cuentas[a._id].saldo || (a.nombre || '').localeCompare(b.nombre || ''));
    const search = h('input.search', { type: 'search', placeholder: 'Buscar equipo, jefe o teléfono', value: ui.q, oninput: (e) => { ui.q = e.target.value; render(); } });

    setMain(
      h('h1', 'Saldos de instaladores'),
      h('div.kpis',
        h('div.kpi', h('span', 'Les debemos hoy'), h('b', { style: { color: totalDeuda > 0 ? 'var(--red)' : 'var(--ok)' } }, plata(totalDeuda))),
        h('div.kpi', h('span', 'Trabajos este mes'), h('b', plata(trabajosMes))),
        h('div.kpi', h('span', 'Pagado este mes'), h('b', plata(pagadoMes)))),
      h('div.acciones',
        h('button.btn.primary', { type: 'button', onclick: () => editTrabajo(null) }, icon('plus'), 'Cargar trabajo'),
        h('button.btn.dark', { type: 'button', onclick: () => editPago(null) }, icon('money'), 'Registrar pago'),
        h('button.btn', { type: 'button', onclick: () => editInstalador(null) }, icon('users'), 'Nuevo equipo')),
      h('div', { style: { height: '10px' } }),
      search,
      lista.length
        ? h('div.list', lista.map((i) => h('div.item', { onclick: () => go('inst/' + i._id) },
          h('div.grow',
            h('div.ellipsis', { style: { fontWeight: 700 } }, i.nombre, i.activo === false ? h('span.badge', { style: { marginLeft: '8px' } }, 'De baja') : null),
            h('div.small.muted.ellipsis', faltaPrecio(i)
              ? 'Falta cargar sus precios'
              : `${plata(i.precioM2)}/m² (mín. ${fmtNum(minimoDe(i))} m²) · ${plata(i.precioPadel)} pádel`)),
          faltaPrecio(i) ? h('span.badge.warn', 'Sin precios') : null,
          saldoBadge(cuentas[i._id].saldo), icon('chev'))))
        : h('div.list', h('div.empty', instaladores.length ? 'No hay equipos con esa búsqueda.' : [
          h('p', 'Todavía no hay equipos.'),
          h('button.btn.primary', { type: 'button', onclick: crearEquiposIniciales }, icon('users'), 'Crear Esteban, Francisco, Agustín y Enrique')])),
      h('label.check.small', h('input', { type: 'checkbox', checked: ui.bajas, onchange: (e) => { ui.bajas = e.target.checked; render(); } }), 'Mostrar equipos dados de baja'));
  }

  /* ---------- Cuenta de un equipo ---------- */

  function infoRow(k, v) { return v ? h('div.info-row', h('span', k), h('div', v)) : null; }

  function viewInst(id) {
    const i = instDe(id);
    const back = h('div.row', { style: { marginBottom: '6px' } }, h('button.btn.ghost.small', { type: 'button', onclick: () => go('saldos') }, icon('back'), 'Saldos'));
    if (!i) return setMain(back, h('div.empty', cargado.instaladores ? 'No se encontró el equipo.' : 'Cargando…'));
    const c = cuenta(id);
    const wa = UI.waLink(i.telefono);
    const estado = c.saldo > 0.5 ? ['debe', 'Le debemos'] : c.saldo < -0.5 ? ['favor', 'Adelanto a favor nuestro'] : ['cero', 'Al día'];

    setMain(
      back,
      h('div.row', h('h1.grow', i.nombre), i.activo === false ? h('span.badge', 'De baja') : null,
        h('button.btn.small', { type: 'button', onclick: () => editInstalador(i) }, icon('edit'), 'Editar')),
      h('div.card',
        h('div.small.muted', { style: { fontWeight: 600 } }, estado[1]),
        h(`div.saldo-big.${estado[0]}`, plata(Math.abs(c.saldo))),
        h('div.small.muted', `Trabajos ${plata(c.trabajos)} · Pagado ${plata(c.pagado)}`),
        h('div.acciones',
          h('button.btn.primary', { type: 'button', onclick: () => editTrabajo(null, id) }, icon('plus'), 'Trabajo'),
          h('button.btn.dark', { type: 'button', onclick: () => editPago(null, id) }, icon('money'), 'Pago'),
          h('button.btn', { type: 'button', onclick: () => resumenPDF(i) }, icon('file'), 'Resumen PDF'),
          wa ? h('a.btn', { href: UI.waLink(i.telefono, textoWhatsApp(i, c)), target: '_blank', rel: 'noopener' }, icon('whatsapp'), 'WhatsApp') : null)),
      h('div.card',
        infoRow('Por m²', faltaPrecio(i) && !(Number(i.precioM2) > 0) ? h('span', { style: { color: 'var(--warn)', fontWeight: 600 } }, 'Falta cargar') : `${plata(i.precioM2)} (fútbol, hockey, residencial) · mínimo ${fmtNum(minimoDe(i))} m² por obra`),
        infoRow('Pádel', !(Number(i.precioPadel) > 0) ? h('span', { style: { color: 'var(--warn)', fontWeight: 600 } }, 'Falta cargar') : `${plata(i.precioPadel)} por cancha (césped)`),
        infoRow('Cobra', i.jefe),
        infoRow('Teléfono', i.telefono ? [i.telefono, wa ? h('span', ' · ', h('a', { href: wa, target: '_blank', rel: 'noopener' }, 'WhatsApp')) : null] : ''),
        infoRow('Alias / CBU', i.alias ? [i.alias, ' · ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); copiar(i.alias); } }, 'Copiar')] : ''),
        infoRow('Zona', ZONAS[i.zona]),
        infoRow('Notas', i.notas)),
      h('h2', `Movimientos (${c.movs.length})`),
      c.movs.length
        ? h('div.list', [...c.movs].reverse().map((m) => movItem(m, false)))
        : h('div.list', h('div.empty', 'Sin trabajos ni pagos cargados.')));
  }

  function movItem(m, conEquipo) {
    const d = m.doc;
    const esT = m.tipo === 'trabajo';
    return h('div.item.mov', { onclick: () => (esT ? editTrabajo(d) : editPago(d)) },
      h('div.grow',
        h('div.small.muted', [UI.fmtDay(m.fecha), esT ? 'Trabajo' : 'Pago', conEquipo ? nombreInst(d.instaladorId) : ''].filter(Boolean).join(' · ')),
        h('div', { style: { fontWeight: 600 } }, esT ? conceptoTrabajo(d) || 'Trabajo' : conceptoPago(d)),
        d.nota ? h('div.small.muted', d.nota) : null),
      h('div',
        h(`div.monto.${m.tipo}`, (esT ? '+ ' : '− ') + plata(m.monto)),
        m.saldo != null ? h('div.saldo-linea', { style: { textAlign: 'right' } }, 'Saldo ' + plata(m.saldo)) : null));
  }

  function copiar(t) {
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => UI.toast('Copiado'), () => UI.toast(t));
    else UI.toast(t);
  }

  function textoWhatsApp(i, c) {
    const nombre = (i.jefe || i.nombre || '').split(' ')[0];
    const lineas = [`Hola ${nombre}! Te paso el resumen de Slavon al ${UI.fmtDay(UI.today())}:`, ''];
    const pend = c.movs.filter((m) => m.tipo === 'trabajo').slice(-5);
    if (pend.length) {
      lineas.push('Últimos trabajos:');
      for (const m of pend) lineas.push(`• ${UI.fmtDay(m.fecha)} ${conceptoTrabajo(m.doc)}: ${plata(m.monto)}`);
      lineas.push('');
    }
    lineas.push(`Total trabajos: ${plata(c.trabajos)}`, `Total pagado: ${plata(c.pagado)}`);
    if (c.saldo > 0.5) lineas.push(`*Saldo a cobrar: ${plata(c.saldo)}*`);
    else if (c.saldo < -0.5) lineas.push(`*Adelanto a descontar: ${plata(-c.saldo)}*`);
    else lineas.push('*Estás al día.*');
    return lineas.join('\n');
  }

  /* ---------- Alta y edición de equipos ---------- */

  const MINIMO_M2 = 450;
  const minimoDe = (i) => (i && Number(i.minimoM2) >= 0 && i.minimoM2 !== '' && i.minimoM2 != null ? Number(i.minimoM2) : MINIMO_M2);
  const faltaPrecio = (i) => !(Number(i.precioM2) > 0) || !(Number(i.precioPadel) > 0);

  function editInstalador(i) {
    const isNew = !i;
    const num = (name, label, val) => {
      const f = UI.field({ label, name, value: montoTxt(val), inputMode: 'decimal' });
      moneyInput(f.querySelector('input'));
      return f;
    };
    const body = h('div',
      UI.field({ label: 'Nombre del equipo', name: 'nombre', value: i ? i.nombre : '', required: true, placeholder: 'Ej: Esteban' }),
      h('div.renglon',
        h('div.small', { style: { fontWeight: 700, marginBottom: '8px' } }, 'Lo que se le paga'),
        h('div.grid3',
          num('precioM2', 'Precio por m² $ (fútbol, hockey, residencial)', i ? i.precioM2 : 0),
          num('precioPadel', 'Precio por cancha de pádel $', i ? i.precioPadel : 0)),
        num('minimoM2', 'Mínimo de m² que se paga por obra', i ? minimoDe(i) : MINIMO_M2)),
      UI.field({ label: 'A quién se le paga (jefe del equipo)', name: 'jefe', value: i ? i.jefe : '', placeholder: 'Nombre y apellido' }),
      UI.field({ label: 'Teléfono', name: 'telefono', type: 'tel', value: i ? i.telefono : '', placeholder: '11 5555-5555' }),
      UI.field({ label: 'Alias o CBU para transferirle', name: 'alias', value: i ? i.alias : '' }),
      UI.field({ label: 'Zona', name: 'zona', type: 'select', value: i ? i.zona : 'amba', options: Object.entries(ZONAS) }),
      UI.field({ label: 'Notas', name: 'notas', type: 'textarea', value: i ? i.notas : '' }),
      isNew ? null : h('label.check', h('input', { type: 'checkbox', name: 'activo', checked: i.activo !== false }), 'Activo (si se destilda, queda de baja pero se conserva su cuenta)'),
      h('p.small.muted', 'Si cambiás los precios, los trabajos ya cargados no cambian.'));
    UI.sheet({
      title: isNew ? 'Nuevo equipo' : 'Editar equipo',
      body: [body],
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Guardar', kind: 'primary', onClick: () => {
            const v = UI.values(body);
            if (!v.nombre) throw new Error('Poné el nombre del equipo.');
            const precioM2 = r2(parseNum(v.precioM2) || 0);
            const precioPadel = r2(parseNum(v.precioPadel) || 0);
            const minimoM2 = v.minimoM2 === '' ? MINIMO_M2 : r2(parseNum(v.minimoM2) || 0);
            if (precioM2 < 0 || precioPadel < 0 || minimoM2 < 0) throw new Error('Los precios no pueden ser negativos.');
            const id = isNew ? cloud.newId() : i._id;
            cloud.put('instaladores', id, {
              nombre: v.nombre, precioM2, precioPadel, minimoM2,
              jefe: v.jefe, telefono: v.telefono, alias: v.alias, zona: v.zona, notas: v.notas,
              activo: isNew ? true : v.activo, ...creado(i), ...stamp(),
            });
            UI.toast('Guardado');
            if (isNew) go('inst/' + id);
          },
        },
      ],
    });
  }

  const EQUIPOS_INICIALES = ['Esteban', 'Francisco', 'Agustín', 'Enrique'];
  function crearEquiposIniciales() {
    cloud.write(EQUIPOS_INICIALES.map((nombre) => ({
      op: 'set', col: 'instaladores', id: cloud.newId(),
      data: { nombre, precioM2: 0, precioPadel: 0, minimoM2: MINIMO_M2, jefe: nombre, telefono: '', alias: '', zona: 'amba', notas: '', activo: true, ...creado(null), ...stamp() },
    })));
    UI.toast('Equipos creados: entrá a cada uno y poné sus precios.', 5000);
  }

  function selectInst(value, onChange) {
    const opts = instaladores
      .filter((i) => i.activo !== false || i._id === value)
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
      .map((i) => [i._id, i.nombre + (i.jefe && i.jefe !== i.nombre ? ` (${i.jefe})` : '')]);
    const f = UI.field({ label: 'Equipo', name: 'instaladorId', type: 'select', value: value || '', options: [['', 'Elegí el equipo…'], ...opts], required: true });
    if (onChange) f.querySelector('select').addEventListener('change', (e) => onChange(e.target.value));
    return f;
  }

  /* ---------- Trabajos ---------- */

  // Tipos de renglón: césped por m² (con mínimo), pádel a precio fijo por cancha, o un monto fijo.
  const DEPORTES_M2 = ['Fútbol', 'Hockey', 'Residencial'];
  const m2Pagados = (r) => Math.max(Number(r.cantidad) || 0, Number(r.minimo) || 0);
  function importeRenglon(r) {
    if (r.tipo === 'adicional') return r2(Number(r.precio) || 0);
    if (r.tipo === 'm2') return r2(m2Pagados(r) * (Number(r.precio) || 0));
    return r2((Number(r.cantidad) || 0) * (Number(r.precio) || 0));
  }
  // Trabajos cargados con la versión anterior (tarifas generales).
  function normalizarRenglon(x) {
    if (x.tipo !== 'tarifa') return { ...x };
    return x.unidad === 'm2'
      ? { tipo: 'm2', concepto: x.concepto, cantidad: x.cantidad, minimo: 0, precio: x.precio }
      : { tipo: 'padel', concepto: x.concepto || 'Pádel césped', cantidad: x.cantidad, precio: x.precio };
  }

  function editTrabajo(t, instId) {
    const isNew = !t;
    if (!instaladores.some((i) => i.activo !== false) && isNew) return UI.toast('Primero cargá un equipo.');
    let inst = instDe(t ? t.instaladorId : instId || '');
    const nuevoRenglon = (tipo, concepto) => {
      if (tipo === 'padel') return { tipo, concepto: 'Pádel césped', cantidad: 1, precio: inst ? Number(inst.precioPadel) || 0 : 0 };
      return { tipo: 'm2', concepto: concepto || 'Fútbol', cantidad: 0, minimo: minimoDe(inst), precio: inst ? Number(inst.precioM2) || 0 : 0 };
    };
    const renglones = t && t.items ? t.items.map(normalizarRenglon) : [nuevoRenglon('m2')];
    const cont = h('div');
    const totalEl = h('div.total-trabajo');
    const avisoEl = h('div');
    const obras = [...new Set(trabajos.map((x) => x.obra).filter(Boolean))].sort();
    const dl = h('datalist', { id: 'dl-obras' }, obras.map((o) => h('option', { value: o })));
    const obraF = UI.field({ label: 'Obra (cliente, club o lugar)', name: 'obra', value: t ? t.obra : '', placeholder: 'Ej: Club Ferro – cancha F7' });
    obraF.querySelector('input').setAttribute('list', 'dl-obras');
    // Al cambiar de equipo se ponen sus precios y su mínimo en los renglones.
    const instF = selectInst(inst ? inst._id : '', (v) => {
      inst = instDe(v);
      for (const r of renglones) {
        if (r.tipo === 'm2') Object.assign(r, { precio: inst ? Number(inst.precioM2) || 0 : 0, minimo: minimoDe(inst) });
        if (r.tipo === 'padel') r.precio = inst ? Number(inst.precioPadel) || 0 : 0;
      }
      pintar();
    });
    const fechaF = UI.field({ label: 'Fecha (cuando terminó el trabajo)', name: 'fecha', type: 'date', value: t ? t.fecha : UI.today(), required: true });
    const notaF = UI.field({ label: 'Nota', name: 'nota', type: 'textarea', value: t ? t.nota : '' });

    const total = () => r2(renglones.reduce((a, r) => a + importeRenglon(r), 0));
    const pintarTotal = () => { totalEl.textContent = 'Total: ' + plata(total()); };

    function renglonEl(r, idx) {
      const valor = r.tipo === 'adicional' ? '_adic' : r.tipo === 'padel' ? 'padel' : 'm2_' + r.concepto;
      const opts = [
        ...DEPORTES_M2.map((d) => ['m2_' + d, `${d} (por m²)`]),
        ...(r.tipo === 'm2' && !DEPORTES_M2.includes(r.concepto) ? [[valor, `${r.concepto} (por m²)`]] : []),
        ['padel', 'Pádel césped (precio fijo por cancha)'],
        ['_adic', 'Adicional, viático o descuento (monto fijo)']];
      const sel = UI.field({ label: `Renglón ${idx + 1}`, name: 'tipo', type: 'select', value: valor, options: opts });
      sel.querySelector('select').addEventListener('change', (e) => {
        const v = e.target.value;
        if (v === '_adic') renglones[idx] = { tipo: 'adicional', concepto: '', cantidad: 1, precio: 0 };
        else if (v === 'padel') renglones[idx] = nuevoRenglon('padel');
        else if (r.tipo === 'm2') r.concepto = v.slice(3);
        else renglones[idx] = nuevoRenglon('m2', v.slice(3));
        pintar();
      });
      const imp = h('div.importe');
      const det = h('div.small.muted', { style: { marginBottom: '6px' } });
      const upd = () => {
        imp.textContent = plata(importeRenglon(r));
        det.textContent = r.tipo === 'm2' && (Number(r.cantidad) || 0) < (Number(r.minimo) || 0)
          ? `Hizo ${fmtNum(r.cantidad)} m²: se le pagan ${fmtNum(r.minimo)} m² (mínimo).`
          : '';
        pintarTotal();
      };
      const quitar = renglones.length > 1 ? h('button.btn.danger.small', { type: 'button', onclick: () => { renglones.splice(idx, 1); pintar(); } }, icon('trash'), 'Quitar') : null;
      const numF = (label, key) => {
        const f = UI.field({ label, name: key, value: montoTxt(r[key]), inputMode: 'decimal' });
        moneyInput(f.querySelector('input')).addEventListener('input', (e) => { r[key] = parseNum(e.target.value) || 0; upd(); });
        return f;
      };

      let campos;
      if (r.tipo === 'adicional') {
        const con = UI.field({ label: 'Concepto', name: 'con', value: r.concepto, placeholder: 'Viático, adicional, descuento…' });
        con.querySelector('input').addEventListener('input', (e) => { r.concepto = e.target.value.trim(); });
        campos = [con, numF('Monto $ (en negativo si es descuento)', 'precio')];
      } else if (r.tipo === 'padel') {
        const cantEl = h('b.stepper-n', fmtNum(r.cantidad || 0));
        const cambiar = (d) => { r.cantidad = Math.max(1, (Number(r.cantidad) || 0) + d); cantEl.textContent = fmtNum(r.cantidad); upd(); };
        const stepper = h('div.field', h('span', 'Canchas'),
          h('div.stepper',
            h('button.btn', { type: 'button', 'aria-label': 'Una cancha menos', onclick: () => cambiar(-1) }, '−'),
            cantEl,
            h('button.btn', { type: 'button', 'aria-label': 'Una cancha más', onclick: () => cambiar(1) }, '+')));
        campos = [h('div.grid3', stepper, numF('Precio por cancha $', 'precio'))];
      } else {
        campos = [h('div.grid3', numF('m² instalados', 'cantidad'), numF('Precio por m² $', 'precio')), det];
      }
      const el = h('div.renglon', sel, campos, h('div.row', imp, h('span.spacer'), quitar));
      upd();
      return el;
    }

    function pintar() {
      avisoEl.replaceChildren(...(inst && faltaPrecio(inst)
        ? [h('p.small', { style: { color: 'var(--warn)', fontWeight: 600 } }, `${inst.nombre} no tiene cargado el precio por m² o por pádel. Ponelo acá o en «Editar» del equipo.`)]
        : []));
      cont.replaceChildren(...renglones.map(renglonEl),
        h('button.btn.small', { type: 'button', style: { marginBottom: '10px' }, onclick: () => { renglones.push(nuevoRenglon('m2')); pintar(); } }, icon('plus'), 'Agregar renglón'));
      pintarTotal();
    }
    pintar();

    const body = h('div', dl, instF, fechaF, obraF, avisoEl, cont, totalEl, notaF);
    const actions = [{ label: 'Cancelar' }];
    if (!isNew) {
      actions.unshift({
        label: 'Borrar', kind: 'danger', onClick: async () => {
          if (!(await UI.confirm('Borrar trabajo', 'Se borra este trabajo y baja el saldo del equipo. No se puede deshacer.', 'Borrar', 'primary'))) return false;
          cloud.del('instTrabajos', t._id);
          UI.toast('Trabajo borrado');
        },
      });
    }
    actions.push({
      label: 'Guardar', kind: 'primary', onClick: () => {
        const instaladorId = instF.querySelector('select').value;
        const fecha = fechaF.querySelector('input').value;
        const obra = obraF.querySelector('input').value.trim();
        if (!instaladorId) throw new Error('Elegí el equipo.');
        if (!fecha) throw new Error('Poné la fecha.');
        if (!obra) throw new Error('Poné la obra.');
        const items = [];
        for (const [n, r] of renglones.entries()) {
          const pre = `Renglón ${n + 1}: `;
          if (r.tipo === 'adicional') {
            if (!r.concepto) throw new Error(pre + 'poné el concepto.');
            if (!r.precio) throw new Error(pre + 'poné el monto.');
            items.push({ tipo: 'adicional', concepto: r.concepto, cantidad: 1, precio: r2(r.precio), importe: importeRenglon(r) });
            continue;
          }
          if (!(r.cantidad > 0)) throw new Error(pre + (r.tipo === 'padel' ? 'poné la cantidad de canchas.' : 'poné los m².'));
          if (!(r.precio > 0)) throw new Error(pre + 'poné el precio.');
          if (r.tipo === 'padel') items.push({ tipo: 'padel', concepto: r.concepto || 'Pádel césped', unidad: 'obra', cantidad: r.cantidad, precio: r2(r.precio), importe: importeRenglon(r) });
          else items.push({ tipo: 'm2', concepto: r.concepto, unidad: 'm2', cantidad: r.cantidad, minimo: Number(r.minimo) || 0, pagados: m2Pagados(r), precio: r2(r.precio), importe: importeRenglon(r) });
        }
        const tot = total();
        if (!(tot > 0)) throw new Error('El total tiene que ser mayor a cero.');
        const id = isNew ? cloud.newId() : t._id;
        cloud.put('instTrabajos', id, {
          instaladorId, fecha, obra, items, total: tot, nota: notaF.querySelector('textarea').value.trim(),
          ...creado(t), ...stamp(),
        });
        UI.toast(`Trabajo guardado: ${plata(tot)}`);
      },
    });
    UI.sheet({ title: isNew ? 'Cargar trabajo' : 'Editar trabajo', body: [body], actions });
  }

  /* ---------- Pagos ---------- */

  function editPago(p, instId) {
    const isNew = !p;
    if (!instaladores.some((i) => i.activo !== false) && isNew) return UI.toast('Primero cargá un equipo.');
    const saldoEl = h('div.small', { style: { margin: '-6px 0 14px', fontWeight: 600 } });
    const montoF = UI.field({ label: 'Monto $', name: 'monto', value: p ? montoTxt(p.monto) : '', inputMode: 'decimal', required: true });
    moneyInput(montoF.querySelector('input'));
    let instSel = p ? p.instaladorId : instId || '';
    function pintarSaldo() {
      if (!instSel) { saldoEl.replaceChildren(); return; }
      // Al editar, el saldo se muestra sin este pago, para ver cuánto quedaba antes.
      const s = r2(cuenta(instSel).saldo + (p && p.instaladorId === instSel ? Number(p.monto) || 0 : 0));
      saldoEl.replaceChildren(
        h('span', { style: { color: s > 0.5 ? 'var(--red)' : 'var(--muted)' } }, s > 0.5 ? `Le debemos ${plata(s)}` : s < -0.5 ? `Ya tiene un adelanto de ${plata(-s)}` : 'Está al día'),
        s > 0.5 ? h('button.btn.small', { type: 'button', style: { marginLeft: '10px' }, onclick: () => { montoF.querySelector('input').value = fmtNum(s); } }, 'Pagar todo') : null);
    }
    const instF = selectInst(instSel, (v) => { instSel = v; pintarSaldo(); });
    pintarSaldo();
    const body = h('div',
      instF, saldoEl,
      UI.field({ label: 'Fecha', name: 'fecha', type: 'date', value: p ? p.fecha : UI.today(), required: true }),
      montoF,
      UI.field({ label: 'Forma de pago', name: 'forma', type: 'select', value: p ? p.forma : 'transferencia', options: Object.entries(FORMAS) }),
      UI.field({ label: 'Desde qué cuenta o caja · n° de operación', name: 'detalle', value: p ? p.detalle : '', placeholder: 'Ej: W. MAX Galicia · op. 123456' }),
      UI.field({ label: 'Nota', name: 'nota', type: 'textarea', value: p ? p.nota : '' }));
    const actions = [{ label: 'Cancelar' }];
    if (!isNew) {
      actions.unshift({
        label: 'Borrar', kind: 'danger', onClick: async () => {
          if (!(await UI.confirm('Borrar pago', 'Se borra este pago y vuelve a subir el saldo del equipo. No se puede deshacer.', 'Borrar', 'primary'))) return false;
          cloud.del('instPagos', p._id);
          UI.toast('Pago borrado');
        },
      });
    }
    actions.push({
      label: 'Guardar', kind: 'primary', onClick: () => {
        const v = UI.values(body);
        const monto = r2(parseNum(v.monto));
        if (!v.instaladorId) throw new Error('Elegí el equipo.');
        if (!v.fecha) throw new Error('Poné la fecha.');
        if (!(monto > 0)) throw new Error('Poné un monto mayor a cero.');
        const id = isNew ? cloud.newId() : p._id;
        cloud.put('instPagos', id, {
          instaladorId: v.instaladorId, fecha: v.fecha, monto, forma: v.forma, detalle: v.detalle, nota: v.nota,
          ...creado(p), ...stamp(),
        });
        UI.toast(`Pago guardado: ${plata(monto)}`);
      },
    });
    UI.sheet({ title: isNew ? 'Registrar pago' : 'Editar pago', body: [body], actions });
  }

  /* ---------- Movimientos del mes ---------- */

  function viewMovimientos() {
    const [y, m] = ui.mes.split('-').map(Number);
    const nombreMes = new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    const mover = (n) => { const d = new Date(y, m - 1 + n, 1); ui.mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; render(); };
    const movs = movimientos((x) => enMes(x.fecha, ui.mes) && (!ui.movInst || x.instaladorId === ui.movInst)).reverse();
    const tt = r2(movs.filter((x) => x.tipo === 'trabajo').reduce((a, x) => a + x.monto, 0));
    const tp = r2(movs.filter((x) => x.tipo === 'pago').reduce((a, x) => a + x.monto, 0));
    const filtro = UI.field({ label: 'Equipo', name: 'f', type: 'select', value: ui.movInst, options: [['', 'Todos los equipos'], ...instaladores.slice().sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '')).map((i) => [i._id, i.nombre])] });
    filtro.querySelector('select').addEventListener('change', (e) => { ui.movInst = e.target.value; render(); });

    setMain(
      h('h1', 'Movimientos'),
      h('div.mes-nav',
        h('button.btn.small', { type: 'button', onclick: () => mover(-1), 'aria-label': 'Mes anterior' }, icon('back')),
        h('b', nombreMes),
        h('button.btn.small', { type: 'button', onclick: () => mover(1), 'aria-label': 'Mes siguiente' }, icon('chev'))),
      filtro,
      h('div.kpis',
        h('div.kpi', h('span', 'Trabajos del mes'), h('b', plata(tt))),
        h('div.kpi', h('span', 'Pagado en el mes'), h('b', plata(tp))),
        h('div.kpi', h('span', 'Diferencia'), h('b', plata(r2(tt - tp))))),
      movs.length ? h('div.list', movs.map((x) => movItem(x, true))) : h('div.list', h('div.empty', 'No hay movimientos en este mes.')));
  }

  /* ---------- Más ---------- */

  function viewMas() {
    setMain(
      h('h1', 'Más'),
      h('div.card', h('b', me.nombre), h('div.small.muted', me.email)),
      h('div.list',
        me.super ? h('div.item', { onclick: () => go('usuarios') }, icon('users'), h('div.grow', 'Usuarios y permisos'), icon('chev')) : null,
        h('a.item', { href: '../', style: { color: 'inherit', textDecoration: 'none' } }, icon('home'), h('div.grow', 'Otras apps de Slavon'), icon('chev')),
        h('div.item', { onclick: () => cloud.signOut() }, icon('logout'), h('div.grow', cloud.demo ? 'Salir de la demo' : 'Cerrar sesión'))),
      h('p.small.muted', { style: { textAlign: 'center', marginTop: '24px' } }, 'Instaladores Slavon · Funciona sin señal: lo que cargues se sube solo cuando vuelva la conexión.'));
  }

  /* ---------- Resumen de cuenta en PDF ---------- */

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
  const pdfTxt = (t) => String(t ?? '').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/×/g, 'x').replace(/−/g, '-').replace(/²/g, '2');

  async function resumenPDF(i) {
    let lib;
    try { lib = await cargarJsPDF(); } catch (e) { return UI.toast(e.message, 5000); }
    const c = cuenta(i._id);
    const doc = new lib.jsPDF({ unit: 'mm', format: 'a4' });
    const M = 15;
    const R = 210 - M;
    let y = M;
    try {
      const logo = await imagenDataURL('../shared/icons/logo.png');
      doc.addImage(logo.url, 'PNG', M, y, 46, (46 * logo.h) / logo.w);
    } catch (e) { doc.setFont('helvetica', 'bold').setFontSize(18).text('SLAVON', M, y + 7); }
    doc.setFont('helvetica', 'bold').setFontSize(16).text('RESUMEN DE CUENTA', R, y + 5, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(10).text(pdfTxt(`Al ${UI.fmtDay(UI.today())}`), R, y + 11, { align: 'right' });
    y += 20;
    doc.setDrawColor(200).line(M, y, R, y);
    y += 8;
    doc.setFont('helvetica', 'bold').setFontSize(12).text(pdfTxt(i.nombre), M, y);
    doc.setFont('helvetica', 'normal').setFontSize(10);
    const datos = [i.jefe ? 'Cobra: ' + i.jefe : '', i.alias ? 'Alias/CBU: ' + i.alias : ''].filter(Boolean).join('   ·   ');
    if (datos) { y += 5.5; doc.text(pdfTxt(datos), M, y); }
    y += 9;

    const X = { fecha: M, concepto: M + 20, trabajo: 148, pago: 172, saldo: R };
    const header = () => {
      doc.setFillColor(34, 40, 44).rect(M, y - 4.5, R - M, 7, 'F');
      doc.setTextColor(255).setFont('helvetica', 'bold').setFontSize(9);
      doc.text('Fecha', X.fecha + 1.5, y);
      doc.text('Concepto', X.concepto, y);
      doc.text('Trabajo', X.trabajo, y, { align: 'right' });
      doc.text('Pago', X.pago, y, { align: 'right' });
      doc.text('Saldo', X.saldo - 1.5, y, { align: 'right' });
      doc.setTextColor(0).setFont('helvetica', 'normal');
      y += 7;
    };
    header();
    if (!c.movs.length) { doc.setFontSize(10).text('Sin movimientos.', M, y); y += 7; }
    for (const m of c.movs) {
      const concepto = m.tipo === 'trabajo' ? conceptoTrabajo(m.doc) : conceptoPago(m.doc);
      const lineas = doc.setFontSize(9).splitTextToSize(pdfTxt(concepto), X.trabajo - X.concepto - 22);
      const alto = Math.max(1, lineas.length) * 4.2 + 2;
      if (y + alto > 297 - 30) { doc.addPage(); y = M + 5; header(); }
      doc.text(UI.fmtDay(m.fecha), X.fecha + 1.5, y);
      doc.text(lineas, X.concepto, y);
      if (m.tipo === 'trabajo') doc.text(fmtNum(m.monto), X.trabajo, y, { align: 'right' });
      else doc.text(fmtNum(m.monto), X.pago, y, { align: 'right' });
      doc.text(fmtNum(m.saldo), X.saldo - 1.5, y, { align: 'right' });
      y += alto;
      doc.setDrawColor(230).line(M, y - 3, R, y - 3);
    }
    if (y > 297 - 40) { doc.addPage(); y = M + 5; }
    y += 4;
    doc.setFillColor(244, 245, 246).roundedRect(R - 85, y, 85, 26, 2, 2, 'F');
    y += 7;
    const fila = (k, v, bold) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(bold ? 11 : 10);
      doc.text(pdfTxt(k), R - 81, y);
      doc.text(pdfTxt(v), R - 4, y, { align: 'right' });
      y += 6.5;
    };
    fila('Total trabajos', plata(c.trabajos));
    fila('Total pagado', plata(c.pagado));
    fila(c.saldo < -0.5 ? 'Adelanto a descontar' : 'Saldo a cobrar', plata(Math.abs(c.saldo)), true);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(130)
      .text(pdfTxt('Importes en pesos. Generado con Instaladores Slavon.'), M, 297 - 10);
    doc.save(pdfTxt(`Resumen ${i.nombre} ${UI.today()}.pdf`));
  }

  /* ---------- Demo ---------- */

  function seedDemo() {
    const d = (n) => UI.addDays(UI.today(), n);
    const base = { creadoPor: 'demo', creadoEn: '', editadoPor: 'demo', editadoPorNombre: 'Demo', editadoEn: '' };
    let orden = 1;
    const ops = [];
    const put = (col, id, data) => ops.push({ op: 'set', col, id, data: { ...base, orden: orden++, ...data } });
    const P = { i1: [1800, 180000], i2: [2000, 200000], i3: [1700, 170000], i4: [1900, 190000] };
    [['i1', 'Esteban', '11 5555-1001', 'esteban.mp'], ['i2', 'Francisco', '11 5555-1002', 'fran.bna'], ['i3', 'Agustín', '11 5555-1003', ''], ['i4', 'Enrique', '351 555-1004', 'enrique.uala']]
      .forEach(([id, nombre, telefono, alias]) => put('instaladores', id, { nombre, jefe: nombre, telefono, alias, zona: id === 'i4' ? 'interior' : 'amba', notas: '', activo: true, precioM2: P[id][0], precioPadel: P[id][1], minimoM2: 450 }));
    const m2 = (inst, concepto, cantidad) => { const pagados = Math.max(cantidad, 450); return { tipo: 'm2', concepto, unidad: 'm2', cantidad, minimo: 450, pagados, precio: P[inst][0], importe: pagados * P[inst][0] }; };
    const pad = (inst, cantidad) => ({ tipo: 'padel', concepto: 'Pádel césped', unidad: 'obra', cantidad, precio: P[inst][1], importe: cantidad * P[inst][1] });
    const ad = (concepto, monto) => ({ tipo: 'adicional', concepto, cantidad: 1, precio: monto, importe: monto });
    const trab = (id, inst, fecha, obra, items) => put('instTrabajos', id, { instaladorId: inst, fecha, obra, items, total: r2(items.reduce((a, x) => a + x.importe, 0)), nota: '' });
    const pago = (id, inst, fecha, monto, forma, detalle = '', nota = '') => put('instPagos', id, { instaladorId: inst, fecha, monto, forma, detalle, nota });
    trab('w1', 'i1', d(-38), 'Club Atlético Haedo – F7', [m2('i1', 'Fútbol', 1250)]);
    pago('p1', 'i1', d(-35), 2250000, 'transferencia', 'W. MAX Galicia');
    trab('w2', 'i1', d(-9), 'Parque Patricios – F5', [m2('i1', 'Fútbol', 800)]);
    pago('p2', 'i1', d(-6), 1000000, 'transferencia', 'W. MAX Galicia', 'A cuenta');
    trab('w3', 'i2', d(-20), 'Mayling – 2 canchas pádel', [pad('i2', 2)]);
    trab('w4', 'i2', d(-3), 'Casa Pilar – jardín', [m2('i2', 'Residencial', 120)]);
    trab('w5', 'i3', d(-12), 'Ranch Sports – pádel', [pad('i3', 3)]);
    pago('p4', 'i3', d(-12), 600000, 'efectivo', 'Caja oficina', 'Adelanto antes de terminar');
    trab('w6', 'i4', d(-15), 'Córdoba capital – hockey', [m2('i4', 'Hockey', 5000), ad('Viático 4 días', 160000), ad('Pasajes', 90000)]);
    pago('p5', 'i4', d(-14), 4000000, 'transferencia', 'W. MAX Galicia');
    cloud.write(ops);
  }
})();
