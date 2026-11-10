'use strict';

/*
 * Tipos de trabajo, cómo se arman sus etapas y el checklist de entrega por defecto.
 * Al crear una obra se copian estas etapas; después se pueden editar en cada obra.
 *
 * arena / caucho: lo que lleva normalmente cada tipo (en la venta se puede cambiar).
 * dias: duración sugerida de la instalación por cancha (null = depende de la medida).
 */

window.OBRAS_TIPOS = {
  futbol: { nombre: 'Fútbol', arena: true, caucho: true, dias: null },
  padel_cesped: { nombre: 'Pádel – solo césped', arena: true, caucho: false, dias: 1 },
  padel_completa: { nombre: 'Pádel – cancha completa', arena: true, caucho: false, dias: 5, estructura: true },
  hockey: { nombre: 'Hockey', arena: true, caucho: false, dias: null },
  tenis: { nombre: 'Tenis', arena: true, caucho: false, dias: null },
  residencial: { nombre: 'Residencial', arena: false, caucho: false, dias: 1 },
  multisport: { nombre: 'Multisport', arena: true, caucho: false, dias: null },
  mantenimiento: { nombre: 'Mantenimiento (clientes nuestros)', arena: false, caucho: false, dias: 1, mantenimiento: true },
  otro: { nombre: 'Otro', arena: false, caucho: false, dias: null },
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

// Plazos de entrega que se ofrecen al vender.
window.OBRAS_PLAZOS = {
  inmediata: { nombre: 'Entrega inmediata (~5 días)', dias: 5 },
  fabricacion: { nombre: 'Fabricación (20 a 30 días)', dias: 25 },
};
