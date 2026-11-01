import { pedir } from '/assets/js/api.js';
import { celda, iniciarEncabezado, mostrarError, sesionValida } from '/assets/js/ui.js';

// Reportes e indicadores: filtros de período, especialidad y profesional, tarjetas, desglose y CSV.
const formulario = document.querySelector('#formulario');
const fechaDesde = document.querySelector('#fecha-desde');
const fechaHasta = document.querySelector('#fecha-hasta');
const selectEspecialidad = document.querySelector('#especialidad');
const selectProfesional = document.querySelector('#profesional');
const mensajeFiltros = document.querySelector('#mensaje-filtros');
const indicadores = document.querySelector('#indicadores');
const vacio = document.querySelector('#vacio');
const filas = document.querySelector('#filas');

// Filtros del último reporte mostrado: el CSV exporta exactamente lo que se ve en pantalla.
let aplicados = null;

// Fecha AAAA-MM-DD del día local (toISOString usa UTC y puede cambiar de día por la noche).
function fechaLocal(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

function periodoDe(preset, hoy = new Date()) {
  const dia = (dias) => new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + dias);
  switch (preset) {
    case 'hoy': return [dia(0), dia(0)];
    case 'semana': return [dia(-6), dia(0)];
    case 'mes-anterior': return [new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1), new Date(hoy.getFullYear(), hoy.getMonth(), 0)];
    case '30-dias': return [dia(-29), dia(0)];
    default: return [new Date(hoy.getFullYear(), hoy.getMonth(), 1), dia(0)]; // «mes»: del día 1 a hoy
  }
}

function fijarPeriodo(preset) {
  const [desde, hasta] = periodoDe(preset);
  fechaDesde.value = fechaLocal(desde);
  fechaHasta.value = fechaLocal(hasta);
}

function mostrarMensaje(texto) {
  mensajeFiltros.textContent = texto;
  mensajeFiltros.className = 'alert alert-danger';
}

function porcentaje(valor) {
  return valor === null ? '—' : `${valor.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`;
}

