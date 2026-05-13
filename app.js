// ============ HELPERS ============
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const getDif = (r) => Number(r.dif != null ? r.dif : (r.hf - r.hi));
const getHef = (r) => Number(r.hef !== undefined ? r.hef : getDif(r));

// ============ MODO OSCURO ============
function toggleDark(){
  document.body.classList.toggle('dark-theme');
  const isDark = document.body.classList.contains('dark-theme');
  $('btn-dark').textContent = isDark ? '☀️' : '🌙';
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}
if(localStorage.getItem('theme') === 'dark') {
  document.body.classList.add('dark-theme');
}
window.addEventListener('DOMContentLoaded', () => {
  if(localStorage.getItem('theme') === 'dark' && $('btn-dark')) {
    $('btn-dark').textContent = '☀️';
  }
});

// ============ PWA INSTALLATION ============
if('serviceWorker' in navigator){
  const swCode = 'self.addEventListener("fetch",e=>e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))));';
  const swBlob = new Blob([swCode], {type: 'application/javascript'});
  navigator.serviceWorker.register(URL.createObjectURL(swBlob)).catch(()=>{});
}
const manifest = {
  name: "Rentamaq Reportabilidad",
  short_name: "Rentamaq",
  start_url: location.href,
  display: "standalone",
  background_color: "#1F4E78",
  theme_color: "#1F4E78",
  icons: [{
    src: "https://firebasestorage.googleapis.com/v0/b/app-reportabilidad.firebasestorage.app/o/ICONO%20WEB.png?alt=media&token=bc152ac1-2403-493d-9a90-551b0f4ef7b8",
    sizes: "192x192",
    type: "image/png"
  }]
};
const mLink = document.createElement('link');
mLink.rel = 'manifest';
mLink.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(manifest));
document.head.appendChild(mLink);

// ====== PANTALLA DE CARGA ======
let loadedCollections = 0;
function splashProgress(pct, msg) {
  const bar = $('splash-progress');
  const txt = $('splash-msg');
  if(bar) bar.style.width = pct + '%';
  if(txt) txt.textContent = msg;
}
function hideSplash() {
  const s = $('splash');
  if(s) { s.classList.add('hide'); setTimeout(() => s.remove(), 600); }
}

