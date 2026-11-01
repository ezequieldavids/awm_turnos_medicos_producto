// Recorridos (rediseño visual) en un navegador real.
// Los paneles y la secuencia del diálogo se ejercen también en recorrido.mjs; hay además una reprueba completa.
//
// Requiere la aplicación levantada con la semilla de db/schema.sql y Chrome instalado.
// Variables opcionales: APP_URL (por defecto http://127.0.0.1:8080), CHROME_PATH, ARTEFACTOS_DIR.
// Ejecutar desde la raíz del proyecto: npm run test:navegador:diseno
// Termina con código 1 si alguna comprobación falla. Guarda capturas y diseno-resultados.json en ARTEFACTOS_DIR.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = (process.env.APP_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const ARTEFACTOS = process.env.ARTEFACTOS_DIR ?? path.join(raiz, 'specs/TUR-009/artifacts');
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const VIEWPORTS = { 'desktop-1280x800': { width: 1280, height: 800 }, 'movil-390x844': { width: 390, height: 844 } };
const ROL_CORTO = { administrador: 'ADMIN', recepcionista: 'RECEPCIÓN', profesional: 'PROFESIONAL', paciente: 'PACIENTE' };

const CUENTAS = {
  administrador: { dni: '20000001', password: 'Password123!', panel: 'administrador.html',
    paginas: ['administrador', 'usuarios', 'especialidades', 'profesionales', 'pacientes', 'consultorios', 'agendas', 'turnos', 'reportes'] },
  recepcionista: { dni: '20000002', password: 'Password123!', panel: 'recepcionista.html', paginas: ['recepcionista', 'pacientes', 'turnos'] },
  profesional: { dni: '20000003', password: 'Password123!', panel: 'profesional.html', paginas: ['profesional', 'agendas', 'turnos'] },
  paciente: { dni: '20000004', password: 'Password123!', panel: 'paciente.html', paginas: ['paciente', 'turnos'] },
};

const informe = { inicio: new Date().toISOString(), app: APP, comprobaciones: [], contrastes: [] };

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
  await page.screenshot({ path: path.join(ARTEFACTOS, nombre), fullPage: true });
  return nombre;
}

async function ingresar(navegador, cuenta, viewport) {
  const contexto = await navegador.newContext({ viewport });
  const pagina = await contexto.newPage();
  await pagina.goto(`${APP}/`);
  await pagina.fill('#dni', cuenta.dni);
  await pagina.fill('#password', cuenta.password);
  await pagina.click('#ingresar');
  await pagina.waitForURL((url) => new URL(url).pathname === `/${cuenta.panel}`);
  return { contexto, pagina };
}

