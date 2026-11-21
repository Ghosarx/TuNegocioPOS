const { app, BrowserWindow, ipcMain, Menu, safeStorage, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const pool = require('./db/connection');

let mainWindow;
// Solo se cierra la app cuando el usuario confirma "Salir" desde la pantalla
// de login. El boton X del sistema operativo queda deshabilitado para evitar
// cierres accidentales en un punto de venta (ver ipcMain 'salir-app').
let permitirCierre = false;

// ---------- SESION Y PERMISOS ----------
// Quien inicio sesion lo guarda el proceso principal, no la pantalla: cada
// funcion de la base comprueba aqui el rol, y el id de usuario/caja sale de
// la sesion, nunca de lo que mande la pantalla (que se podria manipular).
let sesion = null; // { id, nombre, rol }

function requiere(rol, fn) {
  return async (e, data) => {
    if (!sesion || (rol && sesion.rol !== rol)) throw new Error('Sesión no válida. Vuelve a iniciar sesión.');
    return fn(e, data || {});
  };
}
const conSesion = (fn) => requiere(null, fn);
const soloAdmin = (fn) => requiere('admin', fn);
const soloEmpleado = (fn) => requiere('empleado', fn);

// Bloqueo tras varios intentos fallidos (login y recuperacion de contraseña).
const MAX_FALLOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000;
const fallos = new Map();

function segundosBloqueado(clave) {
  const f = fallos.get(clave);
  return f && f.hasta > Date.now() ? Math.ceil((f.hasta - Date.now()) / 1000) : 0;
}
function registrarFallo(clave) {
  const f = fallos.get(clave) || { n: 0, hasta: 0 };
  f.n += 1;
  if (f.n >= MAX_FALLOS) {
    f.n = 0;
    f.hasta = Date.now() + BLOQUEO_MS;
  }
  fallos.set(clave, f);
}
const mensajeBloqueo = (s) => `Demasiados intentos fallidos. Espera ${Math.ceil(s / 60)} minuto(s) e intenta de nuevo.`;

const PASSWORD_MIN = 6;
function errorPassword(p) {
  return typeof p === 'string' && p.length >= PASSWORD_MIN ? null : `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`;
}

// En Windows, despues de navegar a una pagina nueva o de usar dialogos
// nativos (confirm/prompt/alert), la ventana a veces pierde el foco de
// teclado a nivel de SO: los botones siguen respondiendo al clic, pero los
// <input> de texto no reciben el cursor hasta que se sale y se vuelve a
// entrar a la ventana. Un blur()+focus() fuerza exactamente ese mismo efecto
// sin que el usuario tenga que hacerlo a mano.
function reenfocarVentana() {
  if (!mainWindow) return;
  mainWindow.blur();
  mainWindow.focus();
}

function createWindow(pagina) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'src', 'assets', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // En la app instalada no se pueden abrir las herramientas de
      // desarrollador (desde ahi se podria llamar a cualquier funcion de la
      // base de datos sin iniciar sesion). Con "npm start" siguen disponibles.
      devTools: !app.isPackaged
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'src', pagina));

  // La ventana solo muestra las pantallas locales de la app: nada de abrir
  // ventanas nuevas ni navegar a paginas de internet (donde window.api
  // quedaria al alcance de un sitio externo).
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) e.preventDefault();
  });

  // Sin barra de menu tampoco hay atajo Ctrl+Shift+I: se agrega solo en desarrollo.
  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
        mainWindow.webContents.toggleDevTools();
      }
    });
  }

  // La primera carga (arranque de la app) se salta el reenfoque: la ventana
  // todavia no esta lista/visible y el blur()+focus() en ese momento hacia
  // que se viera como si se minimizara. Solo aplica en cargas posteriores
  // (navegar entre pantallas).
  let primeraCarga = true;
  mainWindow.webContents.on('did-finish-load', () => {
    if (primeraCarga) {
      primeraCarga = false;
      return;
    }
    reenfocarVentana();
  });

  mainWindow.on('close', (e) => {
    if (!permitirCierre) {
      e.preventDefault();
    }
  });
}

// ---------- CONEXION A LA BASE DE DATOS ----------
// Las credenciales de MySQL no van en el codigo del instalador: se guardan
// en %APPDATA%\<app>\db.cfg cifradas con safeStorage (DPAPI de Windows), asi
// que solo se pueden leer desde esta misma cuenta de Windows en este mismo
// equipo. Copiar el archivo o abrir los archivos de la app no las revela.
const archivoConfigDb = () => path.join(app.getPath('userData'), 'db.cfg');

function leerConfigDb() {
  try {
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(archivoConfigDb())));
  } catch (err) {
    return null;
  }
}

function guardarConfigDb(cfg) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado de Windows no está disponible en este equipo');
  fs.writeFileSync(archivoConfigDb(), safeStorage.encryptString(JSON.stringify(cfg)));
}

// Una vez conectada, la configuracion de la base ya no se puede cambiar
// desde las pantallas (evita que se redirija la app a otro servidor).
let bdConectada = false;

const archivoEsquema = () => app.isPackaged
  ? path.join(process.resourcesPath, 'db', 'schema.sql')
  : path.join(__dirname, 'db', 'schema.sql');

async function conectarBd(cfg) {
  const conn = await mysql.createConnection({ ...cfg, multipleStatements: true });
  try {
    await conn.query(fs.readFileSync(archivoEsquema(), 'utf8'));
  } finally {
    await conn.end();
  }
  pool.configurar(cfg);
  bdConectada = true;
  hayAdmin = await existeAdmin();
}

let hayAdmin = false;

async function existeAdmin() {
  const [rows] = await pool.query("SELECT id FROM usuarios WHERE rol = 'admin' AND activo = 1 LIMIT 1");
  return rows.length > 0;
}

// ---------- DATOS DEL NEGOCIO (nombre, logo y colores) ----------
// Se piden una sola vez, la primera vez que se abre la app. Para volver a
// configurarlos, borra negocio.json de la carpeta de datos de la app.
const archivoNegocio = () => path.join(app.getPath('userData'), 'negocio.json');

function leerNegocio() {
  try {
    return JSON.parse(fs.readFileSync(archivoNegocio(), 'utf8'));
  } catch (err) {
    return null;
  }
}

function ponerIconoNegocio() {
  const negocio = leerNegocio();
  if (mainWindow && negocio && negocio.logo) mainWindow.setIcon(nativeImage.createFromDataURL(negocio.logo));
}

const paginaInicial = () => {
  if (!leerNegocio()) return 'setup.html';
  if (!bdConectada) return 'config-db.html';
  return hayAdmin ? 'login.html' : 'inicio.html';
};

ipcMain.on('negocio', (e) => { e.returnValue = leerNegocio(); });

