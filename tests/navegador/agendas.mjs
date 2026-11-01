// Recorridos de TUR-004 en un navegador real (T-004, T-005): consultorios y agendas, AC-001 a AC-008.
//
// Requiere la aplicación levantada con la base de db/schema.sql (sección TUR-004) y Chrome instalado.
// Variables opcionales: APP_URL (http://127.0.0.1:8080), CHROME_PATH (/usr/bin/google-chrome),
// ARTEFACTOS_DIR (specs/TUR-004/artifacts).
//
// Ejecutar desde la raíz del proyecto: npm run test:navegador:agendas
// Cada ejecución crea consultorios, profesionales y agendas con datos únicos (no hay borrado físico).
// Termina con código 1 si alguna comprobación falla. Guarda capturas y un informe JSON en ARTEFACTOS_DIR.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = (process.env.APP_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const ARTEFACTOS = process.env.ARTEFACTOS_DIR ?? path.join(raiz, 'specs/TUR-004/artifacts');
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const ESCRITORIO = { width: 1280, height: 800 };
const MOVIL = { width: 390, height: 844 };

// Usuarios semilla de db/schema.sql (sólo entorno local de prueba).
const ADMIN = { dni: '20000001', password: 'Password123!' };
const PROFESIONAL = { dni: '20000003', password: 'Password123!' };
const RECEPCION = { dni: '20000002', password: 'Password123!' };

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

// Si se indica un elemento, la captura se desplaza hasta mostrarlo (por ejemplo, la fila dada de alta).
async function captura(page, nombre, elemento = null) {
  await elemento?.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400); // deja terminar la animación del modal
  await page.screenshot({ path: path.join(ARTEFACTOS, nombre) });
  return nombre;
}

async function ingresar(page, cuenta) {
  await page.goto(`${APP}/`);
  await page.fill('#dni', cuenta.dni);
  await page.fill('#password', cuenta.password);
  await page.click('button[type=submit]');
}

// Espera la URL de la página pedida: sin eso, una redirección pendiente deja ver otra pantalla.
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

const fila = (page, texto) => page.locator('#filas tr', { has: page.getByText(texto, { exact: true }) });
const filaQueContiene = (page, texto) => page.locator('#filas tr', { hasText: texto });
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const estadoApi = (page, ruta) => page.evaluate(async (r) => (await fetch(r)).status, ruta);

// Envía el formulario abierto y devuelve el estado HTTP de la llamada que dispara.
async function guardar(page, metodo, ruta) {
  const respuesta = page.waitForResponse((r) => r.url().includes(ruta) && r.request().method() === metodo);
  await page.click('#formulario button[type=submit]');
  return (await respuesta).status();
}

async function esperarCierre(page) {
  await page.waitForSelector('#modal-formulario', { state: 'hidden' });
}

