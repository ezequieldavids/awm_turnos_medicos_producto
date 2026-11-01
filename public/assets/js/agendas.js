import { pedir } from '/assets/js/api.js';
import { alerta, boton, celda, errorFormulario, estadoYAcciones, iniciarEncabezado, limpiarErrores, mostrarError, sesionValida, señalar } from '/assets/js/ui.js';

const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const contenido = document.querySelector('#contenido');
const filas = document.querySelector('#filas');
const formulario = document.querySelector('#formulario');
const modal = new bootstrap.Modal(document.querySelector('#modal-formulario'));
const filtroProfesional = document.querySelector('#filtro-profesional');
const filtroConsultorio = document.querySelector('#filtro-consultorio');
const filtroEstado = document.querySelector('#filtro-estado');
const selectProfesional = document.querySelector('#profesional');
const selectConsultorio = document.querySelector('#consultorio');
const selectEspecialidad = document.querySelector('#especialidad');
const botonNuevo = document.querySelector('#nuevo');

const CAMPOS = {
  profesional_invalido: 'profesional', consultorio_invalido: 'consultorio', especialidad_invalida: 'especialidad',
  dia_invalido: 'diaSemana', hora_invalida: 'horaInicio', horario_invalido: 'horaFin', duracion_invalida: 'duracionMinutos',
  vigencia_desde_invalida: 'vigenteDesde', vigencia_hasta_invalida: 'vigenteHasta',
};

let esAdmin = false;
let propio = null; // id del profesional autenticado (sólo para el rol profesional)
let profesionales = [];
let consultorios = [];
let editandoId = null;

const nombreProfesional = (p) => `${p.apellido}, ${p.nombre}`;
const vigencia = (a) => `${a.vigenteDesde} al ${a.vigenteHasta ?? 'sin fin'}`;

function pintar(agendas) {
  filas.replaceChildren();
  document.querySelector('#vacio').classList.toggle('d-none', agendas.length > 0);
  for (const a of agendas) {
    const fila = document.createElement('tr');
    fila.dataset.id = a.id;
    fila.append(
      celda(nombreProfesional(a.profesional)),
      celda(a.consultorio.numero, true),
      celda(a.especialidad.nombre, true),
      celdaHorario(a),
      celda(vigencia(a), true),
    );
    estadoYAcciones(fila, a.activa, ['Activa', 'Inactiva'], [
      boton('Editar', 'btn-outline-primary', () => abrirFormulario(a)),
      boton(a.activa ? 'Desactivar' : 'Reactivar', a.activa ? 'btn-outline-danger' : 'btn-outline-success', () => cambiarEstado(a)),
    ]);
    filas.append(fila);
  }
}

