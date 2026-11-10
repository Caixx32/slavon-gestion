'use strict';

// Herramientas de pantalla compartidas: armado de elementos, íconos, hojas, avisos, fechas y fotos.

window.UI = (() => {
  /* ---------- Elementos ---------- */

  // h('div.card.tap', { onclick }, 'texto', otroElemento)
  function h(sel, attrs, ...kids) {
    if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
      kids.unshift(attrs);
      attrs = {};
    }
    const [tag, ...classes] = sel.split('.');
    const el = document.createElement(tag || 'div');
    if (classes.length) el.className = classes.join(' ');
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'class') el.className += ' ' + v;
      else if (k in el && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (k) => {
      if (k == null || k === false) return;
      if (Array.isArray(k)) k.forEach(add);
      else el.append(k instanceof Node ? k : String(k));
    };
    kids.forEach(add);
    return el;
  }

  /* ---------- Íconos ---------- */

  const ICONS = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    chev: '<path d="M9 18l6-6-6-6"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    clip: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    whatsapp: '<path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z"/>',
    up: '<path d="M18 15l-6-6-6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  };

  function icon(name) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'i');
    s.innerHTML = ICONS[name] || '';
    return s;
  }

  /* ---------- Avisos ---------- */

  let toastTimer;
  function toast(msg, ms = 2600) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = h('div.toast', { role: 'status' }, msg);
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), ms);
  }

  /* ---------- Hojas (ventanas que suben desde abajo) ---------- */

  /*
   * sheet({ title, body: [elementos], actions: [{ label, kind, onClick }] })
   * onClick puede devolver false (o una promesa que resuelve false) para no cerrar.
   * Si tira un error, se muestra arriba de los botones.
   */
  function sheet({ title, body = [], actions = [], onClose }) {
    const err = h('div.form-error', { hidden: true });
    const dlg = h('dialog.sheet');
    const close = () => { dlg.close(); };
    dlg.addEventListener('close', () => { dlg.remove(); if (onClose) onClose(); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
    const btns = actions.map((a) => {
      const b = h(`button.btn.${a.kind || 'ghost'}`, { type: 'button' }, a.label);
      b.addEventListener('click', async () => {
        err.hidden = true;
        if (!a.onClick) return close();
        b.disabled = true;
        try {
          const r = await a.onClick({ close, error: showErr });
          if (r !== false) close();
        } catch (e) {
          showErr(e.message || String(e));
        } finally {
          b.disabled = false;
        }
      });
      return b;
    });
    function showErr(msg) { err.textContent = msg; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); }
    dlg.append(h('div.sheet-grip'), h('div.sheet-body', h('h2', title), body, err), btns.length ? h('div.sheet-actions', btns) : null);
    document.body.append(dlg);
    dlg.showModal();
    return { close, dlg, error: showErr };
  }

  function confirm(title, text, okLabel = 'Confirmar', kind = 'primary') {
    return new Promise((resolve) => {
      let ok = false;
      sheet({
        title,
        body: [h('p.muted', text)],
        actions: [
          { label: 'Cancelar' },
          { label: okLabel, kind, onClick: () => { ok = true; } },
        ],
        onClose: () => resolve(ok),
      });
    });
  }

  /* ---------- Campos de formulario ---------- */

  // field({ label, name, type, value, options: [[valor, texto]], placeholder, required })
  function field(o) {
    let input;
    if (o.type === 'select') {
      input = h('select', { name: o.name }, (o.options || []).map(([v, t]) => h('option', { value: v, selected: String(v) === String(o.value ?? '') }, t)));
    } else if (o.type === 'textarea') {
      input = h('textarea', { name: o.name, placeholder: o.placeholder || '' });
      input.value = o.value || '';
    } else {
      input = h('input', { name: o.name, type: o.type || 'text', placeholder: o.placeholder || '', inputMode: o.inputMode || null, autocomplete: 'off' });
      input.value = o.value ?? '';
    }
    return h('label.field', h('span', o.label + (o.required ? ' *' : '')), input);
  }

  // Lee los valores de los campos dentro de un contenedor: { name: value }
  function values(root) {
    const out = {};
    root.querySelectorAll('[name]').forEach((el) => {
      out[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
    });
    return out;
  }

  /* ---------- Fechas ---------- */

  const pad = (n) => String(n).padStart(2, '0');
  const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => isoDay(new Date());
  function parseDay(s) {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(s, n) { const d = parseDay(s); d.setDate(d.getDate() + n); return isoDay(d); }
  function addMonths(s, n) {
    const d = parseDay(s);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return isoDay(d);
  }
  const daysUntil = (s) => Math.round((parseDay(s) - parseDay(today())) / 86400000);
  function fmtDay(s) {
    if (!s) return '';
    const d = parseDay(s);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
  }
  // Fecha y hora de un dato guardado (hora del servidor de Firebase o texto ISO).
  function fmtStamp(v) {
    if (!v) return '';
    const d = typeof v.toDate === 'function' ? v.toDate() : new Date(v);
    if (isNaN(d)) return '';
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function relDays(s) {
    const n = daysUntil(s);
    if (n === 0) return 'hoy';
    if (n === 1) return 'mañana';
    if (n === -1) return 'ayer';
    return n > 0 ? `en ${n} días` : `hace ${-n} días`;
  }

  /* ---------- Fotos ---------- */

  // Achica la foto para que entre en un solo documento de Firestore (menos de ~600 KB).
  async function compressImage(file, maxPx = 1600, quality = 0.7, maxBytes = 600000) {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('No se pudo leer la foto.'));
      i.src = URL.createObjectURL(file);
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', quality);
      const b64 = url.split(',')[1];
      if (b64.length * 0.75 <= maxBytes) { URL.revokeObjectURL(img.src); return b64; }
      maxPx = Math.round(maxPx * 0.8);
      quality = Math.max(0.5, quality - 0.08);
    }
    throw new Error('La foto no se pudo achicar lo suficiente.');
  }

  function pickPhotos(multiple = true) {
    return new Promise((resolve) => {
      const inp = h('input', { type: 'file', accept: 'image/*', multiple, style: { display: 'none' } });
      inp.addEventListener('change', () => { resolve([...inp.files]); inp.remove(); });
      document.body.append(inp);
      inp.click();
    });
  }

  function showPhoto(src, caption) {
    const dlg = h('dialog.sheet', { style: { background: '#000', maxWidth: '100%', maxHeight: '100vh', borderRadius: '0', margin: '0', width: '100vw', height: '100vh' } });
    dlg.append(
      h('div', { style: { position: 'relative', height: '100%', display: 'grid', placeItems: 'center' } },
        h('img', { src, style: { maxWidth: '100%', maxHeight: '88vh', objectFit: 'contain' } }),
        caption ? h('div', { style: { color: '#ddd', fontSize: '14px', padding: '8px 16px', textAlign: 'center' } }, caption) : null,
        h('button.btn.dark', { type: 'button', style: { position: 'absolute', top: 'calc(14px + env(safe-area-inset-top))', right: '14px' }, onclick: () => dlg.close() }, 'Cerrar')),
    );
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  const normPhone = (p) => String(p || '').replace(/\D/g, '');
  // WhatsApp a un celular argentino: agrega 549 si hace falta.
  function waLink(phone, text = '') {
    let n = normPhone(phone);
    if (!n) return null;
    if (n.startsWith('0')) n = n.slice(1);
    if (!n.startsWith('54')) n = '549' + n;
    return `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}`;
  }

  return {
    h, icon, toast, sheet, confirm, field, values,
    today, addDays, addMonths, daysUntil, fmtDay, fmtStamp, relDays,
    compressImage, pickPhotos, showPhoto, waLink,
  };
})();