ipcMain.handle('negocio-guardar', (_e, { nombre, logo, colores }) => {
  if (leerNegocio()) return { ok: false, error: 'El negocio ya está configurado' };
  nombre = texto(nombre).slice(0, 60);
  if (!nombre) return { ok: false, error: 'Escribe el nombre de tu negocio' };
  if (logo && !(typeof logo === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(logo) && logo.length < 3e6)) {
    return { ok: false, error: 'El logo debe ser una imagen PNG, JPG, WEBP o GIF de menos de 2 MB' };
  }
  const claves = ['primary', 'accent', 'secondary', 'bg'];
  if (!colores || !claves.every(k => /^#[0-9a-f]{6}$/i.test(colores[k]))) return { ok: false, error: 'Paleta de colores inválida' };
  fs.writeFileSync(archivoNegocio(), JSON.stringify({
    nombre,
    logo: logo || null,
    colores: Object.fromEntries(claves.map(k => [k, colores[k]]))
  }));
  ponerIconoNegocio();
  mainWindow.loadFile(path.join(__dirname, 'src', paginaInicial()));
  return { ok: true };
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); // quita la barra File/Edit/View/Window/Help
  const cfg = leerConfigDb();
  if (cfg) {
    try {
      await conectarBd(cfg);
    } catch (err) {
      console.error('No se pudo conectar con la configuracion guardada.', err);
    }
  }
  createWindow(paginaInicial());
  ponerIconoNegocio();
});

// Para la pantalla de configuracion: datos guardados, sin la contraseña.
ipcMain.handle('db-config-guardada', () => {
  if (bdConectada) return null;
  const cfg = leerConfigDb();
  return cfg ? { host: cfg.host, port: cfg.port, user: cfg.user } : null;
});

ipcMain.handle('db-configurar', async (_e, { host, port, user, password }) => {
  if (bdConectada) return { ok: false, error: 'La base de datos ya está configurada' };
  const guardada = leerConfigDb();
  // Contraseña vacia = reintentar con la guardada, pero solo contra el mismo
  // servidor/usuario: si no, se le podria mandar la clave a otro servidor.
  if (!password && guardada && guardada.host === host && String(guardada.port) === String(port) && guardada.user === user) {
    password = guardada.password;
  }
  const cfg = { host, port: Number(port) || 3306, user, password: password || '' };
  try {
    await conectarBd(cfg);
    guardarConfigDb(cfg);
  } catch (err) {
    bdConectada = false;
    return { ok: false, error: err.message };
  }
  mainWindow.loadFile(path.join(__dirname, 'src', paginaInicial()));
  return { ok: true };
});

ipcMain.on('refocus-ventana', () => {
  reenfocarVentana();
});

// ---------- IMPRESION (ESC/POS crudo, sin pasar por el sistema de paginas) ----------
// Se manda texto plano + comandos ESC/POS directo a la impresora (bytes
// crudos), en vez de pedirle a Windows que imprima una "pagina" de HTML.
// Asi el corte del papel lo decide la propia impresora segun el contenido
// real que se le manda (un comando de corte al final), sin depender de que
// el driver respete ningun tamaño de pagina - que es justo lo que fallaba
// con window.print()/webContents.print().
//
// Caracteres por linea segun el ancho imprimible (72 mm en papel de 80 mm,
// 48 mm en papel de 58 mm) con la fuente por defecto de la impresora. Si el
// texto sale desalineado, ajusta estos numeros.
const caracteresPorLinea = (anchoMm) => (anchoMm < 60 ? 32 : 42);

const ESC = 0x1B;
const GS = 0x1D;

// Pagina de codigos PC437 (la 0, la de fabrica en casi todas las termicas):
// ahi la ñ y las vocales con tilde tienen su propio byte. Lo que no esta en
// la tabla se imprime sin tilde (Á -> A) en vez de salir como basura.
const CP437 = { 'ñ': 0xA4, 'Ñ': 0xA5, 'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3, 'ü': 0x81, 'Ü': 0x9A, 'É': 0x90 };

function textoACp437(texto) {
  return Buffer.from([...texto].map(c => {
    if (CP437[c]) return CP437[c];
    const base = c.normalize('NFD').charCodeAt(0);
    return base < 0x80 ? base : 0x3F; // '?'
  }));
}

function construirBufferEscPos(lineas, anchoChars) {
  const partes = [Buffer.from([ESC, 0x40]), Buffer.from([ESC, 0x74, 0])]; // inicializar + PC437

  function alinear(a) {
    const n = a === 'center' ? 1 : a === 'right' ? 2 : 0;
    partes.push(Buffer.from([ESC, 0x61, n]));
  }
  function negrita(on) {
    partes.push(Buffer.from([ESC, 0x45, on ? 1 : 0]));
  }
  function escribir(texto) {
    partes.push(textoACp437(String(texto) + '\n'));
  }

  for (const linea of (lineas || [])) {
    if (linea.t === 'sep') {
      alinear('left');
      negrita(false);
      escribir('='.repeat(anchoChars));
    } else if (linea.t === 'blank') {
      escribir('');
    } else if (linea.t === 'big') {
      // Doble alto y doble ancho (GS ! 0x11): entra la mitad de caracteres
      // por linea, asi que se corta por palabras para no partirlas.
      alinear('left');
      negrita(true);
      partes.push(Buffer.from([GS, 0x21, 0x11]));
      const max = Math.floor(anchoChars / 2);
      let actual = '';
      for (const palabra of String(linea.text).split(/\s+/).filter(Boolean)) {
        if (actual && (actual + ' ' + palabra).length > max) { escribir(actual); actual = ''; }
        actual = actual ? actual + ' ' + palabra : palabra;
      }
      if (actual) escribir(actual);
      partes.push(Buffer.from([GS, 0x21, 0x00]));
    } else if (linea.t === 'row') {
      alinear('left');
      negrita(!!linea.bold);
      let izq = String(linea.left);
      const der = String(linea.right);
      if (izq.length + der.length >= anchoChars) {
        izq = izq.slice(0, Math.max(0, anchoChars - der.length - 1));
      }
      const espacio = Math.max(1, anchoChars - izq.length - der.length);
      escribir(izq + ' '.repeat(espacio) + der);
    } else {
      alinear(linea.t === 'center' ? 'center' : (linea.align || 'left'));
      negrita(!!linea.bold);
      escribir(linea.text);
    }
  }

  // El cuchillo del cortador esta un poco mas abajo del cabezal de
  // impresion: si no avanza suficiente papel antes de cortar, el corte cae
  // encima de las ultimas lineas de texto en vez de despues de ellas.
  partes.push(Buffer.from('\n\n\n\n\n\n', 'ascii'));
  partes.push(Buffer.from([GS, 0x56, 0x00])); // corte total

  return Buffer.concat(partes);
}

// Usa la impresora elegida por el admin en Configuracion de boleta si hay
// una guardada; si no, cae a la predeterminada de Windows. Es importante
// poder elegirla a mano: en muchas instalaciones no hay ninguna impresora
// marcada como predeterminada en Windows, y ademas suele haber varias
// impresoras/virtuales instaladas (PDF, RustDesk, etc.) que no son la
// termica real - dejar que Windows "adivine" cual usar no es confiable.
async function obtenerImpresora() {
  const impresoras = await mainWindow.webContents.getPrintersAsync();
  let ancho = 72.1;
  try {
    const [[config]] = await pool.query('SELECT impresora_nombre, ancho_mm FROM configuracion_boleta WHERE id = 1');
    if (config) ancho = Number(config.ancho_mm) || ancho;
    if (config && config.impresora_nombre) {
      // Si la guardada ya no existe (se desinstalo o se renombro), mandar a
      // otra seria adivinar: mejor avisar para que el admin elija la correcta.
      if (!impresoras.some(p => p.name === config.impresora_nombre)) {
        throw new Error(`La impresora configurada "${config.impresora_nombre}" ya no existe en este equipo. Elige la impresora térmica en Configuración de boleta (panel de administrador).`);
      }
      return { nombre: config.impresora_nombre, ancho };
    }
  } catch (err) {
    if (err.message.startsWith('La impresora configurada')) throw err;
    console.error('No se pudo leer la impresora configurada, se intentara con la predeterminada.', err);
  }
  const predeterminada = impresoras.find(p => p.isDefault);
  const nombre = (predeterminada || impresoras[0] || {}).name;
  return nombre ? { nombre, ancho } : null;
}

ipcMain.handle('listar-impresoras', soloAdmin(async () => {
  if (!mainWindow) return [];
  const impresoras = await mainWindow.webContents.getPrintersAsync();
  return impresoras.map(p => ({ name: p.name, isDefault: !!p.isDefault }));
}));

// Manda los bytes tal cual (datatype "RAW") a la cola de impresion de
// Windows, usando la API winspool.drv (OpenPrinter/StartDocPrinter con
// pDataType="RAW"/WritePrinter) via un mini programa C# embebido en
// PowerShell. Esto es lo que de verdad manda los bytes sin que el driver de
// la impresora los reinterprete.
//
// Antes se uso PosPrinter.sendRawCommand() de electron-pos-printer, que por
// dentro usa System.Printing.PrintQueue.AddJob(): la documentacion de
// Microsoft para ese metodo dice literalmente "This code only works with
// printers that can detect and print plain text. Some of them cannot" - y
// el driver POS-80 es de los que no puede: el trabajo se marcaba como
// completado sin error, pero no imprimia nada. WriteRaw con datatype "RAW"
// si funciona (probado).
function enviarBytesCrudosAImpresora(printerName, buffer) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `boleta_raw_${Date.now()}_${Math.round(Math.random() * 1e6)}.bin`);
    try {
      fs.writeFileSync(tmpFile, buffer);
    } catch (err) {
      reject(err);
      return;
    }

    const tmpFilePs = tmpFile.replace(/\\/g, '/');
    const printerNamePs = printerName.replace(/'/g, "''");
    const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }
    [DllImport("winspool.drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, DOCINFOA di);
    [DllImport("winspool.drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static bool SendBytesToPrinter(string szPrinterName, byte[] bytes, out string err) {
        IntPtr hPrinter;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "Boleta";
        di.pDataType = "RAW";
        bool success = false;
        err = "";
        if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
            if (StartDocPrinter(hPrinter, 1, di)) {
                if (StartPagePrinter(hPrinter)) {
                    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                    int dwWritten;
                    success = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                    EndPagePrinter(hPrinter);
                } else { err = "StartPagePrinter failed: " + Marshal.GetLastWin32Error(); }
                EndDocPrinter(hPrinter);
            } else { err = "StartDocPrinter failed: " + Marshal.GetLastWin32Error(); }
            ClosePrinter(hPrinter);
        } else { err = "OpenPrinter failed: " + Marshal.GetLastWin32Error(); }
        return success;
    }
}
"@
$bytes = [System.IO.File]::ReadAllBytes('${tmpFilePs}')
$err = ""
$ok = [RawPrinterHelper]::SendBytesToPrinter('${printerNamePs}', $bytes, [ref]$err)
if (-not $ok) { Write-Error $err; exit 1 }
`;

    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { shell: false });
    let stderr = '';
    ps.stderr.on('data', (d) => { stderr += d.toString(); });
    ps.on('close', (code) => {
      try { fs.unlinkSync(tmpFile); } catch (err) { /* no pasa nada si no se pudo borrar */ }
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `powershell termino con codigo ${code}`));
    });
    ps.on('error', reject);
  });
}

// Impresion por el driver de Windows (no RAW): se usa solo para ventas en
// efectivo, asi el driver aplica sus opciones (p. ej. abrir el cajon). La
// pagina mide lo mismo que el contenido para que el corte caiga al final.
function lineasAHtml(lineas, anchoMm) {
  const e = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const filas = (lineas || []).map(l => {
    const b = l.bold ? 'font-weight:bold;' : '';
    if (l.t === 'sep') return '<div style="border-top:1px dashed #000;margin:4px 0"></div>';
    if (l.t === 'blank') return '<div>&nbsp;</div>';
    if (l.t === 'big') return `<div style="font-size:2em;font-weight:bold">${e(l.text)}</div>`;
    if (l.t === 'row') return `<div style="display:flex;justify-content:space-between;gap:8px;${b}"><span>${e(l.left)}</span><span>${e(l.right)}</span></div>`;
    const a = l.t === 'center' ? 'center' : (l.align === 'right' ? 'right' : 'left');
    return `<div style="text-align:${a};${b}">${e(l.text)}</div>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:0 2mm;width:${anchoMm}mm;box-sizing:border-box;font:11px 'Courier New',monospace;color:#000">${filas}</body>`;
}

async function imprimirConWindows(deviceName, lineas, anchoMm) {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(lineasAHtml(lineas, anchoMm)));
    const altoPx = await win.webContents.executeJavaScript('document.body.scrollHeight');
    await new Promise((resolve, reject) => win.webContents.print({
      silent: true,
      deviceName,
      margins: { marginType: 'none' },
      pageSize: { width: Math.round((anchoMm + 8) * 1000), height: Math.ceil(altoPx * 25400 / 96) + 15000 } // micras; +15mm para el cortador
    }, (ok, motivo) => (ok ? resolve() : reject(new Error('Windows no pudo imprimir: ' + motivo)))));
  } finally {
    win.destroy();
  }
}

