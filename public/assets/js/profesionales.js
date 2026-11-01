import { pedir } from '/assets/js/api.js';
import { parametroEstado, filtrarEstado, celdaDestacada, celdaContacto, celdaInsignias, alerta, boton, celda, errorFormulario, estadoYAcciones, iniciarEncabezado, limpiarErrores, mostrarError, sesionValida, señalar } from '/assets/js/ui.js';

const contenido = document.querySelector('#contenido');
const filas = document.querySelector('#filas');
const formulario = document.querySelector('#formulario');
const modal = new bootstrap.Modal(document.querySelector('#modal-formulario'));
const busqueda = document.querySelector('#busqueda');
const filtroEspecialidad = document.querySelector('#filtro-especialidad');
const filtroEstado = document.querySelector('#filtro-estado');
const listaEspecialidades = document.querySelector('#lista-especialidades');
let editandoId = null;
let especialidades = [];

const CAMPOS = {
  dni_invalido: 'dni', dni_duplicado: 'dni', nombre_invalido: 'nombre', apellido_invalido: 'apellido',
  telefono_invalido: 'telefono', email_invalido: 'email', email_duplicado: 'email',
  fecha_nacimiento_invalida: 'fechaNacimiento', matricula_invalida: 'matricula', matricula_duplicada: 'matricula',
  especialidades_invalidas: 'especialidades',
};

function pintar(profesionales) {
  filas.replaceChildren();
  document.querySelector('#vacio').classList.toggle('d-none', profesionales.length > 0);
  for (const p of profesionales) {
    const fila = document.createElement('tr');
    fila.dataset.id = p.id;
    fila.append(celdaDestacada(p.dni), celda(`${p.nombre} ${p.apellido}`), celdaInsignias([p.matricula], 'insignia-matricula'), celdaInsignias(p.especialidades.map((e) => e.nombre), 'insignia-especialidad'), celdaContacto(p.email, p.telefono));
    estadoYAcciones(fila, p.activo, ['Activo', 'Inactivo'], [
      boton('Editar', 'btn-outline-primary', () => abrirFormulario(p)),
      boton(p.activo ? 'Desactivar' : 'Reactivar', p.activo ? 'btn-outline-danger' : 'btn-outline-success', () => cambiarEstado(p)),
    ]);
    filas.append(fila);
  }
}

// Casillas de especialidades activas; al editar también se muestran las ya asignadas aunque hoy estén inactivas.
function pintarSelector(profesional) {
  const asignadas = new Set((profesional?.especialidades ?? []).map((e) => e.id));
  listaEspecialidades.replaceChildren();
  const visibles = [...especialidades];
  for (const e of profesional?.especialidades ?? []) {
    if (!visibles.some((v) => v.id === e.id)) {
      visibles.push(e);
    }
  }
  for (const e of visibles.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))) {
    const grupo = document.createElement('div');
    grupo.className = 'form-check';
    const casilla = document.createElement('input');
    casilla.type = 'checkbox';
    casilla.className = 'form-check-input';
    casilla.id = `esp-${e.id}`;
    casilla.value = e.id;
    casilla.checked = asignadas.has(e.id);
    const etiqueta = document.createElement('label');
    etiqueta.className = 'form-check-label';
    etiqueta.htmlFor = casilla.id;
    etiqueta.textContent = e.activa === false ? `${e.nombre} (inactiva)` : e.nombre;
    grupo.append(casilla, etiqueta);
    listaEspecialidades.append(grupo);
  }
}

function actualizarResumen() {
  const marcadas = [...listaEspecialidades.querySelectorAll('input:checked')].map((c) => c.nextElementSibling.textContent);
  document.querySelector('#resumen-especialidades').textContent = marcadas.length ? `Seleccionadas: ${marcadas.join(', ')}` : 'Ninguna seleccionada.';
}

listaEspecialidades.addEventListener('change', actualizarResumen);

