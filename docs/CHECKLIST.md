# Checklist de cambios: App Obras Slavon

Actualizado: 11/11/2026 · Fase 1 hecha (secciones 0, 1 «Vendedor» y «Datos del cliente», y 2) · Fase 2 hecha (sección 1 completa y catálogo de césped) · Fase 3 hecha (sección 3, Administración).
Para pasarle a Claude Code sobre el repo `Caixx32/slavon-gestion`. Lo marcado con ❓ necesita datos de Juan antes de programarlo.

---

## 0. Base común (va primero porque lo usan todas las áreas)

- [x] **Catálogo de vendedores**: lista editable (alta/baja). Se usa en el desplegable "Quién vendió".
- [x] **Catálogo de revendedores**: lista editable. La comisión es un monto fijo que se carga en cada venta (sin %).
- [x] **Catálogo de clientes**: alta de clientes para elegirlos de un desplegable y no tipear (evita duplicados y permite reportes).
- [x] **Catálogo de proveedores**: alta de proveedores con sus cuentas bancarias (CBU/alias, banco, titular). Se usan en "Transferencia a proveedor".
- [x] **Catálogo de cuentas propias**: W. MAX SRL, Atlantis, efectivo oficina, etc. Se usan en "Cuenta nuestra".
- [x] **Catálogo de césped** (editable en Más → Catálogos). Carga inicial:

  | Modelo Slavon | Modelo fábrica | Deportes | Altura mm | Arena kg/m² | Caucho kg/m² | Blanco | Multisport | Rollo m |
  |---|---|---|---|---|---|---|---|---|
  | 44 profesional | 4278 | Fútbol | 44 | 40 | 4 | Sí | No | 4 |
  | 52 amateur | 5075 | Fútbol | 52 | 40 | 6 | Sí | No | 4 |
  | 52 profesional | 5090 | Fútbol | 52 | 40 | 6 | Sí | No | 4 |
  | 52 premium | 50115 | Fútbol | 52 | 40 | 8 | Sí | No | 4 |
  | Monofilamento fútbol | Monofilamento fútbol | Fútbol | 52 | 40 | 8 | Sí | No | 4 |
  | Multisport premium | 25110 | Fútbol, Hockey, Tenis, Residencial | 25 | 40 | — | Sí | Sí | 4 |
  | Multisport | 2585 | Fútbol, Hockey, Tenis, Residencial | 25 | 40 | — | Sí | Sí | 4 |
  | Fibrilado pádel | 1380 | Pádel | 13 | 20 | — | — | No | 4 |
  | Monotex pádel – nacional | Monofilamento texturado Atlantis | Pádel | 13 | 10 | — | — | No | 4 |
  | Monotex pádel – importado | Monofilamento texturado importado | Pádel | 13 | 10 | — | — | No | 4 |
  | Deco | Deco | Residencial | selector 20/30/40 | — | — | — | No | 4 |
  | Fairway evolution | Fairway evolution | Residencial | 21 | — | — | — | No | 4 |
  | Spring | Spring | Residencial | 28 | — | — | — | No | 4 |
  | Non fill | Non fill | Residencial | — | — | — | — | No | 4 |

  - Fútbol y multisport pueden ser bicolor. Pádel: variedad de colores.
  - El desplegable de césped muestra solo los modelos del deporte elegido. Multisport ya no es tipo de cancha.
  - _Hecho: pestaña «Césped» en Catálogos con el botón «Cargar la lista inicial» y los valores por defecto del blanco y del pádel._
- [x] **Formato de números en toda la app**: separador de miles con punto (10.000) y símbolo según moneda: **US$** dólares, **$** pesos.
- [x] **Buscador** en Ventas y en Administración: por nombre de cliente, club, teléfono, mail y **n° de pedido**.

---

## 1. NUEVA VENTA

