// Recorridos en un navegador real.
//
// Requiere la aplicación levantada con la base de db/schema.sql y Chrome instalado.
// Variables opcionales:
//   APP_URL            (por defecto http://127.0.0.1:8080)
//   CHROME_PATH        (por defecto /usr/bin/google-chrome)
//   ARTEFACTOS_DIR
//
// Ejecutar desde la raíz del proyecto: npm run test:navegador
// Termina con código 1 si alguna comprobación falla. Guarda capturas y un informe JSON en ARTEFACTOS_DIR.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = (process.env.APP_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const ARTEFACTOS = process.env.ARTEFACTOS_DIR ?? path.join(raiz, 'specs/TUR-001/artifacts');
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const ESCRITORIO = { width: 1280, height: 800 };
const MOVIL = { width: 390, height: 844 };
const MENSAJE_CREDENCIALES = 'No pudimos iniciar sesión con esos datos. Revisá el DNI y la contraseña.';

// Usuarios semilla de db/schema.sql (sólo entorno local de prueba).
const CUENTAS = {
  administrador: { dni: '20000001', password: 'Password123!', panel: '/administrador.html', nombre: 'Admin' },
  recepcionista: { dni: '20000002', password: 'Password123!', panel: '/recepcionista.html', nombre: 'Recepción' },
  profesional: { dni: '20000003', password: 'Password123!', panel: '/profesional.html', nombre: 'Profesional' },
  paciente: { dni: '20000004', password: 'Password123!', panel: '/paciente.html', nombre: 'Paciente' },
};
const CUENTA_INACTIVA = { dni: '20000005', password: 'Password123!' };

const informe = { inicio: new Date().toISOString(), app: APP, comprobaciones: [] };

function anotar(ac, descripcion, resultado, observado = '') {
  informe.comprobaciones.push({ ac, descripcion, resultado, observado });
  const marca = resultado === 'cumplido' ? 'OK    ' : 'FALLO ';
  console.log(`${marca}${ac} ${descripcion}${observado ? ` — ${observado}` : ''}`);
}

