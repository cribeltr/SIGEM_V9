#!/usr/bin/env node
/****************************************************************************
 * SIGEM · Smoke test del artefacto principal (app.html = Carta Gantt MP).
 * --------------------------------------------------------------------------
 * Carga app.html en un DOM headless (jsdom), arranca con la SEMILLA real y
 * verifica que la Gantt se construye desde el NÚCLEO (HHHA), que la grilla y
 * los KPIs se pintan, y que las interacciones clave (abrir ficha, abrir el
 * formulario de MP desde una celda, Configuración, tema) no lanzan errores.
 *
 * Uso:  npm test   (o)   node tools/smoke-test.js
 ****************************************************************************/
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.error('Falta jsdom. Instala con:  npm install --no-save jsdom'); process.exit(2); }

const html = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window;
w.alert = () => {}; w.confirm = () => true; w.prompt = () => 'test';

const errs = [];
w.addEventListener('error', e => errs.push(e.message || String(e.error)));

const checks = [];
const ok = (label, cond) => checks.push({ label, cond: !!cond });
const click = node => node && node.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const fire = (node, type) => node && node.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true }));

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
    ok('columna Pendientes + embudos de filtro', !!d.querySelector('#thRow th.pcol') && d.querySelectorAll('#thRow .thf').length >= 15);
    ok('sin columnas PMP / MP-R', d.querySelectorAll('#thRow th.sum').length === 0);
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
    ok('ficha con sección Archivos (Drive)', !!drawer.querySelector('#dvFiles'));

    // 4) Abrir el formulario de MP desde una celda del calendario
    click(drawer.querySelector('#mpcal .mpc'));
    ok('formulario MP abierto (resultado + ejecutor)', !!drawer.querySelector('#mRes') && !!drawer.querySelector('#mEjec'));
    click(drawer.querySelector('[data-back]'));
    ok('vuelve a la ficha', !!drawer.querySelector('#mpcal'));

    // 5) Nuevo evento: campos por tipo
    click([...drawer.querySelectorAll('.dact')].find(b => /Nuevo evento/.test(b.textContent)));
    ok('nuevo evento: selector de tipo', !!d.querySelector('#drawer #evTipo'));
    const evTipo = d.querySelector('#drawer #evTipo'); evTipo.value = 'Orden de Compra'; evTipo.dispatchEvent(new w.Event('change'));
    ok('nuevo evento: campos por tipo (OC)', !!d.querySelector('#drawer #ev_nCotiz') && !!d.querySelector('#drawer #ev_via'));

    // 6) Configuración (Google Sheets / respaldo / mantenimiento / maestro / plantilla)
    click(d.querySelector('#cfgBtn'));
    ok('panel Configuración abierto', !!d.querySelector('#drawer #cfgStatus') && d.querySelectorAll('#drawer [data-act^="cfg-"]').length > 0);
    ok('config: maestro + plantilla', !!d.querySelector('#drawer [data-act="cfg-maestro"]') && !!d.querySelector('#drawer #cfgMes') && !!d.querySelector('#drawer #cfgAno'));
    click(d.querySelector('#drawer [data-act="cfg-conf"]'));
    ok('panel Conciliación abre', /Conflictos/.test((d.querySelector('#drawer .d-name') || {}).textContent || ''));

    // 7) MP directa desde una celda de la grilla
    click(d.querySelector('#tb tr.row td.mcell'));
    ok('MP desde celda de la grilla', !!d.querySelector('#drawer #mRes'));

    // 8) Tema
    click(d.querySelector('#themeBtn'));
    ok('tema oscuro aplicado', d.documentElement.getAttribute('data-theme') === 'dark');

    // 9) Menú "Más" → Tablero / Cumplimiento
    click(d.querySelector('#moreBtn'));
    ok('menú Más abre', d.querySelector('#moreMenu').classList.contains('on'));
    click(d.querySelector('.more-item[data-screen="tablero"]'));
    ok('Tablero: 3 columnas kanban', d.querySelectorAll('#altScreen .kb-col').length === 3);
    click([...d.querySelectorAll('#tbSeg button')].find(b => b.getAttribute('data-m') === 'pendientes'));
    ok('Tablero pendientes (3 columnas)', d.querySelectorAll('#altScreen .kb-col').length === 3);
    var pc = d.querySelector('#altScreen .kb-col[data-col="no_iniciado"] .kb-card[data-pend]');
    if (pc) { var pid = pc.getAttribute('data-pend'); fire(pc, 'dragstart'); fire(d.querySelector('#altScreen .kb-col[data-col="en_proceso"]'), 'drop'); ok('Tablero: arrastrar pendiente cambia estado', (w.HHHA.getState().pendientes.find(p => String(p.id) === pid) || {}).estado === 'en_proceso'); }
    click(d.querySelector('#moreBtn')); click(d.querySelector('.more-item[data-screen="cumplimiento"]'));
    ok('Cumplimiento: tabla por servicio', !!d.querySelector('#altScreen table.cmp-table') && d.querySelectorAll('#altScreen .cmp-table tbody tr').length > 0);
    ok('Cumplimiento: tendencia 12 meses', d.querySelectorAll('#altScreen .trend .trend-col').length === 12);
    click(d.querySelector('#moreBtn')); click(d.querySelector('.more-item[data-screen="midia"]'));
    ok('Mi día: alertas + lista de pendientes', d.querySelectorAll('#altScreen .mday-alert').length >= 6 && !!d.querySelector('#altScreen .mday-list'));
    click(d.querySelector('#moreBtn')); click(d.querySelector('.more-item[data-screen="contactos"]'));
    ok('Contactos: tabla editable + agregar', !!d.querySelector('#altScreen #cBody') && !!d.querySelector('#altScreen #cAdd'));
    click(d.querySelector('#moreBtn')); click(d.querySelector('.more-item[data-screen="auditoria"]'));
    ok('Auditoría: tabla de cambios', !!d.querySelector('#altScreen table.cmp-table'));
    click(d.querySelector('#moreBtn')); click(d.querySelector('.more-item[data-screen="gantt"]'));
    ok('vuelve a la Gantt (grid visible)', d.querySelector('#ganttScreen').style.display !== 'none' && d.querySelectorAll('#tb tr.row').length > 0);

    // 11) Selección múltiple + barra de acciones
    ok('botón Exportar presente', !!d.querySelector('#expGantt'));
    var chk = d.querySelector('#tb tr.row .rowchk');
    if (chk) { click(chk); ok('selección muestra barra en lote', d.querySelector('#bulkBar').style.display !== 'none' && !!d.querySelector('#bulkEnc')); click(d.querySelector('#bulkClear')); ok('limpiar oculta la barra', d.querySelector('#bulkBar').style.display === 'none'); }

    // 12) Command palette (⌘K)
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    ok('⌘K abre command palette', d.querySelector('#cmdk').style.display !== 'none');
    var ci = d.querySelector('#cmdkIn'); ci.value = 'cumpl'; ci.dispatchEvent(new w.Event('input', { bubbles: true }));
    ok('palette filtra (acción Cumplimiento)', [...d.querySelectorAll('#cmdkList .cmdk-item')].some(x => /Cumplimiento/.test(x.textContent)));
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok('Esc cierra palette', d.querySelector('#cmdk').style.display === 'none');

    ok('sin errores de runtime en las interacciones', errs.length === errBefore);
    ok('sin errores de runtime (global)', errs.length === 0);
  } catch (e) {
    errs.push('Excepción en el test: ' + e.message + '\n' + (e.stack || ''));
    ok('test sin excepción', false);
  }

  const fail = checks.filter(c => !c.cond);
  checks.forEach(c => console.log((c.cond ? 'OK   ' : 'FAIL ') + c.label));
  if (errs.length) { console.log('\nErrores capturados:'); errs.slice(0, 8).forEach(m => console.log('  · ' + m)); }
  console.log(fail.length ? `\n*** SMOKE TEST: ${fail.length} fallo(s) ***` : '\n*** SMOKE TEST OK ***');
  process.exit(fail.length ? 1 : 0);
}, 900);
