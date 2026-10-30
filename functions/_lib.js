// Gemeinsame Teile der Online-Fassung (Cloudflare Pages Functions, D1-Bindung DB).
// Fassung 2.0.0, 30.10.2026: Online-Fassung des Möblierungsplans (Entscheidung Frank 30.10.2026).

// Tabellen. Werden beim ersten Aufruf je Worker angelegt, falls sie fehlen.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS varianten (id TEXT PRIMARY KEY, name TEXT NOT NULL, angelegt TEXT NOT NULL,
     pos INTEGER NOT NULL, geloescht TEXT)`,
  `CREATE TABLE IF NOT EXISTS zaehler (name TEXT PRIMARY KEY, wert INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS plaene (vid TEXT PRIMARY KEY, version INTEGER NOT NULL, geaendert TEXT, plan TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS verlauf (vid TEXT NOT NULL, nr INTEGER NOT NULL, zeit TEXT, version INTEGER NOT NULL,
     grund TEXT, plan TEXT NOT NULL, PRIMARY KEY (vid, nr))`,
  `CREATE TABLE IF NOT EXISTS folge (vid TEXT PRIMARY KEY, client TEXT, zeit REAL NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS fehlversuche (ip TEXT NOT NULL, zeit INTEGER NOT NULL)`,
];

let bereit = false;

export async function tabellen(DB) {
  if (!DB) throw new Error("D1-Bindung DB fehlt im Pages-Projekt");
  if (bereit) return;
  await DB.batch(SCHEMA.map((s) => DB.prepare(s)));
  bereit = true;
}

// Zeit wie im Python-Server: ISO 8601 in Berliner Zeit mit Abstand zu UTC, z. B. 2026-10-30T10:15:00+01:00
export function jetzt(d = new Date()) {
  const teile = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset",
    }).formatToParts(d).map((t) => [t.type, t.value]),
  );
  const abstand = (teile.timeZoneName || "GMT").replace("GMT", "") || "+00:00";
  return `${teile.year}-${teile.month}-${teile.day}T${teile.hour}:${teile.minute}:${teile.second}${abstand}`;
}

export function json(status, daten, extra = {}) {
  return new Response(JSON.stringify(daten), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
               "X-Content-Type-Options": "nosniff", ...extra },
  });
}
