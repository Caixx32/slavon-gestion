'use strict';

/*
 * Conexión con la base de datos, igual para todas las apps.
 * - Firebase (Auth con Google + Firestore con caché offline): lo normal.
 * - Modo demo (?demo en la dirección): datos de ejemplo guardados sólo en este navegador, sin login.
 *   Sirve para ver la app antes de configurar Firebase y para probarla sin tocar datos reales.
 */

const FIREBASE_VERSION = '10.14.1';
const FIREBASE_CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

window.SGCloud = (() => {
  const cfg = window.SG_CONFIG;
  const params = new URLSearchParams(location.search);
  const configured = cfg.firebase.apiKey && cfg.firebase.apiKey !== 'COMPLETAR';
  const demo = params.has('demo') || sessionStorage.getItem('sg-demo') === '1';
  if (demo) sessionStorage.setItem('sg-demo', '1');

  let onWriteError = (e) => console.warn(e);

  /* ===================== Firebase ===================== */

  function firebaseBackend() {
    let fb = null;
    let auth = null;
    let db = null;
    let fApp = null;
    let st = null; // Storage (archivos: planos), se carga recién cuando hace falta

    async function init() {
      if (fb) return;
      const [app, authMod, fs] = await Promise.all([
        import(`${FIREBASE_CDN}/firebase-app.js`),
        import(`${FIREBASE_CDN}/firebase-auth.js`),
        import(`${FIREBASE_CDN}/firebase-firestore.js`),
      ]);
      fb = { ...app, ...authMod, ...fs };
      fApp = fb.initializeApp(cfg.firebase);
      auth = fb.getAuth(fApp);
      auth.languageCode = 'es';
      db = fb.initializeFirestore(fApp, {
        localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }),
      });
      fb.getRedirectResult(auth).catch(() => {});
    }

    const onAuth = (cb) => fb.onAuthStateChanged(auth, (u) => cb(u ? { email: u.email.toLowerCase(), name: u.displayName || u.email } : null));

    async function signIn() {
      const provider = new fb.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await fb.signInWithPopup(auth, provider);
      } catch (e) {
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
          await fb.signInWithRedirect(auth, provider);
          return;
        }
        throw e;
      }
    }

    const ref = (col, id) => fb.doc(db, col, id);
    const withId = (snap) => Object.defineProperty(snap.data(), '_id', { value: snap.id, enumerable: false });

    function subscribe(col, cb, onError, filters = null) {
      let q = fb.collection(db, col);
      if (filters) q = fb.query(q, ...filters.map(([f, op, v]) => fb.where(f, op, v)));
      return fb.onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
        cb(snap.docs.map(withId), { fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites });
      }, onError);
    }

    function subscribeDoc(col, id, cb, onError) {
      return fb.onSnapshot(ref(col, id), (snap) => cb(snap.exists() ? withId(snap) : null), onError);
    }

    // Todas las subcolecciones con ese nombre, de todos los documentos (ej: los pagos de todas las ventas).
    function subscribeGroup(name, cb, onError) {
      return fb.onSnapshot(fb.collectionGroup(db, name), { includeMetadataChanges: true }, (snap) => {
        cb(snap.docs.map(withId), { fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites });
      }, onError);
    }

    // Siguiente número de una serie (ej: recibos). Necesita conexión: dos personas no pueden sacar el mismo número.
    function nextNumber(key) {
      const r = ref('config', 'contadores');
      return fb.runTransaction(db, async (tx) => {
        const snap = await tx.get(r);
        const n = ((snap.exists() && snap.data()[key]) || 0) + 1;
        tx.set(r, { [key]: n }, { merge: true });
        return n;
      });
    }

    // Varias escrituras juntas: se guarda todo o nada. Sin señal quedan en cola y se suben solas.
    function write(ops) {
      const b = fb.writeBatch(db);
      for (const o of ops) {
        const r = ref(o.col, o.id);
        if (o.op === 'delete') b.delete(r);
        else if (o.op === 'update') b.update(r, o.data);
        else b.set(r, o.data);
      }
      const p = b.commit();
      p.catch((e) => onWriteError(e));
      return p;
    }

    // Archivos (planos) en Firebase Storage: en la base queda sólo el link, el nombre y la fecha.
    async function storage() {
      if (!st) {
        const mod = await import(`${FIREBASE_CDN}/firebase-storage.js`);
        st = { ...mod, s: mod.getStorage(fApp) };
      }
      return st;
    }
    async function upload(path, blob, contentType) {
      const S = await storage();
      const r = S.ref(S.s, path);
      await S.uploadBytes(r, blob, { contentType });
      return S.getDownloadURL(r);
    }
    async function fileURL(path) {
      const S = await storage();
      return S.getDownloadURL(S.ref(S.s, path));
    }
    async function removeFile(path) {
      const S = await storage();
      return S.deleteObject(S.ref(S.s, path));
    }

    return {
      init, onAuth, signIn, signOut: () => fb.signOut(auth), subscribe, subscribeDoc, subscribeGroup, nextNumber, write, upload, fileURL, removeFile,
      newId: () => fb.doc(fb.collection(db, '_')).id,
      serverTime: () => fb.serverTimestamp(),
    };
  }

  /* ===================== Demo (sólo este navegador) ===================== */

  function demoBackend() {
    const KEY = 'sg-demo-data';
    let data = {};
    try { data = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { data = {}; }
    const subs = new Set();

    const save = () => {
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* sin lugar: quedan sólo en memoria */ }
    };
    const col = (name) => (data[name] = data[name] || {});
    const withId = (id, d) => Object.defineProperty(JSON.parse(JSON.stringify(d)), '_id', { value: id, enumerable: false });
    const match = (d, filters) => !filters || filters.every(([f, op, v]) => {
      if (op === '==') return d[f] === v;
      if (op === 'array-contains') return Array.isArray(d[f]) && d[f].includes(v);
      return true;
    });

    function emit() {
      for (const s of subs) s();
    }

    function subscribe(name, cb, onError, filters = null) {
      const run = () => cb(Object.entries(col(name)).filter(([, d]) => match(d, filters)).map(([id, d]) => withId(id, d)), { fromCache: false, pending: false });
      subs.add(run);
      setTimeout(run, 0);
      return () => subs.delete(run);
    }

    function subscribeDoc(name, id, cb) {
      const run = () => cb(col(name)[id] ? withId(id, col(name)[id]) : null);
      subs.add(run);
      setTimeout(run, 0);
      return () => subs.delete(run);
    }

    // Subcolecciones con ese nombre en cualquier documento: las claves son «ventas/{id}/pagos».
    function subscribeGroup(name, cb) {
      const run = () => cb(Object.keys(data).filter((k) => k === name || k.endsWith('/' + name))
        .flatMap((k) => Object.entries(data[k]).map(([id, d]) => withId(id, d))), { fromCache: false, pending: false });
      subs.add(run);
      setTimeout(run, 0);
      return () => subs.delete(run);
    }

    // Archivos en la demo: quedan en este navegador (hasta ~2 MB cada uno).
    const archivos = () => col('_archivos');
    async function upload(path, blob) {
      const url = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
      if (url.length > 2800000) throw new Error('en la demo los archivos pueden pesar hasta 2 MB');
      archivos()[path] = url;
      save();
      return 'demo:' + path;
    }
    const fileURL = async (path) => archivos()[path] || '';
    async function removeFile(path) { delete archivos()[path]; save(); }

    function nextNumber(key) {
      const c = col('config');
      c.contadores = c.contadores || {};
      c.contadores[key] = (c.contadores[key] || 0) + 1;
      save();
      return Promise.resolve(c.contadores[key]);
    }

    function write(ops) {
      for (const o of ops) {
        const c = col(o.col);
        if (o.op === 'delete') delete c[o.id];
        else if (o.op === 'update') c[o.id] = { ...(c[o.id] || {}), ...JSON.parse(JSON.stringify(o.data)) };
        else c[o.id] = JSON.parse(JSON.stringify(o.data));
      }
      save();
      setTimeout(emit, 0);
      return Promise.resolve();
    }

    const DEMO_USERS = {
      admin: { email: cfg.ownerEmail, name: 'Juan (demo)' },
      administrativo: { email: 'administrativo@demo.slavon', name: 'Delfina (demo)' },
      encargado: { email: 'encargado@demo.slavon', name: 'Beto (demo)' },
    };
    const as = () => (DEMO_USERS[localStorage.getItem('sg-demo-as')] ? localStorage.getItem('sg-demo-as') : 'admin');
    const user = () => DEMO_USERS[as()];

    return {
      init: async () => {},
      onAuth: (cb) => { setTimeout(() => cb(user()), 0); return () => {}; },
      signIn: async () => {},
      signOut: async () => { sessionStorage.removeItem('sg-demo'); location.href = location.pathname; },
      subscribe, subscribeDoc, subscribeGroup, nextNumber, write, upload, fileURL, removeFile,
      newId: () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36),
      serverTime: () => new Date().toISOString(),
      // Para cargar datos de ejemplo la primera vez.
      // Carga los datos de ejemplo la primera vez (o cuando cambia la versión de los ejemplos).
      seedOnce(version, fn) {
        if (data._seeded === version) return;
        for (const k of Object.keys(data)) delete data[k];
        data._seeded = version;
        fn((c, id, d) => { col(c)[id] = d; });
        save();
      },
      reset() { localStorage.removeItem(KEY); location.reload(); },
      setAs(role) { localStorage.setItem('sg-demo-as', role); location.reload(); },
      as,
    };
  }

  const backend = demo ? demoBackend() : firebaseBackend();

  return {
    demo,
    configured,
    ...backend,
    put: (c, id, d) => backend.write([{ op: 'set', col: c, id, data: d }]),
    patch: (c, id, d) => backend.write([{ op: 'update', col: c, id, data: d }]),
    del: (c, id) => backend.write([{ op: 'delete', col: c, id }]),
    setWriteErrorHandler: (fn) => { onWriteError = fn; },
  };
})();
