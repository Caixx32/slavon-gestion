"""
Baja la cotización del dólar del Banco Nación (bna.com.ar/Personas) y la guarda en shared/bna.json.

Guarda billete y divisa (compra y venta), la fecha que publica el banco y un histórico por fecha,
para que la app use exactamente el dólar oficial BNA vendedor del día.
Si no puede leer la página, no toca el archivo y deja un recorte en shared/bna-debug.txt para revisar.
"""
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone, timedelta

URL = 'https://www.bna.com.ar/Personas'
OUT = 'shared/bna.json'
DEBUG = 'shared/bna-debug.txt'
ART = timezone(timedelta(hours=-3))


def num(s):
    """«1.450,00» · «1450,00» · «1455.0000» · «1.450» → número."""
    s = s.strip()
    if ',' in s:
        s = s.replace('.', '').replace(',', '.')
    elif re.fullmatch(r'\d{1,3}(\.\d{3})+', s):
        s = s.replace('.', '')
    return round(float(s), 4)


def bajar():
    req = urllib.request.Request(URL, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'es-AR,es;q=0.9',
    })
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode('utf-8', errors='replace')


FILA = re.compile(r'Dolar\s*U\.?\s*S\.?\s*A\.?\s*</td>\s*<td[^>]*>\s*([\d.,]+)\s*</td>\s*<td[^>]*>\s*([\d.,]+)\s*</td>', re.I)
FECHA = re.compile(r'(\d{1,2})/(\d{1,2})/(\d{4})')


def seccion(html, ident):
    """Texto desde id="ident" hasta el siguiente id de sección (o 20.000 caracteres)."""
    m = re.search(r'id\s*=\s*["\']%s["\']' % ident, html, re.I)
    if not m:
        return ''
    return html[m.start():m.start() + 20000]


def leer(html):
    out = {}
    for clave, ident in (('billete', 'billetes'), ('divisa', 'divisas')):
        sec = seccion(html, ident)
        fila = FILA.search(sec)
        if fila:
            compra, venta = num(fila.group(1)), num(fila.group(2))
            if not (50 < compra < 100000 and 50 < venta < 100000 and venta >= compra):
                raise ValueError(f'{clave}: valores raros {compra} / {venta}')
            f = FECHA.search(sec)
            fecha = f'{f.group(3)}-{int(f.group(2)):02d}-{int(f.group(1)):02d}' if f else ''
            out[clave] = {'compra': compra, 'venta': venta, 'fecha': fecha}
    if 'billete' not in out:
        # Si la página cambió de forma, se busca la primera fila del dólar en cualquier lado.
        fila = FILA.search(html)
        if not fila:
            raise ValueError('No encontré la fila «Dolar U.S.A» en la página.')
        out['billete'] = {'compra': num(fila.group(1)), 'venta': num(fila.group(2)), 'fecha': ''}
    return out


def main():
    try:
        html = bajar()
        datos = leer(html)
    except Exception as e:  # noqa: BLE001
        print('ERROR:', e)
        try:
            i = html.lower().find('dolar')
            with open(DEBUG, 'w', encoding='utf-8') as f:
                f.write(f'{datetime.now(ART).isoformat()} · {e}\n\n')
                f.write(html[max(0, i - 3000):i + 4000] if i >= 0 else html[:8000])
        except Exception:  # noqa: BLE001
            pass
        sys.exit(1)

    try:
        with open(OUT, encoding='utf-8') as f:
            actual = json.load(f)
    except Exception:  # noqa: BLE001
        actual = {}

    ahora = datetime.now(ART)
    # La clave es el día en que se leyó (la cotización vigente ese día). La fecha que muestra la página queda aparte.
    fecha = ahora.strftime('%Y-%m-%d')
    hist = actual.get('historico', {})
    hist[fecha] = {k: {'compra': v['compra'], 'venta': v['venta']} for k, v in datos.items()}
    hist = dict(sorted(hist.items())[-400:])

    nuevo = {
        'fuente': URL,
        'fecha': fecha,
        'fechaPagina': datos['billete'].get('fecha', ''),
        'billete': {'compra': datos['billete']['compra'], 'venta': datos['billete']['venta']},
        'divisa': {'compra': datos['divisa']['compra'], 'venta': datos['divisa']['venta']} if 'divisa' in datos else None,
        'historico': hist,
    }
    viejo = {k: actual.get(k) for k in ('fecha', 'fechaPagina', 'billete', 'divisa', 'historico')}
    if viejo == {k: nuevo[k] for k in viejo}:
        print('Sin cambios:', nuevo['fecha'], nuevo['billete'])
        return
    nuevo['actualizado'] = ahora.isoformat(timespec='minutes')
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(nuevo, f, ensure_ascii=False, indent=1)
    print('Actualizado:', nuevo['fecha'], nuevo['billete'], nuevo['divisa'])


if __name__ == '__main__':
    main()
