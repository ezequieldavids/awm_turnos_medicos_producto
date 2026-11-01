// Recorridos en un navegador real.
//
// Requiere la aplicación levantada con la base de db/schema.sql y Chrome instalado.
// Variables opcionales: APP_URL (http://127.0.0.1:8080), CHROME_PATH (/usr/bin/google-chrome),
// ARTEFACTOS_DIR.
//
// Ejecutar desde la raíz del proyecto: npm run test:navegador:especialidades
// Cada ejecución crea especialidades con nombre único y las deja inactivas (no hay borrado físico).
// Termina con código 1 si alguna comprobación falla. Guarda capturas y un informe JSON en ARTEFACTOS_DIR.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = (process.env.APP_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const ARTEFACTOS = process.env.ARTEFACTOS_DIR ?? path.join(raiz, 'specs/TUR-002/artifacts');
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const ESCRITORIO = { width: 1280, height: 800 };
const MOVIL = { width: 390, height: 844 };

// Usuarios semilla de db/schema.sql (sólo entorno local de prueba).
const ADMIN = { dni: '20000001', password: 'Password123!' };
const RECEPCION = { dni: '20000002', password: 'Password123!' };
const PACIENTE = { dni: '20000004', password: 'Password123!' };

const informe = { inicio: new Date().toISOString(), app: APP, comprobaciones: [] };
const sufijo = randomUUID().slice(0, 8);

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

// Captura del viewport (el listado tiene decenas de filas); `fila` se trae a la vista antes de capturar.
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

async function abrirGestion(page) {
  await page.goto(`${APP}/especialidades.html`);
  await page.waitForSelector('#contenido:not(.d-none)');
}

const fila = (page, nombre) => page.locator('#filas tr', { has: page.locator('td', { hasText: nombre }) });

async function abrirNueva(page) {
  await page.click('#nueva');
  await page.waitForSelector('#modal-formulario.show');
}

async function guardar(page) {
  await page.click('#formulario button[type=submit]');
}

