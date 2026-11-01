import { pedir } from '/assets/js/api.js';
import { parametroEstado, filtrarEstado, celdaDestacada, alerta, boton, celda, errorFormulario, estadoYAcciones, iniciarEncabezado, limpiarErrores, mostrarError, sesionValida, señalar } from '/assets/js/ui.js';

const contenido = document.querySelector('#contenido');
const filas = document.querySelector('#filas');
const formulario = document.querySelector('#formulario');
const modal = new bootstrap.Modal(document.querySelector('#modal-formulario'));
const busqueda = document.querySelector('#busqueda');
const filtroEstado = document.querySelector('#filtro-estado');
let editandoId = null;

const CAMPOS = { numero_invalido: 'numero', numero_duplicado: 'numero', piso_invalido: 'piso', ubicacion_invalida: 'ubicacion' };

function pintar(consultorios) {
  filas.replaceChildren();
  document.querySelector('#vacio').classList.toggle('d-none', consultorios.length > 0);
  for (const c of consultorios) {
    const fila = document.createElement('tr');
    fila.dataset.id = c.id;
    fila.append(celdaDestacada(c.numero), celda(c.piso ?? '', true), celda(c.ubicacion ?? '', true));
    estadoYAcciones(fila, c.activo, ['Activo', 'Inactivo'], [
      boton('Editar', 'btn-outline-primary', () => abrirFormulario(c)),
      boton(c.activo ? 'Desactivar' : 'Reactivar', c.activo ? 'btn-outline-danger' : 'btn-outline-success', () => cambiarEstado(c)),
    ]);
    filas.append(fila);
  }
}

function abrirFormulario(consultorio = null) {
  editandoId = consultorio?.id ?? null;
  document.querySelector('#titulo-formulario').textContent = consultorio ? 'Editar consultorio' : 'Nuevo consultorio';
  formulario.numero.value = consultorio?.numero ?? '';
  formulario.piso.value = consultorio?.piso ?? '';
  formulario.ubicacion.value = consultorio?.ubicacion ?? '';
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
    respuesta = await pedir(`/api/consultorios?${parametros}`);
  } catch {
    mostrarError('No pudimos conectar con el servidor. Intentá nuevamente.');
    return;
  }
  if (!sesionValida(respuesta)) {
    return;
  }
  if (!respuesta.ok) {
    mostrarError(respuesta.datos?.error?.mensaje ?? 'No pudimos cargar los consultorios.');
    return;
  }
  alerta.classList.add('d-none');
  pintar(filtrarEstado(respuesta.datos.consultorios, filtroEstado.value));
  contenido.classList.remove('d-none');
}

async function cambiarEstado(consultorio) {
  try {
    const respuesta = await pedir(`/api/consultorios/${consultorio.id}/estado`, { metodo: 'PUT', cuerpo: { activo: !consultorio.activo } });
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

  const cuerpo = { numero: formulario.numero.value, piso: formulario.piso.value, ubicacion: formulario.ubicacion.value };
  let respuesta;
  try {
    respuesta = await pedir(editandoId === null ? '/api/consultorios' : `/api/consultorios/${editandoId}`, {
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
    señalar(formulario, CAMPOS, respuesta.datos?.error, 'No pudimos guardar el consultorio.');
    return;
  }
  modal.hide();
  await cargar();
});

// Sólo el administrador gestiona consultorios: el resto de los roles vuelve a su panel.
async function iniciar() {
  let respuesta;
  try {
    respuesta = await pedir('/api/sesion');
  } catch {
    mostrarError('No pudimos conectar con el servidor. Intentá nuevamente.');
    return;
  }
  if (!sesionValida(respuesta)) {
    return;
  }
  if (respuesta.datos.usuario.rol !== 'administrador') {
    location.replace(respuesta.datos.panel);
    return;
  }
  iniciarEncabezado();
  cargar();
}

let temporizador;
busqueda.addEventListener('input', () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(cargar, 250);
});
filtroEstado.addEventListener('change', cargar);
document.querySelector('#nuevo').addEventListener('click', () => abrirFormulario());

iniciar();
