// Recorrido en un navegador real : profesionales por especialidad, botón Volver,
// fechas DD-MM-AAAA y listados en tarjetas en móvil. Cubre AC-001…AC-007.
//
// Requiere la aplicación levantada con la base de db/schema.sql  y Chrome instalado.
// Variables opcionales: APP_URL (http://127.0.0.1:8080), CHROME_PATH (/usr/bin/google-chrome),
// ARTEFACTOS_DIR (artefactos).
//
// Ejecutar desde la raíz del proyecto: npm run test:navegador:mejoras-uso
// Crea un paciente con cuenta propia (para la fecha de nacimiento) y reserva y cancela un turno del paciente semilla:
// la franja queda libre al terminar. Termina con código 1 si alguna comprobación falla.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = (process.env.APP_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const ARTEFACTOS = process.env.ARTEFACTOS_DIR ?? path.join(raiz, 'artefactos');
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const ESCRITORIO = { width: 1280, height: 800 };
const MOVIL = { width: 390, height: 844 };
const CONTRASENA = 'Password123!';
const ADMIN = { dni: '20000001', password: CONTRASENA };
const PROFESIONAL = { dni: '20000003', password: CONTRASENA };
const PACIENTE = { dni: '20000004', password: CONTRASENA };

// Fechas visibles: ni ISO ni con barras .
const ISO = /\b\d{4}-\d{2}-\d{2}\b/;
const BARRAS = /\b\d{2}\/\d{2}\/\d{4}\b/;
const DD_MM_AAAA = /\b\d{2}-\d{2}-\d{4}\b/;

// Consulta SQL directa: sólo para sembrar un turno pasado (la API no reserva en el pasado y la asistencia exige turnos pasados).
// Con DB_CONTENEDOR usa docker exec; sin él, el cliente mysql local con DB_HOST, DB_PORT, DB_USUARIO, DB_NAME y DB_PASSWORD.
function sql(consulta) {
  const entorno = { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD ?? '' };
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
  return Number(sql('SELECT MAX(id_turno) FROM turno'));
}

const dniUnico = () => String(randomInt(50000000, 99999999));
const sufijo = randomUUID().slice(0, 8);

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

async function captura(page, nombre, completa = false) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTEFACTOS, nombre), fullPage: completa });
  return nombre;
}

async function sesion(navegador, cuenta, viewport) {
  const contexto = await navegador.newContext({ viewport });
  const page = await contexto.newPage();
  await page.goto(`${APP}/`);
  await page.fill('#dni', cuenta.dni);
  await page.fill('#password', cuenta.password);
  await page.click('button[type=submit]');
  await page.waitForURL((url) => new URL(url).pathname !== '/');
  return { contexto, page };
}

async function abrir(page, ruta) {
  await page.goto(`${APP}${ruta}`);
  await page.waitForSelector('#contenido:not(.d-none)');
  await page.waitForLoadState('networkidle');
}

const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const textoVisible = (page) => page.evaluate(() => document.querySelector('main').innerText);

function fechaLocal(fecha) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

// Mide una tarjeta de un listado en móvil: encabezado oculto, rótulos, acciones al pie y botones táctiles.
async function medirTarjetas(page, tbody) {
  return page.evaluate((selector) => {
    const cuerpo = document.querySelector(selector);
    const tabla = cuerpo.closest('table');
    const encabezado = tabla.querySelector('thead').getBoundingClientRect();
    const filas = [...cuerpo.querySelectorAll(':scope > tr')];
    const visibles = (fila) => [...fila.children].filter((td) => getComputedStyle(td).display !== 'none');
    const sinRotulo = [];
    const botonesBajos = [];
    let accionesAlPie = true;
    let estadoArriba = true;
    for (const fila of filas) {
      const celdas = visibles(fila);
      for (const td of celdas) {
        const especial = ['celda-principal', 'celda-estado', 'celda-acciones'].some((c) => td.classList.contains(c));
        if (!especial && !td.dataset.etiqueta) sinRotulo.push(td.textContent.trim().slice(0, 30));
      }
      for (const b of fila.querySelectorAll('.btn')) {
        if (b.getBoundingClientRect().height < 44) botonesBajos.push(`${b.textContent} ${b.getBoundingClientRect().height}`);
      }
      const acciones = fila.querySelector('.celda-acciones');
      if (acciones && getComputedStyle(acciones).display !== 'none') {
        const pie = acciones.getBoundingClientRect().top;
        accionesAlPie &&= celdas.every((td) => td === acciones || td.getBoundingClientRect().top < pie);
      }
      const principal = fila.querySelector('.celda-principal');
      const estado = fila.querySelector('.celda-estado');
      if (principal && estado) {
        const otras = celdas.filter((td) => td !== principal && td !== estado && !td.classList.contains('celda-acciones'));
        estadoArriba &&= otras.every((td) => estado.getBoundingClientRect().top <= td.getBoundingClientRect().top);
      }
    }
    return {
      filas: filas.length,
      encabezadoOculto: encabezado.width <= 1 && encabezado.height <= 1,
      encabezadoEnArbol: tabla.querySelectorAll('thead th').length > 0 && getComputedStyle(tabla.querySelector('thead')).display !== 'none',
      tarjeta: filas.length ? getComputedStyle(filas[0]).display : null,
      sinRotulo,
      botonesBajos,
      accionesAlPie,
      estadoArriba,
    };
  }, tbody);
}

