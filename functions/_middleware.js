// Passwortschutz für die ganze Seite, auch für die Vorschau-Adressen auf *.pages.dev (Entscheidung Frank 30.10.2026, F2).
// Fassung 2.0.0, 30.10.2026.
//
// Das Passwort steht nur im Pages-Projekt als Secret SEITEN_PASSWORT (Production und Preview). Fehlt es, bleibt die
// Seite gesperrt. Nach der Anmeldung gilt ein Cookie 90 Tage; es ist mit dem Passwort signiert, ein neues Passwort meldet
// also alle Geräte ab. Nach 10 Fehlversuchen von einer Adresse in 15 Minuten wird diese Adresse 15 Minuten gesperrt.
import { tabellen, json } from "./_lib.js";

const COOKIE = "tom_anmeldung";
const TAGE = 90;
const MAX_FEHL = 10;
const FENSTER_SEK = 15 * 60;

const enc = new TextEncoder();

async function signatur(passwort, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(passwort), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("tom-moebelplan|" + text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function gleich(a, b) {
  // Vergleich ohne frühen Abbruch
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let unterschied = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) unterschied |= (x[i] || 0) ^ (y[i] || 0);
  return unterschied === 0;
}

function cookie(request, name) {
  for (const teil of (request.headers.get("Cookie") || "").split(";")) {
    const [k, ...v] = teil.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

async function angemeldet(request, passwort) {
  const [ablauf, sig] = cookie(request, COOKIE).split(".");
  if (!ablauf || !sig || !(Number(ablauf) > Date.now() / 1000)) return false;
  return gleich(sig, await signatur(passwort, ablauf));
}

function ziel(url) {
  const z = url.searchParams.get("ziel") || "/";
  return z.startsWith("/") && !z.startsWith("//") ? z : "/";
}

function seite(status, meldung, zielPfad) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return new Response(`<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Möblierungsplan – Anmeldung</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#f4f3f0; color:#1f1f1f;
         font:16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  form { background:#fff; border:1px solid #e4e4e1; border-radius:12px; padding:24px; width:min(340px, 90vw); }
  h1 { font-size:20px; margin:0 0 14px; }
  input { width:100%; box-sizing:border-box; font:inherit; padding:12px; border:1px solid #c9c9c4; border-radius:8px; }
  button { margin-top:12px; width:100%; font:inherit; padding:12px; border:0; border-radius:8px; background:#18211d; color:#fff; }
  .meldung { color:#b3362f; font-size:14px; margin:0 0 10px; }
</style></head><body>
<form method="post" action="/anmelden?ziel=${encodeURIComponent(zielPfad)}">
  <h1>Möblierungsplan</h1>
  ${meldung ? `<p class="meldung">${esc(meldung)}</p>` : ""}
  <input type="password" name="passwort" autocomplete="current-password" placeholder="Passwort" required autofocus>
  <button type="submit">Anmelden</button>
</form></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}

async function anmelden(request, env, url) {
  const ip = request.headers.get("CF-Connecting-IP") || "unbekannt";
  const jetztSek = Math.floor(Date.now() / 1000);
  await tabellen(env.DB);
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM fehlversuche WHERE ip = ? AND zeit > ?")
    .bind(ip, jetztSek - FENSTER_SEK).first();
  if (n >= MAX_FEHL) return seite(429, "Zu viele Versuche. Bitte in 15 Minuten noch einmal.", ziel(url));
  const form = await request.formData().catch(() => null);
  const eingabe = form ? String(form.get("passwort") || "") : "";
  if (!gleich(eingabe, env.SEITEN_PASSWORT)) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO fehlversuche (ip, zeit) VALUES (?, ?)").bind(ip, jetztSek),
      env.DB.prepare("DELETE FROM fehlversuche WHERE zeit < ?").bind(jetztSek - 86400),
    ]);
    return seite(401, "Das Passwort stimmt nicht.", ziel(url));
  }
  const ablauf = String(jetztSek + TAGE * 86400);
  return new Response(null, {
    status: 303,
    headers: {
      Location: ziel(url),
      "Set-Cookie": `${COOKIE}=${ablauf}.${await signatur(env.SEITEN_PASSWORT, ablauf)}; Max-Age=${TAGE * 86400}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (url.pathname === "/healthz") return new Response("ok\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (!env.SEITEN_PASSWORT)
    return new Response("Gesperrt: Im Cloudflare-Projekt fehlt das Secret SEITEN_PASSWORT.\n",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  try {
    if (url.pathname === "/anmelden") {
      if (request.method === "POST") return await anmelden(request, env, url);
      return seite(200, "", ziel(url));
    }
    if (url.pathname === "/abmelden")
      return new Response(null, { status: 303, headers: { Location: "/anmelden",
        "Set-Cookie": `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax` } });
    if (!(await angemeldet(request, env.SEITEN_PASSWORT))) {
      if (url.pathname.startsWith("/api/")) return json(401, { fehler: "Bitte neu anmelden (Seite neu laden)." });
      return Response.redirect(new URL("/anmelden?ziel=" + encodeURIComponent(url.pathname + url.search), url).toString(), 303);
    }
    const antwort = await next();
    const neu = new Response(antwort.body, antwort);
    neu.headers.set("X-Robots-Tag", "noindex, nofollow");
    return neu;
  } catch (e) {
    return json(500, { fehler: "Serverfehler: " + (e && e.message ? e.message : String(e)) });
  }
}
