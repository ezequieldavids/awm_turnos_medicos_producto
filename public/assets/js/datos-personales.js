import { pedir } from '/assets/js/api.js';
import { iniciarEncabezado, mostrarError, sesionValida } from '/assets/js/ui.js';

// Autoconsulta de datos personales del paciente: sólo lectura, sobre los datos de la sesión.
const CAMPOS = [
  ['dni', 'DNI'],
  ['nombre', 'Nombre'],
  ['apellido', 'Apellido'],
  ['fechaNacimiento', 'Fecha de nacimiento'],
  ['telefono', 'Teléfono'],
  ['email', 'Email'],
  ['obraSocial', 'Obra social'],
];

const contenido = document.querySelector('#contenido');
const datos = document.querySelector('#datos');

// Fecha ISO (AAAA-MM-DD) como DD/MM/AAAA.
function fecha(iso) {
  const [anio, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${anio}`;
}

function fila(etiqueta, valor) {
  const termino = document.createElement('dt');
  termino.className = 'col-sm-4 text-body-secondary';
  termino.textContent = etiqueta;

  const definicion = document.createElement('dd');
  definicion.className = 'col-sm-8 text-break mb-2';
  if (valor) {
    definicion.textContent = valor;
  } else {
    definicion.textContent = 'Sin cargar';
    definicion.classList.add('text-body-secondary');
  }
  return [termino, definicion];
}

async function cargar() {
  const respuesta = await pedir('/api/mis-datos');
  if (!sesionValida(respuesta)) {
    return;
  }
  if (!respuesta.ok) {
    mostrarError(respuesta.datos?.error?.mensaje ?? 'No pudimos cargar tus datos. Intentá nuevamente.');
    return;
  }

  const registro = respuesta.datos.datos;
  datos.replaceChildren(...CAMPOS.flatMap(([clave, etiqueta]) => {
    const valor = clave === 'fechaNacimiento' && registro[clave] ? fecha(registro[clave]) : registro[clave];
    return fila(etiqueta, valor);
  }));
  contenido.classList.remove('d-none');
}

iniciarEncabezado();
cargar();
