// Recorridos en un navegador real: turnos y disponibilidad (interfaz y flujos).
//
// Requiere la aplicación levantada con la base de db/schema.sql y Chrome instalado.
// Variables opcionales: APP_URL (http://127.0.0.1:8080), CHROME_PATH (/usr/bin/google-chrome),
// ARTEFACTOS_DIR.
//
// Ejecutar desde la raíz del proyecto: npm run test:navegador:turnos
// Cada ejecución crea consultorios, profesionales, agendas, pacientes y turnos con datos únicos (no hay borrado físico).
// Termina con código 1 si alguna comprobación falla. Guarda capturas y un informe JSON en ARTEFACTOS_DIR.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = (process.env.APP_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const ARTEFACTOS = process.env.ARTEFACTOS_DIR ?? path.join(raiz, 'specs/TUR-007/artifacts');
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const ESCRITORIO = { width: 1280, height: 800 };
const MOVIL = { width: 390, height: 844 };

// Usuarios semilla de db/schema.sql (sólo entorno local de prueba).
const ADMIN = { dni: '20000001', password: 'Password123!' };
const RECEPCION = { dni: '20000002', password: 'Password123!' };
const PROFESIONAL = { dni: '20000003', password: 'Password123!' };
const PACIENTE = { dni: '20000004', password: 'Password123!' };

const informe = { inicio: new Date().toISOString(), app: APP, comprobaciones: [] };
const sufijo = randomUUID().slice(0, 8);
const dniUnico = () => String(randomInt(50000000, 99999999));
const anioUnico = () => randomInt(2200, 2900);

function anotar(ac, descripcion, resultado, observado = '') {
  informe.comprobaciones.push({ ac, descripcion, resultado, observado });
  console.log(`${resultado === 'cumplido' ? 'OK    ' : 'FALLO '}${ac} ${descripcion}${observado ? ` — ${observado}` : ''}`);
}

async function comprobar(ac, descripcion, funcion) {
  try {
    anotar(ac, descripcion, 'cumplido', (await funcion()) ?? '');
  } catch (error) {
    anotar(ac, descripcion, 'fallo', error.message.split('\n')[0]);
  }
}

function afirmar(condicion, mensaje) {
  if (!condicion) {
    throw new Error(mensaje);
  }
}

// Si se indica un elemento, la captura se desplaza hasta mostrarlo.
async function captura(page, nombre, elemento = null) {
  await elemento?.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400); // deja terminar la animación de los modales
  await page.screenshot({ path: path.join(ARTEFACTOS, nombre) });
  return nombre;
}

async function ingresar(page, cuenta) {
  await page.goto(`${APP}/`);
  await page.fill('#dni', cuenta.dni);
  await page.fill('#password', cuenta.password);
  await page.click('button[type=submit]');
}

// Espera la URL de la página pedida y que su contenido esté visible.
async function abrir(page, pagina) {
  await page.goto(`${APP}/${pagina}`);
  await page.waitForURL((url) => new URL(url).pathname === `/${pagina}`);
  await page.waitForSelector('#contenido:not(.d-none)');
}

