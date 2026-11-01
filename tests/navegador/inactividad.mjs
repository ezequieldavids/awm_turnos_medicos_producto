// Recorridos en un navegador real: cierre de sesión por inactividad.
// Cubre: cierre y aviso, la actividad mantiene la sesión, atrás tras vencer y aviso en 390×844 y 1280×800.
//
// Requiere la aplicación levantada con la base de db/schema.sql, con SESION_INACTIVIDAD_SEGUNDOS=20, y Chrome instalado.
// Variables opcionales: APP_URL (http://127.0.0.1:8080), CHROME_PATH (/usr/bin/google-chrome),
// ARTEFACTOS_DIR.
//
// Ejecutar desde la raíz del proyecto: npm run test:navegador:inactividad
// Tarda unos 2 minutos: las esperas son el límite de inactividad.
// Termina con código 1 si alguna comprobación falla o si el stack no tiene el límite de 20 segundos.
// Guarda capturas y un informe JSON en ARTEFACTOS_DIR.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = (process.env.APP_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const ARTEFACTOS = process.env.ARTEFACTOS_DIR ?? path.join(raiz, 'specs/TUR-008/artifacts');
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const ESCRITORIO = { width: 1280, height: 800 };
const MOVIL = { width: 390, height: 844 };
const LIMITE_SEGUNDOS = 20;
const ESPERA_VENCIMIENTO_MS = (LIMITE_SEGUNDOS + 5) * 1000;
const MENSAJE_INACTIVIDAD = 'Tu sesión se cerró por inactividad. Volvé a iniciar sesión.';

// Cuenta semilla con la contraseña vigente de db/schema.sql (commit 3f3ed0c).
const PACIENTE = { dni: '20000004', password: 'Password123!' };

const informe = { inicio: new Date().toISOString(), app: APP, comprobaciones: [] };

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
  await page.waitForURL((url) => new URL(url).pathname === '/paciente.html');
  await page.waitForSelector('#contenido:not(.d-none)');
}

// Estado y código de /api/sesion desde la página, con la cookie del navegador.
const estadoSesion = (page) => page.evaluate(async () => {
  const respuesta = await fetch('/api/sesion');
  const datos = await respuesta.json().catch(() => null);
  return { estado: respuesta.status, codigo: datos?.error?.codigo ?? null, limite: datos?.inactividadSegundos ?? null };
});

const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// El stack debe tener el límite de la prueba; si no, las esperas no prueban nada.
async function exigirLimite(page) {
  const { limite } = await estadoSesion(page);
  afirmar(limite === LIMITE_SEGUNDOS, `el stack informa ${limite} s y la prueba necesita ${LIMITE_SEGUNDOS} s (SESION_INACTIVIDAD_SEGUNDOS=${LIMITE_SEGUNDOS})`);
}

