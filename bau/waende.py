"""Fassung 2.1.0 (30.10.2026, Wunsch Frank): Räume nachmessen und Wände verschieben. Ändert public/index.html.
Jede Ersetzung muss genau einmal passen, sonst bricht das Skript ab (wie bau/bauen.py der NAS-App).
Aufruf: python3 -I bau/waende.py public/index.html
"""
import sys

p = sys.argv[1]
s = open(p, encoding="utf-8").read()


def ersetze(alt, neu):
    global s
    n = s.count(alt)
    if n != 1:
        sys.exit(f"Ersetzung passt {n}-mal statt 1-mal: {alt[:90]!r}")
    s = s.replace(alt, neu)


# 1. Start erst nach dem Laden der Wandmaße, damit alle Maße beim Aufbau schon stimmen
ersetze('<script>\n(function(){\n"use strict";\nconst NS = ',
        '<script>\nwindow.__planStart = function(GEO){\n"use strict";\nconst NS = ')
ersetze('laden();\n})();\n</script>',
        'messPanel();\nladen();\n};\n'
        '/* Wandmaße zuerst holen (Fassung 2.1.0); schlägt das fehl, gilt die Zeichnung und Nachmessen ist gesperrt */\n'
        'fetch("api/wohnung", {cache:"no-store"}).then(r => r.ok ? r.json() : {fehler:true}).catch(() => ({fehler:true}))\n'
        '  .then(d => window.__planStart(d));\n</script>')

