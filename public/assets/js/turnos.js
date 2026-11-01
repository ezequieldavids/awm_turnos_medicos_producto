import { pedir } from '/assets/js/api.js';
import { boton, celda, estadoYAcciones, iniciarEncabezado, mostrarError, sesionValida } from '/assets/js/ui.js';

// Turnos médicos: búsqueda de horarios libres, reserva, cancelación y reprogramación según el rol.
const ROLES_QUE_RESERVAN = ['paciente', 'recepcionista', 'administrador'];
const ROLES_QUE_REGISTRAN_ASISTENCIA = ['profesional', 'recepcionista', 'administrador'];
const ROLES_QUE_VEN_TODOS = ['recepcionista', 'administrador'];
const DIAS_DE_BUSQUEDA = 6;

const seccionReserva = document.querySelector('#seccion-reserva');
const contenedorPaciente = document.querySelector('#contenedor-paciente');
const selectPaciente = document.querySelector('#reserva-paciente');
const formularioBusqueda = document.querySelector('#formulario-busqueda');
const selectEspecialidad = document.querySelector('#reserva-especialidad');
const selectProfesional = document.querySelector('#reserva-profesional');
const reservaDesde = document.querySelector('#reserva-desde');
const reservaHasta = document.querySelector('#reserva-hasta');
const reservaMotivo = document.querySelector('#reserva-motivo');
const reservaMensaje = document.querySelector('#reserva-mensaje');
const franjas = document.querySelector('#franjas');
const sinFranjas = document.querySelector('#sin-franjas');
const filtroDesde = document.querySelector('#filtro-desde');
const filtroHasta = document.querySelector('#filtro-hasta');
const filtroEstado = document.querySelector('#filtro-estado');
const mensajeTurno = document.querySelector('#mensaje-turno');
const filas = document.querySelector('#filas');
const vacio = document.querySelector('#vacio');
const columnaPaciente = document.querySelector('#columna-paciente');

const modalReprogramar = new bootstrap.Modal(document.querySelector('#modal-reprogramar'));
const reprogramarActual = document.querySelector('#reprogramar-actual');
const reprogramarDesde = document.querySelector('#reprogramar-desde');
const reprogramarHasta = document.querySelector('#reprogramar-hasta');
const reprogramarError = document.querySelector('#reprogramar-error');
const reprogramarFranjas = document.querySelector('#reprogramar-franjas');
const reprogramarSinFranjas = document.querySelector('#reprogramar-sin-franjas');

let rol = null;
let reprogramando = null; // turno que se está reprogramando

const nombre = (persona) => `${persona.apellido}, ${persona.nombre}`;
const horario = (t) => `${t.horaInicio} a ${t.horaFin}`;
const etiquetaFranja = (f) => `${f.fecha} · ${f.horaInicio} a ${f.horaFin}`;

