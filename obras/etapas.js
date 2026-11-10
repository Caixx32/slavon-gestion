'use strict';

// Tipos de obra, etapas de cada uno y checklist de entrega por defecto.
// Al crear una obra se copian estas etapas; después se pueden editar en cada obra.

window.OBRAS_TIPOS = {
  futbol: {
    nombre: 'Fútbol',
    etapas: [
      'Envío del césped',
      'Control de base apta',
      'Tendido del césped',
      'Pegado del verde',
      'Corte para líneas blancas',
      'Pegado del blanco',
      'Arena',
      'Caucho',
      'Cepillado final – lista para usar',
    ],
  },
  padel_cesped: {
    nombre: 'Pádel – solo césped',
    etapas: [
      'Envío del césped',
      'Control de base apta',
      'Tendido del césped',
      'Pegado del verde',
      'Corte para líneas blancas',
      'Pegado del blanco',
      'Arena',
      'Cepillado final – lista para usar',
    ],
  },
  padel_completa: {
    nombre: 'Pádel – cancha completa',
    etapas: [
      'Control de base apta',
      'Pintura',
      'Montaje de estructura',
      'Cableado eléctrico',
      'Montaje de luces',
      'Vidrios',
      'Envío del césped',
      'Tendido del césped',
      'Pegado del verde',
      'Corte para líneas blancas',
      'Pegado del blanco',
      'Arena',
      'Cepillado final – lista para usar',
    ],
  },
  otro: {
    nombre: 'Otro',
    etapas: [],
  },
};

window.OBRAS_CHECKLIST = {
  comun: [
    'Uniones del césped firmes, sin levantes',
    'Líneas derechas y bien pegadas',
    'Arena pareja en toda la cancha',
    'Cancha cepillada',
    'Obra limpia, sin restos de material',
    'Fotos finales sacadas',
    'Explicado el mantenimiento al cliente',
  ],
  futbol: ['Caucho parejo en toda la cancha'],
  padel_completa: [
    'Estructura ajustada y sin óxido a la vista',
    'Vidrios limpios y sin daños',
    'Puertas abren y cierran bien',
    'Luces probadas (todas encienden)',
  ],
};

// Llamados de post-venta desde el día en que se termina la obra.
window.OBRAS_POSTVENTA = [
  { id: '1m', label: '1 mes', meses: 1 },
  { id: '6m', label: '6 meses', meses: 6 },
  { id: '1a', label: '1 año', meses: 12 },
];
