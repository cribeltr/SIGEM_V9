#!/usr/bin/env node
/****************************************************************************
 * SIGEM · Smoke test de la interfaz "Carta Gantt MP" (gantt.html).
 * --------------------------------------------------------------------------
 * Carga gantt.html en un DOM headless (jsdom), arranca con la SEMILLA real y
 * verifica que la Gantt se construye desde el NÚCLEO (HHHA), que la grilla y
 * los KPIs se pintan, y que las interacciones clave (abrir ficha, abrir el
 * formulario de MP desde una celda, cambiar tema) no lanzan errores.
 *
 * Uso:  npm run test:gantt   (o)   node tools/smoke-gantt.js
 ****************************************************************************/
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.error('Falta jsdom. Instala con:  npm install --no-save jsdom'); process.exit(2); }

const html = fs.readFileSync(path.join(ROOT, 'gantt.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window;
w.alert = () => {}; w.confirm = () => true; w.prompt = () => 'test';

const errs = [];
w.addEventListener('error', e => errs.push(e.message || String(e.error)));

const checks = [];
const ok = (label, cond) => checks.push({ label, cond: !!cond });
const click = node => node && node.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));

setTimeout(() => {
  try {
    const d = w.document;
    // 1) Núcleo real disponible y poblado desde la semilla
    ok('HHHA disponible', w.HHHA && typeof w.HHHA.getState === 'function');
    const S = w.HHHA.getState();
    ok('estado con equipos (semilla real)', S && Array.isArray(S.equipos) && S.equipos.length > 0);

    // 2) Shell de la Gantt construido por la vista
    ok('barra superior (mark MP)', /MP/.test((d.querySelector('.mark') || {}).textContent || ''));
    ok('KPIs pintados (4)', d.querySelectorAll('#kpis .kpi').length === 4);
    ok('cabecera con 12 meses', d.querySelectorAll('#thRow th.mth').length === 12);
    ok('contador = N° equipos', (d.querySelector('#countN') || {}).textContent === String(S.equipos.length));
    ok('grupos por familia', d.querySelectorAll('#tb tr.grp').length > 0);
    ok('filas de equipo visibles', d.querySelectorAll('#tb tr.row').length > 0);
    ok('selects de filtro poblados', d.querySelector('#fFam').options.length > 1 && d.querySelector('#fEstado').options.length > 1);

    // 3) Abrir la ficha del equipo (drawer) desde una fila
    const errBefore = errs.length;
    const row = d.querySelector('#tb tr.row');
    click(row.querySelector('.eq-name') || row);
    const drawer = d.querySelector('#drawer');
    ok('drawer abierto al clicar fila', drawer.classList.contains('on'));
    ok('ficha con nombre de equipo', !!drawer.querySelector('.d-name') && drawer.querySelector('.d-name').textContent.length > 0);
    ok('ficha con calendario MP (12 meses)', drawer.querySelectorAll('#mpcal .mpc').length === 12);
    ok('ficha con secciones (bitácora/pendientes/ciclos)', drawer.querySelectorAll('.sec').length >= 4);
    ok('ficha con acciones', drawer.querySelectorAll('.dacts .dact').length >= 4);

    // 4) Abrir el formulario de MP desde una celda del calendario
    click(drawer.querySelector('#mpcal .mpc'));
    ok('formulario MP abierto (resultado + ejecutor)', !!drawer.querySelector('#mRes') && !!drawer.querySelector('#mEjec'));
    // volver
    click(drawer.querySelector('[data-back]'));
    ok('vuelve a la ficha', !!drawer.querySelector('#mpcal'));

    // 5) Abrir formulario de MP directo desde una celda de la grilla
    const cell = d.querySelector('#tb tr.row td.mcell');
    click(cell);
    ok('MP desde celda de la grilla', !!d.querySelector('#drawer #mRes'));

    // 6) Cambiar tema sin error
    click(d.querySelector('#themeBtn'));
    ok('tema oscuro aplicado', d.documentElement.getAttribute('data-theme') === 'dark');

    ok('sin errores de runtime en las interacciones', errs.length === errBefore);
    ok('sin errores de runtime (global)', errs.length === 0);
  } catch (e) {
    errs.push('Excepción en el test: ' + e.message + '\n' + (e.stack || ''));
    ok('test sin excepción', false);
  }

  const fail = checks.filter(c => !c.cond);
  checks.forEach(c => console.log((c.cond ? 'OK   ' : 'FAIL ') + c.label));
  if (errs.length) { console.log('\nErrores capturados:'); errs.slice(0, 8).forEach(m => console.log('  · ' + m)); }
  console.log(fail.length ? `\n*** SMOKE GANTT: ${fail.length} fallo(s) ***` : '\n*** SMOKE GANTT OK ***');
  process.exit(fail.length ? 1 : 0);
}, 900);
