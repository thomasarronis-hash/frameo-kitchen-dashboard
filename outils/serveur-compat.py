#!/usr/bin/env python3
"""Serveur local du diagnostic compat.html, pour le jour J (13/10).

Rôle : sert web/compat/ (compat.html aussi à la racine « / », qui est l'adresse que charge le
kiosque) et enregistre chaque rapport envoyé par la page (POST /rapport) dans
docs/releves/rapport-compat-<horodatage>.txt. Remplace « python3 -m http.server 8020 » de la
conception, qui ne sait pas recevoir de POST.

Entrées : --port (8020 par défaut) ; corps des POST /rapport en texte UTF-8, 1 Mo au plus.
Sorties : un fichier par rapport dans docs/releves/ (jamais d'écrasement), chemin relatif renvoyé
à la page avec le code 201 ; 403 si Host ou Origin est étranger, 507 au-delà de 50 rapports ;
journal des requêtes sur la sortie d'erreur.

Pièges :
- Écoute sur 127.0.0.1 seulement : le reste du réseau ne voit pas ce serveur. Mais pendant
  « adb reverse tcp:8020 tcp:<port> », TOUTES les applis du cadre le voient sur leur 127.0.0.1:8020,
  pas seulement le kiosque.
- POST /rapport refuse un Host autre que 127.0.0.1 ou localhost (DNS rebinding) et un Origin qui
  n'est pas exactement http://<Host> (page web quelconque ouverte sur le Clevo : un POST text/plain
  part sans requête préalable CORS). Port de Host quelconque : avec adb reverse, le cadre envoie
  le port compilé dans l'APK (8020), qui peut différer de --port.
- Une appli native du cadre peut falsifier Host et Origin : seul le plafond de 50 rapports
  (50 Mo au plus) borne alors ce qu'elle écrit dans docs/releves/.
- Bibliothèque standard seulement, rien à installer.
- En-tête « Cache-Control: no-store » : la WebView recharge toujours la dernière version.
- Pas de liste de répertoire : seuls les fichiers présents dans web/compat/ sont servis.
"""

import argparse
import functools
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

RACINE = Path(__file__).resolve().parent.parent
DOSSIER_PAGE = RACINE / "web" / "compat"
DOSSIER_RELEVES = RACINE / "docs" / "releves"
HOTE = "127.0.0.1"
NOMS_LOCAUX = {"127.0.0.1", "localhost"}
TAILLE_MAX = 1024 * 1024
MAX_RAPPORTS = 50


def requete_locale(hote, origine):
    """Vrai si Host désigne cette machine et si Origin, quand il est présent, vaut http://<Host>."""
    if hote.rsplit(":", 1)[0] not in NOMS_LOCAUX:
        return False
    return origine is None or origine == f"http://{hote}"


def nombre_rapports():
    """Nombre de rapports compat déjà enregistrés (les relevés ADB ne comptent pas)."""
    return sum(1 for _ in DOSSIER_RELEVES.glob("rapport-compat-*.txt"))


def enregistrer_rapport(texte):
    """Écrit le rapport dans un nouveau fichier horodaté, sans jamais en écraser un autre."""
    DOSSIER_RELEVES.mkdir(parents=True, exist_ok=True)
    horodatage = datetime.now().strftime("%Y%m%d-%H%M%S")
    for numero in range(1, 100):
        suffixe = "" if numero == 1 else f"-{numero}"
        chemin = DOSSIER_RELEVES / f"rapport-compat-{horodatage}{suffixe}.txt"
        try:
            with open(chemin, "x", encoding="utf-8") as fichier:
                fichier.write(texte)
            return chemin
        except FileExistsError:
            continue
    raise RuntimeError("trop de rapports dans la même seconde")


class Gestionnaire(SimpleHTTPRequestHandler):
    """Sert la page de diagnostic et reçoit les rapports."""

    def send_head(self):
        # « / » sert compat.html directement (GET et HEAD) : c'est l'URL que charge le kiosque.
        if urlsplit(self.path).path == "/":
            self.path = "/compat.html"
        return super().send_head()

    def list_directory(self, path):
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        if urlsplit(self.path).path != "/rapport":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not requete_locale(self.headers.get("Host", ""), self.headers.get("Origin")):
            self.send_error(HTTPStatus.FORBIDDEN, explain="Host ou Origin étranger.")
            return
        longueur = self.headers.get("Content-Length", "")
        if not longueur.isdigit():
            self.send_error(HTTPStatus.LENGTH_REQUIRED)
            return
        if int(longueur) > TAILLE_MAX:
            self.send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            return
        if nombre_rapports() >= MAX_RAPPORTS:
            self.send_error(HTTPStatus.INSUFFICIENT_STORAGE,
                            explain=f"{MAX_RAPPORTS} rapports dans docs/releves/ : faire le tri.")
            return
        texte = self.rfile.read(int(longueur)).decode("utf-8", errors="replace")
        chemin = enregistrer_rapport(texte)
        reponse = str(chemin.relative_to(RACINE)).encode("utf-8")
        self.send_response(HTTPStatus.CREATED)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(reponse)))
        self.end_headers()
        self.wfile.write(reponse)
        print(f"Rapport enregistré : {chemin}", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Sert compat.html et reçoit les rapports du cadre.")
    parser.add_argument("--port", type=int, default=8020, help="port d'écoute sur 127.0.0.1 (8020 par défaut)")
    arguments = parser.parse_args()
    gestionnaire = functools.partial(Gestionnaire, directory=str(DOSSIER_PAGE))
    with ThreadingHTTPServer((HOTE, arguments.port), gestionnaire) as serveur:
        print(f"compat.html servi sur http://{HOTE}:{arguments.port}/ (Ctrl+C pour arrêter)", flush=True)
        print(f"Rapports enregistrés dans {DOSSIER_RELEVES}", flush=True)
        print(f"Côté cadre : adb reverse tcp:8020 tcp:{arguments.port}"
              " (8020 = port compilé dans l'APK du jour J)", flush=True)
        try:
            serveur.serve_forever()
        except KeyboardInterrupt:
            print("\nServeur arrêté.", flush=True)


if __name__ == "__main__":
    main()
