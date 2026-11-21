const usuarioActual = JSON.parse(sessionStorage.getItem('usuarioActual') || 'null');
if(!usuarioActual || usuarioActual.rol !== 'empleado'){
  window.location.href = 'login.html';
}
document.getElementById('nombreEmpleadoApertura').textContent = usuarioActual ? usuarioActual.nombre : '';
document.getElementById('nombreEmpleado').textContent = usuarioActual ? usuarioActual.nombre : '';

function fmt(n){ return Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

let cajaActual = null;
let carrito = {};
let productosCache = [];

cargarYAplicarConfigBoleta();

// ---------- VERIFICAR SI YA HAY CAJA ABIERTA ----------
(async () => {
  const estado = await window.api.cajaEstado();
  if(estado.abierta){
    cajaActual = estado.caja;
    entrarAlSistema();
  }
})();

document.getElementById('montoInicial').addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){
    e.preventDefault();
    document.getElementById('btnAbrirCaja').click();
  }
});

document.getElementById('btnAbrirCaja').onclick = async () => {
  const monto = parseFloat(document.getElementById('montoInicial').value);
  const errorEl = document.getElementById('errorApertura');
  errorEl.classList.add('oculto');
  if(isNaN(monto) || monto < 0){
    errorEl.textContent = 'Ingresa un monto válido';
    errorEl.classList.remove('oculto');
    return;
  }
  const res = await window.api.cajaAbrir({ montoInicial: monto });
  if(!res.ok){
    errorEl.textContent = res.error;
    errorEl.classList.remove('oculto');
    return;
  }
  cajaActual = { id: res.cajaId, monto_inicial: monto };
  entrarAlSistema();
};

function entrarAlSistema(){
  document.getElementById('vistaAbrirCaja').classList.add('oculto');
  document.getElementById('appPrincipal').classList.remove('oculto');
  cargarProductosVenta();
}

// ---------- TABS ----------
const vistasEmp = {
  venta: document.getElementById('vistaVenta'),
  mesas: document.getElementById('vistaMesas'),
  ventasEmp: document.getElementById('vistaVentasEmp'),
  clientes: document.getElementById('vistaClientes')
};
const tabsEmp = {
  venta: document.getElementById('tabVenta'),
  mesas: document.getElementById('tabMesas'),
  ventasEmp: document.getElementById('tabVentasEmp'),
  clientes: document.getElementById('tabClientes')
};
function cambiarTabEmp(nombre){
  Object.keys(vistasEmp).forEach(k => vistasEmp[k].classList.toggle('oculto', k !== nombre));
  Object.keys(tabsEmp).forEach(k => tabsEmp[k].classList.toggle('activo', k === nombre));
  if(nombre === 'ventasEmp') cargarVentasEmp();
  if(nombre === 'mesas') cargarMesas();
  if(nombre === 'clientes') mostrarListaClientes();
}
tabsEmp.venta.onclick = () => cambiarTabEmp('venta');
tabsEmp.mesas.onclick = () => cambiarTabEmp('mesas');
tabsEmp.ventasEmp.onclick = () => cambiarTabEmp('ventasEmp');
tabsEmp.clientes.onclick = () => cambiarTabEmp('clientes');

// ---------- DESCUENTO (venta rapida y mesas) ----------
// Total con descuento redondeado a centimos; el IGV sale del total ya descontado.
function calcularTotales(bruto, descuentoPct){
  const total = Math.round(bruto * (1 - descuentoPct / 100) * 100) / 100;
  const subtotal = total / 1.18;
  return { total, subtotal, igv: total - subtotal, descuento: bruto - total };
}

function mostrarLineaDescuento(id, totales, pct){
  const el = document.getElementById(id);
  el.textContent = `Descuento (${pct}%): -S/ ${fmt(totales.descuento)}`;
  el.classList.toggle('oculto', !(pct > 0));
}

// Campo "Descuento %" + Aplicar; ya aplicado se muestra con una X para quitarlo.
function crearDescuento(contenedorId, onChange){
  const cont = document.getElementById(contenedorId);
  cont.innerHTML = `
    <div class="descuento-form">
      <input type="number" min="0" max="100" step="0.01" placeholder="Descuento %">
      <button type="button">Aplicar</button>
    </div>
    <div class="descuento-aplicado oculto"><span></span><button type="button" class="quitar-x" title="Quitar descuento">&times;</button></div>`;
  const [form, aplicado] = cont.children;
  const input = form.querySelector('input');
  let pct = 0;
  function poner(nuevo){
    pct = nuevo;
    form.classList.toggle('oculto', pct > 0);
    aplicado.classList.toggle('oculto', pct === 0);
    aplicado.querySelector('span').textContent = `Descuento aplicado: ${pct}%`;
    input.value = '';
    onChange();
  }
  form.querySelector('button').onclick = () => {
    const v = parseFloat(input.value);
    if(isNaN(v) || v <= 0 || v > 100){ alert('Ingresa un descuento mayor a 0 y hasta 100%'); return; }
    poner(v);
  };
  input.addEventListener('keydown', (e) => { if(e.key === 'Enter') form.querySelector('button').click(); });
  aplicado.querySelector('button').onclick = () => poner(0);
  return { pct: () => pct, quitar: () => poner(0), poner };
}

