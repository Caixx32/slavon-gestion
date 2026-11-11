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

1. **Venta** (administrativo):
   - **Vendedor:** uno o varios, del catálogo. Si lo vendió un revendedor, se elige del catálogo y se carga la comisión: un monto fijo por venta, en US$ o $.
   - **Cliente:** se elige del catálogo o se crea desde la misma pantalla (si ya hay uno parecido, avisa). Nombre de la persona y/o club (al menos uno), varios teléfonos y mails, cada uno con de quién es (ej: «Juan, dueño», «Pepe, encargado»), ubicación. Si se cambia un dato del cliente, se actualiza en todas sus obras.
   - **N° de pedido** (opcional, se puede buscar).
   - **Cancha, por tipo:**
     - Fútbol (F5, F7, F8, F9, F11), hockey y tenis: ancho × largo.
     - Pádel: por cancha, 200 m² cada una (corregible), blanco incluido.
     - Residencial, mantenimiento u otro: m² a mano.
   - **Césped:** del catálogo, sólo los modelos del deporte elegido. Multisport es un césped, no un tipo de cancha. Monocolor o bicolor; si es bicolor, m² extra a mano.
   - **Multisport en residencial:** lleva arena; se elige si la coloca el cliente.
   - **Blanco:** demarcación simple o doble.
     - F5 y F7: se calcula con desglose. Perímetro, línea del medio y áreas × ancho de línea + desperdicio; los parámetros se cambian en cada venta y por defecto en Catálogos.
     - F8, F9 y F11: «Pedir blanco a Tomás».
     - Hockey y tenis: a mano.
     - Doble demarcación: ml extra a mano.
   - **Qué incluye:**
     - Césped, blanco, arena, caucho, pegamento, cinta e instalación, cada uno con cantidad, quién lo provee y envío (Sí / No / A definir; lo puede completar Entregas).
     - Arena y caucho: kg = superficie × kg/m² del modelo, corregibles.
     - Botón «Solo césped».
     - Instalación a cargo del cliente: SIN GARANTÍA (garantía 0, queda en la venta y el acta).
   - **Plano:** uno o varios, foto o PDF hasta 15 MB, guardados en Firebase Storage. Obligatorio en residencial, doble demarcación y F8 en adelante: sin plano no pasa a Entregas.
   - **Plazo:** inmediato (~5 días), fabricación (20 a 30 días) u otro (se escribe cuál), y tilde «Con stock». Propone la fecha de entrega.
   - **Factura:** sin factura, IVA mínimo o IVA total, con el monto a mano, incluido en el precio. También tributos (percepciones u otros) incluidos.
   - **Garantía en años.**
   - **Plata:** primero contado o financiado y la moneda (US$ o $); después el precio y la seña o anticipo. Los importes se escriben y se muestran con punto de miles (10.000).
   - **Financiado:** por defecto 11 cuotas con 1 % mensual sobre el saldo (precio − anticipo). Ejemplo: 10 − 2 = 8 + 11 % = 8,88 en 11 cuotas. Se ven las fechas de cada cuota desde la primera.
   - **Dólar BNA:** lo baja sola una tarea automática del repo (`.github/workflows/dolar-bna.yml`) desde bna.com.ar cada 15 minutos, de lunes a viernes de 9 a 18, a `shared/bna.json` (cotización billete, columna venta, con histórico por día).