// ============ CONFIG ============
const firebaseConfig = {
  apiKey: "AIzaSyBkIwhQMJbRdheMtsPcf2iFR0HPrOMW-h0",
  authDomain: "app-reportabilidad.firebaseapp.com",
  projectId: "app-reportabilidad",
  storageBucket: "app-reportabilidad.firebasestorage.app",
  messagingSenderId: "423911487944",
  appId: "1:423911487944:web:abbf3c7464bb335bfc28fd"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

db.enablePersistence().catch(err => console.warn("Modo offline advertencia: ", err.code));

const storage = firebase.storage();
const auth = firebase.auth();

const MOTIVOS = ['Mantención programada','Mantención no programada','Equipo no requerido por Teck','Sin operador disponible','Mala condición climática','Emergencia en faena','Equipo en traslado','Espera condición segura','Detención extraordinaria','Otro'];

let reports=[], equipos=[], ausencias=[], provs=[], lotes=[];
let fotoData1=null, fotoData2=null, currentUser=null, userRole='operador';

let unsubs=[], dashPage=1, dashPageSize=20;

// ============ AUTH CON ROLES ============
auth.onAuthStateChanged(async u=>{
  splashProgress(20, 'Verificando usuario...');
  if(u){
    currentUser=u;
    $('login-view').classList.add('hidden');
    $('app').classList.remove('hidden');
    setStatus('wait','Verificando perfil...');

    try {
      const doc = await db.collection('usuarios').doc(u.email.toLowerCase()).get();
      if (doc.exists && doc.data().rol === 'admin') {
        userRole = 'admin';
        $('user-label').innerHTML = `⭐ Admin: ${esc(u.email)}`;
        ['n-cons', 'n-lotes', 'n-equipos', 'n-err'].forEach(id => $(id).classList.remove('hidden'));
      } else {
        userRole = 'operador';
        $('user-label').innerHTML = `👤 Operador: ${esc(u.email)}`;
        ['n-cons', 'n-lotes', 'n-equipos'].forEach(id => $(id).classList.add('hidden'));
        $('n-err').classList.remove('hidden');
      }
    } catch(e) {
      userRole = 'operador';
      $('user-label').innerHTML = `👤 Operador: ${esc(u.email)}`;
      ['n-cons', 'n-lotes', 'n-equipos'].forEach(id => $(id).classList.add('hidden'));
      $('n-err').classList.remove('hidden');
    }

    setStatus('ok','Conectado');
    splashProgress(40, 'Cargando base de datos...');
    bootstrap();
  } else {
    currentUser=null;
    userRole='operador';
    unsubs.forEach(f=>f());unsubs=[];
    $('app').classList.add('hidden');
    $('login-view').classList.remove('hidden');
    hideSplash();
  }
});

function doLogin(e){
  e.preventDefault();
  const email=$('li-email').value;
  const pass=$('li-pass').value;
  auth.signInWithEmailAndPassword(email,pass).catch(err=>{
    $('li-err').innerHTML='<div class="err">Error de acceso. Verifique sus datos.</div>';
  });
}
function doLogout(){auth.signOut()}

function setStatus(kind,txt){
  const el=$('cloud-status');
  el.className='pill pill-'+(kind==='ok'?'ok':kind==='err'?'off':'wait');
  el.textContent=txt;
}

function toast(msg,kind){
  const t=document.createElement('div');
  t.className='toast '+(kind||'');
  t.textContent=msg;
  $('toast-container').appendChild(t);
  setTimeout(()=>t.remove(),3500);
}

// ============ BOOTSTRAP (CON LÍMITE DE NUBE) ============
function bootstrap(){
  const totalCols = 5;

  // Límite de lectura: últimos 60 días
  const d60 = new Date();
  d60.setDate(d60.getDate() - 60);
  const limitStr = d60.toISOString().slice(0, 10);

  const handle=(queryRef, tgt, cb)=>{
    const u=queryRef.onSnapshot(s=>{
      tgt.length=0;s.docs.forEach(d=>tgt.push({...d.data(),_id:d.id}));

      loadedCollections++;
      splashProgress(40 + Math.round((loadedCollections/totalCols)*60), 'Descargando datos...');
      if(loadedCollections >= totalCols) setTimeout(hideSplash, 400);

      if(cb)cb();
    },err=>{
      toast('Trabajando Offline o Error: '+err.message,'warn');
      setStatus('ok','Modo Offline');
    });
    unsubs.push(u);
  };

  handle(db.collection('equipos'),equipos,()=>{renderDash();llenarSelects();if(!isHidden('grid'))renderGrid();if(userRole==='admin')renderEquiposTab()});
  handle(db.collection('reportes').where('fecha', '>=', limitStr),reports,()=>{renderDash();if(!isHidden('grid'))renderGrid();if(userRole==='admin'&&!isHidden('cons'))renderCons();if(!isHidden('err'))renderErr()});
  handle(db.collection('ausencias').where('fecha', '>=', limitStr),ausencias,()=>{renderDash();if(!isHidden('grid'))renderGrid()});
  handle(db.collection('proveedores'),provs,()=>{renderDash();if(userRole==='admin')renderEquiposTab()});
  handle(db.collection('lotes'),lotes,()=>{if(userRole==='admin'&&!isHidden('lotes'))renderLotes()});

  initGrid();
  if(userRole==='admin')initCons();
  $('f-fecha').value=todayS();
}

function isHidden(v){return $('view-'+v).classList.contains('hidden')}

function show(v){
  const restricted = ['cons', 'lotes', 'equipos'];
  if (restricted.includes(v) && userRole !== 'admin') {
    toast('Acceso denegado', 'err');
    return;
  }

  ['dash','grid','new','cons','lotes','equipos','err'].forEach(x=>{
    $('view-'+x).classList.add('hidden');
    $('n-'+x)?.classList.remove('active');
  });

  $('view-'+v).classList.remove('hidden');
  $('n-'+v)?.classList.add('active');

  if(v==='dash')renderDash();
  if(v==='grid')renderGrid();
  if(v==='new')initNewForm();
  if(v==='cons')renderCons();
  if(v==='lotes')renderLotes();
  if(v==='equipos')renderEquiposTab();
  if(v==='err')renderErr();
}

function todayS(){return new Date().toISOString().slice(0,10)}
function fmtD(d){return new Date(d+'T00:00').toLocaleDateString('es-CL',{day:'2-digit',month:'short'})}

function defaultPeriod() {
  const d = new Date();
  let mesIni = d.getMonth();
  let añoIni = d.getFullYear();
  if (d.getDate() <= 20) mesIni = mesIni - 1;
  const fIni = new Date(añoIni, mesIni, 21);
  const fFin = new Date(añoIni, mesIni + 1, 20);
  const pad = (n) => n < 10 ? '0'+n : n;
  return {
    ini: `${fIni.getFullYear()}-${pad(fIni.getMonth()+1)}-21`,
    fin: `${fFin.getFullYear()}-${pad(fFin.getMonth()+1)}-20`
  };
}
function eqByPat(p){return equipos.find(e=>e.patente===p)}

// ============ DASHBOARD CON PAGINACIÓN ============
function renderDash(){
  if(!currentUser)return;
  const fp=$('fltr-prov');
  if(fp){
    const cur=fp.value;
    fp.innerHTML='<option value="">Todos proveedores</option>'+provs.map(p=>`<option ${p.nombre===cur?'selected':''}>${esc(p.nombre)}</option>`).join('');
  }
  const ft=$('fltr-tipo');
  if(ft){
    const cur=ft.value;
    const tipos=[...new Set(equipos.map(e=>e.tipo))].sort();
    ft.innerHTML='<option value="">Todos tipos</option>'+tipos.map(t=>`<option ${t===cur?'selected':''}>${esc(t)}</option>`).join('');
  }

  const f=($('fltr')?.value||'').toLowerCase();
  const fProv=$('fltr-prov')?.value||'';
  const fTipo=$('fltr-tipo')?.value||'';
  const per=defaultPeriod();
  const repsP=reports.filter(r=>r.fecha>=per.ini&&r.fecha<=per.fin);
  const ausP=ausencias.filter(a=>a.fecha>=per.ini&&a.fecha<=per.fin);

  let lista=equipos.filter(e=>(!fProv||e.proveedor===fProv)&&(!fTipo||e.tipo===fTipo)&&(!f||e.patente.toLowerCase().includes(f)));
  const repsPorEq={};repsP.forEach(r=>{repsPorEq[r.equipo]=repsPorEq[r.equipo]||[];repsPorEq[r.equipo].push(r)});

  let totHrs=0, totHef=0, totRep=0, firm=0;
  const hoy=todayS();

  const eqData = lista.map(e=>{
    const rs=repsPorEq[e.patente]||[];
    const hrs=rs.reduce((a,b)=>a+getDif(b),0);
    const hef=rs.reduce((a,b)=>a+getHef(b),0);
    totHrs+=hrs; totHef+=hef; totRep+=rs.length;
    firm+=rs.filter(r=>r.estado==='Firmado').length;

    const allReps = reports.filter(r => r.equipo === e.patente);
    allReps.sort((a,b) => (b.fecha+(b.turno==='Día'?'A':'B')).localeCompare(a.fecha+(a.turno==='Día'?'A':'B')));
    const ult = allReps[0];

    let stHtml = '';
    let ultHtml = '';

    if(rs.length===0){
      stHtml='<span class="badge b-warn">Sin reports</span>';
    } else {
      const tHoy=rs.some(r=>r.fecha===hoy);
      if(tHoy){
        stHtml='<span class="badge b-ok">Al día</span>';
      } else {
        if(ult) {
          const diffMs = new Date(hoy + 'T12:00') - new Date(ult.fecha + 'T12:00');
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          if(diffDays <= 2) stHtml = '<span class="badge b-info">Reciente</span>';
          else if(diffDays <= 5) stHtml = '<span class="badge" style="background:#FFE0CC;color:#8B4513">'+diffDays+' días atrás</span>';
          else stHtml = '<span class="badge" style="background:#F8D7DA;color:#721C24">'+diffDays+' días atrás</span>';
        } else {
          stHtml = '<span class="badge b-warn">Sin reports</span>';
        }
      }
    }

    if(ult) {
      ultHtml = `<br><span style="font-size:10px;color:#888;display:block;margin-top:2px"><b>Último:</b> ${fmtD(ult.fecha)} · ${esc(ult.turno)}</span>`;
    } else {
      ultHtml = `<br><span style="font-size:10px;color:#888;display:block;margin-top:2px">—</span>`;
    }

    return { e, rs, hrs, hef, stHtml, ultHtml };
  });

  const totalItems = eqData.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / dashPageSize));
  if(dashPage > totalPages) dashPage = totalPages;
  const start = (dashPage - 1) * dashPageSize;
  const pageData = eqData.slice(start, start + dashPageSize);

  const rows = pageData.map(d => {
    return `<tr class="clickable" onclick="openGridFor('${esc(d.e.patente)}')"><td><b>${esc(d.e.patente)}</b></td><td>${esc(d.e.tipo||'—')}</td><td>${esc(d.e.proveedor||'—')}</td><td>${esc(d.e.horo||'—')}</td><td>${d.rs.length}</td><td>${d.hrs.toFixed(1)}</td><td>${d.hef.toFixed(1)}</td><td>${d.stHtml}${d.ultHtml}</td></tr>`;
  }).join('');

  $('dash-table').innerHTML=`<table><thead><tr><th>Patente</th><th>Tipo</th><th>Proveedor</th><th>Horómetro</th><th>Reports</th><th>Hrs Horo</th><th>Hrs Efect</th><th>Estado / Último</th></tr></thead><tbody>${rows||'<tr><td colspan="8" class="empty">Sin equipos</td></tr>'}</tbody></table>`;

  const pagEl = $('dash-pag');
  if(pagEl) {
    if(totalItems > dashPageSize) {
      pagEl.classList.remove('hidden');
      pagEl.innerHTML=`
        <div>${totalItems} equipos · Pág ${dashPage} de ${totalPages}</div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-sec btn-sm" onclick="dashPage=1;renderDash()" ${dashPage===1?'disabled':''}>&laquo;</button>
          <button class="btn btn-sec btn-sm" onclick="dashPage--;renderDash()" ${dashPage===1?'disabled':''}>&lsaquo;</button>
          <select onchange="dashPageSize=+this.value;dashPage=1;renderDash()" style="width:auto;padding:2px 4px;font-size:11px">
            <option value="20" ${dashPageSize===20?'selected':''}>20 / pág</option>
            <option value="50" ${dashPageSize===50?'selected':''}>50 / pág</option>
            <option value="100" ${dashPageSize===100?'selected':''}>100 / pág</option>
          </select>
          <button class="btn btn-sec btn-sm" onclick="dashPage++;renderDash()" ${dashPage>=totalPages?'disabled':''}>&rsaquo;</button>
          <button class="btn btn-sec btn-sm" onclick="dashPage=${totalPages};renderDash()" ${dashPage>=totalPages?'disabled':''}>&raquo;</button>
        </div>
      `;
    } else {
      pagEl.classList.add('hidden');
    }
  }

  if($('s-hrs')) $('s-hrs').textContent=totHrs.toFixed(0);
  if($('s-hef')) $('s-hef').textContent=totHef.toFixed(0);
  if($('s-hrs-sub')) $('s-hrs-sub').textContent = fmtD(per.ini) + ' al ' + fmtD(per.fin);
  if($('s-eq')) $('s-eq').textContent=lista.length;
  if($('s-eq-sub')) $('s-eq-sub').textContent=`de ${equipos.length} totales`;
  if($('s-rep')) $('s-rep').textContent=totRep;
  if($('s-firm')) $('s-firm').textContent=firm;
  if($('s-firm-sub')) $('s-firm-sub').textContent=totRep?Math.round(firm*100/totRep)+'%':'0%';
}

