# Tu negocio POS

Sistema de punto de venta de escritorio para Windows, hecho con Electron y MySQL.
Pensado para cafeterías, restaurantes y pequeños negocios con impresora térmica.

## Funciones

### Primer arranque guiado
- Asistente de 4 pasos: logo, nombre y paleta de colores del negocio → conexión a MySQL → cuenta de administrador → impresora
- 5 paletas listas (Café, Océano, Bosque, Uva, Grafito) o colores a tu gusto
- El nombre y el logo del negocio aparecen en todas las pantallas, en la ventana y en las boletas
- La base de datos y sus tablas se crean solas; no hay usuarios ni contraseñas por defecto

### Ventas
- **Venta rápida:** productos agrupados por categoría, carrito, cliente y DNI opcionales
- **Mesas y barras:** plano con mesas y barras; cada pedido muestra el tiempo transcurrido y puede llevar observaciones (ej. "sin cebolla"). Los pedidos quedan guardados aunque se cierre la caja o el programa
- **Métodos de pago:** efectivo, tarjeta y Yape/Plin
- **Descuentos** en % en cualquier venta, que salen detallados en la boleta
- **Devoluciones:** anula una boleta de la caja actual y repone los insumos
- **Reimpresión** de cualquier boleta, marcada como copia
- Totales con IGV (18 %) y monto en letras ("SON: DOCE Y 00/100 SOLES")

### Caja
- Apertura con monto inicial y cierre con efectivo esperado, totales por método de pago y ticket de cierre
- Al cerrar avisa si quedan mesas sin cobrar
- Se puede abrir una caja nueva sin volver a iniciar sesión

### Fidelización de clientes
- Registro de clientes (nombre, apellidos, DNI, teléfono y correo)
- Cada cliente recibe un **código de barras EAN-13** propio que se puede descargar como imagen para imprimir su tarjeta
- Cada compra con la tarjeta suma un sello; **la compra número 10 lleva 50 % de descuento** y la tarjeta vuelve a empezar
- Aviso en pantalla cuando a un cliente le toca el descuento; el programa lo valida al cobrar, así que no se puede aplicar a mano

### Lector de código de barras
- Funciona con cualquier lector USB o inalámbrico que escriba como un teclado, sin configurar nada
- Lee la tarjeta del cliente aunque el cursor esté en otro campo: el programa distingue la velocidad del lector de la de una persona

### Ticketera (impresora térmica)
- Impresión directa en ESC/POS (modo RAW): el papel se corta justo donde termina la boleta
- Papel de **80 mm o 58 mm**
- Las ventas en efectivo se imprimen por el driver de Windows para que abra el **cajón de dinero**
- Boletas de venta, devolución, cierre de caja y resumen del día
- Botón de impresión de prueba para cada tipo de boleta, sin hacer ventas reales
- Impresora, tipo de letra, negrita y tamaño configurables desde el panel

### Inventario
- **Productos** con categoría y precio
- **Insumos** (materia prima en KG, LT o unidades) que se descuentan solos al vender según la **receta** de cada producto y se reponen al devolver
- Ajuste rápido del stock de insumos

### Administración
- Gestión de empleados: crear, desactivar/reactivar y cambiar su contraseña
- Ventas de cualquier día con calendario, total del día y resumen imprimible
- Cuenta del administrador con pregunta de seguridad para recuperar la contraseña

### Seguridad
- Contraseñas cifradas con bcrypt; bloqueo de 5 minutos tras 5 intentos fallidos
- Los permisos de administrador y empleado se validan en el programa, no solo en la pantalla
- Los precios y totales se calculan con los datos de la base, no con lo que envía la pantalla
- Datos de conexión a MySQL cifrados con la cuenta de Windows
- La versión instalada no tiene herramientas de desarrollador ni acceso a internet
- Varias PCs pueden usar la misma base de datos en red

## Requisitos