# 2. Geometrie: Wandlinien, Versatz, Anwenden auf Räume, Türen, Fenster, Einbauten
ersetze('  {name:"WT", x:238,y:955,w:45,h:55}\n];\n', '  {name:"WT", x:238,y:955,w:45,h:55}\n];\n' + r'''
/* ================= Nachgemessene Wände (Fassung 2.1.0, 30.10.2026) =================
   Jede Wand ist eine Wandlinie mit beiden Seiten; sie wandert als Ganzes, die Wandstärke bleibt. Gespeichert wird nur
   der Versatz je Wandlinie in cm (/api/wohnung, für alle Varianten gleich). Räume folgen ihren Wandlinien. Türen,
   Fenster, Einbauten, Beschriftungen, 3D-Einbauten und Blickpunkte wandern mit dem Raum, in dem sie liegen: an einer
   Wand anliegend mit dieser Wand, sonst anteilig. Möbel und Anschlüsse bleiben, wo sie sind. */
const GX = {west:[-24,0], kueche_bad:[226,238], abst_flur:[296,302.5], terrasse:[301,331], z2_z1:[338.5,350.5],
            ost_flur:[463.5,464,487.5,488], ost_z1:[739,763]};
const GY = {terr_nord:[-6,0], z1_nord:[6,30], terr_z2:[134.5,144.5,164.5], z_flur:[578,590], flur_kueche:[728.5,740.5],
            flur_bad:[849.5,850,857], sued:[1029,1053]};
function normGeo(d){
  const n = {x:{}, y:{}, gemessen:{}};
  if(d && typeof d === "object"){
    for(const a of ["x","y"]) for(const [k,v] of Object.entries(d[a] || {})) if((a==="x"?GX:GY)[k] && typeof v === "number" && isFinite(v)) n[a][k] = v;
    if(d.gemessen && typeof d.gemessen === "object") n.gemessen = d.gemessen;
  }
  return n;
}
const WOHNUNG = {version: (GEO && GEO.version) || 0, fehler: !GEO || !!GEO.fehler, daten: normGeo(GEO && GEO.daten)};
function gruppeVon(achse, v){ const G = achse==="x" ? GX : GY; for(const id in G) if(G[id].some(w => Math.abs(w-v) < 0.6)) return id; return null; }
const dGr = (V, achse, id) => id ? (V[achse][id] || 0) : 0;
const TEILE = [];
ROOMS.forEach((r, ri) => r.r.forEach((q, qi) => {
  const b = {x:q.x, y:q.y, w:q.w, h:q.h};
  TEILE.push({key: r.r.length > 1 ? r.id + (qi+1) : r.id, name: r.r.length > 1 ? r.name + (qi ? " (Stich)" : " (Hauptteil)") : r.name,
              ri, qi, basis:b, l:gruppeVon("x", b.x), r:gruppeVon("x", b.x+b.w), o:gruppeVon("y", b.y), u:gruppeVon("y", b.y+b.h)});
}));
TEILE.forEach(t => { if(!t.l || !t.r || !t.o || !t.u) throw new Error("Wandlinie fehlt für " + t.name); });
function teilRechteck(t, V){
  const b = t.basis, x1 = b.x + dGr(V,"x",t.l), x2 = b.x + b.w + dGr(V,"x",t.r), y1 = b.y + dGr(V,"y",t.o), y2 = b.y + b.h + dGr(V,"y",t.u);
  return {x:x1, y:y1, w:x2-x1, h:y2-y1};
}
function basisTeilBei(px, py){ return TEILE.find(t => px >= t.basis.x-0.01 && px <= t.basis.x+t.basis.w+0.01 && py >= t.basis.y-0.01 && py <= t.basis.y+t.basis.h+0.01); }
// Versatz eines Elements (Rechteck in den Maßen der Zeichnung)
function versatzFuer(q, V){
  V = V || WOHNUNG.daten;
  const cx = q.x+q.w/2, cy = q.y+q.h/2;
  let t = basisTeilBei(cx, cy);
  for(const [ox,oy] of [[0,25],[0,-25],[25,0],[-25,0],[0,45],[0,-45],[45,0],[-45,0]]){ if(t) break; t = basisTeilBei(cx+ox, cy+oy); }
  if(!t) return {dx:0, dy:0};
  const b = t.basis;
  const achse = (lo, hi, a0, a1, gA, gB, ax) => {
    const dA = dGr(V,ax,gA), dB = dGr(V,ax,gB);
    if(Math.abs(lo-a0) < 0.6 || Math.abs(hi-a0) < 0.6) return dA;
    if(Math.abs(hi-a1) < 0.6 || Math.abs(lo-a1) < 0.6) return dB;
    return dA + (dB-dA) * Math.min(1, Math.max(0, ((lo+hi)/2 - a0) / (a1 - a0)));
  };
  return {dx:achse(q.x, q.x+q.w, b.x, b.x+b.w, t.l, t.r, "x"), dy:achse(q.y, q.y+q.h, b.y, b.y+b.h, t.o, t.u, "y")};
}
function punkt(x, y){ const v = versatzFuer({x, y, w:0, h:0}); return [x+v.dx, y+v.dy]; }
const geaendert = (t, V) => { const a = teilRechteck(t, V); return Math.abs(a.w-t.basis.w) > 0.01 || Math.abs(a.h-t.basis.h) > 0.01; };
const mStr = cm => (cm/100).toLocaleString("de-DE", {maximumFractionDigits:3});
const cmStr = cm => cm.toLocaleString("de-DE", {maximumFractionDigits:1});
const AUSDEHNUNG = {x0:0, x1:739, y0:0, y1:1029};
(function anwenden(){
  const V = WOHNUNG.daten, nah = (achse, v) => {
    const g = gruppeVon(achse, v); if(g) return dGr(V, achse, g);
    let best = null, ab = Infinity; const G = achse==="x" ? GX : GY;
    for(const id in G) for(const w of G[id]) if(Math.abs(w-v) < ab){ ab = Math.abs(w-v); best = id; }
    return dGr(V, achse, best);
  };
  const schieb = q => { const v = versatzFuer(q, V); q.x += v.dx; q.y += v.dy; return v; };
  DOORS.forEach(d => { const v = schieb(d.gap); [d.H, d.C, d.O].forEach(p => { p[0] += v.dx; p[1] += v.dy; });
    const xs=[d.H[0],d.C[0],d.O[0]], ys=[d.H[1],d.C[1],d.O[1]];
    d.zone = {x:Math.min(...xs), y:Math.min(...ys), w:Math.max(...xs)-Math.min(...xs), h:Math.max(...ys)-Math.min(...ys)}; });
  WINDOWS.forEach(schieb);
  FIXED.forEach(schieb);
  EXTRA_WALLS.forEach(q => { const x1 = q.x + nah("x", q.x), x2 = q.x + q.w + nah("x", q.x+q.w), y1 = q.y + nah("y", q.y), y2 = q.y + q.h + nah("y", q.y+q.h);
    Object.assign(q, {x:x1, y:y1, w:x2-x1, h:y2-y1}); });
  TEILE.forEach(t => Object.assign(ROOMS[t.ri].r[t.qi], teilRechteck(t, V)));
  // Beschriftung geänderter Räume neu: Maße und Fläche aus dem Plan
  ROOMS.forEach((r, ri) => {
    const ts = TEILE.filter(t => t.ri === ri); if(!ts.some(t => geaendert(t, V))) return;
    const fl = r.r.reduce((s, q) => s + q.w*q.h/10000, 0), qm = fl.toLocaleString("de-DE", {minimumFractionDigits:2, maximumFractionDigits:2});
    if(r.lines.length === 2) r.lines[1] = `${mStr(r.r[0].w)} × ${mStr(r.r[0].h)} m · ${qm} m²`;
    else if(r.lines[0].includes(" · ")) r.lines[0] = r.lines[0].split(" · ")[0] + ` · ${qm} m²`;
  });
  const xs = FLOORS.flatMap(q => [q.x, q.x+q.w]), ys = FLOORS.flatMap(q => [q.y, q.y+q.h]);
  VB.x = Math.min(...xs) - 60; VB.w = Math.max(...xs) - Math.min(...xs) + 121;
  VB.y = Math.min(...ys) - 50; VB.h = Math.max(...ys) - Math.min(...ys) + 111;
  Object.assign(AUSDEHNUNG, {x0:Math.min(...xs), x1:Math.max(...xs), y0:Math.min(...ys), y1:Math.max(...ys)});
})();
function messHinweis(){
  const n = Object.keys(WOHNUNG.daten.gemessen).length;
  return n ? `Maße teils vor Ort nachgemessen (${n} von ${TEILE.length} Raumteilen), übrige aus der Vermietungszeichnung; Türen, Fenster und Wandstärken geschätzt.`
           : "Maße aus der Vermietungszeichnung (nicht maßstabsgetreu), Türen, Fenster und Wände geschätzt. Vor Ort nachmessen.";
}
''')