const descVenta = crearDescuento('descuentoVenta', () => renderCarrito());
const descMesa = crearDescuento('descuentoMesa', () => renderPanelMesa());

// ---------- TARJETA DE FIDELIDAD ----------
const SELLOS_TARJETA = 10; // igual que en main.js

function mostrarCupon(){
  const el = document.getElementById('cuponFlotante');
  el.classList.remove('oculto');
  animar(el, 'entra');
  clearTimeout(mostrarCupon.t);
  mostrarCupon.t = setTimeout(() => el.classList.add('oculto'), 4000);
}
document.getElementById('cuponFlotante').onclick = (e) => e.currentTarget.classList.add('oculto');

// Campo "Cliente": el lector de codigos escribe el codigo y manda Enter (como
// un teclado). Con Enter se busca la tarjeta; si esta compra es la 10.a se
// aplica el 50% (el servidor lo vuelve a comprobar al cobrar). Si no es un
// codigo registrado, se deja como nombre libre.
function crearCampoCliente(inputId, infoId, desc){
  const input = document.getElementById(inputId);
  const info = document.getElementById(infoId);
  let cli = null, cupon = false;
  function poner(c, conCupon){
    if(cupon && !conCupon) desc.quitar();
    cli = c; cupon = !!conCupon;
    info.classList.toggle('oculto', !c);
    if(c) info.textContent = cupon
      ? `Tarjeta llena: esta compra lleva 50% de descuento`
      : `Tarjeta: ${c.sellos}/${SELLOS_TARJETA} compras (esta boleta suma +1)`;
  }
  // avisar: si no existe, alerta (lectura del lector); escrito a mano no, porque
  // puede ser un nombre libre.
  async function buscar(codigo, avisar){
    const res = await window.api.clienteBuscar({ codigo });
    if(!res.ok){ if(avisar) alert(res.error); return; }
    input.value = `${res.cliente.nombre} ${res.cliente.apellidos}`;
    poner(res.cliente, res.cupon);
    if(res.cupon){ desc.poner(50); mostrarCupon(); }
  }
  input.addEventListener('keydown', (e) => {
    if(e.key !== 'Enter') return;
    e.preventDefault();
    const codigo = input.value.trim();
    if(codigo) buscar(codigo, false);
  });
  input.addEventListener('input', () => { if(cli) poner(null); });
  return {
    input,
    leer(codigo){ if(cli) poner(null); input.value = codigo; input.focus(); buscar(codigo, true); },
    codigo: () => cli ? cli.codigo_barras : '',
    nombre: () => input.value.trim(),
    limpiar(){ input.value = ''; poner(null); }
  };
}

const clienteVenta = crearCampoCliente('clienteInput', 'clienteInfoVenta', descVenta);
const clienteMesa = crearCampoCliente('mesaClienteInput', 'clienteInfoMesa', descMesa);

// Lector en cualquier parte: el lector "teclea" muy rapido y termina con
// Enter; una persona tarda mucho mas entre tecla y tecla. Si se detecta una
// lectura con el foco en otro lado, el codigo va al campo Cliente de la vista
// abierta (y se borra de donde se haya escrito por error).
const LECTOR_MS_ENTRE_TECLAS = 40; // si el lector no se detecta, subir un poco
const LECTOR_MIN_CARACTERES = 6;
let lectorBuffer = '';
let lectorUltima = 0;

function campoClienteActivo(){
  if(document.getElementById('appPrincipal').classList.contains('oculto')) return null;
  if(!vistasEmp.venta.classList.contains('oculto')) return clienteVenta;
  if(!vistasEmp.mesas.classList.contains('oculto') && mesaSeleccionada) return clienteMesa;
  return null;
}

