/* =========================================================
   CONFIGURACIÓN
   ========================================================= */

const sheetID     = "1xm_sPi7GUWuSKgWMpB_ExteRv5B2YfDlt9OIks5_xG8"; 
const gidCatalogo = 0; 
const gidSocios   = 687599683;  

const apiURL      = "https://script.google.com/macros/s/AKfycby7u4WZOonT_gtvdp9mLXtvlFczzz9SYy3Ibqid4rXTHX56WWed-zV7cp7OkxpHoVI/exec";

// Si querés guardar ID en catalogo!E, cambiar a true:
const ESCRIBIR_SOCIO_ID_EN_CATALOGO = false;

/* =========================================================
   ESTADO LOCAL
   ========================================================= */

let catalogo = [];
let socios   = [];
let diasPrestamo = 7;

let filtro = {
  estado: "todos",
  titulo: "",
  autor: "",
  remarcar: true,
};

/* =========================================================
   UTIL
   ========================================================= */

function msg(txt) {
  const el = document.getElementById("mensajes");
  if (el) el.textContent = txt || "";
}

function gvizUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${sheetID}/gviz/tq?gid=${gid}&headers=1&tqx=out:json`;
}

/* =========================================================
   JSONP GViz (SIN CORS)
   ========================================================= */

function gvizQuery(url) {
  return new Promise((resolve, reject) => {
    const q = new google.visualization.Query(url);
    q.send((resp) => {
      if (resp.isError()) {
        reject(new Error(resp.getMessage() + " — " + resp.getDetailedMessage()));
      } else {
        resolve(resp.getDataTable());
      }
    });
  });
}

/* =========================================================
   PARSE: CATALOGO
   A:ID · B:Titulo · C:Autor · D:Estado · E:Socio
   F:Fecha devolución · G:Teléfono socio (opcional)
   ========================================================= */

function dataTableToCatalogo(dt) {
  const rows = dt.getNumberOfRows();
  const cols = dt.getNumberOfColumns();
  const out = [];

  for (let r = 0; r < rows; r++) {
    const id       = dt.getValue(r, 0) ?? "";
    const titulo   = dt.getValue(r, 1) ?? "";
    const autor    = dt.getValue(r, 2) ?? "";
    const estado   = dt.getValue(r, 3) ?? "Disponible";
    const socio    = dt.getValue(r, 4) ?? "";
    let   fecha    = dt.getValue(r, 6) ?? "";
    const telefono = cols >= 7 ? String(dt.getValue(r, 5) ?? "").trim() : "";

    if (fecha instanceof Date) {
      const d = fecha.getDate().toString().padStart(2, "0");
      const m = (fecha.getMonth() + 1).toString().padStart(2, "0");
      const y = fecha.getFullYear();
      fecha = `${d}/${m}/${y}`;
    }

    out.push({ id, titulo, autor, estado, socio, fecha, telefono });
  }

  return out;
}

/* =========================================================
   PARSE: SOCIOS LIMPIOS
   A:ID  ·  B:Nombre  ·  C:Telefono (opcional)
   ========================================================= */

function dataTableToSocios(dt) {
  const rows = dt.getNumberOfRows();
  const cols = dt.getNumberOfColumns();
  const out = [];

  for (let r = 0; r < rows; r++) {
    const id  = String(dt.getValue(r, 0) ?? "").trim();
    const nom = String(dt.getValue(r, 1) ?? "").trim();
    const tel = cols >= 3 ? String(dt.getValue(r, 2) ?? "").trim() : "";

    if (!id) continue;

    out.push({
      id,
      nombre: nom || id,
      telefono: tel
    });
  }

  return out.sort((a,b) => a.nombre.localeCompare(b.nombre,"es",{sensitivity:"base"}));
}

/* =========================================================
   FECHAS / VENCIDOS
   ========================================================= */

function parseFechaDMY(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d  = +m[1], mo = +m[2] - 1, y = +m[3];
  const dt = new Date(y, mo, d, 23, 59, 59);
  return isNaN(dt.getTime()) ? null : dt;
}

function esVencido(lib) {
  if ((lib.estado || "").toLowerCase() !== "prestado") return false;
  const f = parseFechaDMY(lib.fecha);
  if (!f) return false;

  const hoy  = new Date();
  const hoy0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);

  return f.getTime() < hoy0.getTime();
}

/* =========================================================
   LECTURA
   ========================================================= */

async function cargarCatalogo() {
  const dt = await gvizQuery(gvizUrl(gidCatalogo));
  catalogo = dataTableToCatalogo(dt);
}

async function cargarSocios() {
  const dt = await gvizQuery(gvizUrl(gidSocios));
  socios = dataTableToSocios(dt);

  const sel = document.getElementById("socioSelect");
  if (!sel) return;
  sel.innerHTML = `<option value="">-- elegir socio --</option>`;

  socios.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.dataset.nombre = s.nombre;
    opt.dataset.telefono = s.telefono || "";
    const txtTel = s.telefono ? ` – ${s.telefono}` : "";
    opt.textContent = `${s.nombre} (${s.id})${txtTel}`;
    sel.appendChild(opt);
  });
}

/* =========================================================
   API Apps Script (POST)
   ========================================================= */

async function apiPost(payload) {
  const res = await fetch(apiURL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });

  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    console.error("Respuesta NO JSON:", txt);
    return { ok:false, raw:txt };
  }
}

/* =========================================================
   CONFIG REMOTA
   ========================================================= */

async function cargarConfig() {
  const out = await apiPost({ accion:"getConfig", clave:"dias_prestamo" });

  if (out?.ok) {
    const val = parseInt(out.valor,10);
    if (!isNaN(val) && val>0) diasPrestamo = val;
  }

  document.getElementById("diasPrestamo").value = diasPrestamo;
  document.getElementById("configInfo").textContent =
    `(actual: ${diasPrestamo} días)`;
}

async function guardarConfig() {
  const input = document.getElementById("diasPrestamo");
  const val   = parseInt(input.value,10);

  if (isNaN(val) || val<=0) {
    alert("Ingresá un número de días válido (>=1).");
    return;
  }

  const out = await apiPost({
    accion:"setConfig",
    clave:"dias_prestamo",
    valor:val
  });

  if (out.ok) {
    diasPrestamo = val;
    document.getElementById("configInfo").textContent =
      `(actual: ${diasPrestamo} días)`;
    alert("Días de préstamo guardados.");
  } else {
    console.error(out);
    alert("No se pudo guardar. Revisá consola.");
  }
}

/* =========================================================
   FILTROS + RENDER
   ========================================================= */

function aplicarFiltros() {
  const qT = filtro.titulo.trim().toLowerCase();
  const qA = filtro.autor.trim().toLowerCase();
  const tipo = filtro.estado;

  return catalogo.filter((lib) => {
    if (tipo==="disponibles" && (lib.estado||"").toLowerCase()!=="disponible") return false;
    if (tipo==="prestados"   && (lib.estado||"").toLowerCase()!=="prestado")   return false;
    if (tipo==="vencidos"    && !esVencido(lib)) return false;

    if (qT && !(lib.titulo||"").toLowerCase().includes(qT)) return false;
    if (qA && !(lib.autor ||"").toLowerCase().includes(qA)) return false;

    return true;
  });
}

function renderTabla() {
  const tbody = document.querySelector("#libros tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const data = aplicarFiltros();

  data.forEach((lib, idx) => {
    const tr = document.createElement("tr");
    const disponible = (lib.estado||"").toLowerCase()==="disponible";
    const vencido = esVencido(lib);

    if (filtro.remarcar && vencido) tr.classList.add("vencido");
    const fechaClass = vencido ? 'class="fecha-vencida"' : "";

    tr.innerHTML = `
      <td>${lib.id}</td>
      <td>${lib.titulo}</td>
      <td>${lib.autor}</td>
      <td>${lib.estado}</td>
      <td>${lib.socio || "-"}</td>
      <td ${fechaClass}>${lib.fecha || "-"}</td>      
      <td>${lib.telefono || "-"}</td>
      
      <td>
        ${
          disponible
          ? `<button onclick="prestar(${idx})">Prestar</button>`
          : `<button onclick="devolver(${idx})">Devolver</button>`
        }
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (data.length===0) {
    tbody.innerHTML =
      `<tr><td colspan="8" style="text-align:center;color:#666;">Sin resultados.</td></tr>`;
  }
}

