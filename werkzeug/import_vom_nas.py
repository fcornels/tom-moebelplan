"""Einmaliger Umzug der Pläne aus der NAS-App (http://192.168.1.66:8098) in die Online-Fassung (Fassung 1, 30.10.2026).

Liest Varianten und aktuelle Pläne über die Schnittstelle der NAS-App, nur lesend. Meldet sich bei der Online-Fassung
mit dem Passwort aus /root/.config/tom-moebelplan/passwort an und schickt alles an /api/import. Die Online-Fassung
nimmt den Import nur an, solange dort noch kein Plan gespeichert ist. Der Verlauf der NAS-App wird nicht übertragen.

Aufruf: python3 -I import_vom_nas.py https://<projekt>.pages.dev [--trocken]
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

NAS = "http://192.168.1.66:8098"
PASSWORT = "/root/.config/tom-moebelplan/passwort"
UA = {"User-Agent": "claude-nas-tom-moebelplan/1"}  # ohne eigene Kennung sperrt Cloudflare mit Fehler 1010


class KeineUmleitung(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def holen(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def main():
    args = [a for a in sys.argv[1:] if a != "--trocken"]
    if len(args) != 1 or not args[0].startswith("https://"):
        sys.exit(__doc__)
    ziel = args[0].rstrip("/")
    varianten = holen(NAS + "/api/varianten")["varianten"]
    export = {"naechste": max(int(v["id"][1:]) for v in varianten) + 1, "varianten": []}
    for v in varianten:
        p = holen(NAS + "/api/plan?v=" + v["id"])
        export["varianten"].append({"id": v["id"], "name": v["name"], "version": p["version"],
                                    "geaendert": p["geaendert"], "plan": p["plan"]})
        print(f"{v['id']} {v['name']}: Version {p['version']}, {len(p['plan']['items']) if p['plan'] else 0} Möbel")
    if "--trocken" in sys.argv:
        print("Trocken: nichts gesendet")
        return
    passwort = open(PASSWORT, encoding="utf-8").read().strip()
    oeffner = urllib.request.build_opener(KeineUmleitung)
    try:
        oeffner.open(urllib.request.Request(ziel + "/anmelden", urllib.parse.urlencode({"passwort": passwort}).encode(), headers=UA),
                     timeout=30)
        sys.exit("Anmeldung ohne Umleitung, unerwartet")
    except urllib.error.HTTPError as e:
        if e.code != 303:
            sys.exit(f"Anmeldung fehlgeschlagen: {e.code}")
        cookie = e.headers.get("Set-Cookie", "").split(";")[0]
    req = urllib.request.Request(ziel + "/api/import", json.dumps(export).encode(), method="POST",
                                 headers={**UA, "Content-Type": "application/json", "Cookie": cookie})
    with urllib.request.urlopen(req, timeout=60) as r:
        antwort = json.load(r)
    for v in antwort["varianten"]:
        print(f"online {v['id']} {v['name']}: Version {v['version']}, {v['anzahl']} Möbel")


if __name__ == "__main__":
    main()