// Contraste WCAG entre dos colores `rgb(r, g, b)` o `rgba(...)` (el fondo se compone sobre blanco).
function luminancia([r, g, b]) {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function numeros(color) {
  return color.match(/[\d.]+/g).map(Number);
}
function contraste(texto, fondo) {
  const [fr, fg, fb, fa = 1] = numeros(fondo);
  const base = [fr * fa + 255 * (1 - fa), fg * fa + 255 * (1 - fa), fb * fa + 255 * (1 - fa)];
  const a = luminancia(numeros(texto).slice(0, 3));
  const b = luminancia(base);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function main() {
  await mkdir(ARTEFACTOS, { recursive: true });
  const navegador = await chromium.launch({ executablePath: CHROME, headless: true });

  try {
    // Login con la referencia, botón deshabilitado mientras envía y mensajes de error con el aspecto nuevo.
    for (const [etiqueta, viewport] of Object.entries(VIEWPORTS)) {
      await comprobar('AC-002', `login con los elementos de la referencia (${etiqueta})`, async () => {
        const contexto = await navegador.newContext({ viewport });
        const pagina = await contexto.newPage();
        await pagina.goto(`${APP}/`);
        const texto = await pagina.textContent('main');
        for (const esperado of ['Gestión de Turnos', 'Acceda al sistema médico con sus credenciales', 'DNI / Documento', 'Contraseña', 'Ingresar',
          '¿No posee cuenta? Contacte con la recepción del centro médico para su alta.']) {
          afirmar(texto.includes(esperado), `falta «${esperado}»`);
        }
        afirmar((await pagina.getAttribute('#dni', 'placeholder')) === 'Ej. 35123456', 'placeholder del DNI');
        afirmar(await pagina.isVisible('img.logo'), 'falta el logo');
        const sinDesborde = await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        afirmar(sinDesborde, 'desborde horizontal');
        const archivo = await captura(pagina, `AC-002-login-${etiqueta}.png`);
        await contexto.close();
        return archivo;
      });
    }
    await comprobar('AC-002', 'el botón «Ingresar» se deshabilita mientras envía y el error conserva el aspecto', async () => {
      const contexto = await navegador.newContext({ viewport: VIEWPORTS['desktop-1280x800'] });
      const pagina = await contexto.newPage();
      await pagina.route('**/api/login', async (ruta) => {
        await new Promise((r) => setTimeout(r, 700));
        await ruta.continue();
      });
      await pagina.goto(`${APP}/`);
      await pagina.fill('#dni', '20000001');
      await pagina.fill('#password', 'contraseña-incorrecta');
      await pagina.click('#ingresar');
      afirmar(await pagina.isDisabled('#ingresar'), 'el botón no se deshabilitó al enviar');
      await pagina.waitForSelector('#alerta:not(.d-none)');
      afirmar(!(await pagina.isDisabled('#ingresar')), 'el botón no se rehabilitó tras el error');
      afirmar((await pagina.textContent('#alerta')).includes('No pudimos iniciar sesión con esos datos'), 'mensaje de error');
      await contexto.close();
    });

    // Cada pantalla autenticada de cada rol, en ambos viewports.
    for (const [rol, cuenta] of Object.entries(CUENTAS)) {
      for (const [etiqueta, viewport] of Object.entries(VIEWPORTS)) {
        await comprobar('AC-001/003/008', `${rol}: ${cuenta.paginas.length} pantallas con estilo común, barra y sin desborde (${etiqueta})`, async () => {
          const { contexto, pagina } = await ingresar(navegador, cuenta, viewport);
          const sesion = await pagina.evaluate(async () => (await (await fetch('/api/sesion')).json()).usuario);
          const archivos = [];
          for (const nombre of cuenta.paginas) {
            await pagina.goto(`${APP}/${nombre}.html`);
            await pagina.waitForSelector('#contenido:not(.d-none)');
            await pagina.waitForFunction(() => document.querySelector('#usuario-nombre')?.textContent !== '');
            const datos = await pagina.evaluate(() => ({
              hoja: [...document.styleSheets].some((h) => h.href?.endsWith('/assets/css/app.css')),
              estilosEnLinea: document.querySelectorAll('head style').length,
              marca: document.querySelector('.barra .marca')?.textContent.trim(),
              logo: !!document.querySelector('.barra .marca img'),
              nombre: document.querySelector('#usuario-nombre').textContent,
              rol: document.querySelector('#usuario-rol').textContent,
              cierre: (() => {
                const r = document.querySelector('#cerrar-sesion').getBoundingClientRect();
                return { visible: r.width > 0 && r.right <= window.innerWidth && r.left >= 0, texto: document.querySelector('#cerrar-sesion').textContent };
              })(),
              desborde: document.documentElement.scrollWidth > window.innerWidth,
              fuente: getComputedStyle(document.body).fontFamily.startsWith('Ubuntu'),
              fondo: getComputedStyle(document.body).backgroundColor,
              migas: [...document.querySelectorAll('.breadcrumb-item')].map((e) => e.textContent.trim()),
            }));
            afirmar(datos.hoja, `${nombre}: sin app.css`);
            afirmar(datos.estilosEnLinea === 0, `${nombre}: <style> en línea`);
            afirmar(datos.marca === 'Gestión de Turnos' && datos.logo, `${nombre}: marca de la barra «${datos.marca}»`);
            afirmar(datos.nombre === `${sesion.nombre} ${sesion.apellido}`, `${nombre}: nombre «${datos.nombre}»`);
            afirmar(datos.rol === ROL_CORTO[rol], `${nombre}: rol «${datos.rol}»`);
            afirmar(datos.cierre.visible && datos.cierre.texto === 'Cerrar Sesión', `${nombre}: botón de cierre ${JSON.stringify(datos.cierre)}`);
            afirmar(!datos.desborde, `${nombre}: desborde horizontal`);
            afirmar(datos.fuente, `${nombre}: la tipografía no es Ubuntu`);
            afirmar(datos.fondo === 'rgb(248, 249, 250)', `${nombre}: fondo ${datos.fondo}`);
            if (!nombre.match(/^(administrador|recepcionista|profesional|paciente)$/)) {
              afirmar(datos.migas[0] === 'Inicio' && datos.migas.length === 2, `${nombre}: migas ${JSON.stringify(datos.migas)}`);
              const volver = await pagina.getAttribute('#volver', 'href');
              afirmar(volver === `/${cuenta.panel}`, `${nombre}: «Inicio» lleva a ${volver}`);
            }
            archivos.push(await captura(pagina, `AC-001-${rol}-${nombre}-${etiqueta}.png`));
          }
          await contexto.close();
          return `${cuenta.paginas.length} pantallas; ${archivos[0]} …`;
        });
      }
    }

    // El diálogo en móvil y escritorio (la secuencia completa está en recorrido.mjs).
    for (const [etiqueta, viewport] of Object.entries(VIEWPORTS)) {
      await comprobar('AC-005', `diálogo de cierre de sesión visible y dentro de pantalla (${etiqueta})`, async () => {
        const { contexto, pagina } = await ingresar(navegador, CUENTAS.administrador, viewport);
        await pagina.waitForSelector('#contenido:not(.d-none)');
        await pagina.click('#cerrar-sesion');
        await pagina.waitForSelector('#dialogo-cerrar-sesion[open]');
        const caja = await pagina.locator('#dialogo-cerrar-sesion').boundingBox();
        afirmar(caja.x >= 0 && caja.x + caja.width <= viewport.width, 'el diálogo se sale de la pantalla');
        const botones = await pagina.locator('#dialogo-cerrar-sesion button').allTextContents();
        afirmar(botones.includes('Cancelar') && botones.filter((b) => b === 'Cerrar Sesión').length === 1, `botones: ${botones}`);
        const archivo = await captura(pagina, `AC-005-dialogo-${etiqueta}.png`);
        await contexto.close();
        return archivo;
      });
    }

    // Listados con filtros en tarjeta, «Estado» desplegable y «Contacto / Email».
    for (const [etiqueta, viewport] of Object.entries(VIEWPORTS)) {
      await comprobar('AC-006', `listados del administrador: filtros, estado y contacto (${etiqueta})`, async () => {
        const { contexto, pagina } = await ingresar(navegador, CUENTAS.administrador, viewport);
        const archivos = [];
        for (const [nombre, opciones, conContacto] of [
          ['profesionales', ['Solo activos', 'Solo inactivos', 'Todos'], true],
          ['pacientes', ['Solo activos', 'Solo inactivos', 'Todos'], true],
          ['consultorios', ['Solo activos', 'Solo inactivos', 'Todos'], false],
          ['agendas', ['Solo activas', 'Solo inactivas', 'Todas'], false],
        ]) {
          await pagina.goto(`${APP}/${nombre}.html`);
          await pagina.waitForSelector('#contenido:not(.d-none)');
          await pagina.waitForSelector('#filas tr');
          afirmar(await pagina.isVisible('.tarjeta-filtros'), `${nombre}: sin tarjeta de filtros`);
          afirmar(await pagina.locator('.tarjeta-filtros label.form-label:visible').count() >= 2, `${nombre}: etiquetas de filtros no visibles`);
          const textos = await pagina.locator('#filtro-estado option').allTextContents();
          afirmar(JSON.stringify(textos) === JSON.stringify(opciones), `${nombre}: opciones de estado ${JSON.stringify(textos)}`);
          afirmar((await pagina.inputValue('#filtro-estado')) === (nombre === 'agendas' ? 'activas' : 'activos'), `${nombre}: el estado por defecto no es «activos»`);
          afirmar(await pagina.locator('#solo-activos, #solo-activas').count() === 0, `${nombre}: queda la casilla antigua`);
          afirmar(await pagina.locator('thead th', { hasText: 'Acciones' }).count() === 1, `${nombre}: sin columna Acciones`);
          afirmar(await pagina.locator('#filas .grupo-acciones').count() > 0, `${nombre}: sin grupo de acciones`);
          afirmar(await pagina.locator('#filas .badge').count() > 0, `${nombre}: sin insignias de estado`);
          if (conContacto) {
            const encabezado = await pagina.locator('thead th', { hasText: 'Contacto / Email' }).count();
            afirmar(encabezado === 1, `${nombre}: sin columna Contacto / Email`);
            if (viewport.width >= 768) {
              afirmar(await pagina.locator('#filas td.contacto').first().isVisible(), `${nombre}: contacto no visible`);
              afirmar((await pagina.locator('#filas td.contacto').allTextContents()).some((t) => t.includes('@')), `${nombre}: sin ningún email`);
            }
          }
          archivos.push(await captura(pagina, `AC-006-${nombre}-${etiqueta}.png`));
        }
        await contexto.close();
        return archivos.join(', ');
      });
    }

    // Modal con error de validación y estado vacío con el estilo común.
    for (const [etiqueta, viewport] of Object.entries(VIEWPORTS)) {
      await comprobar('AC-007', `modal con error de validación y estado vacío (${etiqueta})`, async () => {
        const { contexto, pagina } = await ingresar(navegador, CUENTAS.administrador, viewport);
        await pagina.goto(`${APP}/profesionales.html`);
        await pagina.waitForSelector('#contenido:not(.d-none)');
        await pagina.click('#nuevo');
        await pagina.waitForSelector('#modal-formulario.show');
        await pagina.waitForTimeout(400); // fin de la animación del modal
        await pagina.click('#modal-formulario button[type=submit]');
        await pagina.waitForSelector('#modal-formulario .is-invalid, #modal-formulario #error-formulario:not(.d-none)');
        const radio = await pagina.evaluate(() => getComputedStyle(document.querySelector('#modal-formulario .modal-content')).borderTopLeftRadius);
        afirmar(parseFloat(radio) >= 8, `modal sin radio de la identidad (${radio})`);
        const archivoModal = await captura(pagina, `AC-007-modal-error-${etiqueta}.png`);
        await pagina.keyboard.press('Escape');
        await pagina.waitForSelector('#modal-formulario', { state: 'hidden' });
        await pagina.fill('#busqueda', 'zzz-sin-resultados-zzz');
        await pagina.waitForSelector('#vacio:not(.d-none)');
        const archivoVacio = await captura(pagina, `AC-007-vacio-${etiqueta}.png`);
        await contexto.close();
        return `${archivoModal}, ${archivoVacio}`;
      });
    }

    // Contraste AA de los pares de color de la paleta, calculado sobre los estilos reales.
    await comprobar('AC-008', 'contraste AA (≥ 4,5:1) de la barra, botones, insignias y enlaces', async () => {
      const { contexto, pagina } = await ingresar(navegador, CUENTAS.administrador, VIEWPORTS['desktop-1280x800']);
      await pagina.goto(`${APP}/profesionales.html`);
      await pagina.waitForSelector('#filas tr');
      const pares = await pagina.evaluate(() => {
        const colocar = (html) => {
          const c = document.createElement('div');
          c.innerHTML = html;
          document.body.append(c);
          return c.firstElementChild;
        };
        const par = (nombre, el, contenedorFondo = el) => {
          const e = getComputedStyle(el);
          return { nombre, texto: e.color, fondo: getComputedStyle(contenedorFondo).backgroundColor };
        };
        const elementos = [
          ['barra: texto sobre azul', document.querySelector('.barra .marca'), document.querySelector('.barra')],
          ['barra: rol (insignia blanca)', document.querySelector('.barra .usuario-rol')],
          ['barra: botón Cerrar Sesión', document.querySelector('.barra .btn-cerrar'), document.querySelector('.barra')],
          ['botón primario', colocar('<button class="btn btn-primary">x</button>')],
          ['botón contorneado azul sobre blanco', colocar('<button class="btn btn-outline-primary" style="background:#fff">x</button>')],
          ['botón contorneado rojo sobre blanco', colocar('<button class="btn btn-outline-danger" style="background:#fff">x</button>')],
          ['botón contorneado verde sobre blanco', colocar('<button class="btn btn-outline-success" style="background:#fff">x</button>')],
          ['botón peligro', colocar('<button class="btn btn-danger">x</button>')],
          ['enlace sobre fondo de página', colocar('<a href="#">x</a>')],
          ['texto secundario sobre blanco', colocar('<p class="text-body-secondary" style="background:#fff">x</p>')],
          ['texto secundario sobre fondo de página', colocar('<p class="subtitulo-pagina">x</p>')],
          ['título azul sobre blanco', colocar('<h2 style="color:#2563eb;background:#fff">x</h2>')],
          ...['success', 'secondary', 'info', 'warning', 'danger', 'primary'].map((c) => [`insignia ${c}`, colocar(`<span class="badge text-bg-${c}">x</span>`)]),
          ['insignia matrícula', colocar('<span class="badge insignia-matricula">x</span>')],
          ['insignia especialidad', colocar('<span class="badge insignia-especialidad">x</span>')],
        ];
        return elementos.map(([nombre, el, fondo]) => par(nombre, el, fondo ?? el));
      });
      // Los fondos transparentes (texto sobre página o tarjeta) se evalúan sobre el fondo real.
      const fallos = [];
      for (const p of pares) {
        const fondo = p.fondo === 'rgba(0, 0, 0, 0)' ? (p.nombre.includes('fondo de página') ? 'rgb(248, 249, 250)' : 'rgb(248, 249, 250)') : p.fondo;
        const ratio = contraste(p.texto, fondo);
        informe.contrastes.push({ par: p.nombre, texto: p.texto, fondo, ratio: Number(ratio.toFixed(2)) });
        if (ratio < 4.5) {
          fallos.push(`${p.nombre} ${ratio.toFixed(2)}`);
        }
      }
      await contexto.close();
      afirmar(fallos.length === 0, `contraste insuficiente: ${fallos.join('; ')}`);
      return `${pares.length} pares; mínimo ${Math.min(...informe.contrastes.map((c) => c.ratio))}:1`;
    });

    // Teclado con foco visible, en el login y en un listado.
    await comprobar('AC-008', 'recorrido por teclado con foco visible (login y listado)', async () => {
      const contexto = await navegador.newContext({ viewport: VIEWPORTS['desktop-1280x800'] });
      const pagina = await contexto.newPage();
      await pagina.goto(`${APP}/`);
      const visitados = [];
      for (let i = 0; i < 3; i++) {
        await pagina.keyboard.press('Tab');
        visitados.push(await pagina.evaluate(() => {
          const e = document.activeElement;
          const s = getComputedStyle(e);
          return { id: e.id, foco: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none' };
        }));
      }
      afirmar(JSON.stringify(visitados.map((v) => v.id)) === JSON.stringify(['dni', 'password', 'ingresar']), `orden de tabulación del login: ${visitados.map((v) => v.id)}`);
      afirmar(visitados.every((v) => v.foco), 'algún control del login sin foco visible');
      await pagina.fill('#dni', '20000001');
      await pagina.fill('#password', 'Password123!');
      await pagina.keyboard.press('Enter');
      await pagina.waitForURL('**/administrador.html');
      await pagina.goto(`${APP}/profesionales.html`);
      await pagina.waitForSelector('#filas tr');
      const recorridos = [];
      for (let i = 0; i < 12; i++) {
        await pagina.keyboard.press('Tab');
        recorridos.push(await pagina.evaluate(() => {
          const e = document.activeElement;
          const s = getComputedStyle(e);
          return { etiqueta: e.tagName, id: e.id, texto: e.textContent.trim().slice(0, 20), foco: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none' };
        }));
      }
      afirmar(recorridos.every((r) => r.foco), `sin foco visible: ${JSON.stringify(recorridos.filter((r) => !r.foco))}`);
      afirmar(recorridos.some((r) => r.id === 'cerrar-sesion') && recorridos.some((r) => r.id === 'nuevo') && recorridos.some((r) => r.id === 'busqueda'), 'el teclado no alcanzó barra, «Nuevo» y búsqueda');
      await contexto.close();
      return `login: ${visitados.map((v) => v.id)}; listado: ${recorridos.map((r) => r.id || r.etiqueta).join(' → ')}`;
    });

    // Sin proveedores nuevos; la fuente sale del propio servidor y hay respaldo si falta.
    await comprobar('AC-010', 'login y panel sólo piden recursos al servidor propio y a jsDelivr; la fuente es propia', async () => {
      const contexto = await navegador.newContext({ viewport: VIEWPORTS['desktop-1280x800'] });
      const pagina = await contexto.newPage();
      const hosts = new Set();
      const fuentes = [];
      pagina.on('request', (r) => hosts.add(new URL(r.url()).host));
      pagina.on('response', (r) => r.url().endsWith('.woff2') && fuentes.push({ url: new URL(r.url()).host, estado: r.status() }));
      await pagina.goto(`${APP}/`);
      await pagina.fill('#dni', '20000001');
      await pagina.fill('#password', 'Password123!');
      await pagina.click('#ingresar');
      await pagina.waitForSelector('#opciones article');
      await pagina.evaluate(() => document.fonts.ready);
      const permitidos = new Set([new URL(APP).host, 'cdn.jsdelivr.net']);
      const ajenos = [...hosts].filter((h) => !permitidos.has(h));
      afirmar(ajenos.length === 0, `hosts no permitidos: ${ajenos}`);
      afirmar(fuentes.length >= 1 && fuentes.every((f) => f.url === new URL(APP).host && f.estado === 200), `fuente: ${JSON.stringify(fuentes)}`);
      await contexto.close();

      const sinFuente = await navegador.newContext({ viewport: VIEWPORTS['desktop-1280x800'] });
      const p2 = await sinFuente.newPage();
      await p2.route('**/*.woff2', (ruta) => ruta.abort());
      await p2.goto(`${APP}/`);
      const legible = await p2.evaluate(() => {
        const e = document.querySelector('h1');
        const r = e.getBoundingClientRect();
        return { ancho: r.width, familia: getComputedStyle(e).fontFamily };
      });
      afirmar(legible.ancho > 100 && /system-ui|sans-serif/.test(legible.familia), `respaldo: ${JSON.stringify(legible)}`);
      await captura(p2, 'AC-010-login-sin-fuente-desktop-1280x800.png');
      await sinFuente.close();
      return `hosts: ${[...hosts].join(', ')}; fuente ${fuentes[0]?.url}`;
    });
  } finally {
    await navegador.close();
  }

  informe.fin = new Date().toISOString();
  await writeFile(path.join(ARTEFACTOS, 'diseno-resultados.json'), `${JSON.stringify(informe, null, 2)}\n`);
  const fallos = informe.comprobaciones.filter((c) => c.resultado !== 'cumplido');
  console.log(`\n${informe.comprobaciones.length - fallos.length}/${informe.comprobaciones.length} comprobaciones cumplidas.`);
  process.exitCode = fallos.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
