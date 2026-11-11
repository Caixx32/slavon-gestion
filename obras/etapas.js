'use strict';

/*
 * Tipos de trabajo, cómo se arman sus etapas y el checklist de entrega por defecto.
 * Al crear una obra se copian estas etapas; después se pueden editar en cada obra.
 *
 * arena / caucho: lo que incluye normalmente el presupuesto de cada tipo (en la venta se puede cambiar).
 * dias: duración sugerida de la instalación por cancha (null = depende de la medida).
 * medida: 'cancha' = ancho × largo + blanco · 'm2' = se cargan los m² directo.
 * cesped: qué lista de modelos de césped se ofrece (OBRAS_CESPEDES).
 * oculto: ya no se ofrece al vender, pero se sigue mostrando en las obras viejas.
 */

window.OBRAS_TIPOS = {
  futbol: { nombre: 'Fútbol', arena: true, caucho: true, dias: null, medida: 'cancha', cesped: 'futbol' },
  padel_cesped: { nombre: 'Pádel – solo césped', arena: true, caucho: false, dias: 1, medida: 'cancha', cesped: 'padel' },
  padel_completa: { nombre: 'Pádel – cancha completa', arena: true, caucho: false, dias: 5, estructura: true, medida: 'cancha', cesped: 'padel' },
  hockey: { nombre: 'Hockey', arena: true, caucho: false, dias: null, medida: 'cancha', cesped: 'hockey' },
  tenis: { nombre: 'Tenis', arena: true, caucho: false, dias: null, medida: 'cancha', cesped: 'tenis' },
  residencial: { nombre: 'Residencial', arena: false, caucho: false, dias: 1, medida: 'm2', cesped: 'residencial' },
  // Multisport ya no es un tipo de obra: es un césped dentro de fútbol, hockey y residencial.
  multisport: { nombre: 'Multisport', arena: true, caucho: false, dias: null, medida: 'cancha', cesped: 'futbol', oculto: true },
  mantenimiento: { nombre: 'Mantenimiento (clientes nuestros)', arena: false, caucho: false, dias: 1, mantenimiento: true, medida: 'm2' },
  otro: { nombre: 'Otro', arena: false, caucho: false, dias: null, medida: 'm2' },
};

// Modelos de césped que se ofrecen en la venta según el deporte (siempre hay además «Otro» para escribirlo).
// PENDIENTE: son los de la demo; reemplazar por la lista real de modelos de Slavon.
window.OBRAS_CESPEDES = {
  futbol: ['Monofilamento 40 mm', 'Monofilamento 50 mm', 'Multisport'],
  hockey: ['Hockey arena 22 mm', 'Multisport'],
  residencial: ['Paisajismo 35 mm', 'Paisajismo 40 mm', 'Multisport'],
  padel: ['Fibrilado 12 mm', 'Textil pádel'],
  tenis: ['Tenis arena 20 mm'],
};

// Etapas según el tipo y lo vendido (con o sin instalación, arena, caucho).
window.obrasEtapas = function obrasEtapas(tipo, { conInstalacion = true, conArena, conCaucho } = {}) {
  const t = window.OBRAS_TIPOS[tipo] || window.OBRAS_TIPOS.otro;
  const arena = conArena ?? t.arena;
  const caucho = conCaucho ?? t.caucho;
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

// Cómo se puede pagar (para registrar cada cobro).
window.OBRAS_MEDIOS_PAGO = ['Efectivo', 'Transferencia', 'Depósito', 'Cheque', 'Mercado Pago', 'Tarjeta', 'Otro'];
