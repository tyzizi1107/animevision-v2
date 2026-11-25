#!/usr/bin/env python3
"""
Relais HTTP pour les CDN qui rejettent les requêtes non-navigateur.

Certains hébergeurs (LuluStream et ses CDN `*.tnmr.org`, Filemoon et ses
`*.owphbf24.com`) filtrent sur l'empreinte TLS : un `fetch` Node ou un `curl`
classique reçoit un `403 nginx`, alors que la même URL répond en 200 à une
empreinte Chrome. `curl_cffi` reproduit cette empreinte.

Ce script est appelé par `/api/proxy` pour les seuls hôtes concernés :

    python3 scripts/curl-impersonate.py <url> [--referer R] [--range bytes=0-65535]

Sortie : le corps de la réponse sur stdout, les métadonnées sur stderr sous la
forme `status: <code>` / `content-type: <valeur>`. Code de sortie 3 quand
`curl_cffi` n'est pas installé (le proxy retombe alors sur `fetch`).

L'interpréteur est choisi par la variable d'environnement
`CURL_CFFI_PYTHON` (par défaut celui du venv d'AutoFlix, qui l'a déjà).
"""

import argparse
import os
import sys

DEFAULT_PYTHON = "/home/jarod/.local/share/uv/tools/autoflix-cli/bin/python"
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--referer", default=None)
    parser.add_argument("--origin", default=None)
    parser.add_argument("--range", dest="range_header", default=None)
    parser.add_argument("--user-agent", dest="user_agent", default=DEFAULT_UA)
    args = parser.parse_args()

    try:
        from curl_cffi import requests
    except ImportError:
        sys.stderr.write("curl_cffi absent\n")
        return 3

    # Ne JAMAIS forcer `User-Agent` : curl_cffi choisit la valeur cohérente avec
    # l'empreinte TLS de `impersonate="chrome"`. Un UA Chrome 145 posé à la main
    # sur une empreinte Chrome 124 fait détecter le client → 403 nginx.
    headers = {}
    if args.user_agent and args.user_agent != DEFAULT_UA:
        headers["User-Agent"] = args.user_agent
    if args.referer:
        headers["Referer"] = args.referer
    if args.origin:
        headers["Origin"] = args.origin
    if args.range_header:
        headers["Range"] = args.range_header

    try:
        response = requests.get(
            args.url,
            headers=headers,
            impersonate="chrome",
            timeout=25,
            allow_redirects=True,
        )
    except Exception as error:  # réseau, TLS, timeout…
        sys.stderr.write(f"erreur: {error}\n")
        return 4

    sys.stderr.write(f"status: {response.status_code}\n")
    sys.stderr.write(f"content-type: {response.headers.get('content-type', '')}\n")
    for key in ("content-range", "accept-ranges"):
        value = response.headers.get(key)
        if value:
            sys.stderr.write(f"{key}: {value}\n")

    sys.stdout.buffer.write(response.content)
    return 0


if __name__ == "__main__":
    sys.exit(main())