# 3. Feste Koordinaten im Grundriss mitnehmen
ersetze('el("line", {x1:0, y1:0, x2:301, y2:0, class:"rail"}, back);',
        '{ const a = punkt(0, 0), b = punkt(301, 0); el("line", {x1:a[0], y1:a[1], x2:b[0], y2:b[1], class:"rail"}, back); }')
ersetze('for(let x=50; x<750; x+=50) el("line", {x1:x, y1:0, x2:x, y2:1030, class:"gridl"}, g);',
        'for(let x=Math.floor(AUSDEHNUNG.x0/50)*50+50; x<AUSDEHNUNG.x1; x+=50) el("line", {x1:x, y1:AUSDEHNUNG.y0, x2:x, y2:AUSDEHNUNG.y1+1, class:"gridl"}, g);')
ersetze('for(let y=50; y<1030; y+=50) el("line", {x1:0, y1:y, x2:740, y2:y, class:"gridl"}, g);',
        'for(let y=Math.floor(AUSDEHNUNG.y0/50)*50+50; y<AUSDEHNUNG.y1; y+=50) el("line", {x1:AUSDEHNUNG.x0, y1:y, x2:AUSDEHNUNG.x1+1, y2:y, class:"gridl"}, g);')
ersetze('const et = el("text", {x:500, y:652, "font-size":11*U, class:"entry"}, back);',
        'const ep = punkt(500, 652), et = el("text", {x:ep[0], y:ep[1], "font-size":11*U, class:"entry"}, back);')
ersetze('case "bad": x = 336; y = 948; anchor = "middle"; break;',
        'case "bad": [x, y] = punkt(336, 948); anchor = "middle"; break;')
ersetze('for(let y=0; y<1040; y+=rh){', 'for(let y=Math.floor(AUSDEHNUNG.y0/rh)*rh; y<AUSDEHNUNG.y1+11; y+=rh){')
ersetze('let x = -((y/rh*67) % 180);', 'let x = -(((y/rh*67) % 180 + 180) % 180) - 180;')
ersetze('while(x < 760){', 'while(x < 1000){')
ersetze('Maße aus der Vermietungszeichnung (nicht maßstabsgetreu), Türen, Fenster und Wände geschätzt. Vor Ort nachmessen.</text>',
        '${xmlText(messHinweis())}</text>')

# 4. 3D: Blickpunkte, Startpunkt beim Begehen und Einbauten mitnehmen
ersetze('const walk = {x:6.0, z:5.35, yaw:0, pitch:0};\n',
        'const walk = {x:6.0, z:5.35, yaw:0, pitch:0};\n'
        '[...VIEWS, walk].forEach(v => { const a = punkt(v.x*100, v.z*100); v.x = a[0]/100; v.z = a[1]/100;\n'
        '  if(v.look){ const b = punkt(v.look[0]*100, v.look[2]*100); v.look[0] = b[0]/100; v.look[2] = b[1]/100; } });\n')
