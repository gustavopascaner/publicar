---
name: publicar
description: Programa, publica o gestiona publicaciones de Instagram en el Programador de Mister Robot (publicar.misterrobot.net) con el servidor MCP programador-instagram. Sube fotos/videos locales o por URL, arma imagen/carrusel/Reel, escribe o usa el texto, valida con las reglas de Instagram, confirma y programa (fecha, cola o ya). También lista lo programado, reprograma, pasa a borrador, reintenta o borra, y dice qué archivos de una carpeta ya se publicaron (los marca en el Finder o en una planilla). Usar cuando el usuario escribe /publicar, o pide "programá esto en @cuenta…", "subí este reel para el jueves", "qué tengo programado", "mové / cancelá la publicación de…", "qué videos de esta carpeta ya publiqué".
---

# /publicar — programar contenido en Instagram

Hablarle al usuario (Gus o alguien de su equipo) en español rioplatense (voseo), corto. Todo pasa por las herramientas MCP `programador-instagram`
(`mcp__programador-instagram__*`): nunca tocar la base, la app ni Meta por otro lado.

## 0 · Herramientas disponibles
- Si las herramientas `mcp__programador-instagram__*` no están cargadas: buscarlas con ToolSearch (`programador-instagram`).
- Si no existen: el MCP no está conectado en esta sesión. Que abra una sesión nueva; si sigue sin estar, revisar
  `~/.claude.json` → `mcpServers.programador-instagram` y que exista `~/.config/programador-instagram/api-key`. La
  instalación paso a paso está en el `README.md` de esta skill (el servidor es `mcp/server.mjs`, al lado de este archivo).
  **Nunca** pedirle la clave por chat ni imprimirla. Si hay que guardarla: en Mac, que la copie y diga "listo" y
  guardarla con `pbpaste` validando `^mrk_[A-Za-z0-9_-]{43}$`, sin mostrarla; en Windows, darle el comando de PowerShell
  del paso 2 del README (la pega él, oculta) y que el archivo quede en `%USERPROFILE%\.config\programador-instagram\api-key`.
- Primera llamada de cada uso: `info_api` → `nowLocal` y `timezone` (America/Argentina/Buenos_Aires). Con eso se
  resuelven las fechas relativas ("mañana", "el jueves a las 18"): **nunca** usar la hora de la máquina.

## 1 · Entender el pedido
Del texto de `/publicar …` sacar:
- **Cuenta(s)**: `listar_cuentas` con `q` (usuario o nombre). Varias coincidencias → mostrar 2–5 opciones y preguntar.
  `publishable=false` → avisar ("requiere reconexión / sin acceso": hay que reconectarla en la app) y no programarla.
- **Medios**: rutas locales (archivo o carpeta), URLs https o ids ya subidos (`listar_medios`). Carpeta → imágenes y
  videos ordenados por nombre. Tipo: 1 imagen = imagen; 2–10 = carrusel; 1 video = Reel. Más de 10 → preguntar cómo
  dividir.
- **Texto**: si Gus lo da, usarlo **tal cual**. Si da una idea/brief, redactarlo (voseo, claro, con CTA; hashtags solo si
  los pide o el tono de la cuenta los usa; ≤ 2200 caracteres, ≤ 30 hashtags, ≤ 20 menciones) y mostrarlo para aprobar.
- **Cuándo** → `mode`:
  - fecha/hora → `schedule` con `scheduledAt` local `YYYY-MM-DDTHH:MM` (debe ser futura);
  - "en la cola", "próximo horario" → `queue` (si la cuenta no tiene horarios, avisar y pedir fecha);
  - "ya", "ahora" → `now`;
  - sin fecha ni indicación → `draft` y avisar que quedó como borrador.
- Extras: `altText` por imagen si lo da, `tags` internos, `campaignId` (`listar_campanas`), `shareToFeed` (Reels).

## 2 · Subir y validar
0. Archivos locales: primero `estado_archivo` con cada archivo (o la carpeta). Si alguno ya figura **Publicado** o
   **Programado** (sobre todo en la misma cuenta), avisarlo con cuenta, fecha y enlace y preguntar antes de seguir.
   Reconoce el archivo aunque lo hayan renombrado; `reconocidoPor: nombre y tamaño` = medio viejo, menos seguro.
1. `subir_medio` por cada archivo (con `path` absoluto o `url`), en orden. Guardar los ids. Si uno falla (HEIC, GIF,
   WebM, formato raro), decir por qué y cómo convertirlo; no seguir con medios faltantes.
2. `validar_publicacion` con `caption` y `media`. Errores → corregir si es del texto (acortar, sacar hashtags) y
   mostrar el cambio; si es del medio (proporción, duración, códec), explicarlo y preguntar. Advertencias → mencionarlas
   en una línea.

## 3 · Confirmar (antes de `schedule` o `now`)
Publicar es público e irreversible. Mostrar un resumen y esperar un sí:

```
@cuenta · Carrusel (3 fotos) · jueves 30/10 18:00 (hora de Buenos Aires)
Texto: «…» (primeras líneas)
```

Saltear la confirmación solo si el mensaje de Gus ya trae cuenta, medios, texto final y fecha explícitos **y** dice
"directo" / "sin preguntar". `draft` no necesita confirmación. Varias publicaciones (plan semanal): una sola tabla
(cuenta · tipo · fecha · primeras palabras) y un solo sí.

## 4 · Crear e informar
`crear_publicacion` (una llamada puede llevar varias cuentas en `accountIds` con el mismo contenido). Informar en 1–2
líneas: estado, `scheduledAtLocal`, y que se ve en https://publicar.misterrobot.net/publicaciones. Con `now`: esperar
unos segundos, `ver_publicacion` y dar el `platformUrl` si ya está `published`; si `failed`, mostrar `lastError`.
Si la API responde un error, contarlo con sus palabras (no reintentar a ciegas).
Después, `estado_archivo` sobre los archivos locales usados para dejarlos marcados (en Mac, etiqueta del Finder
Programado/Publicado; en Windows, la planilla `estado-publicaciones.csv` de la carpeta). Mencionarlo en media línea.

## 5 · Gestionar lo existente
- "qué tengo programado [esta semana / en @cuenta]" → `listar_publicaciones` con `status=scheduled,queued` y
  `from`/`to` (días `YYYY-MM-DD`). Mostrar tabla corta: fecha local · cuenta · tipo · primeras palabras.
- "mové …" → `editar_publicacion` con `scheduledAt` nueva (conserva texto y medios).
- "cambiá el texto …" → `editar_publicacion` con `caption`.
- "cancelá / sacala" → `pasar_a_borrador` (no se pierde). **Borrar** (`borrar_publicacion`) solo si lo pide así, y
  confirmar antes; si ya estaba publicada, aclarar que no se borra de Instagram.
- "qué publiqué / qué falta publicar de esta carpeta", "marcá esta carpeta" → `estado_archivo` con la carpeta. Mostrar
  tabla corta: archivo · estado · cuenta · fecha (y enlace si está publicado). Las marcas se actualizan al consultar: una
  programada que ya salió pasa a Publicado recién en la próxima consulta.
- "falló …" → `ver_publicacion` (ver `lastError`) y, si se arregló la causa, `reintentar_publicacion`.
Para identificar "la del jueves" o "la de la promo", buscar con `listar_publicaciones` (`q`, fechas, cuenta) y, si hay
más de una, preguntar.