2. **Cobros y condición para entregar:**
   - **Saldo:** siempre es presupuesto − suma de los pagos (financiado: anticipo + cuotas − pagos). Ningún botón ni tilde lo cierra: queda en cero sólo cuando lo pagado alcanza.
   - **La seña o el anticipo es un pago:** al cargar la venta se abre «Registrar seña» para completar cómo y dónde se pagó.
   - **Registrar pago** (parcial o total): fecha, monto y moneda (US$ o $), dólar BNA del día (editable), equivalente en la otra moneda, forma de pago y dónde (transferencia a proveedor y su cuenta, cuenta nuestra, efectivo pesos o dólares con su caja, o cheques), comprobantes (fotos o PDF), «registrado en nuestros registros» y, si entró a W. MAX o Atlantis, si ya tiene factura o hay que solicitarla.
   - **Cheques:** uno o varios por pago (n°, a nombre de, banco, fecha de cobro, monto). Pendiente: cuenta con el dólar del día en que se recibió. Cobrado: se carga la fecha real y el dólar de ese día, y se recalcula. Rechazado: deja de contar y el saldo vuelve.
   - **Pagos mal cargados:** se editan (queda el historial de quién cambió qué) o se borran. Sólo admin y administración.
   - **Recibo PDF** de cada pago, con número correlativo, monto en letras y saldo: se descarga o se imprime. Para sacar el número hace falta conexión.
   - **Contado:** se puede entregar recién con el saldo en cero.
   - **Financiado:** se puede entregar con el contrato firmado en nuestro poder; los pagos van cubriendo las cuotas en orden y se ve cuáles están vencidas.
   - **Aviso:** 7 días antes de la entrega avisa lo que falte.
   - **Buscador de clientes** en cada área: por nombre, club, obra, teléfono, mail o n° de pedido.
   - **Catálogos** (*Más → Catálogos*): vendedores, revendedores, clientes, proveedores (con sus cuentas bancarias) y cuentas propias (W. MAX SRL, Atlantis, cajas de efectivo). No se borran: se dan de baja.
3. **Entrega** (encargado de obra): cuadro «Materiales» (lo que lleva la obra y quién lo pone; el encargado carga cuánto pegamento y cinta y completa el envío), agenda de instalación con equipo (3 de AMBA + instaladores del interior) y aviso si un equipo queda en dos obras a la vez; duración sugerida (pádel completa 5 días por cancha, pádel césped 1). Flete, logística del interior (pasajes, estadía, comidas, ayudantes, viático), etapas con fotos, incidencias (ej: base no apta, con aviso al cliente) y checklist de entrega.
4. **Acta de entrega** para imprimir o guardar en PDF y que firme el cliente: datos, controles, fotos y garantía.
5. **Post-venta:** llamados al mes, a los 6 meses y al año, y control del vencimiento de la garantía.

Tipos: fútbol, pádel solo césped, pádel cancha completa, hockey, tenis, residencial, mantenimiento (sólo clientes nuestros) y otro. Las etapas se arman según el tipo y lo vendido (arena, caucho, con o sin instalación) y se pueden editar en cada obra.

### Permisos

| | Admin | Administrativo | Encargado de obra |
|---|:-:|:-:|:-:|
| Ver precios, señas, saldos, pagos, cheques, comprobantes y contratos | ✔ | ✔ | ✘ |
| Registrar, editar y borrar pagos; recibos | ✔ | ✔ | ✘ |
| Catálogos (vendedores, revendedores, clientes, proveedores, cuentas) | ✔ | ✔ | ✘ |
| Cargar ventas, habilitar entregas, post-venta | ✔ | ✔ | ✘ |
| Agenda, equipos, etapas, fotos, checklist, logística, incidencias, marcar entregada | ✔ | ✔ | ✔ |
| Eliminar obras | ✔ | ✘ | ✘ |

Los datos de plata están en una colección aparte (`ventas`, con sus pagos y comprobantes adentro) que el encargado de obra no puede leer, igual que los catálogos: lo imponen las reglas de Firestore (`firestore.rules`), no sólo la pantalla.

## Usuarios

Un usuario por persona para todas las apps: *Obras → Más → Usuarios y permisos*. Ahí se elige a qué apps entra cada uno y con qué permiso, y si puede manejar usuarios. `juanmarcospaterno@gmail.com` es siempre administrador de todo.

## Puesta en marcha (una sola vez)

