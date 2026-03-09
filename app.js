// ====== CONFIG (tus datos) ======
const sheetID     = "1xm_sPi7GUWuSKgWMpB_ExteRv5B2YfDlt9OIks5_xG8"; // ID del spreadsheet
const gidCatalogo = 0;                  // gid de la pestaña "catalogo"
const gidSocios   = 687599683;          // gid de la pestaña "socios"
const apiURL      = "https://script.google.com/macros/s/AKfycby7u4WZOonT_gtvdp9mLXtvlFczzz9SYy3Ibqid4rXTHX56WWed-zV7cp7OkxpHoVI/exec"; // tu /exec

// Estado local
let catalogo = []; // [{id,titulo,autor,estado,socio,fecha}]
let socios   = []; // [{id, nombre}]
let diasPrestamo = 7; // valor por defecto (se sobreescribe con config)
let filtro = {
  estado: "todos",
  titulo: "",
  autor: "",
  remarcar: true,
};

// ====== UTIL ======
function msg(txt) {
  const el = document.getElementById("mensajes");
  el.textContent = txt || "";
}

function gvizUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${sheetID}/gviz/tq?gid=${gid}&headers=1&tqx=out:json`;
}

function dataTableToCatalogo(dt) {
  const rows = dt.getNumberOfRows();
  const out = [];
  for (let r = 0; r < rows; r++) {
    const id     = dt.getValue(r, 0) ?? "";
    const titulo = dt.getValue(r, 1) ?? "";
    const autor  = dt.getValue(r, 2) ?? "";
    const estado = dt.getValue(r, 3) ?? "Disponible";
    let   socio  = dt.getValue(r, 4) ?? "";
    const telefono = (dt.getValue(r, 5) ?? "").toString().trim();
    let   fecha  = dt.getValue(r, 6) ?? "";

    // Normalizar fecha a string dd/mm/aaaa si viene Date de GViz
    if (fecha instanceof Date) {
      const d = fecha.getDate().toString().padStart(2, "0");
      const m = (fecha.getMonth() + 1).toString().padStart(2, "0");
      const y = fecha.getFullYear();
      fecha = `${d}/${m}/${y}`;
    }

    out.push({ id, titulo, autor, estado, socio, telefono, fecha });
  }
  return out;
}
// Parser para hoja de respuestas del Form con columnas:
// 0 id socio | 1 Nombre apellido | 2 Dni | ... | 4 telefono
function dataTableToSocios(dt) {
  const rows = dt.getNumberOfRows();

  // Índices fijos según tu formulario
  const COL_ID_SOCIO = 0;  // "N° de socio"
  const COL_NOMBRE   = 1;  // "Nombre apellido"
  const COL_DNI      = 2;  // "Dni"
  //const COL_TEL      = 4;  // "telefono"

  // Dedupe por ID (última respuesta gana)
  const map = new Map();
  for (let r = 0; r < rows; r++) {
    const idSocio = (dt.getValue(r, COL_ID_SOCIO) ?? "").toString().trim();
    const nombre  = (dt.getValue(r, COL_NOMBRE) ?? "").toString().trim();
    const dni     = (dt.getValue(r, COL_DNI) ?? "").toString().trim();
    //const telefono     = (dt.getValue(r, COL_TEL) ?? "").toString().trim();
    
    // Elegimos un ID estable: primero N° de socio; si falta, DNI; si falta, saltamos
    const id = dni || idSocio;
    if (!id) continue;

    // Si falta nombre, usamos el ID como nombre (mejor que vacío)
    const displayName = nombre || id;

    // Guardamos (el último sobreescribe)
    map.set(id, { id, nombre: displayName });
  }

  // Devuelve array [{id, nombre}] ordenado por nombre
  return Array.from(map.values()).sort((a, b) =>
    a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })
  );
}

// Convertir string "dd/mm/aaaa" -> Date (local). Si falla, devuelve null.
function parseFechaDMY(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const y = parseInt(m[3], 10);
  const dt = new Date(y, mo, d, 23, 59, 59); // fin del día para no cortar
  return isNaN(dt.getTime()) ? null : dt;
}

function esVencido(lib) {
  if ((lib.estado || "").toLowerCase() !== "prestado") return false;
  const f = parseFechaDMY(lib.fecha);
  if (!f) return false;
  const hoy = new Date();
  // Comparar solo fecha (sin hora)
  const hoy0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);
  return f.getTime() < hoy0.getTime();
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

  // Pintar combo de socios
  const sel = document.getElementById("socioSelect");
  sel.innerHTML = `<option value="">-- elegir socio --</option>`;
  socios.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.nombre; // se escribe el nombre en la col E
    opt.textContent = `${s.nombre} (${s.id})`;
    sel.appendChild(opt);
  });
}

// ====== CONFIG remota (Apps Script) ======
async function apiPost(payload) {
  const res = await fetch(apiURL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { ok:false, raw:txt }; }
}

async function cargarConfig() {
  const out = await apiPost({ accion: "getConfig", clave: "dias_prestamo" });
  if (out && out.ok) {
    const val = parseInt(out.valor, 10);
    if (!isNaN(val) && val > 0) {
      diasPrestamo = val;
    }
  }
  document.getElementById("diasPrestamo").value = diasPrestamo;
  document.getElementById("configInfo").textContent = `(actual: ${diasPrestamo} días)`;
}

async function guardarConfig() {
  const input = document.getElementById("diasPrestamo");
  const val = parseInt(input.value, 10);
  if (isNaN(val) || val <= 0) {
    alert("Ingresá un número de días válido (>=1).");
    return;
  }
  const out = await apiPost({ accion: "setConfig", clave: "dias_prestamo", valor: val });
  if (out && out.ok) {
    diasPrestamo = val;
    document.getElementById("configInfo").textContent = `(actual: ${diasPrestamo} días)`;
    alert("Días de préstamo guardados.");
  } else {
    console.error(out);
    alert("No se pudo guardar la configuración. Revisá la consola.");
  }
}

// ====== FILTROS / RENDER ======
function aplicarFiltros() {
  const qTitulo = filtro.titulo.trim().toLowerCase();
  const qAutor  = filtro.autor.trim().toLowerCase();
  const tipo    = filtro.estado;

  return catalogo.filter(lib => {
    // filtro por estado
    if (tipo === "disponibles" && (lib.estado || "").toLowerCase() !== "disponible") return false;
    if (tipo === "prestados"   && (lib.estado || "").toLowerCase() !== "prestado")   return false;
    if (tipo === "vencidos"    && !esVencido(lib)) return false;

    // filtro por texto
    if (qTitulo && !String(lib.titulo || "").toLowerCase().includes(qTitulo)) return false;
    if (qAutor  && !String(lib.autor  || "").toLowerCase().includes(qAutor))  return false;

    return true;
  });
}

function renderTabla() {
  const tbody = document.querySelector("#libros tbody");
  tbody.innerHTML = "";

  const data = aplicarFiltros();
  const remarcar = filtro.remarcar;

  data.forEach((lib, idx) => {
    const tr = document.createElement("tr");
    const disponible = (lib.estado || "").toLowerCase() === "disponible";
    const vencido = esVencido(lib);

    if (remarcar && vencido) {
      tr.classList.add("vencido");
    }

    const fechaCellClass = vencido ? 'class="fecha-vencida"' : "";

    tr.innerHTML = `
      <td>${lib.id}</td>
      <td>${lib.titulo}</td>
      <td>${lib.autor}</td>
      <td>${lib.estado || "Disponible"}</td>
      <td>${lib.socio || "-"}</td>
      <td>${lib.telefono || "-"}</td
      <td ${fechaCellClass}>${lib.fecha || "-"}</td>
      <td>
        ${disponible
          ? `<button onclick="prestar(${idx})">Prestar</button>`
          : `<button onclick="devolver(${idx})">Devolver</button>`}
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (data.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="7" style="text-align:center;color:#666;">Sin resultados con los filtros actuales.</td>`;
    tbody.appendChild(tr);
  }
}

// ====== ARRANQUE ======
document.addEventListener("DOMContentLoaded", async () => {
  // Eventos UI
  document.getElementById("btnRefrescar").addEventListener("click", cargarTodo);
  document.getElementById("btnGuardarDias").addEventListener("click", guardarConfig);

  document.getElementById("filtroEstado").addEventListener("change", (e) => {
    filtro.estado = e.target.value;
    renderTabla();
  });
  document.getElementById("filtroTitulo").addEventListener("input", (e) => {
    filtro.titulo = e.target.value;
    renderTabla();
  });
  document.getElementById("filtroAutor").addEventListener("input", (e) => {
    filtro.autor = e.target.value;
    renderTabla();
  });
  document.getElementById("remarcarVencidos").addEventListener("change", (e) => {
    filtro.remarcar = !!e.target.checked;
    renderTabla();
  });
  document.getElementById("btnLimpiar").addEventListener("click", () => {
    filtro = { estado:"todos", titulo:"", autor:"", remarcar:true };
    document.getElementById("filtroEstado").value = "todos";
    document.getElementById("filtroTitulo").value = "";
    document.getElementById("filtroAutor").value  = "";
    document.getElementById("remarcarVencidos").checked = true;
    renderTabla();
  });

  // Cargar librería Visualization
  google.charts.load("current", { packages: [] });
  google.charts.setOnLoadCallback(async () => {
    try {
      await cargarTodo();
    } catch (e) {
      console.error(e);
      msg("No pude leer la hoja. Ver permisos de publicación y GIDs.");
    }
  });
});

async function cargarTodo() {
  msg("Cargando datos...");
  await Promise.all([cargarCatalogo(), cargarSocios(), cargarConfig()]);
  renderTabla();
  msg("");
}

// ====== ESCRITURA (Apps Script) ======
async function prestar(idx) {
  const socioSel = document.getElementById("socioSelect").value;
  if (!socioSel) {
    alert("Elegí un socio en el selector antes de prestar.");
    return;
  }
  const lib = aplicarFiltros()[idx]; // usar índice de la vista filtrada
  if (!lib?.id) {
    alert("No se encontró el ID del libro.");
    return;
  }  
  const socioObj = socios.find(s => s.nombre === socioSelNombre) || { telefono: "" };
  const tel = socioObj.telefono || "";

  const hoy = new Date();
  const devolucion = new Date(hoy);
  devolucion.setDate(hoy.getDate() + Number(diasPrestamo || 7));
  const fechaArg = devolucion.toLocaleDateString("es-AR");

  const out = await apiPost({
    accion: "prestar",
    idLibro: lib.id,
    socio: socioSel,
    fecha: fechaArg
  });
  if (out.ok) {
    alert(
      `Préstamo registrado para "${lib.titulo}"\n` +
      `Socio: ${socioSelNombre}\n` +
      `Teléfono: ${tel || "(sin teléfono)"}\n` +
      `Devolución: ${fechaArg}` );

    await cargarCatalogo();
    renderTabla();
  } else {
    console.error(out);
    alert("No se pudo registrar el préstamo. Revisá la consola.");
  }
}

async function devolver(idx) {
  const lib = aplicarFiltros()[idx];
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