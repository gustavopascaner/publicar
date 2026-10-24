#!/usr/bin/env node
/**
 * Servidor MCP (stdio) del Programador Instagram: expone la API REST /api/v1 como herramientas para Claude
 * (Claude Code, Claude Desktop u otro cliente MCP). Sin dependencias: solo Node ≥ 20.
 *
 * Configuración por variables de entorno:
 *   PROGRAMADOR_URL      URL de la app, por ejemplo https://publicar.misterrobot.net
 *   PROGRAMADOR_API_KEY  clave creada en Perfil → Claves de API (mrk_…), o bien
 *   PROGRAMADOR_API_KEY_FILE  ruta de un archivo que contiene solo la clave (así no queda en la configuración del cliente)
 *
 * Protocolo: JSON-RPC 2.0, un mensaje por línea en stdin/stdout (los registros van a stderr).
 */
import { execFile as execFileCb } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SERVER_INFO = { name: "programador-instagram", version: "1.0.0" };
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** Igual que la interfaz: hasta 8 MB en un pedido; más grande, por partes de 5 MB. */
export const SINGLE_UPLOAD_MAX = 8 * 1024 * 1024;
export const CHUNK_SIZE = 5 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 320 * 1024 * 1024;
/** Solo se suben archivos de imagen o video (nunca otro archivo local, aunque lo pida un texto de terceros). */
export const UPLOAD_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif", ".heic", ".heif", ".mp4", ".mov"];

const INSTRUCTIONS = `Programador de publicaciones de Instagram (cuentas profesionales).
- Empezá con info_api para ver la zona horaria de la app y la hora actual: las fechas sin zona ("2026-11-03T18:00") se interpretan en esa zona.
- Flujo típico: listar_cuentas → subir_medio (archivo local o URL) → validar_publicacion → crear_publicacion (mode "schedule" con scheduledAt, "queue" para el próximo horario libre de la cola, "now" para publicar ya o "draft").
- Publicar es irreversible: confirmá con el usuario cuenta, texto, medios y fecha antes de usar mode "now" o "schedule" si no lo pidió explícitamente.
- Imagen = 1 medio; carrusel = 2 a 10 medios; Reel = 1 video.
- Antes de subir un archivo local, estado_archivo dice si ya se publicó o programó (y en qué cuenta); después de programar o publicar, volver a llamarlo deja marcado el archivo.`;

const id = { type: "string", description: "Identificador (uuid)." };
const mediaItems = {
  type: "array",
  description: "Medios en orden (ids de la biblioteca). Imagen: 1; carrusel: 2 a 10; Reel: 1 video.",
  items: {
    type: "object",
    properties: { mediaId: { type: "string" }, altText: { type: "string", description: "Texto alternativo (solo imágenes)." } },
    required: ["mediaId"],
    additionalProperties: false,
  },
};
const postProps = {
  caption: { type: "string", description: "Texto de la publicación (máx. 2200 caracteres, 30 hashtags, 20 menciones)." },
  media: mediaItems,
  mode: {
    type: "string",
    enum: ["draft", "schedule", "queue", "now"],
    description: "draft = borrador; schedule = programar en scheduledAt; queue = próximo horario libre de la cola de la cuenta; now = publicar ya.",
  },
  scheduledAt: {
    type: ["string", "null"],
    description: 'Fecha y hora: ISO con zona ("2026-11-03T18:00:00-03:00") o local en la zona de la app ("2026-11-03T18:00").',
  },
  tags: { type: "array", items: { type: "string" }, description: "Etiquetas internas (no son hashtags)." },
  campaignId: { type: ["string", "null"], description: "Campaña (ver listar_campanas)." },
  shareToFeed: { type: "boolean", description: "Solo Reels: mostrarlo también en el feed (por defecto sí)." },
};

