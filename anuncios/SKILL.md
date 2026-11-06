---
name: anuncios
description: Arma y gestiona campañas publicitarias de Meta (solo ubicaciones de Instagram) con el MCP oficial de Meta Ads (herramientas ads_*). Elige cuenta publicitaria, objetivo, presupuesto, público y creatividad (publicación ya publicada, o imagen, carrusel o video locales, que sube con un enlace temporal por el FTP de landing.misterrobot.net y borra del servidor cuando Meta ya los tiene), muestra el gasto estimado, confirma y deja la campaña como borrador en Ads Manager; la publica solo si el usuario lo pide; también pausa, edita y consulta estado y métricas. Usar cuando el usuario escribe /anuncios, o pide "promocioná este post", "armá una campaña de tráfico para @cuenta", "subí este video como anuncio", "pausá la campaña…", "cómo va la campaña…".
---

# /anuncios — campañas de Meta por el MCP de Meta Ads, con ubicaciones solo en Instagram

Hablarle al usuario (Gus o su equipo) en español rioplatense (voseo), corto. **Las campañas gastan dinero real**: nada se
publica ni se activa sin un sí explícito. Seguir también lo que diga la descripción de cada herramienta: es la fuente de verdad.

## 0 · Herramientas y chequeos
- MCP de Meta Ads: si las herramientas `ads_*` no están cargadas, ToolSearch (`+ads_ create campaign`). Si no existen, el
  conector de Meta Ads no está conectado: avisar y parar.
- `ads_get_ad_accounts` (seguir `next_cursor`: son muchas cuentas). Elegir por nombre, negocio o moneda; muchas se llaman
  solo con su número, así que si hay dudas preguntar. Con `is_ads_mcp_enabled=false` o `account_status` distinto de `ACTIVE`
  decir por qué y no seguir con esa cuenta. Avisar si `has_payment_method=false`. Anotar `currency` y `min_daily_budget_cents`.
- `ads_get_ig_accounts`: la cuenta de Instagram que anuncia y su `page_id` (si no trae, preguntar qué Página usar; ver también
  `ads_get_ad_account_pages`). Sin Instagram vinculado no se puede seguir: se vincula en la configuración del negocio.
- En las herramientas que lo piden usar `advertiser_job`: `create_and_launch_new_ads` para crear, `update_existing_campaigns`
  para cambiar, `report_measure_or_look_up` o `assess_and_optimize_performance` para métricas.

## 1 · Entender el pedido
Del texto sacar, preguntando solo lo que falte (una pregunta corta con 2–3 opciones, no un cuestionario):

- **Objetivo** (`objective` en la campaña; `optimization_goal` y `destination_type` en el conjunto; `billing_event: IMPRESSIONS`, `buying_type: AUCTION`):

  | Pedido | objective | optimization_goal | destination_type |
  | --- | --- | --- | --- |
  | Tráfico a un sitio | `OUTCOME_TRAFFIC` | `LINK_CLICKS` o `LANDING_PAGE_VIEWS` | `WEBSITE` |
  | Promocionar un post sin más | `OUTCOME_ENGAGEMENT` | `POST_ENGAGEMENT` | `ON_POST` |
  | Reproducciones de video | `OUTCOME_ENGAGEMENT` | `THRUPLAY` | `ON_VIDEO` |
  | Alcance | `OUTCOME_AWARENESS` | `REACH` | (no enviar) |
  | Contactos con píxel | `OUTCOME_LEADS` | `OFFSITE_CONVERSIONS` | `WEBSITE` |
  | Ventas con píxel | `OUTCOME_SALES` | `OFFSITE_CONVERSIONS` | `WEBSITE` |
  | WhatsApp | ver «WhatsApp» abajo | `CONVERSATIONS` | `WHATSAPP` |

  Con píxel: `promoted_object` `{"pixel_id":"…","custom_event_type":"LEAD"}` (o `PURCHASE`); los píxeles salen de `ads_get_datasets`.