1. **Crear el proyecto:** https://console.firebase.google.com → *Agregar proyecto* → nombre `slavon-gestion` → sin Google Analytics → *Crear*.
2. **Registrar la app web:** en la portada del proyecto, ícono `</>` → apodo `slavon-gestion` → *Registrar app*. Copiar el bloque `firebaseConfig` (apiKey, authDomain, projectId, storageBucket, appId) y pegarlo en `shared/config.js`.
3. **Firestore:** *Compilación → Firestore Database → Crear base de datos* → ubicación `southamerica-east1 (São Paulo)` → modo producción.
4. **Reglas:** *Firestore Database → Reglas* → borrar todo → pegar el contenido de `firestore.rules` → *Publicar*.
5. **Login con Google:** *Compilación → Authentication → Comenzar → Google → Habilitar* → elegir el mail de asistencia → *Guardar*.
6. **Dominio autorizado:** *Authentication → Configuración → Dominios autorizados → Agregar dominio* → `caixx32.github.io`.
7. **GitHub Pages:** repo → *Settings → Pages* → *Deploy from a branch* → rama `main`, carpeta `/ (root)` → *Save*.
8. **Storage (planos):**
   - Desde febrero de 2026, Firebase Storage necesita el plan **Blaze** (pago por uso, con una tarjeta asociada). El uso chico queda dentro de la cuota gratis; para eso, el bucket tiene que estar en una región de EE. UU. que la tenga, por ejemplo `us-central1`.
   - Activarlo en *Compilación → Storage → Comenzar*.
   - *Storage → Reglas* → pegar el contenido de `storage.rules` → *Publicar*.
   - Copiar el `storageBucket` en `shared/config.js` (si no estaba).
   - En la demo los planos se guardan en el navegador.

## Archivos

| Carpeta / archivo | Qué tiene |
|---|---|
| `shared/` | Lo común a todas las apps: configuración de Firebase, conexión, login y permisos, pantalla de usuarios, estilos, íconos. En `shared/vendor/` va jsPDF (licencia MIT) para armar los PDF sin conexión. |
| `obras/` | App Obras (`app.js`), tipos de obra, etapas y modelos de césped (`etapas.js`), cuentas de la venta: m², cuotas e importes (`calculos.js`), estilos propios, app instalable (`sw.js`, `manifest.webmanifest`). |
| `firestore.rules` | Reglas de seguridad de la base para pegar en Firebase (incluye pagos y catálogos). |
| `storage.rules` | Reglas de Firebase Storage (planos): los ven todos los de Obras, los suben y borran admin y administración. |

HTML, CSS y JavaScript sin compilación. Firebase (Auth + Firestore) por CDN. Las fotos se guardan comprimidas dentro de Firestore (no hace falta Firebase Storage ni plan pago).

## Datos en Firestore

- `users/{mail}`: nombre, apps y permisos, activo.
- `obras/{id}`: datos operativos (sin plata).
  - Cliente: copia del cliente (`clienteId`, nombre, club, contactos) y n° de pedido.
  - Cancha: `formato` (F5…F11), medidas, `blanco` (demarcación, parámetros, desglose, m², pendiente), `cespedDet` (modelo del catálogo, altura, color), `m2`, `incluye` (cada ítem con cantidad, quién lo provee y envío), `sinGarantia`, `clienteColocaArena`, `conStock`.
  - `planos`: link, nombre y fecha; el archivo está en Storage, en `obras/{id}/planos/`.
  - `materialesEntrega`: pegamento y cinta, los carga Entregas. `envios`: envío de cada ítem (sí / no / a definir), lo completa Ventas o Entregas.
  - Operación: `etapas`, `checklist`, `incidencias`, `logistica`, `postventa`.
- `ventas/{id de la obra}`: la plata, sólo admin y administración. Presupuesto, moneda, seña o anticipo pactado, forma de pago, cuotas, `iva` (sin factura / mínimo / total y monto), `tributos`, vendedores, revendedor (con su comisión fija) y contrato.
  - `ventas/{id}/pagos/{id}`: cada pago (también la seña): fecha, moneda, monto, dólar, equivalente, valor en la moneda de la venta, forma, destino, cheques, comprobantes, registrado, factura, n° de recibo, historial.
  - `ventas/{id}/comprobantes/{id}`: archivo de cada comprobante.
- Catálogos (sólo admin y administración, con `activo`): `vendedores`, `revendedores`, `clientes`, `proveedores` (con `cuentas`), `cuentas` (cuentas propias y cajas), `cespedes` (modelo, fábrica, deportes, altura, arena y caucho por m², blanco, multisport, bicolor, rollo).
- `fotos`: una por documento, con `obraId` y `etapaId`; los planos también, con `tipo: 'plano'`.
- `config/obras`: equipos de instalación y valores por defecto del blanco y del pádel. `config/contadores`: último n° de recibo.

## Actualizar una app

Al cambiar archivos de una app, subí el número de `CACHE` en su `sw.js` (por ejemplo `obras-v2`) y el `?v=` de los archivos en su `index.html`, para que los celulares bajen la versión nueva.
