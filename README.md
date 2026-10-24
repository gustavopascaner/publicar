# /publicar — skill de Claude Code + servidor MCP

Programa, publica y gestiona publicaciones de Instagram en el **Programador Instagram** de Mister Robot
(`https://publicar.misterrobot.net`) hablando en lenguaje natural: sube fotos y videos (locales o por URL), arma imagen,
carrusel o Reel, escribe o usa el texto, valida con las reglas de Instagram, pide confirmación y programa (fecha, cola o
ya). También lista lo programado, reprograma, pasa a borrador, reintenta o borra.

```
/publicar el carrusel de ~/Desktop/promo en @cuenta, el jueves a las 18
/publicar este reel ~/Videos/tip.mp4 en @cuenta en la cola
/publicar qué tengo programado esta semana
```

Incluye `mcp/server.mjs`: el servidor MCP (stdio, sin dependencias, Node ≥ 20) que conecta Claude con la API de la app.

## Instalación (una vez por computadora)

Necesitás [Claude Code](https://claude.com/claude-code), Node 20 o más nuevo, y un **usuario en el Programador** (te lo
crea un administrador en *Usuarios*; alcanza con el rol *Editor*).

**1. Bajá la skill**

```bash
git clone https://github.com/gustavopascaner/publicar.git ~/.claude/skills/publicar
```

**2. Guardá tu clave de API en un archivo** (la clave nunca va en el chat ni en la configuración)

Primero corré este comando: queda esperando la clave.

```bash
mkdir -p ~/.config/programador-instagram && printf 'Pegá la clave y Enter: ' && read -rs k && printf '%s\n' "$k" > ~/.config/programador-instagram/api-key && chmod 600 ~/.config/programador-instagram/api-key && unset k && echo " Guardada."
```

Después, en la app, entrá a **Perfil → Claves de API**, creá una clave (por ejemplo "Claude"), copiala (se muestra una
sola vez), pegala en la terminal y apretá Enter. No se ve mientras la pegás: es a propósito.

**3. Conectá el MCP a Claude Code**

```bash
claude mcp add programador-instagram --scope user --env PROGRAMADOR_URL=https://publicar.misterrobot.net --env PROGRAMADOR_API_KEY_FILE=$HOME/.config/programador-instagram/api-key -- node $HOME/.claude/skills/publicar/mcp/server.mjs
```

**4. Probá**

```bash
claude mcp get programador-instagram
```

Tiene que decir *connected*. Abrí una sesión nueva de Claude Code y escribí `/publicar qué tengo programado esta semana`.

## Actualizar

```bash
git -C ~/.claude/skills/publicar pull
```

## Seguridad
- La clave tiene los mismos permisos que tu usuario en la app. Si se filtra o dejás de usarla, revocala en
  **Perfil → Claves de API** (deja de funcionar al instante) y repetí el paso 2 con una nueva.
- `subir_medio` solo lee imágenes y videos (`.jpg .jpeg .png .webp .avif .heic .heif .mp4 .mov`), nunca otros archivos.
- Antes de publicar o programar, la skill muestra un resumen y espera tu confirmación.