// Llamadas a la API con la sesión del navegador (la cookie de la página).
async function api(page, metodo, ruta, cuerpo) {
  return page.evaluate(async ({ metodo, ruta, cuerpo }) => {
    const respuesta = await fetch(ruta, {
      method: metodo, credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    return { estado: respuesta.status, datos: await respuesta.json().catch(() => null) };
  }, { metodo, ruta, cuerpo });
}

const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// Primer día del año que cae en miércoles (3 = miércoles en ISO), en formato AAAA-MM-DD.
function miercolesDe(anio) {
  const dia = new Date(Date.UTC(anio, 0, 1));
  while (dia.getUTCDay() !== 3) {
    dia.setUTCDate(dia.getUTCDate() + 1);
  }
  return dia.toISOString().slice(0, 10);
}

const filaTurno = (page, texto) => page.locator('#filas tr', { hasText: texto });
const filaFranja = (page, texto) => page.locator('#franjas tr', { hasText: texto });

// Busca franjas con el formulario de reserva y espera la respuesta de la API.
async function buscarHorarios(page, especialidad, desde, hasta, profesional = '') {
  await page.selectOption('#reserva-especialidad', String(especialidad));
  await page.selectOption('#reserva-profesional', profesional === '' ? '' : String(profesional));
  await page.fill('#reserva-desde', desde);
  await page.fill('#reserva-hasta', hasta);
  const respuesta = page.waitForResponse((r) => r.url().includes('/api/disponibilidad?') && r.request().method() === 'GET');
  await page.click('#buscar');
  await respuesta;
}

async function main() {
  await mkdir(ARTEFACTOS, { recursive: true });
  const navegador = await chromium.launch({ executablePath: CHROME, headless: true });
  const anio = anioUnico();
  const fecha = miercolesDe(anio);
  const nombreDestino = `Destino${sufijo}`;

  try {
    // Datos de prueba creados por la API con la sesión del administrador.
    const admin = await navegador.newContext({ viewport: ESCRITORIO });
    const paginaAdmin = await admin.newPage();
    await ingresar(paginaAdmin, ADMIN);
    await paginaAdmin.waitForURL((url) => new URL(url).pathname === '/administrador.html');
    await paginaAdmin.waitForSelector('#contenido:not(.d-none)');

    const especialidades = await api(paginaAdmin, 'GET', '/api/especialidades');
    const clinica = especialidades.datos.especialidades.find((e) => e.nombre === 'Clínica Médica').id;

    async function profesionalConAgenda(apellido, hora) {
      const alta = await api(paginaAdmin, 'POST', '/api/profesionales', {
        dni: dniUnico(), nombre: 'Navegador', apellido, telefono: null, email: null,
        fechaNacimiento: '1980-01-01', matricula: `NAV-${randomUUID().slice(0, 10)}`, especialidades: [clinica],
      });
      const consultorio = await api(paginaAdmin, 'POST', '/api/consultorios', { numero: `TN-${randomUUID().slice(0, 10)}`, piso: null, ubicacion: null });
      const agenda = await api(paginaAdmin, 'POST', '/api/agendas', {
        profesional: alta.datos.profesional.id, consultorio: consultorio.datos.consultorio.id, especialidad: clinica,
        diaSemana: 3, horaInicio: hora, horaFin: `${Number(hora.slice(0, 2)) + 1}:00`, duracionMinutos: 15,
        vigenteDesde: `${anio}-01-01`, vigenteHasta: `${anio}-12-31`,
      });
      afirmar(agenda.estado === 201, `no se creó la agenda: ${JSON.stringify(agenda.datos)}`);
      return { profesional: alta.datos.profesional.id, agenda: agenda.datos.agenda.id };
    }

    const original = await profesionalConAgenda(`Origen${sufijo}`, '09:00');
    const destino = await profesionalConAgenda(nombreDestino, '09:00');

    // Paciente: panel, búsqueda, reserva.
    const contextoPaciente = await navegador.newContext({ viewport: ESCRITORIO });
    const paciente = await contextoPaciente.newPage();
    await ingresar(paciente, PACIENTE);
    await paciente.waitForURL((url) => new URL(url).pathname === '/paciente.html');
    await paciente.waitForSelector('#contenido:not(.d-none)');

    await comprobar('AC-009', 'panel del paciente: «Mis turnos» es un enlace, no un pendiente', async () => {
      const opcion = paciente.locator('#opciones a', { hasText: 'Mis turnos' });
      afirmar(await opcion.count() === 1, 'no hay enlace «Mis turnos» en el panel del paciente');
      await opcion.click();
      await paciente.waitForURL((url) => new URL(url).pathname === '/turnos.html');
      await paciente.waitForSelector('#contenido:not(.d-none)');
      afirmar(await paciente.locator('#seccion-reserva').isVisible(), 'el paciente no ve «Reservar turno»');
    });

    await comprobar('AC-001', 'búsqueda de horarios: 4 franjas libres de una agenda de 09:00 a 10:00 de 15 minutos', async () => {
      await buscarHorarios(paciente, clinica, fecha, fecha, original.profesional);
      await paciente.waitForSelector('#franjas tr');
      const horarios = await paciente.locator('#franjas tr').allTextContents();
      afirmar(horarios.length === 4, `se esperaban 4 franjas y hubo ${horarios.length}`);
      await captura(paciente, 'AC-001-disponibilidad-desktop.png');
    });

    await comprobar('AC-002', 'el paciente reserva la franja de las 09:00 con motivo y aparece en «Turnos»', async () => {
      await paciente.fill('#reserva-motivo', 'Control de rutina');
      const respuesta = paciente.waitForResponse((r) => r.url().endsWith('/api/turnos') && r.request().method() === 'POST');
      await filaFranja(paciente, '09:00 a 09:15').getByRole('button', { name: 'Reservar' }).click();
      afirmar((await respuesta).status() === 201, 'la reserva no respondió 201');
      await paciente.waitForSelector('#reserva-mensaje:not(.d-none)');
      afirmar((await paciente.textContent('#reserva-mensaje')).includes('Turno reservado'), 'falta el mensaje de reserva confirmada');
      await paciente.waitForSelector(`#filas tr:has-text("${fecha} · 09:00 a 09:15")`);
      afirmar(await filaTurno(paciente, `${fecha} · 09:00 a 09:15`).count() === 1, 'el turno reservado no aparece en el listado');
    });

    await comprobar('AC-002', 'reserva desde el móvil (390×844): mensaje de confirmación y turno en la lista, sin desborde', async () => {
      const movil = await navegador.newContext({ viewport: MOVIL });
      const pagina = await movil.newPage();
      await ingresar(pagina, PACIENTE);
      await pagina.waitForURL((url) => new URL(url).pathname === '/paciente.html');
      await abrir(pagina, 'turnos.html');
      await buscarHorarios(pagina, clinica, fecha, fecha, original.profesional);
      await filaFranja(pagina, '09:15 a 09:30').getByRole('button', { name: 'Reservar' }).click();
      await pagina.waitForSelector('#reserva-mensaje:not(.d-none)');
      await pagina.waitForSelector(`#filas tr:has-text("${fecha} · 09:15 a 09:30")`);
      afirmar(await sinDesborde(pagina), 'la reserva desborda horizontalmente en móvil');
      await captura(pagina, 'AC-002-reserva-confirmada-movil.png', pagina.locator('#reserva-mensaje'));
      await movil.close();
    });

    // Cancelar el turno libera la franja.
    await comprobar('AC-004', 'el paciente cancela el turno y la franja vuelve a aparecer en la búsqueda', async () => {
      paciente.once('dialog', (dialogo) => dialogo.accept());
      const respuesta = paciente.waitForResponse((r) => /\/api\/turnos\/\d+\/estado$/.test(new URL(r.url()).pathname));
      await filaTurno(paciente, `${fecha} · 09:00 a 09:15`).getByRole('button', { name: 'Cancelar' }).click();
      afirmar((await respuesta).status() === 200, 'la cancelación no respondió 200');
      await paciente.waitForSelector('#mensaje-turno:not(.d-none)');
      afirmar((await paciente.textContent('#mensaje-turno')).includes('Turno cancelado'), 'falta el mensaje de cancelación');
      afirmar(await filaTurno(paciente, 'Cancelado').count() >= 1, 'el turno no figura como cancelado');
      await captura(paciente, 'AC-004-cancelacion-desktop.png', filaTurno(paciente, 'Cancelado').first());
      await buscarHorarios(paciente, clinica, fecha, fecha, original.profesional);
      afirmar(await filaFranja(paciente, '09:00 a 09:15').count() === 1, 'la franja cancelada no volvió a estar libre');
    });

    // Reprogramar a otro profesional de la misma especialidad.
    await comprobar('AC-005', 'reprogramación a otro profesional de la misma especialidad, con captura del modal', async () => {
      await api(paciente, 'POST', '/api/turnos', { agenda: original.agenda, fecha, horaInicio: '09:30' });
      await paciente.reload();
      await paciente.waitForSelector(`#filas tr:has-text("${fecha} · 09:30 a 09:45")`);
      await filaTurno(paciente, `${fecha} · 09:30 a 09:45`).getByRole('button', { name: 'Reprogramar' }).click();
      await paciente.waitForSelector('#modal-reprogramar.show');
      await paciente.fill('#reprogramar-desde', fecha);
      await paciente.fill('#reprogramar-hasta', fecha);
      const busqueda = paciente.waitForResponse((r) => r.url().includes('/api/disponibilidad?'));
      await paciente.click('#reprogramar-buscar');
      await busqueda;
      await paciente.waitForSelector('#reprogramar-franjas tr');
      const franjaDestino = paciente.locator('#reprogramar-franjas tr', { hasText: nombreDestino }).filter({ hasText: '09:00 a 09:15' });
      afirmar(await franjaDestino.count() === 1, 'el profesional de destino no ofrece 09:00');
      await captura(paciente, 'AC-005-reprogramar-franjas-desktop.png');
      const cambio = paciente.waitForResponse((r) => /\/reprogramacion$/.test(new URL(r.url()).pathname));
      await franjaDestino.getByRole('button', { name: 'Elegir' }).click();
      afirmar((await cambio).status() === 200, 'la reprogramación no respondió 200');
      await paciente.waitForSelector('#modal-reprogramar', { state: 'hidden' });
      afirmar((await paciente.textContent('#mensaje-turno')).includes('Turno reprogramado'), 'falta el mensaje de reprogramación');
      afirmar(await filaTurno(paciente, `${fecha} · 09:00 a 09:15`).filter({ hasText: nombreDestino }).count() === 1,
        'el listado no muestra el nuevo profesional');
    });

    await comprobar('AC-005', 'reprogramación en 390×844: el modal de horarios libres se ve sin desborde', async () => {
      const movil = await navegador.newContext({ viewport: MOVIL });
      const pagina = await movil.newPage();
      await ingresar(pagina, PACIENTE);
      await pagina.waitForURL((url) => new URL(url).pathname === '/paciente.html');
      await abrir(pagina, 'turnos.html');
      await pagina.waitForSelector(`#filas tr:has-text("${fecha} · 09:00 a 09:15")`);
      await filaTurno(pagina, `${fecha} · 09:00 a 09:15`).getByRole('button', { name: 'Reprogramar' }).click();
      await pagina.waitForSelector('#modal-reprogramar.show');
      await pagina.fill('#reprogramar-desde', fecha);
      await pagina.fill('#reprogramar-hasta', fecha);
      const busqueda = pagina.waitForResponse((r) => r.url().includes('/api/disponibilidad?'));
      await pagina.click('#reprogramar-buscar');
      await busqueda;
      await pagina.waitForSelector('#reprogramar-franjas tr');
      afirmar(await sinDesborde(pagina), 'el modal de reprogramación desborda en móvil');
      await captura(pagina, 'AC-005-reprogramacion-movil.png');
      await movil.close();
    });

    // Listado de recepción con filtros.
    await comprobar('AC-006', 'recepción lista los turnos del día, filtrados por fecha, en 1280×800', async () => {
      const contextoRecepcion = await navegador.newContext({ viewport: ESCRITORIO });
      const recepcion = await contextoRecepcion.newPage();
      await ingresar(recepcion, RECEPCION);
      await recepcion.waitForURL((url) => new URL(url).pathname === '/recepcionista.html');
      await abrir(recepcion, 'turnos.html');
      await recepcion.fill('#filtro-desde', fecha);
      await recepcion.fill('#filtro-hasta', fecha);
      await recepcion.waitForSelector(`#filas tr:has-text("${fecha}")`);
      afirmar(await recepcion.locator('#columna-paciente').isVisible(), 'recepción no ve la columna de paciente');
      await captura(recepcion, 'AC-006-listado-recepcion-desktop.png');
      await contextoRecepcion.close();
    });

    await comprobar('AC-006', 'el historial del paciente en 390×844 muestra sus turnos sin desborde', async () => {
      const movil = await navegador.newContext({ viewport: MOVIL });
      const pagina = await movil.newPage();
      await ingresar(pagina, PACIENTE);
      await pagina.waitForURL((url) => new URL(url).pathname === '/paciente.html');
      await abrir(pagina, 'turnos.html');
      await pagina.waitForSelector(`#filas tr:has-text("${fecha}")`);
      afirmar(await pagina.locator('#columna-paciente').isHidden(), 'el paciente ve la columna de paciente');
      // En 390 px el profesional y la especialidad de cada turno deben verse.
      const detalle = pagina.locator('#filas small', { hasText: nombreDestino }).first();
      afirmar(await detalle.isVisible(), 'en móvil no se ve el profesional de cada turno');
      afirmar(await sinDesborde(pagina), 'el historial desborda horizontalmente en móvil');
      await captura(pagina, 'AC-006-historial-paciente-movil.png', filaTurno(pagina, nombreDestino).first());
      await movil.close();
    });

    // El profesional ve sus turnos, sin formulario de reserva ni acciones de gestión.
    await comprobar('AC-007', 'el profesional lista sus turnos sin «Reservar turno» ni acciones de gestión', async () => {
      const contextoProfesional = await navegador.newContext({ viewport: ESCRITORIO });
      const profesional = await contextoProfesional.newPage();
      await ingresar(profesional, PROFESIONAL);
      await profesional.waitForURL((url) => new URL(url).pathname === '/profesional.html');
      const opcion = profesional.locator('#opciones a', { hasText: 'Mis turnos' });
      afirmar(await opcion.count() === 1, 'no hay enlace «Mis turnos» en el panel del profesional');
      await opcion.click();
      await profesional.waitForURL((url) => new URL(url).pathname === '/turnos.html');
      await profesional.waitForSelector('#contenido:not(.d-none)');
      afirmar(await profesional.locator('#seccion-reserva').isHidden(), 'el profesional ve el formulario de reserva');
      afirmar(await profesional.locator('#filas button', { hasText: 'Cancelar' }).count() === 0, 'el profesional ve acciones de cancelar');
      await contextoProfesional.close();
    });

    await comprobar('AC-007', 'captura del panel del paciente: sin gestión de turnos ajenos', async () => {
      await paciente.goto(`${APP}/paciente.html`);
      await paciente.waitForSelector('#contenido:not(.d-none)');
      await captura(paciente, 'AC-007-panel-paciente-desktop.png');
    });

    await comprobar('AC-009', 'panel de recepción y administrador: «Turnos» es un enlace, no un pendiente', async () => {
      const contexto = await navegador.newContext({ viewport: ESCRITORIO });
      const pagina = await contexto.newPage();
      await ingresar(pagina, RECEPCION);
      await pagina.waitForURL((url) => new URL(url).pathname === '/recepcionista.html');
      await pagina.waitForSelector('#contenido:not(.d-none)');
      afirmar(await pagina.locator('#opciones a', { hasText: 'Turnos' }).count() === 1, 'recepción: «Turnos» no es un enlace');
      await contexto.close();
    });

    await comprobar('AC-009', 'panel del administrador: «Turnos» abre la gestión de turnos', async () => {
      await paginaAdmin.goto(`${APP}/administrador.html`);
      await paginaAdmin.waitForSelector('#contenido:not(.d-none)');
      await paginaAdmin.locator('#opciones a', { hasText: 'Turnos' }).click();
      await paginaAdmin.waitForURL((url) => new URL(url).pathname === '/turnos.html');
      await paginaAdmin.waitForSelector('#contenido:not(.d-none)');
      afirmar(await paginaAdmin.locator('#seccion-reserva').isVisible(), 'el administrador no ve la búsqueda de reserva');
    });

    await comprobar('AC-009', 'la gestión de turnos sin desborde horizontal en 1280×800 y 390×844, con capturas', async () => {
      afirmar(await sinDesborde(paginaAdmin), 'la gestión de turnos desborda en escritorio');
      await captura(paginaAdmin, 'AC-009-gestion-turnos-desktop.png');
      await paginaAdmin.setViewportSize(MOVIL);
      afirmar(await sinDesborde(paginaAdmin), 'la gestión de turnos desborda en móvil');
      await captura(paginaAdmin, 'AC-009-gestion-turnos-movil.png');
      await paginaAdmin.setViewportSize(ESCRITORIO);
    });

    await admin.close();
    await contextoPaciente.close();
  } finally {
    await navegador.close();
  }

  informe.fin = new Date().toISOString();
  await writeFile(path.join(ARTEFACTOS, 'navegador-resultados-turnos.json'), `${JSON.stringify(informe, null, 2)}\n`);
  const fallos = informe.comprobaciones.filter((c) => c.resultado !== 'cumplido');
  console.log(`\n${informe.comprobaciones.length - fallos.length}/${informe.comprobaciones.length} comprobaciones cumplidas.`);
  process.exitCode = fallos.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
