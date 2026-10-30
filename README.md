# Möblierungsplan Tom – Online-Fassung

Möblierungsplan für Toms Wohnung Rimbertweg 11 b (Einzug 01.01.2027): Grundriss, begehbares 3D-Modell,
Anschluss-Ebene, Plan-Varianten. Online-Fassung der NAS-App „Möblierungsplan Tom“ (Fassung 1.3.0, Port 8098 im
Heimnetz), seit 30.10.2026 auf Cloudflare Pages mit Passwortschutz (Entscheidung Frank 30.10.2026).

Fassung 2.1.0 (30.10.2026): Räume nachmessen. Fassung 2.0.0 (30.10.2026): Seite der NAS-App 1.3.0 mit
Speicherung in D1 statt Dateien und Passwortschutz.

## Räume nachmessen (Fassung 2.1.0, 30.10.2026)

Tom misst die Räume nach, weil der Grundriss der Genossenschaft ungenau sein kann. In der Seitenleiste „Räume
nachmessen“: Raum wählen, lichtes Maß in cm eintragen, wählen, welche Wand sich verschiebt (rechts oder links,
unten oder oben), Übernehmen. Danach baut sich die Seite neu auf.

- Jede Wand ist eine Wandlinie mit beiden Seiten (GX, GY in public/index.html); sie wandert als Ganzes, die
  Wandstärke bleibt. Gespeichert wird nur der Versatz je Wandlinie (`/api/wohnung`, Tabelle `wohnung`, die letzten
  20 Stände in `wohnung_verlauf`), für alle Varianten gleich.
- Mit der Wand wandern Nachbarräume an derselben Wandlinie, Türen, Fenster, Einbauten, Beschriftungen,
  3D-Einbauten und Blickpunkte. Möbel und Anschlüsse bleiben stehen; was nun in eine Wand ragt, zeigt die
  Konfliktprüfung rot.
- Fluchtende Wände bleiben fluchtend: Die Westwand ist für Zimmer 2, Flur und Küche eine Linie.
- „Alle wie Zeichnung“ setzt alle Wände zurück.
- Eingebaut mit `python3 -I bau/waende.py public/index.html` auf der Seite von 2.0.0 (jede Ersetzung genau einmal).
- Geprüft am 30.10.2026 lokal: ohne Messung pixelgleich mit 2.0.0, Zimmer 2 auf 345 cm mit rechter Wand ergibt
  Zimmer 1 382 cm, Beschriftung und Fläche neu, 3D ohne Fehler, Zurücksetzen wieder pixelgleich.

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `public/` | Seite (index.html), three.js r128, Schriften, Texturen (Poly Haven, CC0, Liste in `public/tex/QUELLEN.txt`) |
| `functions/_middleware.js` | Passwortschutz für alle Adressen, auch die Vorschau-Adressen je Zweig |
| `functions/api/[[pfad]].js` | Schnittstelle wie `server.py` der NAS-App, Speicher D1 |
| `functions/_lib.js` | Tabellen, Zeitangabe, JSON-Antwort |
| `werkzeug/import_vom_nas.py` | einmaliger Umzug der Pläne aus der NAS-App |

Kein Build-Schritt. Cloudflare Pages: Build-Befehl leer, Ausgabeordner `public`, Functions aus `functions/`.

## Einstellungen im Pages-Projekt

- Bindung **D1-Datenbank**, Variablenname `DB`, Datenbank `tom-moebelplan`, für Production und Preview.
  Die Tabellen legt die Seite beim ersten Aufruf selbst an.
- Secret **`SEITEN_PASSWORT`** für Production und Preview. Fehlt es, bleibt die Seite gesperrt.
  Ein neues Passwort meldet alle Geräte ab.
- Keine `wrangler.toml` im Repo: Bindungen und Secrets stehen nur im Dashboard (sonst überschreibt die Datei sie).

Vorschau-Adressen und Live-Seite nutzen dieselbe Datenbank. Wer auf einer Vorschau speichert, ändert also den
echten Plan.

## Schnittstelle

Wie die NAS-App, siehe Kopf von `functions/api/[[pfad]].js`. Zusätzlich:

- `POST /api/import` nimmt den Export der NAS-App an, nur solange online noch kein Plan gespeichert ist.
- `/anmelden`, `/abmelden` (Cookie 90 Tage), `/healthz` ohne Anmeldung.
- Nach 10 Fehlversuchen von einer Adresse in 15 Minuten ist die Anmeldung von dort 15 Minuten gesperrt.

Unterschiede zur NAS-App: Gelöschte Varianten bleiben in D1 mit Zeitstempel in `varianten.geloescht` stehen
(statt Ordner `geloescht/`). Der Verlauf beginnt online neu; frühere Stände liegen weiter auf dem NAS.

## Lokal testen

```
npm install wrangler
npx wrangler pages dev public --port 8788 --d1 DB=tom-lokal --binding SEITEN_PASSWORT=testpasswort
```

Am 30.10.2026 so geprüft: 35 Schnittstellen- und Anmeldeprüfungen mit einer Kopie von Toms Plan, dazu die Seite
in Chromium auf PC- und Handygröße ohne Konsolenfehler.

## Umzug der Pläne vom NAS

Einmalig, nachdem das Pages-Projekt mit D1 und Passwort läuft, im Container Claude NAS:

```
python3 -I werkzeug/import_vom_nas.py https://<projekt>.pages.dev
```

Das Skript liest die Pläne über die Schnittstelle der NAS-App (nur lesend), meldet sich mit dem Passwort aus
`/root/.config/tom-moebelplan/passwort` an und ruft `/api/import` auf. Versionsnummern bleiben erhalten.
