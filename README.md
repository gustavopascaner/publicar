# /publicar — skill de Claude Code

Programa, publica y gestiona publicaciones de Instagram en el **Programador Instagram** de Mister Robot
(`publicar.misterrobot.net`) hablando en lenguaje natural: sube fotos y videos (locales o por URL), arma imagen,
carrusel o Reel, escribe o usa el texto, valida con las reglas de Instagram, pide confirmación y programa (fecha, cola o
ya). También lista lo programado, reprograma, pasa a borrador, reintenta o borra.

```
/publicar el carrusel de ~/Desktop/promo en @cuenta, el jueves a las 18
/publicar qué tengo programado esta semana
```

## Requisitos
- El servidor MCP `programador-instagram` (`mcp/server.mjs` del Programador) configurado en Claude Code, con
  `PROGRAMADOR_URL` y la clave de API en un archivo (`PROGRAMADOR_API_KEY_FILE`, permisos 600). La clave se crea en
  **Perfil → Claves de API** de la app.

## Instalación
```bash
git clone https://github.com/gustavopascaner/publicar.git ~/.claude/skills/publicar
```
