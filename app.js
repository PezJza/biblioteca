
// ====== CONFIG ======
const sheetID     = "1xm_sPi7GUWuSKgWMpB_ExteRv5B2YfDlt9OIks5_xG8"; // <-- tu ID
const gidCatalogo = 0;  // <-- gid de "catalogo" (ejemplo)
const gidSocios   = 687599683;           // <-- gid de "socios" (reemplazar)
const apiURL      = "https://script.google.com/macros/s/AKfycbyWklIwvU_oWnYKIkGdOgy4JoDxwv7DFGn9q2JcCvg-wjmQEzfFFRuyLIPdUSjVF94z/exec"; // <-- tu /exec

// Estado local
let catalogo = []; // [{id,titulo,autor,estado,socio,fecha}]
let socios   = []; // [{id, nombre}]

// ====== UTIL ======
function msg(txt) {
  const el = document.getElementById("mensajes");
  el.textContent = txt || "";
}

// Crea una URL GViz apuntando a un gid específico
function gvizUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${sheetID}/gviz/tq?gid=${gid}&headers=1&tqx=out:json`;
}

// Convierte DataTable -> arrays/objetos
function dataTableToCatalogo(dt) {
  const rows = dt.getNumberOfRows();
  const cols = dt.getNumberOfColumns();
  const out = [];
  for (let r = 0; r < rows; r++) {
    const id     = dt.getValue(r, 0) ?? "";
    const titulo = dt.getValue(r, 1) ?? "";
    const autor  = dt.getValue(r, 2) ?? "";
    const estado = dt.getValue(r, 3) ?? "Disponible";
    const socio  = dt.getValue(r, 4) ?? "";
    const fecha  = dt.getValue(r, 5) ?? "";
    if (String(id).trim() || String(titulo).trim() || String(autor).trim()) {
      out.push({ id, titulo, autor, estado, socio, fecha });
    }
  }
  return out;
}

function dataTableToSocios(dt) {
  const rows = dt.getNumberOfRows();
  const out = [];
  for (let r = 0; r < rows; r++) {
    const id     = dt.getValue(r, 0) ?? "";
    const nombre = dt.getValue(r, 1) ?? (dt.getValue(r, 0) ?? "");
    if (String(id).trim() || String(nombre).trim()) {
      out.push({ id, nombre });
    }
  }
  return out;
}

// ====== LECTURA SIN CORS (Visualization / JSONP) ======
function gvizQuery(url) {
  return new Promise((resolve, reject) => {
    const q = new google.visualization.Query(url);
    q.send(resp => {
      if (resp.isError()) {
        reject(new Error(resp.getMessage() + " — " + resp.getDetailedMessage()));
      } else {
        resolve(resp);
      }
    });
  });
}

async function cargarCatalogo() {
  const url = gvizUrl(gidCatalogo);
  const resp = await gvizQuery(url);
  const dt = resp.getDataTable();
  catalogo = dataTableToCatalogo(dt);
}

async function cargarSocios() {
  const url = gvizUrl(gidSocios);
  const resp = await gvizQuery(url);
  const dt = resp.getDataTable();
  socios = dataTableToSocios(dt);

  // pintar combo
  const sel = document.getElementById("socioSelect");
  sel.innerHTML = `<option value="">-- elegir socio --</option>`;
  socios.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.nombre; // escribimos el nombre en la col E de catalogo
    opt.textContent = `${s.nombre} (${s.id})`;
    sel.appendChild(opt);
  });
}

// ====== RENDER ======
function renderTabla() {
  const tbody = document.querySelector("#libros tbody");
  tbody.innerHTML = "";
  catalogo.forEach((lib, idx) => {
    const tr = document.createElement("tr");
    const disponible = (lib.estado || "").toLowerCase() === "disponible";
    tr.innerHTML = `
      <td>${lib.id}</td>
      <td>${lib.titulo}</td>
      <td>${lib.autor}</td>
      <td>${lib.estado || "Disponible"}</td>
      <td>${lib.socio || "-"}</td>
      <td>${lib.fecha || "-"}</td>
      <td>
        ${disponible
          ? `<button onclick="prestar(${idx})">Prestar</button>`
          : `<button onclick="devolver(${idx})">Devolver</button>`}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ====== ARRANQUE ======
document.addEventListener("DOMContentLoaded", async () => {
  msg("");
  document.getElementById("btnRefrescar").addEventListener("click", cargarTodo);

  // 1) Cargar la librería Visualization
  google.charts.load("current", { packages: [] }); // no hace falta 'table', solo Query
  google.charts.setOnLoadCallback(async () => {
    try {
      await cargarTodo();
    } catch (e) {
      console.error(e);
      msg("No pude leer la hoja. Revisá los gid/permiso de publicación.");
    }
  });
});

async function cargarTodo() {
  msg("Cargando datos...");
  await Promise.all([cargarCatalogo(), cargarSocios()]);
  renderTabla();
  msg("");
}

// ====== ESCRITURA (Apps Script) ======
// Tip CORS: usamos text/plain (evita preflight). Asegurate de publicar la web app con acceso 'Cualquiera con el enlace'.
async function apiPost(payload) {
  const res = await fetch(apiURL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { ok:false, raw:txt }; }
}

async function prestar(idx) {
  const socioSel = document.getElementById("socioSelect").value;
  if (!socioSel) {
    alert("Elegí un socio en el selector antes de prestar.");
    return;
  }
  const lib = catalogo[idx];
  if (!lib?.id) {
    alert("No se encontró el ID del libro.");
    return;
  }
  const hoy = new Date();
  const devolucion = new Date();
  devolucion.setDate(hoy.getDate() + 7);
  const fechaArg = devolucion.toLocaleDateString("es-AR");

  const out = await apiPost({
    accion: "prestar",
    idLibro: lib.id,
    socio: socioSel,
    fecha: fechaArg
  });
  if (out.ok) {
    alert(`Préstamo registrado para "${lib.titulo}" a ${socioSel}.\nDevolución: ${fechaArg}`);
    await cargarCatalogo();
    renderTabla();
  } else {
    console.error(out);
    alert("No se pudo registrar el préstamo. Revisá la consola.");
  }
}

async function devolver(idx) {
  const lib = catalogo[idx];
  if (!lib?.id) {
    alert("No se encontró el ID del libro.");
    return;
  }
  const out = await apiPost({
    accion: "devolver",
    idLibro: lib.id
  });
  if (out.ok) {
    alert(`Devolución registrada para "${lib.titulo}".`);
    await cargarCatalogo();
    renderTabla();
  } else {
    console.error(out);
    alert("No se pudo registrar la devolución. Revisá la consola.");
  }
}