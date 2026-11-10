/* LINKERO — portal de links del equipo */
(() => {
  "use strict";

  const NUEVA = "__nueva__";
  const COLORES = ["#2f5bea", "#12b76a", "#f79009", "#ee46bc", "#7a5af8", "#2e90fa", "#f04438", "#06aed4"];

  // ---------- Datos de ejemplo (modo demo) ----------
  const hace = (dias) => new Date(Date.now() - dias * 864e5).toISOString();
  const SEMILLA_CATEGORIAS = [
    { id: "cat-marketing", nombre: "Marketing", color: "#ee46bc", icono: "📣", orden: 10 },
    { id: "cat-metricas", nombre: "Métricas", color: "#7a5af8", icono: "📊", orden: 20 },
    { id: "cat-ventas", nombre: "Ventas", color: "#12b76a", icono: "💰", orden: 30 },
    { id: "cat-logistica", nombre: "Logística", color: "#f79009", icono: "🚚", orden: 40 },
    { id: "cat-admin", nombre: "Administración", color: "#2e90fa", icono: "🗂️", orden: 50 },
  ];
  const SEMILLA_LINKS = [
    { nombre: "Guiones", url: "https://teamlogi26.github.io/guion/#ideas", categoria_id: "cat-marketing", descripcion: "Ideas y guiones para contenido.", favorito: true, clics: 12, created_at: hace(6), updated_at: hace(2) },
    { nombre: "Métricas", url: "https://logi-metricas.pages.dev/", categoria_id: "cat-metricas", descripcion: "Tablero de métricas del equipo.", favorito: false, clics: 27, created_at: hace(5), updated_at: hace(5) },
    { nombre: "Landing Page", url: "https://t5iam0-gb.myshopify.com/products/apagones-doctora", categoria_id: "cat-ventas", descripcion: "Producto: Horse Boost", favorito: false, clics: 4, created_at: hace(1), updated_at: hace(1) },
  ];

  // ---------- Almacenamiento: Supabase o navegador (demo) ----------
  const cfg = window.LINKERO_CONFIG || {};
  const usaSupabase = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);

  const almacenSupabase = () => {
    const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const ok = ({ data, error }) => { if (error) throw error; return data; };
    return {
      cargar: async () => {
        const [cats, links] = await Promise.all([db.from("categorias").select("*"), db.from("links").select("*")]);
        return { categorias: ok(cats), links: ok(links) };
      },
      crearCategoria: async (c) => ok(await db.from("categorias").insert(c).select().single()),
      crearLink: async (l) => ok(await db.from("links").insert(l).select().single()),
      actualizarLink: async (id, cambios) => ok(await db.from("links").update(cambios).eq("id", id).select().single()),
      eliminarLink: async (id) => ok(await db.from("links").delete().eq("id", id)),
      sumarClic: async (id) => ok(await db.rpc("sumar_clic", { link_id: id })),
    };
  };

  const almacenLocal = () => {
    const CLAVE = "linkero.demo.v2";
    let datos = null;
    const guardar = () => { try { localStorage.setItem(CLAVE, JSON.stringify(datos)); } catch { /* sin acceso */ } };
    const todo = () => {
      if (datos) return datos;
      try { datos = JSON.parse(localStorage.getItem(CLAVE)); } catch { datos = null; }
      if (!datos) {
        datos = {
          categorias: SEMILLA_CATEGORIAS.map((c) => ({ ...c })),
          links: SEMILLA_LINKS.map((l) => ({ ...l, id: crypto.randomUUID() })),
        };
        guardar();
      }
      return datos;
    };
    const copia = (x) => JSON.parse(JSON.stringify(x));
    return {
      cargar: async () => copia(todo()),
      crearCategoria: async (c) => {
        const nueva = { id: crypto.randomUUID(), icono: null, orden: 100, ...c };
        todo().categorias.push(nueva); guardar();
        return copia(nueva);
      },
      crearLink: async (l) => {
        const ahora = new Date().toISOString();
        const nuevo = { id: crypto.randomUUID(), favorito: false, clics: 0, created_at: ahora, updated_at: ahora, ...l };
        todo().links.push(nuevo); guardar();
        return copia(nuevo);
      },
      actualizarLink: async (id, cambios) => {
        const link = todo().links.find((l) => l.id === id);
        const tocaContenido = ["nombre", "url", "categoria_id", "descripcion"].some((k) => k in cambios);
        Object.assign(link, cambios, tocaContenido ? { updated_at: new Date().toISOString() } : {});
        guardar();
        return copia(link);
      },
      eliminarLink: async (id) => { todo().links = todo().links.filter((l) => l.id !== id); guardar(); },
      sumarClic: async (id) => { const l = todo().links.find((x) => x.id === id); if (l) { l.clics = (l.clics || 0) + 1; guardar(); } },
    };
  };

  const almacen = usaSupabase ? almacenSupabase() : almacenLocal();

  // ---------- Estado ----------
  const estado = {
    categorias: [],
    links: [],
    busqueda: "",
    orden: "recientes",
    editandoId: null,
    plegadas: new Set(leerPlegadas()),
  };

  function leerPlegadas() {
    try { return JSON.parse(localStorage.getItem("linkero.plegadas")) || []; } catch { return []; }
  }
  function guardarPlegadas() {
    try { localStorage.setItem("linkero.plegadas", JSON.stringify([...estado.plegadas])); } catch { /* ignorar */ }
  }

  // ---------- Utilidades ----------
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const colorSeguro = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : COLORES[0]);

  const categoriaDe = (link) => estado.categorias.find((c) => c.id === link.categoria_id);
  const categoriasOrdenadas = () =>
    [...estado.categorias].sort((a, b) => (a.orden ?? 100) - (b.orden ?? 100) || a.nombre.localeCompare(b.nombre, "es"));

  function dominio(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
  }

  function normalizarUrl(valor) {
    let v = valor.trim();
    if (!v) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = "https://" + v;
    try {
      const u = new URL(v);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
      return u.href;
    } catch { return null; }
  }

  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  function haceCuanto(iso) {
    let v = (new Date(iso).getTime() - Date.now()) / 1000;
    for (const [tam, unidad] of [[60, "second"], [60, "minute"], [24, "hour"], [30, "day"], [12, "month"], [Infinity, "year"]]) {
      if (Math.abs(v) < tam) return rtf.format(Math.round(v), unidad);
      v /= tam;
    }
  }

  let toastTimer;
  function aviso(texto) {
    const t = $("#toast");
    t.textContent = texto;
    t.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-visible"), 2400);
  }

  // ---------- Render ----------
  function filtrar(lista) {
    const q = normalizar(estado.busqueda);
    const coincide = (l) => !q || [l.nombre, categoriaDe(l)?.nombre, l.descripcion, dominio(l.url)].some((c) => normalizar(c).includes(q));
    const orden = {
      recientes: (a, b) => b.created_at.localeCompare(a.created_at),
      usados: (a, b) => (b.clics || 0) - (a.clics || 0) || a.nombre.localeCompare(b.nombre, "es"),
      az: (a, b) => a.nombre.localeCompare(b.nombre, "es"),
    }[estado.orden];
    return lista.filter(coincide).sort(orden);
  }

  function icono(cat) {
    return cat?.icono ? esc(cat.icono) : esc((cat?.nombre || "?").charAt(0).toUpperCase());
  }

  function fila(l) {
    const cat = categoriaDe(l);
    const color = colorSeguro(cat?.color);
    const clics = l.clics || 0;
    return `
      <article class="fila" style="--cat:${color}" data-id="${esc(l.id)}">
        <div class="fila__icono" aria-hidden="true">${icono(cat)}</div>
        <div class="fila__main">
          <div class="fila__linea">
            <h3 class="fila__nombre">${esc(l.nombre)}</h3>
            ${l.descripcion ? `<p class="fila__desc" title="${esc(l.descripcion)}">${esc(l.descripcion)}</p>` : ""}
          </div>
          <div class="fila__meta">
            <span title="${esc(l.url)}">${esc(dominio(l.url))}</span>
            <span>${clics} ${clics === 1 ? "clic" : "clics"}</span>
            <span title="Actualizado: ${esc(new Date(l.updated_at).toLocaleString("es"))}">act. ${esc(haceCuanto(l.updated_at))}</span>
          </div>
        </div>
        <div class="fila__acciones">
          <button class="icon-btn ${l.favorito ? "is-fav" : ""}" data-accion="favorito" type="button"
            aria-pressed="${l.favorito}" title="${l.favorito ? "Quitar de favoritos" : "Marcar como favorito"}">${l.favorito ? "★" : "☆"}</button>
          <button class="icon-btn" data-accion="editar" type="button" title="Editar">✎</button>
          <button class="icon-btn" type="button" disabled title="Archivos — próximamente" aria-label="Archivos (próximamente)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.59a2 2 0 0 1 1.41.59L12 6h6.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11Z"/></svg>
          </button>
          <a class="abrir" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" data-accion="abrir">Abrir ↗</a>
        </div>
      </article>`;
  }

  function seccion({ id, titulo, iconoHtml, color, links, buscando }) {
    const plegada = !buscando && estado.plegadas.has(id);
    return `
      <section class="seccion" id="sec-${esc(id)}" style="--cat:${color}">
        <button class="seccion__cabeza" type="button" data-plegar="${esc(id)}" aria-expanded="${!plegada}">
          <span class="seccion__icono" aria-hidden="true">${iconoHtml}</span>
          <span class="seccion__titulo">${esc(titulo)}</span>
          <span class="seccion__n">${links.length}</span>
          <span class="seccion__flecha" aria-hidden="true">▾</span>
        </button>
        <div class="lista" ${plegada ? "hidden" : ""}>${links.map(fila).join("")}</div>
      </section>`;
  }

  function render() {
    const buscando = Boolean(normalizar(estado.busqueda));
    const visibles = filtrar(estado.links);

    const grupos = [];
    const favs = visibles.filter((l) => l.favorito);
    if (favs.length) grupos.push({ id: "favoritos", titulo: "Favoritos", iconoHtml: "★", color: "#f5a623", links: favs });
    for (const cat of categoriasOrdenadas()) {
      const links = visibles.filter((l) => l.categoria_id === cat.id);
      if (links.length) grupos.push({ id: cat.id, titulo: cat.nombre, iconoHtml: icono(cat), color: colorSeguro(cat.color), links });
    }
    // Links cuya categoría no se encuentra (no debería pasar, pero no se pierden).
    const huerfanos = visibles.filter((l) => !categoriaDe(l));
    if (huerfanos.length) grupos.push({ id: "sin-categoria", titulo: "Sin categoría", iconoHtml: "?", color: "#98a2b3", links: huerfanos });

    $("#secciones").innerHTML = grupos.map((g) => seccion({ ...g, buscando })).join("");

    $("#atajos").innerHTML = grupos.map((g) => `
      <button class="chip" type="button" data-ir="${esc(g.id)}">
        <span class="chip__dot" style="background:${g.color}"></span>${esc(g.titulo)} <span class="chip__n">${g.links.length}</span>
      </button>`).join("");

    const vacio = $("#vacio");
    if (estado.links.length === 0) {
      vacio.hidden = false;
      vacio.innerHTML = `Aún no hay links.<br><button class="btn btn--primary" type="button" data-accion="nuevo">+ Agregar el primero</button>`;
    } else if (visibles.length === 0) {
      vacio.hidden = false;
      vacio.textContent = "Ningún link coincide con la búsqueda.";
    } else {
      vacio.hidden = true;
    }
  }

  // ---------- Formulario ----------
  const modal = $("#modal-link");
  const form = $("#form-link");
  const selectCat = $("#select-categoria");

  function llenarSelectCategorias(seleccion) {
    const opciones = categoriasOrdenadas().map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("");
    selectCat.innerHTML =
      `<option value="" disabled>Elige una categoría</option>` +
      opciones +
      `<option disabled>──────────</option><option value="${NUEVA}">+ Agregar categoría…</option>`;
    selectCat.value = seleccion ?? "";
    if (!selectCat.value) selectCat.selectedIndex = 0;
  }

  function llenarColores(elegido) {
    $("#colores").innerHTML = COLORES.map((c) => `
      <label class="color" style="--c:${c}" title="${c}">
        <input type="radio" name="colorCategoria" value="${c}" ${c === elegido ? "checked" : ""} />
        <span></span>
      </label>`).join("");
  }

  function mostrarNuevaCategoria(mostrar) {
    $("#nueva-cat").hidden = !mostrar;
    if (mostrar) {
      // Sugiere un color que todavía no use otra categoría.
      const usados = new Set(estado.categorias.map((c) => c.color));
      llenarColores(COLORES.find((c) => !usados.has(c)) || COLORES[0]);
      form.nuevaCategoria.value = "";
      form.nuevaCategoria.focus();
    }
  }

  function abrirFormulario(link = null) {
    estado.editandoId = link?.id ?? null;
    form.reset();
    $("#form-error").hidden = true;
    $("#modal-titulo").textContent = link ? "Editar link" : "Agregar link";
    $("#btn-eliminar").hidden = !link;
    llenarSelectCategorias(link?.categoria_id);
    mostrarNuevaCategoria(false);
    if (link) {
      form.nombre.value = link.nombre;
      form.url.value = link.url;
      form.descripcion.value = link.descripcion || "";
    }
    modal.showModal();
    form.nombre.focus();
    if (!estado.categorias.length) { selectCat.value = NUEVA; mostrarNuevaCategoria(true); form.nombre.focus(); }
  }

  selectCat.addEventListener("change", () => mostrarNuevaCategoria(selectCat.value === NUEVA));
  $("#btn-cancelar-cat").addEventListener("click", () => {
    mostrarNuevaCategoria(false);
    selectCat.selectedIndex = 0;
    selectCat.focus();
  });

  function mostrarError(texto, campo) {
    const e = $("#form-error");
    e.textContent = texto;
    e.hidden = false;
    campo?.focus();
  }

  async function resolverCategoria() {
    if (selectCat.value !== NUEVA) return selectCat.value || null;
    const nombre = form.nuevaCategoria.value.trim().replace(/\s+/g, " ");
    if (!nombre) { mostrarError("Escribe el nombre de la nueva categoría.", form.nuevaCategoria); return null; }
    // Si ya existe (sin importar mayúsculas ni tildes), se usa la existente.
    const existente = estado.categorias.find((c) => normalizar(c.nombre) === normalizar(nombre));
    if (existente) return existente.id;
    const color = form.querySelector("input[name=colorCategoria]:checked")?.value || COLORES[0];
    const nueva = await almacen.crearCategoria({ nombre, color });
    estado.categorias.push(nueva);
    return nueva.id;
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("#form-error").hidden = true;
    const nombre = form.nombre.value.trim();
    const url = normalizarUrl(form.url.value);
    const descripcion = form.descripcion.value.trim() || null;

    if (!nombre) return mostrarError("Escribe un nombre.", form.nombre);
    if (!url) return mostrarError("El link no es válido. Ejemplo: https://ejemplo.com", form.url);
    if (!selectCat.value) return mostrarError("Elige una categoría.", selectCat);

    const guardar = $("#btn-guardar");
    guardar.disabled = true;
    try {
      const categoria_id = await resolverCategoria();
      if (!categoria_id) return;
      const datos = { nombre, url, categoria_id, descripcion };
      if (estado.editandoId) {
        const act = await almacen.actualizarLink(estado.editandoId, datos);
        estado.links = estado.links.map((l) => (l.id === act.id ? act : l));
        aviso("Link actualizado");
      } else {
        estado.links.push(await almacen.crearLink(datos));
        aviso("Link agregado");
      }
      estado.plegadas.delete(categoria_id);
      guardarPlegadas();
      modal.close();
      render();
    } catch (err) {
      console.error(err);
      mostrarError(err?.code === "23505" ? "Esa categoría ya existe." : "No se pudo guardar. Intenta de nuevo.");
    } finally {
      guardar.disabled = false;
    }
  });

  $("#btn-cancelar").addEventListener("click", () => modal.close());

  $("#btn-eliminar").addEventListener("click", async () => {
    const link = estado.links.find((l) => l.id === estado.editandoId);
    if (!link || !confirm(`¿Eliminar "${link.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await almacen.eliminarLink(link.id);
      estado.links = estado.links.filter((l) => l.id !== link.id);
      modal.close();
      render();
      aviso("Link eliminado");
    } catch (err) {
      console.error(err);
      mostrarError("No se pudo eliminar. Intenta de nuevo.");
    }
  });

  // ---------- Eventos ----------
  $("#btn-agregar").addEventListener("click", () => abrirFormulario());
  $("#buscador").addEventListener("input", (e) => { estado.busqueda = e.target.value; render(); });
  $("#orden").addEventListener("change", (e) => { estado.orden = e.target.value; render(); });

  $("#atajos").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-ir]");
    if (!chip) return;
    const id = chip.dataset.ir;
    if (estado.plegadas.delete(id)) { guardarPlegadas(); render(); }
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.addEventListener("keydown", (e) => {
    const escribiendo = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (e.key === "/" && !escribiendo && !modal.open) { e.preventDefault(); $("#buscador").focus(); }
  });

  document.querySelector(".page").addEventListener("click", async (e) => {
    const plegar = e.target.closest("[data-plegar]");
    if (plegar) {
      if (normalizar(estado.busqueda)) return; // al buscar, todo queda abierto
      const id = plegar.dataset.plegar;
      estado.plegadas.has(id) ? estado.plegadas.delete(id) : estado.plegadas.add(id);
      guardarPlegadas();
      render();
      return;
    }

    const btn = e.target.closest("[data-accion]");
    if (!btn) return;
    if (btn.dataset.accion === "nuevo") return abrirFormulario();

    const link = estado.links.find((l) => l.id === btn.closest(".fila")?.dataset.id);
    if (!link) return;

    switch (btn.dataset.accion) {
      case "abrir":
        // El navegador abre el link; aquí solo sumamos el clic.
        link.clics = (link.clics || 0) + 1;
        almacen.sumarClic(link.id).catch(console.error);
        setTimeout(render, 0);
        break;
      case "editar":
        abrirFormulario(link);
        break;
      case "favorito": {
        const valor = !link.favorito;
        link.favorito = valor;
        render();
        try { await almacen.actualizarLink(link.id, { favorito: valor }); }
        catch (err) { console.error(err); link.favorito = !valor; render(); aviso("No se pudo guardar el favorito"); }
        break;
      }
    }
  });

  // ---------- Inicio ----------
  async function iniciar() {
    $("#demo-banner").hidden = usaSupabase;
    try {
      const { categorias, links } = await almacen.cargar();
      estado.categorias = categorias;
      estado.links = links;
    } catch (err) {
      console.error(err);
      $("#vacio").hidden = false;
      $("#vacio").textContent = "No se pudieron cargar los links. Revisa la conexión con Supabase.";
      return;
    }
    render();
  }

  iniciar();
})();