/* =========================================================
   ARRANQUE
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {

  document.getElementById("btnRefrescar")?.addEventListener("click", cargarTodo);
  document.getElementById("btnGuardarDias")?.addEventListener("click", guardarConfig);

  document.getElementById("filtroEstado")?.addEventListener("change", e=>{ filtro.estado=e.target.value; renderTabla(); });
  document.getElementById("filtroTitulo")?.addEventListener("input", e=>{ filtro.titulo=e.target.value; renderTabla(); });
  document.getElementById("filtroAutor") ?.addEventListener("input", e=>{ filtro.autor =e.target.value; renderTabla(); });
  document.getElementById("remarcarVencidos")?.addEventListener("change", e=>{ filtro.remarcar = !!e.target.checked; renderTabla(); });

  document.getElementById("btnLimpiar")?.addEventListener("click", ()=>{
    filtro = {estado:"todos",titulo:"",autor:"",remarcar:true};
    document.getElementById("filtroEstado").value = "todos";
    document.getElementById("filtroTitulo").value = "";
    document.getElementById("filtroAutor").value  = "";
    document.getElementById("remarcarVencidos").checked = true;
    renderTabla();
  });

  google.charts.load("current",{packages:[]});
  google.charts.setOnLoadCallback(async ()=>{
    try {
      await cargarTodo();
    } catch (e) {
      console.error(e);
      msg("No pude leer la hoja. Revisá publicación y GIDs.");
    }
  });
});

/* =========================================================
   ESCRITURA (PRESTAR / DEVOLVER)
   ========================================================= */