ipcMain.handle('imprimir-boleta', conSesion(async (_e, { lineas, porWindows }) => {
  try {
    if (!mainWindow) return { ok: false, error: 'No hay ventana' };
    const impresora = await obtenerImpresora();
    if (!impresora) return { ok: false, error: 'No se encontró ninguna impresora' };
    if (porWindows) {
      await imprimirConWindows(impresora.nombre, lineas, impresora.ancho);
      return { ok: true };
    }
    const buffer = construirBufferEscPos(lineas, caracteresPorLinea(impresora.ancho));
    await enviarBytesCrudosAImpresora(impresora.nombre, buffer);
    return { ok: true };
  } catch (err) {
    console.error('Error al imprimir boleta.', err);
    return { ok: false, error: err.message };
  }
}));

ipcMain.on('salir-app', () => {
  permitirCierre = true;
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Descuenta (signo -1, al vender) o repone (signo 1, al devolver) los
// insumos de cada linea segun su receta. Puede quedar en negativo a
// proposito: asi el admin ve que se vendio mas de lo que habia registrado.
async function moverInsumos(conn, lineas, signo) {
  for (const l of lineas) {
    await conn.query(
      'UPDATE insumos i JOIN recetas r ON r.insumo_id = i.id SET i.cantidad = i.cantidad + ? * r.cantidad WHERE r.producto_id = ?',
      [signo * l.qty, l.id]
    );
  }
}

function boletaNumero(id) {
  return 'B001-' + String(id).padStart(6, '0');
}

const texto = (v) => (typeof v === 'string' ? v.trim() : '');

// ---------- PRIMER ARRANQUE: crear el administrador ----------
// Solo funciona mientras no exista ningun admin; deja la sesion iniciada para
// seguir con la configuracion de la impresora.
ipcMain.handle('admin-inicial-crear', async (_e, { nombre, usuario, password, pregunta, respuesta }) => {
  if (!bdConectada) return { ok: false, error: 'Primero conecta la base de datos' };
  if (await existeAdmin()) return { ok: false, error: 'Ya existe un administrador' };
  if (!texto(nombre) || !texto(usuario)) return { ok: false, error: 'Completa tu nombre y el usuario' };
  const errPass = errorPassword(password);
  if (errPass) return { ok: false, error: errPass };
  if (!texto(pregunta) || texto(respuesta).length < 3) return { ok: false, error: 'Completa la pregunta y una respuesta de al menos 3 caracteres' };
  const [existe] = await pool.query('SELECT id FROM usuarios WHERE usuario = ?', [texto(usuario)]);
  if (existe.length > 0) return { ok: false, error: 'Ese nombre de usuario ya existe' };
  const [result] = await pool.query(
    `INSERT INTO usuarios (nombre, usuario, password_hash, rol, pregunta_seguridad, respuesta_seguridad_hash, activo)
     VALUES (?, ?, ?, 'admin', ?, ?, 1)`,
    [texto(nombre), texto(usuario), await bcrypt.hash(password, 10), texto(pregunta), await bcrypt.hash(texto(respuesta).toLowerCase(), 10)]
  );
  hayAdmin = true;
  sesion = { id: result.insertId, nombre: texto(nombre), rol: 'admin' };
  return { ok: true, user: { id: result.insertId, nombre: texto(nombre), usuario: texto(usuario), rol: 'admin' } };
});

// ---------- LOGIN ----------
ipcMain.handle('login', async (_e, { usuario, password }) => {
  const clave = 'login:' + texto(usuario).toLowerCase();
  const espera = segundosBloqueado(clave);
  if (espera) return { ok: false, error: mensajeBloqueo(espera) };
  const [rows] = await pool.query('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1', [texto(usuario)]);
  const user = rows[0];
  // Mismo mensaje exista o no el usuario, para no revelar que usuarios hay.
  if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash))) {
    registrarFallo(clave);
    return { ok: false, error: 'Usuario o contraseña incorrectos' };
  }
  fallos.delete(clave);
  sesion = { id: user.id, nombre: user.nombre, rol: user.rol };
  return {
    ok: true,
    user: { id: user.id, nombre: user.nombre, usuario: user.usuario, rol: user.rol }
  };
});

