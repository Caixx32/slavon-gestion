'use strict';

/*
 * Tipos de trabajo, cómo se arman sus etapas y el checklist de entrega por defecto.
 * Al crear una obra se copian estas etapas; después se pueden editar en cada obra.
 *
 * medida: 'cancha' = ancho × largo (+ blanco) · 'padel' = por cancha (m² por cancha corregible) · 'm2' = m² a mano.
 * blanco: 'calculo' = se calcula por formato (fútbol) · 'manual' = m² a mano (hockey, tenis)
 *         · 'incluido' = viene con la cancha (pádel) · 'no' = no lleva (residencial, mantenimiento, otro).
 * deporte: con qué deporte se filtran los modelos del catálogo de césped.
 * dias: duración sugerida de la instalación por cancha (null = depende de la medida).
 * oculto: ya no se ofrece al vender, pero se sigue mostrando en las obras viejas.
 */

window.OBRAS_TIPOS = {
  futbol: { nombre: 'Fútbol', dias: null, medida: 'cancha', blanco: 'calculo', deporte: 'futbol' },
  padel_cesped: { nombre: 'Pádel – solo césped', dias: 1, medida: 'padel', blanco: 'incluido', deporte: 'padel' },
  padel_completa: { nombre: 'Pádel – cancha completa', dias: 5, estructura: true, medida: 'padel', blanco: 'incluido', deporte: 'padel' },
  hockey: { nombre: 'Hockey', dias: null, medida: 'cancha', blanco: 'manual', deporte: 'hockey' },
  tenis: { nombre: 'Tenis', dias: null, medida: 'cancha', blanco: 'manual', deporte: 'tenis' },
  residencial: { nombre: 'Residencial', dias: 1, medida: 'm2', blanco: 'no', deporte: 'residencial' },
  // Multisport ya no es un tipo de obra: es un césped dentro de fútbol, hockey, tenis y residencial.
  multisport: { nombre: 'Multisport', dias: null, medida: 'cancha', blanco: 'manual', deporte: 'futbol', oculto: true },
  mantenimiento: { nombre: 'Mantenimiento (clientes nuestros)', dias: 1, mantenimiento: true, medida: 'm2', blanco: 'no' },
  otro: { nombre: 'Otro', dias: null, medida: 'm2', blanco: 'no' },
};

// Formatos de fútbol. F5 y F7 calculan el blanco; F8, F9 y F11 todavía no (lo pasa Tomás) y piden plano.
window.OBRAS_FORMATOS = {
  F5: { nombre: 'Fútbol 5', calcula: true },
  F7: { nombre: 'Fútbol 7', calcula: true },
  F8: { nombre: 'Fútbol 8', calcula: false },
  F9: { nombre: 'Fútbol 9', calcula: false },
  F11: { nombre: 'Fútbol 11', calcula: false },
};

// Valores por defecto (se cambian en Más → Catálogos → Césped y en cada venta).
window.OBRAS_DEFAULTS = {
  blanco: { s: 0.5, anchoLineaCm: 8, desperdicio: 10 }, // separación al borde (m), ancho de línea (cm), desperdicio (%)
  padelM2: 200, // m² por cancha de pádel (10 × 20)
};

// Arena y caucho: quién los provee por defecto (en la venta se cambia): la arena la compra el cliente, el caucho lo vendemos.
window.OBRAS_PROVEE = { arena: 'cliente', caucho: 'slavon' };

// Lo que puede incluir el presupuesto. Cada ítem: cantidad, quién lo provee (Slavon / Cliente) y si el envío está incluido.
window.OBRAS_INCLUYE = [
  { id: 'cesped', nombre: 'Césped', unidad: 'm²' },
  { id: 'blanco', nombre: 'Blanco', unidad: 'm²' },
  { id: 'arena', nombre: 'Arena', unidad: 'kg' },
  { id: 'caucho', nombre: 'Caucho', unidad: 'kg' },
  { id: 'pegamento', nombre: 'Pegamento', unidad: '', entregas: true }, // la cantidad la carga Federico en Entregas
  { id: 'cinta', nombre: 'Cinta de unión', unidad: '', entregas: true },
  { id: 'instalacion', nombre: 'Instalación', unidad: '', sinEnvio: true },
];

