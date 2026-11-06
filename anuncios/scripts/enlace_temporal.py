#!/usr/bin/env python3
"""Enlace público temporal para que Meta descargue un video o imagen (ads_creative_upload_media con upload_source=URL).
Usa la misma cuenta FTP que /marca (landing.misterrobot.net): datos en la skill marca, contraseña en el Llavero.
Todo vive en <dominio>/_tmp-anuncios/<fecha>-<azar>/ y este script nunca borra nada fuera de esa carpeta.

uso:
  python3 -I enlace_temporal.py subir <archivo>     → sube, comprueba que se descarga y muestra {"url", "token", ...}
  python3 -I enlace_temporal.py borrar <token|url>  → borra ese archivo y su carpeta, y lo comprueba
  python3 -I enlace_temporal.py lista               → qué quedó en el servidor
  python3 -I enlace_temporal.py limpiar [--horas=24] → borra lo que tenga más de esas horas (lo más nuevo puede estar en uso)
`subir` también limpia lo de más de 24 horas, por si una corrida anterior se cortó antes de borrar.
"""
import ftplib, json, os, posixpath, re, secrets, ssl, subprocess, sys, time, unicodedata, urllib.error, urllib.request
from datetime import datetime, timedelta

MARCA = os.path.expanduser('~/.claude/skills/marca/assets/hosting.json')
LOCAL = os.path.expanduser('~/.config/motion/hosting.json')   # igual que subir.py: pisa al del repo en esta compu
KC = 'marca-ftp'
RAIZ = '_tmp-anuncios'
TOKEN = re.compile(r'\d{8}-\d{6}-[0-9a-f]{16}')
TIPOS = {'.mp4': 'video/', '.mov': 'video/', '.jpg': 'image/', '.jpeg': 'image/', '.png': 'image/', '.gif': 'image/'}
UA = 'facebookexternalhit/1.1'   # comprobar la descarga como la vería Meta


def conf():
    w = {}
    for p in (MARCA, LOCAL):
        if os.path.exists(p):
            w.update(json.load(open(p, encoding='utf-8')))
    if not (w.get('host') and w.get('user') and w.get('dominio')):
        sys.exit('✗ falta el hosting: hace falta la skill marca instalada (assets/hosting.json)')
    return w