function openGridFor(p){$('sel-eq').value=p;show('grid')}

// ============ GRID ============
function initGrid(){
  const sel=$('sel-eq');
  sel.innerHTML=equipos.map(e=>`<option value="${esc(e.patente)}">${esc(e.patente)} — ${esc(e.tipo||'')}</option>`).join('');
  const p=defaultPeriod();
  $('per-ini').value=p.ini;
  $('per-fin').value=p.fin;
}

function llenarSelects(){
  const opts='<option value="">— Seleccionar —</option>'+equipos.map(e=>`<option value="${esc(e.patente)}">${esc(e.patente)} — ${esc(e.tipo||'')}</option>`).join('');
  const fe=$('f-eq');
  if(fe){ const v = fe.value; fe.innerHTML=opts; if(v) fe.value = v; }
  const se=$('sel-eq');
  if(se){ const v = se.value; se.innerHTML=equipos.map(e=>`<option value="${esc(e.patente)}">${esc(e.patente)} — ${esc(e.tipo||'')}</option>`).join(''); if(v) se.value = v; }
}

function renderGrid(){
  const pat=$('sel-eq').value;
  const ini=$('per-ini').value;
  const fin=$('per-fin').value;
  if(!pat||!ini||!fin){$('grid-body').innerHTML='<div class="empty">Seleccione equipo y período</div>';return}
  const eq=eqByPat(pat);if(!eq){$('grid-body').innerHTML='';return}
  const d1=new Date(ini+'T00:00'),d2=new Date(fin+'T00:00');
  const dias=[];for(let d=new Date(d1);d<=d2;d.setDate(d.getDate()+1))dias.push(new Date(d));
  const reps=reports.filter(r=>r.equipo===pat&&r.fecha>=ini&&r.fecha<=fin);
  const aus=ausencias.filter(a=>a.equipo===pat&&a.fecha>=ini&&a.fecha<=fin);
  const hoy=todayS();

  let totHrs=0, totHef=0, reptN=0, ausN=0, missN=0, firmN=0;

  let html=`<div style="padding:10px;background:rgba(0,0,0,0.03);border-radius:6px;margin-bottom:10px" class="small"><b>${esc(eq.patente)}</b> · ${esc(eq.tipo||'—')} · Proveedor: <b>${esc(eq.proveedor||'—')}</b> · Horóm. actual: <b>${esc(eq.horo||'—')}</b></div>`;
  html+=`<table><thead><tr><th style="width:110px">Fecha</th><th>Turno Día</th><th>Turno Noche</th></tr></thead><tbody>`;

  dias.forEach(d=>{
    const fs=d.toISOString().slice(0,10);
    const cell=(t)=>{
      const r=reps.find(x=>x.fecha===fs&&x.turno===t);
      const a=aus.find(x=>x.fecha===fs&&x.turno===t);
      if(r){
        const dif=getDif(r);
        const hef=getHef(r);
        totHrs+=dif; totHef+=hef; reptN++;
        if(r.estado==='Firmado')firmN++;

        let fCount = 0; if(r.foto) fCount++; if(r.foto2) fCount++;
        const fotoPill = fCount > 0 ? `<span class="pill-foto">✓ ${fCount} foto${fCount>1?'s':''}</span>` : '<span class="pill-nofoto">sin foto</span>';

        const cls=r.estado==='Firmado'?'cell-signed':(r.estado==='Borrador'?'cell-draft':'cell-ok');
        const est=r.estado?`<span class="tab-estado" style="background:rgba(0,0,0,0.05)">${esc(r.estado)}</span>`:'';

        return `<td><div class="${cls}" onclick="editReport('${r._id}')"><b>${esc(r.folio||'s/folio')}</b> · Ef: ${hef.toFixed(1)}h ${fotoPill}<small>Horo: ${esc(r.hi)}→${esc(r.hf)} (${dif.toFixed(1)}h) ${est}</small>${r.obs?'<small style="font-style:italic">'+esc(r.obs)+'</small>':''}</div></td>`;
      }
      if(a){ausN++;return `<td><div class="cell-just" onclick="editAus('${a._id}')"><b>Ausencia</b><small>${esc(a.motivo)}${a.descuento==='Sí'?' (no factur.)':''}</small></div></td>`}
      if(fs>hoy)return '<td><div class="cell-fut">—</div></td>';
      missN++;
      return `<td><div class="cell-miss" onclick="openAusForm('${esc(pat)}','${fs}','${t}')"><b>Sin registrar</b><small>click para justificar o reportar</small></div></td>`;
    };
    html+=`<tr><td><b>${fmtD(fs)}</b></td>${cell('Día')}${cell('Noche')}</tr>`;
  });
  html+='</tbody></table>';

  const cab=`<div class="stats" style="grid-template-columns:repeat(5,1fr)">
  <div class="stat"><div class="lbl">Reportados</div><div class="val">${reptN}</div><div class="sub">de ${dias.length*2}</div></div>
  <div class="stat"><div class="lbl">Firmados</div><div class="val" style="color:#198754">${firmN}</div></div>
  <div class="stat"><div class="lbl">Hrs Horo</div><div class="val">${totHrs.toFixed(1)}</div></div>
  <div class="stat"><div class="lbl">Hrs Efectivas</div><div class="val" style="color:#BA7517">${totHef.toFixed(1)}</div></div>
  <div class="stat"><div class="lbl">Sin registrar</div><div class="val" style="color:#E24B4A">${missN}</div></div>
  </div>`;
  $('grid-body').innerHTML=cab+html;
}