/** Definición de cada herramienta: esquema de entrada y cómo se traduce a la API REST. */
export const TOOLS = [
  {
    name: "info_api",
    description: "Usuario de la clave, permisos, zona horaria de la app, hora actual y límites de Instagram.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: (api) => api.get("/me"),
  },
  {
    name: "listar_cuentas",
    description: "Busca cuentas de Instagram conectadas (paginado). publishable=true indica que se puede publicar hoy.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Busca por usuario, nombre o Página." },
        status: { type: "string", enum: ["active", "needs_reconnect", "no_access"] },
        page: { type: "integer", minimum: 1 },
        perPage: { type: "integer", minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
    run: (api, a) => api.get("/accounts", a),
  },
  {
    name: "ver_cuenta",
    description: "Detalle de una cuenta con sus horarios de cola.",
    inputSchema: { type: "object", properties: { id }, required: ["id"], additionalProperties: false },
    run: (api, a) => api.get(`/accounts/${encodeURIComponent(a.id)}`),
  },
  {
    name: "listar_publicaciones",
    description: "Lista publicaciones ordenadas por fecha. Estados: draft, scheduled, queued, publishing, published, retrying, failed, needs_reconnect.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Uno o varios estados separados por coma." },
        accountId: { type: "string" },
        campaignId: { type: "string" },
        tag: { type: "string" },
        q: { type: "string", description: "Busca en el texto." },
        from: { type: "string", description: "Desde (YYYY-MM-DD, fecha local o ISO)." },
        to: { type: "string", description: "Hasta, exclusivo (YYYY-MM-DD, fecha local o ISO)." },
        limit: { type: "integer", minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
    run: (api, a) => api.get("/posts", a),
  },
  {
    name: "ver_publicacion",
    description: "Detalle de una publicación (estado, fecha, error, enlace en Instagram).",
    inputSchema: { type: "object", properties: { id }, required: ["id"], additionalProperties: false },
    run: (api, a) => api.get(`/posts/${encodeURIComponent(a.id)}`),
  },
  {
    name: "validar_publicacion",
    description: "Revisa texto y medios con las reglas de Instagram sin guardar nada. Devuelve errores (bloquean) y advertencias.",
    inputSchema: { type: "object", properties: { caption: postProps.caption, media: mediaItems }, additionalProperties: false },
    run: (api, a) => api.post("/posts/validate", a),
  },
  {
    name: "crear_publicacion",
    description: "Crea una publicación por cada cuenta indicada: borrador, programada, en cola o para publicar ya.",
    inputSchema: {
      type: "object",
      properties: { accountIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 }, ...postProps },
      required: ["accountIds", "mode"],
      additionalProperties: false,
    },
    run: (api, a) => api.post("/posts", a),
  },
  {
    name: "editar_publicacion",
    description:
      "Edita una publicación que todavía no se publicó (solo los campos indicados). Cambiar scheduledAt la reprograma; mode cambia su estado. No se puede cambiar la cuenta.",
    inputSchema: { type: "object", properties: { id, ...postProps }, required: ["id"], additionalProperties: false },
    run: (api, { id: postId, ...rest }) => api.patch(`/posts/${encodeURIComponent(postId)}`, rest),
  },
  {
    name: "pasar_a_borrador",
    description: "Saca una publicación de la programación o la cola y la deja como borrador.",
    inputSchema: { type: "object", properties: { id }, required: ["id"], additionalProperties: false },
    run: (api, a) => api.post(`/posts/${encodeURIComponent(a.id)}/draft`, {}),
  },
  {
    name: "reintentar_publicacion",
    description: "Vuelve a intentar ya una publicación con error.",
    inputSchema: { type: "object", properties: { id }, required: ["id"], additionalProperties: false },
    run: (api, a) => api.post(`/posts/${encodeURIComponent(a.id)}/retry`, {}),
  },
  {
    name: "borrar_publicacion",
    description: "Borra una publicación de la app (si ya se publicó, NO la borra de Instagram).",
    inputSchema: { type: "object", properties: { id }, required: ["id"], additionalProperties: false },
    run: (api, a) => api.del(`/posts/${encodeURIComponent(a.id)}`),
  },
  {
    name: "listar_medios",
    description: "Archivos de la biblioteca (más nuevos primero). available=false: venció o ya no está en el servidor.",
    inputSchema: {
      type: "object",
      properties: { q: { type: "string", description: "Busca por nombre de archivo." }, limit: { type: "integer", minimum: 1, maximum: 200 } },
      additionalProperties: false,
    },
    run: (api, a) => api.get("/media", a),
  },
  {
    name: "subir_medio",
    description:
      "Sube una imagen (JPG, PNG, WebP, AVIF) o un video (MP4, MOV) a la biblioteca desde un archivo local (path) o una URL pública https (url). Devuelve el id para usar en media.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Ruta absoluta de un archivo local." },
        url: { type: "string", description: "URL https del archivo (la descarga el servidor)." },
        name: { type: "string", description: "Nombre a mostrar en la biblioteca (opcional)." },
      },
      additionalProperties: false,
    },
    run: (api, a, deps) => uploadMedia(api, a, deps),
  },
  {
    name: "estado_archivo",
    description:
      "Dice si imágenes o videos de la computadora (un archivo o todos los de una carpeta, sin subcarpetas) ya se subieron y en qué publicaciones están: Publicado (con enlace), Programado, Con error, Borrador, Subido sin usar o No subido. Los reconoce por su huella (SHA-256) aunque los hayan renombrado o movido. Con marcar (por defecto sí) deja el estado a la vista: etiquetas de colores del Finder en macOS y la planilla estado-publicaciones.csv en la carpeta en Windows u otros sistemas.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Ruta absoluta de un archivo o de una carpeta." },
        marcar: { type: "boolean", description: "Etiquetas del Finder (macOS) o planilla (otros). Por defecto true." },
        planilla: { type: "boolean", description: "Escribir también estado-publicaciones.csv en macOS (en Windows siempre se escribe si marcar=true)." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    run: (api, a, deps) => fileStatus(api, a, deps),
  },
  {
    name: "listar_campanas",
    description: "Campañas (para campaignId) y etiquetas existentes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: (api) => api.get("/campaigns"),
  },
];

