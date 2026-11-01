import { pedir } from '/assets/js/api.js';
import { parametroEstado, filtrarEstado, celdaDestacada, celdaContacto, alerta, boton, celda, errorFormulario, estadoYAcciones, iniciarEncabezado, limpiarErrores, mostrarError, sesionValida, señalar } from '/assets/js/ui.js';

const contenido = document.querySelector('#contenido');
const filas = document.querySelector('#filas');
const formulario = document.querySelector('#formulario');
const modal = new bootstrap.Modal(document.querySelector('#modal-formulario'));
const busqueda = document.querySelector('#busqueda');
const filtroEstado = document.querySelector('#filtro-estado');
let editandoId = null;

const CAMPOS = {
  dni_invalido: 'dni', dni_duplicado: 'dni', nombre_invalido: 'nombre', apellido_invalido: 'apellido',
  telefono_invalido: 'telefono', email_invalido: 'email', email_duplicado: 'email',
  fecha_nacimiento_invalida: 'fechaNacimiento', obra_social_invalida: 'obraSocial',
};

function pintar(pacientes) {
  filas.replaceChildren();
  document.querySelector('#vacio').classList.toggle('d-none', pacientes.length > 0);
  for (const p of pacientes) {
    const fila = document.createElement('tr');
    fila.dataset.id = p.id;
    fila.append(celdaDestacada(p.dni), celda(`${p.nombre} ${p.apellido}`), celdaContacto(p.email, p.telefono), celda(p.obraSocial ?? '', true));
    estadoYAcciones(fila, p.activo, ['Activo', 'Inactivo'], [
      boton('Editar', 'btn-outline-primary', () => abrirFormulario(p)),
      boton(p.activo ? 'Desactivar' : 'Reactivar', p.activo ? 'btn-outline-danger' : 'btn-outline-success', () => cambiarEstado(p)),
    ]);
    filas.append(fila);
  }
}

function abrirFormulario(paciente = null) {
  editandoId = paciente?.id ?? null;
  document.querySelector('#titulo-formulario').textContent = paciente ? 'Editar paciente' : 'Nuevo paciente';
  formulario.dni.value = paciente?.dni ?? '';
  formulario.dni.readOnly = paciente !== null;
  formulario.nombre.value = paciente?.nombre ?? '';
  formulario.apellido.value = paciente?.apellido ?? '';
  formulario.fechaNacimiento.value = paciente?.fechaNacimiento ?? '';
  formulario.telefono.value = paciente?.telefono ?? '';
  formulario.email.value = paciente?.email ?? '';
  formulario.obraSocial.value = paciente?.obraSocial ?? '';
  limpiarErrores(formulario);
  modal.show();
}

async function cargar() {
  const parametros = new URLSearchParams({ estado: parametroEstado(filtroEstado.value) });
  if (busqueda.value.trim() !== '') {
    parametros.set('q', busqueda.value.trim());
  }
  let respuesta;
  try {
    respuesta = await pedir(`/api/pacientes?${parametros}`);
  } catch {
    mostrarError('No pudimos conectar con el servidor. Intentá nuevamente.');
    return;
  }
  if (!sesionValida(respuesta)) {
    return;
  }
  if (!respuesta.ok) {
    mostrarError(respuesta.datos?.error?.mensaje ?? 'No pudimos cargar los pacientes.');
    return;
  }
  alerta.classList.add('d-none');
  pintar(filtrarEstado(respuesta.datos.pacientes, filtroEstado.value));
  contenido.classList.remove('d-none');
}

async function cambiarEstado(paciente) {
  try {
    const respuesta = await pedir(`/api/pacientes/${paciente.id}/estado`, { metodo: 'PUT', cuerpo: { activo: !paciente.activo } });
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
    nombre: formulario.nombre.value, apellido: formulario.apellido.value, fechaNacimiento: formulario.fechaNacimiento.value,
    telefono: formulario.telefono.value, email: formulario.email.value, obraSocial: formulario.obraSocial.value,
  };
  if (editandoId === null) {
    cuerpo.dni = formulario.dni.value;
  }
  let respuesta;
  try {
    respuesta = await pedir(editandoId === null ? '/api/pacientes' : `/api/pacientes/${editandoId}`, {
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
    señalar(formulario, CAMPOS, respuesta.datos?.error, 'No pudimos guardar el paciente.');
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
filtroEstado.addEventListener('change', cargar);
document.querySelector('#nuevo').addEventListener('click', () => abrirFormulario());

iniciarEncabezado();
cargar();
