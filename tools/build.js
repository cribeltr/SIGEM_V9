#!/usr/bin/env node
/****************************************************************************
 * SIGEM · Build principal (archivo único, autocontenible, offline).
 * --------------------------------------------------------------------------
 * Interfaz PRINCIPAL = "Carta Gantt MP" sobre el núcleo real. Ensambla:
 *
 *   ui/gantt.css · ui/vendor/lz-string.min.js · src/seed-data.js
 *   src/hhha-core.js · ui/vendor/xlsx.full.min.js · ui/gantt-app.js
 *
 * Escribe DOS copias idénticas (así nunca se desincronizan):
 *   · app.html                 → abrir directo en el navegador (file://)
 *   · apps-script/Index.html   → pegar en Apps Script (Web App, doGet sirve Index)
 *
 * La fuente editable vive en ui/gantt.css y ui/gantt-app.js; el HTML es derivado.
 * La app clásica completa se construye aparte con tools/build-clasico.js.
 *
 * Uso:  node tools/build.js     (o)     npm run build
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
<title>SIGEM · Carta Gantt MP</title>
<!-- =========================================================================
  SIGEM · build principal (Carta Gantt MP, autocontenible, offline).
  ARCHIVO GENERADO por tools/build.js — no editar a mano.
  Ensamblado a partir de los módulos del repo (sin reescribir lógica):
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
<!-- Vista Carta Gantt MP (interfaz principal) -->
<script>${app}</script>
</body>
</html>
`;

// Escribe los dos artefactos en una sola pasada → imposible que diverjan.
const OUTPUTS = ['app.html', 'apps-script/Index.html'];
OUTPUTS.forEach(rel => fs.writeFileSync(path.join(ROOT, rel), html));

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`Build OK · ${kb} KB · ${html.split('\n').length} líneas → ${OUTPUTS.join(' , ')}`);
