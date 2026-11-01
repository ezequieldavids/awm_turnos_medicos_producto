import { pedir } from '/assets/js/api.js';
import { iniciarInactividad } from '/assets/js/inactividad.js';

// Barra superior común: usuario y rol de la sesión, y cierre de sesión con confirmación.
export const ROL_CORTO = { administrador: 'ADMIN', recepcionista: 'RECEPCIÓN', profesional: 'PROFESIONAL', paciente: 'PACIENTE' };

function mostrarError(mensaje) {
  const alerta = document.querySelector('#alerta');
  if (alerta) {
    alerta.textContent = mensaje;
    alerta.classList.remove('d-none');
  }
}

function crearDialogo() {
  const dialogo = document.createElement('dialog');
  dialogo.id = 'dialogo-cerrar-sesion';
  dialogo.className = 'dialogo';
  dialogo.setAttribute('aria-labelledby', 'titulo-cerrar-sesion');
  dialogo.innerHTML = `
    <div class="dialogo-cabecera">
      <h2 id="titulo-cerrar-sesion">Cerrar Sesión</h2>
      <button type="button" class="btn-close" id="dialogo-x" aria-label="Cerrar"></button>
    </div>
    <div class="dialogo-cuerpo">¿Está seguro de que desea cerrar sesión?</div>
    <div class="dialogo-pie">
      <button type="button" class="btn btn-outline-secondary" id="cancelar-cerrar-sesion">Cancelar</button>
      <button type="button" class="btn btn-danger" id="confirmar-cerrar-sesion">Cerrar Sesión</button>
    </div>`;
  document.body.append(dialogo);
  return dialogo;
}

async function cerrarSesion(dialogo, confirmar) {
  confirmar.disabled = true;
  try {
    const respuesta = await pedir('/api/logout', { metodo: 'POST' });
    // 401: la sesión ya no existía; en ambos casos no debe quedar una pantalla abierta.
    if (respuesta.ok || respuesta.estado === 401) {
      // assign (no replace): el historial conserva la pantalla para comprobar que atrás no muestra datos.
      location.assign('/');
      return;
    }
    mostrarError(respuesta.datos?.error?.mensaje ?? 'No pudimos cerrar la sesión. Intentá nuevamente.');
  } catch {
    mostrarError('No pudimos cerrar la sesión. Intentá nuevamente.');
  }
  confirmar.disabled = false;
  dialogo.close();
}

// Devuelve los datos de /api/sesion (o null si no hay sesión o falló la consulta).
export async function iniciarBarra() {
  const dialogo = crearDialogo();
  const confirmar = dialogo.querySelector('#confirmar-cerrar-sesion');
  document.querySelector('#cerrar-sesion').addEventListener('click', () => dialogo.showModal());
  dialogo.querySelector('#cancelar-cerrar-sesion').addEventListener('click', () => dialogo.close());
  dialogo.querySelector('#dialogo-x').addEventListener('click', () => dialogo.close());
  confirmar.addEventListener('click', () => cerrarSesion(dialogo, confirmar));

  // Al salir de la pantalla no queda el nombre en el historial (se vuelve a consultar al regresar).
  window.addEventListener('pagehide', () => {
    document.querySelector('#usuario-nombre').textContent = '';
    document.querySelector('#usuario-rol').textContent = '';
  });

  try {
    const respuesta = await pedir('/api/sesion');
    if (!respuesta.ok) {
      return null;
    }
    const { usuario, panel } = respuesta.datos;
    document.querySelector('#usuario-nombre').textContent = `${usuario.nombre} ${usuario.apellido}`;
    document.querySelector('#usuario-rol').textContent = ROL_CORTO[usuario.rol] ?? usuario.etiqueta.toUpperCase();
    const volver = document.querySelector('#volver');
    if (volver && panel) {
      volver.href = panel;
    }
    iniciarInactividad(respuesta.datos.inactividadSegundos);
    return respuesta.datos;
  } catch {
    return null; // el enlace por defecto lleva al inicio
  }
}
