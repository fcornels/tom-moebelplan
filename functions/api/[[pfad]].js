// Schnittstelle der Online-Fassung, gleich wie server.py der NAS-App (Fassung 1.3.0), Speicher D1 statt Dateien.
// Fassung 2.1.0, 30.10.2026 (Wände); 2.0.0 vom selben Tag.
//
//   GET  /api/varianten                        -> {"varianten": [{"id", "name", "version", "geaendert", "anzahl"}]}
//   POST /api/varianten                        <- {"name", "von": id?}  neue Variante, mit „von“ als Kopie
//   POST /api/varianten/<id>/umbenennen        <- {"name"}
//   POST /api/varianten/<id>/loeschen          die letzte Variante bleibt; gelöschte bleiben mit Zeitstempel in D1
//   GET  /api/plan?v=                          -> {"variante", "version", "geaendert", "plan": {...} | null}
//   PUT  /api/plan?v=                          <- {"version", "plan", "client", "sicherung"} -> 200 oder 409 mit Stand
//   GET  /api/verlauf?v=                       -> {"staende": [...]} (neueste zuerst)
//   POST /api/verlauf/<nr>/wiederherstellen?v= <- {"version"}
//   POST /api/import                           <- Export der NAS-App, nur solange noch kein Plan gespeichert ist
//   GET  /api/wohnung                          -> {"version", "geaendert", "daten": {"x", "y", "gemessen"} | null}
//   PUT  /api/wohnung                          <- {"version", "daten"} -> 200 oder 409 mit Stand (seit Fassung 2.1.0:
//                                                 nachgemessene Wände, Versatz je Wandlinie in cm, für alle Varianten)
//
// Verlauf: die letzten 20 Stände je Variante. Gesichert wird der Stand vor einer Änderung, aber nur einmal je
// Bearbeitungsfolge (dasselbe Gerät innerhalb von 2 Minuten). Zurücksetzen und Wiederherstellen sichern immer.
import { tabellen, jetzt, json } from "../_lib.js";

const VERLAUF_MAX = 20;
const FOLGE_SEK = 120;
const MAX_BODY = 512 * 1024;
const TYPEN = new Set(["sofa", "ecksofa", "sessel", "tisch", "stuhl", "schrank", "bett", "board", "geraet", "eigen"]);
const ANSCHLUSS_TYPEN = new Set(["steckdose", "netzwerk", "tv"]);

class Fehler extends Error {
  constructor(status, text) { super(text); this.status = status; }
}

function zahl(v, lo, hi) {
  if (typeof v !== "number" || Number.isNaN(v) || v < lo || v > hi) throw new Fehler(400, "Zahl außerhalb des Bereichs");
  return Math.round(v * 100) / 100;
}

// Nur die Felder, die die Seite schreibt; alles andere fällt weg (wie pruefe_plan in server.py).
function pruefePlan(p) {
  if (!p || typeof p !== "object" || !Array.isArray(p.items) || p.items.length > 300)
    throw new Fehler(400, "plan.items fehlt oder ist zu lang");
  const items = p.items.map((i) => {
    if (!i || typeof i !== "object" || Array.isArray(i)) throw new Fehler(400, "Möbel ist kein Objekt");
    const typ = String(i.type || "eigen");
    const rot = i.rot === undefined ? 0 : i.rot;
    if (![0, 90, 180, 270].includes(rot)) throw new Fehler(400, "rot muss 0, 90, 180 oder 270 sein");
    const m = { type: TYPEN.has(typ) ? typ : "eigen", name: String(i.name || "Möbel").slice(0, 80),
                w: zahl(i.w, 1, 1000), d: zahl(i.d, 1, 1000), x: zahl(i.x, -500, 1500), y: zahl(i.y, -500, 1500), rot };
    if (m.type === "ecksofa") {
      m.t = zahl(i.t === undefined ? 90 : i.t, 20, 500);
      m.spiegel = i.spiegel === true;
    }
    return m;
  });
  const roh = p.anschluesse || [];
  if (!Array.isArray(roh) || roh.length > 300) throw new Fehler(400, "plan.anschluesse ist keine Liste oder zu lang");
  const anschluesse = roh.map((a) => {
    if (!a || typeof a !== "object" || !ANSCHLUSS_TYPEN.has(a.typ) || !["l", "r", "o", "u"].includes(a.seite))
      throw new Fehler(400, "Anschluss mit unbekanntem Typ oder unbekannter Wandseite");
    const anzahl = a.anzahl === undefined ? 1 : a.anzahl;
    if (![1, 2, 3, 4].includes(anzahl)) throw new Fehler(400, "anzahl muss 1 bis 4 sein");
    return { typ: a.typ, anzahl, seite: a.seite, x: zahl(a.x, -100, 1200), y: zahl(a.y, -100, 1200),
             hoehe: zahl(a.hoehe === undefined ? 30 : a.hoehe, 0, 260), notiz: String(a.notiz || "").slice(0, 120) };
  });
  return { items, grid: p.grid !== false, anschluesse };
}

