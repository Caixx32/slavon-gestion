'use strict';

/*
 * Cuentas de la venta: números a la argentina, plata, m² de la cancha y plan de cuotas.
 * No toca la pantalla: se puede probar suelto con node (ver al final).
 *
 * PENDIENTE de definir con Slavon (mientras tanto se carga a mano):
 * - Cómo se calcula el blanco (m² de césped blanco para las líneas) con demarcación simple y doble → blanco().
 * - La fórmula del bicolor que contempla el desperdicio → bicolor().
 */

(function (root) {
  /* ---------- Números ---------- */

  // Lee números escritos a la argentina («1.475,50», «1475,5»), guardados con punto decimal («1475.5») o ya numéricos.
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    let t = String(v ?? '').trim().replace(/[^\d.,-]/g, '');
    if (!t) return 0;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    return Number(t) || 0;
  }

  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  // 10000 → «10.000» · 807.27 → «807,27» · 807.3 → «807,30» · sin decimales si es entero.
  function fmtNum(n, decimales = 2) {
    const x = Number(n) || 0;
    const [ent, dec] = Math.abs(x).toFixed(decimales).split('.');
    const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const conDec = dec && /[1-9]/.test(dec) ? ',' + dec : '';
    return (x < 0 && (Number(ent) || conDec) ? '-' : '') + miles + conDec;
  }

  const SIGNO = { USD: 'US$', ARS: '$' };
  const money = (n, moneda = 'USD') => `${SIGNO[moneda] || 'US$'} ${fmtNum(n)}`;

  // Mientras se escribe un importe: «10000» → «10.000», «1500,5» → «1.500,5». La coma es la de los decimales.
  function formatTyping(s) {
    const t = String(s ?? '').replace(/[^\d,]/g, '');
    const i = t.indexOf(',');
    let ent = (i >= 0 ? t.slice(0, i) : t).replace(/^0+(?=\d)/, '');
    ent = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    if (i < 0) return ent;
    return (ent || '0') + ',' + t.slice(i + 1).replace(/,/g, '').slice(0, 2);
  }

  /* ---------- Fechas (sin depender de la pantalla) ---------- */

  function addMonths(s, n) {
    if (!s) return '';
    const [y, m, d] = String(s).split('-').map(Number);
    const f = new Date(y, m - 1, 1);
    f.setMonth(f.getMonth() + n);
    const ult = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate();
    f.setDate(Math.min(d, ult));
    const p = (x) => String(x).padStart(2, '0');
    return `${f.getFullYear()}-${p(f.getMonth() + 1)}-${p(f.getDate())}`;
  }

  /* ---------- Medidas de la cancha ---------- */

  // Blanco: m² de césped blanco que se suman al verde por las líneas.
  // PENDIENTE: falta la fórmula de Slavon para demarcación simple y doble. Mientras devuelva null, se carga a mano.
  function blanco(/* { tipo, ancho, largo, demarcacion } */) {
    return null;
  }

  // Bicolor: m² a pedir contemplando el desperdicio.
  // PENDIENTE: falta la fórmula de Slavon. Mientras devuelva null, no se calcula.
  function bicolor(/* { m2, ancho, largo } */) {
    return null;
  }

  // m² de una cancha: ancho × largo + blanco.
  const m2Cancha = ({ ancho, largo, blanco: b }) => round2(num(ancho) * num(largo) + num(b));

  /* ---------- Financiación ---------- */

  /*
   * Plan de cuotas sobre el saldo (precio − anticipo), con interés mensual simple.
   * Por defecto 11 cuotas al 1 % mensual: saldo 8 → 8 + 11 % = 8,88 → 11 cuotas de 0,81 (la última ajusta los centavos).
   */
  function planCuotas({ saldo, cuotas, tasa, primera }) {
    const n = Math.max(1, Math.round(num(cuotas)) || 11);
    const t = (tasa === undefined || tasa === null || tasa === '' ? 1 : num(tasa)) / 100;
    const base = Math.max(0, num(saldo));
    const total = round2(base * (1 + t * n));
    const cuota = round2(total / n);
    const lista = [];
    for (let i = 0; i < n; i++) {
      lista.push({ n: i + 1, fecha: primera ? addMonths(primera, i) : '', monto: i < n - 1 ? cuota : round2(total - cuota * (n - 1)) });
    }
    return { saldo: round2(base), cantidad: n, tasaMensual: round2(t * 100), tasaTotal: round2(t * n * 100), interes: round2(total - base), total, cuota, cuotas: lista };
  }

  // Reparte lo cobrado (sin el anticipo) entre las cuotas, en orden.
  function estadoCuotas(cuotas, cobrado) {
    let resto = round2(Math.max(0, num(cobrado)));
    return cuotas.map((c) => {
      const pagado = round2(Math.min(c.monto, resto));
      resto = round2(resto - pagado);
      return { ...c, pagado, pendiente: round2(c.monto - pagado) };
    });
  }

  // Importe de un pago pasado a la moneda de la venta.
  function enMonedaVenta({ monto, moneda, tc }, monedaVenta) {
    const m = num(monto);
    if (moneda === monedaVenta) return round2(m);
    const cambio = num(tc);
    if (!cambio) return 0;
    return round2(monedaVenta === 'USD' ? m / cambio : m * cambio);
  }

  // Equivalente de un importe en la otra moneda: dólares → pesos o pesos → dólares.
  function equivalente(monto, moneda, tc) {
    const cambio = num(tc);
    if (!cambio) return 0;
    return round2(moneda === 'USD' ? num(monto) * cambio : num(monto) / cambio);
  }

  /*
   * Cuánto descuenta un pago del saldo, en la moneda de la venta.
   * Cheques: pendiente → con el dólar del día en que se recibió · cobrado → con el dólar del día del cobro
   * · rechazado → no cuenta (el saldo vuelve).
   */
  function valorPago(p, monedaVenta) {
    if (p.forma === 'cheque' && Array.isArray(p.cheques) && p.cheques.length) {
      return round2(p.cheques.reduce((a, ch) => {
        if (ch.estado === 'rechazado') return a;
        const tc = ch.estado === 'cobrado' && num(ch.cobradoTC) ? ch.cobradoTC : p.tc;
        return a + enMonedaVenta({ monto: ch.monto, moneda: p.moneda, tc }, monedaVenta);
      }, 0));
    }
    return enMonedaVenta({ monto: p.monto, moneda: p.moneda, tc: p.tc }, monedaVenta);
  }

  // Parte de un pago que todavía está en cheques sin cobrar.
  function aCobrarPago(p, monedaVenta) {
    if (p.forma !== 'cheque' || !Array.isArray(p.cheques)) return 0;
    return round2(p.cheques.filter((ch) => !ch.estado || ch.estado === 'pendiente')
      .reduce((a, ch) => a + enMonedaVenta({ monto: ch.monto, moneda: p.moneda, tc: p.tc }, monedaVenta), 0));
  }

  /* ---------- Importe en letras (para el recibo) ---------- */

  const UNI = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
    'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco',
    'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
  const DEC = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  const CEN = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
  const apocope = (t) => t.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');
  function cientos(n) {
    if (n === 100) return 'cien';
    const r = n % 100;
    const dec = r < 30 ? UNI[r] : DEC[Math.floor(r / 10)] + (r % 10 ? ' y ' + UNI[r % 10] : '');
    return [CEN[Math.floor(n / 100)], dec].filter(Boolean).join(' ');
  }
  function enteroALetras(n) {
    if (!n) return 'cero';
    const millones = Math.floor(n / 1e6);
    const miles = Math.floor((n % 1e6) / 1000);
    const resto = n % 1000;
    return [
      millones ? (millones === 1 ? 'un millón' : apocope(enteroALetras(millones)) + ' millones') : '',
      miles ? (miles === 1 ? 'mil' : apocope(cientos(miles)) + ' mil') : '',
      resto ? cientos(resto) : '',
    ].filter(Boolean).join(' ');
  }
  // 1234.56, 'USD' → «dólares mil doscientos treinta y cuatro con 56/100».
  function enLetras(n, moneda = 'USD') {
    const x = Math.abs(round2(n));
    const ent = Math.floor(x);
    const cent = Math.round((x - ent) * 100);
    return `${moneda === 'ARS' ? 'pesos' : 'dólares'} ${enteroALetras(ent)}${cent ? ` con ${String(cent).padStart(2, '0')}/100` : ''}`;
  }

  const api = {
    num, round2, fmtNum, money, formatTyping, addMonths, blanco, bicolor, m2Cancha, planCuotas, estadoCuotas, enMonedaVenta,
    equivalente, valorPago, aCobrarPago, enLetras,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OBRAS_CALC = api;
})(typeof window !== 'undefined' ? window : globalThis);
