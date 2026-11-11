# Checklist de cambios: App Obras Slavon

Actualizado: 11/11/2026 · Fase 1 hecha (secciones 0, 1 «Vendedor» y «Datos del cliente», y 2).
Para pasarle a Claude Code sobre el repo `Caixx32/slavon-gestion`. Lo marcado con ❓ necesita datos de Juan antes de programarlo.

---

## 0. Base común (va primero porque lo usan todas las áreas)

- [x] **Catálogo de vendedores**: lista editable (alta/baja). Se usa en el desplegable "Quién vendió".
- [x] **Catálogo de revendedores**: lista editable, con % de comisión por defecto (se puede cambiar en cada venta).
- [x] **Catálogo de clientes**: alta de clientes para elegirlos de un desplegable y no tipear (evita duplicados y permite reportes).
- [x] **Catálogo de proveedores**: alta de proveedores con sus cuentas bancarias (CBU/alias, banco, titular). Se usan en "Transferencia a proveedor".
- [x] **Catálogo de cuentas propias**: W. MAX SRL, Atlantis, efectivo oficina, etc. Se usan en "Cuenta nuestra".
- [ ] **Catálogo de césped** ❓: modelo, deporte(s) donde aplica, kg de arena por m², kg de caucho por m², si admite bicolor. Juan pasa la lista.
- [x] **Formato de números en toda la app**: separador de miles con punto (10.000) y símbolo según moneda: **US$** dólares, **$** pesos.
- [x] **Buscador** en Ventas y en Administración: por nombre de cliente, club, teléfono, mail y **n° de pedido**.

---

## 1. NUEVA VENTA

### Vendedor
- [x] "Quién vendió" pasa a ser **desplegable** (del catálogo), no texto libre.
- [x] Permitir **más de un vendedor** por venta.
- [x] Opción **revendedor**: si aplica, elegirlo del catálogo y cargar/ver la **comisión** (% y monto calculado sobre el presupuesto).

### Datos del cliente
- [x] Dos identificadores, usables por separado o juntos: **Nombre del cliente** y **Club**. Al menos uno es obligatorio.
- [x] Campo **mail**.
- [x] Botón **"+ teléfono"** y **"+ mail"**, cada uno con etiqueta (ej. "Juan, dueño", "Pepe, encargado").
- [x] Elegir cliente existente desde el catálogo o crear uno nuevo desde la misma pantalla.

### Pedido
- [x] Campo **n° de pedido** (opcional). _Hecho para el buscador; «Con stock» queda para después._
- [ ] Tilde **"Con stock"** (sale de stock, no se fabrica).

### Tipo de cancha y césped
- [x] Sacar **Multisport** como tipo de cancha. Pasa a ser una **opción de césped** dentro de fútbol, hockey o residencial.
- [ ] **Tipo de césped**: desplegable con los modelos del deporte elegido (del catálogo). _Hecho con los modelos de la demo; falta el catálogo real ❓._
- [ ] **Monocolor / bicolor**. Si es bicolor, aplicar fórmula de desperdicio ❓ (Juan pasa la fórmula). _El selector está; falta la fórmula._

### Medidas y m²
- [ ] **Residencial**: no es cancha. Solo se cargan **m² a mano**, y el **plano es obligatorio** (la app pide adjuntarlo y no deja guardar sin él).
- [x] **Fútbol** (y demás canchas): se cargan **ancho y largo**. m² = ancho × largo + blanco.
- [ ] **Demarcación simple o doble**: selector que cambia el cálculo del blanco ❓. _El selector está; el blanco se carga a mano hasta tener la fórmula._
- [ ] **Calculadora de blanco por tipo de cancha** ❓: muestra cuántos metros/m² de blanco lleva según el tipo de cancha y la demarcación, para verificar. Juan explica cómo se calcula.

### Materiales (automáticos según el césped)
- [ ] **Arena**: kg necesarios = m² × kg/m² del modelo elegido. Se calcula solo y se puede corregir a mano.
- [ ] **Caucho**: kg necesarios = m² × kg/m² del modelo. Se calcula solo y se puede corregir a mano. Si el modelo no tiene dato, la app lo marca como faltante.
- [ ] **Qué incluye** ❓: definir si cada tilde (instalación, arena, caucho) significa "está incluido en el presupuesto" o "este césped en esta cancha lleva arena, caucho e instalación". Recomendación: separar las dos cosas: lo que **lleva** la cancha (lo calcula la app) y lo que **incluye el precio** (se tilda). _Hecho lo que incluye el precio: instalación sí/no; arena y caucho: los compra el cliente (los instalamos), los vendemos o no lleva. Falta lo que «lleva» calculado desde el catálogo de césped._
- [ ] **Envío**: ¿incluido? Sí/No. Si es Sí, tildar de qué: **césped**, **pegamento**, **caucho**, **arena**, **todo**.