ipcMain.handle('logout', () => {
  sesion = null;
});

// La recuperacion por pregunta de seguridad solo aplica al rol admin.
// Los empleados no tienen pregunta de seguridad: si olvidan su contraseña,
// el administrador se la cambia desde el panel de Empleados.
ipcMain.handle('obtener-pregunta-seguridad', async (_e, { usuario }) => {
  const [rows] = await pool.query('SELECT rol, pregunta_seguridad FROM usuarios WHERE usuario = ?', [texto(usuario)]);
  if (rows.length === 0) return { ok: false, error: 'Usuario no encontrado' };
  if (rows[0].rol !== 'admin') {
    return { ok: false, error: 'Los empleados no tienen pregunta de seguridad. Pide al administrador que te cambie la contraseña desde el panel de Empleados.' };
  }
  return { ok: true, pregunta: rows[0].pregunta_seguridad };
});

ipcMain.handle('recuperar-password', async (_e, { usuario, respuesta, nuevaPassword }) => {
  const clave = 'recuperar:' + texto(usuario).toLowerCase();
  const espera = segundosBloqueado(clave);
  if (espera) return { ok: false, error: mensajeBloqueo(espera) };
  const errPass = errorPassword(nuevaPassword);
  if (errPass) return { ok: false, error: errPass };
  const [[user]] = await pool.query("SELECT * FROM usuarios WHERE usuario = ? AND rol = 'admin'", [texto(usuario)]);
  if (!user || !user.respuesta_seguridad_hash) return { ok: false, error: 'Usuario no encontrado' };
  if (!(await bcrypt.compare(texto(respuesta).toLowerCase(), user.respuesta_seguridad_hash))) {
    registrarFallo(clave);
    return { ok: false, error: 'Respuesta de seguridad incorrecta' };
  }
  fallos.delete(clave);
  const nuevoHash = await bcrypt.hash(nuevaPassword, 10);
  await pool.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [nuevoHash, user.id]);
  return { ok: true };
});

