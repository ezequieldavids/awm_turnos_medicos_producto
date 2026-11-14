import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.APP_URL || 'http://localhost:8090';
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// Las capturas van a ARTEFACTOS_DIR ; no sobrescribir la evidencia versionada sin querer.
const dir = process.env.ARTEFACTOS_DIR ?? 'artefactos';
await mkdir(dir, {recursive:true});
const browser = await chromium.launch({executablePath:chrome, headless:true});
try {
 for (const [label, viewport] of [['telefono',{width:390,height:844}],['tablet',{width:768,height:1024}]]) {
  const page = await browser.newPage({viewport});
  await page.goto(base); await page.fill('#dni','20000004'); await page.fill('#password','Password123!'); await page.click('button[type=submit]'); await page.waitForURL('**/paciente.html');
  await page.goto(base+'/turnos.html'); await page.waitForSelector('#reserva-especialidad option[value]:not([value=""])', {state:'attached'});
  const choices = await page.locator('#reserva-especialidad option').evaluateAll(a=>a.filter(o=>o.value).map(o=>o.value));
  assert.ok(choices.length >= 2);
  const f = {idAgenda:1, fecha:'2099-11-17', horaInicio:'14:00', horaFin:'14:30', profesional:{nombre:'Prueba',apellido:'Medico'}, consultorio:{numero:'1'}};
  let mode='ok', count=0, release;
  await page.route('**/api/disponibilidad?*', async route=>{ count++; if(mode==='wait') await new Promise(r=>release=r); if(mode==='fail') return route.abort(); await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({franjas:[f]})}); });
  await page.selectOption('#reserva-especialidad',choices[0]);
  await page.fill('#reserva-desde','2099-11-17'); await page.fill('#reserva-hasta','2099-11-17');
  async function search(){ await page.click('#buscar'); await page.waitForSelector('#franjas tr'); }
  await search(); await page.selectOption('#reserva-especialidad',choices[1]); assert.equal(await page.locator('#franjas tr').count(),0);
  await search(); await page.selectOption('#reserva-profesional',{index:1}); assert.equal(await page.locator('#franjas tr').count(),0);
  await search(); await page.fill('#reserva-desde','2099-11-16'); assert.equal(await page.locator('#franjas tr').count(),0);
  await search(); await page.fill('#reserva-hasta','2099-11-18'); assert.equal(await page.locator('#franjas tr').count(),0);
  await search(); await page.fill('#reserva-desde','2099-11-19'); await page.click('#buscar'); assert.equal(await page.locator('#franjas tr').count(),0); assert.match(await page.locator('#reserva-mensaje').innerText(),/posterior/);
  await page.fill('#reserva-desde','2099-11-16'); await search(); mode='fail'; await page.click('#buscar'); await page.waitForFunction(()=>document.querySelector('#reserva-mensaje').textContent.includes('conectar')); assert.equal(await page.locator('#franjas tr').count(),0);
  mode='wait'; await page.click('#buscar'); await page.waitForFunction(()=>!document.querySelector('#reserva-mensaje').textContent || document.querySelector('#reserva-mensaje').classList.contains('d-none')); await page.waitForTimeout(100); await page.selectOption('#reserva-especialidad',choices[0]); release(); await page.waitForTimeout(300); assert.equal(await page.locator('#franjas tr').count(),0);
  mode='ok'; await search(); let posts=0; await page.route('**/api/turnos',route=>{if(route.request().method()==='POST'){posts++;return route.abort();}return route.continue();}); await page.locator('#franjas button').first().click(); await page.waitForFunction(()=>document.querySelector('#reserva-mensaje').textContent.includes('no sabemos')); assert.equal(posts,1); assert.equal(await page.locator('#franjas tr').count(),0); await page.locator('#reserva-mensaje').scrollIntoViewIfNeeded(); await page.screenshot({path:`${dir}/error-002-${label}.png`}); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
  const reprogramar = page.getByRole('button', {name:'Reprogramar'}).first();
  await reprogramar.waitFor(); await reprogramar.click(); await page.waitForSelector('#modal-reprogramar.show');
  await page.fill('#reprogramar-desde','2099-11-16'); await page.fill('#reprogramar-hasta','2099-11-18');
  await page.click('#reprogramar-buscar'); await page.waitForSelector('#reprogramar-franjas tr');
  await page.fill('#reprogramar-desde','2099-11-17'); assert.equal(await page.locator('#reprogramar-franjas tr').count(),0);
  await page.click('#reprogramar-buscar'); await page.waitForSelector('#reprogramar-franjas tr');
  await page.fill('#reprogramar-hasta','2099-11-19'); assert.equal(await page.locator('#reprogramar-franjas tr').count(),0);
  await page.click('#reprogramar-buscar'); await page.waitForSelector('#reprogramar-franjas tr'); mode='fail';
  await page.click('#reprogramar-buscar'); await page.waitForFunction(()=>document.querySelector('#reprogramar-error').textContent.includes('conectar')); assert.equal(await page.locator('#reprogramar-franjas tr').count(),0);
  console.log(`OK ${label}: filtros, fechas inválidas, fallo y respuesta tardía de búsqueda, reserva con respuesta perdida, filtros de reprogramación, sin desborde`); await page.close();
 }
} finally { await browser.close(); }