// Catálogo de césped: carga inicial (Más → Catálogos → Césped → «Cargar la lista inicial»).
// arenaKgM2 / cauchoKgM2: null = no lleva. alturas: el vendedor elige la altura (Deco).
window.OBRAS_CESPEDES_INICIAL = [
  { id: 'cs_44pro', nombre: '44 profesional', modeloFabrica: '4278', deportes: ['futbol'], alturaMm: 44, arenaKgM2: 40, cauchoKgM2: 4, blanco: true, multisport: false, admiteBicolor: true, rolloM: 4 },
  { id: 'cs_52ama', nombre: '52 amateur', modeloFabrica: '5075', deportes: ['futbol'], alturaMm: 52, arenaKgM2: 40, cauchoKgM2: 6, blanco: true, multisport: false, admiteBicolor: true, rolloM: 4 },
  { id: 'cs_52pro', nombre: '52 profesional', modeloFabrica: '5090', deportes: ['futbol'], alturaMm: 52, arenaKgM2: 40, cauchoKgM2: 6, blanco: true, multisport: false, admiteBicolor: true, rolloM: 4 },
  { id: 'cs_52pre', nombre: '52 premium', modeloFabrica: '50115', deportes: ['futbol'], alturaMm: 52, arenaKgM2: 40, cauchoKgM2: 8, blanco: true, multisport: false, admiteBicolor: true, rolloM: 4 },
  { id: 'cs_monofut', nombre: 'Monofilamento fútbol', modeloFabrica: 'Monofilamento fútbol', deportes: ['futbol'], alturaMm: 52, arenaKgM2: 40, cauchoKgM2: 8, blanco: true, multisport: false, admiteBicolor: true, rolloM: 4 },
  { id: 'cs_multipre', nombre: 'Multisport premium', modeloFabrica: '25110', deportes: ['futbol', 'hockey', 'tenis', 'residencial'], alturaMm: 25, arenaKgM2: 40, cauchoKgM2: null, blanco: true, multisport: true, admiteBicolor: true, rolloM: 4 },
  { id: 'cs_multi', nombre: 'Multisport', modeloFabrica: '2585', deportes: ['futbol', 'hockey', 'tenis', 'residencial'], alturaMm: 25, arenaKgM2: 40, cauchoKgM2: null, blanco: true, multisport: true, admiteBicolor: true, rolloM: 4 },
  { id: 'cs_fibpadel', nombre: 'Fibrilado pádel', modeloFabrica: '1380', deportes: ['padel'], alturaMm: 13, arenaKgM2: 20, cauchoKgM2: null, blanco: false, multisport: false, admiteBicolor: false, rolloM: 4 },
  { id: 'cs_monotexnac', nombre: 'Monotex pádel – nacional', modeloFabrica: 'Monofilamento texturado Atlantis', deportes: ['padel'], alturaMm: 13, arenaKgM2: 10, cauchoKgM2: null, blanco: false, multisport: false, admiteBicolor: false, rolloM: 4 },
  { id: 'cs_monoteximp', nombre: 'Monotex pádel – importado', modeloFabrica: 'Monofilamento texturado importado', deportes: ['padel'], alturaMm: 13, arenaKgM2: 10, cauchoKgM2: null, blanco: false, multisport: false, admiteBicolor: false, rolloM: 4 },
  { id: 'cs_deco', nombre: 'Deco', modeloFabrica: 'Deco', deportes: ['residencial'], alturaMm: null, alturas: [20, 30, 40], arenaKgM2: null, cauchoKgM2: null, blanco: false, multisport: false, admiteBicolor: false, rolloM: 4 },
  { id: 'cs_fairway', nombre: 'Fairway evolution', modeloFabrica: 'Fairway evolution', deportes: ['residencial'], alturaMm: 21, arenaKgM2: null, cauchoKgM2: null, blanco: false, multisport: false, admiteBicolor: false, rolloM: 4 },
  { id: 'cs_spring', nombre: 'Spring', modeloFabrica: 'Spring', deportes: ['residencial'], alturaMm: 28, arenaKgM2: null, cauchoKgM2: null, blanco: false, multisport: false, admiteBicolor: false, rolloM: 4 },
  { id: 'cs_nonfill', nombre: 'Non fill', modeloFabrica: 'Non fill', deportes: ['residencial'], alturaMm: null, arenaKgM2: null, cauchoKgM2: null, blanco: false, multisport: false, admiteBicolor: false, rolloM: 4 },
];

window.OBRAS_DEPORTES = { futbol: 'Fútbol', hockey: 'Hockey', tenis: 'Tenis', padel: 'Pádel', residencial: 'Residencial' };

// Etapas según el tipo y lo vendido (con o sin instalación, arena, caucho).
window.obrasEtapas = function obrasEtapas(tipo, { conInstalacion = true, conArena, conCaucho } = {}) {
  const t = window.OBRAS_TIPOS[tipo] || window.OBRAS_TIPOS.otro;
  const arena = !!conArena;
  const caucho = !!conCaucho;
  if (t.mantenimiento) return ['Revisión de la cancha', 'Reparación de uniones', 'Recarga de arena', 'Cepillado', 'Informe al cliente'];
  if (tipo === 'otro') return [];
  if (!conInstalacion) return ['Coordinar flete', 'Envío del césped', 'Entregado al cliente'];
  const cesped = [
    'Coordinar flete',
    'Envío del césped',
    ...(t.estructura ? [] : ['Control de base apta']),
    'Tendido del césped',
    'Pegado del verde',
    'Corte para líneas blancas',
    'Pegado del blanco',
    ...(arena ? ['Arena'] : []),
    ...(caucho ? ['Caucho'] : []),
    'Cepillado final – lista para usar',
  ];
  if (t.estructura) {
    return ['Control de base apta', 'Pintura', 'Montaje de estructura', 'Cableado eléctrico', 'Montaje de luces', 'Vidrios', ...cesped];
  }
  return cesped;
};