function pruefeName(n) {
  n = String(n || "").replace(/\s+/g, " ").trim();
  if (n.length < 1 || n.length > 60) throw new Fehler(400, "Name muss 1 bis 60 Zeichen haben");
  return n;
}

// ---------------------------------------------------------------- Varianten

async function liste(DB) {
  // Beim allerersten Aufruf die Variante v1 anlegen, wie einrichten() in server.py
  const z = await DB.prepare("SELECT wert FROM zaehler WHERE name = 'naechste'").first();
  if (!z) {
    await DB.batch([
      DB.prepare("INSERT OR IGNORE INTO varianten (id, name, angelegt, pos) VALUES ('v1', 'Standardmaße', ?, 1)").bind(jetzt()),
      DB.prepare("INSERT OR IGNORE INTO zaehler (name, wert) VALUES ('naechste', 2)"),
    ]);
  }
  const { results } = await DB.prepare("SELECT id, name FROM varianten WHERE geloescht IS NULL ORDER BY pos, id").all();
  return results;
}

async function variante(DB, vid) {
  const l = await liste(DB);
  if (!vid) return l.length ? l[0].id : null;
  return l.some((v) => v.id === vid) ? vid : null;
}

async function stand(DB, vid) {
  const r = await DB.prepare("SELECT version, geaendert, plan FROM plaene WHERE vid = ?").bind(vid).first();
  return r ? { version: r.version, geaendert: r.geaendert, plan: JSON.parse(r.plan) } : { version: 0, geaendert: null, plan: null };
}

async function variantenInfo(DB) {
  const aus = [];
  for (const v of await liste(DB)) {
    const st = await stand(DB, v.id);
    aus.push({ id: v.id, name: v.name, version: st.version, geaendert: st.geaendert,
               anzahl: st.plan ? st.plan.items.length : null });
  }
  return { varianten: aus };
}

function sichern(DB, vid, st, grund) {
  // Gibt die Anweisungen zurück; ausgeführt werden sie zusammen mit dem neuen Stand in einem Batch
  if (!st.plan) return [];
  return [
    DB.prepare(`INSERT INTO verlauf (vid, nr, zeit, version, grund, plan)
                SELECT ?1, COALESCE(MAX(nr), 0) + 1, ?2, ?3, ?4, ?5 FROM verlauf WHERE vid = ?1`)
      .bind(vid, st.geaendert || jetzt(), st.version, grund, JSON.stringify(st.plan)),
    DB.prepare(`DELETE FROM verlauf WHERE vid = ?1 AND nr <= (SELECT MAX(nr) FROM verlauf WHERE vid = ?1) - ?2`)
      .bind(vid, VERLAUF_MAX),
  ];
}