// "Mi cuenta" del admin: cambia la contraseña y/o la pregunta de seguridad.
ipcMain.handle('cambiar-password-propia', soloAdmin(async (_e, { passwordActual, nuevaPassword, pregunta, respuesta }) => {
  const [[user]] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [sesion.id]);
  if (!user || !(await bcrypt.compare(String(passwordActual || ''), user.password_hash))) {
    return { ok: false, error: 'Contraseña actual incorrecta' };
  }
  const cambiaPassword = !!nuevaPassword;
  const cambiaPregunta = !!(texto(pregunta) || texto(respuesta));
  if (!cambiaPassword && !cambiaPregunta) return { ok: false, error: 'No hay nada que cambiar' };

  if (cambiaPassword) {
    const errPass = errorPassword(nuevaPassword);
    if (errPass) return { ok: false, error: errPass };
  }
  if (cambiaPregunta) {
    if (!texto(pregunta) || texto(respuesta).length < 3) return { ok: false, error: 'Completa la pregunta y una respuesta de al menos 3 caracteres' };
  }

  if (cambiaPassword) {
    await pool.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [await bcrypt.hash(nuevaPassword, 10), sesion.id]);
  }
  if (cambiaPregunta) {
    await pool.query(
      'UPDATE usuarios SET pregunta_seguridad = ?, respuesta_seguridad_hash = ? WHERE id = ?',
      [texto(pregunta), await bcrypt.hash(texto(respuesta).toLowerCase(), 10), sesion.id]
    );
  }
  return { ok: true };
}));

// ---------- INVENTARIO (admin: crear/editar/eliminar, empleado: solo lectura) ----------
function errorProducto(nombre, categoria, precio) {
  if (!texto(nombre) || !texto(categoria)) return 'Completa nombre y categoría';
  if (!(Number(precio) >= 0)) return 'Precio inválido';
  return null;
}

ipcMain.handle('inventario-listar', conSesion(async () => {
  const [rows] = await pool.query('SELECT * FROM productos WHERE activo = 1 ORDER BY categoria, nombre');
  return rows;
}));

ipcMain.handle('inventario-agregar', soloAdmin(async (_e, { nombre, categoria, precio }) => {
  const err = errorProducto(nombre, categoria, precio);
  if (err) return { ok: false, error: err };
  const [result] = await pool.query(
    'INSERT INTO productos (nombre, categoria, precio) VALUES (?, ?, ?)',
    [texto(nombre), texto(categoria), Number(precio)]
  );
  return { ok: true, id: result.insertId };
}));

ipcMain.handle('inventario-actualizar', soloAdmin(async (_e, { id, nombre, categoria, precio }) => {
  const err = errorProducto(nombre, categoria, precio);
  if (err) return { ok: false, error: err };
  await pool.query(
    'UPDATE productos SET nombre = ?, categoria = ?, precio = ? WHERE id = ?',
    [texto(nombre), texto(categoria), Number(precio), id]
  );
  return { ok: true };
}));

ipcMain.handle('inventario-eliminar', soloAdmin(async (_e, { id }) => {
  await pool.query('UPDATE productos SET activo = 0 WHERE id = ?', [id]);
  return { ok: true };
}));

// ---------- EMPLEADOS (solo admin) ----------
ipcMain.handle('empleados-listar', soloAdmin(async () => {
  const [rows] = await pool.query(
    "SELECT id, nombre, usuario, rol, activo, creado_en FROM usuarios WHERE rol = 'empleado' ORDER BY nombre"
  );
  return rows;
}));

// Los empleados no usan pregunta de seguridad (eso es solo para el admin).
ipcMain.handle('empleados-crear', soloAdmin(async (_e, { nombre, usuario, password }) => {
  if (!texto(nombre) || !texto(usuario)) return { ok: false, error: 'Completa todos los campos' };
  const errPass = errorPassword(password);
  if (errPass) return { ok: false, error: errPass };
  const [existe] = await pool.query('SELECT id FROM usuarios WHERE usuario = ?', [texto(usuario)]);
  if (existe.length > 0) return { ok: false, error: 'Ese nombre de usuario ya existe' };
  const passHash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    `INSERT INTO usuarios (nombre, usuario, password_hash, rol, activo)
     VALUES (?, ?, ?, 'empleado', 1)`,
    [texto(nombre), texto(usuario), passHash]
  );
  return { ok: true, id: result.insertId };
}));

// Solo sobre empleados: el admin no puede desactivarse a si mismo por aqui.
ipcMain.handle('empleados-desactivar', soloAdmin(async (_e, { id }) => {
  await pool.query("UPDATE usuarios SET activo = 0 WHERE id = ? AND rol = 'empleado'", [id]);
  return { ok: true };
}));

ipcMain.handle('empleados-reactivar', soloAdmin(async (_e, { id }) => {
  await pool.query("UPDATE usuarios SET activo = 1 WHERE id = ? AND rol = 'empleado'", [id]);
  return { ok: true };
}));

// El admin cambia la contraseña de un empleado directamente (sin pedir la actual).
ipcMain.handle('empleados-cambiar-password', soloAdmin(async (_e, { id, nuevaPassword }) => {
  const errPass = errorPassword(nuevaPassword);
  if (errPass) return { ok: false, error: errPass };
  const [rows] = await pool.query("SELECT id FROM usuarios WHERE id = ? AND rol = 'empleado'", [id]);
  if (rows.length === 0) return { ok: false, error: 'Empleado no encontrado' };
  const nuevoHash = await bcrypt.hash(nuevaPassword, 10);
  await pool.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [nuevoHash, id]);
  return { ok: true };
}));

// ---------- CAJA (siempre la del empleado con sesion iniciada) ----------
async function cajaAbiertaDeSesion() {
  const [[caja]] = await pool.query(
    "SELECT * FROM cajas WHERE empleado_id = ? AND estado = 'abierta' LIMIT 1",
    [sesion.id]
  );
  return caja || null;
}

ipcMain.handle('caja-abrir', soloEmpleado(async (_e, { montoInicial }) => {
  const monto = Number(montoInicial);
  if (!(monto >= 0)) return { ok: false, error: 'Ingresa un monto válido' };
  const abierta = await cajaAbiertaDeSesion();
  if (abierta) return { ok: true, cajaId: abierta.id, yaEstabaAbierta: true };
  const [result] = await pool.query(
    'INSERT INTO cajas (empleado_id, monto_inicial) VALUES (?, ?)',
    [sesion.id, monto]
  );
  return { ok: true, cajaId: result.insertId, yaEstabaAbierta: false };
}));

