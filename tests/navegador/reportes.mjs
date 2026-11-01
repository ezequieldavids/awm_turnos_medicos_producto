// Recorridos en un navegador real: reporte e indicadores, exportación CSV y registro de asistencia.
//
// Requiere la aplicación levantada con la base de db/schema.sql y Chrome instalado.
// Variables: APP_URL (http://127.0.0.1:8080), CHROME_PATH (/usr/bin/google-chrome), ARTEFACTOS_DIR y,
// para insertar turnos pasados con estados conocidos (la API no reserva en el pasado), DB_CONTENEDOR (contenedor MySQL de
// Docker Compose; sin él, usa el cliente `mysql` local con DB_HOST, DB_PORT, DB_USUARIO y DB_NAME) y DB_PASSWORD.
//
// Ejecutar desde la raíz del proyecto: npm run test:navegador:reportes
// Cada ejecución crea profesionales, agendas, pacientes y turnos con datos únicos (no hay borrado físico).
// Termina con código 1 si alguna comprobación falla. Guarda capturas y un informe JSON en ARTEFACTOS_DIR.

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = (process.env.APP_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const ARTEFACTOS = process.env.ARTEFACTOS_DIR ?? path.join(raiz, 'specs/TUR-006/artifacts');
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const ESCRITORIO = { width: 1280, height: 800 };
const MOVIL = { width: 390, height: 844 };

// Usuarios semilla de db/schema.sql (sólo entorno local de prueba).
const ADMIN = { dni: '20000001', password: 'Password123!' };
const RECEPCION = { dni: '20000002', password: 'Password123!' };
const PROFESIONAL = { dni: '20000003', password: 'Password123!' };

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

async function captura(page, nombre, elemento = null) {
  await elemento?.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
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
  await page.waitForURL((url) => new URL(url).pathname === `/${pagina}`);
  await page.waitForSelector('#contenido:not(.d-none)');
}

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

// Consulta SQL directa: sólo para sembrar turnos pasados con un estado conocido.
function sql(consulta) {
  const entorno = { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD ?? 'turnos_local' };
  const usuario = process.env.DB_USUARIO ?? 'turnos';
  const base = process.env.DB_NAME ?? 'turnos';
  const [comando, argumentos] = process.env.DB_CONTENEDOR
    ? ['docker', ['exec', '-e', 'MYSQL_PWD', process.env.DB_CONTENEDOR, 'mysql', '-u', usuario, '-N', '-B', base, '-e', consulta]]
    : ['mysql', ['-h', process.env.DB_HOST ?? '127.0.0.1', '-P', process.env.DB_PORT ?? '3306', '-u', usuario, '-N', '-B', base, '-e', consulta]];
  return execFileSync(comando, argumentos, { env: entorno, encoding: 'utf8' }).trim();
}

function turnoDirecto(agenda, paciente, fecha, hora, estado) {
  const [h, m] = hora.split(':').map(Number);
  const fin = `${String(Math.floor((h * 60 + m + 15) / 60)).padStart(2, '0')}:${String((m + 15) % 60).padStart(2, '0')}`;
  sql(`INSERT INTO turno (id_paciente, id_agenda, fecha, hora_inicio, hora_fin, estado) VALUES (${paciente}, ${agenda}, '${fecha}', '${hora}:00', '${fin}:00', '${estado}')`);
}

const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// Fecha AAAA-MM-DD del día local, igual que hace la pantalla.
function fechaLocal(fecha) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

function periodoEsperado(preset, hoy) {
  const dia = (dias) => new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + dias);
  return {
    hoy: [dia(0), dia(0)],
    semana: [dia(-6), dia(0)],
    mes: [new Date(hoy.getFullYear(), hoy.getMonth(), 1), dia(0)],
    'mes-anterior': [new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1), new Date(hoy.getFullYear(), hoy.getMonth(), 0)],
    '30-dias': [dia(-29), dia(0)],
  }[preset].map(fechaLocal);
}

const texto = async (page, selector) => (await page.textContent(selector)).trim();

// La página consulta el reporte al abrirse: se espera ese resultado antes de aplicar filtros propios.
async function esperarCargaInicial(page) {
  await page.waitForSelector('#indicadores:not(.d-none), #vacio:not(.d-none)');
}

