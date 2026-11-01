// Recorridos en un navegador real: administración de usuarios y roles.
//
// Requiere la aplicación levantada con la base de db/schema.sql y Chrome instalado.
// Variables opcionales: APP_URL (http://127.0.0.1:8080), CHROME_PATH (/usr/bin/google-chrome),
// ARTEFACTOS_DIR.
//
// Ejecutar desde la raíz del proyecto: npm run test:navegador:usuarios
// Cada ejecución crea personas, pacientes y cuentas con DNI únicos (la API no borra: sólo desactiva).
// Termina con código 1 si alguna comprobación falla. Guarda capturas y un informe JSON en ARTEFACTOS_DIR.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = (process.env.APP_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const ARTEFACTOS = process.env.ARTEFACTOS_DIR ?? path.join(raiz, 'specs/TUR-005/artifacts');
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const ESCRITORIO = { width: 1280, height: 800 };
const MOVIL = { width: 390, height: 844 };

// Usuarios semilla de db/schema.sql (sólo entorno local de prueba).
const ADMIN = { dni: '20000001', password: 'Password123!' };
const RECEPCION = { dni: '20000002', password: 'Password123!' };

const CONTRASENA = 'clave-nav-2026';
const informe = { inicio: new Date().toISOString(), app: APP, comprobaciones: [] };
const sufijo = randomUUID().slice(0, 8);
const dniUnico = () => String(randomInt(60000000, 69999999));

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

async function captura(page, nombre) {
  await page.waitForTimeout(400); // deja terminar la animación del modal y el pintado de la tabla
  await page.screenshot({ path: path.join(ARTEFACTOS, nombre) });
  return nombre;
}

async function ingresar(page, cuenta) {
  await page.goto(`${APP}/`);
  await page.fill('#dni', cuenta.dni);
  await page.fill('#password', cuenta.password);
  await page.click('button[type=submit]');
}

// Intenta entrar y devuelve el estado HTTP de /api/login.
async function intentarIngreso(page, cuenta) {
  await page.goto(`${APP}/`);
  await page.fill('#dni', cuenta.dni);
  await page.fill('#password', cuenta.password);
  const respuesta = page.waitForResponse((r) => r.url().endsWith('/api/login') && r.request().method() === 'POST');
  await page.click('button[type=submit]');
  return (await respuesta).status();
}

async function abrirUsuarios(page) {
  await page.goto(`${APP}/usuarios.html`);
  await page.waitForSelector('#contenido:not(.d-none)');
}

// Busca por texto y estado y espera la respuesta del listado.
async function buscar(page, texto, estado = 'todos') {
  const respuesta = page.waitForResponse((r) => r.url().includes('/api/usuarios') && r.url().includes(`estado=${estado}`)
    && r.url().includes(`q=${texto}`));
  await page.fill('#busqueda', texto);
  await page.selectOption('#estado', estado);
  await respuesta;
  await page.waitForTimeout(300);
}

const fila = (page, texto) => page.locator('#filas tr', { hasText: texto });
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const estadoApi = (page, recurso) => page.evaluate(async (r) => (await fetch(`/api/${r}`)).status, recurso);

async function abrirNuevo(page) {
  await page.click('#nuevo');
  await page.waitForSelector('#modal-formulario.show');
}

async function cancelar(page) {
  await page.click('#modal-formulario .btn-outline-secondary');
  await page.waitForSelector('#modal-formulario', { state: 'hidden' });
}

// Llena el alta y la envía; devuelve el estado HTTP de POST /api/usuarios.
async function crearCuenta(page, { dni, nombre, apellido, rol, contrasena }) {
  await abrirNuevo(page);
  await page.fill('#dni', dni);
  if (nombre !== undefined) {
    await page.fill('#nombre', nombre);
  }
  if (apellido !== undefined) {
    await page.fill('#apellido', apellido);
  }
  await page.selectOption('#rol', rol);
  await page.fill('#contrasena', contrasena);
  const respuesta = page.waitForResponse((r) => r.url().endsWith('/api/usuarios') && r.request().method() === 'POST');
  await page.click('#formulario button[type=submit]');
  const estado = (await respuesta).status();
  if (estado === 201) {
    await page.waitForSelector('#modal-formulario', { state: 'hidden' });
  }
  return estado;
}