async function main() {
  await mkdir(ARTEFACTOS, { recursive: true });
  const navegador = await chromium.launch({ executablePath: CHROME, headless: true });
  const numeroConsultorio = `NAV-${sufijo}`;
  const numeroConsultorioB = `NAVB-${sufijo}`;
  const anio = anioUnico();

  try {
    const contexto = await navegador.newContext({ viewport: ESCRITORIO });
    const pagina = await contexto.newPage();
    await ingresar(pagina, ADMIN);
    await pagina.waitForURL((url) => new URL(url).pathname === '/administrador.html');
    await pagina.waitForSelector('#contenido:not(.d-none)');

    // AC-008: accesos del panel del administrador.
    await comprobar('AC-008', 'panel del administrador: Consultorios, Agendas y Turnos son enlaces; no queda ninguna opción pendiente (TUR-005)', async () => {
      const enlaces = await pagina.locator('#opciones a.btn-outline-primary').allTextContents();
      afirmar(JSON.stringify(enlaces.slice(-4)) === JSON.stringify(['Consultorios', 'Agendas', 'Ver turnos', 'Ver reportes']), `enlaces: ${enlaces}`);
      const pendientes = await pagina.locator('#opciones .badge.text-bg-secondary').allTextContents();
      afirmar(pendientes.length === 0, `pendientes: ${pendientes}`);
      const escritorio = await captura(pagina, 'AC-008-panel-admin-desktop.png');
      const movil = await contexto.browser().newContext({ viewport: MOVIL });
      const p = await movil.newPage();
      await ingresar(p, ADMIN);
      await p.waitForSelector('#contenido:not(.d-none)');
      afirmar(await sinDesborde(p), 'hay desborde horizontal en móvil');
      const archivoMovil = await captura(p, 'AC-008-panel-admin-movil.png');
      await movil.close();
      return `${escritorio}, ${archivoMovil}`;
    });

    // AC-001 a AC-003: consultorios.
    await pagina.click('#opciones a:has-text("Consultorios")');
    await pagina.waitForURL((url) => new URL(url).pathname === '/consultorios.html');
    await pagina.waitForSelector('#contenido:not(.d-none)');

    await comprobar('AC-001', 'alta de consultorio desde la pantalla: aparece en el listado', async () => {
      await pagina.click('#nuevo');
      await pagina.waitForSelector('#modal-formulario.show');
      await pagina.fill('#numero', numeroConsultorio);
      await pagina.fill('#piso', 'Planta baja');
      await pagina.fill('#ubicacion', 'Ala de prueba');
      afirmar(await guardar(pagina, 'POST', '/api/consultorios') === 201, 'la API debía responder 201');
      await esperarCierre(pagina);
      afirmar(await fila(pagina, numeroConsultorio).isVisible(), 'el consultorio no aparece en el listado');
      return captura(pagina, 'AC-001-consultorio-alta-desktop.png', fila(pagina, numeroConsultorio));
    });

    await comprobar('AC-002', 'número vacío y número repetido se señalan en el campo, sin guardar', async () => {
      await pagina.click('#nuevo');
      await pagina.waitForSelector('#modal-formulario.show');
      afirmar(await guardar(pagina, 'POST', '/api/consultorios') === 400, 'número vacío debía responder 400');
      afirmar(await pagina.isVisible('#error-numero'), 'el error debía mostrarse junto al número');
      await pagina.fill('#numero', numeroConsultorio);
      afirmar(await guardar(pagina, 'POST', '/api/consultorios') === 409, 'número repetido debía responder 409');
      const mensaje = await pagina.textContent('#error-numero');
      afirmar(mensaje.includes('Ya existe'), `mensaje: ${mensaje}`);
      return captura(pagina, 'AC-002-consultorio-numero-duplicado-desktop.png');
    });
    await pagina.click('#modal-formulario .btn-outline-secondary');
    await esperarCierre(pagina);

    await comprobar('AC-003', 'editar, no desactivar con agendas activas, y desactivar y reactivar uno sin agendas', async () => {
      const capturas = [];
      // Consultorio propio con una agenda y sin turnos (la semilla puede tener turnos futuros tras otras pruebas).
      const consultorioAgendado = await api(pagina, 'POST', '/api/consultorios', { numero: `AG-${sufijo}`, piso: null, ubicacion: null });
      afirmar(consultorioAgendado.estado === 201, 'no se creó el consultorio con agenda');
      const profesionales = await api(pagina, 'GET', '/api/profesionales');
      const especialidades = await api(pagina, 'GET', '/api/especialidades');
      const profesional = profesionales.datos.profesionales.find((p) => p.matricula === 'MP-10001').id;
      const clinica = especialidades.datos.especialidades.find((e) => e.nombre === 'Clínica Médica').id;
      const agenda = await api(pagina, 'POST', '/api/agendas', {
        profesional, consultorio: consultorioAgendado.datos.consultorio.id, especialidad: clinica, diaSemana: 4,
        horaInicio: '09:00', horaFin: '10:00', duracionMinutos: 15, vigenteDesde: `${anio}-01-01`, vigenteHasta: `${anio}-12-31`,
      });
      afirmar(agenda.estado === 201, `no se creó la agenda: ${JSON.stringify(agenda.datos)}`);
      const numeroAgendado = `AG-${sufijo}`;
      await fila(pagina, numeroConsultorio).getByRole('button', { name: 'Editar' }).click();
      await pagina.waitForSelector('#modal-formulario.show');
      await pagina.fill('#ubicacion', 'Ubicación editada');
      afirmar(await guardar(pagina, 'PUT', '/api/consultorios/') === 200, 'la edición debía responder 200');
      await esperarCierre(pagina);
      afirmar(await fila(pagina, numeroConsultorio).getByText('Ubicación editada', { exact: true }).isVisible(), 'la edición no se refleja en el listado');
      capturas.push(await captura(pagina, 'AC-003-consultorio-editar-desktop.png'));

      await pagina.selectOption('#filtro-estado', 'todos'); // el consultorio desactivado sigue en el listado
      await fila(pagina, numeroAgendado).getByRole('button', { name: 'Desactivar' }).click();
      await pagina.waitForSelector('#alerta:not(.d-none)');
      const alerta = await pagina.textContent('#alerta');
      afirmar(alerta.includes('agendas activas'), `alerta: ${alerta}`);
      afirmar(await fila(pagina, numeroAgendado).getByText('Activo', { exact: true }).isVisible(), 'el consultorio con agenda debía seguir activo');
      capturas.push(await captura(pagina, 'AC-003-consultorio-desactivar-con-agendas-desktop.png'));

      await fila(pagina, numeroConsultorio).getByRole('button', { name: 'Desactivar' }).click();
      await pagina.waitForSelector(`#filas tr:has(td:text-is("${numeroConsultorio}")) .badge.text-bg-secondary`);
      capturas.push(await captura(pagina, 'AC-003-consultorio-desactivado-desktop.png'));
      await fila(pagina, numeroConsultorio).getByRole('button', { name: 'Reactivar' }).click();
      await pagina.waitForSelector(`#filas tr:has(td:text-is("${numeroConsultorio}")) .badge.text-bg-success`);
      capturas.push(await captura(pagina, 'AC-003-consultorio-reactivado-desktop.png', fila(pagina, numeroConsultorio)));
      return capturas.join(', ');
    });

    // Consultorio de prueba para las agendas: se crea por la API desde la sesión del administrador.
    const consultorioB = await api(pagina, 'POST', '/api/consultorios', { numero: numeroConsultorioB, piso: null, ubicacion: null });
    afirmar(consultorioB.estado === 201, `consultorio B: ${consultorioB.estado}`);
    const clinica = (await api(pagina, 'GET', '/api/especialidades')).datos.especialidades.find((e) => e.nombre === 'Clínica Médica').id;
    const profesional = await api(pagina, 'POST', '/api/profesionales', {
      dni: dniUnico(), nombre: 'Agenda', apellido: `Navegador${sufijo}`, telefono: null, email: null,
      fechaNacimiento: '1980-01-01', matricula: `NAV-${sufijo}`, especialidades: [clinica],
    });
    afirmar(profesional.estado === 201, `profesional de prueba: ${profesional.estado}`);
    const profesionalId = profesional.datos.profesional.id;
    const consultorioA = (await api(pagina, 'GET', `/api/consultorios?estado=todos&q=${numeroConsultorio}`)).datos.consultorios[0].id;
    const nombreProfesional = `Navegador${sufijo}, Agenda`;

    // AC-004 a AC-006: agendas del administrador.
    await abrir(pagina, 'administrador.html');
    await pagina.click('#opciones a:has-text("Agendas")');
    await pagina.waitForURL((url) => new URL(url).pathname === '/agendas.html');
    await pagina.waitForSelector('#contenido:not(.d-none)');

    const llenarAgenda = async ({ profesionalValor, consultorioValor, horaInicio, horaFin, desde, hasta, dia = '3', duracion = '15' }) => {
      await pagina.selectOption('#profesional', String(profesionalValor));
      await pagina.selectOption('#consultorio', String(consultorioValor));
      await pagina.selectOption('#diaSemana', dia);
      await pagina.fill('#horaInicio', horaInicio);
      await pagina.fill('#horaFin', horaFin);
      await pagina.fill('#duracionMinutos', duracion);
      await pagina.fill('#vigenteDesde', desde);
      await pagina.fill('#vigenteHasta', hasta);
    };

    await comprobar('AC-004', 'alta de agenda con especialidad del profesional y vigencia: aparece en el listado', async () => {
      await pagina.click('#nuevo');
      await pagina.waitForSelector('#modal-formulario.show');
      await llenarAgenda({
        profesionalValor: profesionalId, consultorioValor: consultorioA, horaInicio: '09:00', horaFin: '10:00',
        desde: `${anio}-01-01`, hasta: `${anio}-12-31`,
      });
      afirmar((await pagina.locator('#especialidad option').allTextContents()).includes('Clínica Médica'), 'la especialidad del profesional debía ofrecerse');
      afirmar(await guardar(pagina, 'POST', '/api/agendas') === 201, 'la API debía responder 201');
      await esperarCierre(pagina);
      afirmar(await filaQueContiene(pagina, nombreProfesional).filter({ hasText: 'Miércoles 09:00 a 10:00' }).isVisible(), 'la agenda no aparece en el listado');
      return captura(pagina, 'AC-004-agenda-alta-desktop.png');
    });

    await comprobar('AC-005', 'agenda que se superpone con otra del profesional se rechaza y muestra el motivo', async () => {
      await pagina.click('#nuevo');
      await pagina.waitForSelector('#modal-formulario.show');
      await llenarAgenda({
        profesionalValor: profesionalId, consultorioValor: consultorioB.datos.consultorio.id, horaInicio: '09:30', horaFin: '10:30',
        desde: `${anio}-01-01`, hasta: `${anio}-12-31`,
      });
      afirmar(await guardar(pagina, 'POST', '/api/agendas') === 409, 'la superposición debía responder 409');
      await pagina.waitForSelector('#error-formulario:not(.d-none)');
      const mensaje = await pagina.textContent('#error-formulario');
      afirmar(mensaje.includes('superpone'), `mensaje: ${mensaje}`);
      const captura1 = await captura(pagina, 'AC-005-agenda-superpuesta-desktop.png');
      await pagina.click('#modal-formulario .btn-outline-secondary');
      await esperarCierre(pagina);
      return captura1;
    });

    await comprobar('AC-006', 'editar la duración y desactivar la agenda desde el listado', async () => {
      await filaQueContiene(pagina, nombreProfesional).getByRole('button', { name: 'Editar' }).click();
      await pagina.waitForSelector('#modal-formulario.show');
      await pagina.fill('#duracionMinutos', '20');
      afirmar(await guardar(pagina, 'PUT', '/api/agendas/') === 200, 'la edición debía responder 200');
      await esperarCierre(pagina);
      const filaAgenda = () => filaQueContiene(pagina, nombreProfesional);
      afirmar(await filaAgenda().filter({ hasText: '(20 min)' }).isVisible(), 'la duración editada no se refleja');
      const editada = await captura(pagina, 'AC-006-agenda-editar-desktop.png');
      await pagina.selectOption('#filtro-estado', 'todas'); // la agenda desactivada sigue en el listado
      await filaAgenda().getByRole('button', { name: 'Desactivar' }).click();
      await pagina.waitForSelector(`#filas tr:has-text("${nombreProfesional}") .badge.text-bg-secondary`);
      return `${editada}, ${await captura(pagina, 'AC-006-agenda-desactivar-desktop.png')}`;
    });

    await comprobar('AC-008', 'móvil: consultorios y agendas sin desborde horizontal; la tabla de agendas se filtra por profesional', async () => {
      await pagina.selectOption('#filtro-estado', 'todas'); // la agenda de prueba ya está desactivada (AC-006)
      await pagina.selectOption('#filtro-profesional', String(profesionalId));
      await pagina.waitForTimeout(400);
      const filas = await pagina.locator('#filas tr').allTextContents();
      afirmar(filas.length > 0 && filas.every((t) => t.includes(nombreProfesional)), `filas del filtro: ${filas.length}`);
      await pagina.selectOption('#filtro-profesional', '');
      const movil = await contexto.browser().newContext({ viewport: MOVIL });
      const p = await movil.newPage();
      await ingresar(p, ADMIN);
      await p.waitForURL((url) => new URL(url).pathname === '/administrador.html');
      await abrir(p, 'agendas.html');
      afirmar(await sinDesborde(p), 'agendas: desborde horizontal en móvil');
      // La tabla puede desplazarse, pero los botones de la primera fila deben caer dentro de la pantalla.
      const accionesVisibles = await p.evaluate(() => [...document.querySelectorAll('#filas tr:first-child button')]
        .every((b) => b.getBoundingClientRect().right <= window.innerWidth));
      afirmar(accionesVisibles, 'las acciones de la primera fila quedan fuera de la pantalla en móvil');
      const agendas = await captura(p, 'AC-008-agendas-movil.png');
      await abrir(p, 'consultorios.html');
      afirmar(await sinDesborde(p), 'consultorios: desborde horizontal en móvil');
      const accionesConsultorios = await p.evaluate(() => [...document.querySelectorAll('#filas tr:first-child button')]
        .every((b) => b.getBoundingClientRect().right <= window.innerWidth));
      afirmar(accionesConsultorios, 'las acciones de consultorios quedan fuera de la pantalla en móvil');
      const consultorios = await captura(p, 'AC-008-consultorios-movil.png');
      await movil.close();
      return `${agendas}, ${consultorios}`;
    });

    // AC-007: el profesional configura su propia agenda y no ve la de otros.
    await comprobar('AC-007', 'profesional: Mi agenda y Mis turnos son sus enlaces; configura su agenda y consultorios le redirige a su panel', async () => {
      const c = await navegador.newContext({ viewport: ESCRITORIO });
      const p = await c.newPage();
      await ingresar(p, PROFESIONAL);
      await p.waitForURL((url) => new URL(url).pathname === '/profesional.html');
      await p.waitForSelector('#contenido:not(.d-none)');
      const enlaces = await p.locator('#opciones a.btn-outline-primary').allTextContents();
      afirmar(JSON.stringify(enlaces) === JSON.stringify(['Mi agenda', 'Mis turnos']), `enlaces: ${enlaces}`);
      const panel = await captura(p, 'AC-007-panel-profesional-desktop.png');
      await p.click('#opciones a');
      await p.waitForURL((url) => new URL(url).pathname === '/agendas.html');
      await p.waitForSelector('#contenido:not(.d-none)');
      afirmar(!(await p.isVisible('#contenedor-filtro-profesional')), 'el profesional no debía ver el filtro por profesional');
      afirmar(!(await p.isVisible('#contenedor-profesional')), 'el profesional no debía elegir otro profesional');
      const dia = String(randomInt(2, 8));
      const hora = randomInt(6, 20);
      await p.click('#nuevo');
      await p.waitForSelector('#modal-formulario.show');
      await p.selectOption('#consultorio', String(consultorioB.datos.consultorio.id));
      await p.selectOption('#diaSemana', dia);
      await p.fill('#horaInicio', `${String(hora).padStart(2, '0')}:00`);
      await p.fill('#horaFin', `${String(hora + 1).padStart(2, '0')}:00`);
      await p.fill('#duracionMinutos', '15');
      await p.fill('#vigenteDesde', `${anio}-01-01`);
      await p.fill('#vigenteHasta', `${anio}-12-31`);
      const respuesta = p.waitForResponse((r) => r.url().includes('/api/agendas') && r.request().method() === 'POST');
      await p.click('#formulario button[type=submit]');
      afirmar((await respuesta).status() === 201, 'el profesional debía poder configurar su agenda');
      await esperarCierre(p);
      const celdas = await p.locator('#filas tr td:first-child').allTextContents();
      afirmar(celdas.length > 0 && celdas.every((t) => t.includes('Prueba')), `profesionales en el listado: ${celdas}`);
      const gestion = await captura(p, 'AC-007-agenda-profesional-desktop.png');
      await p.goto(`${APP}/consultorios.html`);
      await p.waitForURL((url) => new URL(url).pathname === '/profesional.html');
      await c.close();
      return `${panel}, ${gestion}; consultorios.html devuelve al panel`;
    });

    await comprobar('AC-007', 'recepción: sin enlaces de agenda y la API de agendas no le permite escribir', async () => {
      const c = await navegador.newContext({ viewport: ESCRITORIO });
      const p = await c.newPage();
      await ingresar(p, RECEPCION);
      await p.waitForURL((url) => new URL(url).pathname === '/recepcionista.html');
      await p.waitForSelector('#contenido:not(.d-none)');
      const enlaces = await p.locator('#opciones a.btn-outline-primary').allTextContents();
      afirmar(!enlaces.some((t) => t.includes('Agenda') || t.includes('Consultorio')), `enlaces: ${enlaces}`);
      afirmar(await estadoApi(p, '/api/agendas') === 200, 'la recepción debía poder leer agendas');
      // REV-008: escribir sí debe fallar con 403, no sólo leer.
      afirmar((await api(p, 'POST', '/api/agendas', {})).estado === 403, 'la recepción no debía poder crear agendas');
      afirmar((await api(p, 'POST', '/api/consultorios', {})).estado === 403, 'la recepción no debía poder crear consultorios');
      await c.close();
      return 'sin enlaces de gestión; lectura de agendas 200; alta de agendas y consultorios 403';
    });

    await comprobar('AC-008', 'móvil del profesional: Mi agenda sin desborde horizontal', async () => {
      const c = await navegador.newContext({ viewport: MOVIL });
      const p = await c.newPage();
      await ingresar(p, PROFESIONAL);
      await p.waitForSelector('#contenido:not(.d-none)');
      await p.click('#opciones a');
      await p.waitForURL((url) => new URL(url).pathname === '/agendas.html');
      await p.waitForSelector('#contenido:not(.d-none)');
      afirmar(await sinDesborde(p), 'Mi agenda: desborde horizontal en móvil');
      const archivo = await captura(p, 'AC-008-mi-agenda-movil.png');
      await c.close();
      return archivo;
    });
  } finally {
    await navegador.close();
  }

  informe.fin = new Date().toISOString();
  await writeFile(path.join(ARTEFACTOS, 'navegador-resultados-agendas.json'), `${JSON.stringify(informe, null, 2)}\n`);
  const fallos = informe.comprobaciones.filter((c) => c.resultado !== 'cumplido');
  console.log(`\n${informe.comprobaciones.length - fallos.length}/${informe.comprobaciones.length} comprobaciones cumplidas.`);
  process.exitCode = fallos.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