async function speichern(DB, vid, neuPlan, version, client, immerSichern, grund) {
  const st = await stand(DB, vid);
  if (version !== st.version) return [409, { fehler: "Inzwischen wurde auf einem anderen Gerät gespeichert.", ...st }];
  const t = Date.now() / 1000;
  const ls = (await DB.prepare("SELECT client, zeit FROM folge WHERE vid = ?").bind(vid).first()) || { client: null, zeit: 0 };
  const anweisungen = immerSichern || client !== ls.client || t - ls.zeit > FOLGE_SEK ? sichern(DB, vid, st, grund) : [];
  const neu = { version: st.version + 1, geaendert: jetzt(), plan: neuPlan };
  const schreiben = st.version === 0 && !st.plan
    ? DB.prepare("INSERT OR IGNORE INTO plaene (vid, version, geaendert, plan) VALUES (?, ?, ?, ?)")
        .bind(vid, neu.version, neu.geaendert, JSON.stringify(neuPlan))
    : DB.prepare("UPDATE plaene SET version = ?, geaendert = ?, plan = ? WHERE vid = ? AND version = ?")
        .bind(neu.version, neu.geaendert, JSON.stringify(neuPlan), vid, st.version);
  const erg = await DB.batch([schreiben, ...anweisungen,
    DB.prepare("INSERT OR REPLACE INTO folge (vid, client, zeit) VALUES (?, ?, ?)").bind(vid, client, t)]);
  if (!erg[0].meta.changes) // ein anderes Gerät war im selben Augenblick schneller
    return [409, { fehler: "Inzwischen wurde auf einem anderen Gerät gespeichert.", ...(await stand(DB, vid)) }];
  return [200, neu];
}

async function anlegen(DB, name, von) {
  await liste(DB);
  const n = (await DB.prepare("SELECT wert FROM zaehler WHERE name = 'naechste'").first()).wert;
  const vid = `v${n}`;
  const anw = [
    DB.prepare("INSERT INTO varianten (id, name, angelegt, pos) VALUES (?, ?, ?, ?)").bind(vid, name, jetzt(), n),
    DB.prepare("UPDATE zaehler SET wert = ? WHERE name = 'naechste'").bind(n + 1),
  ];
  if (von) {
    const quelle = await variante(DB, von);
    if (!quelle) throw new Fehler(404, "Variante zum Kopieren gibt es nicht");
    const st = await stand(DB, quelle);
    if (st.plan) anw.push(DB.prepare("INSERT INTO plaene (vid, version, geaendert, plan) VALUES (?, 1, ?, ?)")
      .bind(vid, jetzt(), JSON.stringify(st.plan)));
  }
  await DB.batch(anw);
  return vid;
}

// ---------------------------------------------------------------- Wände (seit Fassung 2.1.0)

const SCHLUESSEL = /^[a-z0-9_]{1,30}$/;

function pruefeWohnung(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new Fehler(400, "daten fehlt");
  const aus = { x: {}, y: {}, gemessen: {} };
  for (const achse of ["x", "y"]) {
    const roh = d[achse] || {};
    if (typeof roh !== "object" || Array.isArray(roh) || Object.keys(roh).length > 20) throw new Fehler(400, `daten.${achse} fehlerhaft`);
    for (const [k, v] of Object.entries(roh)) {
      if (!SCHLUESSEL.test(k)) throw new Fehler(400, "Wandlinie mit unbekanntem Namen");
      const z = zahl(v, -200, 200);
      if (z !== 0) aus[achse][k] = z;
    }
  }
  const g = d.gemessen || {};
  if (typeof g !== "object" || Array.isArray(g) || Object.keys(g).length > 20) throw new Fehler(400, "daten.gemessen fehlerhaft");
  for (const [k, v] of Object.entries(g)) {
    if (!SCHLUESSEL.test(k) || !v || typeof v !== "object") throw new Fehler(400, "Messung fehlerhaft");
    const m = { zeit: String(v.zeit || "").slice(0, 40) };
    for (const f of ["breite", "tiefe"]) if (v[f] !== undefined && v[f] !== null) m[f] = zahl(v[f], 10, 2000);
    aus.gemessen[k] = m;
  }
  return aus;
}

async function wohnung(DB) {
  const r = await DB.prepare("SELECT version, geaendert, daten FROM wohnung WHERE id = 1").first();
  return r ? { version: r.version, geaendert: r.geaendert, daten: JSON.parse(r.daten) } : { version: 0, geaendert: null, daten: null };
}

