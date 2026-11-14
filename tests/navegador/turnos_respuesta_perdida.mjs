import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const app = process.env.APP_URL || 'http://localhost:8091';
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page = await browser.newPage({viewport:{width:390,height:844}});
 await page.goto(app); await page.locator('#dni').fill('20000004'); await page.locator('#password').fill('Password123!'); await page.locator('#ingresar').click(); await page.waitForURL('**/paciente.html');
 await page.goto(app+'/turnos.html'); await page.locator('#reserva-especialidad option').first().waitFor({state:'attached'});
 await page.locator('#reserva-especialidad').selectOption({label:'Cardiología'}); await page.locator('#buscar').click();
 const row=page.locator('#franjas tr').first(); await row.waitFor(); const text=await row.innerText();
 let status, payload, posts=0;
 await page.route('**/api/turnos',async route=>{if(route.request().method()!=='POST')return route.continue();posts++;payload=route.request().postDataJSON();const response=await route.fetch();status=response.status();await route.abort('connectionreset');});
 await row.getByRole('button',{name:'Reservar'}).click(); await page.locator('#reserva-mensaje').getByText('no sabemos',{exact:false}).waitFor();
 assert.equal(status,201);assert.equal(posts,1);assert.equal(await page.locator('#franjas tr').count(),0);
 await page.unroute('**/api/turnos'); await page.reload();
 await page.locator('#filas tr').filter({hasText:payload.fecha.split('-').reverse().join('-')}).filter({hasText:payload.horaInicio}).first().waitFor();
 const duplicate=await page.evaluate(async body=>{const r=await fetch('/api/turnos',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};},payload);
 assert.equal(duplicate.status,409);console.log(`OK POST persistido respondió ${status}, respuesta interrumpida, aviso incierto, un envío, turno visible tras recarga, duplicado ${duplicate.status}. Franja: ${text.replace(/\s+/g,' ')}`);
} finally {await browser.close();}
