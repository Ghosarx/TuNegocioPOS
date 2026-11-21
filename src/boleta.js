const negocio = (window.api && window.api.negocio) || { nombre: 'Tu negocio', logo: null, colores: {} };

function nombreNegocio() { return negocio.nombre; }

function aplicarColores(colores) {
  Object.entries(colores || {}).forEach(([k, v]) => document.documentElement.style.setProperty('--' + k, v));
}
aplicarColores(negocio.colores);

document.addEventListener('DOMContentLoaded', () => {
  document.title = `${negocio.nombre} - ${document.title}`;
  document.querySelectorAll('.nombre-negocio').forEach(el => {
    el.textContent = el.tagName === 'STRONG' ? negocio.nombre.toUpperCase() : negocio.nombre;
  });
  if (negocio.logo) document.querySelectorAll('.logo-negocio').forEach(img => { img.src = negocio.logo; });
});

// Aplica la configuracion de tamaño/tipografia de boleta (guardada por el
// admin en configuracion_boleta) a la pantalla y a la impresion. Compartido
// entre admin.html y empleado.html para que todas las boletas se vean igual.

// Solo se usa para la "Vista previa" en pantalla del panel admin (ya no para
// imprimir: la impresion real es ESC/POS crudo, ver imprimirLineas()).
function aplicarConfigBoleta(config) {
  const ancho = Number(config.ancho_mm) || 72.1;
  const alto = Number(config.alto_mm) || 297;
  const fuente = config.fuente || 'Courier New';
  const negrita = !!Number(config.negrita);
  const peso = negrita ? 700 : 400;

  let estilo = document.getElementById('boletaConfigStyle');
  if (!estilo) {
    estilo = document.createElement('style');
    estilo.id = 'boletaConfigStyle';
    document.head.appendChild(estilo);
  }
  estilo.textContent = `
    .receipt {
      width: ${ancho}mm;
      min-height: ${alto}mm;
      font-family: '${fuente}', monospace;
      font-weight: ${peso};
    }
  `;
}

async function cargarYAplicarConfigBoleta() {
  try {
    const config = await window.api.configBoletaObtener();
    aplicarConfigBoleta(config);
  } catch (err) {
    console.error('No se pudo cargar la configuracion de boleta', err);
  }
}

// ---------- Impresion ESC/POS ----------
// Cada boleta se arma como una lista de "lineas" (texto plano con
// alineacion/negrita) en vez de HTML, porque se imprime en crudo (bytes
// ESC/POS) directo a la impresora - ver imprimir-boleta en main.js. Asi el
// corte de papel lo decide la propia impresora segun el contenido real, sin
// pasar por el sistema de paginas de Windows (que era la causa de que las
// boletas cortas salieran mal).
function lCentro(texto, bold){ return { t: 'center', text: texto, bold: !!bold }; }
function lTexto(texto, bold){ return { t: 'text', text: texto, bold: !!bold }; }
function lFila(izquierda, derecha, bold){ return { t: 'row', left: izquierda, right: derecha, bold: !!bold }; }
function lGrande(texto){ return { t: 'big', text: texto }; } // doble alto y ancho
function lSep(){ return { t: 'sep' }; }
function lBlanco(){ return { t: 'blank' }; }

// porWindows: imprime por el driver de Windows en vez de ESC/POS crudo (ventas en efectivo).
async function imprimirLineas(lineas, porWindows) {
  if (!(window.api && window.api.imprimirBoleta)) {
    console.error('window.api.imprimirBoleta no esta disponible');
    return { ok: false, error: 'API de impresión no disponible' };
  }
  const res = await window.api.imprimirBoleta({ lineas, porWindows: !!porWindows });
  if (!res.ok) {
    alert('No se pudo imprimir: ' + (res.error || 'error desconocido'));
  }
  return res;
}