async function wohnungSpeichern(DB, d) {
  if (!Number.isInteger(d.version)) throw new Fehler(400, "version fehlt");
  const daten = pruefeWohnung(d.daten);
  const st = await wohnung(DB);
  if (d.version !== st.version) return [409, { fehler: "Die Wandmaße wurden inzwischen auf einem anderen Gerät geändert.", ...st }];
  const neu = { version: st.version + 1, geaendert: jetzt(), daten };
  const anw = [st.version === 0
    ? DB.prepare("INSERT OR IGNORE INTO wohnung (id, version, geaendert, daten) VALUES (1, ?, ?, ?)").bind(neu.version, neu.geaendert, JSON.stringify(daten))
    : DB.prepare("UPDATE wohnung SET version = ?, geaendert = ?, daten = ? WHERE id = 1 AND version = ?")
        .bind(neu.version, neu.geaendert, JSON.stringify(daten), st.version)];
  if (st.daten) anw.push(
    DB.prepare("INSERT INTO wohnung_verlauf (zeit, version, daten) VALUES (?, ?, ?)").bind(st.geaendert, st.version, JSON.stringify(st.daten)),
    DB.prepare("DELETE FROM wohnung_verlauf WHERE nr <= (SELECT MAX(nr) FROM wohnung_verlauf) - ?").bind(VERLAUF_MAX));
  const erg = await DB.batch(anw);
  if (!erg[0].meta.changes) return [409, { fehler: "Die Wandmaße wurden inzwischen auf einem anderen Gerät geändert.", ...(await wohnung(DB)) }];
  return [200, neu];
}

// Einmaliger Import aus der NAS-App: {"naechste": n, "varianten": [{"id", "name", "angelegt", "version", "geaendert", "plan"}]}
async function importieren(DB, d) {
  const belegt = await DB.prepare("SELECT COUNT(*) AS n FROM plaene").first();
  if (belegt.n > 0) throw new Fehler(409, "Import nur, solange online noch kein Plan gespeichert ist.");
  if (!Array.isArray(d.varianten) || !d.varianten.length || !Number.isInteger(d.naechste)) throw new Fehler(400, "Import unvollständig");
  const anw = [DB.prepare("DELETE FROM varianten"), DB.prepare("DELETE FROM verlauf"), DB.prepare("DELETE FROM folge"),
               DB.prepare("INSERT OR REPLACE INTO zaehler (name, wert) VALUES ('naechste', ?)").bind(d.naechste)];
  d.varianten.forEach((v, i) => {
    if (!/^v\d+$/.test(String(v.id)) || !Number.isInteger(v.version)) throw new Fehler(400, "Variante im Import fehlerhaft");
    anw.push(DB.prepare("INSERT INTO varianten (id, name, angelegt, pos) VALUES (?, ?, ?, ?)")
      .bind(v.id, pruefeName(v.name), String(v.angelegt || jetzt()), i + 1));
    if (v.plan) anw.push(DB.prepare("INSERT INTO plaene (vid, version, geaendert, plan) VALUES (?, ?, ?, ?)")
      .bind(v.id, v.version, String(v.geaendert || jetzt()), JSON.stringify(pruefePlan(v.plan))));
  });
  await DB.batch(anw);
}

// ---------------------------------------------------------------- HTTP

async function body(request, leerErlaubt = false) {
  const text = await request.text();
  if (!text && leerErlaubt) return {};
  if (!text || text.length > MAX_BODY) throw new Fehler(400, "Inhalt fehlt oder ist zu groß");
  let d;
  try { d = JSON.parse(text); } catch { throw new Fehler(400, "Inhalt ist kein JSON"); }
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new Fehler(400, "Inhalt ist kein Objekt");
  return d;
}