### Plano
- [ ] **Adjuntar plano** (PDF o imagen), uno o varios. Obligatorio en residencial. _Adjuntar ya funciona; falta que sea obligatorio en residencial._

### Plazo
- [x] Mantener **inmediata (~5 días)** y **fabricación (20-30 días)**, y agregar **"Otro"** con campo para especificar.

### Precio y forma de pago
- [x] **Antes del precio**: elegir **contado** o **financiado**.
- [x] Moneda del presupuesto: **US$** o **$**.
- [ ] **Facturación**: elegir **IVA mínimo**, **IVA total** o **sin factura**. Mostrar cuánto del presupuesto corresponde a cada parte.
- [x] **Financiado**: cargar anticipo → la app calcula las cuotas. Por defecto **11 cuotas, 1% mensual sobre el saldo** (editable):
  `cuota = (presupuesto − anticipo) × (1 + 0,01 × 11) / 11`
  Ejemplo: 10.000 − 2.000 = 8.000 → 8.000 × 1,11 / 11 = **807,27 por cuota**.
- [x] Cargar **fecha de la 1ª cuota** y generar las siguientes mensuales (tabla con fecha y monto de cada cuota).
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
- [ ] Hoy se ve una ficha con pocos datos y no se puede editar. **Poder editar toda la venta** desde Administración; cualquier cambio en la venta se refleja directo acá (es el mismo registro, no una copia).

### Estado de saldo (ficha de la obra)
- [ ] **Presupuesto** total.
- [ ] Cuánto es **IVA mínimo / IVA total**.
- [ ] **Total pagado**, en US$ y en $.
- [ ] **Saldo pendiente** total.
- [ ] **Saldo pendiente de facturar**.
- [ ] Si es financiado: tabla de **cuotas** con estado (pagada / vencida / próxima).

### Detalle de saldo
- [ ] Tabla con cada pago: **fecha**, **qué pagó** ($ o US$), **TC del día**, **equivalente en US$**, **dónde y cómo** pagó, **saldo después del pago**.
- [ ] **Carpeta de comprobantes**: ver y descargar todos los comprobantes de la obra.
- [ ] Botón **"Detalle de saldo PDF"** para imprimir o mandar al cliente.

### Botones de cierre (separados)
- [ ] **"Saldo cobrado"**: solo se habilita cuando el saldo calculado es **0**.
- [ ] **"Pasar a Entregas"**: botón aparte, porque a veces está cobrado pero no se pasa por otro motivo. (Financiado: se habilita con contrato firmado, como ahora.)

### Que no desaparezca
- [ ] **Error actual**: cuando la obra termina de pagar y pasa a Entregas, **desaparece de Administración**. Tiene que quedar visible (por ejemplo, en una pestaña **"Cobradas / en entrega"** o con un filtro por estado).

### Checklist administrativo por obra
- [ ] Poner **rosa en la planilla** y **rojo en la carpeta**.
- [ ] Verificar que esté **agendado** / agendarlo.
- [ ] Enviar **planilla de compra, plano y condiciones**.
- [ ] Completar **detalle de compra**.
- [ ] Completar **detalle de saldo**.
- [ ] Si queda saldo pendiente, **enviar detalle de saldo** al cliente.
- [ ] Enviar **manual de mantenimiento**.
- [ ] Enviar **garantía**.
- [ ] ¿El cliente **confirmó el mail**? Sí / No.
- [ ] **Ingresar su pedido**.
- [ ] Si pagó por transferencia o depósito, **derivar el pago**.
- [ ] ¿Tiene **factura**? Sí / No:
  - Si **Sí** → campo **razón social** (y CUIT).
  - Si **No** → ¿transfirió a **W. MAX**, **Atlantis** u **otro**?
    - W. MAX o Atlantis → **pedir la factura**.
    - Otro → igual **pedir razón social**.
- [ ] ¿Pagó **percepciones**? Sí / No.
- [ ] **Agregar al calendario**.
- [ ] Agregar a planilla **"Caucho" o "Pádel pedidos"**.
- [ ] Agregar a planilla **"Clientes cerrados"**.

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

---

## ❓ Datos que tiene que pasar Juan

1. Cómo se calcula el **blanco**, por tipo de cancha y en **demarcación simple y doble**.
2. Lista de **modelos de césped por deporte**, con **kg de arena/m²** y **kg de caucho/m²** de cada uno.
3. **Fórmula de desperdicio** para bicolor.
4. Qué significan las tildes de **instalación, arena y caucho**: "incluido en el precio" o "la cancha lo lleva".
5. Lista inicial de **vendedores**, **revendedores** (con % de comisión), **proveedores con sus cuentas** y **cuentas propias**.
6. Cómo se reparte **IVA mínimo / IVA total** sobre el presupuesto (porcentaje o monto fijo).
7. Nombres exactos de las planillas de Drive ("rosa en la planilla", "Caucho", "Pádel pedidos", "Clientes cerrados") y dónde están.