// Fecha AAAA-MM-DD del día local (toISOString usa UTC y puede cambiar de día por la noche).
function fechaLocal(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

function sumarDias(fecha, dias) {
  const copia = new Date(fecha);
  copia.setDate(copia.getDate() + dias);
  return copia;
}

// Muestra un mensaje de un bloque (reserva, listado o reprogramación); tipo es el de Bootstrap: success o danger.
function mostrar(elemento, texto, tipo) {
  elemento.textContent = texto;
  elemento.className = `alert alert-${tipo}`;
}

function ocultar(elemento) {
  elemento.className = 'alert d-none';
}

function mensajeDeError(respuesta, porDefecto) {
  return respuesta.datos?.error?.mensaje ?? porDefecto;
}

// Datos del paciente que la API entrega al rol autorizado: nombre, y DNI, contacto y obra social en una línea secundaria.
function celdaPaciente(paciente) {
  const td = document.createElement('td');
  td.append(nombre(paciente));
  const detalle = document.createElement('small');
  detalle.className = 'd-block text-body-secondary text-break';
  detalle.textContent = [
    `DNI ${paciente.dni}`,
    paciente.telefono,
    paciente.email,
    paciente.obraSocial ? `Obra social: ${paciente.obraSocial}` : null,
  ].filter(Boolean).join(' · ');
  td.append(detalle);
  return td;
}

// Insignia por estado: texto y clase de Bootstrap. Un turno confirmado que ya comenzó espera que se registre la asistencia.
function insignia(turno) {
  if (turno.estado === 'confirmado' && turno.pasado) {
    return { texto: 'Asistencia pendiente', clase: 'text-bg-info' };
  }
  return {
    confirmado: { texto: 'Confirmado', clase: 'text-bg-success' },
    atendido: { texto: 'Atendido', clase: 'text-bg-primary' },
    ausente: { texto: 'Ausente', clase: 'text-bg-warning' },
    cancelado: { texto: 'Cancelado', clase: 'text-bg-secondary' },
  }[turno.estado];
}

function acciones(turno) {
  const botones = [];
  if (ROLES_QUE_RESERVAN.includes(rol) && turno.estado === 'confirmado' && !turno.pasado) {
    botones.push(
      boton('Reprogramar', 'btn-outline-primary', () => abrirReprogramar(turno)),
      boton('Cancelar', 'btn-outline-danger', () => cancelar(turno)),
    );
  }
  // Asistencia: sólo cuando el turno ya comenzó; se puede corregir entre atendido y ausente.
  if (ROLES_QUE_REGISTRAN_ASISTENCIA.includes(rol) && turno.pasado) {
    if (turno.estado === 'confirmado') {
      botones.push(
        boton('Atendido', 'btn-outline-success', () => registrarAsistencia(turno, 'atendido')),
        boton('Ausente', 'btn-outline-warning', () => registrarAsistencia(turno, 'ausente')),
      );
    } else if (turno.estado === 'atendido') {
      botones.push(boton('Marcar ausente', 'btn-outline-warning', () => registrarAsistencia(turno, 'ausente')));
    } else if (turno.estado === 'ausente') {
      botones.push(boton('Marcar atendido', 'btn-outline-success', () => registrarAsistencia(turno, 'atendido')));
    }
  }

  return botones;
}

function pintarTurnos(turnos) {
  filas.replaceChildren();
  vacio.classList.toggle('d-none', turnos.length > 0);
  for (const turno of turnos) {
    const fila = document.createElement('tr');
    fila.dataset.id = turno.id;

    const cuando = celda(`${turno.fecha} · ${horario(turno)}`);
    // En móvil las columnas de profesional y especialidad se ocultan: su dato va debajo del horario.
    const detalle = document.createElement('small');
    detalle.className = 'd-block text-body-secondary d-md-none text-break';
    detalle.textContent = `${nombre(turno.profesional)} · ${turno.especialidad.nombre}`;
    cuando.append(detalle);
    // El motivo se muestra como texto: nunca se inserta como HTML.
    if (turno.motivo) {
      const motivo = document.createElement('small');
      motivo.className = 'd-block text-body-secondary text-break';
      motivo.textContent = `Motivo: ${turno.motivo}`;
      cuando.append(motivo);
    }
    if (turno.pasado) {
      const pasado = document.createElement('small');
      pasado.className = 'd-block text-body-secondary';
      pasado.textContent = 'Ya pasó';
      cuando.append(pasado);
    }
    fila.append(cuando);

    if (rol !== 'paciente') {
      fila.append(celdaPaciente(turno.paciente));
    }
    fila.append(
      celda(nombre(turno.profesional), true),
      celda(turno.especialidad.nombre, true),
    );
    const { texto, clase } = insignia(turno);
    estadoYAcciones(fila, true, [texto, texto], acciones(turno), clase);
    filas.append(fila);
  }
}

async function cargarTurnos() {
  const parametros = new URLSearchParams();
  if (filtroDesde.value) parametros.set('desde', filtroDesde.value);
  if (filtroHasta.value) parametros.set('hasta', filtroHasta.value);
  if (filtroEstado.value) parametros.set('estado', filtroEstado.value);

  let respuesta;
  try {
    respuesta = await pedir(`/api/turnos?${parametros}`);
  } catch {
    mostrarError('No pudimos conectar con el servidor. Intentá nuevamente.');
    return;
  }
  if (!sesionValida(respuesta)) {
    return;
  }
  if (!respuesta.ok) {
    mostrarError(mensajeDeError(respuesta, 'No pudimos cargar los turnos.'));
    return;
  }
  pintarTurnos(respuesta.datos.turnos);
}

async function cancelar(turno) {
  if (!confirm(`¿Cancelar el turno del ${turno.fecha} a las ${turno.horaInicio}? La franja queda libre.`)) {
    return;
  }
  const respuesta = await pedir(`/api/turnos/${turno.id}/estado`, { metodo: 'PUT', cuerpo: { estado: 'cancelado' } });
  if (!sesionValida(respuesta)) {
    return;
  }
  if (respuesta.ok) {
    mostrar(mensajeTurno, 'Turno cancelado. La franja quedó libre.', 'success');
  } else {
    mostrar(mensajeTurno, mensajeDeError(respuesta, 'No pudimos cancelar el turno.'), 'danger');
  }
  await cargarTurnos();
}

async function registrarAsistencia(turno, estado) {
  const respuesta = await pedir(`/api/turnos/${turno.id}/estado`, { metodo: 'PUT', cuerpo: { estado } });
  if (!sesionValida(respuesta)) {
    return;
  }
  if (respuesta.ok) {
    mostrar(mensajeTurno, `Asistencia registrada: el turno del ${turno.fecha} a las ${turno.horaInicio} quedó como ${estado}.`, 'success');
  } else {
    mostrar(mensajeTurno, mensajeDeError(respuesta, 'No pudimos registrar la asistencia.'), 'danger');
  }
  await cargarTurnos();
}

// Una fila de horario libre: fecha, horario, profesional con su consultorio, y la acción dada.
function filaFranja(franja, textoAccion, accion) {
  const fila = document.createElement('tr');
  fila.dataset.agenda = franja.idAgenda;
  fila.dataset.horaInicio = franja.horaInicio;
  const profesional = celda(nombre(franja.profesional));
  const consultorio = document.createElement('small');
  consultorio.className = 'd-block text-body-secondary';
  consultorio.textContent = `Consultorio ${franja.consultorio.numero}`;
  profesional.append(consultorio);
  const columnaAccion = document.createElement('td');
  columnaAccion.className = 'text-end';
  columnaAccion.append(boton(textoAccion, 'btn-outline-primary', accion));
  fila.append(celda(franja.fecha), celda(`${franja.horaInicio} a ${franja.horaFin}`), profesional, columnaAccion);
  return fila;
}

async function buscarFranjas(especialidad, desde, hasta, profesional) {
  const parametros = new URLSearchParams({ especialidad, fecha_desde: desde, fecha_hasta: hasta });
  if (profesional) parametros.set('profesional', profesional);

  return pedir(`/api/disponibilidad?${parametros}`);
}

// `limpiar` se apaga al volver a buscar después de reservar, para no borrar el mensaje de la reserva.
async function buscar(limpiar = true) {
  if (limpiar) {
    ocultar(reservaMensaje);
  }
  if (!selectEspecialidad.value || !reservaDesde.value || !reservaHasta.value) {
    mostrar(reservaMensaje, 'Elegí la especialidad y el rango de fechas.', 'danger');
    return;
  }
  if (reservaDesde.value > reservaHasta.value) {
    mostrar(reservaMensaje, 'La fecha «Desde» no puede ser posterior a «Hasta».', 'danger');
    return;
  }

  let respuesta;
  try {
    respuesta = await buscarFranjas(selectEspecialidad.value, reservaDesde.value, reservaHasta.value, selectProfesional.value);
  } catch {
    mostrar(reservaMensaje, 'No pudimos conectar con el servidor. Intentá nuevamente.', 'danger');
    return;
  }
  if (!sesionValida(respuesta)) {
    return;
  }
  if (!respuesta.ok) {
    mostrar(reservaMensaje, mensajeDeError(respuesta, 'No pudimos buscar horarios.'), 'danger');
    return;
  }

  franjas.replaceChildren(...respuesta.datos.franjas.map((f) => filaFranja(f, 'Reservar', () => reservar(f))));
  sinFranjas.classList.toggle('d-none', respuesta.datos.franjas.length > 0);
}

async function reservar(franja) {
  const cuerpo = {
    agenda: franja.idAgenda,
    fecha: franja.fecha,
    horaInicio: franja.horaInicio,
    motivo: reservaMotivo.value.trim() || null,
  };
  if (rol !== 'paciente') {
    if (!selectPaciente.value) {
      mostrar(reservaMensaje, 'Elegí el paciente antes de reservar.', 'danger');
      return;
    }
    cuerpo.paciente = Number(selectPaciente.value);
  }

  const respuesta = await pedir('/api/turnos', { metodo: 'POST', cuerpo });
  if (!sesionValida(respuesta)) {
    return;
  }
  if (respuesta.ok) {
    mostrar(reservaMensaje, `Turno reservado: ${etiquetaFranja(franja)} con ${nombre(franja.profesional)}.`, 'success');
    reservaMotivo.value = '';
  } else {
    // Ante un conflicto se informa el motivo y la grilla se vuelve a consultar.
    mostrar(reservaMensaje, mensajeDeError(respuesta, 'No pudimos reservar el turno.'), 'danger');
  }
  await buscar(false);
  await cargarTurnos();
}

function abrirReprogramar(turno) {
  reprogramando = turno;
  ocultar(reprogramarError);
  reprogramarActual.textContent = `Turno actual: ${turno.fecha} · ${horario(turno)} con ${nombre(turno.profesional)} (${turno.especialidad.nombre}).`;
  const hoy = new Date();
  reprogramarDesde.value = fechaLocal(hoy);
  reprogramarHasta.value = fechaLocal(sumarDias(hoy, DIAS_DE_BUSQUEDA));
  reprogramarFranjas.replaceChildren();
  reprogramarSinFranjas.classList.add('d-none');
  modalReprogramar.show();
}

async function buscarParaReprogramar() {
  ocultar(reprogramarError);
  if (!reprogramarDesde.value || !reprogramarHasta.value || reprogramarDesde.value > reprogramarHasta.value) {
    mostrar(reprogramarError, 'Elegí un rango de fechas válido.', 'danger');
    return;
  }

  let respuesta;
  try {
    // La reprogramación mantiene la especialidad del turno; el profesional puede cambiar.
    respuesta = await buscarFranjas(reprogramando.especialidad.id, reprogramarDesde.value, reprogramarHasta.value, '');
  } catch {
    mostrar(reprogramarError, 'No pudimos conectar con el servidor. Intentá nuevamente.', 'danger');
    return;
  }
  if (!sesionValida(respuesta)) {
    return;
  }
  if (!respuesta.ok) {
    mostrar(reprogramarError, mensajeDeError(respuesta, 'No pudimos buscar horarios.'), 'danger');
    return;
  }

  reprogramarFranjas.replaceChildren(...respuesta.datos.franjas.map((f) => filaFranja(f, 'Elegir', () => reprogramar(f))));
  reprogramarSinFranjas.classList.toggle('d-none', respuesta.datos.franjas.length > 0);
}

async function reprogramar(franja) {
  const respuesta = await pedir(`/api/turnos/${reprogramando.id}/reprogramacion`, {
    metodo: 'PUT',
    cuerpo: { agenda: franja.idAgenda, fecha: franja.fecha, horaInicio: franja.horaInicio },
  });
  if (!sesionValida(respuesta)) {
    return;
  }
  if (respuesta.ok) {
    modalReprogramar.hide();
    mostrar(mensajeTurno, `Turno reprogramado: ${etiquetaFranja(franja)} con ${nombre(franja.profesional)}. La franja anterior quedó libre.`, 'success');
    await cargarTurnos();
    return;
  }
  // Ante un conflicto (por ejemplo, la franja ya fue tomada) se informa y se vuelve a buscar.
  mostrar(reprogramarError, mensajeDeError(respuesta, 'No pudimos reprogramar el turno.'), 'danger');
  await buscarParaReprogramar();
}

async function cargarOpciones() {
  const respuesta = await pedir('/api/disponibilidad/opciones');
  if (!sesionValida(respuesta)) {
    return false;
  }
  if (!respuesta.ok) {
    mostrarError(mensajeDeError(respuesta, 'No pudimos cargar las opciones de turnos.'));
    return false;
  }
  const { especialidades, profesionales } = respuesta.datos;
  selectEspecialidad.append(...especialidades.map((e) => new Option(e.nombre, e.id)));
  selectProfesional.append(...profesionales.map((p) => new Option(nombre(p), p.id)));
  return true;
}

async function cargarPacientes() {
  const respuesta = await pedir('/api/pacientes');
  if (!sesionValida(respuesta)) {
    return false;
  }
  if (!respuesta.ok) {
    mostrarError(mensajeDeError(respuesta, 'No pudimos cargar los pacientes.'));
    return false;
  }
  selectPaciente.append(new Option('Elegí un paciente', ''), ...respuesta.datos.pacientes.map((p) => new Option(`${nombre(p)} · DNI ${p.dni}`, p.id)));
  return true;
}

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
  rol = sesion.datos.usuario.rol;
  document.querySelector('#titulo').textContent = ROLES_QUE_VEN_TODOS.includes(rol) ? 'Turnos' : 'Mis turnos';
  document.querySelector('#contenido').classList.remove('d-none');
  columnaPaciente.classList.toggle('d-none', rol === 'paciente');

  // Sólo los roles que reservan ven la búsqueda; la recepción elige el paciente.
  seccionReserva.classList.toggle('d-none', !ROLES_QUE_RESERVAN.includes(rol));
  contenedorPaciente.classList.toggle('d-none', !ROLES_QUE_VEN_TODOS.includes(rol));
  reservaDesde.value = fechaLocal(new Date());
  reservaHasta.value = fechaLocal(sumarDias(new Date(), DIAS_DE_BUSQUEDA));

  if (ROLES_QUE_RESERVAN.includes(rol)) {
    const [opcionesOk, pacientesOk] = await Promise.all([
      cargarOpciones(),
      ROLES_QUE_VEN_TODOS.includes(rol) ? cargarPacientes() : Promise.resolve(true),
    ]);
    if (!opcionesOk || !pacientesOk) {
      return;
    }
  }

  // «+ Reservar» del panel llega con #seccion-reserva: se lleva al formulario de búsqueda.
  if (location.hash === '#seccion-reserva' && ROLES_QUE_RESERVAN.includes(rol)) {
    seccionReserva.scrollIntoView();
    document.querySelector('#reserva-especialidad').focus();
  }

  iniciarEncabezado();
  cargarTurnos();
}

formularioBusqueda.addEventListener('submit', (evento) => {
  evento.preventDefault();
  buscar();
});
document.querySelector('#reprogramar-buscar').addEventListener('click', buscarParaReprogramar);
filtroDesde.addEventListener('change', cargarTurnos);
filtroHasta.addEventListener('change', cargarTurnos);
filtroEstado.addEventListener('change', cargarTurnos);

iniciar();
