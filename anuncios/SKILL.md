---
name: anuncios
description: Arma y gestiona campañas publicitarias de Meta (solo ubicaciones de Instagram) en el Programador de Mister Robot (publicar.misterrobot.net) con el servidor MCP programador-instagram. Elige cuenta publicitaria, objetivo, presupuesto, público (edad, género, lugares, intereses, públicos) y creatividad (publicación ya publicada o imagen/carrusel de la biblioteca), valida, muestra el gasto estimado, confirma y crea la campaña en Meta EN PAUSA; la activa solo si el usuario lo pide; también pausa, consulta estado y métricas. Usar cuando el usuario escribe /anuncios, o pide "promocioná este post", "armá una campaña de tráfico para @cuenta", "pausá la campaña…", "cómo va la campaña…".
---

# /anuncios — campañas publicitarias (Marketing API) con ubicaciones solo en Instagram

Hablarle al usuario (Gus o su equipo) en español rioplatense (voseo), corto. Todo pasa por las herramientas MCP
`programador-instagram` (`mcp__programador-instagram__*_ads`, más `listar_publicaciones`, `listar_medios`, `subir_medio`):
nunca tocar Ads Manager, la base ni Meta por otro lado. **Las campañas gastan dinero real**: nada se activa sin un sí explícito.

## 0 · Herramientas y chequeos
- Si las herramientas no están cargadas: ToolSearch (`programador-instagram`). Si no existen, la instalación está en el
  README de la skill `publicar` (mismo servidor MCP). Nunca pedir ni mostrar la clave de API.
- `info_api`: si `adsEnabled` es `false`, la sección Anuncios está apagada en la app (lo habilita un administrador con
  `ADS_ENABLED=true`); avisar y parar. Guardar `timezone` y `nowLocal` para las fechas ("desde el lunes" → `YYYY-MM-DDTHH:MM`).
- `listar_cuentas_publicitarias`: elegir la cuenta (por nombre o moneda). `usable=false` → decir por qué (inactiva, sin
  acceso o sin cuenta de Instagram asignada: eso lo configura un administrador en Anuncios → Cuentas publicitarias) y
  no seguir con ella. Anotar `currency` e `instagramAccount.username` (es quien aparece como anunciante).

## 1 · Entender el pedido
Del texto sacar, preguntando solo lo que falte (una pregunta corta con 2–3 opciones, no un cuestionario):
- **Objetivo** (`objective`): tráfico a un sitio/WhatsApp → `OUTCOME_TRAFFIC`; más interacción con una publicación →
  `OUTCOME_ENGAGEMENT`; alcance/visibilidad → `OUTCOME_AWARENESS`; contactos con píxel → `OUTCOME_LEADS`; ventas con
  píxel → `OUTCOME_SALES`. Si pide "promocionar un post" sin más, usar `OUTCOME_ENGAGEMENT` + `POST_ENGAGEMENT`.
- **Presupuesto**: diario (`dailyBudgetCents`) o total (`lifetimeBudgetCents`, exige `endAt`), en la **unidad mínima
  de la moneda** de la cuenta: ARS/USD → centavos (ARS 5.000 → `500000`; USD 10 → `1000`); JPY → sin decimales.
  `budgetMode: "campaign"` salvo que pida presupuesto por conjunto. Si no da presupuesto, preguntarlo (no inventar).
- **Fechas** (`startAt`, `endAt` en el conjunto): sin inicio = al activar; sin fin = corre hasta que se pause (decirlo).
- **Público** (`targeting`): edad (18–65 por defecto; 65 = 65+), `genders` (vacío = todos; 1 hombres, 2 mujeres),
  `countries` con códigos de 2 letras (AR, UY…). Regiones/ciudades e intereses: `buscar_segmentacion_ads`
  (`type: "geo"` / `"interest"`, `q`) y usar `key`/`id` con `name`. Públicos personalizados/similares y píxeles:
  `type: "audiences"` / `"pixels"`. Sin datos, proponer algo razonable (país de la cuenta, 25–55, todos) y decirlo.