ersetze('  bx(3.0,0.8,0.01,mat.glass,1.505,0.5,0.02,fixed,false);\n',
        '  bx(3.0,0.8,0.01,mat.glass,1.505,0.5,0.02,fixed,false);\n'
        '  // Nachgemessene Wände: Einbauten wandern mit ihrem Raum (Fassung 2.1.0)\n'
        '  fixed.children.forEach(o => { if(!o.geometry) return; o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox;\n'
        '    const sx = (bb.max.x-bb.min.x)*o.scale.x, sz = (bb.max.z-bb.min.z)*o.scale.z;\n'
        '    const v = versatzFuer({x:(o.position.x-sx/2)*100, y:(o.position.z-sz/2)*100, w:sx*100, h:sz*100});\n'
        '    o.position.x += v.dx/100; o.position.z += v.dy/100; });\n')

# 5. Bedienfeld „Räume nachmessen“
ersetze('      <section class="card">\n        <h2>Frühere Stände</h2>', '''      <section class="card" id="messCard">
        <h2>Räume nachmessen</h2>
        <p class="hint">Lichtes Maß von Wand zu Wand in cm eintragen. Du wählst, welche Wand sich verschiebt. Türen, Fenster, Einbauten und der Nachbarraum an dieser Wand ändern sich mit, Möbel und Anschlüsse bleiben stehen. Gilt für alle Varianten.</p>
        <label class="lbl-block">Raum<select id="mTeil"></select></label>
        <p class="hint" id="mIst"></p>
        <div class="fields">
          <label>Breite (cm)<input type="number" id="mB" step="0.5" min="30" max="1500" inputmode="decimal"></label>
          <label>Tiefe (cm)<input type="number" id="mT" step="0.5" min="30" max="1500" inputmode="decimal"></label>
        </div>
        <div class="fields">
          <label>Breite ändern an<select id="mBs"><option value="r">rechter Wand</option><option value="l">linker Wand</option></select></label>
          <label>Tiefe ändern an<select id="mTs"><option value="u">unterer Wand</option><option value="o">oberer Wand</option></select></label>
        </div>
        <p class="hint" id="mFolge"></p>
        <div class="btns">
          <button class="btn primary" id="mOk">Übernehmen</button>
          <button class="btn" id="mZurueck">Alle wie Zeichnung</button>
        </div>
        <table class="messliste"><thead><tr><th>Raum</th><th>Im Plan (cm)</th><th>Gemessen</th></tr></thead><tbody id="mListe"></tbody></table>
      </section>
      <section class="card">
        <h2>Frühere Stände</h2>''')
ersetze('</style>\n</head>', '''.messliste{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
.messliste th,.messliste td{text-align:left;padding:3px 4px;border-top:1px solid rgba(0,0,0,.08);vertical-align:top}
.messliste td:nth-child(2){font-variant-numeric:tabular-nums;white-space:nowrap}
.messliste tr.ja td:last-child{color:#1c7a4a}
</style>
</head>''')

