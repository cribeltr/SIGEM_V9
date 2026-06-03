# Inventario funcional — Gestión Equipos Críticos HHHA

Panorama completo de **todo** lo que hace el programa hoy (tras la revisión y
corrección de la Fase 2). El motor (`src/hhha-core.js`) concentra los datos y
las reglas; la interfaz (`ui/app.js`) solo presenta y opera sobre él.

## 0. Arquitectura y build
- **Fuente** → `src/seed-data.js` (semilla), `src/hhha-core.js` (motor, sin DOM),
  `ui/styles.css`, `ui/app.js` (vistas). `tools/build.js` inlina todo en
  `app.html` (navegador) y `apps-script/Index.html` (idéntico, para Apps Script).
- **Backend opcional**: `apps-script/Code.gs` (Web App de Google Sheets + Drive).
- **Persistencia**: `localStorage` (comprimido LZ) y, si se conecta, Google Sheet
  (estado oculto comprimido `_SIGEM_DATA` + hojas legibles regeneradas en cada sync).

## 1. Modelo de datos (`state`)
- **equipos[]**: `inv` (clave), `id` (correlativo estable), `equipo, fam, servicio,
  unidad, ubic, proc, marca, modelo, serie, ano, vur, clasif, freq, carpeta`,
  `estado` (desconocido/operativo/no_operativo/en_servicio_tecnico/baja),
  `estadoDesde`, `subestado`, `encargado`, `notas[]`,
  `prog{mes→código}` (programación anual), `registro{mes→{P,R}}` (gantt P/R),
  `adjuntos[]` (Drive).
- **eventos[]**: `id, inv, tipo, fecha, fechaReg, resultado, ejecutor, ejecutor2,
  estado, obs, oficial(Sí/No), anulado, motivoAnulacion, folio, nEnvio, nOC, nCotiz,
  empresa, tecnico, tipoVisita, via, folioInformeTD, repuestos, origen, adjuntos[], ts`.
- **ciclos[]** (correctivos): `id, folio, inv, fechaApertura, fechaCierre, estado
  (abierto/cerrado/anulado), ingenieroAsignado, motivoCierre`.
- **pendientes[]**: `id, inv, tipo, desc, ejecutor, estado (no_iniciado/en_proceso/
  cerrado), fechaCrea, fechaComp, proxRecord, fechaCierre, seguimientos[], tareas[],
  eventoOrigen, origen, anulado`.
- **tareas[]**: `id, pendId, inv, desc, estado`.
- **asignacionesMP{ "AAAA-MM" → {inv→ejecutor} }**: responsable de la MP por mes.
- **conflictos[]**: diferencias con el maestro (ver §6).
- **importaciones[]**, **contactos[]** (servicio/cargo/nombre/apellido/anexo/correo),
  **actividad[]** (telemetría heredada, ya no se alimenta), **audit[]** (historial de
  cambios), **prefs{}**, **counters{}**.

## 2. Catálogos y reglas fijas
- **MESES** Ene–Dic. **EJECUTORES** (11). **TIPOS_EVENTO**: Solicitud de trabajo,
  Visita técnica, Orden de Compra, Envío a servicio técnico, Recepción, Reparación,
  Mantención preventiva.
- **CAUSALES C1–C8** (cada una con descripción y si exige reprogramar a 30 días).
- **RESULTADOS_MP**: Si, C1–C8, FS, NU, Baja, No.
- **TIPO_PENDIENTE**: Documento faltante, Firma faltante, Reprogramación MP,
  Recomendación técnica, Pauta de Monitoreo Diario, Gestión general, Seguimiento.
- **CARGOS_CONTACTO**: Supervisor de Servicio Clínico, Encargado de Equipos, Jefe CCRR.
- **DOCS** esperados por evento correctivo y preventivo (para checklist de oficialización).

## 3. Máquina de estados (reglas de negocio del equipo)
- **Estado del equipo = se RECALCULA** desde los eventos (`recalcEstadoEquipo`):
  1) si hay MP con resultado **Baja** → `baja`;
  2) si no, el último evento que declara estado manda;
  3) una MP manda por su **resultado**: `Si`→operativo/no_operativo (lo elige quien
     registra); causal vía `MP_CAUSAL_ESTADO`: **C2**→en servicio técnico,
     **C3/FS/NU**→no operativo, **Baja**→baja; **C1/C4–C8** = reprogramación (no
     cambia estado); **No** = no realizada (no cambia estado);
  4) sin eventos, se infiere de la matriz; por defecto operativo.
- **Días en estado** y **última gestión** (fecha + texto) derivados.
- **MP del mes**: `ejecutada` (Si) / `reprogramada` (C1–C8) / `otro` (FS/NU/Baja/No) /
  `pendiente`; clase `oficial|borrador|reprog|otro|noreg`.

## 4. Operaciones (acciones que ejecuta el usuario)
**Mantención preventiva**
- `registrarMP` (MP rápida): valida ejecutor; avisa si el mes no estaba programado;
  nace **borrador**; aplica efectos; **fija el responsable del mes** = ejecutor.
- `corregirMP` (editar la MP del mes, p. ej. C6→C3): revierte efectos previos
  (R del mes, pendientes auto, marca R del mes siguiente), aplica los nuevos y
  recalcula; **no duplica**; fija responsable.
- **Antiduplicado**: registrar una MP sobre un mes que ya tiene una (incluido un
  borrador importado) **actualiza** esa, no crea otra.
- `registrarMPMasiva` (lote, con omisión de duplicados) · `consolidarMPDuplicadas`
  (deja una por equipo/mes) · `oficializarTodosBorradores`.