- **Presupuesto**: en la campaña por defecto (`campaign_daily_budget` o `campaign_lifetime_budget`), en la **unidad mínima de la
  moneda** (ARS 5.000 → `500000`; USD 10 → `1000`). Por conjunto solo si lo pide. No puede quedar por debajo de
  `min_daily_budget_cents`. Si no da monto o no queda claro si es diario o total, preguntar: nunca inventar ni convertir un
  monto mensual por tu cuenta. Total exige fecha de fin.
- **Fechas** (`start_time`, `end_time` en el conjunto): sin fin = corre hasta que se pause (decirlo).
- **Público** (`targeting`, JSON en texto):
  - Lugar: `geo_locations` (`countries` con códigos de 2 letras). Es un límite real.
  - **Por defecto Meta usa Público Advantage+** y trata edad, género, intereses y públicos como **sugerencias**, no como límites:
    no enviar `targeting_automation`; la edad va en `"age_range":[30,50]` sin `age_max`, y `age_min` entre 18 y 25. Decirlo en el resumen.
    Si Gus pide que nadie fuera de ese rango lo vea, o que lo apague, enviar `targeting_automation.advantage_audience: 0` con
    `advantage_audience_off_reason` (ver la descripción de `ads_create_ad_set`) y `age_min`/`age_max` reales.
  - Ciudades, regiones e intereses: **no inventar nunca los ids**. El MCP de Meta no los busca; es la única consulta que sigue
    en el otro servidor: `mcp__programador-instagram__buscar_segmentacion_ads` (`type: "geo"` / `"interest"`, `q`), solo lectura.
    Si no está disponible, usar país y decirlo.
  - Públicos: `ads_get_ad_account_custom_audiences`. Sin datos, proponer algo razonable (país de la cuenta, 25–55) y decirlo.
- **Ubicaciones**: solo Instagram, siempre: `"publisher_platforms":["instagram"]` e `"instagram_positions":["stream","story","reels"]`
  dentro de `targeting` (`explore_home` si lo pide).
- **Creatividad** (`ads_create_creative`, siempre con `page_id` e `instagram_user_id`):
  - Publicación ya publicada → la opción más simple: `ads_get_ig_media` y usar su `id`. Con `ads_boost_ig_post`, primero
    `confirmed=false` para ver el plan y `confirmed=true` solo tras el sí. **Pasar siempre `targeting`, presupuesto, objetivo y
    fechas**: sus valores por defecto apuntan a Estados Unidos. O `source_instagram_media_id` en `ads_create_creative`.
  - Imagen, carrusel o video locales → ver el paso 2.
  - Texto principal (`message` o `primary_texts`), título (`headline`), botón (`call_to_action_type`) y `link_url` (obligatorio
    en tráfico, contactos y ventas). En video, `description` también exige `link_url`.
  - **Contenido con IA** (`self_ai_disclosure`): preguntarle siempre al usuario si el material se hizo o editó con IA generativa
    (los videos de /motion y /edicion suelen tener voz o b-roll IA). No decidirlo por él. Se define antes de crear: después no se cambia.
- **WhatsApp** ("que escriban por WhatsApp"): `objective: "OUTCOME_LEADS"` (o `OUTCOME_ENGAGEMENT` si pide interacción),
  `optimization_goal: "CONVERSATIONS"`, `destination_type: "WHATSAPP"`, `call_to_action_type: "WHATSAPP_MESSAGE"` y **sin** `link_url`.
  El número se toma de la Página: no pedirlo. Si Meta dice que falta, se vincula en la configuración de WhatsApp de la Página.
  **Plantilla de mensaje**: `ads_create_creative` no la define, así que se usa el saludo por defecto de la Página. Decirlo en el
  resumen; si quiere una plantilla propia, se elige en Ads Manager antes de publicar.