// Fecha AAAA-MM-DD del día local (toISOString usa UTC y puede cambiar de día por la noche).
function fechaLocal(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

// El nombre del día no se parte en móvil; el resto del texto puede ajustarse.
function celdaHorario(agenda) {
  const td = document.createElement('td');
  const dia = document.createElement('span');
  dia.className = 'text-nowrap';
  dia.textContent = DIAS[agenda.diaSemana];
  td.append(dia, ` ${agenda.horaInicio} a ${agenda.horaFin} (${agenda.duracionMinutos} min)`);
  return td;
}

// Agrega una opción que no está en la lista (por ejemplo, un profesional o una especialidad ya inactivos) para no perder el valor guardado.
function asegurarOpcion(select, valor, texto) {
  if (![...select.options].some((o) => o.value === String(valor))) {
    select.append(new Option(texto, valor));
  }
  select.value = String(valor);
}

function cargarEspecialidades(profesionalId, seleccionada = null) {
  const profesional = profesionales.find((p) => p.id === Number(profesionalId));
  selectEspecialidad.replaceChildren(...(profesional?.especialidades ?? []).map((e) => new Option(e.nombre, e.id)));
  if (seleccionada) {
    asegurarOpcion(selectEspecialidad, seleccionada.id, seleccionada.nombre);
  }
}

function abrirFormulario(agenda = null) {
  editandoId = agenda?.id ?? null;
  document.querySelector('#titulo-formulario').textContent = agenda ? 'Editar agenda' : 'Nueva agenda';
  if (agenda) {
    asegurarOpcion(selectProfesional, agenda.profesional.id, nombreProfesional(agenda.profesional));
    cargarEspecialidades(agenda.profesional.id, agenda.especialidad);
    asegurarOpcion(selectConsultorio, agenda.consultorio.id, agenda.consultorio.numero);
    selectEspecialidad.value = String(agenda.especialidad.id);
    document.querySelector('#diaSemana').value = String(agenda.diaSemana);
    document.querySelector('#horaInicio').value = agenda.horaInicio;
    document.querySelector('#horaFin').value = agenda.horaFin;
    document.querySelector('#duracionMinutos').value = agenda.duracionMinutos;
    document.querySelector('#vigenteDesde').value = agenda.vigenteDesde;
    document.querySelector('#vigenteHasta').value = agenda.vigenteHasta ?? '';
  } else {
    selectProfesional.value = String(esAdmin ? profesionales[0]?.id ?? '' : propio ?? '');
    cargarEspecialidades(selectProfesional.value);
    selectConsultorio.value = String(consultorios[0]?.id ?? '');
    document.querySelector('#diaSemana').value = '1';
    document.querySelector('#horaInicio').value = '08:00';
    document.querySelector('#horaFin').value = '12:00';
    document.querySelector('#duracionMinutos').value = '15';
    document.querySelector('#vigenteDesde').value = fechaLocal(new Date());
    document.querySelector('#vigenteHasta').value = '';
  }
  limpiarErrores(formulario);
  modal.show();
}

async function cargar() {
  const parametros = new URLSearchParams({ estado: filtroEstado.value === 'activas' ? 'activas' : 'todas' });
  if (esAdmin && filtroProfesional.value !== '') {
    parametros.set('profesional', filtroProfesional.value);
  }
  if (filtroConsultorio.value !== '') {
    parametros.set('consultorio', filtroConsultorio.value);
  }
  let respuesta;
  try {
    respuesta = await pedir(`/api/agendas?${parametros}`);
  } catch {
    mostrarError('No pudimos conectar con el servidor. Intentá nuevamente.');
    return;
  }
  if (!sesionValida(respuesta)) {
    return;
  }
  if (!respuesta.ok) {
    mostrarError(respuesta.datos?.error?.mensaje ?? 'No pudimos cargar las agendas.');
    return;
  }
  alerta.classList.add('d-none');
  pintar(filtroEstado.value === 'inactivas' ? respuesta.datos.agendas.filter((a) => !a.activa) : respuesta.datos.agendas);
  contenido.classList.remove('d-none');
}

async function cambiarEstado(agenda) {
  try {
    const respuesta = await pedir(`/api/agendas/${agenda.id}/estado`, { metodo: 'PUT', cuerpo: { activa: !agenda.activa } });
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

  const cuerpo = {
    profesional: Number(selectProfesional.value),
    consultorio: Number(selectConsultorio.value),
    especialidad: Number(selectEspecialidad.value),
    diaSemana: Number(document.querySelector('#diaSemana').value),
    horaInicio: document.querySelector('#horaInicio').value,
    horaFin: document.querySelector('#horaFin').value,
    duracionMinutos: Number(document.querySelector('#duracionMinutos').value),
    vigenteDesde: document.querySelector('#vigenteDesde').value,
    vigenteHasta: document.querySelector('#vigenteHasta').value || null,
  };
  let respuesta;
  try {
    respuesta = await pedir(editandoId === null ? '/api/agendas' : `/api/agendas/${editandoId}`, {
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
    señalar(formulario, CAMPOS, respuesta.datos?.error, 'No pudimos guardar la agenda.');
    return;
  }
  modal.hide();
  await cargar();
});

async function iniciar() {
  let sesion;
  try {
    sesion = await pedir('/api/sesion');
  } catch {
    mostrarError('No pudimos conectar con el servidor. Intentá nuevamente.');
    return;
  }
  if (!sesionValida(sesion)) {
    return;
  }
  const rol = sesion.datos.usuario.rol;
  // Sólo administrador y profesional gestionan agendas: el resto vuelve a su panel.
  if (rol !== 'administrador' && rol !== 'profesional') {
    location.replace(sesion.datos.panel);
    return;
  }
  esAdmin = rol === 'administrador';
  document.querySelector('#titulo').textContent = esAdmin ? 'Agendas' : 'Mi agenda';
  if (!esAdmin) {
    document.querySelector('#contenedor-filtro-profesional').classList.add('d-none');
    document.querySelector('#contenedor-profesional').classList.add('d-none');
  }

  let opciones;
  try {
    opciones = await pedir('/api/agendas/opciones');
  } catch {
    mostrarError('No pudimos conectar con el servidor. Intentá nuevamente.');
    return;
  }
  if (!sesionValida(opciones)) {
    return;
  }
  if (!opciones.ok) {
    mostrarError(opciones.datos?.error?.mensaje ?? 'No pudimos cargar las opciones de agenda.');
    return;
  }
  profesionales = opciones.datos.profesionales;
  consultorios = opciones.datos.consultorios;
  propio = esAdmin ? null : profesionales[0]?.id ?? null;

  filtroConsultorio.append(...consultorios.map((c) => new Option(`Consultorio ${c.numero}`, c.id)));
  filtroProfesional.append(...profesionales.map((p) => new Option(nombreProfesional(p), p.id)));
  selectProfesional.append(...profesionales.map((p) => new Option(nombreProfesional(p), p.id)));
  selectConsultorio.append(...consultorios.map((c) => new Option(`Consultorio ${c.numero}`, c.id)));
  selectProfesional.addEventListener('change', () => cargarEspecialidades(selectProfesional.value));

  if (!esAdmin && propio === null) {
    mostrarError('Tu perfil de profesional no está activo: no podés configurar agendas.');
    botonNuevo.disabled = true;
  }
  iniciarEncabezado();
  cargar();
}

filtroProfesional.addEventListener('change', cargar);
filtroConsultorio.addEventListener('change', cargar);
filtroEstado.addEventListener('change', cargar);
botonNuevo.addEventListener('click', () => abrirFormulario());

iniciar();
