// Recorridos en un navegador real: pacientes y profesionales.
//
// Requiere la aplicación levantada con la base de db/schema.sql y Chrome instalado.
// Variables opcionales: APP_URL (http://127.0.0.1:8080), CHROME_PATH (/usr/bin/google-chrome),
// ARTEFACTOS_DIR.
//
// Ejecutar desde la raíz del proyecto: npm run test:navegador:personas
// Cada ejecución crea pacientes y profesionales con DNI y matrícula únicos (no hay borrado físico).
// Termina con código 1 si alguna comprobación falla. Guarda capturas y un informe JSON en ARTEFACTOS_DIR.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = (process.env.APP_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const ARTEFACTOS = process.env.ARTEFACTOS_DIR ?? path.join(raiz, 'specs/TUR-003/artifacts');
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

async function captura(page, nombre, fila = null) {
  await fila?.scrollIntoViewIfNeeded();
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

async function abrir(page, pagina) {
  await page.goto(`${APP}/${pagina}`);
  await page.waitForSelector('#contenido:not(.d-none)');
}

const fila = (page, texto) => page.locator('#filas tr', { hasText: texto });
// Estado HTTP que recibe la sesión actual del navegador al pedir el listado.
const estadoApi = (page, recurso) => page.evaluate(async (r) => (await fetch(`/api/${r}`)).status, recurso);
// Todos los botones de acción de la primera fila caben dentro del viewport (no quedan recortados por el scroll de la tabla).
const accionesAlcanzables = (page) => page.evaluate(() => {
  const botones = [...document.querySelectorAll('#filas tr:first-child button')];
  return botones.length > 0 && botones.every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; });
});
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function abrirNuevo(page) {
  await page.click('#nuevo');
  await page.waitForSelector('#modal-formulario.show');
}

async function cancelar(page) {
  await page.click('#modal-formulario .btn-outline-secondary');
  await page.waitForSelector('#modal-formulario', { state: 'hidden' });
}

// Envía el formulario y devuelve el estado HTTP de la llamada que dispara.
async function guardar(page, metodo, ruta) {
  const respuesta = page.waitForResponse((r) => r.url().includes(ruta) && r.request().method() === metodo);
  await page.click('#formulario button[type=submit]');
  return (await respuesta).status();
}

async function llenarPersona(page, { dni, nombre, apellido, fecha, extra = {} }) {
  if (dni !== undefined) await page.fill('#dni', dni);
  await page.fill('#nombre', nombre);
  await page.fill('#apellido', apellido);
  await page.fill('#fechaNacimiento', fecha);
  for (const [campo, valor] of Object.entries(extra)) await page.fill(`#${campo}`, valor);
}

