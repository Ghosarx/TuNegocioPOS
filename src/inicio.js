const $ = (id) => document.getElementById(id);
let usuarioCreado = null;

function mostrarError(id, mensaje) {
  $(id).textContent = mensaje;
  $(id).classList.toggle('oculto', !mensaje);
}

$('btnCrearAdmin').onclick = async () => {
  mostrarError('adminError', '');
  if ($('adminPassword').value !== $('adminPassword2').value) {
    mostrarError('adminError', 'Las contraseñas no coinciden');
    return;
  }
  $('btnCrearAdmin').disabled = true;
  const res = await window.api.adminInicialCrear({
    nombre: $('adminNombre').value,
    usuario: $('adminUsuario').value,
    password: $('adminPassword').value,
    pregunta: $('adminPregunta').value,
    respuesta: $('adminRespuesta').value
  });
  $('btnCrearAdmin').disabled = false;
  if (!res.ok) {
    mostrarError('adminError', res.error);
    return;
  }
  usuarioCreado = res.user;
  sessionStorage.setItem('usuarioActual', JSON.stringify(usuarioCreado));
  $('pasoAdmin').classList.add('oculto');
  $('pasoImpresora').classList.remove('oculto');
  cargarImpresoras();
};

$('adminRespuesta').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btnCrearAdmin').click();
});

async function cargarImpresoras() {
  const select = $('impresoraSelect');
  const impresoras = await window.api.listarImpresoras();
  if (impresoras.length === 0) {
    select.innerHTML = '<option value="">No se encontró ninguna impresora</option>';
    return;
  }
  const virtual = /pdf|onenote|fax|xps/i;
  const sugerida = impresoras.find(p => p.isDefault && !virtual.test(p.name)) || impresoras.find(p => !virtual.test(p.name));
  select.innerHTML = '<option value="">-- Elige tu impresora --</option>' + impresoras
    .map(p => `<option value="${esc(p.name)}"${p === sugerida ? ' selected' : ''}>${esc(p.name)}${p.isDefault ? ' (predeterminada)' : ''}</option>`)
    .join('');
}

async function guardarImpresora() {
  mostrarError('impresoraError', '');
  $('impresoraExito').classList.add('oculto');
  const impresoraNombre = $('impresoraSelect').value;
  if (!impresoraNombre) {
    mostrarError('impresoraError', 'Elige una impresora');
    return false;
  }
  const config = await window.api.configBoletaObtener();
  const res = await window.api.configBoletaGuardar({
    anchoMm: Number($('papelSelect').value),
    altoMm: config.alto_mm,
    fuente: config.fuente,
    negrita: !!Number(config.negrita),
    impresoraNombre
  });
  if (!res.ok) mostrarError('impresoraError', res.error);
  return res.ok;
}

$('btnPrueba').onclick = async () => {
  if (!(await guardarImpresora())) return;
  const papel = $('papelSelect').selectedOptions[0].textContent.split(' (')[0];
  const res = await imprimirLineas([
    lCentro(nombreNegocio().toUpperCase(), true),
    lSep(),
    lCentro('IMPRESIÓN DE PRUEBA', true),
    lFila('Papel', papel),
    lFila('Producto de ejemplo', 'S/ 10.00'),
    lTexto('Tildes: áéíóú ñ'),
    lSep(),
    lCentro('Si lees esto, la impresora funciona')
  ]);
  if (res.ok) {
    $('impresoraExito').textContent = 'Prueba enviada. Si salió mal cortada o desalineada, prueba con el otro ancho de papel.';
    $('impresoraExito').classList.remove('oculto');
  }
};

$('btnFinalizar').onclick = async () => {
  if (await guardarImpresora()) window.location.href = 'admin.html';
};

$('btnOmitir').onclick = () => {
  window.location.href = 'admin.html';
};