export class ToolError extends Error {}

/** Cliente mínimo de la API REST. */
export function createApi({ baseUrl, apiKey, fetchImpl = fetch }) {
  const root = `${String(baseUrl).replace(/\/+$/, "")}/api/v1`;
  async function call(method, p, { query, body, raw, headers = {} } = {}) {
    const u = new URL(root + p);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
    const init = { method, headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", ...headers } };
    if (raw !== undefined) init.body = raw;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers["Content-Type"] = "application/json";
    }
    let res;
    try {
      res = await fetchImpl(u, init);
    } catch (e) {
      throw new ToolError(`No se pudo conectar con ${root}: ${e?.cause?.code ?? e?.message ?? e}`);
    }
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new ToolError(`Respuesta inesperada (${res.status}) de la API: ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      const issues = Array.isArray(data.issues) ? `\n${data.issues.map((i) => `- ${i.account ?? ""}: ${(i.messages ?? []).join("; ")}`).join("\n")}` : "";
      throw new ToolError(`${data.error ?? `Error ${res.status}`}${issues}`);
    }
    return data;
  }
  return {
    get: (p, query) => call("GET", p, { query }),
    post: (p, body) => call("POST", p, { body }),
    patch: (p, body) => call("PATCH", p, { body }),
    del: (p) => call("DELETE", p),
    raw: (method, p, opts) => call(method, p, opts),
  };
}

async function uploadMedia(api, args, { readFile = fs.readFile, stat = fs.stat } = {}) {
  if (Boolean(args.path) === Boolean(args.url)) throw new ToolError("Indicá path (archivo local) o url, uno de los dos.");
  if (args.url) return api.post("/media", { url: args.url, ...(args.name ? { name: args.name } : {}) });

  const file = path.resolve(args.path);
  const ext = path.extname(file).toLowerCase();
  if (!UPLOAD_EXTENSIONS.includes(ext)) throw new ToolError(`Solo se suben imágenes o videos (${UPLOAD_EXTENSIONS.join(", ")}).`);
  const st = await stat(file).catch(() => null);
  if (!st || !st.isFile()) throw new ToolError(`No existe el archivo ${file}.`);
  if (st.size === 0) throw new ToolError("El archivo está vacío.");
  if (st.size > MAX_UPLOAD_BYTES) throw new ToolError("El archivo supera el máximo de 320 MB.");
  const name = args.name?.trim() || path.basename(file);
  const bytes = await readFile(file);

  if (bytes.length <= SINGLE_UPLOAD_MAX) {
    const form = new FormData();
    form.append("file", new Blob([bytes]), name);
    const r = await api.raw("POST", "/media", { raw: form });
    return { media: r.media[0], errors: r.errors };
  }
  const uploadId = crypto.randomUUID();
  const total = Math.ceil(bytes.length / CHUNK_SIZE);
  let last;
  for (let i = 0; i < total; i++) {
    const part = bytes.subarray(i * CHUNK_SIZE, Math.min(bytes.length, (i + 1) * CHUNK_SIZE));
    last = await api.raw("POST", "/media/chunk", {
      query: { uploadId, index: i, total, size: bytes.length, name },
      raw: part,
      headers: { "Content-Type": "application/octet-stream" },
    });
  }
  if (!last?.done) throw new ToolError("La subida por partes no terminó.");
  return { media: last.media };
}

// ---------- Estado de archivos locales (estado_archivo) ----------

/** Máximo de archivos por consulta (igual que la API). */
export const STATUS_MAX_FILES = 500;
export const STATUS_CSV = "estado-publicaciones.csv";

/** Estado resumido (API) → etiqueta a mostrar y color de etiqueta del Finder (1 gris, 2 verde, 5 amarillo, 6 rojo). */
export const STATE_LABELS = {
  published: { label: "Publicado", color: 2 },
  publishing: { label: "Programado", color: 5 },
  scheduled: { label: "Programado", color: 5 },
  error: { label: "Con error", color: 6 },
  draft: { label: "Borrador", color: 1 },
  uploaded: { label: "Subido sin usar", color: null },
  not_uploaded: { label: "No subido", color: null },
};
/** Etiquetas que pone el MCP: solo estas se reemplazan; las demás etiquetas del archivo se conservan. */
export const OWN_TAGS = ["Publicado", "Programado", "Con error", "Borrador"];

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    createReadStream(file)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

const execFileP = (cmd, args) =>
  new Promise((resolve, reject) => execFileCb(cmd, args, { maxBuffer: 1024 * 1024 }, (e, stdout) => (e ? reject(e) : resolve(String(stdout)))));

// Etiquetas del Finder = atributo extendido com.apple.metadata:_kMDItemUserTags: un plist binario con un arreglo de
// textos "Nombre\nColor". Se lee y escribe con /usr/bin/xattr (viene con macOS).
const TAGS_XATTR = "com.apple.metadata:_kMDItemUserTags";

/** Plist binario (bplist00) → arreglo de textos, o null si no es eso. */
export function decodeTagPlist(buf) {
  try {
    if (buf.length < 40 || buf.subarray(0, 8).toString("latin1") !== "bplist00") return null;
    const t = buf.subarray(buf.length - 32);
    const offSize = t[6];
    const refSize = t[7];
    const numObjects = Number(t.readBigUInt64BE(8));
    const top = Number(t.readBigUInt64BE(16));
    const tableAt = Number(t.readBigUInt64BE(24));
    const readUInt = (at, size) => buf.readUIntBE(at, size);
    const offsetOf = (i) => readUInt(tableAt + i * offSize, offSize);
    // Largo de un objeto: en el marcador (0–14) o, si es 15, un entero a continuación.
    const lengthAt = (at) => {
      const low = buf[at] & 0x0f;
      if (low !== 0x0f) return [low, at + 1];
      const size = 1 << (buf[at + 1] & 0x0f);
      return [readUInt(at + 2, size), at + 2 + size];
    };
    const readString = (i) => {
      const at = offsetOf(i);
      const kind = buf[at] >> 4;
      const [n, start] = lengthAt(at);
      if (kind === 0x5) return buf.subarray(start, start + n).toString("latin1");
      if (kind === 0x6) return Buffer.from(buf.subarray(start, start + n * 2)).swap16().toString("utf16le");
      throw new Error("no es texto");
    };
    if (top >= numObjects) return null;
    const at = offsetOf(top);
    if (buf[at] >> 4 !== 0xa) return null;
    const [n, start] = lengthAt(at);
    const out = [];
    for (let k = 0; k < n; k++) out.push(readString(readUInt(start + k * refSize, refSize)));
    return out;
  } catch {
    return null;
  }
}

/** Arreglo de textos → plist binario (bplist00). */
export function encodeTagPlist(tags) {
  const lenMarker = (kind, n) => {
    if (n < 15) return Buffer.from([(kind << 4) | n]);
    if (n < 256) return Buffer.from([(kind << 4) | 0xf, 0x10, n]);
    const b = Buffer.alloc(4);
    b[0] = (kind << 4) | 0xf;
    b[1] = 0x11;
    b.writeUInt16BE(n, 2);
    return b;
  };
  const refSize = tags.length + 1 < 256 ? 1 : 2;
  const objects = [];
  const refs = Buffer.alloc(tags.length * refSize);
  tags.forEach((_, i) => refs.writeUIntBE(i + 1, i * refSize, refSize));
  objects.push(Buffer.concat([lenMarker(0xa, tags.length), refs]));
  for (const tag of tags) {
    if (/^[\x00-\x7f]*$/.test(tag)) objects.push(Buffer.concat([lenMarker(0x5, tag.length), Buffer.from(tag, "latin1")]));
    else {
      const u = Buffer.from(tag, "utf16le").swap16();
      objects.push(Buffer.concat([lenMarker(0x6, u.length / 2), u]));
    }
  }
  const header = Buffer.from("bplist00", "latin1");
  const offsets = [];
  let pos = header.length;
  for (const o of objects) {
    offsets.push(pos);
    pos += o.length;
  }
  const offSize = pos < 256 ? 1 : pos < 65536 ? 2 : 4;
  const table = Buffer.alloc(offsets.length * offSize);
  offsets.forEach((o, i) => table.writeUIntBE(o, i * offSize, offSize));
  const trailer = Buffer.alloc(32);
  trailer[6] = offSize;
  trailer[7] = refSize;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(pos), 24);
  return Buffer.concat([header, ...objects, table, trailer]);
}

/** Etiquetas nuevas: las ajenas tal cual + la del estado (si tiene). Las propias viejas se sacan. */
export function mergeTags(current, state) {
  const own = new Set(OWN_TAGS);
  const kept = current.filter((t) => !own.has(t.split("\n")[0]));
  const s = STATE_LABELS[state];
  return s?.color ? [...kept, `${s.label}\n${s.color}`] : kept;
}

/** Pone la etiqueta del estado a un archivo (macOS). Devuelve un aviso si no pudo, o null. */
export async function setFinderTag(file, state, exec = execFileP) {
  let current = [];
  try {
    const hex = (await exec("/usr/bin/xattr", ["-px", TAGS_XATTR, file])).replace(/\s+/g, "");
    current = decodeTagPlist(Buffer.from(hex, "hex"));
    if (!current) return `${path.basename(file)}: no se entendieron sus etiquetas actuales; no se tocaron.`;
  } catch {
    current = []; // sin etiquetas todavía
  }
  const next = mergeTags(current, state);
  if (next.length === current.length && next.every((t, i) => t === current[i])) return null;
  try {
    if (next.length === 0) await exec("/usr/bin/xattr", ["-d", TAGS_XATTR, file]);
    else await exec("/usr/bin/xattr", ["-wx", TAGS_XATTR, encodeTagPlist(next).toString("hex"), file]);
    return null;
  } catch (e) {
    return `${path.basename(file)}: no se pudo poner la etiqueta (${e?.message ?? e}).`;
  }
}

// Planilla para Excel: UTF-8 con BOM, separador ";" (Excel en español), todo entre comillas y guarda de fórmulas.
const CSV_HEADER = ["Archivo", "Estado", "Publicaciones", "Enlaces", "Revisado"];
const csvCell = (v) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
export const csvLine = (cells) => cells.map(csvCell).join(";");

/** Lee una planilla escrita por csvLine (campos entre comillas, ";"). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ";") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const POST_STATUS_LABELS = {
  draft: "Borrador",
  scheduled: "Programada",
  queued: "En cola",
  publishing: "Publicando",
  published: "Publicada",
  retrying: "Reintentando",
  failed: "Falló",
  needs_reconnect: "Requiere reconexión",
};
// Empieza con letra (no con "@"), así Excel no lo toma como fórmula.
const postSummary = (p) => {
  const when = p.status === "published" ? p.publishedAtLocal : p.scheduledAtLocal;
  return `${POST_STATUS_LABELS[p.status] ?? p.status} en @${p.account ?? "?"}${when ? ` el ${when.replace("T", " ")}` : ""}${p.remoteDeleted ? " (borrada de Instagram)" : ""}`;
};

/** Fila de la planilla para un archivo. */
export function csvRow(f, checkedLocal) {
  return [f.name, f.estado, f.posts.map(postSummary).join(" | "), f.posts.map((p) => p.platformUrl).filter(Boolean).join(" "), checkedLocal];
}

/** Planilla nueva = filas viejas de otros archivos + filas de esta consulta, ordenadas por nombre. */
export function mergeCsv(existingText, rows) {
  // Las celdas viejas ya vienen con la guarda de fórmulas ("'" adelante): se comparan sin ella y se escriben tal cual.
  const unguard = (s) => s.replace(/^'(?=[=+\-@\t\r])/, "");
  const names = new Set(rows.map((r) => r[0]));
  const old = existingText ? parseCsv(existingText).slice(1).filter((r) => r.length >= 2 && !names.has(unguard(r[0]))) : [];
  const all = [...old, ...rows.map((r) => r.map((c) => String(c ?? "")))].sort((a, b) => unguard(a[0]).localeCompare(unguard(b[0]), "es"));
  return `﻿${[CSV_HEADER, ...all].map(csvLine).join("\r\n")}\r\n`;
}

const nowLocalText = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

async function fileStatus(api, args, deps = {}) {
  const {
    stat = fs.stat,
    readdir = fs.readdir,
    hashFile = sha256File,
    platform = process.platform,
    tagFile = setFinderTag,
    readText = (p) => fs.readFile(p, "utf8"),
    writeText = (p, t) => fs.writeFile(p, t, "utf8"),
    now = new Date(),
  } = deps;
  if (!args.path) throw new ToolError("Indicá path (un archivo o una carpeta).");
  const target = path.resolve(args.path);
  const st = await stat(target).catch(() => null);
  if (!st) throw new ToolError(`No existe ${target}.`);

  const isMedia = (n) => UPLOAD_EXTENSIONS.includes(path.extname(n).toLowerCase()) && !n.startsWith(".");
  let folder;
  let files;
  const avisos = [];
  if (st.isDirectory()) {
    folder = target;
    const names = (await readdir(target)).filter(isMedia).sort((a, b) => a.localeCompare(b, "es"));
    if (names.length > STATUS_MAX_FILES) avisos.push(`La carpeta tiene ${names.length} imágenes o videos: se revisaron los primeros ${STATUS_MAX_FILES}.`);
    files = names.slice(0, STATUS_MAX_FILES).map((n) => path.join(target, n));
  } else {
    if (!isMedia(path.basename(target))) throw new ToolError(`Solo se revisan imágenes o videos (${UPLOAD_EXTENSIONS.join(", ")}).`);
    folder = path.dirname(target);
    files = [target];
  }
  if (files.length === 0) return { carpeta: folder, files: [], resumen: {}, marcado: null, avisos: ["No hay imágenes ni videos en esa carpeta."] };

  const local = [];
  for (const f of files) {
    const s = await stat(f).catch(() => null);
    if (!s || !s.isFile()) continue;
    local.push({ path: f, name: path.basename(f), size: s.size, sha256: await hashFile(f) });
  }
  const r = await api.post("/media/status", { files: local.map(({ sha256, name, size }) => ({ sha256, name, size })) });
  const out = local.map((l, i) => {
    const s = r.files[i];
    return {
      path: l.path,
      name: l.name,
      estado: STATE_LABELS[s.state]?.label ?? s.state,
      state: s.state,
      ...(s.match === "name_size" ? { reconocidoPor: "nombre y tamaño (subido antes de la huella)" } : {}),
      mediaIds: s.mediaIds,
      posts: s.posts,
    };
  });
  const resumen = {};
  for (const f of out) resumen[f.estado] = (resumen[f.estado] ?? 0) + 1;

  let marcado = null;
  if (args.marcar !== false) {
    const marks = [];
    if (platform === "darwin") {
      for (const f of out) {
        const problem = await tagFile(f.path, f.state);
        if (problem) avisos.push(problem);
      }
      marks.push("etiquetas del Finder");
    }
    if (platform !== "darwin" || args.planilla) {
      const csvPath = path.join(folder, STATUS_CSV);
      const old = await readText(csvPath).catch(() => "");
      const checked = nowLocalText(now);
      try {
        await writeText(csvPath, mergeCsv(old, out.map((f) => csvRow(f, checked))));
        marks.push(`planilla ${csvPath}`);
      } catch (e) {
        avisos.push(`No se pudo escribir ${csvPath} (${e?.code ?? e?.message ?? e}). Si está abierta en Excel, cerrala y volvé a consultar.`);
      }
    }
    marcado = marks.join(" y ") || null;
  }
  return { carpeta: folder, files: out, resumen, marcado, avisos };
}

/** Problema de configuración (o null). La clave nunca viaja por http salvo a la propia máquina. */
export function configProblem(baseUrl, apiKey) {
  if (!baseUrl) return "Falta PROGRAMADOR_URL (por ejemplo https://publicar.misterrobot.net).";
  if (!apiKey) return "Falta la clave: definí PROGRAMADOR_API_KEY o PROGRAMADOR_API_KEY_FILE (creala en Perfil → Claves de API).";
  if (!/^mrk_[A-Za-z0-9_-]{43}$/.test(apiKey)) return "La clave no tiene el formato mrk_… (revisá que se haya copiado entera, sin espacios).";
  let u;
  try {
    u = new URL(baseUrl);
  } catch {
    return "PROGRAMADOR_URL no es una URL válida.";
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return "PROGRAMADOR_URL debe ser https (salvo localhost).";
  return null;
}

/** Arma el manejador de mensajes JSON-RPC. Devuelve la respuesta o null (notificaciones). */
export function createHandler({ baseUrl, apiKey, fetchImpl, ...deps } = {}) {
  const problem = configProblem(baseUrl, apiKey);
  const api = problem ? null : createApi({ baseUrl, apiKey, fetchImpl });
  const reply = (msgId, result) => ({ jsonrpc: "2.0", id: msgId, result });
  const fail = (msgId, code, message) => ({ jsonrpc: "2.0", id: msgId, error: { code, message } });

  return async function handle(msg) {
    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      return msg && "id" in msg ? fail(msg.id ?? null, -32600, "Solicitud inválida.") : null;
    }
    const isNotification = !("id" in msg);
    const { method, params = {} } = msg;
    if (isNotification) return null;

    switch (method) {
      case "initialize": {
        const asked = params.protocolVersion;
        return reply(msg.id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      }
      case "ping":
        return reply(msg.id, {});
      case "tools/list":
        return reply(msg.id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case "tools/call": {
        const tool = TOOLS.find((t) => t.name === params.name);
        if (!tool) return fail(msg.id, -32602, `Herramienta desconocida: ${params.name}`);
        if (problem) return reply(msg.id, { content: [{ type: "text", text: `Configuración incompleta: ${problem}` }], isError: true });
        try {
          const result = await tool.run(api, params.arguments ?? {}, deps);
          return reply(msg.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
        } catch (e) {
          const text = e instanceof ToolError ? e.message : `Error inesperado: ${e?.message ?? e}`;
          return reply(msg.id, { content: [{ type: "text", text }], isError: true });
        }
      }
      default:
        return fail(msg.id, -32601, `Método no soportado: ${method}`);
    }
  };
}

/** Bucle stdio: una línea = un mensaje. */
export function serveStdio(handle, { input = process.stdin, output = process.stdout } = {}) {
  let buf = "";
  const send = (obj) => output.write(`${JSON.stringify(obj)}\n`);
  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido." } });
        continue;
      }
      Promise.resolve(handle(msg))
        .then((r) => r && send(r))
        .catch((e) => process.stderr.write(`[mcp] ${e?.stack ?? e}\n`));
    }
  });
}

/** Lee la clave de un archivo (con `~` = carpeta personal). Vacío si no existe. */
export function readKeyFile(file, home = os.homedir()) {
  if (!file) return "";
  const resolved = /^~[\\/]/.test(file) ? path.join(home, file.slice(2)) : file;
  try {
    // Sin BOM ni espacios: en Windows algunos editores y PowerShell agregan un BOM al principio.
    return readFileSync(resolved, "utf8").replace(/^\uFEFF/, "").trim();
  } catch {
    process.stderr.write(`[mcp] no se pudo leer la clave de ${resolved}\n`);
    return "";
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseUrl = process.env.PROGRAMADOR_URL?.trim();
  const apiKey = process.env.PROGRAMADOR_API_KEY?.trim() || readKeyFile(process.env.PROGRAMADOR_API_KEY_FILE?.trim());
  const problem = configProblem(baseUrl, apiKey);
  if (problem) process.stderr.write(`[mcp] ${problem}\n`);
  serveStdio(createHandler({ baseUrl, apiKey }));
}