### Vendedor
- [x] "Quién vendió" pasa a ser **desplegable** (del catálogo), no texto libre.
- [x] Permitir **más de un vendedor** por venta.
- [x] Opción **revendedor**: si aplica, elegirlo del catálogo y cargar la **comisión**: **monto fijo por venta** (US$ o $), no porcentaje.

### Datos del cliente
- [x] Dos identificadores, usables por separado o juntos: **Nombre del cliente** y **Club**. Al menos uno es obligatorio.
- [x] Campo **mail**.
- [x] Botón **"+ teléfono"** y **"+ mail"**, cada uno con etiqueta (ej. "Juan, dueño", "Pepe, encargado").
- [x] Elegir cliente existente desde el catálogo o crear uno nuevo desde la misma pantalla.

### Pedido
- [x] Campo **n° de pedido** (opcional), visible al lado del cliente o club.

### Tipo de cancha y césped
- [x] Sacar **Multisport** como tipo de cancha. Pasa a ser una **opción de césped** dentro de fútbol, hockey, tenis o residencial.
- [x] **Tipo de césped**: desplegable con los modelos del deporte elegido, del catálogo de césped (sección 0).
- [x] **Monocolor / bicolor**: fútbol y multisport pueden ser bicolor. Pádel: variedad de colores.

### Medidas y m² por tipo de cancha
- [x] **Residencial**: solo **m² a mano**, **plano obligatorio**, sin relleno.
  - Excepción: **Multisport en residencial** lleva arena 40 kg/m². Mostrar «Lleva arena. Sin arena no tiene garantía» y tilde **«El cliente coloca la arena: Sí/No»** (queda en la venta y en el acta).
- [x] **Pádel**: se vende **por cancha**, blanco incluido, no se calcula blanco. _200 m² por cancha para calcular la arena, corregible._
- [x] **Fútbol y hockey**: **ancho y largo**. m² totales = ancho × largo + m² de blanco (+ m² extra bicolor si aplica).

### Blanco (césped blanco de las líneas)
- [x] Selector **demarcación simple / doble**.
- [x] **Parámetros editables** con default: separación al borde **s = 0,50 m**; **ancho de línea 8 cm**; **desperdicio 10 %**.
- [x] **Cálculo**:
  - Perímetro = 2 × [(ancho − 2s) + (largo − 2s)]
  - Línea del medio = ancho − 2s
  - **F5**: + 26 ml (2 áreas de 3 × 7). **F7**: + 44 ml (2 áreas de 5,5 × 11).
  - m² blanco = ml totales × ancho de línea × (1 + desperdicio). **Mostrar el desglose.**
  - Ejemplo F5 15 × 30: 86 + 14 + 26 = 126 ml × 0,08 = 10,08 m² → **11,09 m²**.
- [x] **F8, F9, F11**: NO se calcula. Aviso **«Pedir blanco a Tomás»**, dato pendiente hasta que se cargue, **plano obligatorio**.
- [x] **Hockey**: m² de blanco **a mano**. _Tenis, igual que hockey._
- [x] **Doble demarcación**: se calcula la principal y se suman **ml extra a mano** según plano. **Plano obligatorio**.

### Bicolor
- [x] Por ahora, campo **«m² extra por desperdicio bicolor»** a mano.

### Qué incluye
- [x] **Tabla de ítems**, cada uno con **cantidad**, **quién lo provee** (Slavon / Cliente) y **envío incluido** (Sí / No):
  - **Césped**: m² calculados, siempre Slavon.
  - **Blanco**.
  - **Arena**: kg = m² × kg/m² del modelo.
  - **Caucho**: ídem.
  - **Pegamento** y **Cinta de unión**: la cantidad la carga Federico en Entregas; en Ventas solo quién lo provee. _Hecho: cuadro «Materiales» en la ficha de Entregas; los encargados editan sólo eso._
  - **Instalación**.
