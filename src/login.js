// Volver al login siempre cierra la sesion anterior (tambien en el proceso principal).
sessionStorage.removeItem('usuarioActual');
window.api.logout();

const vistaLogin = document.getElementById('vistaLogin');
const vistaRec1 = document.getElementById('vistaRecuperarPaso1');
const vistaRec2 = document.getElementById('vistaRecuperarPaso2');

function mostrar(vista){
  [vistaLogin, vistaRec1, vistaRec2].forEach(v => v.classList.add('oculto'));
  vista.classList.remove('oculto');
}

// Permite enviar cada formulario con Enter en vez de tener que hacer clic en el boton.
function enviarConEnter(idsInputs, idBoton){
  idsInputs.forEach(id => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if(e.key === 'Enter'){
        e.preventDefault();
        document.getElementById(idBoton).click();
      }
    });
  });
}
enviarConEnter(['loginUsuario', 'loginPassword'], 'btnLogin');
enviarConEnter(['recUsuario'], 'btnBuscarPregunta');
enviarConEnter(['recRespuesta', 'recNuevaPassword'], 'btnCambiarPassword');

document.getElementById('btnSalirApp').onclick = () => {
  if(confirm('¿Seguro que quieres salir del sistema?')){
    window.api.salirApp();
  }
};

document.getElementById('irRecuperar').onclick = () => mostrar(vistaRec1);
document.getElementById('volverLogin1').onclick = () => mostrar(vistaLogin);
document.getElementById('volverLogin2').onclick = () => mostrar(vistaLogin);

document.getElementById('btnLogin').onclick = async () => {
  const usuario = document.getElementById('loginUsuario').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');
  errorEl.classList.add('oculto');
  if(!usuario || !password){
    errorEl.textContent = 'Completa usuario y contraseña';
    errorEl.classList.remove('oculto');
    return;
  }
  const res = await window.api.login({ usuario, password });
  if(!res.ok){
    errorEl.textContent = res.error;
    errorEl.classList.remove('oculto');
    return;
  }
  sessionStorage.setItem('usuarioActual', JSON.stringify(res.user));
  if(res.user.rol === 'admin'){
    window.location.href = 'admin.html';
  } else {
    window.location.href = 'empleado.html';
  }
};

let usuarioParaRecuperar = '';

document.getElementById('btnBuscarPregunta').onclick = async () => {
  const usuario = document.getElementById('recUsuario').value.trim();
  const errorEl = document.getElementById('recError1');
  errorEl.classList.add('oculto');
  const res = await window.api.obtenerPreguntaSeguridad({ usuario });
  if(!res.ok){
    errorEl.textContent = res.error;
    errorEl.classList.remove('oculto');
    return;
  }
  usuarioParaRecuperar = usuario;
  document.getElementById('preguntaTexto').textContent = res.pregunta;
  mostrar(vistaRec2);
};

document.getElementById('btnCambiarPassword').onclick = async () => {
  const respuesta = document.getElementById('recRespuesta').value.trim();
  const nuevaPassword = document.getElementById('recNuevaPassword').value;
  const errorEl = document.getElementById('recError2');
  const exitoEl = document.getElementById('recExito');
  errorEl.classList.add('oculto');
  exitoEl.classList.add('oculto');
  if(!respuesta || !nuevaPassword){
    errorEl.textContent = 'Completa ambos campos';
    errorEl.classList.remove('oculto');
    return;
  }
  const res = await window.api.recuperarPassword({ usuario: usuarioParaRecuperar, respuesta, nuevaPassword });
  if(!res.ok){
    errorEl.textContent = res.error;
    errorEl.classList.remove('oculto');
    return;
  }
  exitoEl.textContent = 'Contraseña actualizada. Ya puedes ingresar.';
  exitoEl.classList.remove('oculto');
  setTimeout(() => mostrar(vistaLogin), 1500);
};