async function main() {
  await mkdir(ARTEFACTOS, { recursive: true });
  const navegador = await chromium.launch({ executablePath: CHROME, headless: true });

  try {
    // Sin interacción, la sesión se cierra sola; el aviso se ve en ambos viewports.
    const aviso = await navegador.newContext({ viewport: ESCRITORIO });
    const pAviso = await aviso.newPage();
    await ingresar(pAviso, PACIENTE);
    await comprobar('AC-003', 'sin interacción, la sesión se cierra sola y la pantalla de inicio muestra el aviso', async () => {
      await exigirLimite(pAviso);
      await pAviso.waitForTimeout(ESPERA_VENCIMIENTO_MS);
      await pAviso.waitForURL((url) => url.pathname === '/' && url.searchParams.get('sesion') === 'inactividad', { timeout: 10000 });
      await pAviso.waitForSelector('#formulario-login');
      const alerta = (await pAviso.textContent('#alerta')).trim();
      afirmar(alerta === MENSAJE_INACTIVIDAD, `aviso: «${alerta}»`);
      afirmar(await pAviso.isVisible('#alerta'), 'el aviso no se ve');
      const sesion = await estadoSesion(pAviso);
      // La sesión la cierra el servidor al vencer: la primera petición responde sesion_expirada y las siguientes no_autenticado.
      afirmar(sesion.estado === 401 && ['sesion_expirada', 'no_autenticado'].includes(sesion.codigo), `sesión tras el cierre: ${sesion.estado} ${sesion.codigo}`);
      return captura(pAviso, 'AC-003-aviso-inactividad-desktop.png');
    });
    await comprobar('AC-009', 'el aviso se lee sin desborde horizontal en 390×844 y 1280×800', async () => {
      // Sin esta comprobación, la medición de desborde daría OK sobre cualquier página.
      afirmar(pAviso.url().includes('sesion=inactividad'), `la página no es la pantalla de inicio con aviso: ${pAviso.url()}`);
      afirmar((await pAviso.textContent('#alerta')).trim() === MENSAJE_INACTIVIDAD, 'falta el aviso de inactividad');
      await pAviso.setViewportSize(MOVIL);
      await pAviso.waitForTimeout(300);
      afirmar(await sinDesborde(pAviso), 'desborde horizontal en 390 px');
      const movil = await captura(pAviso, 'AC-009-aviso-movil.png');
      await pAviso.setViewportSize(ESCRITORIO);
      afirmar(await sinDesborde(pAviso), 'desborde horizontal en 1280 px');
      const escritorio = await captura(pAviso, 'AC-009-aviso-desktop.png');
      return `${movil}; ${escritorio}`;
    });
    await aviso.close();

    // La actividad del usuario mantiene la sesión (una pulsación cada 10 s, durante 30 s, con límite de 20 s).
    const activo = await navegador.newContext({ viewport: ESCRITORIO });
    const pActivo = await activo.newPage();
    await ingresar(pActivo, PACIENTE);
    await comprobar('AC-004', 'pulsaciones cada 10 s durante 30 s mantienen la sesión', async () => {
      await exigirLimite(pActivo);
      for (let i = 0; i < 3; i++) {
        await pActivo.waitForTimeout(10000);
        await pActivo.keyboard.press('Shift');
      }
      afirmar(new URL(pActivo.url()).pathname === '/paciente.html', `la página cambió a ${pActivo.url()}`);
      afirmar(await pActivo.isVisible('#contenido'), 'el panel dejó de verse');
      const sesion = await estadoSesion(pActivo);
      afirmar(sesion.estado === 200, `sesión tras 30 s con actividad: ${sesion.estado} ${sesion.codigo}`);
      return 'sesión viva tras 30 s con actividad';
    });
    await activo.close();

    // Tras vencer, «atrás» vuelve a la pantalla de inicio y la API responde 401 antes de mostrar datos.
    const atras = await navegador.newContext({ viewport: ESCRITORIO });
    const pAtras = await atras.newPage();
    await ingresar(pAtras, PACIENTE);
    await comprobar('AC-005', 'tras vencer, atrás vuelve a la pantalla de inicio sin datos protegidos', async () => {
      await pAtras.goto(`${APP}/datos-personales.html`);
      await pAtras.waitForSelector('#contenido:not(.d-none)');
      await pAtras.waitForTimeout(ESPERA_VENCIMIENTO_MS);
      await pAtras.waitForURL((url) => url.searchParams.get('sesion') === 'inactividad', { timeout: 10000 });

      const respuestas = [];
      pAtras.on('response', (r) => {
        if (new URL(r.url()).pathname.startsWith('/api/')) {
          respuestas.push(r.status());
        }
      });
      await pAtras.goBack();
      // Tras atrás la pantalla de inicio muestra el aviso.
      await pAtras.waitForURL((url) => url.pathname === '/' && url.searchParams.get('sesion') === 'inactividad', { timeout: 10000 });
      await pAtras.waitForSelector('#formulario-login');
      afirmar((await pAtras.textContent('#alerta')).trim() === MENSAJE_INACTIVIDAD, 'tras atrás falta el aviso de inactividad');
      afirmar(!(await pAtras.isVisible('#contenido')), 'el panel protegido quedó visible tras atrás');
      afirmar(respuestas.includes(401), `atrás no recibió 401 de la API (estados: ${respuestas})`);
      return captura(pAtras, 'AC-005-atras-desktop.png');
    });
    await atras.close();
  } finally {
    await navegador.close();
  }

  informe.fin = new Date().toISOString();
  await writeFile(path.join(ARTEFACTOS, 'navegador-inactividad.json'), `${JSON.stringify(informe, null, 2)}\n`);
  const fallos = informe.comprobaciones.filter((c) => c.resultado !== 'cumplido');
  console.log(`\n${informe.comprobaciones.length - fallos.length}/${informe.comprobaciones.length} comprobaciones cumplidas.`);
  process.exitCode = fallos.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
