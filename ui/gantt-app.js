'use strict';
/*****************************************************************************
 * SIGEM · Carta Gantt MP — capa de vistas sobre el NÚCLEO REAL (window.HHHA).
 * ---------------------------------------------------------------------------
 * Toma el diseño "Carta Gantt 2026" como base y le conecta las funciones del
 * programa. NO reimplementa lógica de negocio: todo pasa por la API HHHA.*
 *   · Filas/celdas/estados/KPIs salen de los datos reales (prog/registro,
 *     estado recalculado por el motor).
 *   · Clic en una celda de mes  → registra/corrige la MP real (Si/C1–C8/FS/
 *     NU/Baja/No) con recálculo de estado.
 *   · El panel lateral del equipo expone: calendario MP editable, bitácora
 *     (oficializar/anular), pendientes, ciclos, dar de baja, encargado, notas
 *     y gestión.
 *   · Persistencia: la del motor (localStorage, compartido con app.html).
 *****************************************************************************/
(function () {
  var H = window.HHHA;
  if (!H || typeof H.getState !== 'function') {
    document.body.innerHTML = '<p style="font-family:sans-serif;padding:24px">No se cargó el núcleo HHHA (revisa el orden de carga de los scripts).</p>';
    return;
  }

  /* ----------------------------- arranque ------------------------------- */
  var ready = false, cloudApplying = false, cloudTimer = null;

  /* --------- sincronización con Google Sheets (portado de la app clásica) --------- */
  function isGAS() { try { return !!(typeof google !== 'undefined' && google.script && google.script.run); } catch (e) { return false; } }
  function gasCall(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      var r = google.script.run.withSuccessHandler(resolve).withFailureHandler(function (e) { reject(new Error((e && e.message) || String(e))); });
      r[fn].apply(r, args);
    });
  }
  function chkOk(j) { if (!j || !j.ok) throw new Error((j && j.error) || 'sin ok'); return j; }
  var Cloud = {
    get url() { return localStorage.getItem('sigem_gs_url') || ''; },
    get token() { return localStorage.getItem('sigem_gs_token') || ''; },
    get gas() { return isGAS(); },
    get connected() { return isGAS() || !!this.url; },
    get auto() { return isGAS() ? localStorage.getItem('sigem_gs_auto') !== '0' : localStorage.getItem('sigem_gs_auto') === '1'; },
    get lastSync() { return localStorage.getItem('sigem_gs_last') || ''; },
    set: function (url, token, auto) { localStorage.setItem('sigem_gs_url', (url || '').trim()); localStorage.setItem('sigem_gs_token', (token || '').trim()); localStorage.setItem('sigem_gs_auto', auto ? '1' : '0'); },
    _markSync: function () { localStorage.setItem('sigem_gs_last', new Date().toISOString()); },
    _getUrl: function () { return this.url + (this.url.indexOf('?') >= 0 ? '&' : '?') + 'api=read&token=' + encodeURIComponent(this.token); },
    test: function () {
      if (isGAS()) return gasCall('apiRead').then(chkOk);
      return fetch(this._getUrl(), { redirect: 'follow' }).then(function (r) { return r.json(); }).then(chkOk);
    },
    pull: function () {
      if (!window.LZString) return Promise.reject(new Error('LZString no disponible'));
      var self = this;
      var got = isGAS() ? gasCall('apiRead') : fetch(this._getUrl(), { redirect: 'follow' }).then(function (r) { return r.json(); });
      return got.then(function (j) {
        if (!j.ok) throw new Error(j.error || 'respuesta inválida');
        if (!j.dataB64) return { empty: true };
        var obj = JSON.parse(window.LZString.decompressFromBase64(j.dataB64));
        cloudApplying = true;
        try { var r = H.importarBackup(obj); if (!r.ok) throw new Error(r.error); } finally { cloudApplying = false; }
        self._markSync();
        return { ok: true, eventos: (obj.eventos || []).length, equipos: (obj.equipos || []).length };
      });
    },
    push: function () {
      if (!window.LZString) return Promise.resolve();
      var self = this, dataB64 = window.LZString.compressToBase64(H.exportarBackupJSON());
      var done = function (j) { if (j && j.ok === false) throw new Error(j.error || 'error al guardar'); self._markSync(); return { ok: true }; };
      // Fase 1: se sincroniza el ESTADO (dataB64). Las hojas legibles del libro se
      // regeneran en una fase próxima; al omitir 'sheets', Code.gs las deja intactas.
      if (isGAS()) return gasCall('apiSave', { dataB64: dataB64 }).then(done);
      if (!this.url) return Promise.resolve();
      return fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: this.token, dataB64: dataB64 }), redirect: 'follow' }).then(function (r) { return r.json().catch(function () { return { ok: true }; }); }).then(done);
    }
  };
  function scheduleCloudPush() {
    if (!Cloud.auto || !Cloud.connected || cloudApplying) return;
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(function () { Cloud.push().then(refreshCloudChip).catch(function (e) { toast('Google Sheets: ' + e.message, 'warn'); }); }, 5000);
  }
  function refreshCloudChip() { var b = el('#cfgBtn'); if (b) { b.style.color = Cloud.connected ? 'var(--op)' : ''; b.title = Cloud.connected ? ('Sheets · últ. sync: ' + (Cloud.lastSync ? new Date(Cloud.lastSync).toLocaleString('es-CL') : '—')) : 'Configuración / Google Sheets'; } }

  H.setSeed(window.SEED || null);
  H.configure({
    ui: {
      notify: function (m, t) { toast(m, /error|warn/.test(t || '') ? 'warn' : ''); },
      confirm: function (m) { return window.confirm(m); },
      prompt: function (m, d) { return window.prompt(m, d || ''); },
      alert: function (m) { window.alert(m); },
      onChange: function () { scheduleRender(); scheduleCloudPush(); }
    },
    env: { xlsx: window.XLSX || null }
  });
  H.bootstrapDatos();

  /* ----------------------------- catálogos ------------------------------ */
  var MES = H.MESES;                       // ['Ene'..'Dic']
  var MES_FULL = H.MES_ESPANOL || {};      // {Ene:'Enero',...}
  var EJEC = H.EJECUTORES || [];
  var RES_MP = ['Si', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'FS', 'NU', 'Baja', 'No'];
  var TIPOS_EV = (H.TIPOS_EVENTO || []).map(function (t) { return t.label; });
  var TIPO_PEND = H.TIPO_PENDIENTE || {};
  var PEND_LABEL = H.ESTADO_PEND_LABEL || { no_iniciado: 'No iniciado', en_proceso: 'En proceso', cerrado: 'Resuelto' };
  var ESTADO_LABEL = H.ESTADO_LABEL || {};
  var CAUSALES = H.CAUSALES || {};
  var nowD = new Date();
  var YEAR = nowD.getFullYear();
  var NOW = nowD.getMonth();

  // estado real → tokens del diseño base
  var STMAP = {
    operativo:           { cls: 'op',    c: '--op',    bg: '--op-bg',    ic: '✓', s: 'Sin alertas registradas' },
    no_operativo:        { cls: 'alert', c: '--alert', bg: '--alert-bg', ic: '✕', s: 'Equipo fuera de servicio' },
    en_servicio_tecnico: { cls: 'warn',  c: '--warn',  bg: '--warn-bg',  ic: '!',      s: 'Gestión técnica en curso' },
    baja:                { cls: 'baja',  c: '--baja',  bg: '--baja-bg',  ic: '—', s: 'Equipo dado de baja' },
    desconocido:         { cls: 'traz',  c: '--traz',  bg: '--traz-bg',  ic: '≈', s: 'Sin información de estado' }
  };
  function stOf(e) { return STMAP[e.estado] || STMAP.desconocido; }
  function stLabel(e) { return ESTADO_LABEL[e.estado] || 'Desconocido'; }

  // campos por tipo de evento (réplica del formulario clásico ui/app.js)
  var EV_SPEC = {
    'Solicitud de trabajo': { obs: 'Descripción de la falla', notice: 'Abre un ciclo correctivo y deja el equipo "no operativo".', fields: [['ejecutor', 'Ejecutor', 'ejec'], ['folio', 'N° Informe / Folio', 'text']] },
    'Visita técnica': { obs: 'Informe', fields: [['empresa', 'Empresa', 'text'], ['tecnico', 'Técnico', 'text'], ['tipoVisita', 'Tipo visita', ['diagnóstica:Diagnóstica', 'correctiva:Correctiva']], ['folio', 'N° Informe / Folio', 'text'], ['estado', 'Estado', ['no operativo:No operativo', 'operativo:Operativo', 'en servicio técnico:En servicio técnico']]] },
    'Orden de Compra': { fields: [['nCotiz', 'N° Cotización', 'text'], ['nOC', 'N° OC', 'text'], ['empresa', 'Empresa', 'text'], ['via', 'Vía', ['trato_directo:Trato directo', 'compra_agil:Compra ágil']], ['folioInformeTD', 'Folio informe (TD)', 'text'], ['folio', 'N° Informe / Folio', 'text']] },
    'Envío a servicio técnico': { notice: 'El equipo queda "en servicio técnico".', fields: [['empresa', 'Empresa ST', 'text'], ['nEnvio', 'N° Envío', 'text'], ['ejecutor', 'Ejecutor', 'ejec'], ['folio', 'N° Informe / Folio', 'text']] },
    'Recepción': { fields: [['nEnvio', 'N° envío original', 'text'], ['folioGuia', 'Folio guía despacho', 'text'], ['folio', 'N° Informe / Folio', 'text'], ['estado', 'Estado', ['operativo:Operativo (cierra ciclo)', 'no operativo:No operativo', 'en servicio técnico:En servicio técnico']]] },
    'Reparación': { fields: [['folio', 'N° Informe / Folio', 'text'], ['estado', 'Estado', ['operativo:Operativo (cierra ciclo)', 'no operativo:No operativo', 'en servicio técnico:En servicio técnico']], ['repuestos', 'Repuestos', 'text']] },
    'Mantención preventiva': { obs: 'Observación', notice: 'C1–C8 → pendiente de reprogramación · NU → "Localizar equipo" · Baja → equipo a baja.', fields: [['resultado', 'Resultado', RES_MP], ['mpEstadoSi', 'Estado (si "Si")', ['operativo:Operativo', 'no operativo:No operativo']], ['ejecutor', 'Ejecutor', 'ejec'], ['ejecutor2', 'Ejecutor 2', 'ejec']] }
  };
  // campos extra editables al EDITAR un evento existente (no tocan estado/resultado)
  var EXTRA_FIELDS = {
    'Solicitud de trabajo': [['folio', 'N° Informe / Folio']],
    'Visita técnica': [['empresa', 'Empresa'], ['tecnico', 'Técnico'], ['folio', 'N° Informe / Folio']],
    'Orden de Compra': [['nCotiz', 'N° Cotización'], ['nOC', 'N° OC'], ['empresa', 'Empresa'], ['folioInformeTD', 'Folio informe (TD)'], ['folio', 'N° Informe / Folio']],
    'Envío a servicio técnico': [['empresa', 'Empresa ST'], ['nEnvio', 'N° Envío'], ['folio', 'N° Informe / Folio']],
    'Recepción': [['nEnvio', 'N° envío original'], ['folioGuia', 'Folio guía despacho'], ['folio', 'N° Informe / Folio']],
    'Reparación': [['repuestos', 'Repuestos'], ['folio', 'N° Informe / Folio']]
  };

  /* ----------------------------- utilidades ----------------------------- */
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function norm(s) { return (s == null ? '' : String(s)).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function el(sel) { return document.querySelector(sel); }
  function fmt(f) { return f ? H.fmtFecha(f) : ''; }
  function eqs() { return H.getState().equipos || []; }
  function opt(list, sel) { return list.map(function (v) { var a = Array.isArray(v) ? v : [v, v]; return '<option value="' + esc(a[0]) + '"' + (String(a[0]) === String(sel) ? ' selected' : '') + '>' + esc(a[1]) + '</option>'; }).join(''); }

  /* --------------------------- esqueleto base --------------------------- */
  document.body.innerHTML = skeleton();
  var tb = el('#tb'), thRow = el('#thRow'), kpisEl = el('#kpis'), countN = el('#countN'),
      drawer = el('#drawer'), scrim = el('#scrim'), legend = el('#legend'), emptyEl = el('#empty');

  // cabecera de la tabla (meses + sumas)
  var thHtml = '<th class="lead c-eq">Equipo</th><th class="lead c-srv">Servicio · Unidad</th>';
  MES.forEach(function (m, i) { thHtml += '<th class="mth' + (i === NOW ? ' now' : '') + '">' + m + '</th>'; });
  thHtml += '<th class="sum" title="MP programadas en el año">PMP</th><th class="sum" title="MP realizadas (Si)">MP-R</th>';
  thRow.innerHTML = thHtml;

  /* --------------------------- estado de la UI -------------------------- */
  var filt = { q: '', fam: '', estado: '', frec: '' };
  var collapsed = {}, allCollapsed = false;
  var drawerMode = null, curInv = null;
  var screen = 'gantt';
  var tbMode = 'estado', cmpMode = 'servicio', cmpY = null, cmpM = null;

  // poblar selects
  el('#fFam').innerHTML = '<option value="">Todas las familias</option>' + uniqueFams().map(function (f) { return '<option>' + esc(f) + '</option>'; }).join('');
  el('#fEstado').innerHTML = '<option value="">Todos los estados</option>' + ['operativo', 'no_operativo', 'en_servicio_tecnico', 'baja', 'desconocido'].map(function (k) { return '<option value="' + k + '">' + esc(ESTADO_LABEL[k] || k) + '</option>'; }).join('');
  el('#fFrec').innerHTML = '<option value="">Toda frecuencia</option>' + uniqueFreqs().map(function (f) { return '<option>' + esc(f) + '</option>'; }).join('');
  el('#fYear').innerHTML = [YEAR + 1, YEAR, YEAR - 1, YEAR - 2].map(function (y) { return '<option' + (y === YEAR ? ' selected' : '') + '>' + y + '</option>'; }).join('');
  el('#yearLab').textContent = YEAR;

  function uniqueFams() { var s = {}; eqs().forEach(function (e) { if (e.fam) s[e.fam] = 1; }); return Object.keys(s).sort(function (a, b) { return a.localeCompare(b, 'es'); }); }
  function uniqueFreqs() { var s = {}; eqs().forEach(function (e) { if (e.freq) s[e.freq] = 1; }); return Object.keys(s).sort(function (a, b) { return a.localeCompare(b, 'es'); }); }

  /* ------------------------------ datos MP ------------------------------ */
  // info de una celda mes: {txt, cls, tip}  (cls: X|R|P|N|'')
  function cellInfo(e, i) {
    var res = H.resultadoMPMes(e, YEAR, i);
    var prog = (e.prog || {})[MES[i]];
    var programmed = prog && ['X', 'R', 'RA', 'PM'].indexOf(prog) >= 0;
    var when = (MES_FULL[MES[i]] || MES[i]) + ' ' + YEAR;
    if (res === 'Si') return { txt: 'R', cls: 'R', tip: when + ' · MP realizada' };
    if (/^C[1-8]$/.test(res || '')) return { txt: res, cls: 'P', tip: when + ' · Reprogramada (' + res + ')' + (CAUSALES[res] ? ' · ' + CAUSALES[res].desc : '') };
    if (res) return { txt: res, cls: 'N', tip: when + ' · ' + res };
    if (programmed) return { txt: 'X', cls: 'X', tip: when + ' · MP programada' };
    return { txt: '', cls: '', tip: '' };
  }
  function mpCounts(e) {
    var prog = 0, done = 0, next = -1;
    for (var i = 0; i < 12; i++) {
      if (H.mpProgramadaEnMes(e, MES[i])) { prog++; if (next < 0 && i >= NOW && H.resultadoMPMes(e, YEAR, i) !== 'Si') next = i; }
      if (H.resultadoMPMes(e, YEAR, i) === 'Si') done++;
    }
    return { prog: prog, done: done, next: next };
  }

  function matches(e) {
    if (filt.fam && e.fam !== filt.fam) return false;
    if (filt.estado && e.estado !== filt.estado) return false;
    if (filt.frec && norm(e.freq).indexOf(norm(filt.frec)) < 0) return false;
    if (filt.q) { var q = norm(filt.q); if (norm([e.inv, e.equipo, e.marca, e.modelo, e.serie, e.servicio, e.unidad, e.ubic].join(' ')).indexOf(q) < 0) return false; }
    return true;
  }

  /* ------------------------------- render ------------------------------- */
  function render() { renderKpis(); renderGrid(); refreshConfChip(); }
  var rafT = null;
  function scheduleRender() {
    if (!ready) return;
    clearTimeout(rafT);
    rafT = setTimeout(function () {
      render();
      if (drawer.classList.contains('on') && drawerMode === 'equipo' && curInv) { var e = H.findEquipo(curInv); if (e) paintEquipo(e); else closeDrawer(); }
    }, 30);
  }

  function renderKpis() {
    var list = eqs(), prog = 0, done = 0, alert = 0, mesN = 0;
    list.forEach(function (e) {
      var c = mpCounts(e); prog += c.prog; done += c.done;
      if (['no_operativo', 'en_servicio_tecnico', 'baja'].indexOf(e.estado) >= 0) alert++;
      if (H.mpProgramadaEnMes(e, MES[NOW]) || H.resultadoMPMes(e, YEAR, NOW)) mesN++;
    });
    var pct = prog ? Math.round(done / prog * 100) : 0;
    kpisEl.innerHTML =
      kpi('Equipos críticos', list.length, uniqueFams().length + ' familias') +
      kpi('MP del año ' + YEAR, prog, done + ' realizadas (R)', pct) +
      kpi('<span class="dot" style="background:var(--alert)"></span>Con alerta', alert, 'no operativos · ST · baja', null, '--alert') +
      kpi('<span class="dot" style="background:var(--now)"></span>' + (MES_FULL[MES[NOW]] || MES[NOW]), mesN, 'MP de este mes', null, '--accent');
  }
  function kpi(lab, val, sub, pct, valColor) {
    return '<div class="kpi"><div class="k-lab">' + lab + '</div>' +
      '<div class="k-val"' + (valColor ? ' style="color:var(' + valColor + ')"' : '') + '>' + val + '</div>' +
      '<div class="k-sub">' + esc(sub) + '</div>' +
      (pct != null ? '<div class="k-bar"><i style="width:' + pct + '%"></i></div>' : '') + '</div>';
  }

  function renderGrid() {
    var list = eqs().filter(matches);
    countN.textContent = list.length;
    var groups = {};
    list.forEach(function (e) { var f = e.fam || 'Sin familia'; (groups[f] = groups[f] || []).push(e); });
    var order = Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, 'es'); });
    var html = '';
    order.forEach(function (fam) {
      var rows = groups[fam], prog = 0, done = 0;
      rows.forEach(function (e) { var c = mpCounts(e); prog += c.prog; done += c.done; });
      var pct = prog ? Math.round(done / prog * 100) : 0;
      var isC = !!collapsed[fam];
      html += '<tr class="grp' + (isC ? ' collapsed' : '') + '" data-fam="' + esc(fam) + '"><td colspan="16"><div class="grp-in">' +
        '<span class="grp-tw">▾</span><span class="grp-name">' + esc(fam) + '</span><span class="grp-badge">' + rows.length + '</span>' +
        '<span class="grp-prog"><span>' + done + '/' + prog + ' MP-R</span><span class="gbar"><i style="width:' + pct + '%"></i></span><span>' + pct + '%</span></span></div></td></tr>';
      if (isC) return;
      rows.forEach(function (e) {
        var st = stOf(e), c = mpCounts(e), cells = '';
        for (var i = 0; i < 12; i++) {
          var ci = cellInfo(e, i);
          cells += '<td class="mcell' + (i === NOW ? ' now' : '') + '" data-mo="' + i + '" title="' + esc(ci.tip) + '">' + (ci.txt ? '<span class="mk ' + ci.cls + '">' + esc(ci.txt) + '</span>' : '') + '</td>';
        }
        var srv = e.servicio ? '<span class="srv-name">' + esc(e.servicio) + '</span>' : '<span class="srv-name" style="color:var(--faint)">—</span>';
        var sub = (e.unidad || e.ubic) ? '<span class="srv-sub">' + esc(e.unidad || e.ubic) + '</span>' : '';
        html += '<tr class="row" data-inv="' + esc(e.inv) + '">' +
          '<td class="c-eq"><div class="eq-cell"><span class="eq-dot" style="background:var(' + st.c + ')"></span><div class="eq-meta">' +
          '<div class="eq-name">' + esc(e.equipo || '—') + '</div><div class="eq-sub">' + esc(e.inv || 's/inv') + (e.marca ? ' · ' + esc(e.marca) : '') + '</div></div></div></td>' +
          '<td class="c-srv">' + srv + sub + '</td>' + cells +
          '<td class="sum' + (c.prog ? '' : ' z') + '">' + (c.prog || '·') + '</td><td class="sum' + (c.done ? '' : ' z') + '">' + (c.done || '·') + '</td></tr>';
      });
    });
    tb.innerHTML = html;
    emptyEl.style.display = list.length ? 'none' : 'block';
    if (curInv) selectRow(curInv);
  }

  /* ------------------------------- drawer ------------------------------- */
  function openDrawer() { drawer.classList.add('on'); scrim.classList.add('on'); drawer.setAttribute('aria-hidden', 'false'); }
  function closeDrawer() { drawer.classList.remove('on'); scrim.classList.remove('on'); drawer.setAttribute('aria-hidden', 'true'); drawerMode = null; curInv = null; clearSel(); }
  function clearSel() { var s = tb.querySelectorAll('tr.row.sel'); for (var i = 0; i < s.length; i++) s[i].classList.remove('sel'); }
  function selectRow(inv) { clearSel(); var rows = tb.querySelectorAll('tr.row'); for (var i = 0; i < rows.length; i++) if (rows[i].getAttribute('data-inv') === inv) { rows[i].classList.add('sel'); break; } }

  // ---- ficha del equipo (overview) ----
  function paintEquipo(e) {
    curInv = e.inv; drawerMode = 'equipo';
    var st = stOf(e), c = mpCounts(e), ug = H.ultimaGestion(e.inv), dias = H.diasEnEstado(e), enc = H.encargadoDe(e);
    var sbSub = (e.estado !== 'operativo' && dias ? 'hace ' + dias + ' día' + (dias === 1 ? '' : 's') + ' · ' : '') + (ug ? 'últ.: ' + esc(ug.texto) + ' (' + fmt(ug.fecha) + ')' : st.s);

    // calendario MP
    var cal = '';
    for (var k = 0; k < 12; k++) {
      var ci = cellInfo(e, k), cls = ci.cls === 'R' ? 'r' : ci.cls === 'X' ? 'x' : ci.cls === 'P' ? 'p' : ci.cls === 'N' ? 'n' : '';
      cal += '<div class="mpc ' + cls + (k === NOW ? ' nowm' : '') + '" data-mo="' + k + '" title="' + esc(ci.tip) + '"><div class="mn">' + MES[k] + '</div><div class="mi">' + (ci.txt || '·') + '</div></div>';
    }
    var nextTxt = c.next >= 0 ? (MES_FULL[MES[c.next]] || MES[c.next]) + ' ' + YEAR : 'sin MP pendiente';

    // bitácora
    var evs = H.eventosDe(e.inv).filter(function (x) { return !x.anulado; }).sort(function (a, b) { return (b.fecha || '').localeCompare(a.fecha || '') || (b.id - a.id); });
    var evHtml = evs.length ? evs.slice(0, 40).map(function (ev) {
      var badge = ev.tipo === 'Mantención preventiva' ? (ev.oficial === 'Sí' ? '<span class="tag-ofic">oficial</span>' : '<span class="tag-borr">borrador</span>') : '';
      var bits = []; if (ev.resultado) bits.push(ev.resultado); if (ev.estado) bits.push(ESTADO_LABEL[normEstado(ev.estado)] || ev.estado); if (ev.ejecutor) bits.push(ev.ejecutor); if (ev.folio) bits.push('Folio ' + ev.folio);
      var acts = '<button class="mini" data-act="edit-ev" data-id="' + ev.id + '">Editar</button>';
      if (ev.tipo === 'Mantención preventiva' && ev.oficial !== 'Sí') acts += '<button class="mini" data-act="oficializar" data-id="' + ev.id + '">Oficializar</button>';
      acts += '<button class="mini danger" data-act="anular" data-id="' + ev.id + '">Anular</button>';
      return '<div class="tl-item"><div class="tl-when">' + fmt(ev.fecha) + '</div><div class="tl-main"><div class="tl-t">' + esc(ev.tipo) + ' ' + badge + '</div><div class="tl-s">' + esc(bits.join(' · ')) + (ev.obs ? ' — ' + esc(ev.obs) : '') + '</div></div><div class="tl-acts">' + acts + '</div></div>';
    }).join('') : '<div class="sec-empty">Sin eventos registrados.</div>';

    // pendientes
    var pends = H.pendientesDe(e.inv).filter(function (p) { return !p.anulado; }).sort(function (a, b) { return (a.estado === 'cerrado') - (b.estado === 'cerrado') || (b.id - a.id); });
    var pendHtml = pends.length ? pends.map(function (p) {
      var spillCls = p.estado === 'cerrado' ? 'op' : p.estado === 'en_proceso' ? 'warn' : 'alert';
      var acts = '';
      if (p.estado !== 'cerrado') {
        acts += '<button class="mini" data-act="pend-avanzar" data-id="' + p.id + '">' + (p.estado === 'no_iniciado' ? 'Iniciar' : 'Avanzar') + '</button>';
        acts += '<button class="mini" data-act="pend-cerrar" data-id="' + p.id + '">Resolver</button>';
      } else { acts += '<button class="mini" data-act="pend-reabrir" data-id="' + p.id + '">Reabrir</button>'; }
      return '<div class="tl-item"><div class="tl-main"><div class="tl-t">' + esc(TIPO_PEND[p.tipo] || p.tipo) + ' <span class="spill ' + spillCls + '">' + esc(PEND_LABEL[p.estado] || p.estado) + '</span></div><div class="tl-s">' + esc(p.desc || '') + (p.ejecutor ? ' · ' + esc(p.ejecutor) : '') + '</div></div><div class="tl-acts">' + acts + '</div></div>';
    }).join('') : '<div class="sec-empty">Sin pendientes.</div>';

    // ciclos
    var cics = H.ciclosDe(e.inv).slice().sort(function (a, b) { return (b.fechaApertura || '').localeCompare(a.fechaApertura || ''); });
    var cicHtml = cics.length ? cics.map(function (ci) {
      var spillCls = ci.estado === 'abierto' ? 'alert' : ci.estado === 'anulado' ? 'baja' : 'op';
      var acts = ci.estado === 'abierto' ? '<button class="mini" data-act="ciclo-cerrar" data-folio="' + esc(ci.folio || '') + '" data-id="' + ci.id + '">Cerrar</button>' : '';
      return '<div class="tl-item"><div class="tl-when">' + fmt(ci.fechaApertura) + '</div><div class="tl-main"><div class="tl-t">Ciclo ' + esc(ci.folio || '#' + ci.id) + ' <span class="spill ' + spillCls + '">' + esc(ci.estado) + '</span></div><div class="tl-s">' + (ci.ingenieroAsignado ? esc(ci.ingenieroAsignado) + ' · ' : '') + (ci.fechaCierre ? 'cerrado ' + fmt(ci.fechaCierre) : 'abierto') + '</div></div><div class="tl-acts">' + acts + '</div></div>';
    }).join('') : '<div class="sec-empty">Sin ciclos correctivos.</div>';

    // notas
    var notas = H.notasDe(e);
    var notasHtml = notas.length ? notas.slice().reverse().map(function (n) {
      return '<div class="chip hist"><span class="ic">✎</span><div class="ct"><div>' + esc(n.texto) + '</div><div class="cd">' + esc(n.autor || '') + ' · ' + fmt(n.fecha) + '</div></div></div>';
    }).join('') : '<div class="sec-empty">Sin notas.</div>';

    drawer.innerHTML =
      '<div class="d-head"><button class="d-close" data-act="close">✕</button>' +
      '<div class="d-fam">' + esc(e.fam || '') + '</div><div class="d-name">' + esc(e.equipo || 'Equipo') + '</div>' +
      '<div class="d-mm">' + esc([e.marca, e.modelo].filter(Boolean).join(' ')) + '</div>' +
      '<div class="d-codes"><span class="code"><b>Inv </b>' + esc(e.inv || '—') + '</span>' + (e.serie ? '<span class="code"><b>Serie </b>' + esc(e.serie) + '</span>' : '') + (e.clasif ? '<span class="code"><b>Clasif </b>' + esc(e.clasif) + '</span>' : '') + (e.ano ? '<span class="code"><b>Año </b>' + esc(e.ano) + '</span>' : '') + '</div></div>' +
      '<div class="d-body">' +
        '<div class="state-banner" style="background:var(' + st.bg + ');border-color:color-mix(in srgb,var(' + st.c + ') 35%,transparent)">' +
          '<div class="sb-ic" style="background:var(' + st.c + ')">' + st.ic + '</div>' +
          '<div><div class="sb-t" style="color:var(' + st.c + ')">' + esc(stLabel(e)) + '</div><div class="sb-s">' + sbSub + '</div></div></div>' +
        '<div class="dacts">' +
          '<button class="dact primary" data-act="nueva-mp">+ MP del mes</button>' +
          '<button class="dact" data-act="nuevo-evento">Nuevo evento</button>' +
          '<button class="dact" data-act="nuevo-pend">Pendiente</button>' +
          '<button class="dact" data-act="gestion">Gestión</button>' +
          '<button class="dact danger" data-act="baja"' + (e.estado === 'baja' ? ' disabled style="opacity:.5"' : '') + '>Dar de baja</button>' +
        '</div>' +
        '<div class="sec"><div class="sec-h">Calendario MP <span class="tag">' + YEAR + ' · editable</span></div>' +
          '<div class="next-pill">➜ Próxima MP: ' + nextTxt + '</div>' +
          '<div class="mp-stats"><div class="mp-stat"><div class="v" style="color:var(--accent)">' + c.prog + '</div><div class="l">Programadas</div></div>' +
            '<div class="mp-stat"><div class="v" style="color:var(--op)">' + c.done + '</div><div class="l">Realizadas</div></div>' +
            '<div class="mp-stat"><div class="v" style="font-size:13px">' + esc(e.freq || '—') + '</div><div class="l">Frecuencia</div></div></div>' +
          '<div class="mpcal" id="mpcal">' + cal + '</div>' +
          '<p class="edit-hint">Toca un mes para registrar o corregir la MP (recalcula el estado).</p></div>' +
        '<div class="sec"><div class="sec-h">Bitácora</div><div class="tl">' + evHtml + '</div></div>' +
        '<div class="sec"><div class="sec-h">Pendientes</div><div class="tl">' + pendHtml + '</div></div>' +
        '<div class="sec"><div class="sec-h">Ciclos correctivos</div><div class="tl">' + cicHtml + '</div></div>' +
        '<div class="sec"><div class="sec-h">Datos y ubicación <span class="tag">editable</span></div>' +
          '<div class="facts"><div><label class="fl">Servicio</label><input class="f-in" id="gSrv" value="' + esc(e.servicio) + '"></div>' +
            '<div><label class="fl">Unidad</label><input class="f-in" id="gUni" value="' + esc(e.unidad) + '"></div>' +
            '<div class="span2"><label class="fl">Ubicación</label><input class="f-in" id="gUbi" value="' + esc(e.ubic) + '"></div>' +
            '<div><label class="fl">Frecuencia MP</label><input class="f-in" id="gFreq" value="' + esc(e.freq) + '"></div>' +
            '<div><label class="fl">Encargado</label><select class="f-in" id="gEnc">' + opt([['', '— (auto: ' + (enc || 'sin encargado') + ')']].concat(EJEC.map(function (x) { return [x, x]; })), e.encargado || '') + '</select></div></div>' +
          '<div style="margin-top:9px;text-align:right"><button class="mini" data-act="guardar-datos">Guardar datos</button></div></div>' +
        '<div class="sec"><div class="sec-h">Notas</div><div class="chips">' + notasHtml + '</div>' +
          '<div class="addrow"><input id="notaTxt" placeholder="Nueva nota / observación…"><button class="add" data-act="add-nota">+</button></div></div>' +
      '</div>' +
      '<div class="d-foot"><button class="savebtn" data-act="close">Cerrar</button></div>';

    openDrawer(); selectRow(e.inv); wireEquipo(e);
  }

  function normEstado(s) { return String(s || '').replace(/ /g, '_'); }

  function wireEquipo(e) {
    // delegación de clics dentro del drawer
    drawer.onclick = function (ev) {
      var t = ev.target.closest('[data-act]'); if (!t) {
        var cell = ev.target.closest('.mpc'); if (cell) { paintMP(e, +cell.getAttribute('data-mo'), function () { paintEquipo(H.findEquipo(e.inv) || e); }); }
        return;
      }
      var act = t.getAttribute('data-act'), id = t.getAttribute('data-id');
      if (act === 'close') return closeDrawer();
      if (act === 'nueva-mp') return paintMP(e, NOW, function () { paintEquipo(H.findEquipo(e.inv) || e); });
      if (act === 'nuevo-evento') return paintEvento(e);
      if (act === 'nuevo-pend') return paintPendiente(e);
      if (act === 'gestion') return paintGestion(e);
      if (act === 'baja') {
        if (e.estado === 'baja') return;
        var motivo = window.prompt('Motivo de la baja de ' + e.inv + ':'); if (!motivo) return;
        var r = H.darDeBaja(e, motivo); toast(r.ok ? 'Equipo dado de baja · ' + e.inv : (r.error || 'No se pudo'), r.ok ? '' : 'warn'); return;
      }
      if (act === 'oficializar') { var ev1 = findEv(id); if (ev1) { H.oficializarEvento(ev1); toast('Evento oficializado'); } return; }
      if (act === 'anular') {
        var ev2 = findEv(id); if (!ev2) return;
        if (!window.confirm('¿Anular este evento? Se revertirán sus efectos (estado, R del mes, ciclos y pendientes automáticos).')) return;
        var motivo2 = window.prompt('Motivo de anulación:', 'Mal ingresado') || 'Anulado'; var r2 = H.anularEvento(ev2, motivo2); toast(r2.ok ? 'Evento anulado' : (r2.error || 'No se pudo'), r2.ok ? '' : 'warn'); return;
      }
      if (act === 'edit-ev') {
        var ev3 = findEv(id); if (!ev3) return;
        if (ev3.tipo === 'Mantención preventiva') {
          var dt = new Date((ev3.fecha || '') + 'T00:00:00');
          if (!isNaN(dt)) { YEAR = dt.getFullYear(); el('#yearLab').textContent = YEAR; var ys = el('#fYear'); if (ys) ys.value = YEAR; paintMP(e, dt.getMonth(), function () { paintEquipo(H.findEquipo(e.inv) || e); }); }
          else paintEditarEvento(e, ev3);
        } else paintEditarEvento(e, ev3);
        return;
      }
      if (act === 'pend-avanzar') { var p1 = findPend(id); if (p1) H.cambiarEstadoPend(p1, p1.estado === 'no_iniciado' ? 'en_proceso' : 'cerrado'); return; }
      if (act === 'pend-cerrar') { var p2 = findPend(id); if (p2) H.cerrarPendiente(p2, ''); return; }
      if (act === 'pend-reabrir') { var p3 = findPend(id); if (p3) H.cambiarEstadoPend(p3, 'en_proceso'); return; }
      if (act === 'ciclo-cerrar') { var folio = t.getAttribute('data-folio'); var cic = (H.ciclosDe(e.inv) || []).find(function (x) { return String(x.id) === id; }); if (cic) { var mot = window.prompt('Justificación del cierre manual:'); if (mot) H.cerrarCicloManual(cic, mot); } return; }
      if (act === 'guardar-datos') {
        e.servicio = el('#gSrv').value.trim(); e.unidad = el('#gUni').value.trim(); e.ubic = el('#gUbi').value.trim(); e.freq = el('#gFreq').value.trim();
        H.asignarEncargado(e, el('#gEnc').value || null); H.save(); toast('Datos actualizados'); return;
      }
      if (act === 'add-nota') { var txt = el('#notaTxt').value; if (txt && txt.trim()) { H.agregarNotaEquipo(e, txt); H.save(); toast('Nota agregada'); } return; }
    };
  }
  function findEv(id) { return (H.getState().eventos || []).find(function (x) { return String(x.id) === String(id); }); }
  function findPend(id) { return (H.getState().pendientes || []).find(function (x) { return String(x.id) === String(id); }); }

  // ---- sub-formulario: registrar / corregir MP ----
  function paintMP(e, i, onDone) {
    drawerMode = 'mp';
    var ev = H.eventoMPMes(e.inv, YEAR, i), editar = !!ev;
    var fechaDef = editar ? (ev.fecha || H.fechaSugeridaMP(YEAR, i)) : H.fechaSugeridaMP(YEAR, i);
    drawer.innerHTML =
      '<div class="d-head"><button class="d-close" data-x>✕</button><div class="d-fam">' + esc(e.fam || '') + '</div>' +
      '<div class="d-name">' + (editar ? 'Editar' : 'Registrar') + ' MP</div><div class="d-mm">' + esc(e.equipo || '') + ' · ' + (MES_FULL[MES[i]] || MES[i]) + ' ' + YEAR + '</div></div>' +
      '<div class="d-body"><button class="dback" data-back>← Volver al equipo</button>' +
        '<div class="notice' + (editar ? ' info' : '') + '">' + (editar ? 'Editas la MP ya registrada de este mes (p. ej. C6 → C3); el estado del equipo se recalcula.' : 'Se registra la MP del mes. Si el mes no estaba programado, se pedirá confirmación.') + '</div>' +
        '<div class="grid-2"><div class="fld"><label>Fecha</label><input type="date" id="mFecha" value="' + esc(fechaDef) + '"></div>' +
          '<div class="fld"><label>Resultado</label><select id="mRes">' + opt(RES_MP, editar ? (ev.resultado || 'Si') : H.getPref('ultimoResultadoMP', 'Si')) + '</select></div></div>' +
        '<div class="fld"><label>Ejecutor</label><select id="mEjec">' + opt([['', '—']].concat(EJEC.map(function (x) { return [x, x]; })), editar ? (ev.ejecutor || '') : H.getPref('ultimoEjecutor', '')) + '</select></div>' +
        '<div class="fld" id="mEstadoWrap"><label>Estado resultante</label><select id="mEstado">' + opt([['operativo', 'Operativo'], ['no operativo', 'No operativo']], editar && ev.estado === 'no operativo' ? 'no operativo' : 'operativo') + '</select><div class="notice" id="mEstadoAuto" style="display:none"></div></div>' +
        '<div class="fld"><label>Observación</label><textarea id="mObs" placeholder="Observación (opcional)">' + esc(editar ? (ev.obs || '') : '') + '</textarea></div>' +
      '</div>' +
      '<div class="d-foot"><button class="savebtn" data-save>' + (editar ? 'Guardar cambios' : 'Registrar MP') + '</button><button class="cancel" data-back>Cancelar</button></div>';

    var back = function () { paintEquipo(H.findEquipo(e.inv) || e); };
    drawer.querySelector('[data-x]').onclick = closeDrawer;
    var backs = drawer.querySelectorAll('[data-back]'); for (var b = 0; b < backs.length; b++) backs[b].onclick = back;
    var resSel = el('#mRes');
    var syncEstado = function () {
      var si = resSel.value === 'Si';
      el('#mEstado').style.display = si ? '' : 'none';
      var auto = el('#mEstadoAuto');
      if (si) { auto.style.display = 'none'; }
      else { auto.style.display = ''; auto.textContent = 'Estado resultante: ' + (ESTADO_LABEL[H.estadoMPDesdeResultado(resSel.value)] || 'sin cambio de estado'); }
    };
    resSel.onchange = syncEstado; syncEstado();
    drawer.querySelector('[data-save]').onclick = function () {
      var d = { inv: e.inv, fecha: el('#mFecha').value, resultado: resSel.value, ejecutor: el('#mEjec').value, obs: el('#mObs').value, estadoSi: el('#mEstado').value };
      var r;
      if (editar) { r = H.corregirMP(ev, d); }
      else {
        r = H.registrarMP(d);
        if (!r.ok && r.requiereConfirmacion) { if (window.confirm(r.aviso)) r = H.registrarMP(Object.assign({}, d, { forzarSinProg: true })); else return; }
      }
      if (!r.ok) return toast(r.error || 'No se pudo registrar', 'warn');
      toast('MP ' + (editar ? 'actualizada' : 'registrada') + ' · ' + e.inv + ' · ' + r.evento.resultado);
      (onDone || back)();
    };
  }

  // ---- sub-formulario: nuevo evento (campos por tipo, como en la app clásica) ----
  function paintEvento(e, opts) {
    opts = opts || {}; drawerMode = 'evento';
    var tipo = opts.tipo || 'Solicitud de trabajo';
    function fieldsFor(tp) {
      var spec = EV_SPEC[tp] || { fields: [] };
      var html = fld('Fecha', '<input type="date" id="ev_fecha" value="' + esc(opts.fecha || H.hoyLocal()) + '">');
      spec.fields.forEach(function (f) {
        var key = f[0], lab = f[1], ty = f[2], id = 'ev_' + key;
        if (ty === 'ejec') html += fld(lab, ejecSel(id, ''));
        else if (Array.isArray(ty) && typeof ty[0] === 'string' && ty[0].indexOf(':') >= 0) html += fld(lab, '<select id="' + id + '">' + ty.map(function (o) { var p = o.split(':'); return '<option value="' + esc(p[0]) + '">' + esc(p[1] || p[0]) + '</option>'; }).join('') + '</select>');
        else if (Array.isArray(ty)) html += fld(lab, '<select id="' + id + '">' + opt(ty, '') + '</select>');
        else html += fld(lab, '<input type="text" id="' + id + '">');
      });
      html += fld(spec.obs || 'Observación', '<textarea id="ev_obs"></textarea>');
      html += fld('Oficial', '<select id="ev_oficial">' + opt([['No', 'Borrador'], ['Sí', 'Oficial']], 'No') + '</select>');
      if (spec.notice) html += '<div class="notice info">' + esc(spec.notice) + '</div>';
      return html;
    }
    function save() {
      var d = { inv: e.inv, tipo: tipo, fecha: el('#ev_fecha').value, obs: el('#ev_obs').value, oficial: el('#ev_oficial').value };
      (EV_SPEC[tipo] || { fields: [] }).fields.forEach(function (f) { var n = el('#ev_' + f[0]); if (!n) return; if (f[0] === 'mpEstadoSi') d.mpEstadoSi = n.value; else d[f[0]] = n.value; });
      var r = H.crearEvento(d);
      if (!r.ok && r.requiereConfirmacion) { if (window.confirm(r.aviso)) r = H.crearEvento(Object.assign({}, d, { forzarSinProg: true })); else return; }
      if (!r.ok) return toast(r.error || 'No se pudo crear', 'warn');
      toast(r.consolidado ? 'MP del mes actualizada' : 'Evento "' + tipo + '" registrado'); paintEquipo(H.findEquipo(e.inv) || e);
    }
    function renderForm() {
      drawer.innerHTML = head(e, 'Nuevo evento') +
        '<div class="d-body"><button class="dback" data-back>← Volver al equipo</button>' +
        fld('Tipo de evento', '<select id="evTipo">' + opt(TIPOS_EV, tipo) + '</select>') +
        '<div id="evFields">' + fieldsFor(tipo) + '</div></div>' + foot('Guardar evento');
      wireBack(e);
      el('#evTipo').onchange = function (ev) { tipo = ev.target.value; el('#evFields').innerHTML = fieldsFor(tipo); };
      drawer.querySelector('[data-save]').onclick = save;
    }
    renderForm();
  }

  // ---- sub-formulario: editar evento (datos no críticos; resultado MP se corrige en el calendario) ----
  function paintEditarEvento(e, ev) {
    drawerMode = 'editev';
    var extra = EXTRA_FIELDS[ev.tipo] || [];
    drawer.innerHTML = head(e, 'Editar evento') +
      '<div class="d-body"><button class="dback" data-back>← Volver al equipo</button>' +
      '<div class="notice">' + esc(ev.tipo) + (ev.resultado ? ' · ' + esc(ev.resultado) : '') + (ev.estado ? ' · ' + esc(ev.estado) : '') + '</div>' +
      '<div class="grid-2">' + fld('Fecha', '<input type="date" id="ed_fecha" value="' + esc(ev.fecha || '') + '">') + fld('Ejecutor', ejecSel('ed_ejec', ev.ejecutor || '')) + '</div>' +
      fld('Oficial', '<select id="ed_oficial">' + opt([['No', 'Borrador'], ['Sí', 'Oficial']], ev.oficial || 'No') + '</select>') +
      extra.map(function (f) { return fld(f[1], '<input type="text" id="ed_' + f[0] + '" value="' + esc(ev[f[0]] || '') + '">'); }).join('') +
      fld('Observación', '<textarea id="ed_obs">' + esc(ev.obs || '') + '</textarea>') +
      (ev.tipo === 'Mantención preventiva' ? '<div class="notice info">Para cambiar el resultado de una MP (p. ej. C6 → C3) usa el calendario; aquí editas datos no críticos.</div>' : '') +
      '</div>' + foot('Guardar cambios');
    var back = wireBack(e);
    drawer.querySelector('[data-save]').onclick = function () {
      var cambios = { fecha: el('#ed_fecha').value, ejecutor: el('#ed_ejec').value, oficial: el('#ed_oficial').value, obs: el('#ed_obs').value };
      extra.forEach(function (f) { cambios[f[0]] = el('#ed_' + f[0]).value; });
      var r = H.editarEvento(ev, cambios); toast(r.ok ? 'Evento actualizado' : (r.error || 'No se pudo'), r.ok ? '' : 'warn'); back();
    };
  }

  // ---- sub-formulario: nuevo pendiente ----
  function paintPendiente(e) {
    drawerMode = 'pend';
    var tipos = Object.keys(TIPO_PEND).map(function (k) { return [k, TIPO_PEND[k]]; });
    subForm(e, 'Nuevo pendiente',
      '<div class="fld"><label>Tipo</label><select id="pTipo">' + opt(tipos, 'gestion_general') + '</select></div>' +
      '<div class="fld"><label>Descripción</label><textarea id="pDesc" placeholder="¿Qué hay que gestionar?"></textarea></div>' +
      '<div class="grid-2"><div class="fld"><label>Responsable</label>' + ejecSel('pEjec', '') + '</div>' +
        '<div class="fld"><label>Compromiso (opcional)</label><input type="date" id="pComp"></div></div>' +
      '<div class="fld"><label>Próximo recordatorio (opcional)</label><input type="date" id="pRec"></div>',
      function () {
        var d = { inv: e.inv, tipo: el('#pTipo').value, desc: el('#pDesc').value, ejecutor: el('#pEjec').value || null, fechaComp: el('#pComp').value || null, proxRecord: el('#pRec').value || null };
        var r = H.crearPendiente(d);
        if (!r.ok) return toast(r.error || 'No se pudo crear', 'warn');
        toast('Pendiente creado'); paintEquipo(H.findEquipo(e.inv) || e);
      });
  }

  // ---- sub-formulario: registrar gestión ----
  function paintGestion(e) {
    drawerMode = 'gestion';
    subForm(e, 'Registrar gestión',
      '<div class="grid-2"><div class="fld"><label>Contacto</label><input id="gC" placeholder="¿A quién se contactó?"></div>' +
        '<div class="fld"><label>Estado reportado</label><input id="gE" placeholder="lo que informaron"></div></div>' +
      '<div class="fld"><label>Detalle</label><textarea id="gT" placeholder="Resumen de la gestión…"></textarea></div>' +
      '<div class="fld"><label>Próximo recordatorio (opcional)</label><input type="date" id="gR"></div>' +
      '<div class="notice">Queda como seguimiento del equipo y fija el próximo recordatorio para no perderle el rastro.</div>',
      function () {
        var d = { inv: e.inv, contacto: el('#gC').value, estadoReportado: el('#gE').value, texto: el('#gT').value, proxRecord: el('#gR').value || null };
        var r = H.registrarGestionEquipo(d);
        if (!r.ok) return toast(r.error || 'No se pudo', 'warn');
        toast('Gestión registrada'); paintEquipo(H.findEquipo(e.inv) || e);
      });
  }

  // armazón común de sub-formularios (cabecera, pie y navegación "volver")
  function head(e, title) { return '<div class="d-head"><button class="d-close" data-x>✕</button><div class="d-fam">' + esc(e.fam || '') + '</div><div class="d-name">' + esc(title) + '</div><div class="d-mm">' + esc(e.equipo || '') + ' · ' + esc(e.inv) + '</div></div>'; }
  function foot(label) { return '<div class="d-foot"><button class="savebtn" data-save>' + esc(label || 'Guardar') + '</button><button class="cancel" data-back>Cancelar</button></div>'; }
  function fld(lab, inner) { return '<div class="fld"><label>' + lab + '</label>' + inner + '</div>'; }
  function ejecSel(id, val) { return '<select id="' + id + '">' + opt([['', '—']].concat(EJEC.map(function (x) { return [x, x]; })), val || '') + '</select>'; }
  function wireBack(e) { var back = function () { paintEquipo(H.findEquipo(e.inv) || e); }; var x = drawer.querySelector('[data-x]'); if (x) x.onclick = closeDrawer; var bs = drawer.querySelectorAll('[data-back]'); for (var i = 0; i < bs.length; i++) bs[i].onclick = back; return back; }
  function subForm(e, title, bodyHtml, onSave) {
    drawer.innerHTML = head(e, title) + '<div class="d-body"><button class="dback" data-back>← Volver al equipo</button>' + bodyHtml + '</div>' + foot('Guardar');
    wireBack(e); drawer.querySelector('[data-save]').onclick = onSave;
  }

  /* ----------------------------- topbar/toolbar ------------------------- */
  var qT;
  el('#q').addEventListener('input', function (ev) { clearTimeout(qT); qT = setTimeout(function () { filt.q = ev.target.value.trim(); renderGrid(); }, 120); });
  el('#fFam').onchange = function (ev) { filt.fam = ev.target.value; renderGrid(); };
  el('#fEstado').onchange = function (ev) { filt.estado = ev.target.value; renderGrid(); };
  el('#fFrec').onchange = function (ev) { filt.frec = ev.target.value; renderGrid(); };
  el('#fYear').onchange = function (ev) { YEAR = +ev.target.value; el('#yearLab').textContent = YEAR; render(); if (drawerMode === 'equipo' && curInv) { var e = H.findEquipo(curInv); if (e) paintEquipo(e); } };
  el('#toggleAll').onclick = function (ev) {
    allCollapsed = !allCollapsed; collapsed = {};
    if (allCollapsed) { uniqueFams().forEach(function (f) { collapsed[f] = 1; }); collapsed['Sin familia'] = 1; ev.target.textContent = 'Expandir todo'; }
    else ev.target.textContent = 'Contraer todo';
    renderGrid();
  };
  el('#themeBtn').onclick = function () {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    try { localStorage.setItem('sigem_theme', dark ? 'light' : 'dark'); } catch (e) {}
  };
  el('#legendBtn').onclick = function () { legend.classList.toggle('on'); };
  el('#cfgBtn').onclick = function () { paintConfig(); };
  el('#confChip').onclick = function () { paintConflictos(); };
  el('#moreBtn').onclick = function (e) { e.stopPropagation(); el('#moreMenu').classList.toggle('on'); };
  el('#moreMenu').onclick = function (e) { var b = e.target.closest('.more-item[data-screen]'); if (b) showScreen(b.getAttribute('data-screen')); };
  document.addEventListener('click', function (e) { if (!e.target.closest('#moreWrap')) closeMore(); });
  el('#expBtn').onclick = function () {
    var blob = new Blob([H.exportarBackupJSON()], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sigem-backup-' + H.hoyLocal() + '.json'; a.click();
    toast('Respaldo exportado (.json)');
  };
  el('#impBtn').onclick = function () { el('#impFile').click(); };
  el('#impFile').onchange = function (ev) {
    var f = ev.target.files[0]; if (!f) return; var rd = new FileReader();
    rd.onload = function () { try { var r = H.importarBackup(JSON.parse(rd.result)); toast(r.ok ? ('Respaldo importado · ' + r.eventos + ' eventos') : (r.error || 'Archivo no válido'), r.ok ? '' : 'warn'); } catch (err) { toast('Archivo no válido', 'warn'); } };
    rd.readAsText(f); ev.target.value = '';
  };

  // delegación principal de la grilla
  tb.addEventListener('click', function (ev) {
    var grp = ev.target.closest('tr.grp');
    if (grp) { var f = grp.getAttribute('data-fam'); if (collapsed[f]) delete collapsed[f]; else collapsed[f] = 1; renderGrid(); return; }
    var row = ev.target.closest('tr.row'); if (!row) return;
    var e = H.findEquipo(row.getAttribute('data-inv')); if (!e) return;
    var cell = ev.target.closest('td.mcell');
    if (cell) { curInv = e.inv; paintMP(e, +cell.getAttribute('data-mo'), function () { closeDrawer(); }); openDrawer(); selectRow(e.inv); return; }
    paintEquipo(e);
  });
  scrim.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { if (drawer.classList.contains('on')) closeDrawer(); legend.classList.remove('on'); closeMore(); } });

  /* --------------------------- Configuración ---------------------------- */
  function cloudStatusText() { return Cloud.connected ? ('Almacén activo' + (Cloud.gas ? ' (Apps Script)' : '') + (Cloud.lastSync ? ' · última sincronización: ' + new Date(Cloud.lastSync).toLocaleString('es-CL') : ' · sin sincronizar aún')) : 'Sin conectar a Google Sheets (los datos viven en este navegador).'; }
  function setCfgStatus(msg) { var s = el('#cfgStatus'); if (s) s.textContent = msg || cloudStatusText(); }
  function paintConfig() {
    drawerMode = 'config'; curInv = null; clearSel();
    var gas = isGAS();
    var sheetSec = gas
      ? '<div class="notice info">Servido desde Apps Script: la sincronización con tu Google Sheet es automática (sin URL ni token).</div>'
      : fld('URL de la app web (…/exec)', '<input type="text" id="cfgUrl" value="' + esc(Cloud.url) + '" placeholder="https://script.google.com/macros/s/…/exec">') +
        fld('Token (opcional)', '<input type="text" id="cfgTok" value="' + esc(Cloud.token) + '" placeholder="si definiste SHARED_TOKEN">');
    drawer.innerHTML =
      '<div class="d-head"><button class="d-close" data-x>✕</button><div class="d-fam">SIGEM</div><div class="d-name">Configuración</div><div class="d-mm">Almacenamiento, respaldo y mantenimiento</div></div>' +
      '<div class="d-body">' +
        '<div class="sec"><div class="sec-h">Almacenamiento · Google Sheets</div>' +
          '<div id="cfgStatus" class="notice">' + esc(cloudStatusText()) + '</div>' + sheetSec +
          '<label style="display:flex;gap:8px;align-items:center;font-size:12.5px;margin:8px 0"><input type="checkbox" id="cfgAuto"' + (Cloud.auto ? ' checked' : '') + '> Sincronización automática</label>' +
          '<div class="dacts">' +
            (gas ? '' : '<button class="dact" data-act="cfg-guardar">Guardar configuración</button><button class="dact" data-act="cfg-probar">Probar conexión</button>') +
            '<button class="dact primary" data-act="cfg-push">Guardar ahora</button><button class="dact" data-act="cfg-pull">Traer datos</button>' +
          '</div>' +
          '<div class="sec-empty">La regeneración de las hojas legibles del libro llegará en una fase próxima; por ahora se guarda y sincroniza el estado completo.</div></div>' +
        '<div class="sec"><div class="sec-h">Respaldo JSON</div><div class="dacts"><button class="dact" data-act="cfg-export">Exportar copia</button><button class="dact" data-act="cfg-import">Importar copia</button></div></div>' +
        '<div class="sec"><div class="sec-h">Mantenimiento de datos</div><div class="dacts">' +
          '<button class="dact" data-act="cfg-ofic">Oficializar borradores</button>' +
          '<button class="dact" data-act="cfg-dedup">Quitar MP duplicadas</button>' +
          '<button class="dact" data-act="cfg-normtipos">Normalizar tipos</button>' +
          '<button class="dact" data-act="cfg-ciclos">Reconstruir ciclos</button></div></div>' +
        '<div class="sec"><div class="sec-h">Maestro y conciliación</div>' +
          '<div id="cfgConf" class="notice">' + esc(conflStatusText()) + '</div>' +
          '<div class="dacts"><button class="dact" data-act="cfg-maestro">Importar maestro (.xlsx)</button><button class="dact" data-act="cfg-conf">Ver conflictos</button></div></div>' +
        '<div class="sec"><div class="sec-h">Plantilla de asignación MP</div>' +
          '<div class="grid-2"><div class="fld"><label>Mes</label><select id="cfgMes">' + MES.map(function (m, i) { return '<option value="' + i + '"' + (i === NOW ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></div>' +
            '<div class="fld"><label>Año</label><select id="cfgAno">' + [YEAR + 1, YEAR, YEAR - 1, YEAR - 2].map(function (y) { return '<option' + (y === YEAR ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select></div></div>' +
          '<div class="dacts"><button class="dact" data-act="cfg-plantilla-dl">Descargar plantilla</button><button class="dact" data-act="cfg-plantilla-up">Subir asignaciones</button></div></div>' +
      '</div><div class="d-foot"><button class="savebtn" data-x>Cerrar</button></div>';
    drawer.onclick = function (ev) {
      var t = ev.target.closest('[data-x],[data-act]'); if (!t) return;
      if (t.hasAttribute('data-x')) return closeDrawer();
      var act = t.getAttribute('data-act');
      var saveCfg = function () { if (!gas) Cloud.set(el('#cfgUrl').value, el('#cfgTok').value, el('#cfgAuto').checked); else localStorage.setItem('sigem_gs_auto', el('#cfgAuto').checked ? '1' : '0'); };
      if (act === 'cfg-guardar') { saveCfg(); toast('Configuración guardada'); refreshCloudChip(); setCfgStatus(); return; }
      if (act === 'cfg-probar') { setCfgStatus('Probando…'); Cloud.test().then(function () { setCfgStatus('Conexión correcta ✓'); }).catch(function (e) { setCfgStatus('Error: ' + e.message); }); return; }
      if (act === 'cfg-push') { saveCfg(); setCfgStatus('Guardando…'); Cloud.push().then(function () { setCfgStatus(); toast('Guardado en Google Sheets'); refreshCloudChip(); }).catch(function (e) { setCfgStatus('Error: ' + e.message); toast('Google Sheets: ' + e.message, 'warn'); }); return; }
      if (act === 'cfg-pull') { saveCfg(); if (!window.confirm('¿Traer datos del Google Sheet y reemplazar el estado local?')) return; setCfgStatus('Trayendo…'); Cloud.pull().then(function (r) { toast(r && r.empty ? 'El Sheet está vacío' : 'Datos traídos del Sheet'); closeDrawer(); render(); refreshCloudChip(); }).catch(function (e) { setCfgStatus('Error: ' + e.message); }); return; }
      if (act === 'cfg-export') { el('#expBtn').click(); return; }
      if (act === 'cfg-import') { el('#impBtn').click(); return; }
      if (act === 'cfg-ofic') { var n = H.oficializarTodosBorradores(); H.save(); toast((n || 0) + ' borradores oficializados'); return; }
      if (act === 'cfg-dedup') { if (H.consolidarMPDuplicadas) H.consolidarMPDuplicadas(); H.save(); toast('MP duplicadas consolidadas'); return; }
      if (act === 'cfg-normtipos') { if (H.normalizarTiposEvento) H.normalizarTiposEvento(); H.save(); toast('Tipos de evento normalizados'); return; }
      if (act === 'cfg-ciclos') { if (H.reconstruirCiclos) H.reconstruirCiclos(); H.save(); toast('Ciclos reconstruidos'); return; }
      if (act === 'cfg-maestro') { importarMaestro(); return; }
      if (act === 'cfg-conf') { paintConflictos(); return; }
      if (act === 'cfg-plantilla-dl') { descargarPlantilla(+el('#cfgAno').value, +el('#cfgMes').value); return; }
      if (act === 'cfg-plantilla-up') { subirPlantilla(+el('#cfgAno').value, +el('#cfgMes').value); return; }
    };
    openDrawer();
  }

  /* ---------------------- Maestro / conciliación / plantilla (Fase 2) ---------------------- */
  function dlBlob(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 0); }
  function pendConflictos() { return (H.getState().conflictos || []).filter(function (c) { return c.estado === 'pendiente' || c.estado === 'pospuesto'; }); }
  function conflStatusText() { var n = pendConflictos().length; return n ? (n + ' conflicto(s) pendiente(s) de conciliación.') : 'Sin conflictos pendientes.'; }
  function refreshConfChip() { var n = pendConflictos().length; var b = el('#confChip'); if (b) { b.style.display = n ? '' : 'none'; b.textContent = '⚠ ' + n + ' conciliar'; } }

  function importarMaestro() {
    if (!window.XLSX) return toast('XLSX no disponible (sin conexión)', 'warn');
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xlsm,.xls'; inp.style.display = 'none';
    inp.onchange = function (e) {
      var f = e.target.files[0]; if (!f) return; toast('Procesando maestro…');
      var S = H.getState(); var impId = S.counters.importacion++; (S.importaciones = S.importaciones || []).push({ id: impId, fecha: new Date().toISOString(), archivo: f.name, resueltos: 0 });
      H.parsearMaestro(f).then(function (parsed) {
        var res = H.compararMaestro(parsed, impId); H.save();
        toast('Maestro conciliado · ' + (res.oficializados || 0) + ' oficializadas · ' + (res.eventosSinteticos || 0) + ' importadas · ' + (res.autoCompletados || 0) + ' auto · ' + (res.conflictos || 0) + ' conflictos');
        if (pendConflictos().length) paintConflictos(); else paintConfig();
        render();
      }).catch(function (err) { toast('Error: ' + err.message, 'warn'); });
      setTimeout(function () { inp.remove(); }, 1000);
    };
    document.body.appendChild(inp); inp.click();
  }

  function paintConflictos() {
    drawerMode = 'conflictos'; curInv = null; clearSel();
    var pend = pendConflictos();
    var rows = pend.length ? pend.map(function (c) {
      var label = H.nombreCampoConflicto ? H.nombreCampoConflicto(c) : (c.campo || c.tipo);
      var vals = c.tipo === 'mp_diferencia'
        ? '<div class="tl-s"><span class="spill warn">Programa: ' + esc(c.valorPrograma || '∅') + '</span> &nbsp; <span class="spill op">Maestro: ' + esc(c.valorMaestro || '∅') + '</span></div>'
        : '<div class="tl-s">' + (c.tipo === 'equipo_nuevo' ? 'Equipo nuevo en el maestro' : 'Equipo del programa ausente en el maestro') + '</div>';
      var manual = c.tipo === 'mp_diferencia' ? '<button class="mini" data-cf="manual" data-id="' + c.id + '">Manual</button>' : '';
      return '<div class="tl-item"><div class="tl-main"><div class="tl-t">' + esc(c.inv || '') + (c.equipo ? ' · ' + esc(c.equipo) : '') + ' · ' + esc(label) + '</div>' + vals + '</div>' +
        '<div class="tl-acts"><button class="mini" data-cf="aceptar_maestro" data-id="' + c.id + '">Maestro</button><button class="mini" data-cf="mantener_programa" data-id="' + c.id + '">Programa</button>' + manual + '<button class="mini" data-cf="posponer" data-id="' + c.id + '">Posponer</button></div></div>';
    }).join('') : '<div class="sec-empty">No hay conflictos pendientes. 🎉</div>';
    drawer.innerHTML =
      '<div class="d-head"><button class="d-close" data-x>✕</button><div class="d-fam">SIGEM · Conciliación</div><div class="d-name">Conflictos (' + pend.length + ')</div><div class="d-mm">Diferencias con el maestro Excel</div></div>' +
      '<div class="d-body">' +
        (pend.length ? '<div class="dacts"><button class="dact primary" data-cfall="aceptar_maestro">Aceptar todo (maestro)</button><button class="dact" data-cfall="mantener_programa">Mantener todo (programa)</button></div>' : '') +
        '<div class="tl">' + rows + '</div></div>' +
      '<div class="d-foot"><button class="savebtn" data-cfg>Volver a Configuración</button><button class="cancel" data-x>Cerrar</button></div>';
    drawer.onclick = function (ev) {
      var t = ev.target.closest('[data-x],[data-cfg],[data-cf],[data-cfall]'); if (!t) return;
      if (t.hasAttribute('data-x')) return closeDrawer();
      if (t.hasAttribute('data-cfg')) return paintConfig();
      if (t.hasAttribute('data-cfall')) { var acc = t.getAttribute('data-cfall'); pendConflictos().forEach(function (c) { H.resolverConflicto(c, acc); }); toast('Conflictos resueltos'); paintConflictos(); render(); return; }
      if (t.hasAttribute('data-cf')) {
        var acc2 = t.getAttribute('data-cf'), id = t.getAttribute('data-id');
        var c = (H.getState().conflictos || []).find(function (x) { return String(x.id) === id; }); if (!c) return;
        var vm = null; if (acc2 === 'manual') { vm = window.prompt('Valor manual:', c.valorMaestro || ''); if (vm == null) return; }
        H.resolverConflicto(c, acc2, vm); toast('Conflicto resuelto'); paintConflictos(); render(); return;
      }
    };
    openDrawer();
  }

  function descargarPlantilla(y, m) {
    if (!window.XLSX) return toast('XLSX no disponible', 'warn');
    var d = H.construirAsignacionMP(y, m);
    if (!d.rows.length) return toast('Sin equipos programados en ' + (MES_FULL[MES[m]] || MES[m]) + ' ' + y, 'warn');
    var X = window.XLSX, wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([d.header].concat(d.rows)), 'Asignación');
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Responsable oficial']].concat(EJEC.map(function (e) { return [e]; }))), 'Responsables_oficiales');
    dlBlob(new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' }), 'Plantilla_' + (MES_FULL[MES[m]] || MES[m]) + '_' + y + '.xlsx');
    toast('Plantilla: ' + d.rows.length + ' equipos');
  }
  function subirPlantilla(y, m) {
    if (!window.XLSX) return toast('XLSX no disponible', 'warn');
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls'; inp.style.display = 'none';
    inp.onchange = function (e) {
      var f = e.target.files[0]; if (!f) return;
      f.arrayBuffer().then(function (buf) {
        var X = window.XLSX, wb = X.read(buf, { type: 'array' });
        var hoja = wb.SheetNames.find(function (n) { return /asignaci/i.test(n); }) || wb.SheetNames[0];
        var rows = X.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, defval: null, blankrows: false });
        var r = H.procesarPlantillaMP(rows, y, m);
        if (!r.ok) return toast(r.error, 'warn');
        toast(r.cargadas + ' asignaciones cargadas en ' + r.mes + ' ' + r.year);
      }).catch(function (err) { toast('Error: ' + err.message, 'warn'); });
      setTimeout(function () { inp.remove(); }, 1000);
    };
    document.body.appendChild(inp); inp.click();
  }

  /* ------------------- pantallas (Más ▾): Tablero / Cumplimiento -------------------- */
  function closeMore() { var m = el('#moreMenu'); if (m) m.classList.remove('on'); }
  function showScreen(name) {
    screen = name; closeMore();
    var g = el('#ganttScreen'), alt = el('#altScreen'), tbar = el('#toolbar');
    var items = document.querySelectorAll('.more-item[data-screen]');
    for (var i = 0; i < items.length; i++) items[i].classList.toggle('on', items[i].getAttribute('data-screen') === name);
    if (name === 'gantt') { g.style.display = ''; alt.style.display = 'none'; if (tbar) tbar.style.display = ''; render(); }
    else { g.style.display = 'none'; alt.style.display = ''; if (tbar) tbar.style.display = 'none'; if (name === 'tablero') renderTablero(); else renderCumplimiento(); }
  }

  // ---- Tablero (kanban): columnas con clic para abrir la ficha / avanzar pendientes ----
  var TBC = { no_operativo: '--alert', en_servicio_tecnico: '--warn', operativo: '--op' };
  function kbCol(label, colorVar, n, cardsHtml) { return '<div class="kb-col"><div class="kb-col-h" style="border-left-color:var(' + colorVar + ')">' + esc(label) + '<span class="n">' + n + '</span></div>' + (cardsHtml || '<div class="kb-more">—</div>') + '</div>'; }
  function renderTablero() {
    var alt = el('#altScreen');
    alt.innerHTML = '<div class="scr-hd"><h2>Tablero</h2><div class="seg2" id="tbSeg">' +
      [['estado', 'Por estado'], ['pendientes', 'Pendientes'], ['correctivos', 'Correctivos']].map(function (o) { return '<button data-m="' + o[0] + '"' + (tbMode === o[0] ? ' class="on"' : '') + '>' + o[1] + '</button>'; }).join('') +
      '</div></div><div id="tbBoard"></div>';
    el('#tbSeg').onclick = function (e) { var b = e.target.closest('button[data-m]'); if (!b) return; tbMode = b.getAttribute('data-m'); renderTablero(); };
    var board = el('#tbBoard');
    board.innerHTML = tbMode === 'pendientes' ? boardPendientes() : tbMode === 'correctivos' ? boardCorrectivos() : boardEstado();
    board.onclick = function (e) {
      var pa = e.target.closest('[data-pend]');
      if (pa) { e.stopPropagation(); var p = findPend(pa.getAttribute('data-pend')); if (!p) return; var a = pa.getAttribute('data-do'); if (a === 'avanzar') H.cambiarEstadoPend(p, p.estado === 'no_iniciado' ? 'en_proceso' : 'cerrado'); else if (a === 'cerrar') H.cerrarPendiente(p, ''); else if (a === 'reabrir') H.cambiarEstadoPend(p, 'en_proceso'); renderTablero(); return; }
      var card = e.target.closest('[data-inv]'); if (card) { var eq = H.findEquipo(card.getAttribute('data-inv')); if (eq) paintEquipo(eq); }
    };
  }
  function boardEstado() {
    var S = H.getState(), CAP = 60, cols = [['no_operativo', 'No operativo'], ['en_servicio_tecnico', 'En servicio técnico'], ['operativo', 'Operativo']];
    return '<div class="kb-board">' + cols.map(function (col) {
      var list = S.equipos.filter(function (e) { return e.estado === col[0]; });
      if (col[0] !== 'operativo') list.sort(function (a, b) { return H.diasEnEstado(b) - H.diasEnEstado(a); });
      var cards = list.slice(0, CAP).map(function (e) {
        var enc = H.encargadoDe(e);
        return '<div class="kb-card" data-inv="' + esc(e.inv) + '" style="border-left-color:var(' + TBC[col[0]] + ')"><div class="kb-inv">' + esc(e.inv) + '</div><div class="kb-eq">' + esc(e.equipo || '—') + '</div><div class="kb-meta"><span>' + esc(e.servicio || '—') + '</span>' + (col[0] !== 'operativo' ? '<span><b>' + H.diasEnEstado(e) + '</b> d</span>' : '') + (enc ? '<span>' + esc(enc) + '</span>' : '') + '</div></div>';
      }).join('');
      return kbCol(col[1], TBC[col[0]], list.length, cards + (list.length > CAP ? '<div class="kb-more">+' + (list.length - CAP) + ' más · filtra en la Gantt</div>' : ''));
    }).join('') + '</div>';
  }
  function boardPendientes() {
    var S = H.getState(), cols = [['no_iniciado', 'No iniciado', '--alert'], ['en_proceso', 'En proceso', '--warn'], ['cerrado', 'Resuelto', '--op']];
    return '<div class="kb-board">' + cols.map(function (col) {
      var list = (S.pendientes || []).filter(function (p) { return !p.anulado && p.estado === col[0]; });
      var cards = list.slice(0, 60).map(function (p) {
        var acts = col[0] === 'cerrado' ? '<button class="mini" data-pend="' + p.id + '" data-do="reabrir">Reabrir</button>'
          : '<button class="mini" data-pend="' + p.id + '" data-do="avanzar">' + (p.estado === 'no_iniciado' ? 'Iniciar' : 'Avanzar') + '</button><button class="mini" data-pend="' + p.id + '" data-do="cerrar">Resolver</button>';
        return '<div class="kb-card" data-inv="' + esc(p.inv) + '" style="border-left-color:var(' + col[2] + ')"><div class="kb-inv">' + esc(p.inv) + ' · ' + esc(TIPO_PEND[p.tipo] || p.tipo) + '</div><div class="kb-eq" style="font-size:12px">' + esc(p.desc || '') + '</div><div class="kb-meta">' + (p.ejecutor ? '<span>' + esc(p.ejecutor) + '</span>' : '<span style="color:var(--faint)">sin asignar</span>') + '</div><div class="kb-acts">' + acts + '</div></div>';
      }).join('');
      return kbCol(col[1], col[2], list.length, cards);
    }).join('') + '</div>';
  }
  function boardCorrectivos() {
    var S = H.getState(), stages = ['Solicitud de trabajo', 'Visita técnica', 'Orden de Compra', 'Envío a servicio técnico', 'Recepción', 'Reparación'];
    var abiertos = (S.ciclos || []).filter(function (c) { return c.estado === 'abierto'; });
    function etapa(inv) { var evs = H.eventosDe(inv).filter(function (e) { return !e.anulado && stages.indexOf(e.tipo) >= 0; }); if (!evs.length) return stages[0]; evs.sort(function (a, b) { return (a.fecha || '').localeCompare(b.fecha || '') || (a.id - b.id); }); return evs[evs.length - 1].tipo; }
    return '<div class="kb-board" style="grid-template-columns:repeat(' + stages.length + ',minmax(120px,1fr))">' + stages.map(function (st) {
      var list = abiertos.filter(function (c) { return etapa(c.inv) === st; });
      var cards = list.map(function (c) { var e = H.findEquipo(c.inv) || {}; return '<div class="kb-card" data-inv="' + esc(c.inv) + '" style="border-left-color:var(--accent)"><div class="kb-inv">' + esc(c.folio || '#' + c.id) + '</div><div class="kb-eq">' + esc(e.equipo || c.inv) + '</div><div class="kb-meta"><span>' + esc(c.inv) + '</span>' + (c.ingenieroAsignado ? '<span>' + esc(c.ingenieroAsignado) + '</span>' : '') + '</div></div>'; }).join('');
      return kbCol(st, '--accent', list.length, cards);
    }).join('') + '</div>';
  }

  // ---- Cumplimiento (por servicio / responsable / mes + tendencia + export) ----
  function pctCls(v) { return v == null ? '' : v >= 90 ? 'op' : v >= 60 ? 'st' : 'no'; }
  function pctCell(v) { if (v == null) return '<td style="color:var(--faint)">—</td>'; return '<td><span class="cmp-pct ' + pctCls(v) + '">' + v + '%</span><span class="cmp-bar"><i style="width:' + v + '%;background:var(' + (v >= 90 ? '--op' : v >= 60 ? '--warn' : '--alert') + ')"></i></span></td>'; }
  function renderCumplimiento() {
    if (cmpY == null) cmpY = YEAR; if (cmpM == null) cmpM = NOW;
    var alt = el('#altScreen');
    alt.innerHTML = '<div class="scr-hd"><h2>Cumplimiento</h2><div class="seg2" id="cmpSeg">' +
      [['servicio', 'Por servicio'], ['responsable', 'Por responsable'], ['mes', 'Por mes']].map(function (o) { return '<button data-m="' + o[0] + '"' + (cmpMode === o[0] ? ' class="on"' : '') + '>' + o[1] + '</button>'; }).join('') + '</div>' +
      '<div style="flex:1"></div>Mes <select class="sel" id="cmpMes">' + MES.map(function (m, i) { return '<option value="' + i + '"' + (i === cmpM ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select>' +
      '<select class="sel" id="cmpAno">' + [cmpY + 1, cmpY, cmpY - 1, cmpY - 2].map(function (y) { return '<option' + (y === cmpY ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select>' +
      '<button class="tbtn" id="cmpExport">Exportar</button></div><div id="cmpTrend"></div><div id="cmpBody"></div>';
    el('#cmpSeg').onclick = function (e) { var b = e.target.closest('button[data-m]'); if (!b) return; cmpMode = b.getAttribute('data-m'); renderCumplimiento(); };
    el('#cmpMes').onchange = function (e) { cmpM = +e.target.value; renderCumplimiento(); };
    el('#cmpAno').onchange = function (e) { cmpY = +e.target.value; renderCumplimiento(); };
    el('#cmpExport').onclick = exportCumplimiento;
    el('#cmpTrend').innerHTML = cmpTrendHtml();
    el('#cmpTrend').onclick = function (e) { var c = e.target.closest('[data-mo]'); if (c) { cmpM = +c.getAttribute('data-mo'); renderCumplimiento(); } };
    el('#cmpBody').innerHTML = cmpMode === 'responsable' ? cmpResponsableHtml() : cmpMode === 'mes' ? cmpMesHtml() : cmpServicioHtml();
  }
  function cmpTrendHtml() {
    var vivos = eqs().filter(function (e) { return e.estado !== 'baja'; });
    var cols = MES.map(function (mm, i) {
      var prog = vivos.filter(function (e) { return H.mpProgramadaEnMes(e, mm); });
      var ejec = prog.filter(function (e) { return H.mpDelMesEjecutada(e, cmpY, i); }).length;
      var pct = prog.length ? Math.round(ejec / prog.length * 100) : null;
      return '<div class="trend-col' + (i === cmpM ? ' on' : '') + '" data-mo="' + i + '" title="' + mm + ' ' + cmpY + ': ' + (pct == null ? 'sin programación' : pct + '% · ' + ejec + '/' + prog.length) + '"><div>' + (pct == null ? '—' : pct + '%') + '</div><div class="trend-bar-wrap"><div class="trend-bar ' + pctCls(pct) + '" style="height:' + (pct || 0) + '%"></div></div><div class="trend-lbl">' + mm + '</div></div>';
    }).join('');
    return '<div class="sec-h" style="margin-bottom:8px">Tendencia mensual MP · ' + cmpY + ' <span class="tag">clic en un mes</span></div><div class="trend">' + cols + '</div><div style="height:14px"></div>';
  }
  function svcRows() {
    return Array.from(new Set(eqs().map(function (e) { return e.servicio || '(sin servicio)'; }))).sort().map(function (sv) {
      var es = eqs().filter(function (e) { return (e.servicio || '(sin servicio)') === sv; });
      var vivos = es.filter(function (e) { return e.estado !== 'baja'; });
      var op = es.filter(function (e) { return e.estado === 'operativo'; }).length;
      var prog = vivos.filter(function (e) { return H.mpProgramadaEnMes(e, MES[cmpM]); });
      var ejec = prog.filter(function (e) { return H.mpDelMesEjecutada(e, cmpY, cmpM); }).length;
      var atr = vivos.filter(function (e) { for (var mm = 0; mm < cmpM; mm++) { if (H.mpProgramadaEnMes(e, MES[mm]) && H.mpEstadoMes(e, cmpY, mm) === 'pendiente') return true; } return false; }).length;
      var pend = es.reduce(function (a, e) { return a + H.pendientesDe(e.inv).filter(function (p) { return p.estado !== 'cerrado'; }).length; }, 0);
      return { sv: sv, total: es.length, vivos: vivos.length, op: op, prog: prog.length, ejec: ejec, atr: atr, pend: pend, pctMP: prog.length ? Math.round(ejec / prog.length * 100) : null, pctOp: vivos.length ? Math.round(op / vivos.length * 100) : null };
    });
  }
  function cmpServicioHtml() {
    var rows = svcRows(), tot = { total: 0, op: 0, vivos: 0, prog: 0, ejec: 0, atr: 0, pend: 0 };
    var body = rows.map(function (r) {
      tot.total += r.total; tot.op += r.op; tot.vivos += r.vivos; tot.prog += r.prog; tot.ejec += r.ejec; tot.atr += r.atr; tot.pend += r.pend;
      return '<tr><td class="l">' + esc(r.sv) + '</td><td>' + r.total + '</td>' + pctCell(r.pctOp) + '<td>' + r.ejec + '/' + r.prog + '</td>' + pctCell(r.pctMP) + '<td>' + (r.atr || '·') + '</td><td>' + (r.pend || '·') + '</td></tr>';
    }).join('');
    return '<div style="overflow:auto;max-width:100%"><table class="cmp-table"><thead><tr><th class="l">Servicio</th><th>Equipos</th><th>% Operativo</th><th>MP mes</th><th>% Cumpl.</th><th>Atras.</th><th>Pend.</th></tr></thead><tbody>' + body +
      '<tr class="tot"><td class="l">TOTAL</td><td>' + tot.total + '</td>' + pctCell(tot.vivos ? Math.round(tot.op / tot.vivos * 100) : null) + '<td>' + tot.ejec + '/' + tot.prog + '</td>' + pctCell(tot.prog ? Math.round(tot.ejec / tot.prog * 100) : null) + '<td>' + tot.atr + '</td><td>' + tot.pend + '</td></tr></tbody></table></div>';
  }
  function respRows() {
    var S = H.getState();
    var esMP = function (e, mes) { return !e.anulado && e.tipo === 'Mantención preventiva' && e.resultado === 'Si' && e.fecha && new Date(e.fecha + 'T00:00:00').getFullYear() === cmpY && (mes == null || new Date(e.fecha + 'T00:00:00').getMonth() === mes); };
    var cargo = {}; eqs().forEach(function (e) { var en = H.encargadoDe(e); if (en) cargo[en] = (cargo[en] || 0) + 1; });
    return EJEC.map(function (ej) {
      var pend = (S.pendientes || []).filter(function (p) { return !p.anulado && p.estado !== 'cerrado' && p.ejecutor === ej; });
      return { ej: ej, pend: pend.length, venc: pend.filter(function (p) { return p.fechaComp && p.fechaComp < H.hoyLocal(); }).length, mpMes: (S.eventos || []).filter(function (e) { return e.ejecutor === ej && esMP(e, cmpM); }).length, mpAno: (S.eventos || []).filter(function (e) { return e.ejecutor === ej && esMP(e, null); }).length, cargo: cargo[ej] || 0 };
    }).sort(function (a, b) { return b.pend - a.pend || b.mpAno - a.mpAno; });
  }
  function cmpResponsableHtml() {
    var body = respRows().map(function (r) { return '<tr><td class="l">' + esc(r.ej) + '</td><td>' + r.cargo + '</td><td>' + (r.pend || '·') + '</td><td>' + (r.venc ? '<span class="cmp-pct no">' + r.venc + '</span>' : '·') + '</td><td>' + r.mpMes + '</td><td>' + r.mpAno + '</td></tr>'; }).join('');
    return '<div style="overflow:auto;max-width:100%"><table class="cmp-table"><thead><tr><th class="l">Responsable</th><th>A cargo</th><th>Pend.</th><th>Vencidos</th><th>MP mes</th><th>MP año</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  function mesRows() {
    var vivos = eqs().filter(function (e) { return e.estado !== 'baja'; });
    return MES.map(function (mm, i) {
      var asig = (H.getState().asignacionesMP || {})[cmpY + '-' + String(i + 1).padStart(2, '0')] || {};
      var prog = 0, asignadas = 0, oficial = 0, borrador = 0, reprog = 0, noreg = 0;
      vivos.forEach(function (e) { var c = H.claseMPMes(e, cmpY, i); if (!c) return; prog++; if (asig[e.inv]) asignadas++; if (c === 'oficial') oficial++; else if (c === 'borrador') borrador++; else if (c === 'reprog') reprog++; else if (c === 'noreg') noreg++; });
      var realiz = oficial + borrador;
      return { mm: mm, i: i, prog: prog, asignadas: asignadas, realiz: realiz, reprog: reprog, noreg: noreg, pct: prog ? Math.round(realiz / prog * 100) : null };
    });
  }
  function cmpMesHtml() {
    var body = mesRows().map(function (r) { return '<tr' + (r.i === cmpM ? ' style="background:var(--accent-bg)"' : '') + '><td class="l">' + r.mm + '</td><td>' + (r.prog || '·') + '</td><td>' + (r.asignadas || '·') + '</td><td>' + (r.realiz || '·') + '</td><td>' + (r.reprog || '·') + '</td><td>' + (r.noreg || '·') + '</td>' + pctCell(r.pct) + '</tr>'; }).join('');
    return '<div style="overflow:auto;max-width:100%"><table class="cmp-table"><thead><tr><th class="l">Mes ' + cmpY + '</th><th>Prog.</th><th>Asign.</th><th>Realiz.</th><th>Reprog.</th><th>Sin reg.</th><th>% Cumpl.</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  function exportCumplimiento() {
    if (!window.XLSX) return toast('XLSX no disponible', 'warn');
    var X = window.XLSX, aoa;
    if (cmpMode === 'responsable') aoa = [['Responsable', 'A cargo', 'Pendientes', 'Vencidos', 'MP mes', 'MP año']].concat(respRows().map(function (r) { return [r.ej, r.cargo, r.pend, r.venc, r.mpMes, r.mpAno]; }));
    else if (cmpMode === 'mes') aoa = [['Mes', 'Prog', 'Asignadas', 'Realizadas', 'Reprog', 'Sin reg', '% Cumpl']].concat(mesRows().map(function (r) { return [r.mm, r.prog, r.asignadas, r.realiz, r.reprog, r.noreg, r.pct]; }));
    else aoa = [['Servicio', 'Equipos', '% Operativo', 'MP mes ejec', 'MP mes prog', '% Cumpl', 'Atrasadas', 'Pendientes']].concat(svcRows().map(function (r) { return [r.sv, r.total, r.pctOp, r.ejec, r.prog, r.pctMP, r.atr, r.pend]; }));
    var wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), 'Cumplimiento');
    dlBlob(new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' }), 'Cumplimiento_' + cmpMode + '_' + (MES_FULL[MES[cmpM]] || MES[cmpM]) + '_' + cmpY + '.xlsx');
    toast('Cumplimiento exportado');
  }

  /* ------------------------------ toast --------------------------------- */
  var tt;
  function toast(msg, cls) { var t = el('#toast'); if (!t) return; t.textContent = msg; t.className = 'toast on' + (cls ? ' ' + cls : ''); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('on'); }, 2600); }

  /* ----------------------------- arranque UI ---------------------------- */
  // colapsar por defecto las familias más numerosas para una primera vista limpia
  (function () { var cnt = {}; eqs().forEach(function (e) { var f = e.fam || 'Sin familia'; cnt[f] = (cnt[f] || 0) + 1; }); Object.keys(cnt).filter(function (f) { return cnt[f] > 30; }).forEach(function (f) { collapsed[f] = 1; }); })();
  ready = true;
  render();
  refreshCloudChip();
  // al abrir: si hay almacén conectado y sincronización automática, traer datos del Sheet
  if (Cloud.connected && Cloud.auto) {
    Cloud.pull().then(function (r) { if (r && !r.empty) { render(); toast('Datos sincronizados desde Google Sheets'); } refreshCloudChip(); }).catch(function () {});
  }

  /* --------------------------- markup del shell ------------------------- */
  function skeleton() {
    return '' +
      '<div class="app">' +
      '<header class="top"><div class="top-row">' +
        '<div class="mark">MP</div>' +
        '<div class="ttl"><b>Carta Gantt · Mantenimiento Preventivo</b><span>Equipos Médicos Críticos — Hospital Hernán Henríquez Aravena · SIGEM</span></div>' +
        '<div class="year"><span id="yearLab">2026</span><small>PROGRAMACIÓN</small></div>' +
        '<div id="moreWrap" style="position:relative">' +
          '<button class="iconbtn" id="moreBtn" title="Más vistas">▾</button>' +
          '<div class="more-menu" id="moreMenu">' +
            '<button class="more-item" data-screen="gantt">Carta Gantt MP</button>' +
            '<button class="more-item" data-screen="tablero">Tablero (kanban)</button>' +
            '<button class="more-item" data-screen="cumplimiento">Cumplimiento</button>' +
            '<a class="more-item" href="app-clasico.html" target="_blank" rel="noopener">App clásica ↗</a>' +
          '</div></div>' +
        '<button class="iconbtn" id="impBtn" title="Importar respaldo (.json)">↑</button>' +
        '<button class="iconbtn" id="expBtn" title="Exportar respaldo (.json)">↓</button>' +
        '<button class="iconbtn" id="legendBtn" title="Leyenda">?</button>' +
        '<button class="iconbtn" id="cfgBtn" title="Configuración / Google Sheets">⚙</button>' +
        '<button class="iconbtn" id="themeBtn" title="Tema claro/oscuro">◐</button>' +
        '<input type="file" id="impFile" accept="application/json,.json" hidden>' +
      '</div>' +
      '<div class="kpis" id="kpis"></div>' +
      '<div class="toolbar" id="toolbar">' +
        '<label class="search"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7" cy="7" r="5"></circle><path d="M11 11l3 3"></path></svg>' +
        '<input id="q" type="search" placeholder="Buscar equipo, N° inventario, marca, serie, ubicación…" autocomplete="off"></label>' +
        '<select class="sel" id="fFam"></select><select class="sel" id="fEstado"></select><select class="sel" id="fFrec"></select><select class="sel" id="fYear"></select>' +
        '<button class="tbtn" id="toggleAll">Contraer todo</button>' +
        '<button class="tbtn" id="confChip" style="display:none;border-color:var(--warn);color:var(--warn)"></button>' +
        '<span class="count-chip"><b id="countN">0</b> equipos</span>' +
      '</div></header>' +
      '<div class="grid-wrap">' +
        '<div id="ganttScreen"><table><thead><tr id="thRow"></tr></thead><tbody id="tb"></tbody></table>' +
          '<div class="empty" id="empty" style="display:none">Sin resultados para el filtro actual.</div></div>' +
        '<div id="altScreen" style="display:none;padding:14px 16px"></div>' +
      '</div>' +
      '</div>' +
      '<div class="legend" id="legend">' +
        '<h4>Marcas del calendario</h4>' +
        '<div class="leg-item"><span class="lg-key mk X">X</span> MP programada</div>' +
        '<div class="leg-item"><span class="lg-key mk R">R</span> MP realizada (Si)</div>' +
        '<div class="leg-item"><span class="lg-key mk P">C3</span> Reprogramada (C1–C8)</div>' +
        '<div class="leg-item"><span class="lg-key mk N">FS</span> No realizada (FS/NU/Baja/No)</div>' +
        '<div class="leg-sep"></div><h4>Estado del equipo</h4>' +
        '<div class="leg-item"><span class="lg-dot" style="background:var(--op)"></span> Operativo</div>' +
        '<div class="leg-item"><span class="lg-dot" style="background:var(--alert)"></span> No operativo</div>' +
        '<div class="leg-item"><span class="lg-dot" style="background:var(--warn)"></span> En servicio técnico</div>' +
        '<div class="leg-item"><span class="lg-dot" style="background:var(--baja)"></span> Baja</div>' +
        '<div class="leg-item"><span class="lg-dot" style="background:var(--traz)"></span> Desconocido</div>' +
        '<div class="leg-note">El estado lo recalcula el motor a partir de los eventos. Clic en una celda para registrar/corregir la MP.</div>' +
      '</div>' +
      '<div class="scrim" id="scrim"></div>' +
      '<aside class="drawer" id="drawer" aria-hidden="true"></aside>' +
      '<div class="toast" id="toast"></div>';
  }
})();
