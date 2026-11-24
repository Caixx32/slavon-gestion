// Configuración del Sistema Slavon (compartida por todas las apps).
// Estos datos no son secretos: la seguridad la ponen las reglas de Firestore (firestore.rules), no esta clave.
// Mientras apiKey diga 'COMPLETAR', las apps sólo funcionan en modo demo (?demo).

window.SG_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyD5xgSsxFIa2p3sdeT-r78Siq3PX07NqZQ',
    authDomain: 'slavon-gestion.firebaseapp.com',
    projectId: 'slavon-gestion',
    storageBucket: 'slavon-gestion.firebasestorage.app', // para los planos (Firebase Storage)
    appId: '1:376794417662:web:a2641fc1b4e641ca4498af',
  },

  // Este mail siempre es administrador de todo (también está fijo en firestore.rules).
  ownerEmail: 'juanmarcospaterno@gmail.com',

  // Apps del sistema y los permisos que tiene cada una.
  apps: {
    obras: { name: 'Obras', roles: { admin: 'Admin', administrativo: 'Administrativo (ventas y cobros)', encargado: 'Encargado de obra' } },
    admin: { name: 'Administración', roles: { admin: 'Acceso' } },
    deposito: { name: 'Depósito', roles: { admin: 'Admin', encargado: 'Encargado' } },
    personal: { name: 'Personal', roles: { admin: 'Acceso' } },
    instaladores: { name: 'Instaladores', roles: { admin: 'Acceso' } },
  },
};