// Da de alta un paciente sin cuenta (persona existente) usando la sesión del administrador.
async function crearPacienteSinCuenta(page, dni) {
  const estado = await page.evaluate(async (datos) => (await fetch('/api/pacientes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  })).status, { dni, nombre: 'Paciente', apellido: `Nav${sufijo}`, fechaNacimiento: '1990-01-01' });
  afirmar(estado === 201, `alta de paciente de prueba: HTTP ${estado}`);
}

async function main() {
  await mkdir(ARTEFACTOS, { recursive: true });
  const navegador = await chromium.launch({ executablePath: CHROME, headless: true });
  const dniPaciente = dniUnico();
  const dniSesion = dniUnico();
  const dniNuevo = dniUnico();
  const contrasenaNueva = `nueva-${sufijo}`;

  try {
    const contexto = await navegador.newContext({ viewport: ESCRITORIO });
    const admin = await contexto.newPage();
    await ingresar(admin, ADMIN);
    await admin.waitForURL((url) => new URL(url).pathname === '/administrador.html');
    await admin.waitForSelector('#contenido:not(.d-none)');

    // El panel del administrador ofrece Usuarios como enlace; se captura el panel antes de navegar, en ambos viewports.
    await comprobar('AC-007', 'panel del administrador (1280×800 y 390×844): Usuarios es un enlace y abre la gestión', async () => {
      const enlaces = await admin.locator('#opciones a.btn-outline-primary').allTextContents();
      afirmar(enlaces.includes('Usuarios'), `enlaces: ${enlaces}`);
      const desktop = await captura(admin, 'AC-007-panel-admin-desktop.png');
      const movil = await navegador.newContext({ viewport: MOVIL });
      const m = await movil.newPage();
      await ingresar(m, ADMIN);
      await m.waitForURL((url) => new URL(url).pathname === '/administrador.html');
      await m.waitForSelector('#contenido:not(.d-none)');
      afirmar(await m.locator('#opciones a', { hasText: 'Usuarios' }).isVisible(), 'Usuarios no visible en móvil');
      afirmar(await sinDesborde(m), 'hay desborde horizontal en el panel móvil');
      const archivoMovil = await captura(m, 'AC-007-panel-admin-movil.png');
      await movil.close();
      await admin.click('#opciones a:has-text("Usuarios")');
      await admin.waitForURL((url) => new URL(url).pathname === '/usuarios.html');
      await admin.waitForSelector('#contenido:not(.d-none)');
      return `${desktop}; ${archivoMovil}; abre /usuarios.html`;
    });

    // Alta para una persona existente sin cuenta; la cuenta aparece y entra con su rol.
    await comprobar('AC-001', 'alta de cuenta para una persona existente: aparece en el listado y entra con su rol', async () => {
      await crearPacienteSinCuenta(admin, dniPaciente);
      await abrirUsuarios(admin);
      const estado = await crearCuenta(admin, { dni: dniPaciente, rol: 'paciente', contrasena: CONTRASENA });
      afirmar(estado === 201, `alta: HTTP ${estado}`);
      await buscar(admin, dniPaciente);
      await fila(admin, dniPaciente).waitFor();
      afirmar((await fila(admin, dniPaciente).textContent()).includes('Paciente'), 'el rol no aparece en la fila');
      const archivo = await captura(admin, 'AC-001-listado-desktop.png');
      const c = await navegador.newContext({ viewport: ESCRITORIO });
      const p = await c.newPage();
      await ingresar(p, { dni: dniPaciente, password: CONTRASENA });
      await p.waitForURL((url) => new URL(url).pathname === '/paciente.html');
      await c.close();
      return `HTTP 201; login → /paciente.html; ${archivo}`;
    });

    // Persona nueva con nombre y apellido; sin nombre se marca el campo y no se guarda.
    await comprobar('AC-002', 'persona nueva: 201 con nombre y apellido; sin nombre el campo se marca y no se crea la cuenta', async () => {
      const estado = await crearCuenta(admin, {
        dni: dniNuevo, nombre: 'Recepción', apellido: `Nueva${sufijo}`, rol: 'recepcionista', contrasena: CONTRASENA,
      });
      afirmar(estado === 201, `alta con persona nueva: HTTP ${estado}`);
      await buscar(admin, dniNuevo);
      await fila(admin, dniNuevo).waitFor();

      const dniSinNombre = dniUnico();
      await abrirNuevo(admin);
      await admin.fill('#dni', dniSinNombre);
      await admin.fill('#apellido', 'Sin nombre');
      await admin.selectOption('#rol', 'recepcionista');
      await admin.fill('#contrasena', CONTRASENA);
      const respuesta = admin.waitForResponse((r) => r.url().endsWith('/api/usuarios') && r.request().method() === 'POST');
      await admin.click('#formulario button[type=submit]');
      afirmar((await respuesta).status() === 400, 'sin nombre debía responder 400');
      afirmar((await admin.textContent('#error-nombre')).length > 0, 'el mensaje del nombre no se muestra');
      afirmar(await admin.locator('#nombre.is-invalid').count() === 1, 'el campo nombre no queda marcado');
      await cancelar(admin);
      await buscar(admin, dniSinNombre);
      afirmar(await fila(admin, dniSinNombre).count() === 0, 'la cuenta sin nombre quedó guardada');
      return `201 con persona nueva; 400 sin nombre, campo marcado, nada guardado`;
    });

    // Validaciones visibles en el formulario; ninguna guarda.
    await comprobar('AC-003', 'validaciones: DNI mal formado, rol sin registro y contraseña corta se muestran y no guardan', async () => {
      const intentos = [
        { datos: { dni: 'ABC1234', nombre: 'X', apellido: 'Y', rol: 'recepcionista', contrasena: CONTRASENA }, campo: 'dni' },
        { datos: { dni: dniUnico(), nombre: 'X', apellido: 'Y', rol: 'paciente', contrasena: CONTRASENA }, campo: 'rol' },
        { datos: { dni: dniUnico(), nombre: 'X', apellido: 'Y', rol: 'recepcionista', contrasena: 'corta' }, campo: 'contrasena' },
      ];
      for (const { datos, campo } of intentos) {
        const estado = await crearCuenta(admin, datos);
        afirmar(estado === 400 || estado === 409, `${campo}: HTTP ${estado}`);
        afirmar((await admin.textContent(`#error-${campo}`)).length > 0, `sin mensaje en #error-${campo}`);
        afirmar(await admin.isVisible('#modal-formulario.show'), 'el formulario debía quedar abierto');
        await cancelar(admin);
      }
      return 'DNI, rol (409) y contraseña (400) marcan su campo; el formulario queda abierto';
    });

    // Desactivar cierra la sesión abierta de la cuenta; reactivar la restaura.
    await comprobar('AC-004', 'desactivar: la sesión abierta responde 401 y el login falla; reactivar restaura el acceso', async () => {
      const estado = await crearCuenta(admin, {
        dni: dniSesion, nombre: 'Sesión', apellido: `Abierta${sufijo}`, rol: 'recepcionista', contrasena: CONTRASENA,
      });
      afirmar(estado === 201, `alta: HTTP ${estado}`);
      const c = await navegador.newContext({ viewport: ESCRITORIO });
      const p = await c.newPage();
      await ingresar(p, { dni: dniSesion, password: CONTRASENA });
      await p.waitForURL((url) => new URL(url).pathname === '/recepcionista.html');
      await p.waitForSelector('#contenido:not(.d-none)');

      // Búsqueda por apellido y cambio de rol con éxito, en ida y vuelta, con el listado mostrando el rol nuevo.
      await buscar(admin, `Abierta${sufijo}`);
      afirmar(await fila(admin, dniSesion).count() === 1, 'la búsqueda por apellido no encuentra la cuenta');
      await buscar(admin, dniSesion);
      await captura(admin, 'AC-004-secuencia-1-activa.png');
      for (const [rolNuevo, etiqueta] of [['administrador', 'Administrador'], ['recepcionista', 'Recepcionista']]) {
        await fila(admin, dniSesion).getByRole('button', { name: 'Cambiar rol' }).click();
        await admin.waitForSelector('#modal-formulario.show');
        await admin.selectOption('#rol', rolNuevo);
        const rol = admin.waitForResponse((r) => r.url().includes('/rol') && r.request().method() === 'PUT');
        await admin.click('#formulario button[type=submit]');
        afirmar((await rol).status() === 200, `cambiar rol a ${rolNuevo} no respondió 200`);
        await admin.waitForSelector('#modal-formulario', { state: 'hidden' });
        await buscar(admin, dniSesion);
        afirmar((await fila(admin, dniSesion).textContent()).includes(etiqueta), `el listado no muestra ${etiqueta}`);
      }

      const cambio = admin.waitForResponse((r) => r.url().endsWith('/estado') && r.request().method() === 'PUT');
      await fila(admin, dniSesion).getByRole('button', { name: 'Desactivar' }).click();
      afirmar((await cambio).status() === 200, 'desactivar no respondió 200');
      await fila(admin, dniSesion).filter({ hasText: 'Inactiva' }).waitFor();
      await buscar(admin, dniSesion, 'activos');
      afirmar(await fila(admin, dniSesion).count() === 0, 'el filtro de activas muestra una cuenta inactiva');

      await p.reload();
      await p.waitForURL((url) => new URL(url).pathname === '/');
      afirmar(await estadoApi(p, 'sesion') === 401, 'la sesión abierta sigue válida tras desactivar');
      const login = await intentarIngreso(await c.newPage(), { dni: dniSesion, password: CONTRASENA });
      afirmar(login === 401, `login de cuenta inactiva: HTTP ${login}`);

      await buscar(admin, dniSesion, 'inactivos');
      await captura(admin, 'AC-004-secuencia-2-inactiva.png');
      const reactivo = admin.waitForResponse((r) => r.url().endsWith('/estado') && r.request().method() === 'PUT');
      await fila(admin, dniSesion).getByRole('button', { name: 'Reactivar' }).click();
      afirmar((await reactivo).status() === 200, 'reactivar no respondió 200');
      await buscar(admin, dniSesion);
      await captura(admin, 'AC-004-secuencia-3-reactivada.png');
      afirmar(await intentarIngreso(await c.newPage(), { dni: dniSesion, password: CONTRASENA }) === 200, 'la cuenta reactivada no entra');
      await c.close();
      return 'sesión abierta → 401 tras desactivar; login 401; reactivada entra';
    });

    // Restablecer contraseña; la anterior deja de valer.
    await comprobar('AC-005', 'restablecer contraseña: la nueva entra y la anterior no', async () => {
      await buscar(admin, dniSesion);
      await fila(admin, dniSesion).getByRole('button', { name: 'Contraseña' }).click();
      await admin.waitForSelector('#modal-formulario.show');
      afirmar(!(await admin.isVisible('#rol')), 'en restablecer no debe mostrarse el rol');
      afirmar(await admin.inputValue('#dni') === dniSesion, 'el DNI debe mostrarse de solo lectura');
      await admin.fill('#contrasena', contrasenaNueva);
      const respuesta = admin.waitForResponse((r) => r.url().includes('/contrasena') && r.request().method() === 'PUT');
      await admin.click('#formulario button[type=submit]');
      afirmar((await respuesta).status() === 200, 'restablecer no respondió 200');
      await admin.waitForSelector('#modal-formulario', { state: 'hidden' });

      const c = await navegador.newContext({ viewport: ESCRITORIO });
      afirmar(await intentarIngreso(await c.newPage(), { dni: dniSesion, password: CONTRASENA }) === 401, 'la contraseña anterior sigue entrando');
      afirmar(await intentarIngreso(await c.newPage(), { dni: dniSesion, password: contrasenaNueva }) === 200, 'la nueva contraseña no entra');
      await c.close();
      return 'anterior → 401; nueva → 200';
    });

    // Nadie se desactiva ni quita su rol administrador; la pantalla muestra el motivo.
    await comprobar('AC-006', 'autoprotección: el administrador no puede desactivarse ni quitarse su rol', async () => {
      await buscar(admin, ADMIN.dni);
      await fila(admin, ADMIN.dni).getByRole('button', { name: 'Desactivar' }).click();
      await admin.waitForSelector('#alerta:not(.d-none)');
      afirmar((await admin.textContent('#alerta')).includes('propia cuenta'), 'no se muestra el motivo');
      afirmar((await fila(admin, ADMIN.dni).textContent()).includes('Activa'), 'la cuenta quedó inactiva');

      await fila(admin, ADMIN.dni).getByRole('button', { name: 'Cambiar rol' }).click();
      await admin.waitForSelector('#modal-formulario.show');
      await admin.selectOption('#rol', 'recepcionista');
      const respuesta = admin.waitForResponse((r) => r.url().includes('/rol') && r.request().method() === 'PUT');
      await admin.click('#formulario button[type=submit]');
      afirmar((await respuesta).status() === 409, 'cambiar el propio rol debía responder 409');
      afirmar((await admin.textContent('#error-formulario')).includes('quitarte'), 'el motivo no aparece en el formulario');
      await cancelar(admin);
      return 'desactivar y cambiar rol propios → 409 con motivo; la cuenta sigue activa';
    });

    // Recepción no ve la gestión: el panel no la ofrece y la pantalla y la API responden 403.
    await comprobar('AC-007', 'recepcionista: el panel no ofrece Usuarios, la pantalla y la API no se abren', async () => {
      const c = await navegador.newContext({ viewport: ESCRITORIO });
      const p = await c.newPage();
      await ingresar(p, RECEPCION);
      await p.waitForURL((url) => new URL(url).pathname === '/recepcionista.html');
      await p.waitForSelector('#contenido:not(.d-none)');
      const enlaces = await p.locator('#opciones a.btn-outline-primary').allTextContents();
      afirmar(!enlaces.includes('Usuarios'), `el panel muestra Usuarios: ${enlaces}`);
      await p.goto(`${APP}/usuarios.html`);
      await p.waitForURL((url) => new URL(url).pathname === '/recepcionista.html');
      afirmar(await estadoApi(p, 'usuarios') === 403, 'la API debía responder 403');
      const archivo = await captura(p, 'AC-007-panel-recepcionista-desktop.png');
      await c.close();
      return `API 403; ${archivo}`;
    });

    await comprobar('AC-007', 'sin sesión, abrir usuarios redirige al login y la API responde 401', async () => {
      const c = await navegador.newContext({ viewport: ESCRITORIO });
      const p = await c.newPage();
      await p.goto(`${APP}/usuarios.html`);
      await p.waitForURL((url) => new URL(url).pathname === '/');
      afirmar(await estadoApi(p, 'usuarios') === 401, 'la API debía responder 401');
      afirmar(!(await p.isVisible('#contenido')), 'no debía mostrarse la gestión');
      await c.close();
      return 'API 401; redirigido al login';
    });

    // Móvil sin desborde; el filtro por estado muestra sólo las cuentas inactivas.
    await comprobar('AC-008', 'móvil 390×844: listado y formulario sin desborde horizontal; el filtro por estado funciona', async () => {
      const movil = await navegador.newContext({ viewport: MOVIL });
      const m = await movil.newPage();
      await ingresar(m, ADMIN);
      await m.waitForURL((url) => new URL(url).pathname === '/administrador.html');
      await abrirUsuarios(m);
      afirmar(await sinDesborde(m), 'hay desborde horizontal en el listado');
      // Estado y acciones de cada cuenta quedan dentro del viewport (vista de tarjetas en móvil).
      const botonesVisibles = await m.evaluate(() => {
        const contenedor = document.querySelector('.table-responsive').getBoundingClientRect();
        const botones = [...document.querySelectorAll('#filas tr button')];
        return botones.length > 0 && botones.every((b) => {
          const r = b.getBoundingClientRect();
          return r.left >= contenedor.left && r.right <= contenedor.right;
        });
      });
      afirmar(botonesVisibles, 'algún botón de acción queda fuera del contenedor de la tabla en 390×844');
      const insignias = await m.locator('#filas tr .badge').count();
      afirmar(insignias > 0, 'no hay estado (Activa/Inactiva) en las tarjetas');
      const listado = await captura(m, 'AC-008-listado-movil.png');

      const respuesta = m.waitForResponse((r) => r.url().includes('estado=inactivos'));
      await m.selectOption('#estado', 'inactivos');
      await respuesta;
      await m.waitForTimeout(300);
      const estados = await m.locator('#filas tr').allTextContents();
      afirmar(estados.every((texto) => texto.includes('Inactiva')), `filas no inactivas: ${estados.length}`);

      await abrirNuevo(m);
      afirmar(await m.isVisible('#nombre') && await m.isVisible('#rol'), 'el alta debía mostrar nombre y rol');
      afirmar(await sinDesborde(m), 'hay desborde horizontal con el formulario abierto');
      const formulario = await captura(m, 'AC-008-formulario-movil.png');
      await cancelar(m);

      // Recorrido móvil completo: alta, cambio de rol y desactivación, con capturas en 390×844.
      const dniMovil = dniUnico();
      const altaMovil = await crearCuenta(m, { dni: dniMovil, nombre: 'Movil', apellido: `Cuenta${sufijo}`, rol: 'recepcionista', contrasena: CONTRASENA });
      afirmar(altaMovil === 201, `alta en móvil: HTTP ${altaMovil}`);
      await buscar(m, dniMovil);
      await fila(m, dniMovil).waitFor();
      const capturaAlta = await captura(m, 'AC-008-movil-1-alta.png');

      await fila(m, dniMovil).getByRole('button', { name: 'Cambiar rol' }).click();
      await m.waitForSelector('#modal-formulario.show');
      await m.selectOption('#rol', 'administrador');
      const rolMovil = m.waitForResponse((r) => r.url().includes('/rol') && r.request().method() === 'PUT');
      await m.click('#formulario button[type=submit]');
      afirmar((await rolMovil).status() === 200, 'cambiar rol en móvil no respondió 200');
      await m.waitForSelector('#modal-formulario', { state: 'hidden' });
      await buscar(m, dniMovil);
      afirmar((await fila(m, dniMovil).textContent()).includes('Administrador'), 'en móvil el listado no muestra el rol nuevo');
      const capturaRol = await captura(m, 'AC-008-movil-2-rol.png');

      const desactivoMovil = m.waitForResponse((r) => r.url().endsWith('/estado') && r.request().method() === 'PUT');
      await fila(m, dniMovil).getByRole('button', { name: 'Desactivar' }).click();
      afirmar((await desactivoMovil).status() === 200, 'desactivar en móvil no respondió 200');
      await fila(m, dniMovil).filter({ hasText: 'Inactiva' }).waitFor();
      afirmar(await sinDesborde(m), 'hay desborde horizontal tras desactivar en móvil');
      const capturaDesactivada = await captura(m, 'AC-008-movil-3-desactivada.png');
      await movil.close();
      return `${listado}; ${formulario}; ${estados.length} cuentas inactivas listadas; recorrido móvil: ${capturaAlta}, ${capturaRol}, ${capturaDesactivada}`;
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