// ============ AUSENCIAS ============
function openAusForm(pat,fecha,turno,aid){
  const a=aid?ausencias.find(x=>x._id===aid):null;
  $('modal-box').innerHTML=`
  <h2 style="margin-bottom:10px">${a?'Editar':'Gestionar turno vacío'}</h2>
  <p class="small" style="margin-bottom:12px">${esc(pat)} · ${fmtD(fecha)} · Turno ${esc(turno)}</p>
  ${!a?`<button class="btn" style="width:100%;margin-bottom:8px" onclick="irReportar('${esc(pat)}','${fecha}','${turno}')">Ingresar report</button>
  <p class="small" style="text-align:center;margin:10px 0">— o —</p>`:''}
  <label>Motivo de ausencia</label>
  <select id="a-motivo">${MOTIVOS.map(m=>`<option ${a&&a.motivo===m?'selected':''}>${esc(m)}</option>`).join('')}</select>
  <label>Descripción</label>
  <textarea id="a-desc" rows="3">${a?esc(a.descripcion||''):''}</textarea>
  <label>Aplica descuento al cobro</label>
  <select id="a-desc2"><option ${a&&a.descuento==='Sí'?'selected':''}>Sí</option><option ${a&&a.descuento==='No'?'selected':''}>No</option></select>
  <label>Validado por (opcional)</label>
  <input id="a-val" value="${a?esc(a.validado||''):''}" placeholder="Nombre Teck">
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
  ${a?'<button class="btn btn-dang btn-sm" onclick="delAus(\''+a._id+'\')">Eliminar</button>':''}
  <button class="btn btn-sec" onclick="closeModal()">Cancelar</button>
  <button class="btn" onclick="saveAus('${esc(pat)}','${fecha}','${turno}','${a?a._id:''}')">Guardar justificación</button>
  </div>`;
  $('modal').classList.add('show');
}

async function saveAus(pat,fecha,turno,id){
  try{
    const data={equipo:pat,fecha,turno,
      motivo:$('a-motivo').value,
      descripcion:$('a-desc').value,
      descuento:$('a-desc2').value,
      validado:$('a-val').value,
      ts:new Date().toISOString(),usuario:currentUser.email};
    if(id){await db.collection('ausencias').doc(id).update(data)}
    else{await db.collection('ausencias').add(data)}
    closeModal();toast('Ausencia guardada','ok');
  }catch(e){toast('Error: '+e.message,'err')}
}
function editAus(id){const a=ausencias.find(x=>x._id===id);if(a)openAusForm(a.equipo,a.fecha,a.turno,id)}
async function delAus(id){if(confirm('¿Eliminar ausencia?')){await db.collection('ausencias').doc(id).delete();closeModal();toast('Eliminada','ok')}}
function irReportar(pat,fecha,turno){closeModal();clearForm();show('new');setTimeout(()=>{$('f-eq').value=pat;$('f-fecha').value=fecha;$('f-turno').value=turno;onEqChange();}, 100);}

// ============ NEW REPORT ============
function initNewForm(){llenarSelects();if(!$('f-id').value){$('f-fecha').value=todayS();$('new-title').textContent='Ingresar nuevo report';}}
function editReport(id){
  const r=reports.find(x=>x._id===id);if(!r)return;
  fotoData1=null; fotoData2=null;
  show('new');
  setTimeout(()=>{
    $('new-title').textContent='Editar report';
    $('f-id').value=r._id;
    $('f-fecha').value=r.fecha;
    $('f-turno').value=r.turno;
    $('f-folio').value=r.folio||'';
    $('f-eq').value=r.equipo;
    $('f-op').value=r.operador||'';
    $('f-hi').value=r.hi;
    $('f-hf').value=r.hf;

    $('f-hef').value=(r.hef!==undefined)?r.hef:r.dif;
    $('f-obs').value=r.obs||'';
    $('f-estado').value=r.estado||'Borrador';
    calcDif();

    $('f-foto-prev1').innerHTML = r.foto ? `<img src="${esc(r.foto)}" class="foto-full"><div><button type="button" class="btn btn-dang btn-sm" onclick="quitFoto(1)">Quitar foto</button></div>` : '';
    $('f-foto-prev2').innerHTML = r.foto2 ? `<img src="${esc(r.foto2)}" class="foto-full"><div><button type="button" class="btn btn-dang btn-sm" onclick="quitFoto(2)">Quitar foto</button></div>` : '';

    const f=$('form-new');
    if(!$('btn-del-rep')){
      const b=document.createElement('button');
      b.id='btn-del-rep';b.type='button';b.className='btn btn-dang btn-sm';b.style.marginRight='auto';b.textContent='Eliminar';
      b.onclick=()=>delReport(r._id);
      f.querySelector('div[style*="flex-end"]').prepend(b);
    }
    validate();
  },100);
}

async function delReport(id){
  if(!confirm('¿Eliminar este report?'))return;
  try{
    const r=reports.find(x=>x._id===id);
    const pat = r?.equipo;
    if(r&&r.foto){try{await storage.refFromURL(r.foto).delete()}catch(e){}}
    if(r&&r.foto2){try{await storage.refFromURL(r.foto2).delete()}catch(e){}}
    await db.collection('reportes').doc(id).delete();

    if(pat){
      const restantes = reports.filter(x => x.equipo === pat && x._id !== id);
      const maxHf = restantes.reduce((m, x) => Math.max(m, Number(x.hf || 0)), 0);
      await db.collection('equipos').doc(pat).update({horo: maxHf});
    }

    clearForm();show('grid');toast('Report eliminado','ok');
  }catch(e){toast('Error: '+e.message,'err')}
}

function quitFoto(num){
  $('f-foto-prev'+num).innerHTML='';
  $('f-foto'+num).value='';
  if(num===1) fotoData1={remove:true}; else fotoData2={remove:true};
  validate();
}

function compFoto(e, num){
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=ev=>{
    const img=new Image();
    img.onload=()=>{
      const c=document.createElement('canvas');
      const maxW=1400;
      const sc=Math.min(1,maxW/img.width);
      c.width=img.width*sc;c.height=img.height*sc;
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      c.toBlob(blob=>{
        const fd={blob,preview:c.toDataURL('image/jpeg',0.75)};
        const kb=Math.round(blob.size/1024);
        if(num===1) fotoData1=fd; else fotoData2=fd;
        $('f-foto-prev'+num).innerHTML=`<img src="${fd.preview}" class="foto-full"><div class="small">Comprimido: ${kb} KB</div><button type="button" class="btn btn-dang btn-sm" onclick="quitFoto(${num})">Quitar</button>`;
        validate();
      },'image/jpeg',0.75);
    };img.src=ev.target.result;
  };r.readAsDataURL(f);
}

function onEqChange(){
  const p = $('f-eq').value;
  const e = eqByPat(p);
  if(!e || $('f-id').value) { calcDif(); return; }

  const fecha = $('f-fecha').value;
  const turno = $('f-turno').value;

  if(fecha && turno && p) {
    const currentOrder = fecha + (turno === 'Día' ? 'A' : 'B');
    const anteriores = reports
      .filter(r => r.equipo === p && (r.fecha + (r.turno === 'Día' ? 'A' : 'B')) < currentOrder)
      .sort((a,b) => (b.fecha+(b.turno==='Día'?'A':'B')).localeCompare(a.fecha+(a.turno==='Día'?'A':'B')));

    if(anteriores.length > 0) {
      $('f-hi').value = anteriores[0].hf;
    } else {
      $('f-hi').value = e.horo || '';
    }
  } else {
    $('f-hi').value = e.horo || '';
  }
  calcDif();
}

