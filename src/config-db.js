(async () => {
  const guardada = await window.api.dbConfigGuardada();
  if(!guardada) return;
  document.getElementById('pasoDb').classList.add('oculto');
  // Ya habia una configuracion pero no conecto (MySQL apagado, clave cambiada...).
  document.getElementById('dbHost').value = guardada.host;
  document.getElementById('dbPort').value = guardada.port;
  document.getElementById('dbUser').value = guardada.user;
  document.getElementById('dbPassword').placeholder = 'Vacío = usar la guardada';
  document.getElementById('mensaje').textContent = 'No se pudo conectar a la base de datos. Revisa que MySQL esté encendido y pulsa Conectar para reintentar.';
})();

document.getElementById('dbPassword').addEventListener('keydown', (e) => {
  if(e.key === 'Enter') document.getElementById('btnConectar').click();
});

document.getElementById('btnConectar').onclick = async () => {
  const errorEl = document.getElementById('dbError');
  const boton = document.getElementById('btnConectar');
  errorEl.classList.add('oculto');
  boton.disabled = true;
  const res = await window.api.dbConfigurar({
    host: document.getElementById('dbHost').value.trim(),
    port: document.getElementById('dbPort').value,
    user: document.getElementById('dbUser').value.trim(),
    password: document.getElementById('dbPassword').value
  });
  boton.disabled = false;
  if(!res.ok){
    errorEl.textContent = 'No se pudo conectar: ' + res.error;
    errorEl.classList.remove('oculto');
  }
};

document.getElementById('btnSalirApp').onclick = () => {
  if(confirm('¿Seguro que quieres salir del sistema?')) window.api.salirApp();
};