- Windows 10 u 11
- [Node.js](https://nodejs.org) 18 o superior (solo para compilar)
- MySQL 5.7+ o MariaDB. La forma más fácil es [XAMPP](https://www.apachefriends.org): instálalo y enciende el módulo **MySQL**.

## Desarrollo

```bash
npm install
npm start
```

## Compilar el instalador `.exe`

```bash
npm install
npm run build
```

El instalador queda en `dist/Tu negocio POS Setup 2.0.0.exe`. Es un instalador NSIS normal
(Siguiente → Instalar). Ese archivo es lo único que necesitas copiar a la PC del negocio.

Para cambiar el nombre del programa, la versión o el ícono antes de compilar, edita
`package.json`:

| Campo | Para qué sirve |
| --- | --- |
| `version` | Versión del instalador |
| `build.productName` | Nombre del programa y del instalador |
| `build.appId` | Identificador único (ej. `com.minegocio.pos`) |
| `build.win.icon` | Ícono del `.exe` (`build-icon.png`, PNG de 512×512) |

## Primer uso

La primera vez que abres el programa, un asistente de 4 pasos te guía. No hay usuarios ni
contraseñas por defecto.

1. **Tu negocio:** logo, nombre y paleta de colores. El nombre aparece en las pantallas y
   en las boletas.
2. **Base de datos:** servidor, puerto, usuario y contraseña de MySQL (con XAMPP:
   `localhost`, `3306`, `root` y contraseña vacía). La base y las tablas se crean solas.
3. **Administrador:** creas tu propia cuenta (nombre, usuario, contraseña y pregunta de
   seguridad para recuperarla).
4. **Impresora:** eliges la impresora térmica y el ancho del papel (80 mm o 58 mm), y puedes
   imprimir una prueba. Este paso se puede dejar para después.

Al terminar entras directo al panel de administrador. Ahí agregas productos, insumos y
empleados. La impresora y el formato de la boleta se cambian luego en **Boleta**.

### Volver a configurar

Los datos locales se guardan en `%APPDATA%\Tu negocio POS\`:

| Archivo | Qué contiene | Para resetearlo |
| --- | --- | --- |
| `negocio.json` | Nombre, logo y colores | Bórralo y vuelve a abrir el programa |
| `db.cfg` | Conexión a MySQL (cifrada) | Bórralo y vuelve a abrir el programa |

Si olvidas la contraseña del admin, usa **Olvidé mi contraseña** en el login (pide la
respuesta de seguridad). Si tampoco la recuerdas, ejecuta en MySQL
`DELETE FROM pos.usuarios WHERE rol = 'admin';` y abre el programa: vuelve a aparecer el
paso para crear el administrador.

## Base de datos

**No tienes que crear nada a mano.** Cuando ingresas los datos de MySQL y pulsas
**Conectar**, el programa:

1. Se conecta a MySQL.
2. Ejecuta [`db/schema.sql`](db/schema.sql): crea la base `pos` y todas sus tablas.
3. Si no hay ningún administrador, te lleva al paso para crearlo.

Esto se repite cada vez que abres el programa y es seguro: solo crea lo que falta, nunca
borra ni duplica datos. Así, si una versión nueva agrega tablas, se crean solas al abrirla.

Para comprobar que funcionó, abre phpMyAdmin (`http://localhost/phpmyadmin` con XAMPP):
debe aparecer la base `pos` con 10 tablas.

El usuario de MySQL que uses necesita permiso para crear la base `pos`. Con `root` de XAMPP
ya lo tiene. Si prefieres crear la base a mano, ejecuta `db/schema.sql` completo en
phpMyAdmin o MySQL Workbench.

Las recetas (cuánto insumo usa cada producto) se cargan en la tabla `recetas`:

```sql
INSERT INTO recetas (producto_id, insumo_id, cantidad) VALUES (1, 3, 0.150);
```

Recomendado: crea un usuario de MySQL solo para el programa en vez de usar `root`:

```sql
CREATE USER 'pos'@'localhost' IDENTIFIED BY 'una_clave_segura';
GRANT ALL PRIVILEGES ON pos.* TO 'pos'@'localhost';
```

Para usar varias PCs con la misma base, pon la IP de la PC con MySQL en **Servidor** y
permite conexiones remotas en MySQL.

## Impresión

Las boletas se envían como ESC/POS en modo RAW a la impresora elegida en **Boleta**
(o a la predeterminada de Windows). Las ventas en efectivo se imprimen por el driver de
Windows para que pueda abrir el cajón. El ancho del papel se elige en el primer arranque o
en **Boleta** (72 mm imprimibles = papel de 80 mm, 48 mm = papel de 58 mm). Si los montos
salen desalineados, ajusta `caracteresPorLinea` en `main.js` (42 y 32 caracteres).


## Problemas comunes

- **No conecta a la base de datos:** revisa que MySQL esté encendido (en XAMPP debe decir
  *Running*) y que el usuario tenga permisos para crear la base `pos`.
- **Pantalla en blanco:** ejecuta con `npm start` y abre la consola con `Ctrl+Shift+I`.
- **No imprime:** elige la impresora a mano en **Boleta**; la predeterminada de Windows
  suele ser una impresora virtual (PDF).