function abrirFormulario(profesional = null) {
  editandoId = profesional?.id ?? null;
  document.querySelector('#titulo-formulario').textContent = profesional ? 'Editar profesional' : 'Nuevo profesional';
  formulario.dni.value = profesional?.dni ?? '';
  formulario.dni.readOnly = profesional !== null;
  formulario.nombre.value = profesional?.nombre ?? '';
  formulario.apellido.value = profesional?.apellido ?? '';
  formulario.fechaNacimiento.value = profesional?.fechaNacimiento ?? '';
  formulario.telefono.value = profesional?.telefono ?? '';
  formulario.email.value = profesional?.email ?? '';
  formulario.matricula.value = profesional?.matricula ?? '';
  pintarSelector(profesional);
  actualizarResumen();
  limpiarErrores(formulario);
  document.querySelector('#error-especialidades').classList.add('d-none');
  modal.show();
}

async function cargarEspecialidades() {
  const respuesta = await pedir('/api/especialidades');
  if (!sesionValida(respuesta) || !respuesta.ok) {
    return;
  }
  especialidades = respuesta.datos.especialidades;
  for (const e of especialidades) {
    filtroEspecialidad.append(new Option(e.nombre, e.id));
  }
}

async function cargar() {
  const parametros = new URLSearchParams({ estado: parametroEstado(filtroEstado.value) });
  if (busqueda.value.trim() !== '') {
    parametros.set('q', busqueda.value.trim());
  }
  if (filtroEspecialidad.value !== '') {
    parametros.set('especialidad', filtroEspecialidad.value);
  }
  let respuesta;
  try {
    respuesta = await pedir(`/api/profesionales?${parametros}`);
  } catch {
    mostrarError('No pudimos conectar con el servidor. Intentá nuevamente.');
    return;
  }
  if (!sesionValida(respuesta)) {
    return;
  }
  if (!respuesta.ok) {
    mostrarError(respuesta.datos?.error?.mensaje ?? 'No pudimos cargar los profesionales.');
    return;
  }
  alerta.classList.add('d-none');
  pintar(filtrarEstado(respuesta.datos.profesionales, filtroEstado.value));
  contenido.classList.remove('d-none');
}

async function cambiarEstado(profesional) {
  try {
    const respuesta = await pedir(`/api/profesionales/${profesional.id}/estado`, { metodo: 'PUT', cuerpo: { activo: !profesional.activo } });
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
  limpiarErrores(formulario);
  const errorEspecialidades = document.querySelector('#error-especialidades');
  errorEspecialidades.classList.add('d-none');

  const cuerpo = {
    nombre: formulario.nombre.value, apellido: formulario.apellido.value, fechaNacimiento: formulario.fechaNacimiento.value,
    telefono: formulario.telefono.value, email: formulario.email.value, matricula: formulario.matricula.value,
    especialidades: [...listaEspecialidades.querySelectorAll('input:checked')].map((c) => Number(c.value)),
  };
  if (editandoId === null) {
    cuerpo.dni = formulario.dni.value;
  }
  let respuesta;
  try {
    respuesta = await pedir(editandoId === null ? '/api/profesionales' : `/api/profesionales/${editandoId}`, {
      metodo: editandoId === null ? 'POST' : 'PUT', cuerpo,
    });
  } catch {
    errorFormulario('No pudimos conectar con el servidor. Intentá nuevamente.');
    return;
  }
  if (!sesionValida(respuesta)) {
    return;
  }
  if (!respuesta.ok) {
    const error = respuesta.datos?.error;
    if (error?.codigo === 'especialidades_invalidas') {
      errorEspecialidades.textContent = error.mensaje;
      errorEspecialidades.classList.remove('d-none');
    } else {
      señalar(formulario, CAMPOS, error, 'No pudimos guardar el profesional.');
    }
    return;
  }
  modal.hide();
  await cargar();
});

let temporizador;
busqueda.addEventListener('input', () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(cargar, 250);
});
filtroEspecialidad.addEventListener('change', cargar);
filtroEstado.addEventListener('change', cargar);
document.querySelector('#nuevo').addEventListener('click', () => abrirFormulario());

// La gestión es del administrador (la recepción sólo lee la API para los turnos): otro rol vuelve a su panel.
async function iniciar() {
  try {
    const sesion = await pedir('/api/sesion');
    if (!sesionValida(sesion)) {
      return;
    }
    if (sesion.datos?.usuario?.rol !== 'administrador') {
      location.replace(sesion.datos?.panel ?? '/');
      return;
    }
  } catch {
    mostrarError('No pudimos conectar con el servidor. Intentá nuevamente.');
    return;
  }
  iniciarEncabezado();
  await cargarEspecialidades();
  await cargar();
}

iniciar();
