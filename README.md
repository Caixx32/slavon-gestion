# Sistema Slavon

Apps web internas de **SLAVON**. Cada app tiene su propio link, pero todas comparten el login con Google, los usuarios y la base de datos (Firebase).

| App | Link | Estado |
|---|---|---|
| Inicio (links a todas) | https://caixx32.github.io/slavon-gestion/ | Lista |
| **Obras** | https://caixx32.github.io/slavon-gestion/obras/ | Lista |
| Administración | `/admin/` | Próximamente |
| Depósito | `/deposito/` | Próximamente |
| Personal | `/personal/` | Próximamente |

**Demo sin datos reales:** agregá `?demo` al final del link (por ejemplo https://caixx32.github.io/slavon-gestion/obras/?demo). Carga obras de ejemplo guardadas sólo en ese navegador. Tocando la etiqueta roja «DEMO» se puede ver la app como admin o como encargado.

## Obras

De la venta a la post-venta:

1. **Venta** (administrativo): tipo de cancha y de césped, m², cantidad de canchas, con o sin instalación, arena, caucho, plano y consideraciones. Plazo inmediato (~5 días) o fabricación (20 a 30 días), que propone la fecha de entrega. Precio y seña en US$ (se paga en pesos al dólar oficial Banco Nación vendedor del día). El dólar lo baja sola una tarea automática del repo (`.github/workflows/dolar-bna.yml`) desde bna.com.ar cada 15 minutos, de lunes a viernes de 9 a 18, a `shared/bna.json` (cotización billete, columna venta, con histórico por día); la app lo usa para mostrar los pesos y guardar el TC de cada cobro.
2. **Condición para entregar:** contado → saldo cobrado antes de la entrega de materiales; financiado → contrato firmado en nuestro poder. 7 días antes de la entrega avisa lo que falte. Sin eso no se habilita la entrega.
3. **Entrega** (encargado de obra): agenda de instalación con equipo (3 de AMBA + instaladores del interior) y aviso si un equipo queda en dos obras a la vez; duración sugerida (pádel completa 5 días por cancha, pádel césped 1). Flete, logística del interior (pasajes, estadía, comidas, ayudantes, viático), etapas con fotos, incidencias (ej: base no apta, con aviso al cliente) y checklist de entrega.
4. **Acta de entrega** para imprimir o guardar en PDF y que firme el cliente: datos, controles, fotos y garantía.
5. **Post-venta:** llamados al mes, a los 6 meses y al año, y control del vencimiento de la garantía.

Tipos: fútbol, pádel solo césped, pádel cancha completa, hockey, tenis, residencial, multisport, mantenimiento (sólo clientes nuestros) y otro. Las etapas se arman según el tipo y lo vendido (arena, caucho, con o sin instalación) y se pueden editar en cada obra.

### Permisos

| | Admin | Administrativo | Encargado de obra |
|---|:-:|:-:|:-:|
| Ver precios, señas, saldos y contratos | ✔ | ✔ | ✘ |
| Cargar ventas, habilitar entregas, post-venta | ✔ | ✔ | ✘ |
| Agenda, equipos, etapas, fotos, checklist, logística, incidencias, marcar entregada | ✔ | ✔ | ✔ |
| Eliminar obras | ✔ | ✘ | ✘ |

Los datos de plata están en una colección aparte (`ventas`) que el encargado de obra no puede leer: lo imponen las reglas de Firestore (`firestore.rules`), no sólo la pantalla.

## Usuarios

Un usuario por persona para todas las apps: *Obras → Más → Usuarios y permisos*. Ahí se elige a qué apps entra cada uno y con qué permiso, y si puede manejar usuarios. `juanmarcospaterno@gmail.com` es siempre administrador de todo.

## Puesta en marcha (una sola vez)

1. **Crear el proyecto:** https://console.firebase.google.com → *Agregar proyecto* → nombre `slavon-gestion` → sin Google Analytics → *Crear*.
2. **Registrar la app web:** en la portada del proyecto, ícono `</>` → apodo `slavon-gestion` → *Registrar app*. Copiar el bloque `firebaseConfig` (apiKey, authDomain, projectId, appId) y pegarlo en `shared/config.js`.
3. **Firestore:** *Compilación → Firestore Database → Crear base de datos* → ubicación `southamerica-east1 (São Paulo)` → modo producción.
4. **Reglas:** *Firestore Database → Reglas* → borrar todo → pegar el contenido de `firestore.rules` → *Publicar*.
5. **Login con Google:** *Compilación → Authentication → Comenzar → Google → Habilitar* → elegir el mail de asistencia → *Guardar*.
6. **Dominio autorizado:** *Authentication → Configuración → Dominios autorizados → Agregar dominio* → `caixx32.github.io`.
7. **GitHub Pages:** repo → *Settings → Pages* → *Deploy from a branch* → rama `main`, carpeta `/ (root)` → *Save*.

## Archivos

| Carpeta / archivo | Qué tiene |
|---|---|
| `shared/` | Lo común a todas las apps: configuración de Firebase, conexión, login y permisos, pantalla de usuarios, estilos, íconos. |
| `obras/` | App Obras (`app.js`), tipos de obra y etapas (`etapas.js`), estilos propios, app instalable (`sw.js`, `manifest.webmanifest`). |
| `firestore.rules` | Reglas de seguridad para pegar en Firebase. |

HTML, CSS y JavaScript sin compilación. Firebase (Auth + Firestore) por CDN. Las fotos se guardan comprimidas dentro de Firestore (no hace falta Firebase Storage ni plan pago).

## Datos en Firestore

`users/{mail}` (nombre, apps y permisos, activo) · `obras` (datos operativos, `etapas`, `checklist`, `incidencias`, `logistica`, `postventa`) · `ventas/{id de la obra}` (precio, seña, forma de pago, saldo, contrato) · `fotos` (una por documento, con `obraId` y `etapaId`) · `config/obras` (equipos de instalación).

## Actualizar una app

Al cambiar archivos de una app, subí el número de `CACHE` en su `sw.js` (por ejemplo `obras-v2`) y el `?v=` de los archivos en su `index.html`, para que los celulares bajen la versión nueva.
