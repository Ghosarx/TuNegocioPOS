const usuarioActual = JSON.parse(sessionStorage.getItem('usuarioActual') || 'null');
if(!usuarioActual || usuarioActual.rol !== 'admin'){
  window.location.href = 'login.html';
}
document.getElementById('nombreAdmin').textContent = usuarioActual ? usuarioActual.nombre : '';

function fmt(n){ return Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const vistas = {
  inventario: document.getElementById('vistaInventario'),
  insumos: document.getElementById('vistaInsumos'),
  empleados: document.getElementById('vistaEmpleados'),
  ventas: document.getElementById('vistaVentas'),
  boleta: document.getElementById('vistaBoleta'),
  cuenta: document.getElementById('vistaCuenta')
};
const tabs = {
  inventario: document.getElementById('tabInventario'),
  insumos: document.getElementById('tabInsumos'),
  empleados: document.getElementById('tabEmpleados'),
  ventas: document.getElementById('tabVentas'),
  boleta: document.getElementById('tabBoleta'),
  cuenta: document.getElementById('tabCuenta')
};
function cambiarTab(nombre){
  Object.keys(vistas).forEach(k => vistas[k].classList.toggle('oculto', k !== nombre));
  Object.keys(tabs).forEach(k => tabs[k].classList.toggle('activo', k === nombre));
  if(nombre === 'inventario') cargarInventario();
  if(nombre === 'insumos') cargarInsumos();
  if(nombre === 'empleados') cargarEmpleados();
  if(nombre === 'ventas') cargarVentas();
  if(nombre === 'boleta') cargarConfigBoleta();
}
tabs.inventario.onclick = () => cambiarTab('inventario');
tabs.insumos.onclick = () => cambiarTab('insumos');
tabs.empleados.onclick = () => cambiarTab('empleados');
tabs.ventas.onclick = () => cambiarTab('ventas');
tabs.boleta.onclick = () => cambiarTab('boleta');
tabs.cuenta.onclick = () => cambiarTab('cuenta');

document.getElementById('btnSalir').onclick = async () => {
  sessionStorage.removeItem('usuarioActual');
  await window.api.logout();
  window.location.href = 'login.html';
};

// Con la contraseña o la pregunta de seguridad iniciales (publicas en el
// README) solo se puede usar "Mi cuenta" hasta cambiarlas; el proceso
// principal tambien bloquea todo lo demas.
const pendiente = usuarioActual && usuarioActual.pendiente;
const hayPendiente = !!(pendiente && (pendiente.password || pendiente.pregunta));
function mostrarAvisoPendiente(){
  const faltan = [pendiente.password && 'la contraseña', pendiente.pregunta && 'la pregunta y respuesta de seguridad'].filter(Boolean);
  const aviso = document.getElementById('cuentaAvisoPendiente');
  aviso.textContent = `Por seguridad, antes de usar el sistema cambia ${faltan.join(' y ')} (los valores iniciales son públicos).`;
  aviso.classList.remove('oculto');
}

// ---------- INVENTARIO ----------
function opcionesCategoria(seleccionada){
  return CATEGORIAS_PRODUCTOS.map(c =>
    `<option value="${c}"${c === seleccionada ? ' selected' : ''}>${c}</option>`
  ).join('');
}
document.getElementById('invCategoria').innerHTML = opcionesCategoria();

async function cargarInventario(){
  const productos = await window.api.inventarioListar();
  const tbody = document.getElementById('tablaInventario');
  tbody.innerHTML = '';
  productos.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" value="${esc(p.nombre)}" data-field="nombre" data-id="${p.id}"></td>
      <td><select data-field="categoria" data-id="${p.id}">${opcionesCategoria(p.categoria)}</select></td>
      <td><input type="number" step="0.01" value="${p.precio}" data-field="precio" data-id="${p.id}" style="width:80px;"></td>
      <td>
        <button style="width:auto;" data-guardar="${p.id}">Guardar</button>
        <button style="width:auto;" class="peligro" data-eliminar="${p.id}">Quitar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('btnAgregarProducto').onclick = async () => {
  const nombre = document.getElementById('invNombre').value.trim();
  const categoria = document.getElementById('invCategoria').value.trim();
  const precio = parseFloat(document.getElementById('invPrecio').value);
  if(!nombre || !categoria || isNaN(precio)) { alert('Completa nombre, categoría y precio'); return; }
  await window.api.inventarioAgregar({ nombre, categoria, precio });
  document.getElementById('invNombre').value = '';
  document.getElementById('invCategoria').selectedIndex = 0;
  document.getElementById('invPrecio').value = '';
  cargarInventario();
};

document.getElementById('tablaInventario').addEventListener('click', async (e) => {
  const idGuardar = e.target.getAttribute('data-guardar');
  const idEliminar = e.target.getAttribute('data-eliminar');
  if(idGuardar){
    const fila = e.target.closest('tr');
    const nombre = fila.querySelector('[data-field="nombre"]').value;
    const categoria = fila.querySelector('[data-field="categoria"]').value;
    const precio = parseFloat(fila.querySelector('[data-field="precio"]').value);
    await window.api.inventarioActualizar({ id: Number(idGuardar), nombre, categoria, precio });
    cargarInventario();
  }
  if(idEliminar){
    if(confirm('¿Quitar este producto del inventario?')){
      await window.api.inventarioEliminar({ id: Number(idEliminar) });
      cargarInventario();
    }
  }
});

// ---------- INSUMOS (inventario contable, KG/LT) ----------
function fmtCantidad(n){ return Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 3 }); }