// Aplica filtros y espera la respuesta del reporte.
async function aplicarFiltros(page, { desde, hasta, especialidad = '', profesional = '' }) {
  await page.fill('#fecha-desde', desde);
  await page.fill('#fecha-hasta', hasta);
  await page.selectOption('#especialidad', String(especialidad));
  await page.selectOption('#profesional', String(profesional));
  const respuesta = page.waitForResponse((r) => r.url().includes('/api/reportes/turnos?'));
  await page.click('#aplicar');
  await respuesta;
}

async function main() {
  await mkdir(ARTEFACTOS, { recursive: true });
  const navegador = await chromium.launch({ executablePath: CHROME, headless: true });
  const anio = anioUnico();

  try {
    const admin = await navegador.newContext({ viewport: ESCRITORIO, locale: 'es-AR' });
    const paginaAdmin = await admin.newPage();
    await ingresar(paginaAdmin, ADMIN);
    await paginaAdmin.waitForURL((url) => new URL(url).pathname === '/administrador.html');
    await paginaAdmin.waitForSelector('#contenido:not(.d-none)');

    const especialidades = (await api(paginaAdmin, 'GET', '/api/especialidades')).datos.especialidades;
    const clinica = especialidades.find((e) => e.nombre === 'Clínica Médica').id;
    const cardiologia = especialidades.find((e) => e.nombre === 'Cardiología').id;

    async function profesionalConAgenda(apellido, profesionalExistente = null) {
      let idProfesional = profesionalExistente;
      if (idProfesional === null) {
        const alta = await api(paginaAdmin, 'POST', '/api/profesionales', {
          dni: dniUnico(), nombre: 'Reporte', apellido, telefono: null, email: null,
          fechaNacimiento: '1980-01-01', matricula: `REP-${randomUUID().slice(0, 10)}`, especialidades: [clinica],
        });
        afirmar(alta.estado === 201, `no se creó el profesional: ${JSON.stringify(alta.datos)}`);
        idProfesional = alta.datos.profesional.id;
      }
      const consultorio = await api(paginaAdmin, 'POST', '/api/consultorios', { numero: `TR-${randomUUID().slice(0, 10)}`, piso: null, ubicacion: null });
      const agenda = await api(paginaAdmin, 'POST', '/api/agendas', {
        profesional: idProfesional, consultorio: consultorio.datos.consultorio.id, especialidad: clinica,
        diaSemana: 3, horaInicio: '09:00', horaFin: '10:00', duracionMinutos: 15,
        vigenteDesde: `${anio}-01-01`, vigenteHasta: `${anio}-12-31`,
      });
      afirmar(agenda.estado === 201, `no se creó la agenda: ${JSON.stringify(agenda.datos)}`);
      return { profesional: idProfesional, agenda: agenda.datos.agenda.id };
    }

    async function pacienteNuevo(apellido) {
      const alta = await api(paginaAdmin, 'POST', '/api/pacientes', {
        dni: dniUnico(), nombre: 'Reporte', apellido, telefono: null, email: null, fechaNacimiento: '1990-05-17', obraSocial: null,
      });
      afirmar(alta.estado === 201, `no se creó el paciente: ${JSON.stringify(alta.datos)}`);
      return alta.datos.paciente.id;
    }

    const apellidoReporte = `Reporte${sufijo}`;
    const datos = await profesionalConAgenda(apellidoReporte);
    const paciente = await pacienteNuevo(`Paciente${sufijo}`);
    const periodo = { desde: '2021-03-01', hasta: '2021-03-31' };
    // 5 turnos del 10/03/2021: 2 atendidos, 1 ausente, 1 cancelado y 1 confirmado que ya pasó (asistencia pendiente).
    [['09:00', 'atendido'], ['09:15', 'atendido'], ['09:30', 'ausente'], ['09:45', 'cancelado']]
      .forEach(([hora, estado]) => turnoDirecto(datos.agenda, paciente, '2021-03-10', hora, estado));
    turnoDirecto(datos.agenda, paciente, '2021-03-17', '09:00', 'confirmado');

    // Acceso desde el panel.
    await comprobar('AC-004', 'el panel del administrador ofrece «Reportes» y el de recepción no', async () => {
      await paginaAdmin.goto(`${APP}/administrador.html`);
      await paginaAdmin.waitForSelector('#contenido:not(.d-none)');
      afirmar(await paginaAdmin.locator('#opciones a', { hasText: 'Reportes' }).count() === 1, 'el administrador no ve «Reportes» como enlace');
      const contexto = await navegador.newContext({ viewport: ESCRITORIO });
      const recepcion = await contexto.newPage();
      await ingresar(recepcion, RECEPCION);
      await recepcion.waitForURL((url) => new URL(url).pathname === '/recepcionista.html');
      await recepcion.waitForSelector('#contenido:not(.d-none)');
      afirmar(await recepcion.locator('#opciones', { hasText: 'Reportes' }).count() === 0, 'recepción ve «Reportes» en su panel');
      await recepcion.goto(`${APP}/reportes.html`);
      await recepcion.waitForURL((url) => new URL(url).pathname === '/', { timeout: 10000 });
      await contexto.close();
    });

    // La espera de la respuesta se arma antes del clic: la pantalla consulta el reporte apenas carga.
    const consultaInicial = paginaAdmin.waitForResponse((r) => r.url().includes('/api/reportes/turnos?'));
    await paginaAdmin.locator('#opciones a', { hasText: 'Reportes' }).click();
    await paginaAdmin.waitForURL((url) => new URL(url).pathname === '/reportes.html');
    await paginaAdmin.waitForSelector('#contenido:not(.d-none)');
    await consultaInicial;

    await comprobar('AC-005', 'período por defecto: del día 1 del mes actual a hoy', async () => {
      const [desde, hasta] = periodoEsperado('mes', new Date());
      afirmar(await paginaAdmin.inputValue('#fecha-desde') === desde, `desde: ${await paginaAdmin.inputValue('#fecha-desde')} ≠ ${desde}`);
      afirmar(await paginaAdmin.inputValue('#fecha-hasta') === hasta, `hasta: ${await paginaAdmin.inputValue('#fecha-hasta')} ≠ ${hasta}`);
    });

    await comprobar('AC-005', 'filtro por profesional y período: tarjetas, tasas y desglose con los conteos esperados', async () => {
      await aplicarFiltros(paginaAdmin, { ...periodo, profesional: datos.profesional });
      await paginaAdmin.waitForSelector('#indicadores:not(.d-none)');
      const tarjetas = await Promise.all(['#v-otorgados', '#v-atendidos', '#v-cancelados', '#v-ausentes'].map((s) => texto(paginaAdmin, s)));
      afirmar(tarjetas.join(',') === '5,2,1,1', `tarjetas: ${tarjetas.join(',')}`);
      const tasas = await Promise.all(['#t-ausentismo', '#t-cancelacion', '#t-ocupacion'].map((s) => texto(paginaAdmin, s)));
      // Ausentismo 1/3, cancelación 1/5; la agenda de prueba rige en otro año, así que no hay capacidad en 2021 (—).
      afirmar(tasas.join(' | ') === '33,3% | 20% | —', `tasas: ${tasas.join(' | ')}`);
      afirmar((await texto(paginaAdmin, '#confirmados')).includes('1 pendientes de registrar asistencia'), 'falta el aviso de pendientes');
      const filas = await paginaAdmin.locator('#filas tr').allTextContents();
      afirmar(filas.length === 1 && filas[0].includes(apellidoReporte) && filas[0].includes('Clínica Médica'), `desglose: ${filas}`);
      afirmar(await sinDesborde(paginaAdmin), 'desborde horizontal en escritorio');
      await captura(paginaAdmin, 'AC-005-reporte-con-datos-desktop.png');
      await captura(paginaAdmin, 'AC-005-reporte-desglose-desktop.png', paginaAdmin.locator('#tabla-desglose'));
    });

    await comprobar('AC-005', 'un nombre con HTML se muestra como texto, sin crear elementos (REV-TUR-006-004)', async () => {
      const marca = '<b id="inyectado">x</b>';
      sql(`UPDATE persona pe JOIN profesional pr ON pr.id_persona = pe.id_persona SET pe.apellido = '${marca}' WHERE pr.id_profesional = ${datos.profesional}`);
      const pagina = await admin.newPage();
      try {
        await abrir(pagina, 'reportes.html');
        await esperarCargaInicial(pagina);
        await aplicarFiltros(pagina, { ...periodo, profesional: datos.profesional });
        await pagina.waitForSelector('#filas tr');
        afirmar(await pagina.locator('#inyectado').count() === 0, 'el HTML del nombre se interpretó como elemento');
        afirmar((await pagina.locator('#filas').textContent()).includes(marca), 'el nombre no aparece como texto');
      } finally {
        await pagina.close();
        restaurarNombre();
      }
    });

    function restaurarNombre() {
      sql(`UPDATE persona pe JOIN profesional pr ON pr.id_persona = pe.id_persona SET pe.apellido = '${apellidoReporte}' WHERE pr.id_profesional = ${datos.profesional}`);
    }

    await comprobar('AC-005', 'el reporte con datos en 390×844 no desborda la página', async () => {
      const movil = await navegador.newContext({ viewport: MOVIL, locale: 'es-AR' });
      const pagina = await movil.newPage();
      await ingresar(pagina, ADMIN);
      await pagina.waitForURL((url) => new URL(url).pathname === '/administrador.html');
      await abrir(pagina, 'reportes.html');
      await esperarCargaInicial(pagina);
      await aplicarFiltros(pagina, { ...periodo, profesional: datos.profesional });
      await pagina.waitForSelector('#indicadores:not(.d-none)');
      afirmar(await sinDesborde(pagina), 'desborde horizontal en móvil');
      await pagina.waitForTimeout(400);
      await pagina.screenshot({ path: path.join(ARTEFACTOS, 'AC-005-reporte-con-datos-movil.png'), fullPage: true });
      await movil.close();
    });

    await comprobar('AC-005', 'cada atajo fija las fechas esperadas', async () => {
      const hoy = await paginaAdmin.evaluate(() => new Date().toISOString());
      for (const preset of ['hoy', 'semana', 'mes', 'mes-anterior', '30-dias']) {
        const respuesta = paginaAdmin.waitForResponse((r) => r.url().includes('/api/reportes/turnos?'));
        await paginaAdmin.click(`#presets [data-preset="${preset}"]`);
        await respuesta;
        const [desde, hasta] = periodoEsperado(preset, new Date());
        const real = [await paginaAdmin.inputValue('#fecha-desde'), await paginaAdmin.inputValue('#fecha-hasta')];
        afirmar(real[0] === desde && real[1] === hasta, `${preset}: ${real} ≠ ${[desde, hasta]}`);
      }
      return `referencia ${hoy.slice(0, 10)}`;
    });

    await comprobar('AC-005', 'sin turnos en el período: estado vacío con el rango y sin tarjetas con valores', async () => {
      await aplicarFiltros(paginaAdmin, { ...periodo, especialidad: cardiologia, profesional: datos.profesional });
      await paginaAdmin.waitForSelector('#vacio:not(.d-none)');
      afirmar(await paginaAdmin.locator('#indicadores').isHidden(), 'las tarjetas siguen visibles');
      const mensaje = await texto(paginaAdmin, '#vacio');
      afirmar(mensaje.includes('No se registran turnos para el período seleccionado'), 'falta el título del estado vacío');
      afirmar(mensaje.includes('01/03/2021') && mensaje.includes('31/03/2021'), `falta el rango en: ${mensaje}`);
      await captura(paginaAdmin, 'AC-005-reporte-vacio-desktop.png');
    });

    await comprobar('AC-005', '«Limpiar filtros» vuelve al período por defecto y a todos los criterios', async () => {
      const respuesta = paginaAdmin.waitForResponse((r) => r.url().includes('/api/reportes/turnos?'));
      await paginaAdmin.click('#limpiar');
      await respuesta;
      const [desde, hasta] = periodoEsperado('mes', new Date());
      afirmar(await paginaAdmin.inputValue('#fecha-desde') === desde && await paginaAdmin.inputValue('#fecha-hasta') === hasta, 'fechas sin restablecer');
      afirmar(await paginaAdmin.inputValue('#especialidad') === '' && await paginaAdmin.inputValue('#profesional') === '', 'criterios sin restablecer');
    });

    await comprobar('AC-005', 'fechas incoherentes: el mensaje aparece junto a los filtros y no se consulta', async () => {
      await paginaAdmin.fill('#fecha-desde', '2021-03-31');
      await paginaAdmin.fill('#fecha-hasta', '2021-03-01');
      await paginaAdmin.click('#aplicar');
      await paginaAdmin.waitForSelector('#mensaje-filtros:not(.d-none)');
      afirmar((await texto(paginaAdmin, '#mensaje-filtros')).includes('no puede ser posterior'), 'mensaje incorrecto');
    });

    await comprobar('AC-006', 'Exportar a CSV descarga el reporte con los filtros aplicados y las cifras de la pantalla', async () => {
      await aplicarFiltros(paginaAdmin, { ...periodo, profesional: datos.profesional });
      await paginaAdmin.waitForSelector('#indicadores:not(.d-none)');
      const descarga = paginaAdmin.waitForEvent('download');
      await paginaAdmin.click('#exportar');
      const archivo = await descarga;
      afirmar(archivo.suggestedFilename() === 'reporte-turnos-2021-03-01-a-2021-03-31.csv', `nombre: ${archivo.suggestedFilename()}`);
      const destino = path.join(ARTEFACTOS, 'AC-006-reporte-exportado.csv');
      await archivo.saveAs(destino);
      const bytes = await readFile(destino);
      afirmar(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, 'falta el BOM de UTF-8');
      const filas = bytes.toString('utf8').slice(1).trim().split('\r\n').map((f) => f.split(';'));
      afirmar(filas.length === 3, `se esperaban 3 filas y hubo ${filas.length}`);
      // El resumen nombra los criterios elegidos: todas las especialidades y el profesional filtrado.
      afirmar(filas[1][0] === 'Resumen' && filas[1][1] === 'Todas' && filas[1][2].startsWith(apellidoReporte), `resumen: ${filas[1]}`);
      afirmar(filas[1].slice(3, 9).join(',') === '5,2,1,1,1,0', `conteos del resumen: ${filas[1].slice(3, 9)}`);
      afirmar(filas[2][0] === 'Detalle' && filas[2][2].startsWith(apellidoReporte), `detalle: ${filas[2]}`);
      afirmar(filas[1].slice(9).join('|') === '33,3|20|', `tasas: ${filas[1].slice(9)}`);
      await captura(paginaAdmin, 'AC-006-exportar-desktop.png');
    });

    // El profesional registra la asistencia en la interfaz.
    const propia = await profesionalConAgenda('Cuenta', (await api(paginaAdmin, 'GET', '/api/profesionales?estado=todos')).datos.profesionales.find((p) => p.matricula === 'MP-10001').id);
    const apellidoAsistencia = `Asiste${sufijo}`;
    const pacienteAsistencia = await pacienteNuevo(apellidoAsistencia);
    const fechaPasada = `${randomInt(2001, 2020)}-06-15`;
    turnoDirecto(propia.agenda, pacienteAsistencia, fechaPasada, '10:30', 'confirmado');

    const contextoProfesional = await navegador.newContext({ viewport: ESCRITORIO });
    const profesional = await contextoProfesional.newPage();
    await ingresar(profesional, PROFESIONAL);
    await profesional.waitForURL((url) => new URL(url).pathname === '/profesional.html');
    await abrir(profesional, 'turnos.html');
    const filaAsistencia = () => profesional.locator('#filas tr', { hasText: apellidoAsistencia });
    async function filtrarFecha() {
      const respuesta = profesional.waitForResponse((r) => r.url().includes('/api/turnos?'));
      await profesional.fill('#filtro-desde', fechaPasada);
      await profesional.fill('#filtro-hasta', fechaPasada);
      await respuesta;
      await filaAsistencia().waitFor();
    }
    async function pulsar(nombre) {
      const respuesta = profesional.waitForResponse((r) => r.url().includes('/estado') && r.request().method() === 'PUT');
      await filaAsistencia().getByRole('button', { name: nombre }).click();
      afirmar((await respuesta).status() === 200, `«${nombre}» no respondió 200`);
    }

    await comprobar('AC-001', 'el profesional ve «Asistencia pendiente» en un turno pasado y lo marca ausente', async () => {
      await filtrarFecha();
      afirmar((await filaAsistencia().textContent()).includes('Asistencia pendiente'), 'falta la insignia «Asistencia pendiente»');
      await captura(profesional, 'AC-001-asistencia-pendiente-desktop.png');
      await pulsar('Ausente');
      await profesional.waitForSelector(`#filas tr:has-text("${apellidoAsistencia}"):has-text("Ausente")`);
      afirmar(sql(`SELECT estado FROM turno WHERE fecha = '${fechaPasada}' AND id_paciente = ${pacienteAsistencia}`) === 'ausente', 'la base no quedó en ausente');
    });

    await comprobar('AC-001', 'la corrección a atendido se refleja en la lista y en la base; no hay acciones de cancelar ni reprogramar', async () => {
      await pulsar('Marcar atendido');
      await profesional.waitForSelector(`#filas tr:has-text("${apellidoAsistencia}"):has-text("Atendido")`);
      afirmar(sql(`SELECT estado FROM turno WHERE fecha = '${fechaPasada}' AND id_paciente = ${pacienteAsistencia}`) === 'atendido', 'la base no quedó en atendido');
      const acciones = await filaAsistencia().locator('button').allTextContents();
      afirmar(acciones.join('|') === 'Marcar ausente', `acciones: ${acciones}`);
      await captura(profesional, 'AC-001-asistencia-atendido-desktop.png');
    });

    await comprobar('AC-001', 'en 390×844 el profesional registra la asistencia sin desborde horizontal', async () => {
      const movil = await navegador.newContext({ viewport: MOVIL });
      const pagina = await movil.newPage();
      const pacienteMovil = await pacienteNuevo(`AsisteM${sufijo}`);
      turnoDirecto(propia.agenda, pacienteMovil, fechaPasada, '10:45', 'confirmado');
      await ingresar(pagina, PROFESIONAL);
      await pagina.waitForURL((url) => new URL(url).pathname === '/profesional.html');
      await abrir(pagina, 'turnos.html');
      await pagina.fill('#filtro-desde', fechaPasada);
      await pagina.fill('#filtro-hasta', fechaPasada);
      const fila = pagina.locator('#filas tr', { hasText: `AsisteM${sufijo}` });
      await fila.waitFor();
      const respuesta = pagina.waitForResponse((r) => r.url().includes('/estado') && r.request().method() === 'PUT');
      await fila.getByRole('button', { name: 'Ausente' }).click();
      await respuesta;
      await pagina.waitForSelector(`#filas tr:has-text("AsisteM${sufijo}"):has-text("Ausente")`);
      await captura(pagina, 'AC-001-asistencia-movil-ausente.png', fila);
      const correccion = pagina.waitForResponse((r) => r.url().includes('/estado') && r.request().method() === 'PUT');
      await fila.getByRole('button', { name: 'Marcar atendido' }).click();
      await correccion;
      await pagina.waitForSelector(`#filas tr:has-text("AsisteM${sufijo}"):has-text("Atendido")`);
      afirmar(await sinDesborde(pagina), 'desborde horizontal en móvil');
      await captura(pagina, 'AC-001-asistencia-movil.png', fila);
      await movil.close();
    });

    await contextoProfesional.close();
    await admin.close();
  } finally {
    await navegador.close();
  }

  informe.fin = new Date().toISOString();
  await writeFile(path.join(ARTEFACTOS, 'navegador-resultados-reportes.json'), `${JSON.stringify(informe, null, 2)}\n`);
  const fallos = informe.comprobaciones.filter((c) => c.resultado !== 'cumplido');
  console.log(`\n${informe.comprobaciones.length - fallos.length}/${informe.comprobaciones.length} comprobaciones cumplidas.`);
  process.exitCode = fallos.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
