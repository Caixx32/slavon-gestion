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

- **Ventas:** se carga la venta con fecha de entrega y saldo. 7 días antes de la entrega avisa «Cobrar saldo» (en Inicio, Ventas y Panel). Al marcar el saldo cobrado la obra pasa a **En entrega**, con responsable y fechas de instalación.
- **Estados:** Vendida → En entrega → Terminada.
- **Agenda de instalación:** calendario mensual con una fecha (desde–hasta) por obra; césped en verde, canchas completas en azul y entregas comprometidas sin programar en naranja.
- **Panel** (en la compu): indicadores, tablero por etapa y tabla de obras en entrega.
- **Obras** con cliente, teléfono, ubicación, tipo, responsable de entrega, encargados y notas.
- **Etapas** según el tipo (se copian al crear la obra y se pueden editar en cada obra):
  - *Fútbol:* envío del césped → control de base apta → tendido → pegado del verde → corte para líneas blancas → pegado del blanco → arena → caucho → cepillado final.
  - *Pádel solo césped:* igual que fútbol, sin caucho.
  - *Pádel cancha completa:* control de base apta → pintura → montaje de estructura → cableado eléctrico → montaje de luces → vidrios → y después todo lo del césped (sin caucho).
  - Cada etapa: pendiente / en curso / hecha, fecha, quién la marcó, nota y fotos.
- **Fotos** por etapa o generales, comprimidas en el celular.
- **Checklist de entrega** interno (control nuestro, el cliente no interviene). Se edita por obra.
- **Post-venta:** al marcar la obra como terminada se agendan llamados al cliente al mes, a los 6 meses y al año. Pestaña *Post-venta* con vencidos y próximos, botones de llamar y WhatsApp (con mensaje armado) y nota de qué dijo el cliente.
- Funciona sin señal: lo que se carga se sube solo cuando vuelve la conexión. Se instala como app en el celular.

### Permisos

| | Admin | Encargado de obra |
|---|:-:|:-:|
| Ver obras, etapas, fotos y checklist | ✔ | ✔ |
| Marcar etapas, subir fotos, tildar checklist | ✔ | ✔ |
| Crear, editar y eliminar obras; editar etapas y checklist | ✔ | ✘ |
| Terminar obra y post-venta | ✔ | ✘ |

Los permisos los imponen las reglas de Firestore (`firestore.rules`), no sólo la pantalla.

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

`users/{mail}` (nombre, apps y permisos, activo) · `obras` (datos, `etapas`, `checklist`, `postventa`) · `fotos` (una por documento, con `obraId` y `etapaId`).

## Actualizar una app

Al cambiar archivos de una app, subí el número de `CACHE` en su `sw.js` (por ejemplo `obras-v2`) y el `?v=` de los archivos en su `index.html`, para que los celulares bajen la versión nueva.