async function behandeln(request, DB) {
  const url = new URL(request.url);
  const pfad = url.pathname;
  const v = url.searchParams.get("v") || "";
  const methode = request.method;

  if (pfad === "/api/wohnung") {
    if (methode === "GET" || methode === "HEAD") return json(200, await wohnung(DB));
    if (methode === "PUT") { const [status, daten] = await wohnungSpeichern(DB, await body(request)); return json(status, daten); }
    return json(405, { fehler: "Methode nicht erlaubt" });
  }

  if (methode === "GET" || methode === "HEAD") {
    if (pfad === "/api/varianten") return json(200, await variantenInfo(DB));
    const vid = await variante(DB, v);
    if (pfad === "/api/plan" || pfad === "/api/verlauf") {
      if (!vid) return json(404, { fehler: "Variante gibt es nicht" });
      if (pfad === "/api/plan") return json(200, { variante: vid, ...(await stand(DB, vid)) });
      const { results } = await DB.prepare("SELECT nr, zeit, version, grund, plan FROM verlauf WHERE vid = ? ORDER BY nr DESC")
        .bind(vid).all();
      return json(200, { staende: results.map((e) => ({ nr: e.nr, zeit: e.zeit, version: e.version, grund: e.grund || "",
                                                         anzahl: JSON.parse(e.plan).items.length })) });
    }
    return json(404, { fehler: "nicht gefunden" });
  }

  if (methode === "PUT") {
    if (pfad !== "/api/plan") return json(404, { fehler: "nicht gefunden" });
    const d = await body(request);
    const plan = pruefePlan(d.plan);
    if (!Number.isInteger(d.version)) throw new Fehler(400, "version fehlt");
    const vid = await variante(DB, v);
    if (!vid) return json(404, { fehler: "Variante gibt es nicht mehr" });
    const [status, daten] = await speichern(DB, vid, plan, d.version, String(d.client ?? "").slice(0, 40),
      Boolean(d.sicherung), d.sicherung ? "vor Zurücksetzen" : "Bearbeitung");
    return json(status, { variante: vid, ...daten });
  }

  if (methode === "POST") {
    const d = await body(request, true);
    if (pfad === "/api/import") {
      await importieren(DB, d);
      return json(200, await variantenInfo(DB));
    }
    if (pfad === "/api/varianten") {
      const vid = await anlegen(DB, pruefeName(d.name), d.von);
      return json(200, { id: vid, ...(await variantenInfo(DB)) });
    }
    let m = pfad.match(/^\/api\/varianten\/(v\d+)\/(umbenennen|loeschen)$/);
    if (m) {
      const l = await liste(DB);
      if (!l.some((x) => x.id === m[1])) return json(404, { fehler: "Variante gibt es nicht" });
      if (m[2] === "umbenennen") {
        await DB.prepare("UPDATE varianten SET name = ? WHERE id = ?").bind(pruefeName(d.name), m[1]).run();
      } else {
        if (l.length < 2) return json(409, { fehler: "Die letzte Variante bleibt erhalten." });
        await DB.prepare("UPDATE varianten SET geloescht = ? WHERE id = ?").bind(jetzt(), m[1]).run();
      }
      return json(200, await variantenInfo(DB));
    }
    m = pfad.match(/^\/api\/verlauf\/(\d+)\/wiederherstellen$/);
    if (m) {
      const vid = await variante(DB, v);
      if (!vid) return json(404, { fehler: "Variante gibt es nicht" });
      if (!Number.isInteger(d.version)) throw new Fehler(400, "version fehlt");
      const e = await DB.prepare("SELECT nr, plan FROM verlauf WHERE vid = ? AND nr = ?").bind(vid, Number(m[1])).first();
      if (!e) return json(404, { fehler: "Stand nicht mehr vorhanden" });
      const [status, daten] = await speichern(DB, vid, JSON.parse(e.plan), d.version, String(d.client ?? "").slice(0, 40),
        true, `vor Wiederherstellen von Stand ${e.nr}`);
      return json(status, { variante: vid, ...daten });
    }
  }
  return json(404, { fehler: "nicht gefunden" });
}

export async function onRequest({ request, env }) {
  try {
    await tabellen(env.DB);
    return await behandeln(request, env.DB);
  } catch (e) {
    if (e instanceof Fehler) return json(e.status, { fehler: e.message });
    return json(500, { fehler: "Serverfehler: " + (e && e.message ? e.message : String(e)) });
  }
}