// Escapa texto antes de meterlo en innerHTML. Obligatorio para todo lo que
// venga de la base (nombres de clientes, productos, empleados...): si no, un
// nombre como <img onerror=...> ejecutaria codigo en la pantalla del admin.
function esc(valor){
  return String(valor == null ? '' : valor).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtMonto(n){ return Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Arma las lineas de una boleta de venta (usado tanto al cobrar como al
// reimprimir una venta ya registrada, para que ambas salgan identicas).
// items: [{ nombre, cantidad, precio }]. Si copia es true, marca la boleta
// como reimpresion.
// Lineas "SUMA / DESCUENTO (x%)" antes de OP. GRAVADA, solo si hubo descuento
// (sin ellas la suma de los productos no cuadraria con el total cobrado).
function lineasDescuento(items, total, descuentoPct){
  if (!(descuentoPct > 0)) return [];
  const bruto = items.reduce((s, i) => s + i.precio * i.cantidad, 0);
  return [
    lFila('SUMA', `S/ ${fmtMonto(bruto)}`),
    lFila(`DESCUENTO (${Number(descuentoPct)}%)`, `-S/ ${fmtMonto(bruto - total)}`)
  ];
}

function construirLineasVenta({ numeroBoleta, fecha, items, subtotal, igv, total, metodoPago, nombreEmpleado, cliente, dni, copia, descuentoPct }){
  const lineas = [
    lCentro(nombreNegocio().toUpperCase(), true),
    lSep(),
    lCentro('BOLETA DE VENTA ELECTRÓNICA', true),
    lCentro(numeroBoleta),
    lCentro(`FECHA DE EMISIÓN: ${fecha.toLocaleDateString('es-PE')} HORA:${fecha.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}`)
  ];
  if (copia) lineas.push(lCentro('*** REIMPRESIÓN ***', true));
  lineas.push(
    lSep(),
    lCentro('Descripción'),
    lFila('Cantidad x P.Unitario', 'Total')
  );
  items.forEach(i => {
    lineas.push(lTexto(i.nombre, true));
    lineas.push(lFila(`${i.cantidad} x S/ ${fmtMonto(i.precio)}`, `S/ ${fmtMonto(i.precio * i.cantidad)}`));
  });
  lineas.push(
    lSep(),
    ...lineasDescuento(items, total, descuentoPct),
    lFila('OP. GRAVADA', `S/ ${fmtMonto(subtotal)}`),
    lFila('IGV (18%)', `S/ ${fmtMonto(igv)}`),
    lFila('IMPORTE TOTAL', `S/ ${fmtMonto(total)}`, true),
    lSep(),
    lCentro(montoEnLetras(total)),
    lSep(),
    lFila('Tipo de pago', metodoPago),
    lFila('Atendido por', nombreEmpleado)
  );
  if (cliente) lineas.push(lFila('Cliente', cliente));
  if (dni) lineas.push(lFila('DNI', dni));
  lineas.push(lSep(), lCentro('Gracias por su compra'));
  return lineas;
}

// Trae la venta completa (con items) por su id y la reimprime con el mismo
// formato de la boleta original, marcada como "REIMPRESION". No agrega ni
// modifica nada en la base de datos, solo lee lo que ya estaba guardado.
async function reimprimirVenta(ventaId){
  const res = await window.api.ventaDetalle({ ventaId });
  if (!res.ok) {
    alert('No se pudo obtener la boleta: ' + (res.error || 'error desconocido'));
    return;
  }
  const { venta, items } = res;
  const lineas = construirLineasVenta({
    numeroBoleta: venta.numero_boleta,
    fecha: new Date(venta.fecha),
    items: items.map(i => ({ nombre: i.nombre_producto, cantidad: i.cantidad, precio: Number(i.precio_unitario) })),
    subtotal: Number(venta.subtotal),
    igv: Number(venta.igv),
    total: Number(venta.total),
    metodoPago: venta.metodo_pago,
    nombreEmpleado: venta.nombre_empleado,
    cliente: venta.cliente,
    dni: venta.dni,
    descuentoPct: Number(venta.descuento_pct) || 0,
    copia: true
  });
  await imprimirLineas(lineas);
}

// Categorias de productos que se venden (usadas para el desplegable de
// categoria en el panel de admin y para agrupar la pantalla de venta del
// empleado en cuadros). Compartido para que ambas pantallas usen siempre la
// misma lista.
const CATEGORIAS_PRODUCTOS = ['Bebidas', 'Comidas', 'Postres', 'Snacks', 'Regalos'];

// Convierte un monto en soles a su forma escrita para el pie de la boleta
// (formato peruano: "SON: DOCE Y 00/100 SOLES"). Compartido por admin.html
// y empleado.html para que todas las boletas usen el mismo texto.
function convertirNumeroALetras(numero) {
  const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
  const ESPECIALES = {
    10: 'DIEZ', 11: 'ONCE', 12: 'DOCE', 13: 'TRECE', 14: 'CATORCE', 15: 'QUINCE',
    16: 'DIECISÉIS', 17: 'DIECISIETE', 18: 'DIECIOCHO', 19: 'DIECINUEVE', 20: 'VEINTE',
    21: 'VEINTIUNO', 22: 'VEINTIDÓS', 23: 'VEINTITRÉS', 24: 'VEINTICUATRO', 25: 'VEINTICINCO',
    26: 'VEINTISÉIS', 27: 'VEINTISIETE', 28: 'VEINTIOCHO', 29: 'VEINTINUEVE'
  };
  const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  function dosDigitos(n) {
    if (n === 0) return '';
    if (n < 30) return ESPECIALES[n] || UNIDADES[n];
    const d = Math.floor(n / 10);
    const u = n % 10;
    return u === 0 ? DECENAS[d] : `${DECENAS[d]} Y ${UNIDADES[u]}`;
  }

  function tresDigitos(n) {
    if (n === 0) return '';
    if (n === 100) return 'CIEN';
    const c = Math.floor(n / 100);
    const resto = dosDigitos(n % 100);
    const texto = c > 0 ? CENTENAS[c] : '';
    return texto && resto ? `${texto} ${resto}` : (texto || resto);
  }

  function seccionMiles(n) {
    const miles = Math.floor(n / 1000);
    const resto = tresDigitos(n % 1000);
    let texto = '';
    if (miles > 0) texto = miles === 1 ? 'MIL' : `${tresDigitos(miles)} MIL`;
    return texto && resto ? `${texto} ${resto}` : (texto || resto);
  }

  const entero = Math.trunc(numero);
  if (entero === 0) return 'CERO';
  if (entero < 1000000) return seccionMiles(entero);
  const millones = Math.floor(entero / 1000000);
  const resto = seccionMiles(entero % 1000000);
  const textoMillones = millones === 1 ? 'UN MILLÓN' : `${tresDigitos(millones)} MILLONES`;
  return resto ? `${textoMillones} ${resto}` : textoMillones;
}

function montoEnLetras(monto) {
  const entero = Math.floor(monto + 1e-9);
  const centavos = Math.round((monto - entero) * 100);
  return `SON: ${convertirNumeroALetras(entero)} Y ${String(centavos).padStart(2, '0')}/100 SOLES`;
}

// En Windows, Electron a veces pierde el foco de teclado despues de un
// dialogo nativo (confirm/prompt/alert): los botones siguen respondiendo al
// clic, pero los <input> de texto dejan de recibir el cursor hasta que la
// ventana se re-enfoca a mano (salir y volver a entrar). Envolvemos los
// dialogos nativos para pedirle al proceso principal que fuerce ese
// reenfoque (blur+focus) apenas se cierran, en toda la app.
(function envolverDialogosNativos(){
  const _confirm = window.confirm.bind(window);
  const _prompt = window.prompt.bind(window);
  const _alert = window.alert.bind(window);
  function reenfocar(){
    if (window.api && window.api.refocusVentana) window.api.refocusVentana();
    else window.focus();
  }
  window.confirm = (...args) => { const r = _confirm(...args); reenfocar(); return r; };
  window.prompt = (...args) => { const r = _prompt(...args); reenfocar(); return r; };
  window.alert = (...args) => { const r = _alert(...args); reenfocar(); return r; };
})();