async function main() {
  await mkdir(ARTEFACTOS, { recursive: true });
  const navegador = await chromium.launch({ executablePath: CHROME, headless: true });
  const nombre = `Prueba Navegador ${sufijo}`;
  const nombreEditado = `${nombre} editada`;

  try {
    const contexto = await navegador.newContext({ viewport: ESCRITORIO });
    const pagina = await contexto.newPage();
    await ingresar(pagina, ADMIN);
    await pagina.waitForURL((url) => new URL(url).pathname === '/administrador.html');
    await pagina.waitForSelector('#contenido:not(.d-none)');

    // La opción Especialidades es un enlace; se completó Usuarios, así que no queda ninguna pendiente.
    await comprobar('AC-006', 'panel del administrador: Especialidades abre la gestión y no queda ninguna opción pendiente', async () => {
      const enlaces = await pagina.locator('#opciones a.btn-outline-primary').allTextContents();
      // Se convirtieron en enlaces: Profesionales y Pacientes; Consultorios y Agendas; Turnos; Usuarios.
      afirmar(JSON.stringify(enlaces) === JSON.stringify(['Usuarios', 'Especialidades', 'Profesionales', 'Pacientes', 'Consultorios', 'Agendas', 'Ver turnos', 'Ver reportes']), `enlaces: ${enlaces}`);
      const pendientes = await pagina.locator('#opciones .badge.text-bg-secondary').allTextContents();
      afirmar(pendientes.length === 0, `pendientes: ${pendientes}`);
      const archivoDesktop = await captura(pagina, 'AC-006-panel-admin-desktop.png');

      const movil = await navegador.newContext({ viewport: MOVIL });
      const paginaMovil = await movil.newPage();
      await ingresar(paginaMovil, ADMIN);
      await paginaMovil.waitForSelector('#contenido:not(.d-none)');
      const desborde = await paginaMovil.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      afirmar(!desborde, 'hay desborde horizontal en móvil');
      const archivoMovil = await captura(paginaMovil, 'AC-006-panel-admin-movil.png');
      await movil.close();

      await pagina.click('#opciones a:has-text("Especialidades")');
      await pagina.waitForURL((url) => new URL(url).pathname === '/especialidades.html');
      await pagina.waitForSelector('#contenido:not(.d-none)');
      return `${archivoDesktop}, ${archivoMovil}; el enlace abre /especialidades.html`;
    });

    await comprobar('AC-001', 'el listado muestra el catálogo semilla', async () => {
      const cantidad = await pagina.locator('#filas tr').count();
      afirmar(cantidad >= 41, `filas: ${cantidad}`);
      const nombres = await pagina.locator('#filas tr td:first-child').allTextContents();
      for (const esperado of ['Alergología', 'Cardiología', 'Ginecología y Obstetricia', 'Neurología', 'Urología']) {
        afirmar(nombres.includes(esperado), `falta ${esperado}`);
      }
      return `${cantidad} filas`;
    });

    // Alta desde el formulario.
    await comprobar('AC-001', 'alta desde el formulario: respuesta 201 y aparece en el listado', async () => {
      await abrirNueva(pagina);
      await pagina.fill('#nombre', nombre);
      await pagina.fill('#descripcion', 'Creada por el recorrido automatizado');
      const respuesta = pagina.waitForResponse((r) => r.url().endsWith('/api/especialidades') && r.request().method() === 'POST');
      await guardar(pagina);
      const estado = (await respuesta).status();
      await pagina.waitForSelector('#modal-formulario', { state: 'hidden' });
      await fila(pagina, nombre).waitFor();
      afirmar(estado === 201, `la API respondió ${estado}`);
      afirmar((await fila(pagina, nombre).locator('.badge').textContent()) === 'Activa', 'debía quedar activa');
      return `API 201; ${await captura(pagina, 'AC-001-alta-desktop.png', fila(pagina, nombre))}`;
    });

    // Validaciones visibles en el formulario.
    await comprobar('AC-002', 'nombre duplicado (otra grafía) muestra el error en el campo y no guarda', async () => {
      await abrirNueva(pagina);
      await pagina.fill('#nombre', `  ${nombre.toUpperCase()}  `);
      const respuesta = pagina.waitForResponse((r) => r.url().endsWith('/api/especialidades') && r.request().method() === 'POST');
      await guardar(pagina);
      afirmar((await respuesta).status() === 409, 'la API debía responder 409');
      await pagina.waitForSelector('#nombre.is-invalid');
      afirmar((await pagina.textContent('#error-nombre')) === 'Ya existe una especialidad con ese nombre.', 'mensaje distinto');
      afirmar(await pagina.isVisible('#modal-formulario'), 'el formulario debía seguir abierto');
      const archivo = await captura(pagina, 'AC-002-duplicado-desktop.png');
      await pagina.click('#modal-formulario [data-bs-dismiss=modal].btn-outline-secondary');
      await pagina.waitForSelector('#modal-formulario', { state: 'hidden' });
      return `API 409; ${archivo}`;
    });

    await comprobar('AC-002', 'nombre vacío muestra el error en el campo y no guarda', async () => {
      await abrirNueva(pagina);
      await pagina.fill('#nombre', '   ');
      const respuesta = pagina.waitForResponse((r) => r.url().endsWith('/api/especialidades') && r.request().method() === 'POST');
      await guardar(pagina);
      afirmar((await respuesta).status() === 400, 'la API debía responder 400');
      await pagina.waitForSelector('#nombre.is-invalid');
      afirmar((await pagina.textContent('#error-nombre')) === 'El nombre es obligatorio.', 'mensaje distinto');
      const archivo = await captura(pagina, 'AC-002-vacio-desktop.png');
      await pagina.click('#modal-formulario [data-bs-dismiss=modal].btn-outline-secondary');
      await pagina.waitForSelector('#modal-formulario', { state: 'hidden' });
      return `API 400; ${archivo}`;
    });

    // Edición.
    await comprobar('AC-003', 'editar el nombre lo actualiza en el listado', async () => {
      await fila(pagina, nombre).getByRole('button', { name: 'Editar' }).click();
      await pagina.waitForSelector('#modal-formulario.show');
      afirmar((await pagina.inputValue('#nombre')) === nombre, 'el formulario debía precargar el nombre');
      await pagina.fill('#nombre', nombreEditado);
      const respuesta = pagina.waitForResponse((r) => r.request().method() === 'PUT');
      await guardar(pagina);
      afirmar((await respuesta).status() === 200, 'la API debía responder 200');
      await pagina.waitForSelector('#modal-formulario', { state: 'hidden' });
      await fila(pagina, nombreEditado).waitFor();
      const nombres = await pagina.locator('#filas tr td:first-child').allTextContents();
      afirmar(nombres.filter((n) => n === nombreEditado).length === 1, 'debía quedar una fila con el nombre editado');
      afirmar(!nombres.includes(nombre), 'no debía quedar una fila con el nombre anterior');
      return await captura(pagina, 'AC-003-edicion-desktop.png', fila(pagina, nombreEditado));
    });

    // Baja lógica y reactivación (secuencia).
    await comprobar('AC-004', 'desactivar y reactivar desde el listado', async () => {
      const f = fila(pagina, nombreEditado);
      const a1 = await captura(pagina, 'AC-004-01-activa-desktop.png', f);
      await f.getByRole('button', { name: 'Desactivar' }).click();
      await f.getByText('Inactiva').waitFor();
      afirmar((await f.getByRole('button', { name: 'Reactivar' }).count()) === 1, 'debía ofrecer Reactivar');
      const a2 = await captura(pagina, 'AC-004-02-inactiva-desktop.png', f);
      const activas = await pagina.evaluate(async () => (await (await fetch('/api/especialidades')).json()).especialidades.map((e) => e.nombre));
      afirmar(!activas.includes(nombre + ' editada'), 'la inactiva no debía figurar en las activas');
      await f.getByRole('button', { name: 'Reactivar' }).click();
      await f.getByText('Activa', { exact: true }).waitFor();
      const a3 = await captura(pagina, 'AC-004-03-reactivada-desktop.png', f);
      const activas2 = await pagina.evaluate(async () => (await (await fetch('/api/especialidades')).json()).especialidades.map((e) => e.nombre));
      afirmar(activas2.includes(nombre + ' editada'), 'reactivada debía figurar en las activas');
      await f.getByRole('button', { name: 'Desactivar' }).click(); // se deja inactiva: no hay borrado físico
      await f.getByText('Inactiva').waitFor();
      return `${a1}, ${a2}, ${a3}`;
    });

    await comprobar('AC-001', 'la gestión se usa en móvil sin desborde horizontal de la página', async () => {
      const movil = await navegador.newContext({ viewport: MOVIL });
      const p = await movil.newPage();
      await ingresar(p, ADMIN);
      await p.waitForURL((url) => new URL(url).pathname === '/administrador.html');
      await abrirGestion(p);
      const desborde = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      afirmar(!desborde, 'hay desborde horizontal en la página');
      const archivoListado = await captura(p, 'AC-001-listado-movil.png');
      await abrirNueva(p);
      const archivo = `${archivoListado}, ${await captura(p, 'AC-001-formulario-movil.png')}`;
      await movil.close();
      return archivo;
    });

    await contexto.close();

    // Sin sesión y roles sin permiso.
    await comprobar('AC-005', 'sin sesión, abrir la gestión redirige al login', async () => {
      const c = await navegador.newContext({ viewport: ESCRITORIO });
      const p = await c.newPage();
      const r = p.waitForResponse((resp) => resp.url().includes('/api/especialidades'));
      await p.goto(`${APP}/especialidades.html`);
      const estado = (await r).status();
      await p.waitForURL((url) => new URL(url).pathname === '/');
      afirmar(estado === 401, `la API respondió ${estado}`);
      afirmar(!(await p.isVisible('#contenido')), 'no debía mostrarse la gestión');
      const archivo = await captura(p, 'AC-005-sin-sesion-desktop.png');
      await c.close();
      return `API 401; ${archivo}`;
    });

    for (const [rol, cuenta, panel] of [['recepcionista', RECEPCION, '/recepcionista.html'], ['paciente', PACIENTE, '/paciente.html']]) {
      await comprobar('AC-005', `${rol}: no ve la opción y, si abre la gestión, recibe 403 y vuelve a su panel`, async () => {
        const c = await navegador.newContext({ viewport: MOVIL });
        const p = await c.newPage();
        await ingresar(p, cuenta);
        await p.waitForURL((url) => new URL(url).pathname === panel);
        await p.waitForSelector('#contenido:not(.d-none)');
        const enlaces = await p.locator('#opciones a.btn-outline-primary').allTextContents(); // La recepción gestiona pacientes; turnos
        // «Mis datos personales» pasa a ser un enlace del panel del paciente.
        const esperados = { recepcionista: ['Pacientes', 'Ver turnos'], paciente: ['Mis datos personales', 'Mis turnos'] };
        afirmar(JSON.stringify(enlaces) === JSON.stringify(esperados[rol] ?? ['Mis turnos']), `enlaces: ${enlaces}`);
        afirmar(!(await p.textContent('#opciones')).includes('Especialidades'), 'no debía ofrecer Especialidades');
        const archivoPanel = await captura(p, `AC-005-panel-${rol}-movil.png`);
        const r = p.waitForResponse((resp) => resp.url().includes('/api/especialidades'));
        await p.goto(`${APP}/especialidades.html`);
        const estado = (await r).status();
        await p.waitForURL((url) => new URL(url).pathname === panel);
        afirmar(estado === 403, `la API respondió ${estado}`);
        await c.close();
        return `API 403; ${archivoPanel}`;
      });
    }
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
