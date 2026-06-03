# Gestión Equipos Críticos HHHA

Aplicación de gestión y control diario de equipos biomédicos críticos. **Archivo único, 100 % offline**, para el seguimiento de
mantenimiento preventivo (MP), eventos correctivos, pendientes y estado
operativo de equipos biomédicos. La lógica de negocio está desacoplada de la
interfaz y el almacenamiento es opcional en un **Google Sheet** (vía Apps Script).

```
SIGEM_V1/
├── src/                     FUENTE · núcleo lógico (sin DOM)
│   ├── hhha-core.js           Modelo, estado, persistencia, reglas de negocio, conciliación
│   ├── seed-data.js           Dataset semilla (window.SEED) — DATO, no lógica
│   └── README.md              Detalle del núcleo y mapa de la API HHHA.*
├── ui/                      FUENTE · capa de vistas (presentación)
│   ├── gantt-app.js           PRINCIPAL · vista Carta Gantt MP sobre el motor real
│   ├── gantt.css              PRINCIPAL · diseño de la Carta Gantt (claro/oscuro)
│   ├── gantt.html             Shell de desarrollo de la Carta Gantt
│   ├── app.js                 CLÁSICO · router, tablas, drawer, vistas (en migración)
│   ├── styles.css             CLÁSICO · sistema de diseño
│   ├── index.html             Shell de desarrollo de la app clásica
│   ├── vendor/                Dependencias vendorizadas (lz-string, SheetJS)
│   └── README.md              Detalle de la UI, vistas y atajos
├── tools/
│   ├── build.js               Genera app.html + apps-script/Index.html (Carta Gantt MP)
│   ├── build-clasico.js       Genera app-clasico.html (app clásica completa)
│   └── smoke-test.js          Smoke headless (jsdom); smoke-clasico.js para la clásica
├── apps-script/             DESPLIEGUE · backend opcional en Google Sheets
│   ├── Code.gs                Web App: guarda el estado y las hojas legibles
│   └── Index.html             GENERADO (Carta Gantt MP) — pegar en Apps Script
├── app.html                 GENERADO · interfaz PRINCIPAL (Carta Gantt MP)
├── app-clasico.html         GENERADO · app clásica completa (en migración)
└── package.json             npm run build · build:clasico · build:all
```

## Desarrollo

Edita siempre las **fuentes** en `src/` y `ui/` (nunca los `.html` generados).

- **Probar rápido:** abre `ui/index.html` en el navegador (`file://`, sin servidor).
  Carga los módulos por separado, ideal para iterar.

## Interfaz principal: "Carta Gantt MP" (app.html)

La interfaz **principal** es la **Carta Gantt MP** sobre el núcleo real
(`src/hhha-core.js`): la matriz anual de MP por equipo (familia × 12 meses) con
KPIs, filtros y panel lateral. Usa los datos reales (estado recalculado,
`prog`/`registro`) y expone las funciones del programa:

- clic en una celda **registra/corrige la MP** (Si/C1–C8/FS/NU/Baja) con recálculo;
- el panel del equipo da acceso a bitácora (oficializar/anular/editar), pendientes,
  ciclos, baja, encargado, notas y gestión, y a **Nuevo evento** con los campos por
  tipo (Solicitud/Visita/OC/Envío/Recepción/Reparación/MP);
- **Configuración** (⚙): sincronización con **Google Sheets** (Apps Script y HTTP),
  respaldo JSON y mantenimiento de datos.

Fuentes editables: `ui/gantt.css` y `ui/gantt-app.js` (dev: `ui/gantt.html`).

`app.html` y `apps-script/Index.html` son **artefactos generados** (dos copias
idénticas) que inlinean todas las fuentes en un HTML autocontenible y offline.

```bash
npm run build         # genera app.html + apps-script/Index.html (Carta Gantt MP)
npm test              # smoke test headless (jsdom) de app.html
```

### App clásica completa (app-clasico.html) — en migración

Mientras se porta todo a la interfaz principal, la **app clásica** completa
(Tablero, Cumplimiento, conciliación de maestro, etc.) se conserva y comparte el
mismo estado/`localStorage`. Fuentes: `ui/styles.css` y `ui/app.js` (dev:
`ui/index.html`).

```bash
npm run build:clasico # genera app-clasico.html
npm run test:clasico  # smoke test de app-clasico.html
npm run build:all     # genera ambas interfaces
```

> Migración por fases hacia la Gantt: **Fase 1 (hecha)** Configuración +
> sincronización Google Sheets. **Fase 2** importar maestro `.xlsx` + conciliación
> + plantilla MP. **Fase 3** Tablero (kanban) y Cumplimiento. Hasta completarlas,
> esas funciones siguen disponibles en `app-clasico.html`.

## Despliegue (Google Sheets · opcional)

La app funciona sola en el navegador. Para guardar los datos en un Google Sheet
y poder verla desde la URL `.../exec`:

1. En el Google Sheet: **Extensiones → Apps Script**.
2. Pega `apps-script/Code.gs` en el archivo de código.
3. Crea un archivo HTML llamado **`Index`** y pega el contenido de
   `apps-script/Index.html` (ejecuta antes `npm run build`).
4. **Implementar → Nueva implementación → Aplicación web** (ejecutar como *Yo*,
   acceso *Cualquiera*). Copia la URL `.../exec` y pégala en **SIGEM → Configuración**.
5. Tras cada cambio de código: **Gestionar implementaciones → editar → Nueva versión**.

El estado se guarda comprimido en hojas ocultas (`_SIGEM_DATA`/`_SIGEM_META`) y,
en paralelo, en **hojas de trabajo legibles** (Inventario, Plan anual MP,
Pendientes, Bitácora, Correctivos…) para usar el archivo aunque no se tenga la app.

## Datos y respaldo

- **Respaldo principal:** el propio Google Sheet (se guarda en cada cambio).
- **Respaldo de emergencia:** export/import JSON desde **Configuración**.
- Sin backend, los datos persisten en `localStorage` (comprimidos con LZString).

Más detalle: [`src/README.md`](src/README.md) (núcleo y API) · [`ui/README.md`](ui/README.md) (vistas y atajos).