ersetze('function bodenMuster(parent){', r'''function messPanel(){
  const sel = document.getElementById("mTeil"), ist = document.getElementById("mIst"), folge = document.getElementById("mFolge");
  const iB = document.getElementById("mB"), iT = document.getElementById("mT"), sB = document.getElementById("mBs"), sT = document.getElementById("mTs");
  const V = WOHNUNG.daten;
  sel.innerHTML = TEILE.map((t, i) => `<option value="${i}">${xmlText(t.name)}</option>`).join("");
  const liste = () => { document.getElementById("mListe").innerHTML = TEILE.map(t => {
    const a = teilRechteck(t, V), g = V.gemessen[t.key];
    return `<tr class="${g ? "ja" : ""}"><td>${xmlText(t.name)}</td><td>${cmStr(a.w)} × ${cmStr(a.h)}</td><td>${g ? "am " + xmlText(g.zeit || "") : "–"}</td></tr>`; }).join(""); };
  const andere = (t, achse, g) => TEILE.filter(u => u !== t && (achse === "x" ? (u.l === g || u.r === g) : (u.o === g || u.u === g)))
    .map(u => u.name + (achse === "x" ? " (Breite)" : " (Tiefe)"));
  const zeigen = () => {
    const t = TEILE[+sel.value], a = teilRechteck(t, V), g = V.gemessen[t.key];
    iB.value = Math.round(a.w*10)/10; iT.value = Math.round(a.h*10)/10;
    ist.textContent = `Im Plan ${cmStr(a.w)} × ${cmStr(a.h)} cm, laut Zeichnung ${cmStr(t.basis.w)} × ${cmStr(t.basis.h)} cm` + (g ? `, gemessen am ${g.zeit}.` : ".");
    folgeText();
  };
  const folgeText = () => {
    const t = TEILE[+sel.value], gB = sB.value === "r" ? t.r : t.l, gT = sT.value === "u" ? t.u : t.o;
    const fB = andere(t, "x", gB), fT = andere(t, "y", gT);
    folge.textContent = [fB.length ? "Breite ändert mit: " + fB.join(", ") + "." : "Breite: kein Nachbarraum an dieser Wand.",
                         fT.length ? "Tiefe ändert mit: " + fT.join(", ") + "." : "Tiefe: kein Nachbarraum an dieser Wand."].join(" ");
  };
  sel.onchange = zeigen; sB.onchange = folgeText; sT.onchange = folgeText;
  const senden = async (daten, meldung) => {
    if(WOHNUNG.fehler){ toast("Wandmaße konnten nicht geladen werden. Bitte Seite neu laden."); return; }
    try{
      sofortSpeichern();
      const r = await fetch("api/wohnung", {method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({version:WOHNUNG.version, daten})});
      if(r.status === 409){ toast("Die Wände wurden inzwischen woanders geändert. Die Seite lädt neu."); setTimeout(() => location.reload(), 1500); return; }
      if(!r.ok){ const d = await r.json().catch(() => ({})); toast("Nicht gespeichert: " + (d.fehler || "HTTP " + r.status)); return; }
      toast(meldung + " Der Plan wird neu aufgebaut."); setTimeout(() => location.reload(), 900);
    }catch(e){ toast("Nicht gespeichert: keine Verbindung."); }
  };
  document.getElementById("mOk").onclick = () => {
    const t = TEILE[+sel.value], a = teilRechteck(t, V), b = parseFloat(iB.value), h = parseFloat(iT.value);
    if(!(b >= 30 && b <= 1500 && h >= 30 && h <= 1500)){ toast("Bitte Breite und Tiefe zwischen 30 und 1500 cm eintragen."); return; }
    const N = {x:{...V.x}, y:{...V.y}, gemessen:{...V.gemessen}};
    const dB = Math.round((b - a.w)*10)/10, dT = Math.round((h - a.h)*10)/10;
    if(sB.value === "r") N.x[t.r] = (N.x[t.r] || 0) + dB; else N.x[t.l] = (N.x[t.l] || 0) - dB;
    if(sT.value === "u") N.y[t.u] = (N.y[t.u] || 0) + dT; else N.y[t.o] = (N.y[t.o] || 0) - dT;
    const zuKlein = TEILE.find(u => { const q = teilRechteck(u, N); return q.w < 30 || q.h < 30; });
    if(zuKlein){ toast(`So würde ${zuKlein.name} kleiner als 30 cm. Bitte die andere Wand wählen oder die Maße prüfen.`); return; }
    if([...Object.values(N.x), ...Object.values(N.y)].some(v => Math.abs(v) > 150)){ toast("Eine Wand läge mehr als 1,5 m neben der Zeichnung. Bitte die Maße prüfen."); return; }
    N.gemessen[t.key] = {breite:b, tiefe:h, zeit:heute().de};
    senden(N, `${t.name}: ${cmStr(b)} × ${cmStr(h)} cm gespeichert.`);
  };
  document.getElementById("mZurueck").onclick = () => {
    if(!confirm("Alle Wände wieder wie in der Vermietungszeichnung? Die eingetragenen Messungen gehen dabei verloren.")) return;
    senden({x:{}, y:{}, gemessen:{}}, "Wände wie Zeichnung.");
  };
  if(WOHNUNG.fehler) document.getElementById("mOk").disabled = document.getElementById("mZurueck").disabled = true;
  liste(); zeigen();
}

function bodenMuster(parent){''')

open(p, "w", encoding="utf-8").write(s)
print("geschrieben:", p, len(s.encode("utf-8")), "Byte")