function calcDif(){
  const hi=parseFloat($('f-hi').value);
  const hf=parseFloat($('f-hf').value);
  const dif = (!isNaN(hi) && !isNaN(hf)) ? (hf-hi).toFixed(1) : '';
  $('f-dif').value = dif;

  const isNew = !$('f-id').value;
  const hefInput = $('f-hef');

  if(isNew && (!hefInput.value || hefInput.dataset.auto === 'true')) {
     hefInput.value = dif;
     hefInput.dataset.auto = 'true';
  }
  validate();
}

function validate(){
  const msgs=[];
  const id=$('f-id').value;
  const hi=parseFloat($('f-hi').value);
  const hf=parseFloat($('f-hf').value);
  const hef=parseFloat($('f-hef').value);
  const eq=$('f-eq').value;
  const fecha=$('f-fecha').value;
  const turno=$('f-turno').value;
  const folio=$('f-folio').value;
  const estado=$('f-estado').value;
  const obs = ($('f-obs').value || '').trim();
  const hoy=todayS();
  const dif = hf - hi;

  if(fecha>hoy)msgs.push({t:'err',m:'⊘ Fecha no puede ser futura'});
  if(!isNaN(hi) && !isNaN(hf) && hf < hi)msgs.push({t:'err',m:'⊘ Horóm. final no puede ser menor al inicial'});

  if(!isNaN(hi) && !isNaN(hf) && !isNaN(hef)) {
    const difRed = Math.round(dif * 10) / 10;
    const hefRed = Math.round(hef * 10) / 10;
    if(hefRed > difRed) {
      msgs.push({t:'err',m:'⊘ Horas efectivas no pueden ser mayores a la diferencia del horómetro'});
    } else if(hefRed < difRed && obs === '') {
      msgs.push({t:'err',m:'⊘ Detectamos un descuento de horas. Escribe una Observación obligatoria indicando el motivo.'});
    }
  }

  if(eq&&fecha&&turno&&reports.some(r=>r.equipo===eq&&r.fecha===fecha&&r.turno===turno&&r._id!==id))msgs.push({t:'err',m:'⊘ Ya existe report para este equipo/fecha/turno'});

  if(folio && eq && reports.some(r=>r.folio===folio && r.equipo===eq && r._id!==id))msgs.push({t:'err',m:'⊘ Folio duplicado en este equipo'});

  const hasPhoto = fotoData1?.blob || fotoData2?.blob || (id && reports.find(r=>r._id===id)?.foto) || (id && reports.find(r=>r._id===id)?.foto2);
  if(estado==='Firmado'&&!hasPhoto)msgs.push({t:'err',m:'⊘ Estado "Firmado" requiere al menos 1 foto adjunta'});

  if (eq && fecha && !isNaN(hi) && !isNaN(hf)) {
    const currentOrder = fecha + (turno === 'Día' ? 'A' : 'B');
    const rEq = reports.filter(r => r.equipo === eq && r._id !== id);

    const pasados = rEq.filter(r => (r.fecha + (r.turno === 'Día' ? 'A' : 'B')) < currentOrder);
    if (pasados.length > 0) {
      pasados.sort((a,b) => (b.fecha+(b.turno==='Día'?'A':'B')).localeCompare(a.fecha+(a.turno==='Día'?'A':'B')));
      const ant = pasados[0];
      if (parseFloat(ant.hf) > hi) msgs.push({t:'err', m:`⊘ Choque: Turno anterior (${fmtD(ant.fecha)} ${esc(ant.turno)}) terminó en ${ant.hf}.`});
    }

    const futuros = rEq.filter(r => (r.fecha + (r.turno === 'Día' ? 'A' : 'B')) > currentOrder);
    if (futuros.length > 0) {
      futuros.sort((a,b) => (a.fecha+(a.turno==='Día'?'A':'B')).localeCompare(b.fecha+(b.turno==='Día'?'A':'B')));
      const sig = futuros[0];
      if (parseFloat(sig.hi) < hf) msgs.push({t:'err', m:`⊘ Choque: Turno siguiente (${fmtD(sig.fecha)} ${esc(sig.turno)}) parte en ${sig.hi}.`});
    }
  }

  if(!isNaN(hi) && eq && !id){
    const e=eqByPat(eq);
    if(e && e.horo){
      if(hi < e.horo) {
        msgs.push({t:'err',m:`⊘ Horóm. inicial (${hi}) es MENOR al último registrado (${e.horo})`});
      } else if(hi > e.horo) {
        msgs.push({t:'warn',m:`⚠ Salto de horómetro respecto al último registro (${e.horo})`});
      }
    }
  }

  if(!isNaN(hi) && !isNaN(hf)){
    if(dif > 11) msgs.push({t:'warn',m:`⚠ Diferencia de ${dif.toFixed(1)}h supera el turno típico de 11h`});
  }

  if(!folio)msgs.push({t:'warn',m:'⚠ Report sin folio'});

  $('f-msgs').innerHTML=msgs.map(x=>`<div class="${x.t}">${x.m}</div>`).join('');
  const hasErr=msgs.some(m=>m.t==='err');
  $('btn-save').disabled=hasErr;
  return !hasErr;
}

document.addEventListener('input',e=>{if(e.target.closest('#form-new'))validate()});
document.addEventListener('change',e=>{if(e.target.closest('#form-new'))validate()});

async function saveReport(e){
  e.preventDefault();
  if(!validate())return;

  if(!navigator.onLine && (fotoData1?.blob || fotoData2?.blob)) {
    toast('Pérdida de señal. No se pueden adjuntar fotos en modo offline.', 'err');
    return;
  }

  const btn=$('btn-save');btn.disabled=true;btn.textContent='Guardando...';
  try{
    const id=$('f-id').value;
    const pat=$('f-eq').value;
    const hi=parseFloat($('f-hi').value);
    const hf=parseFloat($('f-hf').value);

    let fotoUrl1=id?(reports.find(r=>r._id===id)?.foto||''):'';
    let fotoUrl2=id?(reports.find(r=>r._id===id)?.foto2||''):'';

    if(fotoData1?.remove)fotoUrl1='';
    if(fotoData2?.remove)fotoUrl2='';

    const docId=id||db.collection('reportes').doc().id;

    if(fotoData1?.blob){
      const ref=storage.ref(`fotos/${pat}/${docId}_1.jpg`);
      await ref.put(fotoData1.blob);
      fotoUrl1=await ref.getDownloadURL();
    }
    if(fotoData2?.blob){
      const ref=storage.ref(`fotos/${pat}/${docId}_2.jpg`);
      await ref.put(fotoData2.blob);
      fotoUrl2=await ref.getDownloadURL();
    }

    const data={
      fecha:$('f-fecha').value,
      turno:$('f-turno').value,
      folio:$('f-folio').value,
      equipo:pat,
      operador:$('f-op').value,
      hi,hf,dif:hf-hi,
      hef:parseFloat($('f-hef').value)||0,
      obs:$('f-obs').value,
      foto:fotoUrl1,
      foto2:fotoUrl2,
      estado:$('f-estado').value,
      usuario:currentUser.email,
      ts:new Date().toISOString()
    };

    if(id){await db.collection('reportes').doc(id).update(data)}
    else{await db.collection('reportes').add(data)}

    const allR=[...reports.filter(r=>r.equipo===pat&&r._id!==id),{hf,fecha:data.fecha,turno:data.turno}];
    const maxHf=allR.reduce((m,r)=>Math.max(m,Number(r.hf||0)),0);
    await db.collection('equipos').doc(pat).update({horo:maxHf});

    toast('Report guardado ✓','ok');clearForm();show('grid');
  }catch(e){toast('Error: '+e.message,'err');btn.disabled=false;btn.textContent='Guardar'}
}

