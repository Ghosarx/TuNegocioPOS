CREATE DATABASE IF NOT EXISTS pos CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE pos;

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  usuario VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  rol ENUM('admin','empleado') NOT NULL,
  pregunta_seguridad VARCHAR(255),
  respuesta_seguridad_hash VARCHAR(255),
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS productos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  categoria VARCHAR(80) NOT NULL,
  precio DECIMAL(10,2) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cajas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empleado_id INT NOT NULL,
  monto_inicial DECIMAL(10,2) NOT NULL,
  monto_final DECIMAL(10,2),
  total_ventas_efectivo DECIMAL(10,2) DEFAULT 0,
  total_ventas_tarjeta DECIMAL(10,2) DEFAULT 0,
  total_ventas_yape DECIMAL(10,2) DEFAULT 0,
  fecha_apertura DATETIME DEFAULT CURRENT_TIMESTAMP,
  fecha_cierre DATETIME,
  estado ENUM('abierta','cerrada') NOT NULL DEFAULT 'abierta',
  FOREIGN KEY (empleado_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS ventas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  caja_id INT NOT NULL,
  empleado_id INT NOT NULL,
  numero_boleta VARCHAR(30) NOT NULL,
  cliente VARCHAR(150),
  dni VARCHAR(20),
  subtotal DECIMAL(10,2) NOT NULL,
  descuento_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  igv DECIMAL(10,2) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  metodo_pago ENUM('Efectivo','Tarjeta','Yape/Plin') NOT NULL,
  estado ENUM('completada','devuelta') NOT NULL DEFAULT 'completada',
  fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
  fecha_devolucion DATETIME,
  INDEX idx_ventas_fecha (fecha),
  FOREIGN KEY (caja_id) REFERENCES cajas(id),
  FOREIGN KEY (empleado_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS venta_detalle (
  id INT AUTO_INCREMENT PRIMARY KEY,
  venta_id INT NOT NULL,
  producto_id INT NOT NULL,
  nombre_producto VARCHAR(150) NOT NULL,
  cantidad INT NOT NULL,
  precio_unitario DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (venta_id) REFERENCES ventas(id),
  FOREIGN KEY (producto_id) REFERENCES productos(id)
);

CREATE TABLE IF NOT EXISTS mesa_pedidos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mesa VARCHAR(30) NOT NULL,
  producto_id INT NOT NULL,
  nombre_producto VARCHAR(150) NOT NULL,
  precio DECIMAL(10,2) NOT NULL,
  observacion VARCHAR(200) NOT NULL DEFAULT '',
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mesa_pedidos_mesa (mesa),
  FOREIGN KEY (producto_id) REFERENCES productos(id)
);

CREATE TABLE IF NOT EXISTS clientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  apellidos VARCHAR(100) NOT NULL,
  telefono VARCHAR(30),
  correo VARCHAR(150),
  codigo_barras VARCHAR(64) NOT NULL UNIQUE,
  dni VARCHAR(20) UNIQUE,
  sellos INT NOT NULL DEFAULT 1,
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS insumos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  unidad ENUM('KG','LT','UND') NOT NULL,
  cantidad DECIMAL(12,4) NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recetas (
  producto_id INT NOT NULL,
  insumo_id INT NOT NULL,
  cantidad DECIMAL(12,4) NOT NULL,
  PRIMARY KEY (producto_id, insumo_id),
  FOREIGN KEY (producto_id) REFERENCES productos(id),
  FOREIGN KEY (insumo_id) REFERENCES insumos(id)
);

CREATE TABLE IF NOT EXISTS configuracion_boleta (
  id INT PRIMARY KEY DEFAULT 1,
  ancho_mm DECIMAL(5,1) NOT NULL DEFAULT 72.1,
  alto_mm DECIMAL(5,1) NOT NULL DEFAULT 297,
  fuente VARCHAR(60) NOT NULL DEFAULT 'Courier New',
  negrita TINYINT(1) NOT NULL DEFAULT 1,
  impresora_nombre VARCHAR(150)
);

INSERT IGNORE INTO configuracion_boleta (id) VALUES (1);
