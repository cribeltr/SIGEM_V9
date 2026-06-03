#!/usr/bin/env node
/****************************************************************************
 * SIGEM · Build de archivo único — interfaz "Carta Gantt MP".
 * --------------------------------------------------------------------------
 * Ensambla el MISMO núcleo lógico (src/hhha-core.js + src/seed-data.js) con la
 * presentación de la Carta Gantt (ui/gantt.css + ui/gantt-app.js) en UN solo
 * HTML autocontenible y offline:
 *
 *   · gantt.html               → abrir directo en el navegador (file://)
 *
 * La FUENTE editable vive en ui/gantt.css y ui/gantt-app.js; este HTML es
 * derivado. Comparte el localStorage con app.html (mismo motor / STORAGE_KEY).
 *
 * Uso:  node tools/build-gantt.js   (o)   npm run build:gantt
 ****************************************************************************/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const css  = read('ui/gantt.css');
const lz   = read('ui/vendor/lz-string.min.js');
const seed = read('src/seed-data.js');
const core = read('src/hhha-core.js');
const xlsx = read('ui/vendor/xlsx.full.min.js');
const app  = read('ui/gantt-app.js');

// Seguridad: ningún fragmento inline puede contener </script> o </style>.
function guard(name, code, tag) {
  if (new RegExp('</\\s*' + tag, 'i').test(code)) {
    throw new Error(`${name} contiene </${tag}> y rompería el HTML inline`);
  }
}
guard('gantt.css', css, 'style');
[['lz-string', lz], ['seed-data', seed], ['hhha-core', core], ['xlsx', xlsx], ['gantt-app', app]]
  .forEach(([n, c]) => guard(n, c, 'script'));

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Carta Gantt MP · SIGEM</title>
<!-- =========================================================================
  SIGEM · Carta Gantt MP — build de archivo único (autocontenible, offline).
  ARCHIVO GENERADO por tools/build-gantt.js — no editar a mano.
  Mismo núcleo que app.html; distinta presentación (diseño Carta Gantt).
    ui/gantt.css · ui/vendor/lz-string.min.js · src/seed-data.js
    src/hhha-core.js · ui/vendor/xlsx.full.min.js · ui/gantt-app.js
========================================================================== -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Condensed:wght@600;700&display=swap" rel="stylesheet">
<style>
${css}
</style>
<script>try{document.documentElement.setAttribute('data-theme',localStorage.getItem('sigem_theme')||'light')}catch(e){}</script>
</head>
<body>
<!-- Compresión de persistencia (engine ENV.compressor) -->
<script>${lz}</script>
<!-- Datos semilla (window.SEED) -->
<script>${seed}</script>
<!-- Núcleo lógico SIN vistas (window.HHHA) -->
<script>${core}</script>
<!-- SheetJS: conciliación + export Excel (offline) -->
<script>${xlsx}</script>
<!-- Vista Carta Gantt MP -->
<script>${app}</script>
</body>
</html>
`;

const OUT = 'gantt.html';
fs.writeFileSync(path.join(ROOT, OUT), html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`Build Gantt OK · ${kb} KB · ${html.split('\n').length} líneas → ${OUT}`);