- [x] Arena y caucho **se calculan aunque los ponga el cliente**. Cantidades **corregibles a mano**.
- [x] Botón **«Solo césped»**: todo lo demás pasa a cargo del cliente.
- [x] Si **Instalación = Cliente → SIN GARANTÍA**: avisar, garantía en 0 y dejarlo escrito en la venta y en el acta.

### Correcciones después de probar la Fase 2
- [x] **Envío** de cada ítem de «Qué incluye»: **Sí / No / A definir** (por defecto «A definir»). En la ficha de Entregas (cuadro «Materiales») el encargado lo puede completar.
- [x] **Pegamento y cinta**: por defecto los provee Slavon; con «Solo césped» pasan a cargo del cliente, como el resto.
- [x] **Revendedor**: comisión en monto fijo (US$ o $); sin % en el catálogo.

### Plano
- [x] **Adjuntar plano** (PDF o imagen), uno o varios.
- [x] **Obligatorio** en residencial, doble demarcación y F8 en adelante. _Se puede guardar la venta, pero queda «Falta plano» en rojo en listas y fichas y no pasa a Entregas hasta adjuntarlo. Los planos van a Firebase Storage; en la obra queda el link, el nombre y la fecha. Los ven también los encargados._

### Plazo
- [x] **Inmediata (~5 días)**, **fabricación (20-30 días)** y **«Otro»** con campo de texto.
- [x] Tilde **«Con stock»**.

### Precio
- [x] **Antes del precio**: elegir **contado** o **financiado**.
- [x] Moneda del presupuesto: **US$** o **$**.
- [x] **Financiado**: anticipo → cuotas = (precio − anticipo) × (1 + 0,01 × 11) / 11. Default **11 cuotas y 1 % mensual**, ambos editables.
  Ejemplo: 10.000 − 2.000 = 8.000 → 8.000 × 1,11 / 11 = **807,27 por cuota**.
- [x] **Fecha de la 1ª cuota** y siguientes mensuales, en tabla.
- [x] Debajo del precio: selector **IVA mínimo / IVA total** con **monto a mano** y leyenda **«Incluido en el precio total»** (no se suma). _Con la opción «Sin factura»._
- [x] Botón **«+ Agregar tributo»** (percepciones u otros: nombre y monto, también incluidos en el precio).
- [x] **Garantía en años**, no en meses.

---

## 2. REGISTRAR PAGO (se usa desde Ventas y Administración)

### 🐞 Errores actuales a corregir
- [x] El botón **"Saldo cobrado"** marca el saldo como pagado completo aunque se cargue un monto menor.
- [x] Caso probado: presupuesto 10.000, anticipo 5.000, pago cargado menor a 5.000 → lo toma como saldo, queda **"saldado"** y **no se puede modificar**.
- [x] Ningún pago debe cerrar el saldo solo. El estado sale de la cuenta: **saldo = presupuesto − suma de pagos**.

### Botón "Registrar pago" (parcial o total)
Cada pago guarda:
- [x] **Fecha**.
- [x] **Monto** y **moneda** (US$ o $).
- [x] **Tipo de cambio**: el BNA del día del pago (billete venta, desde `shared/bna.json`), editable.
- [x] **Equivalente** en la otra moneda (calculado).
- [x] **Forma de pago** (desplegable):
  - **Transferencia a proveedor** → desplegable de proveedores y sus cuentas.
  - **Cuenta nuestra** → desplegable de cuentas propias (W. MAX SRL, Atlantis, etc.).
  - **Efectivo pesos**.
  - **Efectivo dólares**.
  - **Cheque** → ver abajo.
- [x] **Dónde pagó** (desplegable: ej. "transferencia a Polimetal", "depósito en Atlantis", "efectivo oficina"). _Sale de la forma de pago: proveedor y su cuenta, cuenta nuestra o caja._
- [x] **Comprobante**: adjuntar uno o varios archivos.
- [x] Tilde **"Registrado en nuestros registros"** (ya se cargó el comprobante en la contabilidad).
- [x] Si fue a **W. MAX SRL o Atlantis**: estado de factura → **"ya tiene factura"** / **"hay que solicitarla"**.
- [x] **Editar y borrar** un pago mal cargado (borrar solo Admin o Administrativo).