def clave(w):
    if os.environ.get('MARCA_FTP_PASS'):
        return os.environ['MARCA_FTP_PASS']
    r = subprocess.run(['security', 'find-generic-password', '-s', KC, '-a', f"{w['user']}@{w['host']}", '-w'],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit('✗ no hay contraseña FTP en el Llavero: que la persona corra en su terminal\n'
                 '   python3 -I ~/.claude/skills/marca/scripts/subir.py clave')
    return r.stdout.rstrip('\n')


def conectar(w):
    ctx = ssl.create_default_context()
    for _ in (1, 2):
        f = ftplib.FTP_TLS(context=ctx, timeout=120)
        f.connect(w['host'], int(w.get('puerto', 21)))
        try:
            f.auth()
            break
        except ssl.SSLCertVerificationError:   # Hostinger a veces presenta el certificado del servidor compartido (igual que subir.py)
            f.close()
            ctx = ssl.create_default_context()
            ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
    try:
        f.login(w['user'], clave(w))
    except ftplib.error_perm as e:
        sys.exit(f'✗ el servidor rechazó el usuario o la contraseña ({e})')
    f.prot_p()
    f.set_pasv(True)
    base = (w.get('dir') or '.').strip()
    if base not in ('', '.', '/'):
        f.cwd(base)
    return f


def cerrar(f):
    try:
        f.quit()
    except Exception:
        f.close()


def nombres(f, d):
    try:
        return sorted({posixpath.basename(x.rstrip('/')) for x in f.nlst(d)} - {'.', '..', ''})
    except (ftplib.error_perm, ftplib.error_temp):   # la carpeta no existe (Hostinger responde 450)
        return []


def seguro(nombre):
    stem, ext = os.path.splitext(nombre)
    s = unicodedata.normalize('NFKD', stem).encode('ascii', 'ignore').decode().lower()
    return (re.sub(r'[^a-z0-9]+', '-', s).strip('-')[:60] or 'archivo') + ext.lower()


def token_de(x):
    m = TOKEN.fullmatch(x) or re.search(rf'/{RAIZ}/({TOKEN.pattern})/', x)
    if not m:
        sys.exit(f'✗ "{x}" no es un enlace de {RAIZ}: no borro nada')
    return m.group(1) if m.re is not TOKEN else m.group(0)


def borrar_token(f, tok):
    d = f'{RAIZ}/{tok}'
    borrados = []
    for n in nombres(f, d):
        f.delete(f'{d}/{n}')
        borrados.append(n)
    for carpeta in (d, RAIZ):   # rmd solo funciona si está vacía: lo de otra subida en curso no se toca
        try:
            f.rmd(carpeta)
        except (ftplib.error_perm, ftplib.error_temp):
            pass
    return borrados


def edad_vencida(tok, horas):
    return datetime.now() - datetime.strptime(tok[:15], '%Y%m%d-%H%M%S') > timedelta(hours=horas)


def limpiar_viejos(f, horas):
    viejos = [t for t in nombres(f, RAIZ) if TOKEN.fullmatch(t) and edad_vencida(t, horas)]
    for t in viejos:
        borrar_token(f, t)
    return viejos


def probar_url(url):
    """Devuelve (estado, tipo, largo) con el User-Agent de Meta, leyendo solo el principio del archivo."""
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            r.read(1024)
            largo = r.headers.get('Content-Length')
            return r.status, r.headers.get('Content-Type', ''), int(largo) if str(largo).isdigit() else None
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get('Content-Type', ''), None


def probar_con_reintentos(url, veces=6, espera=3):
    """Hostinger a veces responde 412 en el instante posterior a la subida: se repite antes de darlo por malo."""
    for i in range(1, veces + 1):
        estado, tipo, largo = probar_url(url)
        if estado == 200 or i == veces:
            return estado, tipo, largo, i
        time.sleep(espera)


def subir(ruta):
    w = conf()
    ruta = os.path.abspath(ruta)
    if not os.path.isfile(ruta):
        sys.exit(f'✗ no existe {ruta}')
    ext = os.path.splitext(ruta)[1].lower()
    if ext not in TIPOS:
        sys.exit(f'✗ {ext or "sin extensión"}: Meta acepta {", ".join(sorted(TIPOS))}')
    tam = os.path.getsize(ruta)
    tok = f"{datetime.now():%Y%m%d-%H%M%S}-{secrets.token_hex(8)}"
    d, nombre = f'{RAIZ}/{tok}', seguro(os.path.basename(ruta))
    f = conectar(w)
    try:
        limpiar_viejos(f, 24)
        if RAIZ not in nombres(f, '.'):
            f.mkd(RAIZ)
        f.mkd(d)
        try:
            with open(ruta, 'rb') as a:
                f.storbinary(f'STOR {d}/{nombre}', a, blocksize=1024 * 256)
            if f.size(f'{d}/{nombre}') != tam:
                raise RuntimeError('el tamaño en el servidor no coincide')
            url = f"https://{w['dominio']}/{d}/{nombre}"
            estado, tipo, largo, intentos = probar_con_reintentos(url)
            if estado != 200 or not tipo.startswith(TIPOS[ext]) or (largo is not None and largo != tam):
                raise RuntimeError(f'el enlace no sirve para Meta (HTTP {estado}, tipo "{tipo}", largo {largo})')
        except Exception:
            borrar_token(f, tok)   # que no quede nada si falló a mitad de camino
            raise
    finally:
        cerrar(f)
    print(json.dumps({'url': url, 'token': tok, 'bytes': tam, 'tipo': tipo, 'intentos': intentos}, ensure_ascii=False))


def borrar(x):
    tok = token_de(x)
    w = conf()
    f = conectar(w)
    try:
        hay = nombres(f, f'{RAIZ}/{tok}')
        borrados = borrar_token(f, tok)
        queda = tok in nombres(f, RAIZ)
    finally:
        cerrar(f)
    if queda:
        sys.exit(f'✗ quedó {RAIZ}/{tok} en el servidor')
    res = {'borrado': bool(hay), 'archivos': borrados}
    if borrados:   # Cloudflare puede seguir sirviendo su copia un rato aunque el archivo ya no esté en el servidor
        res['http_despues'] = probar_url(f"https://{w['dominio']}/{RAIZ}/{tok}/{borrados[0]}")[0]
    print(json.dumps(res, ensure_ascii=False))


def lista():
    w = conf()
    f = conectar(w)
    try:
        ts = [t for t in nombres(f, RAIZ) if TOKEN.fullmatch(t)]
        print(json.dumps([{'token': t, 'archivos': nombres(f, f'{RAIZ}/{t}')} for t in ts], ensure_ascii=False))
    finally:
        cerrar(f)


def limpiar(horas):
    w = conf()
    f = conectar(w)
    try:
        print(json.dumps({'limpiados': limpiar_viejos(f, horas)}, ensure_ascii=False))
    finally:
        cerrar(f)


def main():
    a = sys.argv[1:]
    cmd = a[0] if a else ''
    try:
        if cmd == 'subir' and len(a) == 2:
            subir(a[1])
        elif cmd == 'borrar' and len(a) == 2:
            borrar(a[1])
        elif cmd == 'lista':
            lista()
        elif cmd == 'limpiar':
            limpiar(float(next((x.split('=', 1)[1] for x in a if x.startswith('--horas=')), 24)))
        else:
            sys.exit(__doc__)
    except (RuntimeError, ftplib.Error, OSError) as e:
        sys.exit(f'✗ {e}')


main()
