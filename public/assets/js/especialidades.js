import { pedir } from '/assets/js/api.js';
import { iniciarBarra } from '/assets/js/barra.js';
import { hayAvisoDeInactividad } from '/assets/js/ui.js';

const alerta = document.querySelector('#alerta');
const contenido = document.querySelector('#contenido');
const filas = document.querySelector('#filas');
const formulario = document.querySelector('#formulario');
const modal = new bootstrap.Modal(document.querySelector('#modal-formulario'));
let editandoId = null;

function mostrarError(mensaje) {
  alerta.textContent = mensaje;
  alerta.classList.remove('d-none');
}

function celda(texto) {
  const td = document.createElement('td');
  td.textContent = texto;
  return td;
}

function boton(texto, clase, accion) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn btn-sm ${clase}`;
  b.textContent = texto;
  b.addEventListener('click', accion);
  return b;
}

function pintar(especialidades) {
  filas.replaceChildren();
  for (const e of especialidades) {
    const fila = document.createElement('tr');
    fila.dataset.id = e.id;
    fila.append(celda(e.nombre), celda(e.descripcion ?? ''));

    const estado = document.createElement('td');
    const insignia = document.createElement('span');
    insignia.className = `badge ${e.activa ? 'text-bg-success' : 'text-bg-secondary'}`;
    insignia.textContent = e.activa ? 'Activa' : 'Inactiva';
    estado.append(insignia);

    const acciones = document.createElement('td');
    acciones.className = 'text-end text-nowrap';
    acciones.append(
      boton('Editar', 'btn-outline-primary', () => abrirFormulario(e)),
      boton(e.activa ? 'Desactivar' : 'Reactivar', e.activa ? 'btn-outline-danger' : 'btn-outline-success', () => cambiarEstado(e)),
    );

    fila.append(estado, acciones);
    filas.append(fila);
  }
}

function limpiarErrores() {
  document.querySelector('#error-formulario').classList.add('d-none');
  for (const campo of formulario.querySelectorAll('.form-control')) {
    campo.classList.remove('is-invalid');
  }
}

function abrirFormulario(especialidad = null) {
  editandoId = especialidad?.id ?? null;
  document.querySelector('#titulo-formulario').textContent = especialidad ? 'Editar especialidad' : 'Nueva especialidad';
  formulario.nombre.value = especialidad?.nombre ?? '';
  formulario.descripcion.value = especialidad?.descripcion ?? '';
  limpiarErrores();
  modal.show();
}

// Devuelve false si la sesión no sirve (ya se redirigió o se avisó).
function sesionValida(respuesta) {
  // Sesión vencida por inactividad: la pantalla de inicio muestra el aviso.
  if (respuesta.estado === 401 && (respuesta.datos?.error?.codigo === 'sesion_expirada' || hayAvisoDeInactividad())) {
    location.replace('/?sesion=inactividad');
    return false;
  }
  if (respuesta.estado === 401) {
    location.replace('/');
    return false;
  }
  if (respuesta.estado === 403) {
    location.replace('/');
    return false;
  }
  return true;
}

async function cargar() {
  let respuesta;
  try {
    respuesta = await pedir('/api/especialidades?estado=todas');
  } catch {
    mostrarError('No pudimos conectar con el servidor. Intentá nuevamente.');
    return;
  }
  if (!sesionValida(respuesta)) {
    return;
  }
  if (!respuesta.ok) {
    mostrarError(respuesta.datos?.error?.mensaje ?? 'No pudimos cargar las especialidades.');
    return;
  }
  alerta.classList.add('d-none');
  pintar(respuesta.datos.especialidades);
  contenido.classList.remove('d-none');
}

async function cambiarEstado(especialidad) {
  try {
    const respuesta = await pedir(`/api/especialidades/${especialidad.id}/estado`, {
      metodo: 'PUT',
      cuerpo: { activa: !especialidad.activa },
    });
    if (!sesionValida(respuesta)) {
      return;
    }
    if (!respuesta.ok) {
      mostrarError(respuesta.datos?.error?.mensaje ?? 'No pudimos cambiar el estado.');
      return;
    }
  } catch {
    mostrarError('No pudimos conectar con el servidor. Intentá nuevamente.');
    return;
  }
  await cargar();
}

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limpiarErrores();

  const cuerpo = { nombre: formulario.nombre.value, descripcion: formulario.descripcion.value };
  const ruta = editandoId === null ? '/api/especialidades' : `/api/especialidades/${editandoId}`;
  let respuesta;
  try {
    respuesta = await pedir(ruta, { metodo: editandoId === null ? 'POST' : 'PUT', cuerpo });
  } catch {
    const error = document.querySelector('#error-formulario');
    error.textContent = 'No pudimos conectar con el servidor. Intentá nuevamente.';
    error.classList.remove('d-none');
    return;
  }
  if (!sesionValida(respuesta)) {
    return;
  }

  if (!respuesta.ok) {
    const { codigo, mensaje } = respuesta.datos?.error ?? {};
    const campo = { nombre_invalido: 'nombre', nombre_duplicado: 'nombre', descripcion_invalida: 'descripcion' }[codigo];
    if (campo) {
      formulario[campo].classList.add('is-invalid');
      document.querySelector(`#error-${campo}`).textContent = mensaje;
    } else {
      const error = document.querySelector('#error-formulario');
      error.textContent = mensaje ?? 'No pudimos guardar la especialidad.';
      error.classList.remove('d-none');
    }
    return;
  }

  modal.hide();
  await cargar();
});

document.querySelector('#nueva').addEventListener('click', () => abrirFormulario());

// Un no administrador recibe 403 y vuelve a su panel vía el login (/api/sesion lo redirige).
iniciarBarra();
cargar();