function afirmarTarjetas(m, nombre) {
  afirmar(m.filas > 0, `${nombre}: sin filas para medir`);
  afirmar(m.tarjeta === 'flex', `${nombre}: la fila no se dibuja como tarjeta (${m.tarjeta})`);
  afirmar(m.encabezadoOculto, `${nombre}: el encabezado de tabla es visible`);
  afirmar(m.encabezadoEnArbol, `${nombre}: el encabezado no queda para lectores de pantalla`);
  afirmar(m.sinRotulo.length === 0, `${nombre}: celdas sin rótulo: ${m.sinRotulo.join(' | ')}`);
  afirmar(m.botonesBajos.length === 0, `${nombre}: botones de menos de 44 px: ${m.botonesBajos.join(' | ')}`);
  afirmar(m.accionesAlPie, `${nombre}: las acciones no quedan al pie`);
  afirmar(m.estadoArriba, `${nombre}: el estado no queda en la primera línea`);
  return `${m.filas} tarjetas`;
}

async function main() {
  await mkdir(ARTEFACTOS, { recursive: true });
  const navegador = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    // ---------- AC-001 y AC-002: profesionales por especialidad (paciente, móvil) ----------
    const paciente = await sesion(navegador, PACIENTE, MOVIL);
    const pp = paciente.page;
    await abrir(pp, '/turnos.html');
    const opciones = await (await paciente.contexto.request.get(`${APP}/api/disponibilidad/opciones`)).json();
    const nombre = (p) => `${p.apellido}, ${p.nombre}`;
    const opcionesProfesional = () => pp.locator('#reserva-profesional option').evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent })));

    await comprobar('AC-001', 'sin especialidad el desplegable de profesional está deshabilitado', async () => {
      afirmar(await pp.inputValue('#reserva-especialidad') === '', 'la especialidad no empieza vacía');
      afirmar(await pp.isDisabled('#reserva-profesional'), 'el desplegable no está deshabilitado');
      const textos = (await opcionesProfesional()).map((o) => o.t);
      afirmar(textos.length === 1 && textos[0] === 'Elegí primero una especialidad', `opciones: ${textos.join(', ')}`);
      return textos[0];
    });

    await comprobar('AC-001', 'cada especialidad muestra sólo sus profesionales', async () => {
      let conProfesionales = 0;
      for (const e of opciones.especialidades) {
        await pp.selectOption('#reserva-especialidad', String(e.id));
        const esperados = opciones.profesionales.filter((p) => p.especialidades.some((x) => x.id === e.id)).map((p) => String(p.id)).sort();
        const vistos = (await opcionesProfesional()).filter((o) => o.v !== '').map((o) => o.v).sort();
        afirmar(JSON.stringify(esperados) === JSON.stringify(vistos), `${e.nombre}: esperado ${esperados} y visto ${vistos}`);
        afirmar(!(await pp.isDisabled('#reserva-profesional')), `${e.nombre}: quedó deshabilitado`);
        if (esperados.length) conProfesionales += 1;
      }
      return `${opciones.especialidades.length} especialidades comparadas (${conProfesionales} con profesionales)`;
    });

    // Dos especialidades A y B, un profesional que atiende ambas (queda) y otro que atiende A pero no B (sale).
    const atiende = (p, id) => p.especialidades.some((e) => e.id === id);
    let caso = null;
    for (const a of opciones.especialidades) {
      for (const b of opciones.especialidades) {
        if (a.id === b.id || caso) continue;
        const queda = opciones.profesionales.find((p) => atiende(p, a.id) && atiende(p, b.id));
        const sale = opciones.profesionales.find((p) => atiende(p, a.id) && !atiende(p, b.id));
        if (queda && sale) caso = { a, b, queda, sale };
      }
    }

    await comprobar('AC-001', 'un profesional que no atiende la nueva especialidad vuelve a «Cualquier profesional»', async () => {
      afirmar(caso, 'los datos no tienen dos especialidades con un profesional compartido y otro no compartido');
      const { a, b, queda, sale } = caso;
      await pp.selectOption('#reserva-especialidad', String(a.id));
      await pp.selectOption('#reserva-profesional', String(sale.id));
      await pp.selectOption('#reserva-especialidad', String(b.id));
      afirmar(await pp.inputValue('#reserva-profesional') === '', `quedó elegido ${await pp.inputValue('#reserva-profesional')}`);
      await pp.selectOption('#reserva-especialidad', String(a.id));
      await pp.selectOption('#reserva-profesional', String(queda.id));
      await pp.selectOption('#reserva-especialidad', String(b.id));
      afirmar(await pp.inputValue('#reserva-profesional') === String(queda.id), 'se perdió un profesional que sí atiende la nueva especialidad');
      await pp.locator('#reserva-profesional').scrollIntoViewIfNeeded();
      await captura(pp, 'AC-001-profesional-por-especialidad-movil.png');
      return `${caso.a.nombre} → ${caso.b.nombre}: ${nombre(caso.sale)} se reinicia; ${nombre(caso.queda)} se conserva`;
    });

    let franjaReservada = null;
    await comprobar('AC-002', 'la búsqueda con un profesional filtrado devuelve sólo sus franjas', async () => {
      // Se elige por la API un par especialidad-profesional con franjas en los próximos 14 días, y se busca en la interfaz.
      const hoy = new Date();
      const desde = fechaLocal(new Date(hoy.getTime() + 86400000));
      const hasta = fechaLocal(new Date(hoy.getTime() + 14 * 86400000));
      let elegido = null;
      let idEsp = null;
      for (const p of opciones.profesionales) {
        for (const e of p.especialidades) {
          if (elegido) break;
          const r = await paciente.contexto.request.get(`${APP}/api/disponibilidad?especialidad=${e.id}&profesional=${p.id}&fecha_desde=${desde}&fecha_hasta=${hasta}`);
          if (r.ok() && (await r.json()).franjas.length) { elegido = p; idEsp = e.id; }
        }
      }
      afirmar(elegido, 'ningún profesional tiene franjas en 14 días');
      await pp.selectOption('#reserva-especialidad', String(idEsp));
      await pp.selectOption('#reserva-profesional', String(elegido.id));
      await pp.fill('#reserva-desde', desde);
      await pp.fill('#reserva-hasta', hasta);
      await pp.click('#buscar');
      await pp.waitForFunction(() => document.querySelectorAll('#franjas tr').length > 0 || !document.querySelector('#sin-franjas').classList.contains('d-none'));
      const textos = await pp.locator('#franjas tr td:nth-child(3)').allTextContents();
      afirmar(textos.every((t) => t.includes(nombre(elegido))), 'aparecen franjas de otro profesional');
      franjaReservada = (await pp.locator('#franjas tr td:first-child').first().textContent()).trim();
      return `${textos.length} franjas de ${nombre(elegido)}`;
    });

    // ---------- AC-004 y AC-005 sobre la reserva: fechas en franjas, mensajes, modal y cancelación ----------
    await comprobar('AC-005', 'franjas de reserva en tarjetas (390×844)', async () => {
      afirmar(await sinDesborde(pp), 'hay desborde horizontal');
      const r = afirmarTarjetas(await medirTarjetas(pp, '#franjas'), 'franjas');
      await pp.locator('#franjas tr').first().scrollIntoViewIfNeeded();
      await captura(pp, 'AC-005-franjas-movil.png');
      return r;
    });

    await comprobar('AC-004', 'fechas DD-MM-AAAA en franjas, reserva, «Turno actual» y cancelación', async () => {
      afirmar(DD_MM_AAAA.test(franjaReservada) && !ISO.test(franjaReservada), `franja: ${franjaReservada}`);
      await pp.locator('#franjas tr').first().locator('button').click();
      await pp.waitForSelector('#reserva-mensaje.alert-success');
      const mensaje = await pp.textContent('#reserva-mensaje');
      afirmar(mensaje.includes(franjaReservada) && !ISO.test(mensaje), `mensaje de reserva: ${mensaje}`);
      const fila = pp.locator('#filas tr', { hasText: franjaReservada }).filter({ hasText: 'Confirmado' }).first();
      await fila.locator('button', { hasText: 'Reprogramar' }).click();
      await pp.waitForSelector('#modal-reprogramar.show');
      const actual = await pp.textContent('#reprogramar-actual');
      afirmar(actual.includes(franjaReservada) && !ISO.test(actual), `turno actual: ${actual}`);
      await pp.click('#reprogramar-buscar');
      await pp.waitForFunction(() => document.querySelectorAll('#reprogramar-franjas tr').length > 0 || !document.querySelector('#reprogramar-sin-franjas').classList.contains('d-none'));
      const modal = await pp.textContent('#reprogramar-franjas');
      afirmar(!ISO.test(modal) && !BARRAS.test(modal), 'fecha sin formatear en franjas del modal');
      if (await pp.locator('#reprogramar-franjas tr').count()) {
        afirmarTarjetas(await medirTarjetas(pp, '#reprogramar-franjas'), 'franjas del modal');
      }
      await captura(pp, 'AC-005-reprogramar-movil.png');
      // Se reprograma de verdad a la primera franja ofrecida: el mensaje de reprogramación debe mostrar DD-MM-AAAA.
      afirmar(await pp.locator('#reprogramar-franjas tr').count() > 0, 'el modal no ofrece franjas para reprogramar');
      const destino = pp.locator('#reprogramar-franjas tr').first();
      const [fechaDestino, horarioDestino] = (await destino.locator('td').allTextContents()).map((t) => t.trim());
      await destino.locator('button').click();
      await pp.waitForSelector('#mensaje-turno.alert-success');
      const msgReprogramacion = await pp.textContent('#mensaje-turno');
      afirmar(msgReprogramacion.includes('Turno reprogramado') && msgReprogramacion.includes(fechaDestino) && !ISO.test(msgReprogramacion) && !BARRAS.test(msgReprogramacion),
        `mensaje de reprogramación: ${msgReprogramacion}`);
      // Se cancela el turno reprogramado (ya en la franja nueva) y se revisa el mensaje de cancelación.
      let dialogo = '';
      pp.once('dialog', (d) => { dialogo = d.message(); d.accept(); });
      await pp.locator('#filas tr', { hasText: fechaDestino }).filter({ hasText: horarioDestino }).filter({ hasText: 'Confirmado' }).first()
        .locator('button', { hasText: 'Cancelar' }).click();
      await pp.waitForSelector('#mensaje-turno.alert-success');
      afirmar(dialogo.includes(fechaDestino) && !ISO.test(dialogo), `confirmación: ${dialogo}`);
      return `reprogramación «${msgReprogramacion.slice(0, 60)}…» y cancelación con ${fechaDestino}; turno cancelado al terminar`;
    });

    await comprobar('AC-004', 'mensaje de asistencia con fecha DD-MM-AAAA', async () => {
      const admin = await sesion(navegador, ADMIN, ESCRITORIO);
      const ctx = admin.contexto.request;
      const clinica = (await (await ctx.get(`${APP}/api/especialidades`)).json()).especialidades.find((e) => e.nombre === 'Clínica Médica').id;
      const alta = await ctx.post(`${APP}/api/profesionales`, {
        data: { dni: dniUnico(), nombre: 'Asistencia', apellido: `Mensaje${sufijo}`, telefono: null, email: null, fechaNacimiento: '1980-01-01', matricula: `ASI-${randomUUID().slice(0, 10)}`, especialidades: [clinica] },
      });
      afirmar(alta.status() === 201, `profesional: ${alta.status()}`);
      const profesional = (await alta.json()).profesional.id;
      const consultorio = (await (await ctx.post(`${APP}/api/consultorios`, { data: { numero: `AS-${randomUUID().slice(0, 10)}`, piso: null, ubicacion: null } })).json()).consultorio.id;
      const agenda = await ctx.post(`${APP}/api/agendas`, {
        data: { profesional, consultorio, especialidad: clinica, diaSemana: 3, horaInicio: '09:00', horaFin: '10:00', duracionMinutos: 15, vigenteDesde: '2025-01-01', vigenteHasta: '2025-12-31' },
      });
      afirmar(agenda.status() === 201, `agenda: ${agenda.status()}`);
      const alta2 = await ctx.post(`${APP}/api/pacientes`, {
        data: { dni: dniUnico(), nombre: 'Asistencia', apellido: `Paciente${sufijo}`, telefono: null, email: null, fechaNacimiento: '1990-05-17', obraSocial: null },
      });
      afirmar(alta2.status() === 201, `paciente: ${alta2.status()}`);
      const paciente = (await alta2.json()).paciente.id;
      // Miércoles 12-03-2025, dentro de la vigencia: turno confirmado ya pasado (asistencia pendiente).
      turnoDirecto((await agenda.json()).agenda.id, paciente, '2025-03-12', '09:00', 'confirmado');

      await abrir(admin.page, '/turnos.html');
      // Se filtra por el paciente de esta corrida: otras ejecuciones dejan turnos con la misma fecha y hora.
      const fila = admin.page.locator('#filas tr', { hasText: '12-03-2025' }).filter({ hasText: '09:00 a 09:15' }).filter({ hasText: `Paciente${sufijo}` }).first();
      await fila.waitFor();
      await fila.locator('button', { hasText: 'Atendido' }).click();
      await admin.page.waitForSelector('#mensaje-turno.alert-success');
      const mensaje = await admin.page.textContent('#mensaje-turno');
      afirmar(mensaje.includes('12-03-2025') && mensaje.includes('atendido') && !ISO.test(mensaje) && !BARRAS.test(mensaje), `mensaje de asistencia: ${mensaje}`);
      await admin.contexto.close();
      return mensaje.slice(0, 80);
    });

    await comprobar('AC-005', 'listado de turnos del paciente en tarjetas', async () => {
      await pp.selectOption('#filtro-estado', '');
      await pp.waitForLoadState('networkidle');
      afirmar(await sinDesborde(pp), 'hay desborde horizontal');
      return afirmarTarjetas(await medirTarjetas(pp, '#filas'), 'turnos del paciente');
    });
    await paciente.contexto.close();

    // ---------- AC-004 y AC-005: «Mis turnos» del profesional, la pantalla de la captura del usuario ----------
    const profesional = await sesion(navegador, PROFESIONAL, MOVIL);
    const pr = profesional.page;
    await abrir(pr, '/turnos.html');
    await comprobar('AC-004', 'el turno semilla del 2026-10-05 se ve como 05-10-2026 y no hay fechas ISO ni con barras', async () => {
      const texto = await textoVisible(pr);
      afirmar(texto.includes('05-10-2026'), 'no aparece 05-10-2026');
      afirmar(!ISO.test(texto), `fecha ISO visible: ${texto.match(ISO)?.[0]}`);
      afirmar(!BARRAS.test(texto), `fecha con barras visible: ${texto.match(BARRAS)?.[0]}`);
      return '05-10-2026 visible';
    });
    await comprobar('AC-005', '«Mis turnos» del profesional en tarjetas, fecha en una línea (390×844)', async () => {
      afirmar(await sinDesborde(pr), 'hay desborde horizontal');
      const r = afirmarTarjetas(await medirTarjetas(pr, '#filas'), 'turnos del profesional');
      const lineas = await pr.locator('#filas .fecha-turno').evaluateAll((es) => es.map((e) => e.getClientRects().length));
      afirmar(lineas.length > 0 && lineas.every((n) => n === 1), `la fecha se parte: ${lineas}`);
      await pr.locator('#titulo-listado').scrollIntoViewIfNeeded();
      await captura(pr, 'AC-005-turnos-profesional-movil.png');
      await captura(pr, 'AC-005-turnos-profesional-movil-completa.png', true);
      return `${r}; fecha en una línea en ${lineas.length}`;
    });
    await profesional.contexto.close();

    // ---------- AC-005 y AC-006: listados del administrador en móvil y escritorio ----------
    const listados = [
      ['pacientes', '/pacientes.html'],
      ['profesionales', '/profesionales.html'],
      ['especialidades', '/especialidades.html'],
      ['consultorios', '/consultorios.html'],
      ['agendas', '/agendas.html'],
      ['usuarios', '/usuarios.html'],
      ['turnos', '/turnos.html'],
    ];
    const adminMovil = await sesion(navegador, ADMIN, MOVIL);
    // Un nombre largo sin espacios desbordaba la tarjeta. Se crea uno propio (queda inactivo al terminar).
    const largo = `Larga${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`.slice(0, 60);
    const creada = await adminMovil.contexto.request.post(`${APP}/api/especialidades`, { data: { nombre: largo, descripcion: largo } });
    afirmar(creada.status() === 201, `alta de especialidad larga: ${creada.status()}`);
    const idLarga = (await creada.json()).especialidad?.id ?? (await creada.json()).id;
    for (const [nombreListado, ruta] of listados) {
      await comprobar('AC-005', `${nombreListado} en tarjetas (390×844)`, async () => {
        await abrir(adminMovil.page, ruta);
        afirmar(await sinDesborde(adminMovil.page), 'hay desborde horizontal');
        const r = afirmarTarjetas(await medirTarjetas(adminMovil.page, '#filas'), nombreListado);
        await adminMovil.page.locator('#filas').scrollIntoViewIfNeeded();
        await captura(adminMovil.page, `AC-005-${nombreListado}-movil.png`);
        return r;
      });
    }

    if (idLarga) await adminMovil.contexto.request.put(`${APP}/api/especialidades/${idLarga}/estado`, { data: { activa: false } });

    // AC-004 en pantallas del administrador: vigencias de agendas y período del reporte vacío.
    await comprobar('AC-004', 'vigencia de agendas en DD-MM-AAAA', async () => {
      await abrir(adminMovil.page, '/agendas.html');
      const texto = await textoVisible(adminMovil.page);
      afirmar(!ISO.test(texto) && !BARRAS.test(texto), `fecha sin formatear: ${texto.match(ISO)?.[0] ?? texto.match(BARRAS)?.[0]}`);
      afirmar(DD_MM_AAAA.test(texto), 'no se ve ninguna vigencia');
      return texto.match(DD_MM_AAAA)[0];
    });
    await comprobar('AC-004', 'período del reporte vacío en DD-MM-AAAA', async () => {
      const page = adminMovil.page;
      await abrir(page, '/reportes.html');
      await page.fill('#fecha-desde', '2020-01-01');
      await page.fill('#fecha-hasta', '2020-01-31');
      await page.click('#aplicar');
      // El aviso puede estar ya visible con el período por defecto: se espera el texto del período pedido.
      await page.waitForSelector('#vacio:not(.d-none)');
      await page.waitForFunction(() => document.querySelector('#vacio-detalle').textContent.includes('2020'), null, { timeout: 5000 })
        .catch(() => {});
      const texto = await textoVisible(page);
      afirmar(texto.includes('01-01-2020') && texto.includes('31-01-2020'), `el período no se ve como DD-MM-AAAA: ${await page.textContent('#vacio-detalle')}`);
      afirmar(!ISO.test(texto) && !BARRAS.test(texto), 'queda una fecha sin formatear');
      await page.locator('#vacio').scrollIntoViewIfNeeded();
      await captura(page, 'AC-004-reporte-periodo-movil.png');
      return 'entre el 01-01-2020 y el 31-01-2020';
    });
    await adminMovil.contexto.close();

    const adminEscritorio = await sesion(navegador, ADMIN, ESCRITORIO);
    for (const [nombreListado, ruta] of [['pacientes', '/pacientes.html'], ['turnos', '/turnos.html']]) {
      await comprobar('AC-006', `${nombreListado} sigue como tabla en 1280×800`, async () => {
        await abrir(adminEscritorio.page, ruta);
        const visible = await adminEscritorio.page.evaluate(() => {
          const thead = document.querySelector('#filas').closest('table').querySelector('thead');
          const caja = thead.getBoundingClientRect();
          return { alto: caja.height, fila: getComputedStyle(document.querySelector('#filas tr')).display };
        });
        afirmar(visible.alto > 20, `encabezado no visible (${visible.alto})`);
        afirmar(visible.fila === 'table-row', `las filas no son de tabla (${visible.fila})`);
        await captura(adminEscritorio.page, `AC-006-${nombreListado}-desktop.png`);
        return `encabezado de ${Math.round(visible.alto)} px`;
      });
    }
    await adminEscritorio.contexto.close();

    // ---------- AC-003 y AC-007: botón Volver en los nueve módulos, en ambos viewports ----------
    const modulos = [
      [ADMIN, '/agendas.html'], [ADMIN, '/consultorios.html'], [ADMIN, '/especialidades.html'],
      [ADMIN, '/pacientes.html'], [ADMIN, '/profesionales.html'], [ADMIN, '/reportes.html'],
      [ADMIN, '/turnos.html'], [ADMIN, '/usuarios.html'], [PACIENTE, '/datos-personales.html'],
    ];
    for (const [viewport, etiqueta] of [[MOVIL, 'movil'], [ESCRITORIO, 'desktop']]) {
      const sesiones = new Map();
      for (const [cuenta, ruta] of modulos) {
        await comprobar('AC-003', `Volver en ${ruta} (${viewport.width}×${viewport.height})`, async () => {
          if (!sesiones.has(cuenta)) sesiones.set(cuenta, await sesion(navegador, cuenta, viewport));
          const { contexto, page } = sesiones.get(cuenta);
          const panel = (await (await contexto.request.get(`${APP}/api/sesion`)).json()).panel;
          await abrir(page, ruta);
          const caja = await page.locator('#boton-volver').boundingBox();
          afirmar(caja && caja.y >= 0 && caja.y + caja.height <= viewport.height, 'el botón no se ve sin desplazar');
          afirmar((await page.locator('#boton-volver').innerText()).includes('Volver'), 'el botón no dice «Volver»');
          if (['/turnos.html', '/datos-personales.html'].includes(ruta)) {
            await captura(page, `AC-003-volver-${ruta.slice(1, -5)}-${etiqueta}.png`);
          }
          await page.click('#boton-volver');
          await page.waitForURL((url) => new URL(url).pathname === panel);
          return `lleva a ${panel}`;
        });
      }
      for (const { contexto } of sesiones.values()) await contexto.close();
    }

    await comprobar('AC-007', 'Volver se alcanza con el teclado y se activa con Enter', async () => {
      const { contexto, page } = await sesion(navegador, ADMIN, MOVIL);
      await abrir(page, '/pacientes.html');
      let llegó = false;
      for (let i = 0; i < 15 && !llegó; i += 1) {
        await page.keyboard.press('Tab');
        llegó = await page.evaluate(() => document.activeElement?.id === 'boton-volver');
      }
      afirmar(llegó, 'no se alcanzó con Tab');
      await page.keyboard.press('Enter');
      await page.waitForURL((url) => new URL(url).pathname === '/administrador.html');
      await contexto.close();
      return 'foco y Enter llevan al panel';
    });

    await comprobar('AC-007', 'en tarjetas el encabezado sigue en el árbol de accesibilidad', async () => {
      const { contexto, page } = await sesion(navegador, ADMIN, MOVIL);
      await abrir(page, '/pacientes.html');
      const encabezados = await page.getByRole('columnheader').allTextContents();
      afirmar(encabezados.some((t) => t.includes('DNI')), `encabezados accesibles: ${encabezados.join(', ')}`);
      const botones = await page.locator('#filas tr').first().getByRole('button').allTextContents();
      afirmar(botones.length > 0 && botones.every((t) => t.trim() !== ''), 'botones sin texto');
      await contexto.close();
      return `${encabezados.length} encabezados; botones: ${botones.join(', ')}`;
    });
  } finally {
    await navegador.close();
    informe.fin = new Date().toISOString();
    await writeFile(path.join(ARTEFACTOS, 'navegador-mejoras-uso.json'), JSON.stringify(informe, null, 2));
  }
  const fallos = informe.comprobaciones.filter((c) => c.resultado !== 'cumplido').length;
  console.log(`\n${informe.comprobaciones.length - fallos}/${informe.comprobaciones.length} comprobaciones cumplidas`);
  process.exit(fallos ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