- Nombre de campaña, conjunto y anuncio: proponerlos a partir del pedido ("Promo turnos · nov 2026").

## 2 · Subir imágenes y videos locales (enlace temporal)
Antes de subir un video, mirar si ya está con `ads_get_ad_videos` (`title`). Si hay que subirlo:

```bash
python3 -I ~/.claude/skills/publicar/anuncios/scripts/enlace_temporal.py subir "<archivo>"
```
Devuelve `url` y `token`. Sube a `landing.misterrobot.net/_tmp-anuncios/<fecha>-<azar>/` con la cuenta FTP de /marca (la
contraseña está en el Llavero; si falta, el error dice qué comando debe correr la persona en su terminal). Nunca pedir la
contraseña por el chat. No usar `subir.py` de /marca para esto.

1. `ads_creative_upload_media` con `upload_source: "URL"`, `media_type` (`VIDEO` o `IMAGE`), `media_url` y `name`. Si Meta no
   puede bajarlo, esperar unos segundos y reintentar una vez (el servidor puede dar un error 412 pasajero justo tras la subida).
2. Imagen: la respuesta ya trae el `image_hash`. Video: consultar `ads_get_ad_videos` con `video_ids` y `fields: ["status","picture"]`
   hasta que `status.video_status` sea `ready` (un video de 1 minuto y 130 MB tardó menos de 2 minutos), esperando un minuto entre
   consultas. Sin video listo no se crea la creatividad.
3. **Borrar del servidor apenas Meta lo tenga** (imagen con hash, video `ready`), o si la subida a Meta falló definitivamente:
   ```bash
   python3 -I ~/.claude/skills/publicar/anuncios/scripts/enlace_temporal.py borrar "<token>"
   ```
   Confirmar `"borrado": true` y decirle al usuario que se borró. **Nunca terminar sin borrar**, salvo un video que siga
   procesando: en ese caso seguir esperando, y si hay que cortar, avisar y dar el comando. Si queda algo, `lista` lo muestra y
   `limpiar` borra lo de más de 24 horas (cada `subir` también lo hace).