ipcMain.handle('caja-cerrar', soloEmpleado(async () => {
  const caja = await cajaAbiertaDeSesion();
  if (!caja) return { ok: false, error: 'No tienes una caja abierta' };
  const [[totales]] = await pool.query(
    `SELECT
      COALESCE(SUM(CASE WHEN metodo_pago = 'Efectivo' THEN total ELSE 0 END), 0) AS efectivo,
      COALESCE(SUM(CASE WHEN metodo_pago = 'Tarjeta' THEN total ELSE 0 END), 0) AS tarjeta,
      COALESCE(SUM(CASE WHEN metodo_pago = 'Yape/Plin' THEN total ELSE 0 END), 0) AS yape,
      COUNT(*) AS numVentas
     FROM ventas WHERE caja_id = ? AND estado = 'completada'`,
    [caja.id]
  );
  const montoFinal = Number(caja.monto_inicial) + Number(totales.efectivo);
  await pool.query(
    `UPDATE cajas SET estado = 'cerrada', fecha_cierre = NOW(),
     monto_final = ?, total_ventas_efectivo = ?, total_ventas_tarjeta = ?, total_ventas_yape = ?
     WHERE id = ?`,
    [montoFinal, totales.efectivo, totales.tarjeta, totales.yape, caja.id]
  );
  return {
    ok: true,
    resumen: {
      montoInicial: Number(caja.monto_inicial),
      efectivo: Number(totales.efectivo),
      tarjeta: Number(totales.tarjeta),
      yape: Number(totales.yape),
      montoFinal,
      numVentas: totales.numVentas,
      fechaApertura: caja.fecha_apertura
    }
  };
}));

ipcMain.handle('caja-estado', soloEmpleado(async () => {
  const caja = await cajaAbiertaDeSesion();
  return { abierta: !!caja, caja };
}));

// ---------- VENTAS ----------
const METODOS_PAGO = ['Efectivo', 'Tarjeta', 'Yape/Plin'];
const SELLOS_TARJETA = 10;
const DESCUENTO_CUPON = 50;

// ---------- CLIENTES (tarjeta de fidelidad) ----------
ipcMain.handle('clientes-listar', soloEmpleado(async () => {
  const [rows] = await pool.query('SELECT * FROM clientes ORDER BY nombre, apellidos');
  return rows;
}));

ipcMain.handle('clientes-crear', soloEmpleado(async (_e, { nombre, apellidos, dni, telefono, correo, codigo }) => {
  if (!texto(nombre) || !texto(apellidos) || !texto(dni)) return { ok: false, error: 'Completa nombre, apellidos y DNI' };
  if (!texto(codigo)) return { ok: false, error: 'Genera el código de barras del cliente' };
  try {
    await pool.query(
      'INSERT INTO clientes (nombre, apellidos, dni, telefono, correo, codigo_barras) VALUES (?, ?, ?, ?, ?, ?)',
      [texto(nombre).slice(0, 100), texto(apellidos).slice(0, 100), texto(dni).slice(0, 20), texto(telefono).slice(0, 30) || null, texto(correo).slice(0, 150) || null, texto(codigo).slice(0, 64)]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return { ok: false, error: /dni/i.test(err.sqlMessage) ? 'Ya hay un cliente registrado con ese DNI' : 'Ese código de barras ya existe: genera otro' };
    }
    throw err;
  }
  return { ok: true };
}));

ipcMain.handle('cliente-buscar', soloEmpleado(async (_e, { codigo }) => {
  const [[cli]] = await pool.query('SELECT * FROM clientes WHERE codigo_barras = ?', [texto(codigo)]);
  return cli ? { ok: true, cliente: cli, cupon: cli.sellos >= SELLOS_TARJETA - 1 } : { ok: false, error: 'No hay ningún cliente con ese código' };
}));

