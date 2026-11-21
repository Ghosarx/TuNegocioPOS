# Tu negocio POS

Sistema de punto de venta de escritorio para Windows, hecho con Electron y MySQL.
Pensado para cafeterías, restaurantes y pequeños negocios con impresora térmica.

## Funciones

**Administrador**
- Productos: agregar, editar precios y quitar
- Insumos: inventario de materia prima (KG / LT / UND) que se descuenta al vender según la receta de cada producto
- Empleados: crear, desactivar/reactivar y cambiar su contraseña
- Ventas por fecha con total del día y resumen imprimible
- Configuración de la boleta y de la impresora
- Cambio de contraseña y pregunta de seguridad propias

**Empleado**
- Apertura y cierre de caja con ticket de cierre
- Venta rápida con carrito, descuento en % y boleta
- Mesas y barras con pedidos abiertos y tiempo transcurrido
- Devoluciones y reimpresión de boletas de su caja
- Clientes con tarjeta de fidelidad por código de barras (la compra 10 lleva 50 % de descuento)

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

El instalador queda en `dist/Tu negocio POS Setup 1.0.0.exe`. Es un instalador NSIS normal
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

1. **Configuración inicial.** La primera vez que abres el programa aparece una pantalla para
   poner el **logo**, el **nombre del negocio** y la **paleta de colores**. Solo sale una vez.
   El nombre se usa en las pantallas y en las boletas.
2. **Conectar la base de datos.** Ingresa servidor, puerto, usuario y contraseña de MySQL
   (con XAMPP: `localhost`, `3306`, `root` y contraseña vacía). El programa crea solo la base
   `pos` y sus tablas. Los datos se guardan cifrados con tu cuenta de Windows.
3. **Ingresar como administrador** con:
   - usuario: `admin`
   - contraseña: `admin123`

   Al entrar se te obliga a cambiar la contraseña y la pregunta de seguridad.
4. Crea tus productos, insumos y empleados desde el panel de administrador.
5. En **Boleta**, elige la impresora térmica y usa **Imprimir prueba**.

### Volver a configurar

Los datos locales se guardan en `%APPDATA%\Tu negocio POS\`:

| Archivo | Qué contiene | Para resetearlo |
| --- | --- | --- |
| `negocio.json` | Nombre, logo y colores | Bórralo y vuelve a abrir el programa |
| `db.cfg` | Conexión a MySQL (cifrada) | Bórralo y vuelve a abrir el programa |

Si pierdes la contraseña del admin, ejecuta en MySQL
`DELETE FROM pos.usuarios WHERE usuario = 'admin';` y abre el programa: se vuelve a crear
`admin` / `admin123`.

## Base de datos

**No tienes que crear nada a mano.** Cuando ingresas los datos de MySQL y pulsas
**Conectar**, el programa:

1. Se conecta a MySQL.
2. Ejecuta [`db/schema.sql`](db/schema.sql): crea la base `pos` y todas sus tablas.
3. Crea el usuario `admin` / `admin123` si no existe.

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
Windows para que pueda abrir el cajón. Si los montos salen desalineados, ajusta
`ESCPOS_CARACTERES_POR_LINEA` en `main.js` (42 por defecto, para papel de 80 mm).

## Seguridad

- Contraseñas con bcrypt; bloqueo de 5 minutos tras 5 intentos fallidos.
- Los permisos por rol se validan en el proceso principal, no en la pantalla.
- La app instalada no tiene menú ni herramientas de desarrollador, y no navega a internet.

## Problemas comunes

- **No conecta a la base de datos:** revisa que MySQL esté encendido (en XAMPP debe decir
  *Running*) y que el usuario tenga permisos para crear la base `pos`.
- **Pantalla en blanco:** ejecuta con `npm start` y abre la consola con `Ctrl+Shift+I`.
- **No imprime:** elige la impresora a mano en **Boleta**; la predeterminada de Windows
  suele ser una impresora virtual (PDF).
