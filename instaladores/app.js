'use strict';

/*
 * Instaladores Slavon: lo que se le debe y lo que se le pagó a cada equipo de instalación.
 *
 * - Equipos: se le paga al jefe del equipo (él reparte). Se dan de baja, no se borran.
 * - Tarifas: por m² instalado o precio fijo por cancha u obra. Cambiar una tarifa no cambia los trabajos ya cargados.
 * - Trabajos: se cargan a mano (obra, fecha y uno o varios renglones: tarifa × cantidad, o un adicional/viático).
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
  let tarifas = [];
  let trabajos = [];
  let pagos = [];
  let cargado = { instaladores: false };
  const ui = { q: '', bajas: false, mes: UI.today().slice(0, 7), movInst: '' };

  const UNIDADES = {
    m2: { cant: 'm²', precio: 'Precio por m²', largo: 'por m²' },
    obra: { cant: 'Canchas / obras', precio: 'Precio por cancha u obra', largo: 'por cancha' },
  };
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
      cloud.subscribe('instTarifas', (items) => { tarifas = items; render(); }, err);
      cloud.subscribe('instTrabajos', (items) => { trabajos = items; render(); }, err);
      cloud.subscribe('instPagos', (items) => { pagos = items; render(); }, err);
      window.addEventListener('hashchange', render);
      render();
    },
  });

  function buildTabs() {
    const tabs = [['saldos', 'users', 'Saldos'], ['movimientos', 'list', 'Movimientos'], ['tarifas', 'tag', 'Tarifas'], ['mas', 'menu', 'Más']];
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
    else if (r === 'tarifas') viewTarifas();
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
    const items = (t.items || []).map((it) => (it.tipo === 'adicional'
      ? it.concepto || 'Adicional'
      : `${it.concepto} ${fmtNum(it.cantidad)} ${it.unidad === 'm2' ? 'm²' : it.cantidad === 1 ? 'cancha' : 'canchas'}`));
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
            h('div.small.muted.ellipsis', [i.jefe, ZONAS[i.zona]].filter(Boolean).join(' · '))),
          saldoBadge(cuentas[i._id].saldo), icon('chev'))))
        : h('div.list', h('div.empty', instaladores.length ? 'No hay equipos con esa búsqueda.' : 'Todavía no hay equipos. Tocá «Nuevo equipo».')),
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

  function editInstalador(i) {
    const isNew = !i;
    const body = h('div',
      UI.field({ label: 'Nombre del equipo', name: 'nombre', value: i ? i.nombre : '', required: true, placeholder: 'Ej: Equipo AMBA 1' }),
      UI.field({ label: 'A quién se le paga (jefe del equipo)', name: 'jefe', value: i ? i.jefe : '', placeholder: 'Nombre y apellido' }),
      UI.field({ label: 'Teléfono', name: 'telefono', type: 'tel', value: i ? i.telefono : '', placeholder: '11 5555-5555' }),
      UI.field({ label: 'Alias o CBU para transferirle', name: 'alias', value: i ? i.alias : '' }),
      UI.field({ label: 'Zona', name: 'zona', type: 'select', value: i ? i.zona : 'amba', options: Object.entries(ZONAS) }),
      UI.field({ label: 'Notas', name: 'notas', type: 'textarea', value: i ? i.notas : '' }),
      isNew ? null : h('label.check', h('input', { type: 'checkbox', name: 'activo', checked: i.activo !== false }), 'Activo (si se destilda, queda de baja pero se conserva su cuenta)'));
    UI.sheet({
      title: isNew ? 'Nuevo equipo' : 'Editar equipo',
      body: [body],
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Guardar', kind: 'primary', onClick: () => {
            const v = UI.values(body);
            if (!v.nombre) throw new Error('Poné el nombre del equipo.');
            const id = isNew ? cloud.newId() : i._id;
            cloud.put('instaladores', id, {
              nombre: v.nombre, jefe: v.jefe, telefono: v.telefono, alias: v.alias, zona: v.zona, notas: v.notas,
              activo: isNew ? true : v.activo, ...creado(i), ...stamp(),
            });
            UI.toast('Guardado');
            if (isNew) go('inst/' + id);
          },
        },
      ],
    });
  }

  function selectInst(value, onChange) {
    const opts = instaladores
      .filter((i) => i.activo !== false || i._id === value)
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
      .map((i) => [i._id, i.nombre + (i.jefe ? ` (${i.jefe})` : '')]);
    const f = UI.field({ label: 'Equipo', name: 'instaladorId', type: 'select', value: value || '', options: [['', 'Elegí el equipo…'], ...opts], required: true });
    if (onChange) f.querySelector('select').addEventListener('change', (e) => onChange(e.target.value));
    return f;
  }

  /* ---------- Trabajos ---------- */

  function editTrabajo(t, instId) {
    const isNew = !t;
    if (!instaladores.some((i) => i.activo !== false) && isNew) return UI.toast('Primero cargá un equipo.');
    const tarifasActivas = () => tarifas.filter((x) => x.activo !== false).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    const renglones = (t && t.items ? t.items : [{ tipo: 'tarifa', tarifaId: '', concepto: '', unidad: 'm2', cantidad: 0, precio: 0 }]).map((x) => ({ ...x }));
    const cont = h('div');
    const totalEl = h('div.total-trabajo');
    const obras = [...new Set(trabajos.map((x) => x.obra).filter(Boolean))].sort();
    const dl = h('datalist', { id: 'dl-obras' }, obras.map((o) => h('option', { value: o })));
    const obraF = UI.field({ label: 'Obra (cliente, club o lugar)', name: 'obra', value: t ? t.obra : '', placeholder: 'Ej: Club Ferro – cancha F7' });
    obraF.querySelector('input').setAttribute('list', 'dl-obras');
    const instF = selectInst(t ? t.instaladorId : instId || '');
    const fechaF = UI.field({ label: 'Fecha (cuando terminó el trabajo)', name: 'fecha', type: 'date', value: t ? t.fecha : UI.today(), required: true });
    const notaF = UI.field({ label: 'Nota', name: 'nota', type: 'textarea', value: t ? t.nota : '' });

    const importe = (r) => r2((Number(r.cantidad) || 0) * (Number(r.precio) || 0));
    const total = () => r2(renglones.reduce((a, r) => a + importe(r), 0));
    const pintarTotal = () => { totalEl.textContent = 'Total: ' + plata(total()); };

    function renglonEl(r, idx) {
      const opts = [['', 'Elegí la tarifa…'],
        ...tarifasActivas().map((x) => [x._id, `${x.nombre} · ${x.precio ? plata(x.precio) : 'sin precio'} ${UNIDADES[x.unidad] ? UNIDADES[x.unidad].largo : ''}`]),
        ...(r.tarifaId && !tarifasActivas().some((x) => x._id === r.tarifaId) ? [[r.tarifaId, r.concepto + ' (tarifa de baja)']] : []),
        ['_adic', 'Adicional, viático o descuento (monto fijo)']];
      const sel = UI.field({ label: `Renglón ${idx + 1}`, name: 'tar', type: 'select', value: r.tipo === 'adicional' ? '_adic' : r.tarifaId || '', options: opts });
      sel.querySelector('select').addEventListener('change', (e) => {
        const v = e.target.value;
        if (v === '_adic') Object.assign(r, { tipo: 'adicional', tarifaId: '', concepto: '', unidad: 'monto', cantidad: 1, precio: 0 });
        else {
          const tar = tarifas.find((x) => x._id === v);
          Object.assign(r, { tipo: 'tarifa', tarifaId: v, concepto: tar ? tar.nombre : '', unidad: tar ? tar.unidad : 'm2', precio: tar ? Number(tar.precio) || 0 : 0, cantidad: r.tipo === 'adicional' ? 0 : r.cantidad });
          if (tar && tar.unidad === 'obra' && !r.cantidad) r.cantidad = 1;
        }
        pintar();
      });
      const imp = h('div.importe', plata(importe(r)));
      const upd = () => { imp.textContent = plata(importe(r)); pintarTotal(); };
      const quitar = renglones.length > 1 ? h('button.btn.danger.small', { type: 'button', onclick: () => { renglones.splice(idx, 1); pintar(); } }, icon('trash'), 'Quitar') : null;

      if (r.tipo === 'adicional') {
        const con = UI.field({ label: 'Concepto', name: 'con', value: r.concepto, placeholder: 'Viático, adicional, descuento…' });
        con.querySelector('input').addEventListener('input', (e) => { r.concepto = e.target.value.trim(); });
        const mon = UI.field({ label: 'Monto $ (en negativo si es descuento)', name: 'mon', value: montoTxt(r.precio), inputMode: 'decimal' });
        moneyInput(mon.querySelector('input')).addEventListener('input', (e) => { r.precio = parseNum(e.target.value) || 0; upd(); });
        return h('div.renglon', sel, con, mon, h('div.row', imp, h('span.spacer'), quitar));
      }
      const u = UNIDADES[r.unidad] || UNIDADES.m2;
      const can = UI.field({ label: u.cant, name: 'can', value: montoTxt(r.cantidad), inputMode: 'decimal' });
      moneyInput(can.querySelector('input')).addEventListener('input', (e) => { r.cantidad = parseNum(e.target.value) || 0; upd(); });
      const pre = UI.field({ label: u.precio + ' $', name: 'pre', value: montoTxt(r.precio), inputMode: 'decimal' });
      moneyInput(pre.querySelector('input')).addEventListener('input', (e) => { r.precio = parseNum(e.target.value) || 0; upd(); });
      return h('div.renglon', sel, h('div.grid3', can, pre), h('div.row', imp, h('span.spacer'), quitar));
    }

    function pintar() {
      cont.replaceChildren(...renglones.map(renglonEl),
        h('button.btn.small', { type: 'button', style: { marginBottom: '10px' }, onclick: () => { renglones.push({ tipo: 'tarifa', tarifaId: '', concepto: '', unidad: 'm2', cantidad: 0, precio: 0 }); pintar(); } }, icon('plus'), 'Agregar renglón'));
      pintarTotal();
    }
    pintar();

    const sinTarifas = !tarifasActivas().length
      ? h('p.small', { style: { color: 'var(--warn)' } }, 'No hay tarifas cargadas: podés cargarlas en la pestaña Tarifas o usar un renglón de monto fijo.')
      : null;
    const body = h('div', dl, instF, fechaF, obraF, sinTarifas, cont, totalEl, notaF);
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
          if (r.tipo === 'adicional') {
            if (!r.concepto) throw new Error(`Renglón ${n + 1}: poné el concepto.`);
            if (!r.precio || Number.isNaN(r.precio)) throw new Error(`Renglón ${n + 1}: poné el monto.`);
            items.push({ tipo: 'adicional', concepto: r.concepto, unidad: 'monto', cantidad: 1, precio: r2(r.precio), importe: r2(r.precio) });
          } else {
            if (!r.tarifaId) throw new Error(`Renglón ${n + 1}: elegí la tarifa.`);
            if (!(r.cantidad > 0)) throw new Error(`Renglón ${n + 1}: poné la cantidad.`);
            if (!(r.precio > 0)) throw new Error(`Renglón ${n + 1}: poné el precio.`);
            items.push({ tipo: 'tarifa', tarifaId: r.tarifaId, concepto: r.concepto, unidad: r.unidad, cantidad: r.cantidad, precio: r2(r.precio), importe: importe(r) });
          }
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

  /* ---------- Tarifas ---------- */

  const TARIFAS_INICIALES = [
    ['Fútbol – césped', 'm2'], ['Hockey', 'm2'], ['Tenis', 'm2'], ['Residencial', 'm2'],
    ['Pádel solo césped', 'obra'], ['Pádel cancha completa', 'obra'], ['Blanco / demarcación', 'm2'],
  ];

  function viewTarifas() {
    const lista = tarifas.slice().sort((a, b) => (b.activo !== false) - (a.activo !== false) || (a.nombre || '').localeCompare(b.nombre || ''));
    setMain(
      h('h1', 'Tarifas'),
      h('p.muted.small', 'Lo que se le paga al equipo por m² instalado o por cancha. Al cargar un trabajo se copia el precio: si después cambiás la tarifa, los trabajos ya cargados no cambian.'),
      h('button.btn.primary.block', { type: 'button', style: { marginBottom: '14px' }, onclick: () => editTarifa(null) }, icon('plus'), 'Nueva tarifa'),
      lista.length
        ? h('div.list', lista.map((t) => h('div.item', { onclick: () => editTarifa(t) },
          h('div.grow',
            h('div', { style: { fontWeight: 700 } }, t.nombre, t.activo === false ? h('span.badge', { style: { marginLeft: '8px' } }, 'De baja') : null),
            h('div.small.muted', t.precio ? `${plata(t.precio)} ${(UNIDADES[t.unidad] || {}).largo || ''}` : (UNIDADES[t.unidad] || {}).largo || '')),
          !t.precio ? h('span.badge.warn', 'Falta precio') : null, icon('chev'))))
        : h('div.list', h('div.empty',
          h('p', 'Todavía no hay tarifas.'),
          h('button.btn', { type: 'button', onclick: cargarTarifasIniciales }, 'Cargar la lista inicial (sin precios)'))));
  }

  function cargarTarifasIniciales() {
    cloud.write(TARIFAS_INICIALES.map(([nombre, unidad]) => ({ op: 'set', col: 'instTarifas', id: cloud.newId(), data: { nombre, unidad, precio: 0, activo: true, ...creado(null), ...stamp() } })));
    UI.toast('Listo: completá el precio de cada una.');
  }

  function editTarifa(t) {
    const isNew = !t;
    const pre = UI.field({ label: 'Precio $', name: 'precio', value: t ? montoTxt(t.precio) : '', inputMode: 'decimal' });
    moneyInput(pre.querySelector('input'));
    const body = h('div',
      UI.field({ label: 'Nombre', name: 'nombre', value: t ? t.nombre : '', required: true, placeholder: 'Ej: Fútbol – césped' }),
      UI.field({ label: 'Se paga', name: 'unidad', type: 'select', value: t ? t.unidad : 'm2', options: [['m2', 'Por m² instalado'], ['obra', 'Precio fijo por cancha u obra']] }),
      pre,
      isNew ? null : h('label.check', h('input', { type: 'checkbox', name: 'activo', checked: t.activo !== false }), 'Activa (si se destilda, no aparece al cargar trabajos)'));
    UI.sheet({
      title: isNew ? 'Nueva tarifa' : 'Editar tarifa',
      body: [body],
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Guardar', kind: 'primary', onClick: () => {
            const v = UI.values(body);
            const precio = r2(parseNum(v.precio) || 0);
            if (!v.nombre) throw new Error('Poné el nombre.');
            if (precio < 0) throw new Error('El precio no puede ser negativo.');
            cloud.put('instTarifas', isNew ? cloud.newId() : t._id, {
              nombre: v.nombre, unidad: v.unidad, precio, activo: isNew ? true : v.activo, ...creado(t), ...stamp(),
            });
            UI.toast('Guardado');
          },
        },
      ],
    });
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
    put('instaladores', 'i1', { nombre: 'Equipo AMBA 1', jefe: 'Raúl Gómez', telefono: '11 5555-1001', alias: 'raul.gomez.mp', zona: 'amba', notas: '', activo: true });
    put('instaladores', 'i2', { nombre: 'Equipo AMBA 2', jefe: 'Miguel Sosa', telefono: '11 5555-1002', alias: 'miguel.sosa.bna', zona: 'amba', notas: '', activo: true });
    put('instaladores', 'i3', { nombre: 'Equipo AMBA 3', jefe: 'Darío Paz', telefono: '11 5555-1003', alias: '', zona: 'amba', notas: 'Prefiere efectivo', activo: true });
    put('instaladores', 'i4', { nombre: 'Instalador interior 1', jefe: 'Carlos Ruiz', telefono: '351 555-1004', alias: 'carlos.ruiz.uala', zona: 'interior', notas: 'Viaja solo, el cliente pone ayudantes', activo: true });
    const T = {
      fut: ['Fútbol – césped', 'm2', 1800], pc: ['Pádel solo césped', 'obra', 180000], pf: ['Pádel cancha completa', 'obra', 650000],
      res: ['Residencial', 'm2', 2200], hoc: ['Hockey', 'm2', 1600],
    };
    for (const [k, [nombre, unidad, precio]] of Object.entries(T)) put('instTarifas', 't_' + k, { nombre, unidad, precio, activo: true });
    const it = (k, cantidad) => { const [concepto, unidad, precio] = T[k]; return { tipo: 'tarifa', tarifaId: 't_' + k, concepto, unidad, cantidad, precio, importe: r2(cantidad * precio) }; };
    const ad = (concepto, monto) => ({ tipo: 'adicional', concepto, unidad: 'monto', cantidad: 1, precio: monto, importe: monto });
    const trab = (id, inst, fecha, obra, items, nota = '') => put('instTrabajos', id, { instaladorId: inst, fecha, obra, items, total: r2(items.reduce((a, x) => a + x.importe, 0)), nota });
    const pago = (id, inst, fecha, monto, forma, detalle = '', nota = '') => put('instPagos', id, { instaladorId: inst, fecha, monto, forma, detalle, nota });
    trab('w1', 'i1', d(-38), 'Club Atlético Haedo – F7', [it('fut', 1250)]);
    pago('p1', 'i1', d(-35), 2250000, 'transferencia', 'W. MAX Galicia');
    trab('w2', 'i1', d(-9), 'Parque Patricios – F5', [it('fut', 800)]);
    pago('p2', 'i1', d(-6), 1000000, 'transferencia', 'W. MAX Galicia', 'A cuenta');
    trab('w3', 'i2', d(-20), 'Mayling – 2 canchas pádel', [it('pf', 2)]);
    pago('p3', 'i2', d(-18), 1300000, 'transferencia', 'Atlantis');
    trab('w4', 'i2', d(-3), 'Casa Pilar – jardín', [it('res', 120)]);
    trab('w5', 'i3', d(-12), 'Ranch Sports – pádel', [it('pc', 3)]);
    pago('p4', 'i3', d(-12), 600000, 'efectivo', 'Caja oficina', 'Adelanto antes de terminar');
    trab('w6', 'i4', d(-15), 'Córdoba capital – hockey', [it('hoc', 5000), ad('Viático 4 días', 160000), ad('Pasajes', 90000)]);
    pago('p5', 'i4', d(-14), 4000000, 'transferencia', 'W. MAX Galicia');
    pago('p6', 'i4', d(-2), 2000000, 'transferencia', 'W. MAX Galicia');
    cloud.write(ops);
  }
})();