4. **Miniatura del video** (obligatoria): extraer un fotograma con `ffmpeg -ss <seg> -i <video> -frames:v 1 <salida.jpg>` a una
   carpeta temporal y subirlo por este mismo camino como `IMAGE`, antes de borrar nada o en una subida aparte. `picture` sirve solo
   como último recurso: es chica (160 px) y, mientras el video procesa, es una imagen de relleno.
   **En el creativo de video pasar solo `image_hash`, nunca `image_url`.** Con `image_url` la herramienta guarda los dos campos y
   valida bien, pero al publicar Meta rechaza el anuncio (`ObjectStorySpecRedundant`, #1443051) y también avisa que falta la cuenta de
   Instagram (#1772103). El MCP no devuelve el error: el anuncio vuelve a borrador y Ads Manager lo muestra vacío, sin video, textos,
   botón ni cuenta. Si ya pasó, crear un creativo nuevo con `image_hash` y asignarlo con `ads_update_entity` (`creative: {"creative_id":"…"}`).

Carrusel: `cards` de 2 a 10, cada una con `image_hash` o `video_id`, y `headline` y `link` opcionales.

## 3 · Confirmar (siempre, antes de crear)
Mostrar un resumen y esperar un sí:

```
Cuenta: Clínica Ads (ARS) · anuncia @cuenta
Objetivo: Tráfico · optimiza clics en el enlace · se cobra por impresiones
Presupuesto: ARS 5.000 por día, del 3/11 09:00 al 17/11 (gasto máximo estimado ARS 70.000)   ← si no hay fin: "sin fecha de fin: gasta hasta que la pauses"
Público: Argentina · Advantage+ activo; 25–55 e intereses son sugerencias
Ubicaciones: feed, historias, reels (solo Instagram)
Anuncio: video «turnos.mp4» · botón Más información → https://…   ← WhatsApp: "botón WhatsApp · saludo por defecto de la Página"
Contenido hecho con IA: sí / no
Queda como borrador (no gasta). ¿Lo publico al terminar? (sí / no)
```
No saltear nunca esta confirmación, aunque el mensaje diga "directo": acá hay dinero.

## 4 · Crear e informar
1. `ads_create_campaign` → `ads_create_ad_set` (usar `valid_optimization_goals` de la respuesta) → `ads_create_creative` →
   `ads_create_ad` con `creative: {"creative_id":"…"}`. Usar `hide_ui: true` al crear los tres niveles juntos.
2. Revisar `active_errors` en cada respuesta y corregir con `ads_update_entity`. Lo que dependa del usuario, explicarlo en una línea y preguntar.
3. `ads_get_ad_preview` y pasar el `preview_url` como enlace.
4. **Publicar es un paso aparte, con su propio sí.** Si las respuestas traen `status=DRAFT`, todo está en el borrador de Ads Manager y no gasta.
   `ads_activate_entity` sobre la campaña lo publica, y **publicar puede dejarla activa y gastando**: las descripciones de las
   herramientas no coinciden sobre si queda activa o como estaba, así que tratarla como activa hasta leer el estado real. No usar
   `publish_as_active` ni `ignore_validation_errors` sin pedido explícito. Si Gus quiere la campaña en Meta sin que gaste: en el borrador,
   `ads_update_entity` con `{"status":"PAUSED"}` en la campaña, y después `ads_activate_entity` con `publish_as_active: false`. Queda
   publicada y apagada. Si las respuestas traen `status=PAUSED` (sin modo borrador), activar de arriba abajo: campaña, conjunto, anuncio.
5. Publicó → verificar con `ads_get_ad_entities` los tres niveles, **anuncios incluidos** (`fields`: `effective_status`, verificados
   antes con `ads_get_field_context`) e informar lo que se lee ahí, no lo que se pidió. `PUBLISHING` todavía no confirma nada: campaña y
   conjunto pueden salir y los anuncios quedar en borrador sin ningún error. Si pasa, no reintentar igual: pedirle a Gus el error que
   muestra Ads Manager. Los anuncios en revisión figuran `IN_PROCESS`.
6. Informar en 2 líneas: estado, id de campaña, presupuesto, y que el archivo temporal ya se borró del servidor.

## 5 · Gestionar lo existente
- "cómo va / cuánto gastó" → `ads_get_ad_entities` (`level: campaign`, `amount_spent`, `impressions`, `reach`, `clicks`, `results`, `cost_per_result`,
  `effective_status`; verificar los campos con `ads_get_field_context`). Hacer todas las `next_actions` de solo lectura que devuelva. Tabla corta.
- "pausá …" → `ads_update_entity` con `fields: {"status":"PAUSED"}` y nada más (sin confirmación extra: deja de gastar). **No llamar a
  `ads_activate_entity` después**: puede deshacer la pausa. Verificar con `ads_get_ad_entities`.
- "activá / reanudá …" → mostrar presupuesto, pedir sí, y `ads_activate_entity`.
- "qué campañas hay" → `ads_get_ad_entities` (`level: campaign`); borradores con `object_state: "draft"`.
- Cambios de presupuesto, fechas o público: mostrar el cambio, pedir sí, y `ads_update_entity` (`daily_budget`, `name`…; no los nombres
  de las herramientas de creación). Si devuelve `is_draft=true`, avisar que queda pendiente hasta publicarlo. `targeting` reemplaza
  todo el público: mandar también lo que no cambia. Para cambiar la creatividad de un anuncio publicado: anuncio nuevo y pausar el viejo.
- Por qué no entrega → `ads_get_errors`, `delivery` y `effective_status`.
- Nunca borrar ni archivar por iniciativa propia: solo si lo pide y confirmando (`DELETED` es permanente).