async function main() {
  await mkdir(ARTEFACTOS, { recursive: true });
  const navegador = await chromium.launch({ executablePath: CHROME, headless: true });
  const dniPaciente = dniUnico();
  const apellidoPaciente = `Navegador${sufijo}`;
  const nombreEditado = `Editada${sufijo}`;
  const dniProfesional = dniUnico();
  const apellidoProfesional = `Medica${sufijo}`;
  const matricula = `NAV-${sufijo}`;

  try {
    const contexto = await navegador.newContext({ viewport: ESCRITORIO });
    const pagina = await contexto.newPage();
    await ingresar(pagina, ADMIN);
    await pagina.waitForURL((url) => new URL(url).pathname === '/administrador.html');
    await pagina.waitForSelector('#contenido:not(.d-none)');

    // Accesos del panel.
    await comprobar('AC-008', 'panel del administrador: Profesionales y Pacientes abren su gestión; no queda ninguna opción pendiente (TUR-005)', async () => {
      const enlaces = await pagina.locator('#opciones a.btn-outline-primary').allTextContents();
      afirmar(JSON.stringify(enlaces) === JSON.stringify(['Usuarios', 'Especialidades', 'Profesionales', 'Pacientes', 'Consultorios', 'Agendas', 'Ver turnos', 'Ver reportes']), `enlaces: ${enlaces}`);
      const pendientes = await pagina.locator('#opciones .badge.text-bg-secondary').allTextContents();
      afirmar(pendientes.length === 0, `pendientes: ${pendientes}`);
      const desktop = await captura(pagina, 'AC-008-panel-admin-desktop.png');
      const movil = await navegador.newContext({ viewport: MOVIL });
      const p = await movil.newPage();
      await ingresar(p, ADMIN);
      await p.waitForSelector('#contenido:not(.d-none)');
      afirmar(await sinDesborde(p), 'hay desborde horizontal en móvil');
      const archivoMovil = await captura(p, 'AC-008-panel-admin-movil.png');
      await movil.close();
      await pagina.click('#opciones a:has-text("Pacientes")');
      await pagina.waitForURL((url) => new URL(url).pathname === '/pacientes.html');
      await pagina.goBack();
      await pagina.click('#opciones a:has-text("Profesionales")');
      await pagina.waitForURL((url) => new URL(url).pathname === '/profesionales.html');
      return `${desktop}, ${archivoMovil}; los enlaces abren /pacientes.html y /profesionales.html`;
    });

    // ---- Pacientes ----
    await abrir(pagina, 'pacientes.html');

    await comprobar('AC-001', 'el listado muestra los pacientes semilla activos y oculta al inactivo', async () => {
      const dnis = await pagina.locator('#filas tr td:first-child').allTextContents();
      afirmar(['20000004', '30000001', '30000002'].every((d) => dnis.includes(d)), `DNI: ${dnis}`);
      afirmar(!dnis.includes('30000003'), 'el paciente inactivo no debía figurar entre los activos');
      return `${dnis.length} filas`;
    });

    await comprobar('AC-001', 'alta de paciente desde el formulario: API 201 y aparece en el listado', async () => {
      await abrirNuevo(pagina);
      await llenarPersona(pagina, { dni: dniPaciente, nombre: 'Nuria', apellido: apellidoPaciente, fecha: '1992-04-12', extra: { telefono: '1155551234', obraSocial: 'OSDE 310' } });
      const estado = await guardar(pagina, 'POST', '/api/pacientes');
      await pagina.waitForSelector('#modal-formulario', { state: 'hidden' });
      await fila(pagina, apellidoPaciente).waitFor();
      afirmar(estado === 201, `la API respondió ${estado}`);
      afirmar((await fila(pagina, apellidoPaciente).locator('.badge').textContent()) === 'Activo', 'debía quedar activo');
      return `API 201; ${await captura(pagina, 'AC-001-paciente-alta-desktop.png', fila(pagina, apellidoPaciente))}`;
    });

    await comprobar('AC-001', 'buscar por DNI y por apellido filtra el listado', async () => {
      await pagina.fill('#busqueda', dniPaciente);
      await pagina.waitForFunction(() => document.querySelectorAll('#filas tr').length === 1);
      afirmar((await fila(pagina, apellidoPaciente).count()) === 1, 'la búsqueda por DNI no devolvió al paciente');
      const conResultado = await captura(pagina, 'AC-001-paciente-busqueda-por-dni-desktop.png');
      await pagina.fill('#busqueda', apellidoPaciente);
      await pagina.waitForFunction(() => document.querySelectorAll('#filas tr').length === 1);
      await pagina.fill('#busqueda', 'zzzNoExiste');
      await pagina.waitForSelector('#vacio:not(.d-none)');
      const archivo = await captura(pagina, 'AC-001-paciente-busqueda-sin-resultados-desktop.png');
      await pagina.fill('#busqueda', '');
      await pagina.waitForFunction(() => document.querySelectorAll('#filas tr').length > 1);
      return `${conResultado}, ${archivo}`;
    });

    await comprobar('AC-002', 'paciente con campos inválidos muestra el error junto al campo y no guarda', async () => {
      const casos = [
        { cambios: { dni: '12', nombre: 'A', apellido: 'B', fecha: '1990-01-01' }, campo: 'dni', estado: 400 },
        { cambios: { dni: dniUnico(), nombre: '   ', apellido: 'B', fecha: '1990-01-01' }, campo: 'nombre', estado: 400 },
        { cambios: { dni: dniUnico(), nombre: 'A', apellido: 'B', fecha: '1990-01-01', extra: { email: 'sin-arroba' } }, campo: 'email', estado: 400 },
        { cambios: { dni: dniUnico(), nombre: 'A', apellido: 'B', fecha: '2999-01-01' }, campo: 'fechaNacimiento', estado: 400 },
        { cambios: { dni: dniPaciente, nombre: 'A', apellido: 'B', fecha: '1990-01-01' }, campo: 'dni', estado: 409 },
      ];
      let archivo = '';
      for (const { cambios, campo, estado } of casos) {
        await abrirNuevo(pagina);
        await llenarPersona(pagina, cambios);
        const recibido = await guardar(pagina, 'POST', '/api/pacientes');
        await pagina.waitForSelector(`#${campo}.is-invalid`);
        afirmar(recibido === estado, `${campo}: la API respondió ${recibido}, se esperaba ${estado}`);
        afirmar((await pagina.textContent(`#error-${campo}`)).length > 0, `${campo}: sin mensaje`);
        afirmar(await pagina.isVisible('#modal-formulario'), 'el formulario debía seguir abierto');
        if (estado === 409) archivo = await captura(pagina, 'AC-002-paciente-dni-duplicado-desktop.png');
        if (campo === 'dni' && estado === 400) await captura(pagina, 'AC-002-paciente-dni-invalido-desktop.png');
        await cancelar(pagina);
      }
      return `4 × API 400 y 1 × API 409; ${archivo}`;
    });

    await comprobar('AC-003', 'editar un paciente lo actualiza y el DNI queda de sólo lectura', async () => {
      await fila(pagina, apellidoPaciente).getByRole('button', { name: 'Editar' }).click();
      await pagina.waitForSelector('#modal-formulario.show');
      afirmar((await pagina.inputValue('#dni')) === dniPaciente, 'debía precargar el DNI');
      afirmar(await pagina.locator('#dni').evaluate((el) => el.readOnly), 'el DNI debía ser de sólo lectura');
      await pagina.fill('#nombre', nombreEditado);
      await pagina.fill('#obraSocial', 'PAMI');
      const estado = await guardar(pagina, 'PUT', '/api/pacientes/');
      await pagina.waitForSelector('#modal-formulario', { state: 'hidden' });
      await fila(pagina, nombreEditado).waitFor();
      afirmar(estado === 200, `la API respondió ${estado}`);
      afirmar((await fila(pagina, apellidoPaciente).textContent()).includes('PAMI'), 'debía mostrar la nueva obra social');
      return await captura(pagina, 'AC-003-paciente-edicion-desktop.png', fila(pagina, apellidoPaciente));
    });

    await comprobar('AC-003', 'desactivar y reactivar un paciente (secuencia)', async () => {
      const f = fila(pagina, apellidoPaciente);
      const a1 = await captura(pagina, 'AC-003-paciente-01-activo-desktop.png', f);
      await f.getByRole('button', { name: 'Desactivar' }).click();
      await pagina.waitForFunction((t) => ![...document.querySelectorAll('#filas tr')].some((r) => r.textContent.includes(t)), apellidoPaciente);
      await pagina.selectOption('#filtro-estado', 'todos');
      await f.getByText('Inactivo').waitFor();
      const a2 = await captura(pagina, 'AC-003-paciente-02-inactivo-desktop.png', f);
      await f.getByRole('button', { name: 'Reactivar' }).click();
      await f.getByText('Activo', { exact: true }).waitFor();
      const a3 = await captura(pagina, 'AC-003-paciente-03-reactivado-desktop.png', f);
      await pagina.selectOption('#filtro-estado', 'activos');
      await f.waitFor();
      return `${a1}, ${a2}, ${a3}`;
    });

    await comprobar('AC-008', 'pacientes se usa en móvil sin desborde horizontal de la página', async () => {
      const movil = await navegador.newContext({ viewport: MOVIL });
      const p = await movil.newPage();
      await ingresar(p, ADMIN);
      await p.waitForURL((url) => new URL(url).pathname === '/administrador.html');
      await abrir(p, 'pacientes.html');
      afirmar(await sinDesborde(p), 'hay desborde horizontal en el listado');
      afirmar(await accionesAlcanzables(p), 'las acciones quedan fuera de la vista en móvil');
      const a = await captura(p, 'AC-008-pacientes-listado-movil.png');
      await abrirNuevo(p);
      const b = await captura(p, 'AC-008-pacientes-formulario-movil.png');
      await movil.close();
      return `${a}, ${b}`;
    });

    // ---- Profesionales ----
    await abrir(pagina, 'profesionales.html');

    await comprobar('AC-005', 'alta de profesional con dos especialidades: API 201, aparece y se filtra por especialidad', async () => {
      await abrirNuevo(pagina);
      await llenarPersona(pagina, { dni: dniProfesional, nombre: 'Marta', apellido: apellidoProfesional, fecha: '1979-08-30' });
      await pagina.fill('#matricula', matricula);
      await pagina.check('#lista-especialidades label:text-is("Cardiología") >> xpath=preceding-sibling::input');
      await pagina.check('#lista-especialidades label:text-is("Dermatología") >> xpath=preceding-sibling::input');
      afirmar((await pagina.textContent('#resumen-especialidades')) === 'Seleccionadas: Cardiología, Dermatología', 'el resumen debía listar las dos especialidades');
      const archivoForm = await captura(pagina, 'AC-005-profesional-formulario-desktop.png');
      const estado = await guardar(pagina, 'POST', '/api/profesionales');
      await pagina.waitForSelector('#modal-formulario', { state: 'hidden' });
      await fila(pagina, apellidoProfesional).waitFor();
      afirmar(estado === 201, `la API respondió ${estado}`);
      const texto = await fila(pagina, apellidoProfesional).textContent();
      afirmar(texto.includes('Cardiología') && texto.includes('Dermatología'), `especialidades: ${texto}`);
      await pagina.selectOption('#filtro-especialidad', { label: 'Dermatología' });
      await pagina.waitForFunction((t) => [...document.querySelectorAll('#filas tr')].every((r) => r.textContent.includes('Dermatología')) && [...document.querySelectorAll('#filas tr')].some((r) => r.textContent.includes(t)), apellidoProfesional);
      const archivoFiltro = await captura(pagina, 'AC-005-profesional-listado-filtrado-desktop.png', fila(pagina, apellidoProfesional));
      await pagina.selectOption('#filtro-especialidad', '');
      await fila(pagina, apellidoProfesional).waitFor();
      return `API 201; ${archivoForm}, ${archivoFiltro}`;
    });

    await comprobar('AC-005', 'profesional sin especialidades o con matrícula repetida muestra el error y no guarda', async () => {
      await abrirNuevo(pagina);
      await llenarPersona(pagina, { dni: dniUnico(), nombre: 'A', apellido: 'B', fecha: '1980-01-01' });
      await pagina.fill('#matricula', `SIN-${sufijo}`);
      const sinEsp = await guardar(pagina, 'POST', '/api/profesionales');
      await pagina.waitForSelector('#error-especialidades:not(.d-none)');
      afirmar(sinEsp === 400, `sin especialidades: la API respondió ${sinEsp}`);
      const a = await captura(pagina, 'AC-005-profesional-sin-especialidades-desktop.png');
      await pagina.fill('#matricula', matricula);
      await pagina.check('#lista-especialidades label:text-is("Cardiología") >> xpath=preceding-sibling::input');
      const repetida = await guardar(pagina, 'POST', '/api/profesionales');
      await pagina.waitForSelector('#matricula.is-invalid');
      afirmar(repetida === 409, `matrícula repetida: la API respondió ${repetida}`);
      const b = await captura(pagina, 'AC-005-profesional-matricula-repetida-desktop.png');
      await cancelar(pagina);
      return `API 400 y 409; ${a}, ${b}`;
    });

    await comprobar('AC-006', 'editar un profesional reemplaza sus especialidades', async () => {
      await fila(pagina, apellidoProfesional).getByRole('button', { name: 'Editar' }).click();
      await pagina.waitForSelector('#modal-formulario.show');
      afirmar(await pagina.isChecked('#lista-especialidades label:text-is("Cardiología") >> xpath=preceding-sibling::input'), 'debía precargar Cardiología');
      await pagina.uncheck('#lista-especialidades label:text-is("Dermatología") >> xpath=preceding-sibling::input');
      await pagina.check('#lista-especialidades label:text-is("Neurología") >> xpath=preceding-sibling::input');
      const estado = await guardar(pagina, 'PUT', '/api/profesionales/');
      await pagina.waitForSelector('#modal-formulario', { state: 'hidden' });
      afirmar(estado === 200, `la API respondió ${estado}`);
      await pagina.waitForFunction((t) => [...document.querySelectorAll('#filas tr')].some((r) => r.textContent.includes(t) && r.textContent.includes('Neurología') && !r.textContent.includes('Dermatología')), apellidoProfesional);
      return await captura(pagina, 'AC-006-profesional-edicion-desktop.png', fila(pagina, apellidoProfesional));
    });

    await comprobar('AC-006', 'desactivar y reactivar un profesional (secuencia)', async () => {
      const f = fila(pagina, apellidoProfesional);
      const a1 = await captura(pagina, 'AC-006-profesional-01-activo-desktop.png', f);
      await f.getByRole('button', { name: 'Desactivar' }).click();
      await pagina.waitForFunction((t) => ![...document.querySelectorAll('#filas tr')].some((r) => r.textContent.includes(t)), apellidoProfesional);
      await pagina.selectOption('#filtro-estado', 'todos');
      await f.getByText('Inactivo').waitFor();
      afirmar((await f.textContent()).includes('Neurología'), 'debía conservar sus especialidades');
      const a2 = await captura(pagina, 'AC-006-profesional-02-inactivo-desktop.png', f);
      await f.getByRole('button', { name: 'Reactivar' }).click();
      await f.getByText('Activo', { exact: true }).waitFor();
      const a3 = await captura(pagina, 'AC-006-profesional-03-reactivado-desktop.png', f);
      await pagina.selectOption('#filtro-estado', 'activos');
      return `${a1}, ${a2}, ${a3}`;
    });

    await comprobar('AC-008', 'profesionales se usa en móvil sin desborde horizontal de la página', async () => {
      const movil = await navegador.newContext({ viewport: MOVIL });
      const p = await movil.newPage();
      await ingresar(p, ADMIN);
      await p.waitForURL((url) => new URL(url).pathname === '/administrador.html');
      await abrir(p, 'profesionales.html');
      afirmar(await sinDesborde(p), 'hay desborde horizontal en el listado');
      afirmar(await accionesAlcanzables(p), 'las acciones quedan fuera de la vista en móvil');
      const a = await captura(p, 'AC-008-profesionales-listado-movil.png');
      await abrirNuevo(p);
      afirmar(await sinDesborde(p), 'hay desborde horizontal con el formulario abierto');
      const b = await captura(p, 'AC-008-profesionales-formulario-movil.png');
      await movil.close();
      return `${a}, ${b}`;
    });

    await contexto.close();

    // ---- Recepción y control de acceso ----
    await comprobar('AC-007', 'recepcionista: ve Pacientes y Turnos, gestiona pacientes y la pantalla de Profesionales la devuelve a su panel', async () => {
      const c = await navegador.newContext({ viewport: ESCRITORIO });
      const p = await c.newPage();
      await ingresar(p, RECEPCION);
      await p.waitForURL((url) => new URL(url).pathname === '/recepcionista.html');
      await p.waitForSelector('#contenido:not(.d-none)');
      const enlaces = await p.locator('#opciones a.btn-outline-primary').allTextContents();
      afirmar(JSON.stringify(enlaces) === JSON.stringify(['Pacientes', 'Ver turnos']), `enlaces: ${enlaces}`);
      const panel = await captura(p, 'AC-007-panel-recepcion-desktop.png');
      await p.click('#opciones a');
      await p.waitForURL((url) => new URL(url).pathname === '/pacientes.html');
      await p.waitForSelector('#contenido:not(.d-none)');
      const gestion = await captura(p, 'AC-007-pacientes-recepcion-desktop.png');
      afirmar((await p.getAttribute('#volver', 'href')) === '/recepcionista.html', 'Volver debía llevar al panel de recepción');
      // La API deja leer los activos a la recepción (insumo de turnos), pero la pantalla de gestión es del administrador.
      await p.goto(`${APP}/profesionales.html`);
      await p.waitForURL((url) => new URL(url).pathname === '/recepcionista.html');
      afirmar(!(await p.isVisible('#nuevo')), 'la recepción no debía ver la gestión de profesionales');
      await c.close();
      return `${panel}, ${gestion}; la pantalla de profesionales la devuelve al panel`;
    });

    for (const [rol, cuenta, panel] of [['profesional', PROFESIONAL, '/profesional.html'], ['paciente', PACIENTE, '/paciente.html']]) {
      await comprobar('AC-007', `${rol}: sin enlaces de gestión ajena (profesional: Mi agenda y Mis turnos; paciente: Mis datos personales y Mis turnos); abrir pacientes o profesionales recibe 403 y vuelve a su panel`, async () => {
        const c = await navegador.newContext({ viewport: MOVIL });
        const p = await c.newPage();
        await ingresar(p, cuenta);
        await p.waitForURL((url) => new URL(url).pathname === panel);
        await p.waitForSelector('#contenido:not(.d-none)');
        const enlaces = await p.locator('#opciones a.btn-outline-primary').allTextContents();
        // El panel del paciente suma «Mis datos personales» (enlace).
        const esperados = { profesional: ['Mi agenda', 'Mis turnos'], paciente: ['Mis datos personales', 'Mis turnos'] };
        afirmar(JSON.stringify(enlaces) === JSON.stringify(esperados[rol]), `enlaces: ${enlaces}`);
        const archivo = await captura(p, `AC-007-panel-${rol}-movil.png`);
        for (const destino of ['pacientes', 'profesionales']) {
          await p.goto(`${APP}/${destino}.html`);
          await p.waitForURL((url) => new URL(url).pathname === panel);
          afirmar((await estadoApi(p, destino)) === 403, `${destino}: la API debía responder 403`);
        }
        await c.close();
        return `API 403 en ambas; ${archivo}`;
      });
    }

    await comprobar('AC-007', 'sin sesión, abrir pacientes o profesionales redirige al login', async () => {
      const c = await navegador.newContext({ viewport: ESCRITORIO });
      const p = await c.newPage();
      for (const destino of ['pacientes', 'profesionales']) {
        await p.goto(`${APP}/${destino}.html`);
        await p.waitForURL((url) => new URL(url).pathname === '/');
        afirmar((await estadoApi(p, destino)) === 401, `${destino}: la API debía responder 401`);
        afirmar(!(await p.isVisible('#contenido')), 'no debía mostrarse la gestión');
      }
      const archivo = await captura(p, 'AC-007-sin-sesion-desktop.png');
      await c.close();
      return `API 401; ${archivo}`;
    });
  } finally {
    await navegador.close();
  }

  informe.fin = new Date().toISOString();
  await writeFile(path.join(ARTEFACTOS, 'navegador-resultados.json'), `${JSON.stringify(informe, null, 2)}\n`);
  const fallos = informe.comprobaciones.filter((c) => c.resultado !== 'cumplido');
  console.log(`\n${informe.comprobaciones.length - fallos.length}/${informe.comprobaciones.length} comprobaciones cumplidas.`);
  process.exitCode = fallos.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