window.addEventListener('keydown', (e) => {
  const ahora = performance.now();
  const rapido = ahora - lectorUltima < LECTOR_MS_ENTRE_TECLAS;
  lectorUltima = ahora;
  if(e.key !== 'Enter'){
    if(e.key.length === 1) lectorBuffer = rapido ? lectorBuffer + e.key : e.key;
    return;
  }
  const codigo = lectorBuffer;
  lectorBuffer = '';
  if(!rapido || codigo.length < LECTOR_MIN_CARACTERES) return;
  const campo = campoClienteActivo();
  if(!campo || document.activeElement === campo.input) return; // ahi ya lo maneja su propio Enter
  e.preventDefault();
  e.stopPropagation(); // que el Enter no active el boton/campo que tenia el foco
  const el = document.activeElement;
  if(el && el.tagName === 'INPUT' && el.value.endsWith(codigo)){
    el.value = el.value.slice(0, -codigo.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  campo.leer(codigo);
}, true);

// Registra la venta e imprime la boleta. Usado por venta rapida y por mesas.
// items: [{ id, qty }] (venta rapida) o mesaPedidoIds (mesa). Los precios y
// totales los calcula el proceso principal con la base de datos; la boleta
// se imprime con lo que devuelve. Devuelve true si se cobro.
async function cobrar({ items, metodoPago, campoCliente, descuentoPct, mesaPedidoIds }){
  const res = await window.api.ventaRegistrar({
    cliente: campoCliente.nombre(), codigoCliente: campoCliente.codigo(),
    items, metodoPago, descuentoPct, mesaPedidoIds
  });
  if(!res.ok){ alert(res.error); return false; }

  const { subtotal, igv, total, cliente } = res;
  descuentoPct = res.descuentoPct;
  const dni = '';
  // Sin await: la venta ya quedo registrada, la caja sigue mientras imprime
  // (si falla la impresion, imprimirLineas avisa y se puede reimprimir).
  imprimirLineas(construirLineasVenta({
    numeroBoleta: res.numeroBoleta,
    fecha: new Date(),
    items: res.items.map(i => ({ nombre: i.name, cantidad: i.qty, precio: i.price })),
    subtotal, igv, total,
    metodoPago,
    nombreEmpleado: usuarioActual.nombre,
    cliente, dni, descuentoPct
  }), metodoPago === 'Efectivo');
  return true;
}

// Desactiva el boton mientras corre fn: evita cobrar dos veces con doble clic.
async function mientrasOcupado(btn, fn){
  if(btn.disabled) return;
  btn.disabled = true;
  try { await fn(); } finally { btn.disabled = false; }
}

// Reinicia una animacion CSS en el elemento (para el "pulso" del total).
function animar(el, clase){
  el.classList.remove(clase);
  void el.offsetWidth;
  el.classList.add(clase);
}
function ponerTotal(id, texto){
  const el = document.getElementById(id);
  if(el.textContent !== texto){ el.textContent = texto; animar(el, 'pulso'); }
}

// ---------- MESAS ----------
const MESAS = ['Mesa 1', 'Mesa 2', 'Mesa 3', 'Mesa 4', 'Mesa Exterior'];
const BARRAS = ['Barra 1', 'Barra 2', 'Barra 3', 'Barra 4'];
let pedidosMesas = [];
let pedidosCargadosEn = 0;
let mesaSeleccionada = null;
// Separar cuenta: se marcan los pedidos de la mesa y "Pagar" cobra solo esos.
let separando = false;
const seleccionados = new Set();
let pedidosVistos = new Set(); // para animar solo los pedidos recien agregados

function pedidosDe(mesa){ return pedidosMesas.filter(p => p.mesa === mesa); }
function pedidosACobrar(){
  const pedidos = pedidosDe(mesaSeleccionada);
  return separando ? pedidos.filter(p => seleccionados.has(p.id)) : pedidos;
}
function salirDeSeparar(){ separando = false; seleccionados.clear(); }
function sumaPedidos(pedidos){ return pedidos.reduce((s, p) => s + Number(p.precio), 0); }

async function cargarMesas(){
  pedidosMesas = await window.api.mesasPedidosListar();
  pedidosCargadosEn = Date.now();
  renderMesas();
}

function renderMesas(){
  [['colMesas', MESAS, 'mesa-box'], ['colBarras', BARRAS, 'mesa-box barra']].forEach(([id, nombres, clase]) => {
    const col = document.getElementById(id);
    col.innerHTML = '';
    nombres.forEach(nombre => {
      const pedidos = pedidosDe(nombre);
      const div = document.createElement('div');
      div.className = clase + (pedidos.length ? ' ocupada' : '') + (nombre === mesaSeleccionada ? ' seleccionada' : '');
      div.innerHTML = `<strong>${nombre}</strong>` + (pedidos.length ? `<small>${pedidos.length} ped.<br>S/ ${fmt(sumaPedidos(pedidos))}</small>` : '');
      div.onclick = () => {
        if(nombre !== mesaSeleccionada){
          mesaSeleccionada = nombre;
          document.getElementById('mesaBuscar').value = '';
          document.getElementById('mesaObs').value = '';
          salirDeSeparar();
          renderResultadosMesa();
          clienteMesa.limpiar();
          descMesa.quitar();
        }
        renderMesas();
      };
      col.appendChild(div);
    });
  });
  renderPanelMesa();
}

function renderPanelMesa(){
  document.getElementById('mesaSinSeleccion').classList.toggle('oculto', !!mesaSeleccionada);
  document.getElementById('mesaDetalle').classList.toggle('oculto', !mesaSeleccionada);
  if(!mesaSeleccionada) return;
  document.getElementById('mesaTitulo').textContent = mesaSeleccionada;
  const pedidos = pedidosDe(mesaSeleccionada);
  const cont = document.getElementById('mesaPedidos');
  cont.innerHTML = pedidos.length ? '' : '<p style="color:var(--muted);">Sin pedidos todavía. Busca un producto abajo para añadirlo.</p>';
  pedidos.forEach(p => {
    const div = document.createElement('div');
    div.className = 'pedido-linea' + (pedidosVistos.has(p.id) ? '' : ' nuevo');
    div.innerHTML = (separando ? `<input type="checkbox" class="sel-pedido" data-sel="${p.id}"${seleccionados.has(p.id) ? ' checked' : ''}>` : '') + `<span>${esc(p.nombre_producto)} - S/ ${fmt(p.precio)}${p.observacion ? `<br><small>Obs: ${esc(p.observacion)}</small>` : ''}</span><span class="timer" data-segundos="${Number(p.segundos)}"></span><button type="button" class="quitar-x" title="Quitar pedido" data-quitar-pedido="${p.id}">&times;</button>`;
    cont.appendChild(div);
  });
  pedidosVistos = new Set(pedidos.map(p => p.id));
  actualizarTimers();
  const pct = descMesa.pct();
  const t = calcularTotales(sumaPedidos(pedidosACobrar()), pct);
  mostrarLineaDescuento('lineaDescuentoMesa', t, pct);
  ponerTotal('mesaTotal', fmt(t.total));
  document.getElementById('mesaTotalLabel').textContent = separando ? 'Total seleccionado' : 'Total';
  document.getElementById('btnSepararCuenta').textContent = separando ? 'Cancelar separación' : 'Separar cuenta';
  document.getElementById('btnPagarMesa').textContent = separando ? 'Pagar seleccionados' : 'Pagar';
}

document.getElementById('btnSepararCuenta').onclick = () => {
  if(separando) salirDeSeparar();
  else separando = true;
  renderPanelMesa();
};

document.getElementById('mesaPedidos').addEventListener('change', (e) => {
  const id = Number(e.target.getAttribute('data-sel'));
  if(!id) return;
  if(e.target.checked) seleccionados.add(id); else seleccionados.delete(id);
  renderPanelMesa();
});

// Tiempo desde que se pidio cada producto (m:ss o h:mm:ss).
function actualizarTimers(){
  if(vistasEmp.mesas.classList.contains('oculto')) return; // nadie los ve
  const extra = Math.floor((Date.now() - pedidosCargadosEn) / 1000);
  document.querySelectorAll('#mesaPedidos .timer').forEach(el => {
    const s = Math.max(0, Number(el.dataset.segundos) + extra);
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), seg = s % 60;
    el.textContent = (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(seg).padStart(2, '0');
  });
}
setInterval(actualizarTimers, 1000);

function renderResultadosMesa(){
  const q = normalizarGrupo(document.getElementById('mesaBuscar').value);
  const cont = document.getElementById('mesaResultados');
  cont.innerHTML = '';
  if(!q) return;
  const coincidencias = productosCache.filter(p => normalizarGrupo(p.nombre).includes(q));
  if(coincidencias.length === 0){
    cont.innerHTML = '<p style="color:var(--muted);">Sin coincidencias</p>';
    return;
  }
  coincidencias.forEach(p => {
    const div = document.createElement('div');
    div.className = 'resultado-linea';
    div.innerHTML = `<span>${esc(p.nombre)} - S/ ${fmt(p.precio)}</span><button type="button" data-anadir="${p.id}">Añadir</button>`;
    cont.appendChild(div);
  });
}
document.getElementById('mesaBuscar').addEventListener('input', renderResultadosMesa);

document.getElementById('mesaResultados').addEventListener('click', async (e) => {
  const id = e.target.getAttribute('data-anadir');
  if(!id) return;
  const obsEl = document.getElementById('mesaObs');
  const res = await window.api.mesasPedidoAgregar({ mesa: mesaSeleccionada, productoId: Number(id), observacion: obsEl.value });
  if(!res.ok){ alert(res.error); return; }
  obsEl.value = '';
  cargarMesas();
});

document.getElementById('mesaPedidos').addEventListener('click', async (e) => {
  const id = e.target.getAttribute('data-quitar-pedido');
  if(!id) return;
  const pedido = pedidosMesas.find(p => p.id === Number(id));
  if(!confirm(`¿Quitar "${pedido ? pedido.nombre_producto : 'este pedido'}" de ${mesaSeleccionada}?`)) return;
  await window.api.mesasPedidoQuitar({ id: Number(id) });
  cargarMesas();
});

document.getElementById('btnPagarMesa').onclick = (e) => mientrasOcupado(e.currentTarget, async () => {
  const pedidos = pedidosACobrar();
  if(pedidos.length === 0){ alert(separando ? 'Marca al menos un pedido para cobrar' : 'Esta mesa no tiene pedidos'); return; }
  const ok = await cobrar({
    metodoPago: document.getElementById('mesaMetodoPago').value,
    campoCliente: clienteMesa,
    descuentoPct: descMesa.pct(),
    mesaPedidoIds: pedidos.map(p => p.id)
  });
  if(ok){ salirDeSeparar(); clienteMesa.limpiar(); }
  await cargarMesas();
  if(ok) descMesa.quitar();
});

// Comanda para cocina: solo producto y observaciones, en letra grande.
// Mismo producto con la misma observacion sale en una sola linea (2 x ...).
document.getElementById('btnImprimirComanda').onclick = async () => {
  const pedidos = pedidosDe(mesaSeleccionada);
  if(pedidos.length === 0){ alert('Esta mesa no tiene pedidos'); return; }
  const grupos = new Map();
  pedidos.forEach(p => {
    const clave = JSON.stringify([p.nombre_producto, p.observacion || '']);
    const g = grupos.get(clave) || { nombre: p.nombre_producto, obs: p.observacion, cantidad: 0 };
    g.cantidad += 1;
    grupos.set(clave, g);
  });
  const hora = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  const lineas = [lCentro(`${mesaSeleccionada} - ${hora}`, true), lSep()];
  grupos.forEach(g => {
    lineas.push(lGrande(`${g.cantidad} x ${g.nombre}`));
    if(g.obs) lineas.push(lGrande('Obs: ' + g.obs));
    lineas.push(lSep());
  });
  await imprimirLineas(lineas);
};

// ---------- VENTAS / DEVOLUCIONES ----------
async function cargarVentasEmp(){
  const ventas = await window.api.ventasRecientesCaja();
  const tbody = document.getElementById('tablaVentasEmp');
  tbody.innerHTML = '';
  ventas.forEach(v => {
    const hora = new Date(v.fecha).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    const estadoBadge = v.estado === 'devuelta'
      ? '<span class="badge warn">Devuelta</span>'
      : '<span class="badge ok">Completada</span>';
    const accion = (v.estado !== 'devuelta'
      ? `<button style="width:auto;" class="peligro" data-devolver="${v.id}">Devolver</button>`
      : '') + `<button style="width:auto;" class="secundario" data-reimprimir="${v.id}">Reimprimir</button>`;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${v.numero_boleta}</td><td>${hora}</td><td>${esc(v.cliente || '-')}</td><td>${esc(v.items || '-')}</td><td>${esc(v.metodo_pago)}</td><td>S/ ${fmt(v.total)}</td><td>${estadoBadge}</td><td>${accion}</td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById('tablaVentasEmp').addEventListener('click', async (e) => {
  const idDevolver = e.target.getAttribute('data-devolver');
  const idReimprimir = e.target.getAttribute('data-reimprimir');
  if(idDevolver){
    if(!confirm('¿Seguro que quieres devolver esta boleta? Quedará anulada.')) return;
    const res = await window.api.ventaDevolver({ ventaId: Number(idDevolver) });
    if(!res.ok){ alert(res.error); return; }
    imprimirDevolucion(res.devolucion);
    cargarVentasEmp();
  }
  if(idReimprimir){
    await reimprimirVenta(Number(idReimprimir));
  }
});

function imprimirDevolucion(d){
  const fecha = new Date();
  const lineas = [
    lCentro(nombreNegocio().toUpperCase(), true),    lSep(),
    lCentro('*** DEVOLUCIÓN ***', true),
    lCentro('Boleta original: ' + d.numeroBoleta),
    lCentro(`FECHA DE EMISIÓN: ${fecha.toLocaleDateString('es-PE')} HORA:${fecha.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}`),
    lSep(),
    lCentro('Descripción'),
    lFila('Cantidad x P.Unitario', 'Total')
  ];
  d.items.forEach(i => {
    lineas.push(lTexto(i.nombre, true));
    lineas.push(lFila(`${i.cantidad} x S/ ${fmt(i.precio)}`, `S/ ${fmt(i.precio * i.cantidad)}`));
  });
  lineas.push(
    lSep(),
    ...lineasDescuento(d.items, d.total, d.descuentoPct),
    lFila('OP. GRAVADA', `S/ ${fmt(d.subtotal)}`),
    lFila('IGV (18%)', `S/ ${fmt(d.igv)}`),
    lFila('TOTAL DEVUELTO', `S/ ${fmt(d.total)}`, true),
    lSep(),
    lCentro(montoEnLetras(d.total)),
    lSep(),
    lFila('Tipo de pago', d.metodoPago),
    lFila('Atendido por', usuarioActual.nombre)
  );
  if (d.cliente) lineas.push(lFila('Cliente', d.cliente));
  if (d.dni) lineas.push(lFila('DNI', d.dni));
  lineas.push(lSep(), lCentro('Venta anulada'));

  imprimirLineas(lineas);
}

// ---------- VENTA ----------
const GRUPOS_VENTA = CATEGORIAS_PRODUCTOS;
let gruposVentaCache = [];
let categoriaSeleccionada = null;

function normalizarGrupo(texto){
  return (texto || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

async function cargarProductosVenta(){
  productosCache = await window.api.inventarioListar();

  const gruposMap = new Map();
  GRUPOS_VENTA.forEach(g => gruposMap.set(normalizarGrupo(g), { clave: normalizarGrupo(g), titulo: g, productos: [] }));
  const otros = { clave: '__otros__', titulo: 'Otros', productos: [] };

  productosCache.forEach(p => {
    const clave = normalizarGrupo(p.categoria);
    const grupo = gruposMap.get(clave);
    if(grupo) grupo.productos.push(p);
    else otros.productos.push(p);
  });

  gruposVentaCache = [...gruposMap.values(), otros].filter(g => g.productos.length > 0);

  const claveActual = categoriaSeleccionada;
  const sigueExistiendo = claveActual && gruposVentaCache.some(g => g.clave === claveActual);
  if(sigueExistiendo) mostrarProductosCategoria(claveActual);
  else mostrarCategoriasVenta();
}

function mostrarCategoriasVenta(){
  categoriaSeleccionada = null;
  document.getElementById('tituloListaProductos').textContent = 'Categorías';
  document.getElementById('btnVolverCategorias').classList.add('oculto');
  document.getElementById('listaProductos').classList.add('oculto');

  const cont = document.getElementById('categoriasVenta');
  cont.classList.remove('oculto');
  cont.innerHTML = '';
  gruposVentaCache.forEach((grupo, i) => {
    const div = document.createElement('div');
    div.className = 'categoria-box entra';
    div.style.animationDelay = `${i * 30}ms`;
    div.textContent = grupo.titulo;
    div.onclick = () => mostrarProductosCategoria(grupo.clave);
    cont.appendChild(div);
  });
}

function mostrarProductosCategoria(clave){
  const grupo = gruposVentaCache.find(g => g.clave === clave);
  if(!grupo){ mostrarCategoriasVenta(); return; }
  categoriaSeleccionada = clave;
  document.getElementById('tituloListaProductos').textContent = grupo.titulo;
  document.getElementById('btnVolverCategorias').classList.remove('oculto');
  document.getElementById('categoriasVenta').classList.add('oculto');

  const cont = document.getElementById('listaProductos');
  cont.classList.remove('oculto');
  cont.innerHTML = '';
  grupo.productos.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'tarjeta entra';
    div.style.cursor = 'pointer';
    div.style.animationDelay = `${Math.min(i, 12) * 25}ms`;
    div.innerHTML = `<strong>${esc(p.nombre)}</strong><br>S/ ${fmt(p.precio)}`;
    div.onclick = () => agregarAlCarrito(p);
    cont.appendChild(div);
  });
}

document.getElementById('btnVolverCategorias').onclick = () => mostrarCategoriasVenta();

let ultimoAgregado = null; // la linea del carrito que "salta" al agregar
function agregarAlCarrito(p){
  if(!carrito[p.id]) carrito[p.id] = { id: p.id, name: p.nombre, price: Number(p.precio), qty: 0 };
  carrito[p.id].qty += 1;
  ultimoAgregado = p.id;
  renderCarrito();
  ultimoAgregado = null;
}

function renderCarrito(){
  const cont = document.getElementById('carritoLista');
  cont.innerHTML = '';
  let total = 0;
  Object.values(carrito).forEach(item => {
    total += item.price * item.qty;
    const div = document.createElement('div');
    div.className = 'carrito-linea' + (item.id === ultimoAgregado ? ' nuevo' : '');
    div.innerHTML = `${esc(item.name)} x${item.qty} - S/ ${fmt(item.price * item.qty)} <button style="width:auto;" data-quitar="${item.id}">Quitar</button>`;
    cont.appendChild(div);
  });
  const pct = descVenta.pct();
  const t = calcularTotales(total, pct);
  mostrarLineaDescuento('lineaDescuentoVenta', t, pct);
  document.getElementById('subTotalVenta').textContent = fmt(t.subtotal);
  document.getElementById('igvVenta').textContent = fmt(t.igv);
  ponerTotal('totalVenta', fmt(t.total));
}

document.getElementById('carritoLista').addEventListener('click', (e) => {
  const id = e.target.getAttribute('data-quitar');
  if(id){ delete carrito[id]; renderCarrito(); }
});

document.getElementById('btnGenerarBoleta').onclick = (e) => mientrasOcupado(e.currentTarget, async () => {
  const items = Object.values(carrito);
  if(items.length === 0){ alert('Agrega al menos un producto'); return; }
  const ok = await cobrar({
    items,
    metodoPago: document.getElementById('metodoPago').value,
    campoCliente: clienteVenta,
    descuentoPct: descVenta.pct()
  });
  if(!ok) return;

  carrito = {};
  clienteVenta.limpiar();
  descVenta.quitar(); // tambien vuelve a dibujar el carrito
  cargarProductosVenta();
});

// ---------- CODIGO DE BARRAS (EAN-13: cualquier lector lo lee sin configurar) ----------
const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_PARIDAD = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function digitoControlEan(doce){
  const suma = [...doce].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return String((10 - suma % 10) % 10);
}

// 95 modulos ('1' = barra negra).
function barrasEan13(codigo){
  const d = [...codigo].map(Number);
  const R = n => EAN_L[n].replace(/./g, b => (b === '0' ? '1' : '0'));
  const G = n => [...R(n)].reverse().join('');
  let bits = '101';
  for(let i = 1; i <= 6; i++) bits += EAN_PARIDAD[d[0]][i - 1] === 'L' ? EAN_L[d[i]] : G(d[i]);
  bits += '01010';
  for(let i = 7; i <= 12; i++) bits += R(d[i]);
  return bits + '101';
}

// Empieza con 2: rango de uso interno de tienda, no choca con productos reales.
function generarCodigoCliente(){
  const doce = '2' + Array.from(crypto.getRandomValues(new Uint8Array(11)), b => b % 10).join('');
  return doce + digitoControlEan(doce);
}

function dibujarCodigo(canvas, codigo, nombre){
  const m = 3, margen = 11 * m, alto = 110;
  canvas.width = 95 * m + 2 * margen;
  canvas.height = alto + 72;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.font = 'bold 16px Segoe UI, Arial';
  ctx.fillText(nombre, canvas.width / 2, 22, canvas.width - 10);
  [...barrasEan13(codigo)].forEach((b, i) => { if(b === '1') ctx.fillRect(margen + i * m, 32, m, alto); });
  ctx.font = '18px Consolas, monospace';
  ctx.fillText(codigo, canvas.width / 2, 32 + alto + 26);
}

function descargarCodigo(canvas, nombre){
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `tarjeta ${nombre.replace(/[\\/:*?"<>|]/g, '').trim() || 'cliente'}.png`;
  a.click();
}

// ---------- CLIENTES ----------
const camposCliente = ['cliNombre', 'cliApellidos', 'cliDni', 'cliTelefono', 'cliCorreo'];
let codigoNuevo = '';
let clientesCache = [];
const nombreForm = () => `${document.getElementById('cliNombre').value.trim()} ${document.getElementById('cliApellidos').value.trim()}`.trim();

async function mostrarListaClientes(){
  document.getElementById('clientesForm').classList.add('oculto');
  document.getElementById('clientesLista').classList.remove('oculto');
  const clientes = clientesCache = await window.api.clientesListar();
  const cont = document.getElementById('tablaClientes');
  cont.innerHTML = clientes.length ? '' : '<p style="color:var(--muted);">Todavía no hay clientes registrados.</p>';
  clientes.forEach(c => {
    let circulos = '';
    for(let i = 1; i <= SELLOS_TARJETA; i++){
      const premio = i === SELLOS_TARJETA;
      circulos += `<span class="sello${i <= c.sellos ? ' lleno' : ''}${premio ? ' premio' : ''}">${premio ? '50%' : ''}</span>`;
    }
    const div = document.createElement('div');
    div.className = 'cliente-fila';
    const btnCodigo = /^\d{13}$/.test(c.codigo_barras)
      ? `<button type="button" class="btn-mini" data-codigo-cliente="${c.id}">Descargar código</button>` : '';
    div.innerHTML = `<span><strong>${esc(c.nombre)} ${esc(c.apellidos)}</strong><br><small>${c.dni ? 'DNI ' + esc(c.dni) + ' · ' : ''}${esc(c.codigo_barras)}${c.telefono ? ' · ' + esc(c.telefono) : ''}</small></span>${btnCodigo}<div class="sellos">${circulos}</div>`;
    cont.appendChild(div);
  });
}

// Volver a bajar la imagen de un cliente ya registrado (por si se perdio la tarjeta).
document.getElementById('tablaClientes').addEventListener('click', (e) => {
  const c = clientesCache.find(x => x.id === Number(e.target.getAttribute('data-codigo-cliente')));
  if(!c) return;
  const canvas = document.createElement('canvas');
  const nombre = `${c.nombre} ${c.apellidos}`;
  dibujarCodigo(canvas, c.codigo_barras, nombre);
  descargarCodigo(canvas, nombre);
});

document.getElementById('btnGenerarCodigo').onclick = () => {
  codigoNuevo = generarCodigoCliente();
  dibujarCodigo(document.getElementById('codigoCanvas'), codigoNuevo, nombreForm());
  document.getElementById('codigoPreview').classList.remove('oculto');
  document.getElementById('btnGenerarCodigo').textContent = 'Generar otro código';
};
document.getElementById('btnDescargarCodigo').onclick = () => {
  const canvas = document.getElementById('codigoCanvas');
  dibujarCodigo(canvas, codigoNuevo, nombreForm()); // por si cambiaron el nombre despues de generar
  descargarCodigo(canvas, nombreForm());
};

document.getElementById('btnRegistrarCliente').onclick = () => {
  camposCliente.forEach(id => { document.getElementById(id).value = ''; });
  codigoNuevo = '';
  document.getElementById('codigoPreview').classList.add('oculto');
  document.getElementById('btnGenerarCodigo').textContent = 'Generar código de barras';
  document.getElementById('errorCliente').classList.add('oculto');
  document.getElementById('clientesLista').classList.add('oculto');
  document.getElementById('clientesForm').classList.remove('oculto');
  document.getElementById('cliNombre').focus();
};
document.getElementById('btnCancelarCliente').onclick = mostrarListaClientes;
document.getElementById('btnAnadirCliente').onclick = (e) => mientrasOcupado(e.currentTarget, async () => {
  const [nombre, apellidos, dni, telefono, correo] = camposCliente.map(id => document.getElementById(id).value.trim());
  const res = await window.api.clientesCrear({ nombre, apellidos, dni, telefono, correo, codigo: codigoNuevo });
  if(!res.ok){
    const err = document.getElementById('errorCliente');
    err.textContent = res.error;
    err.classList.remove('oculto');
    return;
  }
  mostrarListaClientes();
});

// ---------- CERRAR CAJA ----------
document.getElementById('btnCerrarCaja').onclick = async () => {
  const pendientes = await window.api.mesasPedidosListar();
  const aviso = pendientes.length
    ? `OJO: hay ${pendientes.length} pedido(s) de mesas sin cobrar (quedan guardados para la siguiente caja).\n\n`
    : '';
  if(!confirm(aviso + '¿Seguro que quieres cerrar la caja e imprimir el ticket de cierre?')) return;
  const res = await window.api.cajaCerrar();
  if(!res.ok){ alert(res.error); return; }
  const r = res.resumen;
  const fecha = new Date();
  await imprimirLineas([
    lCentro(nombreNegocio().toUpperCase(), true),
    lCentro('Ticket de cierre de caja'),
    lSep(),
    lFila('Colaborador', usuarioActual.nombre),
    lFila('Fecha', `${fecha.toLocaleDateString('es-PE')} ${fecha.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}`),
    lSep(),
    lFila('Monto inicial', `S/ ${fmt(r.montoInicial)}`),
    lFila('Ventas efectivo', `S/ ${fmt(r.efectivo)}`),
    lFila('Ventas tarjeta', `S/ ${fmt(r.tarjeta)}`),
    lFila('Ventas Yape/Plin', `S/ ${fmt(r.yape)}`),
    lFila('N. de ventas', String(r.numVentas)),
    lSep(),
    lFila('Efectivo esperado en caja', `S/ ${fmt(r.montoFinal)}`, true),
    lSep(),
    lCentro('Caja cerrada correctamente')
  ]);

  // Caja cerrada: vuelve a la pantalla de apertura (sigue con la sesion iniciada).
  cajaActual = null;
  carrito = {};
  renderCarrito();
  document.getElementById('montoInicial').value = '';
  document.getElementById('appPrincipal').classList.add('oculto');
  document.getElementById('vistaAbrirCaja').classList.remove('oculto');
};

// ---------- SALIR (sin cerrar caja; al volver a entrar se retoma la caja abierta) ----------
async function salir(){
  sessionStorage.removeItem('usuarioActual');
  await window.api.logout();
  window.location.href = 'login.html';
}
document.getElementById('btnSalir').onclick = () => {
  if(confirm('¿Salir? La caja queda abierta y podrás retomarla al volver a iniciar sesión.')) salir();
};
document.getElementById('btnSalirApertura').onclick = salir;
