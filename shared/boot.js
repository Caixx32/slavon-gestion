'use strict';

/*
 * Arranque común de las apps: login con Google, permisos de cada persona y pantallas de ingreso.
 * Cada app llama a SG.boot({ app: 'obras', start(ctx) }).
 */

window.SG = (() => {
  const { h } = UI;
  const cfg = window.SG_CONFIG;
  const cloud = window.SGCloud;

  function authScreen(appName, ...content) {
    document.body.classList.add('no-tabs');
    const root = document.getElementById('app');
    root.replaceChildren(h('div.auth', h('div.auth-box',
      h('img', { src: '../shared/icons/logo-white.png', alt: 'SLAVON' }),
      h('div.app-name', appName),
      ...content)));
    document.getElementById('topbar').hidden = true;
  }

  function demoButton() {
    return h('button.btn', { type: 'button', style: { background: 'transparent', color: '#c9cdd1' }, onclick: () => { location.search = '?demo'; } }, 'Ver la demo con datos de ejemplo');
  }

  function boot({ app, start }) {
    const appName = cfg.apps[app].name;
    document.title = `${appName} · Slavon`;

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    if (!cloud.demo && !cloud.configured) {
      authScreen(appName,
        h('p', 'La app todavía no está conectada a la base de datos (falta configurar Firebase).'),
        demoButton());
      return;
    }

    cloud.init().then(() => {
      let started = false;
      let stopUser = null;
      cloud.onAuth((user) => {
        if (stopUser) { stopUser(); stopUser = null; }
        if (!user) {
          if (started) return location.reload();
          return loginScreen(appName);
        }
        const isOwner = user.email === cfg.ownerEmail;
        stopUser = cloud.subscribeDoc('users', user.email, (doc) => {
          const role = isOwner ? 'admin' : (doc && doc.activo && doc.apps && doc.apps[app]) || '';
          const me = {
            email: user.email,
            nombre: (doc && doc.nombre) || user.name,
            role,
            super: isOwner || !!(doc && doc.activo && doc.super),
          };
          if (!role) {
            if (started) return location.reload();
            return noAccess(appName, user.email);
          }
          if (started) {
            if (role !== window.SG.me.role || me.super !== window.SG.me.super) location.reload();
            return;
          }
          started = true;
          window.SG.me = me;
          showShell(appName);
          start({ me, cloud });
        }, (e) => {
          if (!started) noAccess(appName, user.email, e);
        });
      });
    }).catch((e) => {
      authScreen(appName, h('p', 'No se pudo conectar. Revisá la conexión a internet y probá de nuevo (la primera vez hace falta internet).'),
        h('div.err', e.message || String(e)),
        h('button.btn.light', { type: 'button', onclick: () => location.reload() }, 'Reintentar'));
    });
  }

  function loginScreen(appName, errMsg) {
    const err = errMsg ? h('div.err', errMsg) : null;
    authScreen(appName,
      h('p', 'Entrá con tu cuenta de Google. Sólo pueden ingresar los mails dados de alta.'),
      h('button.btn.light', {
        type: 'button',
        onclick: async () => {
          try { await cloud.signIn(); } catch (e) {
            if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') loginScreen(appName, 'No se pudo iniciar sesión: ' + (e.message || e));
          }
        },
      }, 'Entrar con Google'),
      err,
      h('p.small', { style: { marginTop: '26px', fontSize: '13px' } },
        'En iPhone con la app instalada, si Google no vuelve solo a la app: entrá desde Safari, iniciá sesión ahí y volvé a abrirla.'));
  }

  function noAccess(appName, email, e) {
    authScreen(appName,
      h('p', `El mail ${email} no tiene acceso a ${appName}.`),
      h('p', 'Pedile a Juan que te dé de alta.'),
      e ? h('div.err', e.message || String(e)) : null,
      h('button.btn.light', { type: 'button', onclick: () => cloud.signOut() }, 'Entrar con otra cuenta'));
  }

  function showShell(appName) {
    document.body.classList.remove('no-tabs');
    const top = document.getElementById('topbar');
    top.hidden = false;
    top.querySelector('.topbar-sub').textContent = appName;
    const demoChip = top.querySelector('.chip.demo');
    if (cloud.demo) {
      demoChip.hidden = false;
      demoChip.textContent = cloud.as() === 'admin' ? 'DEMO · Admin' : 'DEMO · Encargado';
      demoChip.onclick = demoMenu;
    }
  }

  function demoMenu() {
    UI.sheet({
      title: 'Modo demo',
      body: [h('p.muted', 'Estás viendo datos de ejemplo guardados sólo en este navegador. Nada de esto toca datos reales.')],
      actions: [
        { label: 'Volver a empezar', kind: 'danger', onClick: () => cloud.reset() },
        { label: cloud.as() === 'admin' ? 'Ver como encargado' : 'Ver como admin', kind: 'dark', onClick: () => cloud.setAs(cloud.as() === 'admin' ? 'encargado' : 'admin') },
      ],
    });
  }

  /* ---------- Usuarios y permisos (lo usan todas las apps) ---------- */

  function usersScreen(main, onBack) {
    let users = [];
    const listEl = h('div.list');
    const stop = cloud.subscribe('users', (items) => { users = items; render(); }, (e) => UI.toast(e.message));
    function roleText(u) {
      return Object.entries(cfg.apps)
        .filter(([k]) => u.apps && u.apps[k])
        .map(([k, a]) => `${a.name}${Object.keys(a.roles).length > 1 ? ' (' + a.roles[u.apps[k]] + ')' : ''}`)
        .join(' · ') || 'Sin acceso';
    }
    function render() {
      users.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      listEl.replaceChildren(...(users.length ? users.map((u) => h('div.item', { onclick: () => editUser(u) },
        h('div.grow',
          h('div.ellipsis', { style: { fontWeight: 700 } }, u.nombre || u._id, !u.activo ? h('span.badge.red', { style: { marginLeft: '8px' } }, 'Inactivo') : null),
          h('div.small.muted.ellipsis', u._id),
          h('div.small.muted', roleText(u), u.super ? ' · Maneja usuarios' : '')),
        UI.icon('chev'))) : [h('div.empty', 'Todavía no hay usuarios. Juan entra siempre.')]));
    }
    main.replaceChildren(
      h('div.row', { style: { marginBottom: '6px' } },
        h('button.btn.ghost.small', { type: 'button', onclick: () => { stop(); onBack(); } }, UI.icon('back'), 'Volver')),
      h('h1', 'Usuarios y permisos'),
      h('p.muted.small', `Un solo usuario por persona para todas las apps. ${cfg.ownerEmail} es siempre administrador.`),
      h('button.btn.primary.block', { type: 'button', style: { marginBottom: '14px' }, onclick: () => editUser(null) }, UI.icon('plus'), 'Dar de alta'),
      listEl);
    render();
  }

  function editUser(u) {
    const isNew = !u;
    const appFields = Object.entries(cfg.apps).map(([k, a]) => UI.field({
      label: a.name, name: 'app_' + k, type: 'select', value: (u && u.apps && u.apps[k]) || '',
      options: [['', 'Sin acceso'], ...Object.entries(a.roles)],
    }));
    const body = h('div',
      isNew ? UI.field({ label: 'Mail de Google', name: 'email', type: 'email', required: true, placeholder: 'nombre@gmail.com' }) : h('p.muted', u._id),
      UI.field({ label: 'Nombre', name: 'nombre', value: u ? u.nombre : '', required: true }),
      appFields,
      h('label.check', h('input', { type: 'checkbox', name: 'super', checked: !!(u && u.super) }), 'Puede dar de alta usuarios y cambiar permisos'),
      h('label.check', h('input', { type: 'checkbox', name: 'activo', checked: !u || u.activo !== false }), 'Activo (puede entrar)'));
    UI.sheet({
      title: isNew ? 'Dar de alta' : 'Editar usuario',
      body: [body],
      actions: [
        { label: 'Cancelar' },
        {
          label: 'Guardar', kind: 'primary', onClick: async () => {
            const v = UI.values(body);
            const email = isNew ? v.email.toLowerCase() : u._id;
            if (isNew && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Poné un mail válido.');
            if (!v.nombre) throw new Error('Poné el nombre.');
            const apps = {};
            for (const k of Object.keys(cfg.apps)) if (v['app_' + k]) apps[k] = v['app_' + k];
            cloud.put('users', email, {
              nombre: v.nombre, apps, super: v.super, activo: v.activo,
              editadoPor: SG.me.email, editadoEn: cloud.serverTime(),
            });
            UI.toast('Guardado');
          },
        },
      ],
    });
  }

  return { boot, usersScreen, me: null };
})();
