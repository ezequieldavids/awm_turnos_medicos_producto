import { pedir } from '/assets/js/api.js';
import { iniciarBarra, ROL_CORTO } from '/assets/js/barra.js';
import { sesionValida } from '/assets/js/ui.js';

const rolDeLaPagina = document.body.dataset.rol;
const alerta = document.querySelector('#alerta');
const contenido = document.querySelector('#contenido');

function mostrarError(mensaje) {
  alerta.textContent = mensaje;
  alerta.classList.remove('d-none');
}

// Título, descripción y botón de cada módulo. Los roles con vistas propias («Mi agenda», «Mis turnos») usan su nombre.
const MODULOS = {
  '/usuarios.html': ['Usuarios y Roles', 'Alta de cuentas, asignación de roles y control de acceso al sistema.'],
  '/especialidades.html': ['Especialidades Médicas', 'Catálogo centralizado de especialidades de atención médica.'],
  '/profesionales.html': ['Profesionales de la Salud', 'Administración de médicos, matrículas y asignación de especialidades.'],
  '/pacientes.html': ['Gestión de Pacientes', 'Alta, modificación y consulta de pacientes y cobertura médica.'],
  '/consultorios.html': ['Consultorios Físicos', 'Administración de consultorios, sectores y espacios de atención.'],
  '/agendas.html': ['Agendas Médicas', 'Planificación y configuración de disponibilidad horaria y consultorios.'],
  '/turnos.html': ['Gestión de Turnos', 'Asignar, confirmar, consultar y reservar turnos médicos.'],
  '/reportes.html': ['Reportes de Gestión', 'Estadísticas de ocupación, cancelaciones y ausentismo.'],
};
const PROPIOS = {
  'Mi agenda': 'Consultá la disponibilidad horaria de tus agendas y consultorios.',
  'Mis turnos': 'Consultá tus turnos y gestioná su asistencia o cancelación según tu rol.',
  'Mis datos personales': 'Consulta de tus datos personales.',
};
const BOTONES = { '/turnos.html': 'Ver turnos', '/reportes.html': 'Ver reportes' };
const ROLES_QUE_RESERVAN = ['paciente', 'recepcionista', 'administrador'];

function elemento(etiqueta, clase, texto) {
  const e = document.createElement(etiqueta);
  e.className = clase;
  if (texto !== undefined) {
    e.textContent = texto;
  }
  return e;
}

function enlace(texto, href, clase) {
  const a = elemento('a', `btn btn-sm ${clase}`, texto);
  a.href = href;
  return a;
}

function tarjeta(opcion, rol) {
  const propio = opcion.nombre in PROPIOS;
  const [titulo, descripcion] = propio || !MODULOS[opcion.ruta] ? [opcion.nombre, PROPIOS[opcion.nombre] ?? ''] : MODULOS[opcion.ruta];
  const columna = elemento('div', 'col-12 col-md-6 col-lg-4');
  const articulo = elemento('article', 'card modulo');
  articulo.append(elemento('h2', '', titulo), elemento('p', '', descripcion));
  const acciones = elemento('div', 'acciones');
  if (opcion.ruta) {
    acciones.append(enlace(BOTONES[opcion.ruta] && !propio ? BOTONES[opcion.ruta] : opcion.nombre, opcion.ruta, 'btn-outline-primary'));
    if (opcion.ruta === '/turnos.html' && ROLES_QUE_RESERVAN.includes(rol)) {
      acciones.append(enlace('+ Reservar', '/turnos.html#seccion-reserva', 'btn-primary'));
    }
  } else {
    acciones.append(elemento('span', 'badge text-bg-secondary', `Pendiente · ${opcion.feature}`));
  }
  articulo.append(acciones);
  columna.append(articulo);
  return columna;
}

function pintar({ usuario, opciones }) {
  document.querySelector('#rol-activo').textContent = ROL_CORTO[usuario.rol] ?? usuario.etiqueta.toUpperCase();
  document.querySelector('#bienvenida').textContent = `Bienvenido, ${usuario.nombre} ${usuario.apellido}`;
  document.querySelector('#opciones').replaceChildren(...opciones.map((opcion) => tarjeta(opcion, usuario.rol)));
  contenido.classList.remove('d-none');
}

function limpiar() {
  contenido.classList.add('d-none');
  document.querySelector('#opciones').replaceChildren();
  document.querySelector('#bienvenida').textContent = '';
  document.querySelector('#rol-activo').textContent = '';
}

async function cargarPanel() {
  let respuesta;
  try {
    respuesta = await pedir('/api/panel');
  } catch {
    mostrarError('No pudimos conectar con el servidor. Intentá nuevamente.');
    return;
  }

  if (!sesionValida(respuesta)) {
    return;
  }
  if (!respuesta.ok) {
    mostrarError(respuesta.datos?.error?.mensaje ?? 'No pudimos cargar el panel.');
    return;
  }

  // Cada rol tiene su panel: si la sesión corresponde a otro, se redirige al suyo.
  if (respuesta.datos.usuario.rol !== rolDeLaPagina) {
    location.replace(respuesta.datos.panel);
    return;
  }

  pintar(respuesta.datos);
}

// Al volver con el botón atrás, el panel se vuelve a consultar en la API y no se reutiliza lo mostrado.
window.addEventListener('pagehide', limpiar);
window.addEventListener('pageshow', (evento) => {
  if (evento.persisted) {
    location.reload();
  }
});

iniciarBarra();
cargarPanel();