// Todo en una transaccion: si algo falla a mitad (p. ej. se cae MySQL), no
// queda una boleta registrada sin sus productos o con numero 'PENDIENTE'.
//
// Los precios y totales los calcula este proceso con lo que hay en la base:
// la pantalla solo dice que productos y cuantos (venta rapida) o que pedidos
// de mesa se cobran (mesaPedidoIds). Asi nadie puede registrar una venta con
// precios o totales inventados. Devuelve los items/totales finales para
// imprimir la boleta exactamente con lo que se guardo.
ipcMain.handle('venta-registrar', soloEmpleado(async (_e, { cliente, dni, items, metodoPago, descuentoPct, mesaPedidoIds, codigoCliente }) => {
  let pct = Number(descuentoPct) || 0;
  if (!(pct >= 0 && pct <= 100)) return { ok: false, error: 'El descuento debe estar entre 0 y 100%' };
  if (!METODOS_PAGO.includes(metodoPago)) return { ok: false, error: 'Método de pago inválido' };
  const caja = await cajaAbiertaDeSesion();
  if (!caja) return { ok: false, error: 'No tienes una caja abierta' };

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let lineas;

    if (Array.isArray(mesaPedidoIds) && mesaPedidoIds.length > 0) {
      const [pedidos] = await conn.query('SELECT * FROM mesa_pedidos WHERE id IN (?) FOR UPDATE', [mesaPedidoIds]);
      // Otra caja ya cobro (o quito) algun pedido de esta mesa: no cobrar dos veces.
      if (pedidos.length !== mesaPedidoIds.length) {
        await conn.rollback();
        return { ok: false, error: 'Los pedidos de esta mesa cambiaron (otra caja los cobró o quitó). Revisa la mesa e intenta de nuevo.' };
      }
      await conn.query('DELETE FROM mesa_pedidos WHERE id IN (?)', [mesaPedidoIds]);
      // Una linea por producto y precio (si el precio cambio entre pedidos, quedan separadas).
      const agrupados = new Map();
      pedidos.forEach(p => {
        const k = `${p.producto_id}|${p.precio}`;
        if (!agrupados.has(k)) agrupados.set(k, { id: p.producto_id, name: p.nombre_producto, price: Number(p.precio), qty: 0 });
        agrupados.get(k).qty += 1;
      });
      lineas = [...agrupados.values()];
    } else {
      if (!Array.isArray(items) || items.length === 0) {
        await conn.rollback();
        return { ok: false, error: 'Agrega al menos un producto' };
      }
      const [productos] = await conn.query('SELECT id, nombre, precio FROM productos WHERE activo = 1 AND id IN (?)', [items.map(i => Number(i.id))]);
      lineas = items.map(i => {
        const p = productos.find(prod => prod.id === Number(i.id));
        const qty = Number(i.qty);
        return p && Number.isInteger(qty) && qty > 0 ? { id: p.id, name: p.nombre, price: Number(p.precio), qty } : null;
      });
      if (lineas.includes(null)) {
        await conn.rollback();
        return { ok: false, error: 'Algún producto ya no está disponible o la cantidad no es válida. Revisa el pedido.' };
      }
    }

    // Tarjeta de fidelidad: cada boleta suma 1 sello; la compra que llena la
    // tarjeta (la 10.a) lleva 50% y la tarjeta vuelve a 0. Se decide aqui y
    // no en la pantalla, para que nadie se ponga el cupon a mano.
    let nombreCliente = texto(cliente) || null;
    let cupon = false;
    let sellos = null;
    if (texto(codigoCliente)) {
      const [[cli]] = await conn.query('SELECT * FROM clientes WHERE codigo_barras = ? FOR UPDATE', [texto(codigoCliente)]);
      if (!cli) {
        await conn.rollback();
        return { ok: false, error: 'La tarjeta de cliente no está registrada' };
      }
      cupon = cli.sellos >= SELLOS_TARJETA - 1;
      if (cupon) pct = Math.max(pct, DESCUENTO_CUPON);
      sellos = cupon ? 0 : cli.sellos + 1;
      await conn.query('UPDATE clientes SET sellos = ? WHERE id = ?', [sellos, cli.id]);
      nombreCliente = `${cli.nombre} ${cli.apellidos}`;
    }

    const bruto = lineas.reduce((s, l) => s + l.price * l.qty, 0);
    const total = Math.round(bruto * (1 - pct / 100) * 100) / 100;
    const subtotal = total / 1.18;
    const igv = total - subtotal;

    const [result] = await conn.query(
      `INSERT INTO ventas (caja_id, empleado_id, numero_boleta, cliente, dni, subtotal, descuento_pct, igv, total, metodo_pago)
       VALUES (?, ?, 'PENDIENTE', ?, ?, ?, ?, ?, ?, ?)`,
      [caja.id, sesion.id, nombreCliente, texto(dni) || null, subtotal, pct, igv, total, metodoPago]
    );
    const ventaId = result.insertId;
    const numeroBoleta = boletaNumero(ventaId);
    await conn.query('UPDATE ventas SET numero_boleta = ? WHERE id = ?', [numeroBoleta, ventaId]);
    await conn.query(
      'INSERT INTO venta_detalle (venta_id, producto_id, nombre_producto, cantidad, precio_unitario) VALUES ?',
      [lineas.map(l => [ventaId, l.id, l.name, l.qty, l.price])]
    );
    await moverInsumos(conn, lineas, -1);

    await conn.commit();
    return { ok: true, ventaId, numeroBoleta, items: lineas, subtotal, igv, total, descuentoPct: pct, cliente: nombreCliente, cupon, sellos };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// Sin "fecha" devuelve las ventas de hoy; con "fecha" (YYYY-MM-DD, la que
// entrega un <input type="date">) devuelve las de ese dia especifico, para
// que el admin pueda consultar cualquier dia desde el calendario.
ipcMain.handle('ventas-del-dia', soloAdmin(async (_e, data) => {
  const fecha = data.fecha || null;
  // Rango [dia, dia+1) en vez de DATE(fecha) = dia: mismo resultado, pero
  // asi MySQL puede usar el indice idx_ventas_fecha.
  const dia = fecha ? 'DATE(?)' : 'CURDATE()';
  const condicionFecha = `v.fecha >= ${dia} AND v.fecha < ${dia} + INTERVAL 1 DAY`;
  const params = fecha ? [fecha, fecha] : [];
  const [rows] = await pool.query(
    `SELECT v.*, u.nombre AS nombre_empleado,
       (SELECT COALESCE(SUM(vd.cantidad * vd.precio_unitario), 0) FROM venta_detalle vd WHERE vd.venta_id = v.id) AS bruto
     FROM ventas v JOIN usuarios u ON u.id = v.empleado_id
     WHERE ${condicionFecha}
     ORDER BY v.fecha DESC`,
    params
  );
  const [[totales]] = await pool.query(
    `SELECT COALESCE(SUM(v.total),0) AS totalDia, COUNT(*) AS numVentas
     FROM ventas v WHERE ${condicionFecha} AND v.estado = 'completada'`,
    params
  );
  return { ventas: rows, totalDia: Number(totales.totalDia), numVentas: totales.numVentas };
}));

// ---------- DEVOLUCIONES ----------
// Ventas mas recientes de la caja abierta del empleado, para poder
// seleccionar la boleta y devolverla.
ipcMain.handle('ventas-recientes-caja', soloEmpleado(async () => {
  const caja = await cajaAbiertaDeSesion();
  if (!caja) return [];
  const [rows] = await pool.query(
    `SELECT v.*, GROUP_CONCAT(CONCAT(vd.cantidad, 'x ', vd.nombre_producto) SEPARATOR ', ') AS items
     FROM ventas v
     LEFT JOIN venta_detalle vd ON vd.venta_id = v.id
     WHERE v.caja_id = ?
     GROUP BY v.id
     ORDER BY v.fecha DESC
     LIMIT 20`,
    [caja.id]
  );
  return rows;
}));

// Trae una venta completa (con sus items) para poder reimprimir su boleta
// tal cual salio la primera vez. El empleado solo puede ver las suyas.
ipcMain.handle('venta-detalle', conSesion(async (_e, { ventaId }) => {
  const [[venta]] = await pool.query(
    `SELECT v.*, u.nombre AS nombre_empleado
     FROM ventas v JOIN usuarios u ON u.id = v.empleado_id
     WHERE v.id = ?`,
    [ventaId]
  );
  if (!venta || (sesion.rol === 'empleado' && venta.empleado_id !== sesion.id)) {
    return { ok: false, error: 'Boleta no encontrada' };
  }
  const [items] = await pool.query('SELECT * FROM venta_detalle WHERE venta_id = ?', [ventaId]);
  return { ok: true, venta, items };
}));

ipcMain.handle('venta-devolver', soloEmpleado(async (_e, { ventaId }) => {
  const [[venta]] = await pool.query('SELECT * FROM ventas WHERE id = ? AND empleado_id = ?', [ventaId, sesion.id]);
  if (!venta) return { ok: false, error: 'Boleta no encontrada' };
  if (venta.estado === 'devuelta') return { ok: false, error: 'Esta boleta ya fue devuelta' };

  // El "AND estado" evita devolver dos veces la misma boleta si se hace doble
  // clic o dos cajas la devuelven a la vez.
  const [upd] = await pool.query(
    "UPDATE ventas SET estado = 'devuelta', fecha_devolucion = NOW() WHERE id = ? AND estado <> 'devuelta'",
    [ventaId]
  );
  if (upd.affectedRows === 0) return { ok: false, error: 'Esta boleta ya fue devuelta' };
  const [detalle] = await pool.query('SELECT * FROM venta_detalle WHERE venta_id = ?', [ventaId]);
  await moverInsumos(pool, detalle.map(d => ({ id: d.producto_id, qty: d.cantidad })), 1);

  return {
    ok: true,
    devolucion: {
      numeroBoleta: venta.numero_boleta,
      cliente: venta.cliente,
      dni: venta.dni,
      metodoPago: venta.metodo_pago,
      subtotal: Number(venta.subtotal),
      igv: Number(venta.igv),
      total: Number(venta.total),
      descuentoPct: Number(venta.descuento_pct) || 0,
      items: detalle.map(d => ({ nombre: d.nombre_producto, cantidad: d.cantidad, precio: Number(d.precio_unitario) }))
    }
  };
}));

// ---------- CONFIGURACION DE BOLETA (solo admin la edita, todas las pantallas la leen) ----------
const CONFIG_BOLETA_DEFAULT = { id: 1, ancho_mm: 72.1, alto_mm: 297, fuente: 'Courier New', negrita: 1, impresora_nombre: null };

ipcMain.handle('config-boleta-obtener', conSesion(async () => {
  try {
    const [[config]] = await pool.query('SELECT * FROM configuracion_boleta WHERE id = 1');
    return config || CONFIG_BOLETA_DEFAULT;
  } catch (err) {
    console.error('No se pudo leer la configuracion de boleta, usando valores por defecto.', err);
    return CONFIG_BOLETA_DEFAULT;
  }
}));

ipcMain.handle('config-boleta-guardar', soloAdmin(async (_e, { anchoMm, altoMm, fuente, negrita, impresoraNombre }) => {
  if (!(Number(anchoMm) > 0) || !(Number(altoMm) > 0)) return { ok: false, error: 'Ingresa un ancho y alto válidos' };
  try {
    await pool.query(
      `INSERT INTO configuracion_boleta (id, ancho_mm, alto_mm, fuente, negrita, impresora_nombre) VALUES (1, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE ancho_mm = VALUES(ancho_mm), alto_mm = VALUES(alto_mm), fuente = VALUES(fuente), negrita = VALUES(negrita), impresora_nombre = VALUES(impresora_nombre)`,
      [Number(anchoMm), Number(altoMm), texto(fuente) || 'Courier New', negrita ? 1 : 0, texto(impresoraNombre) || null]
    );
    return { ok: true };
  } catch (err) {
    console.error('No se pudo guardar la configuracion de boleta.', err);
    return { ok: false, error: 'No se pudo guardar en la base de datos: ' + err.message };
  }
}));

// ---------- INSUMOS (inventario contable, medido en KG/LT/UND, solo admin) ----------
const UNIDADES = ['KG', 'LT', 'UND'];

ipcMain.handle('insumos-listar', soloAdmin(async () => {
  const [rows] = await pool.query('SELECT * FROM insumos WHERE activo = 1 ORDER BY nombre');
  return rows;
}));

// Recetas para mostrar en el panel (que se descuenta al vender cada producto).
ipcMain.handle('recetas-listar', soloAdmin(async () => {
  const [rows] = await pool.query(
    `SELECT p.nombre AS producto, i.nombre AS insumo, i.unidad, r.cantidad
     FROM recetas r JOIN productos p ON p.id = r.producto_id JOIN insumos i ON i.id = r.insumo_id
     WHERE p.activo = 1 ORDER BY p.nombre, i.nombre`
  );
  return rows;
}));

ipcMain.handle('insumos-agregar', soloAdmin(async (_e, { nombre, unidad, cantidad }) => {
  if (!texto(nombre) || !UNIDADES.includes(unidad) || !(Number(cantidad || 0) >= 0)) return { ok: false, error: 'Datos del insumo inválidos' };
  const [result] = await pool.query(
    'INSERT INTO insumos (nombre, unidad, cantidad) VALUES (?, ?, ?)',
    [texto(nombre), unidad, Number(cantidad) || 0]
  );
  return { ok: true, id: result.insertId };
}));

ipcMain.handle('insumos-actualizar', soloAdmin(async (_e, { id, nombre, unidad }) => {
  if (!texto(nombre) || !UNIDADES.includes(unidad)) return { ok: false, error: 'Datos del insumo inválidos' };
  await pool.query('UPDATE insumos SET nombre = ?, unidad = ? WHERE id = ?', [texto(nombre), unidad, id]);
  return { ok: true };
}));

// Suma (o resta, si delta es negativo) una cantidad al stock del insumo, sin
// dejarlo bajar de 0. Se usa tanto para los botones rapidos +1/-1 como para
// la cantidad personalizada que ingresa el admin.
ipcMain.handle('insumos-ajustar', soloAdmin(async (_e, { id, delta }) => {
  if (!Number.isFinite(Number(delta))) return { ok: false, error: 'Cantidad inválida' };
  await pool.query('UPDATE insumos SET cantidad = GREATEST(cantidad + ?, 0) WHERE id = ?', [Number(delta), id]);
  const [[insumo]] = await pool.query('SELECT * FROM insumos WHERE id = ?', [id]);
  return { ok: true, insumo };
}));

ipcMain.handle('insumos-eliminar', soloAdmin(async (_e, { id }) => {
  await pool.query('UPDATE insumos SET activo = 0 WHERE id = ?', [id]);
  return { ok: true };
}));

// ---------- MESAS (pedidos abiertos por mesa/barra, se cobran con venta-registrar) ----------
// Debe coincidir con MESAS/BARRAS de empleado.html.
const MESAS_VALIDAS = ['Mesa 1', 'Mesa 2', 'Mesa 3', 'Mesa 4', 'Mesa Exterior', 'Barra 1', 'Barra 2', 'Barra 3', 'Barra 4'];

// "segundos" lo calcula MySQL (NOW() - creado_en) para que el tiempo
// corriendo no dependa de que el reloj de esta PC coincida con el del servidor.
ipcMain.handle('mesas-pedidos-listar', soloEmpleado(async () => {
  const [rows] = await pool.query(
    'SELECT id, mesa, producto_id, nombre_producto, precio, observacion, TIMESTAMPDIFF(SECOND, creado_en, NOW()) AS segundos FROM mesa_pedidos ORDER BY creado_en, id'
  );
  return rows;
}));

ipcMain.handle('mesas-pedido-agregar', soloEmpleado(async (_e, { mesa, productoId, observacion }) => {
  if (!MESAS_VALIDAS.includes(mesa)) return { ok: false, error: 'Mesa inválida' };
  const [[producto]] = await pool.query('SELECT id, nombre, precio FROM productos WHERE id = ? AND activo = 1', [productoId]);
  if (!producto) return { ok: false, error: 'Producto no encontrado' };
  await pool.query(
    'INSERT INTO mesa_pedidos (mesa, producto_id, nombre_producto, precio, observacion) VALUES (?, ?, ?, ?, ?)',
    [mesa, producto.id, producto.nombre, producto.precio, texto(observacion).slice(0, 200)]
  );
  return { ok: true };
}));

ipcMain.handle('mesas-pedido-quitar', soloEmpleado(async (_e, { id }) => {
  await pool.query('DELETE FROM mesa_pedidos WHERE id = ?', [id]);
  return { ok: true };
}));