- **Ubicaciones** (`instagramPositions`): por defecto `stream`, `story`, `reels`, `explore`. Solo Instagram, siempre.
- **Creatividad** (`ads[0]`):
  - Publicación ya publicada → `creativeType: "existing_post"` con `postId` (`listar_publicaciones` con
    `status=published`, buscar por `q`; tiene que tener `platformUrl`). Es la opción más simple y la recomendada para
    "promocionar". Si la publicación no está en la app, `igMediaId` (id numérico de Instagram).
  - Imagen o carrusel nuevo → `subir_medio` (igual que en /publicar) y `media: [{ mediaId }]` (carrusel: 2 a 10, cada
    tarjeta puede llevar `headline` y `linkUrl`). Texto principal (`primaryText`), `headline`, `description`.
  - Video → solo con un video que ya esté en la biblioteca **con miniatura** (subido desde el navegador); los subidos
    por el MCP no la tienen y la validación lo rechaza (`video_thumb`): proponer imagen o publicación existente.
  - Botón (`callToAction`, p. ej. `LEARN_MORE`, `SHOP_NOW`, `SIGN_UP`, `CONTACT_US`, `WHATSAPP_MESSAGE`, `NO_BUTTON`) y
    `linkUrl` (obligatorio en tráfico, leads y ventas salvo WhatsApp).
- Nombre de campaña, conjunto y anuncio: proponerlos a partir del pedido ("Promo turnos · nov 2026").

## 2 · Validar
`validar_campana_ads` con el árbol completo (`campaign`). Errores (`severity: "error"`) → corregir lo que sea de datos
(moneda, fechas, enlace) y volver a validar; lo que dependa del usuario (presupuesto bajo, falta píxel, publicación no
publicada) → explicarlo en una línea y preguntar. Advertencias → mencionarlas. `ig_actor_missing` o cuenta `usable=false`
→ lo resuelve un administrador en la web; no insistir.

## 3 · Confirmar (siempre, antes de crear en Meta)
Mostrar un resumen y esperar un sí:

```
Cuenta: Clínica Ads (ARS) · anuncia @cuenta
Objetivo: Tráfico · optimiza clics en el enlace · se cobra por impresiones
Presupuesto: ARS 5.000 por día, del 3/11 09:00 al 17/11 (gasto máximo estimado ARS 70.000)   ← si no hay fin: "sin fecha de fin: gasta hasta que la pauses"
Público: 25–55 · todos · Argentina (Rosario) · intereses: Odontología
Ubicaciones: feed, historias, reels, explorar (solo Instagram)
Anuncio: publicación del 20/10 «…» · botón Más información → https://…
Se crea EN PAUSA (no gasta). ¿La activo al terminar? (sí / no)
```
No saltear nunca esta confirmación, aunque el mensaje diga "directo": acá hay dinero.

## 4 · Crear e informar
1. `crear_campana_ads` (borrador; devuelve `campaign.id`). Si la respuesta trae `issues` con errores, volver al paso 2.
2. `publicar_campana_ads` con `id` y `activate` según lo confirmado (**por defecto `false`**). Corre en segundo plano.
3. Esperar unos segundos y `ver_campana_ads` hasta que `status` sea `paused` o `active` (o `failed`: mostrar
   `lastError` con sus palabras; si es de límite de llamadas de Meta, `#4`/`#80004`, esperar y reintentar más tarde con
   `publicar_campana_ads` otra vez: no repite lo ya creado). Máximo ~2 minutos de espera; si sigue `publishing`, avisar
   que termina sola y que se ve en https://publicar.misterrobot.net/anuncios.
4. Informar en 2 líneas: estado, `platformId`, presupuesto, y el enlace `https://publicar.misterrobot.net/anuncios/<id>`.
   Si quedó en pausa, recordar que se activa desde ahí o con "activá la campaña …".

## 5 · Gestionar lo existente
- "cómo va / cuánto gastó" → `actualizar_metricas_ads` y luego `ver_campana_ads`: gasto (`spendCents` en la moneda),
  impresiones, alcance, clics, resultados y `daily` (últimos días). Mostrar tabla corta; `issues` y
  `effectiveStatus` si Meta informa problemas (revisión, rechazo, falta método de pago).
- "pausá …" → `pausar_campana_ads` (sin confirmación extra: deja de gastar).
- "activá / reanudá …" → mostrar presupuesto y pedir sí; después `activar_campana_ads`.
- "qué campañas hay" → `listar_campanas_ads` (filtrar por `status`, `adAccountId`, `q`).
- Cambios de presupuesto, fechas, público o creatividad en una campaña ya creada en Meta: no hay herramienta MCP;
  indicar que se hace en la web (detalle de la campaña → Editar presupuesto y fechas) o en Ads Manager. Un borrador
  (`status: draft`) sí se reedita con `crear_campana_ads` pasando `id`.
- Nunca borrar ni archivar por iniciativa propia; archivar solo si lo pide y confirmando (no se puede reactivar).