async function cargarInsumos(){
  const [insumos, recetas] = await Promise.all([window.api.insumosListar(), window.api.recetasListar()]);
  const porProducto = new Map();
  recetas.forEach(r => {
    if(!porProducto.has(r.producto)) porProducto.set(r.producto, []);
    porProducto.get(r.producto).push(`${esc(r.insumo)} ${fmtCantidad(r.cantidad)} ${r.unidad}`);
  });
  document.getElementById('tablaRecetas').innerHTML = [...porProducto]
    .map(([prod, items]) => `<tr><td>${esc(prod)}</td><td>${items.join(', ')}</td></tr>`).join('');
  const tbody = document.getElementById('tablaInsumos');
  tbody.innerHTML = '';
  insumos.forEach(i => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" value="${esc(i.nombre)}" data-field="nombre" data-id="${i.id}"></td>
      <td>
        <select data-field="unidad" data-id="${i.id}">
          <option value="KG"${i.unidad === 'KG' ? ' selected' : ''}>KG</option>
          <option value="LT"${i.unidad === 'LT' ? ' selected' : ''}>LT</option>
          <option value="UND"${i.unidad === 'UND' ? ' selected' : ''}>UND</option>
        </select>
      </td>
      <td><strong data-cantidad="${i.id}">${fmtCantidad(i.cantidad)}</strong> ${i.unidad}${Number(i.cantidad) <= 0 ? ' <span class="badge warn">Sin stock</span>' : ''}</td>
      <td style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
        <button style="width:auto;" data-menos="${i.id}">-1</button>
        <button style="width:auto;" data-mas="${i.id}">+1</button>
        <input type="number" step="0.01" min="0" placeholder="Cant." style="width:70px; margin:0;" data-personalizada="${i.id}">
        <button style="width:auto;" data-agregar-cant="${i.id}">Agregar</button>
        <button style="width:auto;" class="secundario" data-quitar-cant="${i.id}">Quitar</button>
        <button style="width:auto;" data-guardar-insumo="${i.id}">Guardar</button>
        <button style="width:auto;" class="peligro" data-eliminar-insumo="${i.id}">Quitar insumo</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('btnAgregarInsumo').onclick = async () => {
  const nombre = document.getElementById('insNombre').value.trim();
  const unidad = document.getElementById('insUnidad').value;
  const cantidad = parseFloat(document.getElementById('insCantidad').value || '0');
  if(!nombre || isNaN(cantidad) || cantidad < 0){ alert('Completa el nombre y una cantidad válida'); return; }
  await window.api.insumosAgregar({ nombre, unidad, cantidad });
  document.getElementById('insNombre').value = '';
  document.getElementById('insCantidad').value = '0';
  cargarInsumos();
};

document.getElementById('tablaInsumos').addEventListener('click', async (e) => {
  const idMenos = e.target.getAttribute('data-menos');
  const idMas = e.target.getAttribute('data-mas');
  const idAgregarCant = e.target.getAttribute('data-agregar-cant');
  const idQuitarCant = e.target.getAttribute('data-quitar-cant');
  const idGuardar = e.target.getAttribute('data-guardar-insumo');
  const idEliminar = e.target.getAttribute('data-eliminar-insumo');

  if(idMenos){
    await window.api.insumosAjustar({ id: Number(idMenos), delta: -1 });
    cargarInsumos();
  }
  if(idMas){
    await window.api.insumosAjustar({ id: Number(idMas), delta: 1 });
    cargarInsumos();
  }
  if(idAgregarCant || idQuitarCant){
    const id = idAgregarCant || idQuitarCant;
    const fila = e.target.closest('tr');
    const input = fila.querySelector(`[data-personalizada="${id}"]`);
    const cantidad = parseFloat(input.value);
    if(isNaN(cantidad) || cantidad <= 0){ alert('Ingresa una cantidad válida'); return; }
    const delta = idAgregarCant ? cantidad : -cantidad;
    await window.api.insumosAjustar({ id: Number(id), delta });
    cargarInsumos();
  }
  if(idGuardar){
    const fila = e.target.closest('tr');
    const nombre = fila.querySelector('[data-field="nombre"]').value.trim();
    const unidad = fila.querySelector('[data-field="unidad"]').value;
    if(!nombre){ alert('El nombre no puede estar vacío'); return; }
    await window.api.insumosActualizar({ id: Number(idGuardar), nombre, unidad });
    cargarInsumos();
  }
  if(idEliminar){
    if(confirm('¿Quitar este insumo del inventario contable?')){
      await window.api.insumosEliminar({ id: Number(idEliminar) });
      cargarInsumos();
    }
  }
});

// ---------- EMPLEADOS ----------
async function cargarEmpleados(){
  const empleados = await window.api.empleadosListar();
  const tbody = document.getElementById('tablaEmpleados');
  tbody.innerHTML = '';
  empleados.forEach(emp => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(emp.nombre)}</td>
      <td>${esc(emp.usuario)}</td>
      <td><span class="badge ${emp.activo ? 'ok' : 'off'}">${emp.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td>
        <button style="width:auto;" data-cambiar-password="${emp.id}" data-nombre="${esc(emp.nombre)}">Cambiar contraseña</button>
        ${emp.activo
          ? `<button style="width:auto;" class="peligro" data-desactivar="${emp.id}">Desactivar</button>`
          : `<button style="width:auto;" data-reactivar="${emp.id}">Reactivar</button>`}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('btnCrearEmpleado').onclick = async () => {
  const nombre = document.getElementById('empNombre').value.trim();
  const usuario = document.getElementById('empUsuario').value.trim();
  const password = document.getElementById('empPassword').value;
  const errorEl = document.getElementById('empError');
  errorEl.classList.add('oculto');
  if(!nombre || !usuario || !password){
    errorEl.textContent = 'Completa todos los campos';
    errorEl.classList.remove('oculto');
    return;
  }
  const res = await window.api.empleadosCrear({ nombre, usuario, password });
  if(!res.ok){
    errorEl.textContent = res.error;
    errorEl.classList.remove('oculto');
    return;
  }
  ['empNombre','empUsuario','empPassword'].forEach(id => document.getElementById(id).value = '');
  cargarEmpleados();
};

document.getElementById('tablaEmpleados').addEventListener('click', async (e) => {
  const idDesactivar = e.target.getAttribute('data-desactivar');
  const idReactivar = e.target.getAttribute('data-reactivar');
  const idCambiarPassword = e.target.getAttribute('data-cambiar-password');
  if(idDesactivar){
    await window.api.empleadosDesactivar({ id: Number(idDesactivar) });
    cargarEmpleados();
  }
  if(idReactivar){
    await window.api.empleadosReactivar({ id: Number(idReactivar) });
    cargarEmpleados();
  }
  if(idCambiarPassword){
    const nombre = e.target.getAttribute('data-nombre');
    const nuevaPassword = prompt(`Nueva contraseña para ${nombre}:`);
    if(nuevaPassword === null) return;
    if(!nuevaPassword.trim()){
      alert('La contraseña no puede estar vacía');
      return;
    }
    const res = await window.api.empleadosCambiarPassword({ id: Number(idCambiarPassword), nuevaPassword: nuevaPassword.trim() });
    if(!res.ok){ alert(res.error); return; }
    alert('Contraseña actualizada correctamente');
  }
});

// ---------- VENTAS (con calendario para elegir el dia) ----------
function fechaLocalHoy(){
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}
function fechaInputAEsPe(fechaYmd){
  const [y, m, d] = fechaYmd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-PE');
}
const inputVentasFecha = document.getElementById('ventasFecha');
inputVentasFecha.value = fechaLocalHoy();
inputVentasFecha.addEventListener('change', () => cargarVentas());

async function cargarVentas(){
  const fecha = inputVentasFecha.value || fechaLocalHoy();
  const { ventas, totalDia, numVentas } = await window.api.ventasDelDia({ fecha });
  document.getElementById('totalDia').textContent = fmt(totalDia);
  document.getElementById('numVentasDia').textContent = numVentas;
  const tbody = document.getElementById('tablaVentas');
  tbody.innerHTML = '';
  // Monto descontado = suma de productos - total cobrado (las devueltas no cuentan).
  const montoDescuento = v => Number(v.descuento_pct) > 0 ? Number(v.bruto) - Number(v.total) : 0;
  const descuentosDia = ventas.filter(v => v.estado === 'completada').reduce((s, v) => s + montoDescuento(v), 0);
  document.getElementById('descuentosDia').textContent = fmt(descuentosDia);
  ventas.forEach(v => {
    const hora = new Date(v.fecha).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    const tr = document.createElement('tr');
    const estadoBadge = v.estado === 'devuelta'
      ? '<span class="badge warn">Devuelta</span>'
      : '<span class="badge ok">Completada</span>';
    const descuento = Number(v.descuento_pct) > 0 ? `${Number(v.descuento_pct)}% (-S/ ${fmt(montoDescuento(v))})` : '-';
    tr.innerHTML = `<td>${v.numero_boleta}</td><td>${hora}</td><td>${esc(v.nombre_empleado)}</td><td>${esc(v.cliente || '-')}</td><td>${esc(v.dni || '-')}</td><td>${esc(v.metodo_pago)}</td><td>${descuento}</td><td>S/ ${fmt(v.total)}</td><td>${estadoBadge}</td><td><button style="width:auto;" class="secundario" data-reimprimir="${v.id}">Reimprimir</button></td>`;
    tbody.appendChild(tr);
  });
  window._ventasDelDiaCache = { ventas, totalDia, numVentas, fecha, descuentosDia };
}

document.getElementById('tablaVentas').addEventListener('click', async (e) => {
  const idReimprimir = e.target.getAttribute('data-reimprimir');
  if(idReimprimir) await reimprimirVenta(Number(idReimprimir));
});

document.getElementById('btnImprimirResumen').onclick = () => {
  const data = window._ventasDelDiaCache;
  if(!data) return;
  const fecha = fechaInputAEsPe(data.fecha);
  const lineas = [
    lCentro(nombreNegocio().toUpperCase(), true),
    lSep(),
    lCentro('RESUMEN DE VENTAS DEL DÍA', true),
    lCentro('FECHA DE EMISIÓN: ' + fecha),
    lSep(),
    lFila('Boleta', 'Total')
  ];
  // Incluye tambien las boletas devueltas (marcadas aparte), para que el
  // resumen impreso refleje toda la actividad del dia, no solo lo cobrado.
  data.ventas.forEach(v => {
    const etiqueta = v.estado === 'devuelta' ? `${v.numero_boleta} (DEVUELTA)` : v.numero_boleta;
    lineas.push(lFila(etiqueta, `S/ ${fmt(v.total)}`));
  });
  lineas.push(
    lSep(),
    lFila('TOTAL DEL DÍA', `S/ ${fmt(data.totalDia)}`, true),
    lFila('N. de ventas', String(data.numVentas))
  );
  if (data.descuentosDia > 0) lineas.push(lFila('Descuentos', `S/ ${fmt(data.descuentosDia)}`));
  imprimirLineas(lineas);
};

// ---------- CONFIGURACION DE BOLETA ----------
async function cargarConfigBoleta(){
  const config = await window.api.configBoletaObtener();
  document.getElementById('boletaAncho').value = config.ancho_mm;
  document.getElementById('boletaAlto').value = config.alto_mm;
  document.getElementById('boletaFuente').value = config.fuente;
  document.getElementById('boletaNegrita').checked = !!Number(config.negrita);
  await cargarImpresoras(config.impresora_nombre);
  actualizarPreviewBoleta();
}

async function cargarImpresoras(seleccionada){
  const select = document.getElementById('boletaImpresora');
  try {
    const impresoras = await window.api.listarImpresoras();
    select.innerHTML = '';
    if(impresoras.length === 0){
      select.innerHTML = '<option value="">No se encontró ninguna impresora</option>';
      return;
    }
    // Sin esta opcion vacia el select quedaba en la primera impresora de la
    // lista (a veces "OneNote" u otra virtual) y al guardar la configuracion
    // se grababa esa sin que nadie la hubiera elegido.
    const vacia = document.createElement('option');
    vacia.value = '';
    vacia.textContent = '-- Elige la impresora térmica --';
    select.appendChild(vacia);
    impresoras.forEach(p => {
      const op = document.createElement('option');
      op.value = p.name;
      op.textContent = p.name + (p.isDefault ? ' (predeterminada en Windows)' : '');
      select.appendChild(op);
    });
    if(seleccionada && impresoras.some(p => p.name === seleccionada)){
      select.value = seleccionada;
    } else if(seleccionada){
      // La guardada ya no existe en este equipo: se muestra para que se vea
      // el problema, pero queda sin elegir hasta que el admin escoja otra.
      const op = document.createElement('option');
      op.value = '';
      op.textContent = seleccionada + ' (ya no existe en este equipo)';
      op.disabled = true;
      select.insertBefore(op, vacia.nextSibling);
      select.value = '';
    } else {
      select.value = '';
    }
  } catch (err) {
    select.innerHTML = '<option value="">Error al listar impresoras</option>';
  }
}

function actualizarPreviewBoleta(){
  const ancho = parseFloat(document.getElementById('boletaAncho').value) || 72.1;
  const fuente = document.getElementById('boletaFuente').value;
  const negrita = document.getElementById('boletaNegrita').checked;
  const preview = document.getElementById('boletaPreview');
  preview.style.width = ancho + 'mm';
  preview.style.fontFamily = `'${fuente}', monospace`;
  preview.style.fontWeight = negrita ? '700' : '400';
}
['boletaAncho', 'boletaFuente', 'boletaNegrita'].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('input', actualizarPreviewBoleta);
  el.addEventListener('change', actualizarPreviewBoleta);
});

document.getElementById('btnGuardarBoleta').onclick = async () => {
  const anchoMm = parseFloat(document.getElementById('boletaAncho').value);
  const altoMm = parseFloat(document.getElementById('boletaAlto').value);
  const fuente = document.getElementById('boletaFuente').value;
  const negrita = document.getElementById('boletaNegrita').checked;
  const impresoraNombre = document.getElementById('boletaImpresora').value || null;
  const errorEl = document.getElementById('boletaError');
  const exitoEl = document.getElementById('boletaExito');
  errorEl.classList.add('oculto');
  exitoEl.classList.add('oculto');
  if(isNaN(anchoMm) || anchoMm <= 0 || isNaN(altoMm) || altoMm <= 0){
    errorEl.textContent = 'Ingresa un ancho y alto válidos';
    errorEl.classList.remove('oculto');
    return;
  }
  if(!impresoraNombre){
    errorEl.textContent = 'Elige la impresora térmica donde se imprimirán las boletas';
    errorEl.classList.remove('oculto');
    return;
  }
  if(!confirm('¿Guardar esta configuración de boleta? Se aplicará a todas las impresiones (venta, cierre de caja, devolución y resumen del día).')) return;
  try {
    const res = await window.api.configBoletaGuardar({ anchoMm, altoMm, fuente, negrita, impresoraNombre });
    if(!res.ok){
      errorEl.textContent = res.error || 'No se pudo guardar la configuración';
      errorEl.classList.remove('oculto');
      return;
    }
    aplicarConfigBoleta({ ancho_mm: anchoMm, alto_mm: altoMm, fuente, negrita: negrita ? 1 : 0 });
    exitoEl.textContent = 'Configuración guardada. Se aplicará a todas las boletas.';
    exitoEl.classList.remove('oculto');
  } catch (err) {
    errorEl.textContent = 'Error inesperado al guardar: ' + err.message;
    errorEl.classList.remove('oculto');
  }
};

// ---------- PRUEBA DE IMPRESION ----------
// Contenido de prueba para cada tipo de boleta, bien marcado como "PRUEBA"
// para que no se confunda con una venta real. Se imprime uno a la vez (un
// clic = una impresion), no las 4 seguidas, para poder revisar el papel
// entre cada una antes de seguir.
const PRUEBAS_BOLETA = [
  {
    tipo: 'venta',
    etiqueta: 'Venta',
    generar(){
      const subtotal = 14.00 / 1.18;
      const igv = 14.00 - subtotal;
      return [
        lCentro(nombreNegocio().toUpperCase(), true),
        lSep(),
        lCentro('*** PRUEBA DE IMPRESIÓN ***', true),
        lCentro('PRUEBA-000000'),
        lCentro(`FECHA DE EMISIÓN: ${new Date().toLocaleDateString('es-PE')} HORA:${new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}`),
        lSep(),
        lCentro('Descripción'),
        lFila('Cantidad x P.Unitario', 'Total'),
        lTexto('Cafe Americano', true),
        lFila('2 x S/ 5.00', 'S/ 10.00'),
        lTexto('Alfajor', true),
        lFila('1 x S/ 4.00', 'S/ 4.00'),
        lSep(),
        lFila('OP. GRAVADA', `S/ ${fmt(subtotal)}`),
        lFila('IGV (18%)', `S/ ${fmt(igv)}`),
        lFila('IMPORTE TOTAL', 'S/ 14.00', true),
        lSep(),
        lCentro(montoEnLetras(14.00)),
        lSep(),
        lFila('Tipo de pago', 'Efectivo'),
        lFila('Atendido por', 'Prueba'),
        lSep(),
        lCentro('Boleta de prueba - no es una venta real')
      ];
    }
  },
  {
    tipo: 'devolucion',
    etiqueta: 'Devolución',
    generar(){
      const subtotal = 10.00 / 1.18;
      const igv = 10.00 - subtotal;
      return [
        lCentro(nombreNegocio().toUpperCase(), true),
        lSep(),
        lCentro('*** PRUEBA - DEVOLUCIÓN ***', true),
        lCentro('Boleta original: PRUEBA-000000'),
        lCentro(`FECHA DE EMISIÓN: ${new Date().toLocaleDateString('es-PE')} HORA:${new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}`),
        lSep(),
        lCentro('Descripción'),
        lFila('Cantidad x P.Unitario', 'Total'),
        lTexto('Cafe Americano', true),
        lFila('2 x S/ 5.00', 'S/ 10.00'),
        lSep(),
        lFila('OP. GRAVADA', `S/ ${fmt(subtotal)}`),
        lFila('IGV (18%)', `S/ ${fmt(igv)}`),
        lFila('TOTAL DEVUELTO', 'S/ 10.00', true),
        lSep(),
        lCentro(montoEnLetras(10.00)),
        lSep(),
        lFila('Tipo de pago', 'Efectivo'),
        lFila('Atendido por', 'Prueba'),
        lSep(),
        lCentro('Boleta de prueba - no es una devolución real')
      ];
    }
  },
  {
    tipo: 'cierre',
    etiqueta: 'Cierre de caja',
    generar(){
      return [
        lCentro(nombreNegocio().toUpperCase(), true),
        lCentro('*** PRUEBA - Ticket de cierre de caja ***'),
        lSep(),
        lFila('Colaborador', 'Prueba'),
        lFila('Fecha', `${new Date().toLocaleDateString('es-PE')} ${new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}`),
        lSep(),
        lFila('Monto inicial', 'S/ 50.00'),
        lFila('Ventas efectivo', 'S/ 20.00'),
        lFila('Ventas tarjeta', 'S/ 15.00'),
        lFila('Ventas Yape/Plin', 'S/ 8.00'),
        lFila('N. de ventas', '3'),
        lSep(),
        lFila('Efectivo esperado en caja', 'S/ 70.00', true),
        lSep(),
        lCentro('Boleta de prueba - no es un cierre real')
      ];
    }
  },
  {
    tipo: 'resumen',
    etiqueta: 'Resumen del día',
    generar(){
      return [
        lCentro(nombreNegocio().toUpperCase(), true),
        lCentro('*** PRUEBA - Resumen de ventas del día ***'),
        lCentro(new Date().toLocaleDateString('es-PE')),
        lSep(),
        lFila('Boleta', 'Total'),
        lFila('PRUEBA-000001', 'S/ 14.00'),
        lFila('PRUEBA-000002 (DEVUELTA)', 'S/ 10.00'),
        lSep(),
        lFila('TOTAL DEL DÍA', 'S/ 14.00', true),
        lFila('N. de ventas', '2'),
        lSep(),
        lCentro('Boleta de prueba - no es un resumen real')
      ];
    }
  }
];
let pruebaBoletaIndice = 0;

function actualizarEtiquetaPruebaSiguiente(){
  document.getElementById('pruebaSiguienteTipo').textContent = PRUEBAS_BOLETA[pruebaBoletaIndice].etiqueta;
}
actualizarEtiquetaPruebaSiguiente();

document.getElementById('btnImprimirPrueba').onclick = async () => {
  const prueba = PRUEBAS_BOLETA[pruebaBoletaIndice];
  await imprimirLineas(prueba.generar());
  pruebaBoletaIndice = (pruebaBoletaIndice + 1) % PRUEBAS_BOLETA.length;
  actualizarEtiquetaPruebaSiguiente();
};

// ---------- MI CUENTA ----------
const CAMPOS_CUENTA = ['cuentaPassActual', 'cuentaPassNueva', 'cuentaPregunta', 'cuentaRespuesta'];

document.getElementById('btnCambiarMiPassword').onclick = async () => {
  const [passwordActual, nuevaPassword, pregunta, respuesta] = CAMPOS_CUENTA.map(id => document.getElementById(id).value);
  const errorEl = document.getElementById('cuentaError');
  const exitoEl = document.getElementById('cuentaExito');
  errorEl.classList.add('oculto');
  exitoEl.classList.add('oculto');
  if(!passwordActual){
    errorEl.textContent = 'Ingresa tu contraseña actual';
    errorEl.classList.remove('oculto');
    return;
  }
  const res = await window.api.cambiarPasswordPropia({ passwordActual, nuevaPassword, pregunta, respuesta });
  if(!res.ok){
    errorEl.textContent = res.error;
    errorEl.classList.remove('oculto');
    return;
  }
  CAMPOS_CUENTA.forEach(id => document.getElementById(id).value = '');
  if(hayPendiente){
    usuarioActual.pendiente = res.pendiente;
    sessionStorage.setItem('usuarioActual', JSON.stringify(usuarioActual));
    if(!res.pendiente.password && !res.pendiente.pregunta){
      alert('Datos actualizados. Ya puedes usar el sistema.');
      window.location.reload();
      return;
    }
    Object.assign(pendiente, res.pendiente);
    mostrarAvisoPendiente();
  }
  exitoEl.textContent = 'Datos actualizados correctamente';
  exitoEl.classList.remove('oculto');
};

if(hayPendiente){
  Object.keys(tabs).forEach(k => { if(k !== 'cuenta') tabs[k].classList.add('oculto'); });
  mostrarAvisoPendiente();
  cambiarTab('cuenta');
} else {
  cargarYAplicarConfigBoleta();
  cargarInventario();
}
