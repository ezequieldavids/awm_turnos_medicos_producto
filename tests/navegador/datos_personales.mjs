// Recorrido en un navegador real: autoconsulta de datos personales del paciente.
// Cubre: panel, campos sin cargar, sin sesión, solo lectura y texto escapado
// y viewports 390×844 y 1280×800.
//
// Requiere la aplicación levantada con la base de db/schema.sql y Chrome instalado.
// Variables opcionales: APP_URL (http://127.0.0.1:8080), CHROME_PATH (/usr/bin/google-chrome),
// ARTEFACTOS_DIR.
//
// Ejecutar desde la raíz del proyecto: npm run test:navegador:datos-personales
// Cada ejecución crea un paciente nuevo con DNI único y cuenta propia; no modifica al paciente semilla.
// Termina con código 1 si alguna comprobación falla. Guarda capturas y un informe JSON en ARTEFACTOS_DIR.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = (process.env.APP_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const ARTEFACTOS = process.env.ARTEFACTOS_DIR ?? path.join(raiz, 'specs/TUR-010/artifacts');
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const ESCRITORIO = { width: 1280, height: 800 };
const MOVIL = { width: 390, height: 844 };

// Cuentas semilla con la contraseña vigente de db/schema.sql (commit 3f3ed0c).
const CONTRASENA = 'Password123!';
const ADMIN = { dni: '20000001', password: CONTRASENA };

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

async function captura(page, nombre) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTEFACTOS, nombre) });
  return nombre;
}

async function ingresar(page, cuenta) {
  await page.goto(`${APP}/`);
  await page.fill('#dni', cuenta.dni);
  await page.fill('#password', cuenta.password);
  await page.click('button[type=submit]');
}

const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const valores = (page) => page.locator('#datos dd').allTextContents();
const etiquetas = (page) => page.locator('#datos dt').allTextContents();

async function main() {
  await mkdir(ARTEFACTOS, { recursive: true });
  const navegador = await chromium.launch({ executablePath: CHROME, headless: true });
  const dni = dniUnico();
  const apellido = `Datos${sufijo}`;
  // Texto con etiquetas: debe verse tal cual, sin interpretarse como HTML.
  const obraSocial = `<b>Cobertura ${sufijo}</b>`;

  try {
    // Preparación: el administrador crea un paciente sin teléfono ni email, con obra social con etiquetas, y su cuenta.
    const admin = await navegador.newContext({ viewport: ESCRITORIO });
    const pAdmin = await admin.newPage();
    await ingresar(pAdmin, ADMIN);
    await pAdmin.waitForURL((url) => new URL(url).pathname === '/administrador.html');
    const paciente = await admin.request.post(`${APP}/api/pacientes`, {
      data: { dni, nombre: 'Navegador', apellido, telefono: null, email: null, fechaNacimiento: '1990-05-17', obraSocial },
    });
    afirmar(paciente.status() === 201, `alta de paciente: ${paciente.status()}`);
    const cuenta = await admin.request.post(`${APP}/api/usuarios`, {
      data: { dni, rol: 'paciente', contrasena: CONTRASENA, activo: true },
    });
    afirmar(cuenta.status() === 201, `alta de cuenta: ${cuenta.status()}`);
    await admin.close();

    const contexto = await navegador.newContext({ viewport: ESCRITORIO });
    const p = await contexto.newPage();
    await ingresar(p, { dni, password: CONTRASENA });
    await p.waitForURL((url) => new URL(url).pathname === '/paciente.html');
    await p.waitForSelector('#contenido:not(.d-none)');

    await comprobar('AC-001', 'panel del paciente: «Mis datos personales» es un enlace y abre la página', async () => {
      afirmar((await p.locator('#opciones .badge', { hasText: 'Pendiente' }).count()) === 0, 'queda una insignia «Pendiente» en el panel');
      const enlace = p.locator('#opciones a.btn-outline-primary', { hasText: 'Mis datos personales' });
      afirmar((await enlace.count()) === 1, 'falta el enlace «Mis datos personales»');
      afirmar((await enlace.getAttribute('href')) === '/datos-personales.html', 'el enlace no apunta a /datos-personales.html');
      const archivo = await captura(p, 'AC-001-panel-paciente-desktop.png');
      await enlace.click();
      await p.waitForURL((url) => new URL(url).pathname === '/datos-personales.html');
      await p.waitForSelector('#contenido:not(.d-none)');
      return archivo;
    });

    await comprobar('AC-003', 'campos sin cargar como «Sin cargar»; fecha en DD/MM/AAAA; datos del registro', async () => {
      afirmar(JSON.stringify(await etiquetas(p)) === JSON.stringify(['DNI', 'Nombre', 'Apellido', 'Fecha de nacimiento', 'Teléfono', 'Email', 'Obra social']),
        `etiquetas: ${await etiquetas(p)}`);
      const [dato, nombre, apellidoMostrado, fecha, telefono, email] = await valores(p);
      afirmar(dato === dni && nombre === 'Navegador' && apellidoMostrado === apellido, `datos: ${dato} ${nombre} ${apellidoMostrado}`);
      afirmar(fecha === '17/05/1990', `fecha: ${fecha}`);
      afirmar(telefono === 'Sin cargar' && email === 'Sin cargar', `sin cargar: ${telefono} / ${email}`);
      return captura(p, 'AC-003-datos-sin-cargar-desktop.png');
    });

    await comprobar('AC-007', 'solo lectura: sin campos de edición y con el texto escapado', async () => {
      const edicion = await p.locator('#contenido input, #contenido textarea, #contenido select, #contenido form, #contenido button').count();
      afirmar(edicion === 0, `controles de edición: ${edicion}`);
      const obra = (await valores(p))[6];
      afirmar(obra === obraSocial, `obra social mostrada: ${obra}`);
      afirmar((await p.locator('#datos b').count()) === 0, 'el texto con etiquetas se interpretó como HTML');
    });

    await comprobar('AC-008', 'viewports 390×844 y 1280×800 sin desborde horizontal', async () => {
      await p.setViewportSize(MOVIL);
      await p.reload();
      await p.waitForSelector('#contenido:not(.d-none)');
      afirmar(await sinDesborde(p), 'desborde horizontal en 390 px');
      const movil = await captura(p, 'AC-008-datos-personales-movil.png');
      await p.setViewportSize(ESCRITORIO);
      await p.reload();
      await p.waitForSelector('#contenido:not(.d-none)');
      afirmar(await sinDesborde(p), 'desborde horizontal en 1280 px');
      const escritorio = await captura(p, 'AC-008-datos-personales-desktop.png');
      return `${movil}; ${escritorio}`;
    });

    await comprobar('AC-004', 'sin sesión, la página no muestra datos y vuelve al inicio', async () => {
      const sinSesion = await navegador.newContext({ viewport: ESCRITORIO });
      const q = await sinSesion.newPage();
      await q.goto(`${APP}/datos-personales.html`);
      await q.waitForURL((url) => new URL(url).pathname === '/');
      afirmar(!(await q.isVisible('#contenido')), 'se mostró el contenido sin sesión');
      await sinSesion.close();
    });

    await contexto.close();
  } finally {
    await navegador.close();
  }

  informe.fin = new Date().toISOString();
  await writeFile(path.join(ARTEFACTOS, 'navegador-datos-personales.json'), `${JSON.stringify(informe, null, 2)}\n`);
  const fallos = informe.comprobaciones.filter((c) => c.resultado !== 'cumplido');
  console.log(`\n${informe.comprobaciones.length - fallos.length}/${informe.comprobaciones.length} comprobaciones cumplidas.`);
  process.exitCode = fallos.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
