#!/usr/bin/env node
/****************************************************************************
 * SIGEM · Build de la app CLÁSICA completa (archivo único, offline).
 * --------------------------------------------------------------------------
 * Mientras se porta todo a la interfaz principal (Carta Gantt MP), la app
 * clásica completa (Tablero, Cumplimiento, Configuración/Sheets, conciliación,
 * etc.) se conserva y construye aquí, compartiendo el mismo estado/localStorage.
 *
 *   ui/styles.css · ui/vendor/lz-string.min.js · src/seed-data.js
 *   src/hhha-core.js · ui/vendor/xlsx.full.min.js · ui/app.js
 *
 * Salida:  app-clasico.html   → abrir directo en el navegador (file://)
 *
 * Uso:  node tools/build-clasico.js   (o)   npm run build:clasico
 ****************************************************************************/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const css  = read('ui/styles.css');
const lz   = read('ui/vendor/lz-string.min.js');
const seed = read('src/seed-data.js');
const core = read('src/hhha-core.js');
const xlsx = read('ui/vendor/xlsx.full.min.js');
const app  = read('ui/app.js');

function guard(name, code, tag) {
  if (new RegExp('</\\s*' + tag, 'i').test(code)) {
    throw new Error(`${name} contiene </${tag}> y rompería el HTML inline`);
  }
}
guard('styles.css', css, 'style');
[['lz-string', lz], ['seed-data', seed], ['hhha-core', core], ['xlsx', xlsx], ['app', app]]
  .forEach(([n, c]) => guard(n, c, 'script'));

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gestión Equipos Críticos HHHA · clásico</title>
<!-- ARCHIVO GENERADO por tools/build-clasico.js — no editar a mano.
  ui/styles.css · ui/vendor/lz-string.min.js · src/seed-data.js
  src/hhha-core.js · ui/vendor/xlsx.full.min.js · ui/app.js -->
<style>
${css}
</style>
<script>try{document.documentElement.setAttribute('data-theme',localStorage.getItem('sigem_theme')||'light')}catch(e){}</script>
</head>
<body>
<div id="root"></div>
<script>${lz}</script>
<script>${seed}</script>
<script>${core}</script>
<script>${xlsx}</script>
<script>${app}</script>
</body>
</html>
`;

const OUT = 'app-clasico.html';
fs.writeFileSync(path.join(ROOT, OUT), html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`Build clásico OK · ${kb} KB · ${html.split('\n').length} líneas → ${OUT}`);