async function comprobar(ac, descripcion, funcion) {
  try {
    const observado = await funcion();
    anotar(ac, descripcion, 'cumplido', observado ?? '');
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
  await page.screenshot({ path: path.join(ARTEFACTOS, nombre), fullPage: true });
  return nombre;
}

async function ingresar(page, dni, password) {
  await page.goto(`${APP}/`);
  await page.fill('#dni', dni);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
}

// Título de cada tarjeta del panel (una tarjeta por opción autorizada).
async function nombresDeOpciones(page) {
  return page.locator('#opciones article h2').allTextContents();
}

// Opciones autorizadas por rol (src/Auth/Roles.php). Deben coincidir exactamente.
const OPCIONES_ESPERADAS = {
  paciente: ['Mis datos personales', 'Mis turnos'],
  profesional: ['Mi agenda', 'Mis turnos'],
  recepcionista: ['Gestión de Pacientes', 'Gestión de Turnos'],
  administrador: ['Usuarios y Roles', 'Especialidades Médicas', 'Profesionales de la Salud', 'Gestión de Pacientes', 'Consultorios Físicos', 'Agendas Médicas', 'Gestión de Turnos', 'Reportes de Gestión'],
};

async function ruta(page) {
  return new URL(page.url()).pathname;
}

async function main() {
  await mkdir(ARTEFACTOS, { recursive: true });
  const navegador = await chromium.launch({ executablePath: CHROME, headless: true });

  try {
    // Login correcto y llegada al panel del rol.
    await comprobar('AC-001', 'login del administrador lleva a su panel y muestra su nombre', async () => {
      const contexto = await navegador.newContext({ viewport: ESCRITORIO });
      const pagina = await contexto.newPage();
      const respuestaLogin = pagina.waitForResponse((r) => r.url().endsWith('/api/login'));
      await ingresar(pagina, CUENTAS.administrador.dni, CUENTAS.administrador.password);
      const estado = (await respuestaLogin).status();
      await pagina.waitForURL((url) => new URL(url).pathname === CUENTAS.administrador.panel);
      await pagina.waitForSelector('#contenido:not(.d-none)');
      afirmar(estado === 200, `la API respondió ${estado} al login`);
      afirmar((await pagina.textContent('#bienvenida')) === 'Bienvenido, Admin Prueba', 'saludo del panel incorrecto');
      const archivo = await captura(pagina, 'AC-001-panel-admin-desktop.png');
      await contexto.close();
      return `API 200; ${archivo}`;
    });

    // Credenciales incorrectas y cuenta inactiva con el mismo mensaje, sin sesión.
    await comprobar('AC-002', 'contraseña errónea muestra mensaje genérico y no abre sesión', async () => {
      const contexto = await navegador.newContext({ viewport: ESCRITORIO });
      const pagina = await contexto.newPage();
      await ingresar(pagina, CUENTAS.administrador.dni, 'contrasena-incorrecta');
      await pagina.waitForSelector('#alerta:not(.d-none)');
      afirmar((await pagina.textContent('#alerta')) === MENSAJE_CREDENCIALES, 'mensaje de error distinto al esperado');
      afirmar(new URL(pagina.url()).pathname === '/', 'no debía salir del formulario');
      const archivo = await captura(pagina, 'AC-002-error-contrasena-desktop.png');
      const sesion = await pagina.request.get(`${APP}/api/sesion`);
      afirmar(sesion.status() === 401, `sesión tras fallo: ${sesion.status()} en lugar de 401`);
      await contexto.close();
      return archivo;
    });

    await comprobar('AC-002', 'usuario inactivo muestra el mismo mensaje y no abre sesión', async () => {
      const contexto = await navegador.newContext({ viewport: ESCRITORIO });
      const pagina = await contexto.newPage();
      await ingresar(pagina, CUENTA_INACTIVA.dni, CUENTA_INACTIVA.password);
      await pagina.waitForSelector('#alerta:not(.d-none)');
      afirmar((await pagina.textContent('#alerta')) === MENSAJE_CREDENCIALES, 'mensaje distinto para cuenta inactiva');
      const archivo = await captura(pagina, 'AC-002-usuario-inactivo-desktop.png');
      await contexto.close();
      return archivo;
    });

    // Sin sesión, abrir un panel redirige al login.
    await comprobar('AC-003', 'abrir un panel sin sesión redirige al login', async () => {
      const contexto = await navegador.newContext({ viewport: ESCRITORIO });
      const pagina = await contexto.newPage();
      const respuestaPanel = pagina.waitForResponse((r) => r.url().endsWith('/api/panel'));
      await pagina.goto(`${APP}${CUENTAS.administrador.panel}`);
      const estado = (await respuestaPanel).status();
      await pagina.waitForURL((url) => new URL(url).pathname === '/');
      afirmar(estado === 401, `/api/panel respondió ${estado} sin sesión`);
      afirmar(!(await pagina.isVisible('#contenido')), 'el panel no debía mostrarse');
      const archivo = await captura(pagina, 'AC-003-redireccion-sin-sesion-desktop.png');
      await contexto.close();
      return `API 401; ${archivo}`;
    });

    // Cada rol ve su panel; cruzar de panel redirige al propio; sin desborde horizontal en móvil.
    for (const [rol, cuenta] of Object.entries(CUENTAS)) {
      await comprobar('AC-004', `panel del rol ${rol} en escritorio y móvil con sus opciones`, async () => {
        const archivos = [];
        for (const [etiqueta, viewport] of [['desktop-1280x800', ESCRITORIO], ['movil-390x844', MOVIL]]) {
          const contexto = await navegador.newContext({ viewport });
          const pagina = await contexto.newPage();
          await ingresar(pagina, cuenta.dni, cuenta.password);
          await pagina.waitForURL((url) => new URL(url).pathname === cuenta.panel);
          await pagina.waitForSelector('#contenido:not(.d-none)');
          const saludo = await pagina.textContent('#bienvenida');
          afirmar(saludo === `Bienvenido, ${cuenta.nombre} Prueba`, `saludo incorrecto: «${saludo}»`);
          const sinDesbordeHorizontal = await pagina.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          );
          afirmar(sinDesbordeHorizontal, `desborde horizontal en ${etiqueta}`);
          const opciones = await nombresDeOpciones(pagina);
          afirmar(
            JSON.stringify(opciones) === JSON.stringify(OPCIONES_ESPERADAS[rol]),
            `opciones de ${rol} en ${etiqueta}: ${JSON.stringify(opciones)}`
          );
          // Cada tarjeta enlaza a la ruta que la API entrega para ese rol; «+ Reservar» sólo para quienes reservan.
          const api = await pagina.evaluate(async () => (await (await fetch('/api/panel')).json()).opciones);
          const rutasApi = api.filter((o) => o.ruta).map((o) => o.ruta);
          const rutasTarjetas = await pagina.locator('#opciones article .btn-outline-primary').evaluateAll((a) => a.map((x) => new URL(x.href).pathname));
          afirmar(JSON.stringify(rutasApi) === JSON.stringify(rutasTarjetas), `rutas de las tarjetas ${JSON.stringify(rutasTarjetas)} ≠ API ${JSON.stringify(rutasApi)}`);
          const reservar = await pagina.locator('#opciones a', { hasText: '+ Reservar' }).count();
          afirmar(reservar === (rol === 'profesional' ? 0 : 1), `«+ Reservar» en ${rol}: ${reservar}`);
          archivos.push(await captura(pagina, `AC-004-panel-${rol}-${etiqueta}.png`));
          await contexto.close();
        }
        return archivos.join(', ');
      });
    }

    await comprobar('AC-004', 'paciente que abre el panel de administrador es llevado al suyo', async () => {
      const contexto = await navegador.newContext({ viewport: ESCRITORIO });
      const pagina = await contexto.newPage();
      await ingresar(pagina, CUENTAS.paciente.dni, CUENTAS.paciente.password);
      await pagina.waitForURL((url) => new URL(url).pathname === CUENTAS.paciente.panel);
      await pagina.waitForSelector('#contenido:not(.d-none)');
      await pagina.goto(`${APP}/administrador.html`);
      await pagina.waitForURL((url) => new URL(url).pathname === CUENTAS.paciente.panel);
      await pagina.waitForSelector('#contenido:not(.d-none)');
      const opciones = await nombresDeOpciones(pagina);
      afirmar(!opciones.some((texto) => texto.includes('Usuarios')), 'el paciente ve una opción de administración');
      await contexto.close();
      return `opciones del paciente: ${opciones.length}`;
    });

    // Cerrar sesión, comprobar que atrás no muestra datos y que la API responde 401.
    await comprobar('AC-005', 'cerrar sesión y volver con atrás no muestra datos protegidos', async () => {
      const contexto = await navegador.newContext({ viewport: ESCRITORIO });
      const pagina = await contexto.newPage();
      await ingresar(pagina, CUENTAS.administrador.dni, CUENTAS.administrador.password);
      await pagina.waitForURL((url) => new URL(url).pathname === CUENTAS.administrador.panel);
      await pagina.waitForSelector('#contenido:not(.d-none)');
      const archivo1 = await captura(pagina, 'AC-005-01-panel-admin-desktop.png');

      // El diálogo de confirmación se cancela de tres maneras sin cerrar la sesión.
      for (const [como, cerrar] of [['Cancelar', () => pagina.click('#cancelar-cerrar-sesion')], ['Escape', () => pagina.keyboard.press('Escape')], ['×', () => pagina.click('#dialogo-x')]]) {
        await pagina.click('#cerrar-sesion');
        await pagina.waitForSelector('#dialogo-cerrar-sesion[open]');
        afirmar((await pagina.textContent('#dialogo-cerrar-sesion')).includes('¿Está seguro de que desea cerrar sesión?'), 'texto del diálogo');
        if (como === 'Cancelar') {
          await captura(pagina, 'AC-005-dialogo-desktop.png');
        }
        await cerrar();
        await pagina.waitForSelector('#dialogo-cerrar-sesion', { state: 'hidden' });
        const sesion = await pagina.evaluate(async () => (await fetch('/api/sesion')).status);
        afirmar(sesion === 200 && new URL(pagina.url()).pathname === CUENTAS.administrador.panel, `«${como}» cerró la sesión (API ${sesion})`);
      }
      await pagina.click('#cerrar-sesion');
      await pagina.waitForSelector('#dialogo-cerrar-sesion[open]');
      await pagina.click('#confirmar-cerrar-sesion');
      await pagina.waitForURL((url) => new URL(url).pathname === '/');
      await pagina.waitForSelector('#formulario-login');
      const archivo2 = await captura(pagina, 'AC-005-02-tras-cerrar-sesion-desktop.png');

      const consultasAPanel = [];
      pagina.on('response', (r) => {
        if (r.url().endsWith('/api/panel')) {
          consultasAPanel.push(r.status());
        }
      });
      await pagina.goBack();
      await pagina.waitForURL((url) => new URL(url).pathname === '/', { timeout: 10000 });
      await pagina.waitForSelector('#formulario-login');
      afirmar(consultasAPanel.includes(401), `atrás no consultó la API o no recibió 401 (estados: ${consultasAPanel})`);
      afirmar(!(await pagina.isVisible('#contenido')), 'el panel protegido quedó visible tras atrás');
      afirmar(!(await pagina.textContent('body')).includes('Admin Prueba'), 'el nombre protegido sigue en pantalla');
      const archivo3 = await captura(pagina, 'AC-005-03-atras-desktop.png');
      await contexto.close();
      return `${archivo1}, ${archivo2}, ${archivo3}; /api/panel tras atrás: ${consultasAPanel}`;
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