### Cheques
- [x] Cargar **uno o varios cheques** en un mismo pago. Por cada cheque: **n° de cheque**, **a nombre de**, **banco**, **fecha de cobro**, **monto**.
- [x] Estado del cheque: **pendiente / cobrado / rechazado**.
- [x] Al marcarlo **cobrado**: cargar la **fecha real** y la **cotización del día de cobro**. El equivalente en US$ se recalcula con esa cotización.

### Recibo
- [x] Botón **"Recibo PDF"** en cada pago (imprimir o descargar). _Funciona; falta pasarlo al formato de Slavon (ver Pendientes)._

### Correcciones después de probar la Fase 1
- [x] **Seña pactada vs cobrada**: en Cobros se ve «Seña pactada · Cobrado de seña · Falta de seña». En «Registrar seña» se ve arriba lo pactado con su equivalente en la moneda elegida, y si lo cobrado no coincide pregunta «¿Actualizar la seña pactada a este monto?».
- [x] **Efectivo retirado**: si la forma es efectivo, «¿Lo fuimos a buscar?» y, si es sí, quién lo retiró y dónde (también en el recibo).
- [x] **N° de pedido siempre visible** al lado del cliente o club: listas, fichas, buscador, acta y recibos (pantalla y PDF).

---

## 3. ADMINISTRACIÓN

### Edición
- [x] Hoy se ve una ficha con pocos datos y no se puede editar. **Poder editar toda la venta** desde Administración; cualquier cambio en la venta se refleja directo acá (es el mismo registro, no una copia).

### Estado de saldo (ficha de la obra)
- [x] **Presupuesto** total.
- [x] Cuánto es **IVA mínimo / IVA total**.
- [x] **Total pagado**, en US$ y en $.
- [x] **Saldo pendiente** total.
- [x] **Saldo pendiente de facturar**. _= monto a facturar (por ahora se carga a mano) − facturas cargadas. Sin factura = 0._
- [x] Si es financiado: tabla de **cuotas** con estado (pagada / vencida / próxima).

### Detalle de saldo
- [x] Tabla con cada pago: **fecha**, **qué pagó** ($ o US$), **TC del día**, **equivalente en US$**, **dónde y cómo** pagó, **saldo después del pago**.
- [x] **Carpeta de comprobantes**: ver y descargar todos los comprobantes de la obra. _Uno por uno o todos juntos en .zip._
- [x] Botón **"Detalle de saldo PDF"** para imprimir o mandar al cliente.

### Botones de cierre (separados)
- [x] **"Saldo cobrado"**: solo se habilita cuando el saldo calculado es **0**. _Deja quién y cuándo. Si el saldo vuelve a subir (cheque rechazado, pago borrado, precio mayor), avisa y se borra la marca._
- [x] **"Pasar a Entregas"**: botón aparte, porque a veces está cobrado pero no se pasa por otro motivo. (Financiado: se habilita con contrato firmado, como ahora.) _Contado: pide la marca «Saldo cobrado». Ya no hay pase automático al registrar un pago o el contrato._

### Que no desaparezca
- [x] **Error actual**: cuando la obra termina de pagar y pasa a Entregas, **desaparece de Administración**. Tiene que quedar visible (por ejemplo, en una pestaña **"Cobradas / en entrega"** o con un filtro por estado). _Hecho: pestañas «Por cobrar», «Cobradas / en entrega», «Entregadas» y «Todas»._