function formatoFecha(iso) {
  const [anio, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${anio}`;
}

function numero(valor) {
  const td = celda(String(valor));
  td.classList.add('text-end');
  return td;
}

function pintar(reporte) {
  const { totales, tasas } = reporte;
  const hayTurnos = totales.otorgados > 0;
  indicadores.classList.toggle('d-none', !hayTurnos);
  vacio.classList.toggle('d-none', hayTurnos);
  if (!hayTurnos) {
    // Sin turnos no se muestran tarjetas con 0 % que parecerían un resultado.
    document.querySelector('#vacio-detalle').textContent =
      `No existen turnos otorgados entre el ${formatoFecha(reporte.periodo.desde)} y el ${formatoFecha(reporte.periodo.hasta)} con los criterios aplicados. Pruebe ampliando el rango de fechas.`;
    filas.replaceChildren();
    return;
  }

  document.querySelector('#v-otorgados').textContent = totales.otorgados;
  document.querySelector('#v-atendidos').textContent = totales.atendidos;
  document.querySelector('#v-cancelados').textContent = totales.cancelados;
  document.querySelector('#v-ausentes').textContent = totales.ausentes;
  document.querySelector('#t-ausentismo').textContent = porcentaje(tasas.ausentismo);
  document.querySelector('#t-cancelacion').textContent = porcentaje(tasas.cancelacion);
  document.querySelector('#t-ocupacion').textContent = porcentaje(tasas.ocupacion);
  document.querySelector('#confirmados').textContent =
    `Turnos confirmados: ${totales.pendientesAsistencia} pendientes de registrar asistencia y ${totales.programados} programados a futuro.`;

  filas.replaceChildren(...reporte.desglose.map((fila) => {
    const tr = document.createElement('tr');
    tr.append(
      celda(fila.especialidad.nombre),
      celda(`${fila.profesional.apellido}, ${fila.profesional.nombre}`),
      numero(fila.otorgados), numero(fila.atendidos), numero(fila.cancelados), numero(fila.ausentes),
      numero(fila.pendientesAsistencia), numero(fila.programados),
      numero(porcentaje(fila.tasas.ausentismo)), numero(porcentaje(fila.tasas.cancelacion)), numero(porcentaje(fila.tasas.ocupacion)),
    );
    return tr;
  }));
}

function parametros() {
  const datos = new URLSearchParams({ fecha_desde: fechaDesde.value, fecha_hasta: fechaHasta.value });
  if (selectEspecialidad.value) datos.set('especialidad', selectEspecialidad.value);
  if (selectProfesional.value) datos.set('profesional', selectProfesional.value);
  return datos;
}

async function aplicar() {
  mensajeFiltros.className = 'alert d-none';
  if (!fechaDesde.value || !fechaHasta.value) {
    mostrarMensaje('Elegí las fechas «Desde» y «Hasta».');
    return;
  }
  if (fechaDesde.value > fechaHasta.value) {
    mostrarMensaje('La fecha «Desde» no puede ser posterior a «Hasta».');
    return;
  }

  const filtros = parametros();
  let respuesta;
  try {
    respuesta = await pedir(`/api/reportes/turnos?${filtros}`);
  } catch {
    mostrarMensaje('No pudimos conectar con el servidor. Intentá nuevamente.');
    return;
  }
  if (!sesionValida(respuesta)) {
    return;
  }
  if (!respuesta.ok) {
    mostrarMensaje(respuesta.datos?.error?.mensaje ?? 'No pudimos generar el reporte.');
    return;
  }
  aplicados = filtros;
  pintar(respuesta.datos);
}

async function exportar() {
  mensajeFiltros.className = 'alert d-none';
  if (aplicados === null) {
    mostrarMensaje('Aplicá los filtros antes de exportar.');
    return;
  }
  let respuesta;
  try {
    respuesta = await fetch(`/api/reportes/turnos.csv?${aplicados}`, { credentials: 'same-origin' });
  } catch {
    mostrarMensaje('No pudimos conectar con el servidor. Intentá nuevamente.');
    return;
  }
  if (!respuesta.ok) {
    const datos = await respuesta.json().catch(() => null);
    mostrarMensaje(datos?.error?.mensaje ?? 'No pudimos exportar el reporte.');
    return;
  }
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(await respuesta.blob());
  enlace.download = `reporte-turnos-${aplicados.get('fecha_desde')}-a-${aplicados.get('fecha_hasta')}.csv`;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(enlace.href);
}

async function cargarOpciones() {
  const [especialidades, profesionales] = await Promise.all([
    pedir('/api/especialidades?estado=todas'),
    pedir('/api/profesionales?estado=todos'),
  ]);
  if (!sesionValida(especialidades) || !sesionValida(profesionales)) {
    return false;
  }
  if (!especialidades.ok || !profesionales.ok) {
    mostrarError('No pudimos cargar los filtros del reporte.');
    return false;
  }
  selectEspecialidad.append(...especialidades.datos.especialidades.map((e) => new Option(e.nombre, e.id)));
  selectProfesional.append(...profesionales.datos.profesionales.map((p) => new Option(`${p.apellido}, ${p.nombre}`, p.id)));
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
  document.querySelector('#contenido').classList.remove('d-none');
  iniciarEncabezado();
  if (!(await cargarOpciones())) {
    return;
  }
  fijarPeriodo('mes');
  await aplicar();
}

formulario.addEventListener('submit', (evento) => {
  evento.preventDefault();
  aplicar();
});
document.querySelector('#limpiar').addEventListener('click', () => {
  fijarPeriodo('mes');
  selectEspecialidad.value = '';
  selectProfesional.value = '';
  aplicar();
});
for (const boton of document.querySelectorAll('#presets button')) {
  boton.addEventListener('click', () => {
    fijarPeriodo(boton.dataset.preset);
    aplicar();
  });
}
document.querySelector('#exportar').addEventListener('click', exportar);

iniciar();