function clearForm(){
  $('form-new').reset();
  $('f-id').value='';
  $('f-msgs').innerHTML='';
  $('f-foto-prev1').innerHTML='';
  $('f-foto-prev2').innerHTML='';
  fotoData1=null; fotoData2=null;
  $('f-hef').dataset.auto='';
  const b=$('btn-del-rep');if(b)b.remove();
  $('btn-save').disabled=false;
  $('btn-save').textContent='Guardar';
  initNewForm();
}

// ============ CONSOLIDADOS ============
function initCons(){const p=defaultPeriod();$('c-ini').value=p.ini;$('c-fin').value=p.fin}

function renderCons(){
  const ini=$('c-ini').value,fin=$('c-fin').value;
  if(!ini||!fin)return;
  const reps=reports.filter(r=>r.fecha>=ini&&r.fecha<=fin);
  const aus=ausencias.filter(a=>a.fecha>=ini&&a.fecha<=fin);

  const porProv={};
  equipos.forEach(e=>{const p=e.proveedor||'Sin proveedor';porProv[p]=porProv[p]||{equipos:0,reports:0,horas:0,efectivas:0};porProv[p].equipos++});
  reps.forEach(r=>{
    const e=eqByPat(r.equipo);const p=e?(e.proveedor||'Sin proveedor'):'Desconocido';
    porProv[p]=porProv[p]||{equipos:0,reports:0,horas:0,efectivas:0};
    porProv[p].reports++;porProv[p].horas+=getDif(r);
    porProv[p].efectivas+=getHef(r);
  });

  const porEq={};
  equipos.forEach(e=>{porEq[e.patente]={eq:e,reports:0,horas:0,efectivas:0,aus:0}});
  reps.forEach(r=>{if(porEq[r.equipo]){
    porEq[r.equipo].reports++;
    porEq[r.equipo].horas+=getDif(r);
    porEq[r.equipo].efectivas+=getHef(r);
  }});
  aus.forEach(a=>{if(porEq[a.equipo])porEq[a.equipo].aus++});

  let totH=0,totHef=0,totR=0;
  Object.values(porProv).forEach(p=>{totH+=p.horas;totHef+=p.efectivas;totR+=p.reports});

  let html=`<div class="stats" style="grid-template-columns:repeat(4,1fr)">
  <div class="stat"><div class="lbl">Total Hrs Horo</div><div class="val">${totH.toFixed(1)}</div></div>
  <div class="stat"><div class="lbl">Total Hrs Efectivas</div><div class="val" style="color:#BA7517">${totHef.toFixed(1)}</div></div>
  <div class="stat"><div class="lbl">Reports</div><div class="val">${totR}</div></div>
  <div class="stat"><div class="lbl">Ausencias</div><div class="val" style="color:#378ADD">${aus.length}</div></div>
  </div>`;

  html+='<h3>Consolidado por proveedor</h3><div class="table-responsive"><table><thead><tr><th>Proveedor</th><th>Equipos</th><th>Reports</th><th>Hrs Horo</th><th>Hrs Efectivas</th></tr></thead><tbody>';
  Object.keys(porProv).sort().forEach(p=>{const d=porProv[p];html+=`<tr><td><b>${esc(p)}</b></td><td>${d.equipos}</td><td>${d.reports}</td><td>${d.horas.toFixed(1)}</td><td style="color:#BA7517;font-weight:bold">${d.efectivas.toFixed(1)}</td></tr>`});
  html+='</tbody></table></div>';

  html+='<h3 style="margin-top:16px">Detalle por equipo</h3><div class="table-responsive"><table><thead><tr><th>Patente</th><th>Tipo</th><th>Reports</th><th>Hrs Horo</th><th>Hrs Efectivas</th><th>Ausencias</th></tr></thead><tbody>';
  Object.values(porEq).filter(x=>x.reports>0||x.aus>0).sort((a,b)=>b.efectivas-a.efectivas).forEach(x=>{html+=`<tr><td><b>${esc(x.eq.patente)}</b></td><td>${esc(x.eq.tipo||'—')}</td><td>${x.reports}</td><td>${x.horas.toFixed(1)}</td><td style="color:#BA7517;font-weight:bold">${x.efectivas.toFixed(1)}</td><td>${x.aus}</td></tr>`});
  html+='</tbody></table></div>';

  $('cons-body').innerHTML=html;
}

