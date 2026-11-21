// Conexion a MySQL. Las credenciales NO van en el codigo (quedarian a la
// vista dentro del instalador): se ingresan una vez en la pantalla
// "Conectar base de datos" y main.js las guarda cifradas con la cuenta de
// Windows del equipo (ver leerConfigDb/guardarConfigDb en main.js).
const mysql = require('mysql2/promise');

let pool = null;

module.exports = {
  configurar({ host, port, user, password }) {
    if (pool) pool.end().catch(() => {});
    pool = mysql.createPool({
      host,
      port: Number(port) || 3306,
      user,
      password,
      database: 'pos',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
  },
  query: (...args) => pool.query(...args),
  getConnection: () => pool.getConnection()
};
