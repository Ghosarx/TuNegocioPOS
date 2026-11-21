const PALETAS = {
  'Café': { primary: '#3f2312', accent: '#ad1f1b', secondary: '#da9544', bg: '#faf3e8' },
  'Océano': { primary: '#1e3a5f', accent: '#0077b6', secondary: '#48cae4', bg: '#f1f7fb' },
  'Bosque': { primary: '#1b4332', accent: '#2d6a4f', secondary: '#95d5b2', bg: '#f3faf5' },
  'Uva': { primary: '#3c096c', accent: '#9d4edd', secondary: '#e0aaff', bg: '#f8f3fc' },
  'Grafito': { primary: '#212529', accent: '#e63946', secondary: '#adb5bd', bg: '#f8f9fa' }
};
const CLAVES = ['primary', 'accent', 'secondary', 'bg'];
let logo = null;

function coloresActuales() {
  return Object.fromEntries(CLAVES.map(k => [k, document.getElementById('color-' + k).value]));
}

function ponerPaleta(colores) {
  CLAVES.forEach(k => { document.getElementById('color-' + k).value = colores[k]; });
  aplicarColores(colores);
}

const contPaletas = document.getElementById('paletas');
Object.entries(PALETAS).forEach(([nombre, colores]) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'paleta';
  b.title = nombre;
  b.innerHTML = CLAVES.map(k => `<span style="background:${colores[k]}"></span>`).join('') + `<small>${esc(nombre)}</small>`;
  b.onclick = () => ponerPaleta(colores);
  contPaletas.appendChild(b);
});
CLAVES.forEach(k => document.getElementById('color-' + k).addEventListener('input', () => aplicarColores(coloresActuales())));
ponerPaleta(PALETAS['Café']);

document.getElementById('logoInput').onchange = (e) => {
  const archivo = e.target.files[0];
  if (!archivo) return;
  if (archivo.size > 2 * 1024 * 1024) {
    alert('El logo debe pesar menos de 2 MB');
    e.target.value = '';
    return;
  }
  const lector = new FileReader();
  lector.onload = () => {
    logo = lector.result;
    document.getElementById('logoPreview').src = logo;
  };
  lector.readAsDataURL(archivo);
};

document.getElementById('btnGuardar').onclick = async () => {
  const errorEl = document.getElementById('setupError');
  errorEl.classList.add('oculto');
  const res = await window.api.negocioGuardar({
    nombre: document.getElementById('nombreInput').value.trim() || 'Tu negocio',
    logo,
    colores: coloresActuales()
  });
  if (!res.ok) {
    errorEl.textContent = res.error;
    errorEl.classList.remove('oculto');
  }
};