### Checklist administrativo por obra
- [x] Poner **rosa en la planilla** y **rojo en la carpeta**.
- [x] Verificar que esté **agendado** / agendarlo.
- [x] Enviar **planilla de compra, plano y condiciones**.
- [x] Completar **detalle de compra**.
- [x] Completar **detalle de saldo**.
- [x] Si queda saldo pendiente, **enviar detalle de saldo** al cliente.
- [x] Enviar **manual de mantenimiento**.
- [x] Enviar **garantía**.
- [x] ¿El cliente **confirmó el mail**? Sí / No.
- [x] **Ingresar su pedido**.
- [x] Si pagó por transferencia o depósito, **derivar el pago**.
- [x] ¿Tiene **factura**? Sí / No:
  - Si **Sí** → campo **razón social** (y CUIT).
  - Si **No** → ¿transfirió a **W. MAX**, **Atlantis** u **otro**?
    - W. MAX o Atlantis → **pedir la factura**.
    - Otro → igual **pedir razón social**.
- [x] ¿Pagó **percepciones**? Sí / No.
- [x] **Agregar al calendario**.
- [x] Agregar a planilla **"Caucho" o "Pádel pedidos"**.
- [x] Agregar a planilla **"Clientes cerrados"**.
- _Los ítems de planillas por ahora son tildes a mano; la conexión con Drive es la Fase 5. La razón social y el CUIT también se guardan en el cliente del catálogo._

---

## 4. ENTREGAS

- [ ] **Fecha de entrega editable**. Mostrar las dos: **fecha estimada** (la que sale de la venta según el plazo) y **fecha real de entrega** (la coordinada con el cliente).
- [ ] **Remitos firmados**: al entregar los materiales (no hace falta que esté instalado), subir **foto de uno o varios remitos** firmados por el cliente.
- [ ] **Etapa 1 = "Base apta"**: primera etapa obligatoria, con **fotos** como constancia. Si las fotos están en WhatsApp, al menos tildar "constancia en WhatsApp" con fecha y quién la tiene.
- [ ] **Acta de entrega**: botón para **descargar en PDF** (además de imprimir).

---

## 5. CONEXIÓN CON GOOGLE DRIVE

- [ ] Al crear una venta, crear en el Drive de la empresa una **carpeta por cliente**, ordenada por **deporte** (ej. `Clientes / Fútbol / Club X`).
- [ ] Dentro: **planilla del cliente** (venta + detalle de saldo) y subcarpetas **Comprobantes**, **Planos**, **Remitos**, **Fotos de obra**.
- [ ] Los comprobantes, planos y remitos que se suben en la app se guardan también ahí.
- [ ] Definir si la app guarda los archivos **directamente en Drive** o en su propia base y los **copia** a Drive.

---

## Pendientes (no programar todavía)

- [ ] **Recibo con el formato de Slavon** (Juan pasa el modelo).
- [ ] **Fórmula del bicolor** (por ahora, m² extra a mano).
- [ ] **Cálculo automático de pegamento y cinta de unión** (por ahora la cantidad la carga Federico en Entregas).
- [ ] **Desglose de IVA y monto a facturar** automáticos (por ahora, los dos se cargan a mano).
- [ ] **Blanco de F8, F9 y F11** (por ahora, «Pedir blanco a Tomás»).

---

## ❓ Datos que tiene que pasar Juan

1. ~~Cómo se calcula el blanco~~ → definido arriba (falta F8, F9 y F11: los pasa Tomás).
2. ~~Lista de modelos de césped~~ → cargada arriba.
3. **Fórmula de desperdicio** para bicolor.
4. ~~Qué significan las tildes de instalación, arena y caucho~~ → definido en «Qué incluye».
5. Lista inicial de **vendedores**, **revendedores** (con % de comisión), **proveedores con sus cuentas** y **cuentas propias**.
6. Cómo se calcula **IVA mínimo / IVA total** sobre el presupuesto (por ahora, monto a mano).
7. Nombres exactos de las planillas de Drive ("rosa en la planilla", "Caucho", "Pádel pedidos", "Clientes cerrados") y dónde están.