**Eventos / ciclos correctivos**
- `crearEvento` (Solicitud, Visita, OC, Envío, Recepción, Reparación, MP). Efectos
  (`aplicarEfectosEvento`): cambia estado; **Solicitud abre ciclo** y deja no operativo;
  **Reparación/Recepción/Visita correctiva con estado operativo cierra el ciclo**; MP
  causal C1–C8 genera **pendiente de reprogramación** (y marca "R" el mes siguiente);
  NU genera "Localizar equipo"; Baja pasa a baja.
- `oficializarEvento`, `editarEvento` (campos no críticos), **`anularEvento`** (motor
  de reversión: limpia R del mes, recalcula estado, anula/reabre ciclo y anula
  pendientes automáticos según corresponda).
**Pendientes**
- `crearPendiente`, `actualizarPendiente`, `cambiarEstadoPend`, `cerrarPendiente`
  (reabrir limpia `fechaCierre`), `anularPendiente`, `agregarSeguimiento`,
  `agregarTareaPendiente`/`toggleTarea` (al cerrar todas, ofrece cerrar el pendiente),
  `registrarGestionEquipo` (gestión + recordatorio).
- **Regla de los 3 días (UI)**: un pendiente sin avance ≥3 días sube al tope con
  "Recuérdale a X"; "Solicitar/Delegar/Resuelto" y recordatorio en lote por responsable.
**Equipo**
- `asignarEncargado`, `agregarNotaEquipo`, **`darDeBaja`** (evento Baja + marca el mes,
  limpia meses posteriores, **cierra ciclos abiertos**, cierra pendientes).
**Contactos del servicio**: alta/edición/baja, vinculados a un servicio (o generales).

## 5. Conciliación con el archivo maestro (Excel)
- `parsearMaestro` → hojas **PMP** (programación P) y **Registro_MP** (P y R).
- `compararMaestro`: detecta **equipo_nuevo**, **equipo_faltante** y **mp_diferencia**
  por celda; **auto-completa** lo vacío en el programa; si una R coincide con el
  maestro **oficializa** el borrador; si una R nueva del maestro no tiene evento, crea
  un **evento sintético**.
- `resolverConflicto` (por conflicto o en lote): **aceptar_maestro / manual** (escribe
  el valor; en R reemplaza —anula— los eventos que difieren y oficializa/crea el que
  coincide), **mantener_programa** (conserva la app y oficializa si coincide),
  **posponer**. equipo_nuevo→alta, equipo_faltante→baja.

## 6. Vistas (interfaz)
- **Inicio** (pantalla simple del día): bloque **Registrar** (botones directos de
  eventos + cargar maestro), **Pendientes** priorizados (regla de 3 días, acciones
  rápidas), **tarea de asignación del mes** y **aviso de pendientes sin delegar**.
- **Ficha de equipo** (3 pestañas): **Mantención** (matriz P/R/Responsable editable +
  observaciones), **Historial** (ciclo + pendientes + bitácora en línea de tiempo),
  **Archivos** (adjuntos Drive + notas + contactos del servicio). Cabecera con datos
  plegables, banner de estado/última gestión y avisos de conflicto.
- **Equipos** (tabla con filtros tipo Excel, selección múltiple, exportar),
  **Tablero** (kanban: por estado / pendientes / correctivos por etapa con
  estancamiento y "siguiente paso"), **Pendientes** (gestión completa con filtros),
  **Eventos/Bitácora**, **MP del mes** (asignación), **Cumplimiento** (por servicio /
  responsable / mes con tendencia), **Contactos**, **Panel de control** (consola densa
  de alertas, bajo demanda), **Configuración**.
- Barra superior minimalista: marca + **búsqueda global (⌘K)** + **Grabar** + menú
  "Más" + tema + configuración. Densidad/tema, atajos de teclado, command palette.

## 7. Sincronización, exportación e importación
- **Google Sheet** (`Code.gs`): `apiSave` (estado comprimido + hojas legibles),
  `apiRead`, Drive (subir/listar/eliminar adjuntos por equipo). Hojas regeneradas:
  Inicio, Inventario, Pendientes, Tareas, Tareas-Pendientes, Bitácora, Registro
  (por fecha de creación), Equipos en servicio técnico, Equipos no operativos,
  Contactos. Limpieza de hojas huérfanas (lista blanca, incluidas Actividad/Uso).
- **Excel** (libro multi-hoja) y exportes por vista (respetan el filtro).
- **Plantilla MP** (descargar/subir) · **Importar maestro** `.xlsx/.xlsm`.
- **Respaldo JSON** (descargar/importar; oculto cuando hay Sheet conectado).
- **Importación**: `importarBackup` (migración no destructiva; fusiona telemetría).

## 8. Grabación de sesión (a demanda)
- Botón **Grabar/Detener** en la barra. Mientras graba, registra **pantallas, clics,
  resultados/avisos y errores** de ejecución (no persiste en estado ni en el Sheet).
  Al **Detener** exporta un `.xlsx` (Resumen + Pasos con Δ de tiempo) para analizar lo
  realizado y detectar errores.

## 9. Invariantes garantizadas (verificadas en Fase 2)
1. `equipo.estado` siempre **== recalculado** desde sus eventos (determinista).
2. IDs de evento y de pendiente **únicos**.
3. **Ningún ciclo abierto** con el equipo operativo **ni en baja**.
4. MP con causal determinista (C2/C3/FS/NU/Baja) ⇒ `estado` coherente.
5. Pendiente **cerrado** ⇒ tiene `fechaCierre`; **reabierto** ⇒ se limpia.
6. **Una sola MP vigente** por equipo y mes tras consolidar.
7. Anulación **revierte** todos los efectos (R, estado, ciclo, pendientes auto).