async function cargarTodo() {
  msg("Cargando datos...");
  await Promise.all([cargarCatalogo(), cargarSocios(), cargarConfig()]);
  renderTabla();
  msg("");
}

async function prestar(idx) {
  const sel = document.getElementById("socioSelect");
  const socioId = sel.value;

  if (!socioId) {
    alert("Elegí un socio antes de prestar.");
    return;
  }

  const opt = sel.options[sel.selectedIndex];
  const socioNombre = opt.dataset.nombre || socioId;
  const socioTel    = opt.dataset.telefono || "";

  const lib = aplicarFiltros()[idx];
  if (!lib?.id) {
    alert("Error: libro sin ID.");
    return;
  }

  const hoy = new Date();
  const dev = new Date(hoy);
  dev.setDate(hoy.getDate() + diasPrestamo);
  const fechaArg = dev.toLocaleDateString("es-AR");

  const socioAEscribir = ESCRIBIR_SOCIO_ID_EN_CATALOGO ? socioId : socioNombre;

  const out = await apiPost({
    accion: "prestar",
    idLibro: lib.id,
    socio: socioAEscribir,
    fecha: fechaArg,
    telefono: socioTel
  });

  if (out.ok) {
    alert(`Préstamo registrado\nLibro: ${lib.titulo}\nSocio: ${socioNombre}\nTel: ${socioTel}\nDevolución: ${fechaArg}`);
    await cargarCatalogo();
    renderTabla();
  } else {
    console.error(out);
    alert("La API devolvió error. Revisá consola.");
  }
}

async function devolver(idx) {
  const lib = aplicarFiltros()[idx];
  if (!lib?.id) {
    alert("Error: libro sin ID.");
    return;
  }

  const out = await apiPost({
    accion: "devolver",
    idLibro: lib.id
  });

  if (out.ok) {
    alert(`Devolución registrada: ${lib.titulo}`);
    await cargarCatalogo();
    renderTabla();
  } else {
    console.error(out);
    alert("Error al devolver. Revisá consola.");
  }
}
``