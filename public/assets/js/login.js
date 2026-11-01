import { pedir } from '/assets/js/api.js';

const formulario = document.querySelector('#formulario-login');
const alerta = document.querySelector('#alerta');
const ingresar = document.querySelector('#ingresar');

function mostrarError(mensaje) {
  alerta.textContent = mensaje;
  alerta.classList.remove('d-none');
}

// Aviso de que la sesión se cerró por inactividad.
if (new URLSearchParams(location.search).get('sesion') === 'inactividad') {
  mostrarError('Tu sesión se cerró por inactividad. Volvé a iniciar sesión.');
}

// Si ya hay una sesión vigente, se va directo al panel del rol. Con el aviso de inactividad no se redirige:
// otra pestaña puede mantener viva la sesión, y esta pantalla debe mostrar el aviso.
const llegaPorInactividad = new URLSearchParams(location.search).get('sesion') === 'inactividad';
pedir('/api/sesion')
  .then((respuesta) => {
    if (respuesta.ok && !llegaPorInactividad) {
      location.replace(respuesta.datos.panel);
    }
  })
  .catch(() => {});

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  alerta.classList.add('d-none');

  const dni = formulario.dni.value.replace(/[\s.]/g, '');
  const password = formulario.password.value;
  if (!/^\d{7,8}$/.test(dni) || password === '') {
    mostrarError('Ingresá un DNI de 7 u 8 dígitos y tu contraseña.');
    return;
  }

  ingresar.disabled = true;
  try {
    const respuesta = await pedir('/api/login', { metodo: 'POST', cuerpo: { dni, password } });
    if (respuesta.ok) {
      // replace: el botón atrás no vuelve al formulario de ingreso.
      location.replace(respuesta.datos.panel);
      return;
    }
    ingresar.disabled = false;
    formulario.password.value = '';
    mostrarError(respuesta.datos?.error?.mensaje ?? 'No pudimos iniciar sesión. Intentá nuevamente.');
  } catch {
    ingresar.disabled = false;
    mostrarError('No pudimos conectar con el servidor. Intentá nuevamente.');
  }
});