window.OBRAS_CHECKLIST = {
  comun: [
    'Uniones del césped firmes, sin levantes',
    'Líneas derechas y bien pegadas',
    'Cancha cepillada',
    'Obra limpia, sin restos de material',
    'Fotos finales sacadas',
    'Explicado el mantenimiento al cliente',
    'Entregados manual de mantenimiento y garantía',
  ],
  arena: ['Arena pareja en toda la cancha'],
  caucho: ['Caucho parejo en toda la cancha'],
  estructura: [
    'Estructura ajustada y sin óxido a la vista',
    'Vidrios limpios y sin daños',
    'Puertas abren y cierran bien',
    'Luces probadas (todas encienden)',
  ],
  sinInstalacion: ['Césped entregado completo y sin daños', 'Remito firmado por el cliente'],
};

// Logística para obras en el interior (la coordina el encargado de entrega).
window.OBRAS_LOGISTICA = [
  'Pasajes ida y vuelta',
  'Estadía',
  'Comidas',
  'Ayudantes y herramientas que aporta el cliente',
  'Viático entregado al instalador',
];

window.OBRAS_INCIDENCIAS = ['Base no apta', 'Falta material', 'Clima', 'Cliente / acceso a la obra', 'Flete', 'Otro'];

// Llamados de post-venta desde el día en que se termina la obra.
window.OBRAS_POSTVENTA = [
  { id: '1m', label: '1 mes', meses: 1 },
  { id: '6m', label: '6 meses', meses: 6 },
  { id: '1a', label: '1 año', meses: 12 },
];

// Plazos de entrega que se ofrecen al vender (dias: propone la fecha de entrega; null = se escribe cuál).
window.OBRAS_PLAZOS = {
  inmediata: { nombre: 'Entrega inmediata (~5 días)', dias: 5 },
  fabricacion: { nombre: 'Fabricación (20 a 30 días)', dias: 25 },
  otro: { nombre: 'Otro (especificar)', dias: null },
};

// Formas de pago de cada cobro. El «dónde» sale de la forma: proveedor y su cuenta, cuenta nuestra o caja.
window.OBRAS_FORMAS_PAGO = [
  ['cuenta', 'Cuenta nuestra'],
  ['proveedor', 'Transferencia a proveedor'],
  ['efectivo_ars', 'Efectivo pesos'],
  ['efectivo_usd', 'Efectivo dólares'],
  ['cheque', 'Cheque'],
];

// Checklist administrativo de cada obra (Administración), en el orden de docs/CHECKLIST.md.
// tipo: 'tilde' (hecho / no) · 'mail' y 'percepciones' (Sí / No) · 'factura' (con su lógica).
// cuando: 'saldo' = sólo si queda saldo · 'transferencia' = sólo si pagó por transferencia o depósito.
// Las planillas («rosa en la planilla», «Caucho», «Pádel pedidos», «Clientes cerrados») por ahora son tildes a mano.
window.OBRAS_CHECKLIST_ADMIN = [
  { id: 'rosaPlanilla', tipo: 'tilde', texto: 'Poner rosa en la planilla' },
  { id: 'rojoCarpeta', tipo: 'tilde', texto: 'Poner rojo en la carpeta' },
  { id: 'agendado', tipo: 'tilde', texto: 'Verificar que esté agendado (o agendarlo)' },
  { id: 'planillaCompra', tipo: 'tilde', texto: 'Enviar planilla de compra, plano y condiciones' },
  { id: 'detalleCompra', tipo: 'tilde', texto: 'Completar detalle de compra' },
  { id: 'detalleSaldo', tipo: 'tilde', texto: 'Completar detalle de saldo' },
  { id: 'enviarDetalleSaldo', tipo: 'tilde', texto: 'Enviar detalle de saldo al cliente', cuando: 'saldo' },
  { id: 'manual', tipo: 'tilde', texto: 'Enviar manual de mantenimiento' },
  { id: 'garantia', tipo: 'tilde', texto: 'Enviar garantía' },
  { id: 'confirmoMail', tipo: 'mail', texto: '¿El cliente confirmó el mail?' },
  { id: 'ingresarPedido', tipo: 'tilde', texto: 'Ingresar su pedido' },
  { id: 'derivarPago', tipo: 'tilde', texto: 'Derivar el pago', cuando: 'transferencia' },
  { id: 'factura', tipo: 'factura', texto: '¿Tiene factura?' },
  { id: 'percepciones', tipo: 'percepciones', texto: '¿Pagó percepciones?' },
  { id: 'calendario', tipo: 'tilde', texto: 'Agregar al calendario' },
  { id: 'planillaCauchoPadel', tipo: 'tilde', texto: 'Agregar a la planilla «Caucho» o «Pádel pedidos»' },
  { id: 'clientesCerrados', tipo: 'tilde', texto: 'Agregar a la planilla «Clientes cerrados»' },
];