function exportExcel(){
  const ini=$('c-ini').value, fin=$('c-fin').value;
  if(!ini || !fin) return toast('Seleccione un período primero', 'warn');

  toast('Generando Excel por equipos...', 'wait');
  const wb = XLSX.utils.book_new();

  const d1 = new Date(ini + 'T00:00'), d2 = new Date(fin + 'T00:00');
  const dias = [];
  for(let d = new Date(d1); d <= d2; d.setDate(d.getDate() + 1)) {
    dias.push(new Date(d).toISOString().slice(0,10));
  }

  const meses = ["ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO","JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"];
  const m1 = meses[d1.getMonth()], m2 = meses[d2.getMonth()];
  const tituloMeses = (m1 === m2) ? m1 : `${m1}/${m2}`;

  equipos.filter(eq => {
    const tieneR = reports.some(r => r.equipo === eq.patente && r.fecha >= ini && r.fecha <= fin);
    const tieneA = ausencias.some(a => a.equipo === eq.patente && a.fecha >= ini && a.fecha <= fin);
    return tieneR || tieneA;
  }).forEach(eq => {
    const rEq = reports.filter(r => r.equipo === eq.patente && r.fecha >= ini && r.fecha <= fin);
    const aEq = ausencias.filter(a => a.equipo === eq.patente && a.fecha >= ini && a.fecha <= fin);

    const aoa = [];

    const tituloEquipo = `${eq.patente} ${eq.tipo ? '- ' + eq.tipo : ''}`;
    aoa.push(["", tituloEquipo, "", "Horómetros", "", "Horas", tituloMeses]);

    aoa.push(["Fecha", "Report", "Operador", "Inicial", "Final", "Dif. Horo", "Hrs. Efect.", "OBSERVACION"]);

    dias.forEach(fs => {
      const fechaLatina = fs.split('-').reverse().join('-');

      ['Día', 'Noche'].forEach(t => {
        const r = rEq.find(x => x.fecha === fs && x.turno === t);
        const a = aEq.find(x => x.fecha === fs && x.turno === t);

        if (r) {
          const dif = getDif(r);
          const hef = getHef(r);
          aoa.push([fechaLatina, r.folio || 'S/F', r.operador || '', parseFloat(r.hi), parseFloat(r.hf), dif, hef, r.obs || '']);
        } else if (a) {
          aoa.push([fechaLatina, 'AUSENCIA', '', '', '', '', '', `${a.motivo} ${a.descripcion ? '- '+a.descripcion : ''}`]);
        } else {
          aoa.push([fechaLatina, '', '', '', '', '', '', '']);
        }
      });
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    ws['!merges'] = [
      { s: { r: 0, c: 1 }, e: { r: 0, c: 2 } },
      { s: { r: 0, c: 3 }, e: { r: 0, c: 4 } },
      { s: { r: 0, c: 5 }, e: { r: 0, c: 6 } }
    ];

    ws['!cols'] = [
      { wch: 11 }, { wch: 10 }, { wch: 20 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 40 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, eq.patente.slice(0, 31));
  });

  XLSX.writeFile(wb, `EDP_Rentamaq_${ini}_al_${fin}.xlsx`);
  toast('Excel generado con éxito', 'ok');
}

async function exportFotosZip(){
  const ini=$('c-ini').value,fin=$('c-fin').value;
  const filt=reports.filter(r=>r.fecha>=ini&&r.fecha<=fin&&(r.foto||r.foto2));
  if(!filt.length)return toast('Sin fotos en el período','err');
  toast('Generando ZIP... puede tardar');
  const zip=new JSZip();
  for(const r of filt){
    if(r.foto){ try{const res=await fetch(r.foto);const blob=await res.blob();zip.folder(r.equipo).file(`${r.fecha}_${r.turno}_1.jpg`,blob)}catch(e){} }
    if(r.foto2){ try{const res=await fetch(r.foto2);const blob=await res.blob();zip.folder(r.equipo).file(`${r.fecha}_${r.turno}_2.jpg`,blob)}catch(e){} }
  }
  const c=await zip.generateAsync({type:'blob'});
  const a=document.createElement('a');a.href=URL.createObjectURL(c);a.download=`Fotos_${ini}_${fin}.zip`;a.click();
  toast('ZIP listo','ok');
}

// ============ LOTES ============
function renderLotes(){
  let html='<div class="table-responsive"><table><thead><tr><th>#</th><th>Fecha despacho</th><th>Entregado a</th><th>Reports</th><th>Devueltos</th><th>Estado</th><th></th></tr></thead><tbody>';
  html+=lotes.sort((a,b)=>b.fecha_despacho?.localeCompare(a.fecha_despacho||'')||0).map(l=>{
    const cnt=reports.filter(r=>r.id_lote===l._id).length;
    const cls = l.estado==='Cerrado'?'ok':(l.estado==='En firma'?'warn':'info');
    return `<tr><td><b>${esc(l.numero||'—')}</b></td><td>${esc(l.fecha_despacho||'')}</td><td>${esc(l.entregado_a||'')}</td><td>${cnt}</td><td>${esc(l.devueltos||0)}</td><td><span class="badge b-${cls}">${esc(l.estado||'—')}</span></td><td><button class="btn btn-sm btn-sec" onclick="editLote('${l._id}')">Editar</button></td></tr>`;
  }).join('');
  html+='</tbody></table></div>';
  if(!lotes.length)html='<div class="empty">Sin lotes registrados</div>';
  $('lotes-body').innerHTML=html;
}

function nuevoLote(){
  const num=lotes.length+1;
  $('modal-box').innerHTML=`<h2>Nuevo lote de firma</h2>
  <label>Número</label><input id="l-num" value="${num}">
  <label>Fecha despacho</label><input type="date" id="l-fec" value="${todayS()}">
  <label>Entregado a (Teck)</label><input id="l-ent" placeholder="Nombre receptor">
  <label>Observaciones</label><textarea id="l-obs" rows="2"></textarea>
  <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
  <button class="btn btn-sec" onclick="closeModal()">Cancelar</button>
  <button class="btn" onclick="saveLote('')">Crear</button>
  </div>`;
  $('modal').classList.add('show');
}

function editLote(id){
  const l=lotes.find(x=>x._id===id);if(!l)return;
  $('modal-box').innerHTML=`<h2>Editar lote</h2>
  <label>Número</label><input id="l-num" value="${esc(l.numero||'')}">
  <label>Fecha despacho</label><input type="date" id="l-fec" value="${esc(l.fecha_despacho||'')}">
  <label>Entregado a</label><input id="l-ent" value="${esc(l.entregado_a||'')}">
  <label>Devueltos</label><input type="number" id="l-dev" value="${esc(l.devueltos||0)}">
  <label>Estado</label><select id="l-est"><option ${l.estado==='Abierto'?'selected':''}>Abierto</option><option ${l.estado==='En firma'?'selected':''}>En firma</option><option ${l.estado==='Devuelto parcial'?'selected':''}>Devuelto parcial</option><option ${l.estado==='Cerrado'?'selected':''}>Cerrado</option></select>
  <label>Observaciones</label><textarea id="l-obs" rows="2">${esc(l.obs||'')}</textarea>
  <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
  <button class="btn btn-dang btn-sm" onclick="delLote('${id}')">Eliminar</button>
  <button class="btn btn-sec" onclick="closeModal()">Cancelar</button>
  <button class="btn" onclick="saveLote('${id}')">Guardar</button>
  </div>`;
  $('modal').classList.add('show');
}

async function saveLote(id){
  const data={numero:$('l-num').value,fecha_despacho:$('l-fec').value,entregado_a:$('l-ent').value,obs:$('l-obs').value};
  if(id){data.devueltos=parseInt($('l-dev').value)||0;data.estado=$('l-est').value;await db.collection('lotes').doc(id).update(data)}
  else{data.estado='Abierto';data.devueltos=0;await db.collection('lotes').add(data)}
  closeModal();toast('Lote guardado','ok');
}

async function delLote(id){if(confirm('¿Eliminar lote?')){await db.collection('lotes').doc(id).delete();closeModal();toast('Eliminado','ok')}}

// ============ EQUIPOS / PROVS ============
function renderEquiposTab(){
  const tb=$('t-eq');if(!tb)return;
  const provOpts=provs.map(p=>p.nombre);
  tb.innerHTML=equipos.sort((a,b)=>a.patente.localeCompare(b.patente)).map(e=>`<tr><td><b>${esc(e.patente)}</b></td><td>${esc(e.tipo||'—')}</td><td><select onchange="setProv('${esc(e.patente)}',this.value)"><option value="">—</option>${provOpts.map(p=>`<option ${e.proveedor===p?'selected':''}>${esc(p)}</option>`).join('')}</select></td><td>${esc(e.horo||'—')}</td><td>${esc(e.estado||'Activo')}</td>
  <td><button class="btn btn-sm" onclick="editEquipo('${esc(e.patente)}')">Editar</button> <button class="btn btn-dang btn-sm" onclick="delEq('${esc(e.patente)}')">×</button></td></tr>`).join('');
}

function editEquipo(pat){
  const e=equipos.find(x=>x.patente===pat);
  $('modal-box').innerHTML=`<h2>Editar Equipo: ${esc(pat)}</h2>
    <label>Patente</label><input id="ne-p" value="${esc(e.patente)}" disabled>
    <label>Tipo de Maquinaria</label><input id="ne-t" value="${esc(e.tipo||'')}">
    <label>Proveedor</label><select id="ne-pr"><option value="">—</option>${provs.map(p=>`<option ${e.proveedor===p.nombre?'selected':''}>${esc(p.nombre)}</option>`).join('')}</select>
    <label>Horómetro Base/Actual</label><input type="number" step="0.1" id="ne-h" value="${esc(e.horo||0)}">
    <label>Estado</label><select id="ne-st"><option ${e.estado==='Activo'?'selected':''}>Activo</option><option ${e.estado==='Inactivo'?'selected':''}>Inactivo</option></select>
    <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-sec" onclick="closeModal()">Cancelar</button>
      <button class="btn" onclick="updateEq('${esc(pat)}')">Actualizar Datos</button>
    </div>`;
  $('modal').classList.add('show');
}

async function updateEq(pat){
  await db.collection('equipos').doc(pat).update({
    tipo:$('ne-t').value,
    proveedor:$('ne-pr').value,
    horo:parseFloat($('ne-h').value),
    estado:$('ne-st').value
  });
  closeModal(); toast('Equipo actualizado','ok');
}

async function setProv(pat,p){await db.collection('equipos').doc(pat).update({proveedor:p})}
async function delEq(pat){if(confirm('¿Eliminar '+pat+'?'))await db.collection('equipos').doc(pat).delete()}

function nuevoEquipo(){
  $('modal-box').innerHTML=`<h2>Nuevo equipo</h2>
  <label>Patente</label><input id="ne-p">
  <label>Tipo</label><input id="ne-t">
  <label>Proveedor</label><select id="ne-pr"><option value="">—</option>${provs.map(p=>`<option>${esc(p.nombre)}</option>`).join('')}</select>
  <label>Horómetro inicial</label><input type="number" step="0.1" id="ne-h">
  <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
  <button class="btn btn-sec" onclick="closeModal()">Cancelar</button>
  <button class="btn" onclick="saveNewEq()">Crear</button>
  </div>`;
  $('modal').classList.add('show');
}

async function saveNewEq(){
  const p=$('ne-p').value.trim().toUpperCase();
  if(!p)return toast('Patente requerida','err');
  if(eqByPat(p))return toast('Ya existe','err');
  await db.collection('equipos').doc(p).set({patente:p,tipo:$('ne-t').value,proveedor:$('ne-pr').value,horo:parseFloat($('ne-h').value)||0,estado:'Activo'});
  closeModal();toast('Equipo creado','ok');
}

function openProvs(){
  $('modal-box').innerHTML=`<h2>Proveedores</h2>
  <div id="prov-list" style="margin:12px 0">${provs.map(p=>`<div style="display:flex;gap:6px;margin:4px 0;align-items:center"><span style="flex:1"><b>${esc(p.nombre)}</b></span><button class="btn btn-dang btn-sm" onclick="delProv('${p._id}')">×</button></div>`).join('')||'<p class="small">Sin proveedores</p>'}</div>
  <div style="display:flex;gap:6px"><input id="new-prov" placeholder="Nombre proveedor"><button class="btn btn-sm" onclick="addProv()">+</button></div>
  <div style="margin-top:14px;display:flex;justify-content:flex-end"><button class="btn btn-sec" onclick="closeModal()">Cerrar</button></div>`;
  $('modal').classList.add('show');
}

async function addProv(){const v=$('new-prov').value.trim();if(v){await db.collection('proveedores').add({nombre:v});openProvs()}}
async function delProv(id){if(confirm('¿Eliminar?')){await db.collection('proveedores').doc(id).delete();openProvs()}}

// ============ DIAGNÓSTICO ============
function renderErr(){
  const folios={},dups=[],saltos=[];

  reports.forEach(r=>{
    if(r.folio){
      const k=r.equipo+'|'+r.folio;
      if(folios[k]) dups.push({eq:r.equipo, folio:r.folio, id:r._id});
      folios[k]=true;
    }
  });

  const porEq={};
  reports.forEach(r=>{
    porEq[r.equipo]=porEq[r.equipo]||[];
    porEq[r.equipo].push(r);
  });

  Object.keys(porEq).forEach(eq=>{
    const rs=porEq[eq].sort((a,b)=>(a.fecha+(a.turno==='Día'?'A':'B')).localeCompare(b.fecha+(b.turno==='Día'?'A':'B')));
    for(let i=1;i<rs.length;i++){
      const gap=rs[i].hi-rs[i-1].hf;
      if(Math.abs(gap)>0.1) saltos.push({eq, fecha:rs[i].fecha, turno:rs[i].turno, prev:rs[i-1].hf, curr:rs[i].hi, gap:gap.toFixed(1)})
    }
  });

  const sinF = reports.filter(r=>!r.folio).length;

  const borradorSinFoto = reports.filter(r => r.estado === 'Borrador' && !r.foto && !r.foto2);
  const totalBorradores = borradorSinFoto.length;

  $('err-body').innerHTML=`
  <div class="stats" style="grid-template-columns:repeat(4,1fr)">
    <div class="stat"><div class="lbl">Total reports</div><div class="val">${reports.length}</div></div>
    <div class="stat"><div class="lbl">Sin folio</div><div class="val" style="color:#E24B4A">${sinF}</div></div>
    <div class="stat"><div class="lbl">Borradores sin foto</div><div class="val" style="color:#BA7517">${totalBorradores}</div></div>
    <div class="stat"><div class="lbl">Saltos horómetro</div><div class="val" style="color:#BA7517">${saltos.length}</div></div>
  </div>

  <h3 style="margin-top:14px">Saltos de horómetro (Control Estricto)</h3>
  ${saltos.length===0?'<p class="small">Ninguno ✓</p>':'<div class="table-responsive"><table><thead><tr><th>Equipo</th><th>Fecha Salto</th><th>Terminó en</th><th>Inició en</th><th>Gap</th></tr></thead><tbody>'+saltos.map(s=>`<tr><td>${esc(s.eq)}</td><td>${fmtD(s.fecha)} (${esc(s.turno)})</td><td>${esc(s.prev)}h</td><td>${esc(s.curr)}h</td><td style="color:#E24B4A">${s.gap>0?'+':''}${s.gap}h</td></tr>`).join('')+'</tbody></table></div>'}

  <h3 style="margin-top:14px">Reports pendientes de foto</h3>
  ${borradorSinFoto.length===0?'<p class="small">Ninguno ✓ Todos los borradores tienen al menos una foto o no hay borradores.</p>':'<ul class="small" style="padding-left:20px">'+borradorSinFoto.map(r=>`<li style="margin-bottom:6px; cursor:pointer;" onclick="editReport('${r._id}')"><b>${esc(r.equipo)}</b>: ${fmtD(r.fecha)} (${esc(r.turno)}) - Folio: ${esc(r.folio||'S/F')} <span style="color:#1F4E78; font-weight:bold; margin-left:4px">[Subir foto ahora]</span></li>`).join('')+'</ul>'}

  <h3 style="margin-top:14px">Folios duplicados</h3>
  ${dups.length===0?'<p class="small">Ninguno ✓</p>':'<ul class="small" style="padding-left:20px">'+dups.map(d=>`<li style="margin-bottom:4px; cursor:pointer;" onclick="editReport('${d.id}')"><b>${esc(d.eq)}</b>: folio ${esc(d.folio)} <span style="color:#1F4E78; font-weight:bold; margin-left:4px">[Revisar]</span></li>`).join('')+'</ul>'}
  `;
}

function closeModal(){$('modal').classList.remove('show')}
