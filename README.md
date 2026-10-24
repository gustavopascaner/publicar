# /publicar — skill de Claude Code + servidor MCP

Programa, publica y gestiona publicaciones de Instagram en el **Programador Instagram** de Mister Robot
(`https://publicar.misterrobot.net`) hablando en lenguaje natural: sube fotos y videos (locales o por URL), arma imagen,
carrusel o Reel, escribe o usa el texto, valida con las reglas de Instagram, pide confirmación y programa (fecha, cola o
ya). También lista lo programado, reprograma, pasa a borrador, reintenta o borra, y te dice **qué archivos de una
carpeta ya se publicaron**.

```
/publicar el carrusel de ~/Desktop/promo en @cuenta, el jueves a las 18
/publicar este reel ~/Videos/tip.mp4 en @cuenta en la cola
/publicar qué tengo programado esta semana
/publicar qué videos de ~/Videos/octubre ya publiqué
```

Incluye `mcp/server.mjs`: el servidor MCP (stdio, sin dependencias, Node ≥ 20) que conecta Claude con la API de la app.
Anda en macOS, Linux y Windows.

## Qué está publicado

La app reconoce cada archivo por su **huella** (SHA-256), así que lo encuentra aunque lo hayas renombrado o movido de
carpeta. `/publicar` revisa los archivos antes de subirlos (avisa si ya están publicados o programados) y los marca
después de programarlos:

- **Mac**: etiquetas de colores en el Finder: verde *Publicado*, amarillo *Programado*, rojo *Con error*, gris
  *Borrador*. Tus otras etiquetas no se tocan.
- **Windows**: una planilla `estado-publicaciones.csv` en la carpeta (se abre con Excel): archivo, estado, cuenta y
  fecha, y enlace a Instagram.

Los videos no se modifican nunca. Las marcas se actualizan cuando se consulta: una publicación programada que sale el
jueves pasa a *Publicado* la próxima vez que preguntes (por ejemplo, `/publicar qué publiqué de esta carpeta`). Los
archivos subidos antes de que existiera la huella se reconocen solo por nombre y tamaño (menos seguro).

## Antes de instalar

- [Claude Code](https://claude.com/claude-code).
- [Node](https://nodejs.org) 20 o más nuevo y [Git](https://git-scm.com). En Windows se instalan con
  `winget install OpenJS.NodeJS.LTS` y `winget install Git.Git` (después cerrá y abrí la terminal).
- Un **usuario en el Programador**: te lo crea un administrador en *Usuarios* (alcanza con el rol *Editor*).

## Instalación en Mac o Linux (Terminal)

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

**4. Probá** (ver [Probar](#probar)).

## Instalación en Windows (PowerShell)

Abrí **PowerShell** (no el "Símbolo del sistema") y corré cada paso.

**1. Bajá la skill**

```powershell
git clone https://github.com/gustavopascaner/publicar.git "$HOME\.claude\skills\publicar"
```

**2. Guardá tu clave de API en un archivo**

Primero corré este comando: queda esperando la clave.

```powershell
$d = "$HOME\.config\programador-instagram"; New-Item -ItemType Directory -Force $d | Out-Null; $s = Read-Host 'Pegá la clave y Enter' -AsSecureString; $k = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)); [IO.File]::WriteAllText("$d\api-key", $k.Trim()); icacls "$d\api-key" /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null; Remove-Variable s, k; "Guardada."
```

Después, en la app, entrá a **Perfil → Claves de API**, creá una clave, copiala, pegala en PowerShell (clic derecho o
Ctrl+V; se ven asteriscos) y apretá Enter. El archivo queda solo con permisos para tu usuario de Windows.

**3. Conectá el MCP a Claude Code**

```powershell
claude mcp add programador-instagram --scope user --env PROGRAMADOR_URL=https://publicar.misterrobot.net --env "PROGRAMADOR_API_KEY_FILE=$HOME\.config\programador-instagram\api-key" -- node "$HOME\.claude\skills\publicar\mcp\server.mjs"
```

**4. Probá** (abajo).

## Probar

```bash
claude mcp get programador-instagram
```

Tiene que decir *connected*. Abrí una sesión nueva de Claude Code y escribí `/publicar qué tengo programado esta semana`.

Si algo falla, pedile a Claude: *"revisá la conexión del MCP programador-instagram"*. Errores comunes:
- *La clave no tiene el formato mrk_…*: se pegó incompleta; repetí el paso 2 con la clave entera.
- *Clave de API inválida o revocada*: creá una nueva en Perfil y repetí el paso 2.
- *node no se reconoce*: falta Node o hay que cerrar y abrir la terminal después de instalarlo.

## Actualizar

```bash
git -C ~/.claude/skills/publicar pull
```

En Windows: `git -C "$HOME\.claude\skills\publicar" pull`. Después, abrí una sesión nueva de Claude Code.

## Seguridad
- La clave tiene los mismos permisos que tu usuario en la app. Si se filtra o dejás de usarla, revocala en
  **Perfil → Claves de API** (deja de funcionar al instante) y repetí el paso 2 con una nueva.
- `subir_medio` y `estado_archivo` solo leen imágenes y videos (`.jpg .jpeg .png .webp .avif .heic .heif .mp4 .mov`),
  nunca otros archivos. `estado_archivo` manda a la app solo la huella, el nombre y el tamaño: no sube el archivo.
- Antes de publicar o programar, la skill muestra un resumen y espera tu confirmación.
