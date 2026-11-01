import { pedir } from '/assets/js/api.js';
import { alerta, boton, celda, errorFormulario, estadoYAcciones, iniciarEncabezado, limpiarErrores, mostrarError, sesionValida, señalar } from '/assets/js/ui.js';

const contenido = document.querySelector('#contenido');
const filas = document.querySelector('#filas');
const formulario = document.querySelector('#formulario');
const modal = new bootstrap.Modal(document.querySelector('#modal-formulario'));
const busqueda = document.querySelector('#busqueda');
const estado = document.querySelector('#estado');
const ROLES = [
  ['paciente', 'Paciente'],
  ['profesional', 'Profesional de la salud'],
  ['recepcionista', 'Recepcionista'],
  ['administrador', 'Administrador'],
];
// Modo del formulario: alta (cuenta nueva), rol (cambiar rol) o contrasena (restablecer). Una sola pantalla de error.
let modo = 'alta';
let cuentaId = null;

const CAMPOS = {
  dni_invalido: 'dni', cuenta_existente: 'dni', dni_duplicado: 'dni', nombre_invalido: 'nombre', apellido_invalido: 'apellido',
  rol_invalido: 'rol', sin_registro_de_rol: 'rol', contrasena_invalida: 'contrasena',
};

for (const [valor, etiqueta] of ROLES) {
  document.querySelector('#rol').append(new Option(etiqueta, valor));
}

function pintar(usuarios) {
  filas.replaceChildren();
  document.querySelector('#vacio').classList.toggle('d-none', usuarios.length > 0);
  for (const u of usuarios) {
    const fila = document.createElement('tr');
    fila.dataset.id = u.id;
    const rol = celda(u.etiqueta);
    fila.append(celda(u.dni), celda(`${u.apellido}, ${u.nombre}`), rol);
    fila.firstElementChild.classList.replace('text-break', 'text-nowrap'); // el DNI no se parte
    rol.classList.replace('text-break', 'text-nowrap'); // el rol tampoco se parte en palabras
    estadoYAcciones(fila, u.activo, ['Activa', 'Inactiva'], [
      boton('Cambiar rol', 'btn-outline-primary', () => abrirFormulario('rol', u)),
      boton('Contraseña', 'btn-outline-secondary', () => abrirFormulario('contrasena', u)),
      boton(u.activo ? 'Desactivar' : 'Reactivar', u.activo ? 'btn-outline-danger' : 'btn-outline-success', () => cambiarEstado(u)),
    ]);
    // Rótulos de cada celda para la vista de tarjetas en móvil (ver usuarios.html).
    ['DNI', 'Apellido y nombre', 'Rol', 'Estado', 'Acciones'].forEach((etiqueta, i) => {
      fila.children[i].dataset.etiqueta = etiqueta;
    });
    filas.append(fila);
  }
}

// Muestra sólo los campos del modo: los demás quedan ocultos y no se envían.
function mostrarModo() {
  for (const elemento of document.querySelectorAll('[data-para]')) {
    elemento.classList.toggle('d-none', !elemento.dataset.para.split(' ').includes(modo));
  }
}

function abrirFormulario(nuevoModo, cuenta = null) {
  modo = nuevoModo;
  cuentaId = cuenta?.id ?? null;
  const titulos = { alta: 'Nuevo usuario', rol: 'Cambiar rol', contrasena: 'Restablecer contraseña' };
  document.querySelector('#titulo-formulario').textContent = titulos[modo];
  document.querySelector('#etiqueta-contrasena').textContent = modo === 'alta' ? 'Contraseña inicial' : 'Nueva contraseña';
  formulario.dni.value = cuenta?.dni ?? '';
  formulario.dni.readOnly = modo !== 'alta';
  formulario.nombre.value = '';
  formulario.apellido.value = '';
  formulario.rol.value = cuenta?.rol ?? 'recepcionista';
  formulario.contrasena.value = '';
  mostrarModo();
  limpiarErrores(formulario);
  modal.show();
}

async function cargar() {
  const parametros = new URLSearchParams({ estado: estado.value });
  if (busqueda.value.trim() !== '') {
    parametros.set('q', busqueda.value.trim());
  }
  let respuesta;
  try {
    respuesta = await pedir(`/api/usuarios?${parametros}`);
  } catch {
    mostrarError('No pudimos conectar con el servidor. Intentá nuevamente.');
    return;
  }
  if (!sesionValida(respuesta)) {
    return;
  }
  if (!respuesta.ok) {
    mostrarError(respuesta.datos?.error?.mensaje ?? 'No pudimos cargar los usuarios.');
    return;
  }
  alerta.classList.add('d-none');
  pintar(respuesta.datos.usuarios);
  contenido.classList.remove('d-none');
}

async function cambiarEstado(cuenta) {
  try {
    const respuesta = await pedir(`/api/usuarios/${cuenta.id}/estado`, { metodo: 'PUT', cuerpo: { activo: !cuenta.activo } });
    if (!sesionValida(respuesta)) {
      return;
    }
    if (!respuesta.ok) {
      mostrarError(respuesta.datos?.error?.mensaje ?? 'No pudimos cambiar el estado de la cuenta.');
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

  let ruta = `/api/usuarios/${cuentaId}/${modo === 'rol' ? 'rol' : 'contrasena'}`;
  let cuerpo;
  if (modo === 'alta') {
    ruta = '/api/usuarios';
    cuerpo = {
      dni: formulario.dni.value, nombre: formulario.nombre.value, apellido: formulario.apellido.value,
      rol: formulario.rol.value, contrasena: formulario.contrasena.value,
    };
  } else if (modo === 'rol') {
    cuerpo = { rol: formulario.rol.value };
  } else {
    cuerpo = { contrasena: formulario.contrasena.value };
  }

  let respuesta;
  try {
    respuesta = await pedir(ruta, { metodo: modo === 'alta' ? 'POST' : 'PUT', cuerpo });
  } catch {
    errorFormulario('No pudimos conectar con el servidor. Intentá nuevamente.');
    return;
  }
  if (!sesionValida(respuesta)) {
    return;
  }
  if (!respuesta.ok) {
    señalar(formulario, CAMPOS, respuesta.datos?.error, 'No pudimos guardar los cambios de la cuenta.');
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
estado.addEventListener('change', cargar);
document.querySelector('#nuevo').addEventListener('click', () => abrirFormulario('alta'));

iniciarEncabezado();
cargar();
