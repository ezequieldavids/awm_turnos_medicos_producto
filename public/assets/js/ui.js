import { iniciarBarra } from '/assets/js/barra.js';

// Piezas comunes de las pantallas de gestión.
export const alerta = document.querySelector('#alerta');

export function mostrarError(mensaje) {
  alerta.textContent = mensaje;
  alerta.classList.remove('d-none');
}

export function celda(texto, secundaria = false) {
  const td = document.createElement('td');
  td.className = secundaria ? 'text-break d-none d-md-table-cell' : 'text-break';
  td.textContent = texto;
  return td;
}

export function boton(texto, clase, accion) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn btn-sm ${clase}`;
  b.textContent = texto;
  b.addEventListener('click', accion);
  return b;
}

// `clase` permite una insignia distinta de la de activo/inactivo (por ejemplo, los estados de asistencia de un turno).
export function estadoYAcciones(fila, activo, etiquetas, acciones, clase = null) {
  const estado = document.createElement('td');
  const insignia = document.createElement('span');
  insignia.className = `badge ${clase ?? (activo ? 'text-bg-success' : 'text-bg-secondary')}`;
  insignia.textContent = activo ? etiquetas[0] : etiquetas[1];
  estado.append(insignia);

  const columna = document.createElement('td');
  columna.className = 'text-end';
  const caja = document.createElement('div');
  caja.className = 'grupo-acciones';
  caja.append(...acciones);
  columna.append(caja);
  fila.append(estado, columna);
}

// Marca que el servidor deja al cerrar por inactividad: dura 60 s y sirve al volver con «atrás».
export function hayAvisoDeInactividad() {
  return document.cookie.split(';').some((cookie) => cookie.trim() === 'turnos_inactividad=1');
}

// Devuelve false si la sesión no sirve (ya se redirigió al login/panel).
// Una sesión vencida por inactividad vuelve al inicio con el aviso.
export function sesionValida(respuesta) {
  if (respuesta.estado === 401 && (respuesta.datos?.error?.codigo === 'sesion_expirada' || hayAvisoDeInactividad())) {
    location.replace('/?sesion=inactividad');
    return false;
  }
  if (respuesta.estado === 401 || respuesta.estado === 403) {
    location.replace('/');
    return false;
  }
  return true;
}

export function errorFormulario(mensaje) {
  const error = document.querySelector('#error-formulario');
  error.textContent = mensaje;
  error.classList.remove('d-none');
}

export function limpiarErrores(formulario) {
  document.querySelector('#error-formulario').classList.add('d-none');
  for (const campo of formulario.querySelectorAll('.form-control, .form-select')) {
    campo.classList.remove('is-invalid');
  }
}

// Marca el campo del error o, si no corresponde a ninguno, muestra el mensaje general.
export function señalar(formulario, campos, error, porDefecto) {
  const { codigo, mensaje } = error ?? {};
  const campo = campos[codigo];
  if (campo) {
    formulario.elements[campo]?.classList.add('is-invalid');
    document.querySelector(`#error-${campo}`).textContent = mensaje;
  } else {
    errorFormulario(mensaje ?? porDefecto);
  }
}

// Enlaza «Inicio» con el panel del rol, muestra usuario y rol y activa el cierre de sesión (barra.js).
export function iniciarEncabezado() {
  return iniciarBarra();
}

// Opciones del filtro «Estado» de los listados: el servidor filtra activos o todos; «inactivos» se resuelve en el cliente.
export function parametroEstado(valor) {
  return valor === 'activos' ? 'activos' : 'todos';
}

export function filtrarEstado(registros, valor) {
  return valor === 'inactivos' ? registros.filter((r) => !r.activo) : registros;
}

// Pinta una insignia de texto (especialidad, matrícula) dentro de un contenedor.
export function insignia(texto, clase) {
  const span = document.createElement('span');
  span.className = `badge ${clase}`;
  span.textContent = texto;
  return span;
}

// DNI (o número) en negrita y sin partirse.
export function celdaDestacada(texto) {
  const td = document.createElement('td');
  td.className = 'dni-fuerte text-nowrap';
  td.textContent = texto;
  return td;
}

// Correo y teléfono en dos líneas; en móvil se oculta con el resto de las columnas secundarias.
export function celdaContacto(email, telefono) {
  const td = document.createElement('td');
  td.className = 'contacto text-break d-none d-md-table-cell';
  for (const dato of [email, telefono]) {
    if (dato) {
      const linea = document.createElement('div');
      linea.textContent = dato;
      td.append(linea);
    }
  }
  return td;
}

// Una celda con una insignia por texto (matrícula, especialidades).
export function celdaInsignias(textos, clase) {
  const td = document.createElement('td');
  td.className = 'd-none d-md-table-cell';
  const caja = document.createElement('div');
  caja.className = 'd-flex flex-wrap gap-1';
  caja.append(...textos.map((t) => insignia(t, clase)));
  td.append(caja);
  return td;
}
