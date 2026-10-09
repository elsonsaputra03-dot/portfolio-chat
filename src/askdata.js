// "Ask the Data" versi publik: pertanyaan tentang data Indonesia Realtime Monitor, dijawab dari snapshot JSON per jam.
// Pola sama dengan versi lokal (app/api/ask.py): router memilih alat, KODE menghitung fakta, model hanya merangkai kalimat.
//   - Lokasi selalu dari gazetteer (ask_gazetteer.json), tidak pernah dari model.
//   - Router aturan (kata kunci) dulu; Gemini hanya memilih alat bila aturan tidak menemukan apa pun.
//   - Bila Gemini tidak tersedia (kuota/error), jawaban = fakta yang dihitung kode.

const DATA_URL = "https://elsonsaputra03-dot.github.io/indo-realtime-monitor/data/";
const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

export async function snap(name, env = {}, fetchImpl = fetch) {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.v;
  const r = await fetchImpl((env.DATA_URL || DATA_URL) + name, { cf: { cacheTtl: 600 } });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  const v = await r.json();
  cache.set(name, { t: Date.now(), v });
  return v;
}
export const clearCache = () => cache.clear();

// ---------------------------------------------------------------- format
export const norm = s => String(s || "").toLowerCase().replace(/[’`]/g, "'").replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();
export function f(v, d = 1) {
  if (v == null || !isFinite(v)) return "–";
  const [i, dec] = Math.abs(v).toFixed(d).split(".");
  return (v < 0 ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (dec ? "," + dec : "");
}
const n0 = v => f(v, 0);
const rp = v => "Rp" + n0(Math.round(v));
const pad = x => String(x).padStart(2, "0");
const toDate = s => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? s : String(s).replace(" ", "T") + "Z");
export function wib(s) {
  const d = new Date(toDate(s).getTime() + 7 * 3600e3);
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} WIB`;
}
const hariTxt = h => (h === 1 ? "24 jam terakhir" : `${h} hari terakhir`);
const clamp = (v, lo, hi, def) => (Number.isFinite(+v) && v !== null && v !== "" ? Math.max(lo, Math.min(hi, Math.round(+v))) : def);
export function haversine(a1, o1, a2, o2) {
  const p = Math.PI / 180;
  const a = Math.sin((a2 - a1) * p / 2) ** 2 + Math.cos(a1 * p) * Math.cos(a2 * p) * Math.sin((o2 - o1) * p / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------- lokasi (gazetteer)
export function resolvePlace(question, gaz) {
  const q = ` ${norm(question)} `;
  const amb = new Set(gaz.ambiguous || []);
  let best = null;
  for (const [key, codes] of Object.entries(gaz.keys)) {
    if (key.length < 3 || !q.includes(` ${key} `)) continue;
    const prefixed = [" kota ", " kabupaten ", " kab "].some(p => q.includes(`${p}${key} `));
    if (amb.has(key) && !prefixed) continue;
    if (!best || key.length > best.key.length) best = { key, codes };
  }
  if (!best) return null;
  const rows = best.codes.map(c => gaz.rows[c]).filter(Boolean);
  if (!rows.length) return null;
  const prefer = q.includes(` kota ${best.key} `) ? "kota" : (q.includes(` kabupaten ${best.key} `) || q.includes(` kab ${best.key} `)) ? "kabupaten" : null;
  let pool = rows;
  const prov = rows.filter(r => r.lv === 1);
  if (prov.length && !prefer) pool = prov;                                        // "Jawa Barat", "Jakarta" -> provinsi
  else {
    if (prefer) pool = rows.filter(r => r.lv === 1 || r.j === prefer).length ? rows.filter(r => r.lv === 1 || r.j === prefer) : rows;
    pool = [...pool].sort((a, b) => b.lv - a.lv || (a.j !== "kabupaten") - (b.j !== "kabupaten"));
  }
  const p = pool[0], pr = gaz.rows[p.pk] || {};
  const area = p.luas || (p.lv === 1 ? 50000 : 2000);
  return { kode: p.k, nama: p.n, level: p.lv, lat: p.lat, lng: p.lng, prov_kode: p.pk, prov_nama: pr.n || p.n, matched: best.key,
           radius_km: Math.max(30, 1.3 * Math.sqrt(area / Math.PI)), luas: p.luas, pend: p.pend,
           ambiguous: pool.filter(r => r.lv === p.lv).length > 1 };
}
const inPlace = (place, kode) => (place.level === 2 ? kode === place.kode : String(kode).split(".")[0] === place.prov_kode);
function provCodeOf(name, gaz) {
  const codes = gaz.keys[norm(name)] || gaz.keys[norm(name).replace(/^(provinsi|prov) /, "")] || [];
  const r = codes.map(c => gaz.rows[c]).find(x => x && x.lv === 1);
  return r ? r.k : null;
}

// ---------------------------------------------------------------- router aturan
export const TOOLS = {
  gempa: "gempa (BMKG & USGS, 7 hari terakhir)", titik_panas: "titik panas/kebakaran (NASA FIRMS)",
  kualitas_udara: "kualitas udara 38 ibu kota provinsi (Open-Meteo)", harga_pangan: "harga pangan per provinsi (PIHPS BI)",
  berita: "berita bencana/cuaca/udara/pangan (8 portal nasional)", kesehatan_pipeline: "status sumber data platform",
  cuaca: "prakiraan cuaca BMKG (lokasi pantau)", internet_outage: "gangguan internet Indonesia (Cloudflare Radar)",
  internet_operator: "kecepatan, trafik, dan BGP operator seluler (Cloudflare Radar)",
  sebaran_sel: "sel/BTS seluler per wilayah (OpenCelliD) dan menara telekomunikasi (OpenStreetMap)",
};
const RULE_TOOLS = [
  ["titik_panas", ["titik panas", "hotspot", "karhutla", "kebakaran hutan", "kebakaran lahan", "titik api", "firms"]],
  ["gempa", ["gempa", "tsunami", "magnitudo", "lindu"]],
  ["kualitas_udara", ["kualitas udara", "udara", "aqi", "polusi", "pm2", "pm 2", "kabut asap", "ispa"]],
  ["harga_pangan", ["harga", "beras", "cabai", "cabe", "bawang", "telur", "daging", "minyak goreng", "gula", "pangan"]],
  ["berita", ["berita", "kabar", "liputan", "diberitakan"]],
  ["kesehatan_pipeline", ["pipeline", "kualitas data", "data quality", "status data", "sumber data", "freshness"]],
  ["cuaca", ["cuaca", "prakiraan", "hujan", "suhu", "berawan", "gerimis", "kelembapan"]],
  ["internet_outage", ["gangguan internet", "internet mati", "internet down", "internet putus", "internet lumpuh", "outage",
                       "pemadaman internet", "blackout", "anomali trafik", "internet error"]],
  ["internet_operator", ["operator", "sinyal", "kecepatan internet", "internet", "telkomsel", "indosat", "im3", /\bxl\b/, /\btri\b/,
                         "indihome", "telkom", "smartfren", "trafik", "traffic", "latensi", /\bping\b/, /\bbgp\b/, "rpki", "mbps"]],
  ["sebaran_sel", ["bts", "menara", "sel seluler", "jumlah sel", "sebaran sel", "opencellid", "cakupan sinyal", "coverage",
                   /\b[2345]g\b/, "sinyal"]],
];
const NET_GENERIC = ["internet", "kecepatan", "trafik", "traffic", "latensi", /\bping\b/, /\bbgp\b/, "rpki", "mbps", "speed"];
const RULE_TOPICS = [["kebakaran", ["karhutla", "kebakaran", "titik panas"]], ["banjir_longsor", ["banjir", "longsor"]],
  ["gempa", ["gempa", "tsunami"]], ["gunung_api", ["erupsi", "gunung", "vulkanik"]], ["cuaca", ["cuaca", "hujan", "kekeringan", "angin"]],
  ["kualitas_udara", ["udara", "asap", "polusi"]], ["pangan", ["harga", "pangan", "beras", "cabai"]]];
export const COMMODITIES = [["rawit", 8, "Cabai Rawit"], ["cabai merah", 7, "Cabai Merah"], ["cabai", 7, "Cabai Merah"], ["cabe", 7, "Cabai Merah"],
  ["bawang putih", 6, "Bawang Putih"], ["bawang merah", 5, "Bawang Merah"], ["bawang", 5, "Bawang Merah"], ["daging sapi", 3, "Daging Sapi"],
  ["sapi", 3, "Daging Sapi"], ["daging ayam", 2, "Daging Ayam"], ["ayam", 2, "Daging Ayam"], ["telur", 4, "Telur Ayam"],
  ["minyak", 9, "Minyak Goreng"], ["gula", 10, "Gula Pasir"], ["beras", 1, "Beras"]];
const OPERATORS = [[/\btelkomsel\b|\bsimpati\b|\bby\.u\b/, "23693", "Telkomsel", "Telkomsel"], [/\bindosat\b|\bim3\b|\booredoo\b/, "4761", "Indosat", "Indosat"],
  [/\bxl\b|\baxis\b/, "24203", "XL Axiata", "XL Axiata"], [/\btri\b|\bthree\b|\bkartu 3\b/, "45727", "Tri (IOH)", "Tri (IOH)"],
  [/\bindihome\b|\btelkom indonesia\b|\btelkom\b/, "7713", "Telkom Indonesia", null], [/\bsmartfren\b/, null, "Smartfren", "Smartfren"]];
const operatorsIn = q => OPERATORS.filter(o => o[0].test(q));
const kwHit = (ql, kws) => kws.some(k => (k instanceof RegExp ? k.test(ql) : ql.includes(k)));
const FOLLOWUP = /^\s*(kalau|kalo|klo|bagaimana dengan|gimana dengan|terus|lalu|trus|dan|yang)\b/i;
export const isFollowup = q => FOLLOWUP.test(q) && q.trim().split(/\s+/).length <= 6;

export function ruleRoute(question) {
  const ql = question.toLowerCase();
  let tools = RULE_TOOLS.filter(([, kws]) => kwHit(ql, kws)).map(([t]) => t);
  if (tools.includes("internet_outage") && tools.includes("internet_operator") && !operatorsIn(ql).length) tools = tools.filter(t => t !== "internet_operator");
  if (tools.includes("sebaran_sel") && tools.includes("internet_operator") && !kwHit(ql, NET_GENERIC)) tools = tools.filter(t => t !== "internet_operator");
  if (tools.includes("cuaca") && !tools.includes("berita") && /banjir|longsor/.test(ql)) tools.push("berita");
  if (tools.includes("berita") && tools.length > 1)
    tools = ["berita", ...tools.filter(t => !["berita", "titik_panas", "harga_pangan"].includes(t)).slice(0, 1)];
  const m = ql.match(/(\d+)\s*(hari|jam|minggu)/);
  let hari = null;
  if (m) hari = m[2] === "jam" ? Math.max(1, Math.floor(+m[1] / 24)) : m[2] === "minggu" ? +m[1] * 7 : +m[1];
  else if (/hari ini|sekarang|terkini|24 jam/.test(ql)) hari = 1;
  else if (/\b(seminggu|minggu ini|sepekan|pekan ini)\b/.test(ql)) hari = 7;
  else if (/\b(sebulan|bulan ini)\b/.test(ql)) hari = 30;
  const mag = ql.match(/\b(?:m|mag|magnitudo)\s*(?:>=?|di atas|lebih dari)?\s*(\d+(?:[.,]\d)?)\b/);
  const topik = (RULE_TOPICS.find(([, kws]) => kws.some(k => ql.includes(k))) || [""])[0];
  if (!tools.length && topik) tools = ["berita"];
  return { alat: tools.slice(0, 3), hari, min_magnitudo: mag && tools.includes("gempa") ? +mag[1].replace(",", ".") : 0,
           komoditas: (COMMODITIES.find(([k]) => ql.includes(k)) || [""])[0], topik };
}

// ---------------------------------------------------------------- alat
const CAUSE_ID = { POWER_OUTAGE: "pemadaman listrik", CABLE_CUT: "kabel putus", WEATHER: "cuaca", GOVERNMENT_DIRECTED: "perintah pemerintah",
  TECHNICAL_PROBLEM: "masalah teknis", MAINTENANCE: "pemeliharaan", EARTHQUAKE: "gempa", FIRE: "kebakaran", CYBERATTACK: "serangan siber",
  MILITARY_ACTION: "aksi militer", UNKNOWN: "tidak diketahui" };

async function toolGempa(a, ctx) {
  const hari = clamp(a.hari, 1, 7, 3), mag = Math.max(0, +a.min_magnitudo || 0);
  const [fc, idx] = await Promise.all([ctx.snap("earthquakes.json"), ctx.snap("ask_index.json").catch(() => ({ quakes: {} }))]);
  const since = ctx.now - hari * 86400e3;
  let rows = fc.features.filter(x => toDate(x.properties.time) >= since && x.properties.magnitude >= mag);
  const place = a.place;
  let note = "BMKG dan USGS bisa mencatat gempa yang sama; keduanya ditampilkan. Snapshot hanya memuat 7 hari terakhir.";
  if (place) {
    rows = rows.filter(x => {
      const q = idx.quakes[x.properties.id] || {}, [lon, lat] = x.geometry.coordinates;
      return place.level === 1 ? (q.near_prov || []).includes(place.prov_kode)
        : q.kab === place.kode || haversine(place.lat, place.lng, lat, lon) <= place.radius_km + 50;
    });
    note += ` Filter lokasi: episentrum di dalam atau ±50 km dari ${place.nama}.`;
  }
  rows.sort((x, y) => y.properties.magnitude - x.properties.magnitude || toDate(y.properties.time) - toDate(x.properties.time));
  const items = rows.slice(0, 10).map(x => ({ waktu: wib(x.properties.time), magnitudo: x.properties.magnitude, kedalaman_km: Math.round(x.properties.depth_km),
                                              wilayah: x.properties.region, sumber: String(x.properties.source).toUpperCase() }));
  const where = place ? ` di sekitar ${place.nama}` : " di wilayah Indonesia dan sekitarnya";
  const fakta = [`Tercatat ${rows.length} gempa${mag ? ` bermagnitudo ${mag} ke atas` : ""}${where} dalam ${hariTxt(hari)} (sumber BMKG dan USGS).`];
  if (items.length) { const g = items[0]; fakta.push(`Gempa terbesar M${g.magnitudo} di ${g.wilayah} pada ${g.waktu}, kedalaman ${g.kedalaman_km} km (${g.sumber}).`); }
  return { alat: "gempa", fakta, rentang_hari: hari, jumlah: rows.length, gempa: items, catatan: note };
}

async function toolTitikPanas(a, ctx) {
  const idx = await ctx.snap("ask_index.json");
  const days = Object.keys(idx.hotspots || {}).filter(d => d !== "?").sort();
  const hari = clamp(a.hari, 1, 10, 1);
  const cut = new Date(ctx.now - hari * 86400e3).toISOString().slice(0, 10);
  const use = days.filter(d => d >= cut);
  const per = {}, prov = {};
  let outside = 0, frp = 0;
  for (const d of use) {
    const v = idx.hotspots[d];
    outside += v.outside;
    for (const [k, [n, fr]] of Object.entries(v.kab)) {
      if (a.place && !inPlace(a.place, k)) continue;
      per[k] = (per[k] || 0) + n; frp = Math.max(frp, fr);
      const pk = k.split(".")[0]; prov[pk] = (prov[pk] || 0) + n;
    }
  }
  const total = Object.values(per).reduce((s, v) => s + v, 0);
  const gaz = await ctx.snap("ask_gazetteer.json");
  const nm = k => (gaz.rows[k] || {}).n || k;
  const where = a.place ? `di dalam batas ${a.place.nama}` : "di wilayah Indonesia";
  const range = use.length ? ` (data ${use[0]}${use.length > 1 ? " s.d. " + use[use.length - 1] : ""}, UTC)` : "";
  const fakta = [`Terdapat ${n0(total)} titik panas ${where} dalam ${hariTxt(hari)} (NASA FIRMS VIIRS, confidence nominal dan high)${range}.`];
  const topProv = Object.entries(prov).sort((x, y) => y[1] - x[1]).slice(0, 5);
  const topKab = Object.entries(per).sort((x, y) => y[1] - x[1]).slice(0, 5);
  if (!a.place && topProv.length) fakta.push("Provinsi dengan titik panas terbanyak: " + topProv.map(([k, v]) => `${nm(k)} (${n0(v)})`).join(", ") + ".");
  if (a.place && a.place.level === 1 && topKab.length) fakta.push("Kab/kota terbanyak: " + topKab.slice(0, 3).map(([k, v]) => `${nm(k)} (${n0(v)})`).join(", ") + ".");
  if (total) fakta.push(`Kekuatan api (FRP) tertinggi ${f(frp)} MW.`);
  if (!a.place && outside) fakta.push(`${n0(outside)} titik lain berada di luar batas Indonesia (negara tetangga/perairan) dan tidak dihitung.`);
  if (!use.length) fakta.push("Snapshot belum memuat data titik panas untuk rentang ini.");
  return { alat: "titik_panas", fakta, rentang_hari: hari, jumlah: total, per_kabkota: topKab.map(([k, v]) => ({ wilayah: nm(k), titik: v })),
           catatan: idx.note || "" };
}

async function toolUdara(a, ctx) {
  const rows = (await ctx.snap("air_quality.json")).filter(r => r.us_aqi >= 0);
  const cat = v => (v <= 50 ? "Baik" : v <= 100 ? "Sedang" : v <= 150 ? "Tidak sehat bagi kelompok sensitif" : v <= 200 ? "Tidak sehat" : v <= 300 ? "Sangat tidak sehat" : "Berbahaya");
  let pick, note;
  if (a.place) {
    pick = [...rows].sort((x, y) => haversine(a.place.lat, a.place.lng, x.lat, x.lon) - haversine(a.place.lat, a.place.lng, y.lat, y.lon)).slice(0, 1);
    note = `Data dari kota pemantauan terdekat dengan ${a.place.nama} (platform memantau 38 ibu kota provinsi).`;
  } else {
    const s = [...rows].sort((x, y) => y.us_aqi - x.us_aqi);
    pick = [...s.slice(0, 5), ...s.slice(-2)]; note = "5 kota dengan AQI tertinggi dan 2 terendah dari 38 ibu kota provinsi.";
  }
  const kota = pick.map(r => ({ kota: r.city, provinsi: r.province, us_aqi: Math.round(r.us_aqi), kategori: cat(r.us_aqi), pm2_5: +(+r.pm2_5).toFixed(1), waktu: wib(r.obs_time) }));
  const fakta = kota.slice(0, 3).map(x => `${x.kota} (${x.provinsi}): US AQI ${x.us_aqi}, kategori ${x.kategori}, PM2.5 ${f(x.pm2_5)} µg/m³ (data ${x.waktu}, Open-Meteo).`);
  return { alat: "kualitas_udara", fakta, kota, catatan: note };
}

async function toolPangan(a, ctx) {
  const kom = (a.komoditas || "").toLowerCase();
  const [, cid, cname] = COMMODITIES.find(([k]) => kom.includes(k)) || ["", 1, "Beras"];
  const items = (await ctx.snap("food_prices.json")).items.filter(i => i.commodity_id === cid);
  if (!items.length) return { alat: "harga_pangan", fakta: [`Belum ada data harga ${cname} di snapshot.`], komoditas: cname };
  const latest = items.reduce((m, i) => (i.price_date > m ? i.price_date : m), "");
  const rows = items.filter(i => i.price_date === latest).sort((x, y) => y.price - x.price);
  const unit = cid === 9 ? "liter" : "kg", nat = rows[0].national_avg;
  const rel = r => { const d = nat ? (r.price - nat) / nat * 100 : 0; return Math.abs(d) < 0.05 ? "sama dengan rata-rata nasional" : `${f(Math.abs(d))}% lebih ${d > 0 ? "tinggi" : "rendah"} dari rata-rata nasional`; };
  const trend = r => (!r.pct_change ? `tidak berubah dibanding data ${r.prev_date}` : `${r.pct_change > 0 ? "naik" : "turun"} ${f(Math.abs(r.pct_change))}% dibanding data ${r.prev_date}`);
  const fakta = [`Harga ${cname} (pasar tradisional, PIHPS BI) tanggal ${latest}: rata-rata nasional ${rp(nat)}/${unit}.`];
  const q = a._q || "", hi = /mahal|tinggi|tertinggi/.test(q), lo = /murah|rendah|terendah/.test(q);
  if (a.place) {
    const gaz = await ctx.snap("ask_gazetteer.json");
    const match = rows.filter(r => provCodeOf(r.province, gaz) === a.place.prov_kode);
    if (match.length) match.forEach(r => fakta.push(`${r.province}: ${rp(r.price)}/${unit}, ${rel(r)}; ${trend(r)}.`));
    else fakta.push(`Provinsi ${a.place.prov_nama} tidak ada di data PIHPS untuk tanggal ini.`);
    if (a.place.level === 2) fakta.push(`Harga PIHPS tersedia per provinsi; untuk ${a.place.nama} dipakai harga provinsi ${a.place.prov_nama}.`);
  } else {
    if (hi || !lo) { fakta.push(`Provinsi dengan harga ${cname} PALING MAHAL: ${rows[0].province} ${rp(rows[0].price)}/${unit} (${rel(rows[0])}).`);
                     fakta.push("Urutan termahal: " + rows.slice(0, 3).map(r => `${r.province} ${rp(r.price)}`).join(", ") + "."); }
    if (lo || !hi) { const l = rows.slice(-3).reverse();
                     fakta.push(`Provinsi dengan harga ${cname} PALING MURAH: ${l[0].province} ${rp(l[0].price)}/${unit} (${rel(l[0])}).`);
                     fakta.push("Urutan termurah: " + l.map(r => `${r.province} ${rp(r.price)}`).join(", ") + "."); }
  }
  return { alat: "harga_pangan", fakta, komoditas: cname, tanggal: latest, sumber: "PIHPS Nasional, Bank Indonesia" };
}

async function toolBerita(a, ctx) {
  const news = await ctx.snap("news.json");
  const hari = clamp(a.hari, 1, 3, 3), since = ctx.now - hari * 86400e3;
  const names = a.place ? [norm(a.place.nama).replace(/^(kota|kabupaten|provinsi) /, ""), a.place.matched, norm(a.place.prov_nama)] : [];
  const rows = news.filter(n => toDate(n.published_at) >= since && (!a.topik || (n.topics || []).includes(a.topik))
    && (!a.place || names.some(x => x && ` ${norm(n.title + " " + (n.summary || ""))} `.includes(` ${x} `)))).slice(0, 8);
  const items = rows.map(n => ({ judul: n.title, link: n.link, media: n.publisher, waktu: wib(n.published_at) }));
  const fakta = [`Ditemukan ${items.length} berita${a.topik ? " topik " + a.topik.replace("_", " ") : ""}${a.place ? " yang menyebut " + a.place.nama : ""} dalam ${hariTxt(hari)}.`,
                 ...items.slice(0, 3).map(b => `${b.media}: "${b.judul}"`)];
  return { alat: "berita", fakta, berita: items, catatan: "Berita dari 8 portal nasional (RSS), 3 hari terakhir; lokasi dicocokkan dari nama wilayah di judul/ringkasan." };
}

async function toolKesehatan(a, ctx) {
  const m = await ctx.snap("meta.json");
  const src = Object.values(m.sources || {}), bad = src.filter(s => s.status !== "ok");
  const fakta = [`Snapshot ${wib(m.generated_at)}: ${src.length - bad.length} dari ${src.length} sumber/langkah berstatus OK.`,
                 ...bad.slice(0, 5).map(s => `${s.label}: gagal${s.note ? ` (${String(s.note).slice(0, 120)})` : ""}.`)];
  return { alat: "kesehatan_pipeline", fakta, catatan: "Versi publik memeriksa status snapshot per jam; cek kualitas data lengkap (ClickHouse) ada di versi lokal." };
}

async function toolCuaca(a, ctx) {
  const doc = await ctx.snap("web_weather.json");
  const locs = {};
  for (const r of doc.rows || []) if (r.adm4 && r.forecast_utc) (locs[r.adm4] ||= { desa: r.desa, kab: r.kotkab, rows: [] }).rows.push(r);
  const names = Object.values(locs).map(v => `${v.desa}, ${v.kab}`);
  let keys = Object.keys(locs);
  if (a.place) {
    keys = keys.filter(k => inPlace(a.place, a.place.level === 2 ? k.split(".").slice(0, 2).join(".") : k.split(".")[0]));
    if (!keys.length) return { alat: "cuaca", fakta: [`Prakiraan cuaca BMKG di platform ini baru mencakup ${names.length} lokasi (${names.join("; ")}); ${a.place.nama} belum termasuk.`],
                               catatan: "Cakupan lokasi cuaca masih terbatas." };
  }
  const q = a._q || "", fakta = [], detail = [];
  for (const k of keys.slice(0, 3)) {
    const v = locs[k], rs = v.rows.sort((x, y) => (x.forecast_utc < y.forecast_utc ? -1 : 1)), r0 = rs[0];
    const off = r0.local_datetime ? toDate(r0.local_datetime) - toDate(r0.forecast_utc) : 7 * 3600e3;
    const zone = { 7: "WIB", 8: "WITA", 9: "WIT" }[Math.round(off / 3600e3)] || "waktu setempat";
    const local = d => new Date(toDate(d).getTime() + off);
    const ymd = d => d.toISOString().slice(0, 10), hm = d => `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    const nowLocal = new Date(ctx.now + off);
    let day = null, label = "24 jam ke depan";
    if (/lusa/.test(q)) { day = ymd(new Date(nowLocal.getTime() + 2 * 86400e3)); label = "lusa"; }
    else if (/besok/.test(q)) { day = ymd(new Date(nowLocal.getTime() + 86400e3)); label = "besok"; }
    const pick = day ? rs.filter(r => ymd(local(r.forecast_utc)) === day)
      : rs.filter(r => { const t = toDate(r.forecast_utc).getTime(); return t >= ctx.now - 1.5 * 3600e3 && t <= ctx.now + 24 * 3600e3; });
    const where = `${v.desa} (${v.kab})`;
    if (!pick.length) { fakta.push(`${where}: prakiraan untuk ${label} belum ada di snapshot terakhir.`); continue; }
    const ts = pick.map(r => +r.t).filter(Number.isFinite), rain = pick.filter(r => /hujan/i.test(r.weather_desc || ""));
    const tp = Math.max(0, ...pick.map(r => +r.tp || 0));
    fakta.push(`${where}, ${label}: suhu ${n0(Math.min(...ts))}–${n0(Math.max(...ts))}°C; ` + (rain.length
      ? `hujan diprakirakan pada ${rain.length} dari ${pick.length} slot 3-jam (mulai ${hm(local(rain[0].forecast_utc))} ${zone}, '${rain[0].weather_desc}'), curah hujan tertinggi ${f(tp)} mm per 3 jam.`
      : `tidak ada prakiraan hujan (${pick.length} slot 3-jam).`));
    detail.push({ lokasi: where, periode: label, slot: pick.slice(0, 8).map(r => ({ waktu: hm(local(r.forecast_utc)) + " " + zone, cuaca: r.weather_desc, suhu_c: r.t })) });
  }
  return { alat: "cuaca", fakta, prakiraan: detail, catatan: `Prakiraan BMKG untuk ${names.length} lokasi pantau, diperbarui 2x sehari.` };
}

function provNameId(n) {
  n = String(n || "");
  const fixed = { Jakarta: "DKI Jakarta", "Special Region of Yogyakarta": "DI Yogyakarta", Yogyakarta: "DI Yogyakarta", "Riau Islands": "Kepulauan Riau",
                  "Bangka-Belitung Islands": "Kepulauan Bangka Belitung", "Bangka–Belitung Islands": "Kepulauan Bangka Belitung", "Bangka Belitung Islands": "Kepulauan Bangka Belitung" };
  if (fixed[n]) return fixed[n];
  let x = n.replace(/\bJava\b/g, "Jawa").replace(/\bSumatra\b/g, "Sumatera").replace(/ Province$/, "");
  for (const [en, id] of [["Southeast", "Tenggara"], ["Southwest", "Barat Daya"], ["Northeast", "Timur Laut"], ["North", "Utara"], ["South", "Selatan"],
                          ["East", "Timur"], ["West", "Barat"], ["Central", "Tengah"], ["Highland", "Pegunungan"]])
    if (x.startsWith(en + " ")) { x = x.slice(en.length + 1) + " " + id; break; }
  return x;
}
const label = (d, asn) => ((d.asns || {})[String(asn)] || {}).label || `AS${asn}`;
function seriesDrops(s, since) {
  if (!s || !s.t) return null;
  const t = s.t.map(toDate), v = (s.v || []).map(x => (x == null ? null : +x)), gap = new Set();
  let run = [];
  const flush = () => { if (run.length >= 6) run.forEach(i => gap.add(i)); run = []; };
  v.forEach((x, i) => (x == null || x <= 0.02 ? run.push(i) : flush())); flush();
  const how = {};
  t.forEach((d, i) => (how[d.getUTCDay() * 24 + d.getUTCHours()] ||= []).push(i));
  const drops = [];
  t.forEach((d, i) => {
    if (d < since || v[i] == null || gap.has(i)) return;
    const o = how[d.getUTCDay() * 24 + d.getUTCHours()].filter(j => j !== i && v[j] != null && !gap.has(j)).map(j => v[j]).sort((x, y) => x - y);
    if (o.length < 2) return;
    const med = o[Math.floor(o.length / 2)];
    if (med > 0.1 && v[i] < 0.6 * med) drops.push([d, v[i] / med]);
  });
  return { n: drops.length, gaps: [...gap].filter(i => t[i] >= since).length, low: drops.sort((x, y) => x[1] - y[1])[0] || null };
}

async function toolOutage(a, ctx) {
  const d = await ctx.snap("radar_id.json");
  const hari = a.hari ? clamp(a.hari, 1, 365, 3) : 365, since = ctx.now - hari * 86400e3;
  const win = hari === 365 ? "12 bulan terakhir" : hariTxt(hari);
  const ops = operatorsIn(a._q || "").filter(o => o[1]), asns = new Set(ops.map(o => o[1]));
  let outs = (d.outages || []).filter(o => o.startDate && toDate(o.startDate) >= since && (!ops.length || (o.asns || []).some(x => asns.has(String(x)))));
  if (a.place) {
    const names = new Set([norm(a.place.prov_nama), ...(d.geo || []).filter(g => provNameId(g.name) === a.place.prov_nama).map(g => norm(g.name))].filter(Boolean));
    outs = outs.filter(o => [...names].some(nm => norm(`${o.scope || ""} ${o.description || ""} ${(o.locations || []).join(" ")}`).includes(nm)));
  }
  outs.sort((x, y) => toDate(y.startDate) - toDate(x.startDate));
  const anom = (d.anomalies || []).filter(x => x.startDate && toDate(x.startDate) >= since && (!ops.length || asns.has(String(x.asn))))
    .sort((x, y) => toDate(y.startDate) - toDate(x.startDate));
  const who = ops.length ? ops.map(o => o[2]).join(" / ") : "Indonesia";
  const fakta = [`Cloudflare Radar mencatat ${outs.length} gangguan internet (outage) terverifikasi untuk ${who}${a.place ? ` yang menyebut ${a.place.prov_nama}` : ""} dalam ${win} (snapshot ${wib(d.generated_at)}).`];
  for (const o of outs.slice(0, 3)) {
    let lama = ", belum ada waktu selesai";
    if (o.endDate) { const h = (toDate(o.endDate) - toDate(o.startDate)) / 3600e3; lama = h < 1 ? `, durasi ${n0(h * 60)} menit` : h < 48 ? `, durasi ${f(h)} jam` : `, durasi ${f(h / 24)} hari`; }
    fakta.push(`Outage ${wib(o.startDate)}: penyebab ${CAUSE_ID[o.cause] || o.cause || "tidak disebut"}${(o.asn_names || []).length ? ", operator " + o.asn_names.join(", ") : ""}${o.scope ? ", wilayah " + o.scope : ""}${lama}.`);
  }
  fakta.push(`Deteksi otomatis Radar (traffic anomaly) untuk ${who}: ${anom.length} kejadian dalam ${win}` +
    (anom.length ? `, terakhir ${wib(anom[0].startDate)} (${anom[0].asn_name || anom[0].location || ""}, status ${String(anom[0].status || "-").toLowerCase()}).` : "."));
  return { alat: "internet_outage", fakta, outage: outs.slice(0, 5).map(o => ({ mulai: wib(o.startDate), penyebab: CAUSE_ID[o.cause] || o.cause, wilayah: o.scope, keterangan: String(o.description || "").slice(0, 200) })),
           catatan: "Outage = kejadian yang diverifikasi tim Radar; anomaly = deteksi otomatis. Dilihat dari luar jaringan operator." };
}

async function toolOperator(a, ctx) {
  const d = await ctx.snap("radar_id.json");
  const q = a._q || "", hari = a.hari ? clamp(a.hari, 1, 28, 7) : 7, since = new Date(ctx.now - hari * 86400e3);
  const named = operatorsIn(q), ops = named.filter(o => o[1]).length ? named.filter(o => o[1]) : OPERATORS.filter(o => o[1] && (d.asns || {})[o[1]]);
  const local = !!a.place && !named.length, fakta = [];
  if (named.some(o => !o[1])) fakta.push("Smartfren belum termasuk operator yang dipantau dari Cloudflare Radar di platform ini.");
  if (local) fakta.push("Kecepatan dan penurunan trafik per operator hanya tersedia secara nasional, bukan per provinsi.");
  const sp = Object.fromEntries((d.speed_ops || []).map(x => [x.key, x]));
  const tab = ops.filter(o => sp[o[1]]).map(o => ({ operator: label(d, o[1]), dl: +sp[o[1]].bandwidthDownload, ul: +sp[o[1]].bandwidthUpload, lat: +sp[o[1]].latencyIdle }))
    .sort((x, y) => y.dl - x.dl);
  if (tab.length && !local) {
    if (named.length) tab.forEach(r => fakta.push(`${r.operator}: median unduh ${f(r.dl)} Mbps, unggah ${f(r.ul)} Mbps, latensi ${n0(r.lat)} ms (speed test pengguna Cloudflare, 90 hari).`));
    else fakta.push("Median kecepatan unduh per operator (speed test pengguna Cloudflare, 90 hari): " + tab.map(r => `${r.operator} ${f(r.dl)} Mbps`).join(", ") + ".");
  }
  if (sp.ID && !local) fakta.push(`Rata-rata Indonesia (semua jaringan): unduh ${f(+sp.ID.bandwidthDownload)} Mbps, latensi ${n0(+sp.ID.latencyIdle)} ms.`);
  if (!local) for (const o of ops) {
    const tr = (d.traffic || {})[o[1]] || {}, s = tr.netflows || tr.http, src = tr.netflows ? "NetFlows" : "HTTP", r = seriesDrops(s, since);
    if (!r) continue;
    if (r.n) fakta.push(`Trafik ${label(d, o[1])} (${src}) turun di bawah 60% dari normal selama ${r.n} jam dalam ${hariTxt(hari)}; terendah ${wib(r.low[0].toISOString())} (${n0(r.low[1] * 100)}% dari normal${r.low[1] < 0.05 ? "; trafik hampir nol, bisa gangguan atau data yang tidak terlihat Cloudflare" : ""}).`);
    else if (named.length) fakta.push(`Trafik ${label(d, o[1])} (${src}) tidak menunjukkan penurunan tidak normal dalam ${hariTxt(hari)}.`);
    if (r.gaps && named.length) fakta.push(`${label(d, o[1])}: ${r.gaps} jam tanpa data (celah data, tidak dihitung sebagai gangguan).`);
  }
  if (a.place) {
    const geo = Object.fromEntries((d.geo || []).map(g => [String(g.geoId), provNameId(g.name)]));
    const gaz = await ctx.snap("ask_gazetteer.json");
    const gid = Object.keys(geo).find(k => provCodeOf(geo[k], gaz) === a.place.prov_kode);
    if (!gid) fakta.push(`Data trafik per provinsi untuk ${a.place.prov_nama} tidak ada di snapshot Radar.`);
    else {
      for (const key of named.length ? ops.map(o => o[1]) : ["ID"]) {
        const share = (((d.adm1 || {})[key] || {}).summary_0) || {};
        const vals = Object.fromEntries(Object.entries(share).filter(([k, v]) => geo[k] && v != null).map(([k, v]) => [k, +v]));
        if (vals[gid] == null) continue;
        const rank = Object.values(vals).sort((x, y) => y - x).indexOf(vals[gid]) + 1;
        fakta.push(`${a.place.prov_nama} menyumbang ${f(vals[gid], 2)}% dari ${key === "ID" ? "trafik internet Indonesia" : "trafik " + label(d, key)} yang terlihat Cloudflare (NetFlows 7 hari), peringkat ${rank} dari ${Object.keys(vals).length} provinsi.`);
      }
      const ts = (d.adm1_ts || {}).netflows || (d.adm1_ts || {}).http;
      const ser = (((ts || {}).s || {})[gid] || []).filter(x => x != null).map(Number);
      if (ser.length >= 8) {
        const prev = ser.slice(0, -1).sort((x, y) => x - y), med = prev[Math.floor(prev.length / 2)], chg = med ? (ser[ser.length - 1] - med) / med * 100 : 0;
        fakta.push(`Porsi harian ${a.place.prov_nama} hari terakhir ${f(ser[ser.length - 1], 2)}% vs median ${prev.length} hari sebelumnya ${f(med, 2)}% (${chg >= 0 ? "+" : ""}${f(chg)}%).`);
      }
    }
  }
  if (named.length || /\bbgp\b|rpki|routing|hijack/.test(q))
    for (const o of ops) { const b = (d.bgp || {})[o[1]]; if (b && b.routes_total) fakta.push(`BGP ${label(d, o[1])}: ${b.routes_total} route, ${f((b.routes_valid || 0) / b.routes_total * 100)}% valid RPKI, ${b.routes_invalid || 0} invalid.`); }
  return { alat: "internet_operator", fakta, kecepatan: local ? [] : tab, snapshot: wib(d.generated_at),
           catatan: "Dilihat dari luar jaringan operator: trafik yang melewati Cloudflare dan speed test sukarela pengguna; bukan KPI internal operator." };
}

async function toolSel(a, ctx) {
  const [c, t] = await Promise.all([ctx.snap("cells_id.json"), ctx.snap("osm_towers_id.json").catch(() => null)]);
  const kab = c.kab || [], q = a._q || "", namedAll = operatorsIn(q), named = namedAll.filter(o => o[3]);
  const op = named.length ? named[0][3] : null, val = k => (op ? k.op[op] || 0 : k.total), who = op ? ` ${op}` : "", fakta = [];
  if (namedAll.some(o => !o[3])) fakta.push("Telkom Indonesia/IndiHome adalah jaringan tetap, tidak ada di data sel seluler OpenCelliD.");
  const mix = ks => {
    const tot = ks.reduce((s, k) => s + k.total, 0); if (!tot) return null;
    const per = {}; let r4 = 0, rec = 0;
    ks.forEach(k => { Object.entries(k.op).forEach(([o, n]) => (per[o] = (per[o] || 0) + n)); r4 += (k.radio["4G"] || 0) + (k.radio["5G"] || 0); rec += k.recent; });
    return `Per operator: ${Object.entries(per).filter(([o]) => o !== "Lainnya").sort((x, y) => y[1] - x[1]).map(([o, n]) => `${o} ${n0(n)}`).join(", ")}. Porsi 4G/5G ${n0(r4 / tot * 100)}%; ${n0(rec / tot * 100)}% sel diperbarui dalam 12 bulan terakhir.`;
  };
  const p = a.place;
  if (p && p.level === 2) {
    const k = kab.find(x => x.k === p.kode);
    if (!k) fakta.push(`${p.nama} tidak ada di data sebaran sel.`);
    else {
      const rank = kab.map(val).sort((x, y) => y - x).indexOf(val(k)) + 1;
      fakta.push(`${k.nama} (${k.prov}): ${n0(val(k))} sel${who} tercatat di OpenCelliD, peringkat ${rank} dari ${kab.length} kab/kota` + (k.pend ? `; ${f(val(k) / k.pend * 1e5)} sel per 100 ribu penduduk.` : "."));
      if (!op && k.total) fakta.push(mix([k]));
      if (k.approx) fakta.push(`Batas wilayah ${k.nama} di data sumber tidak akurat, jadi dipakai batas perkiraan (lingkaran seluas wilayah resmi).`);
    }
  } else if (p) {
    const ks = kab.filter(k => k.prov_k === p.prov_kode), prov = {};
    kab.forEach(k => (prov[k.prov_k] = (prov[k.prov_k] || 0) + val(k)));
    const n = prov[p.prov_kode] || 0, rank = Object.values(prov).sort((x, y) => y - x).indexOf(n) + 1, pend = ks.reduce((s, k) => s + (k.pend || 0), 0);
    fakta.push(`Provinsi ${p.prov_nama}: ${n0(n)} sel${who} tercatat di OpenCelliD di ${ks.length} kab/kota, peringkat ${rank} dari ${Object.keys(prov).length} provinsi` + (pend ? `; ${f(n / pend * 1e5)} sel per 100 ribu penduduk.` : "."));
    const top = [...ks].sort((x, y) => val(y) - val(x));
    if (top.length && val(top[0])) fakta.push("Kab/kota dengan sel terbanyak: " + top.slice(0, 3).map(k => `${k.nama} (${n0(val(k))})`).join(", ") + ".");
    const empty = ks.filter(k => !val(k)).length;
    if (empty) fakta.push(`${empty} kab/kota di provinsi ini belum punya data sel${who} sama sekali.`);
    if (!op && n) fakta.push(mix(ks));
  } else {
    fakta.push(`OpenCelliD mencatat ${n0(op ? c.by_op[op] || 0 : c.cells_indonesia)} sel seluler${who} di Indonesia (data ${String(c.generated_at).slice(0, 10)}).`);
    if (!op) { fakta.push("Per operator: " + Object.entries(c.by_op).filter(([o]) => o !== "Lainnya").sort((x, y) => y[1] - x[1]).map(([o, n]) => `${o} ${n0(n)}`).join(", ") + ".");
               fakta.push("Per teknologi: " + Object.entries(c.by_radio).sort((x, y) => y[1] - x[1]).map(([r, n]) => `${r} ${n0(n)}`).join(", ") + "."); }
    fakta.push("Kab/kota dengan sel terbanyak: " + [...kab].sort((x, y) => val(y) - val(x)).slice(0, 5).map(k => `${k.nama} (${n0(val(k))})`).join(", ") + ".");
    fakta.push(`${kab.filter(k => !val(k)).length} dari ${kab.length} kab/kota belum punya data sel${who}.`);
  }
  if (t) {
    const by = Object.fromEntries((t.kab || []).map(k => [k.k, k])), pick = k => (op ? (k.op || {})[op] || 0 : k.total || 0);
    const n = !p ? (op ? (t.by_op || {})[op] || 0 : t.total) : p.level === 2 ? pick(by[p.kode] || {}) : Object.entries(by).filter(([k]) => k.split(".")[0] === p.prov_kode).reduce((s, [, k]) => s + pick(k), 0);
    const where = !p ? "Indonesia" : p.level === 2 ? p.nama : `Provinsi ${p.prov_nama}`;
    fakta.push(`OpenStreetMap mencatat ${n0(n)} menara telekomunikasi${op ? ` milik/operator ${op}` : ""} di ${where} (data ${String(t.data_timestamp || "").slice(0, 10)})${op ? " (sebagian besar menara di OSM tidak mencantumkan pemiliknya)" : ""}.`);
  }
  return { alat: "sebaran_sel", fakta: fakta.filter(Boolean), sumber: "OpenCelliD (CC BY-SA 4.0), OpenStreetMap (ODbL)",
           catatan: "OpenCelliD dan OSM adalah data crowdsourced, bukan jumlah BTS resmi operator; banyak daerah tercatat lebih sedikit dari kenyataan." };
}

export const TOOL_FUNCS = { gempa: toolGempa, titik_panas: toolTitikPanas, kualitas_udara: toolUdara, harga_pangan: toolPangan, berita: toolBerita,
  kesehatan_pipeline: toolKesehatan, cuaca: toolCuaca, internet_outage: toolOutage, internet_operator: toolOperator, sebaran_sel: toolSel };

// ---------------------------------------------------------------- LLM (Gemini)
const ROUTER_PROMPT = `Kamu memilih alat data untuk menjawab pertanyaan tentang Indonesia. Alat:
${Object.entries(TOOLS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}
Pilih 1-3 alat yang relevan, atau [] jika pertanyaan sama sekali tidak terkait data di atas. Balas hanya JSON.`;
const ANSWER_PROMPT = `Kamu asisten data untuk platform Indonesia Realtime Monitor. Jawab dalam bahasa pertanyaan (Indonesia atau Inggris)
HANYA berdasarkan DATA di bawah. Setiap alat punya daftar "fakta" yang PASTI benar: jadikan dasar jawaban, boleh diparafrasekan,
tetapi angka, nama tempat, tanggal, dan artinya tidak boleh diubah. Jangan menambah fakta atau angka lain. Sebut sumber datanya.
Jika ada "catatan", sampaikan keterbatasannya singkat. Jangan sebut nama alat atau field. Maksimal 6 kalimat atau daftar pendek.`;

async function gemini(env, fetchImpl, system, user, schema) {
  const model = env.MODEL || "gemini-2.5-flash";
  const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 0 },
                          ...(schema ? { responseMimeType: "application/json", responseSchema: schema } : {}) } }),
  });
  if (!r.ok) throw new Error(`gemini ${r.status}`);
  const d = await r.json();
  return (d.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
}

const OUT_OF_SCOPE = "Maaf, pertanyaan itu di luar cakupan data platform ini. Saya bisa menjawab tentang gempa, titik panas, kualitas udara, harga pangan, "
  + "prakiraan cuaca, gangguan dan kecepatan internet per operator, sebaran sel/BTS seluler, berita bencana/cuaca/pangan, dan status sumber data.";

export async function askData(question, context, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const t0 = Date.now();
  const ctx = { now, snap: name => snap(name, env, fetchImpl) };
  const gaz = await ctx.snap("ask_gazetteer.json");
  let rules = ruleRoute(question), followup = false, llmTools = [];
  const place0 = resolvePlace(question, gaz);
  if (context && !rules.alat.length && isFollowup(question)) {
    const prev = ruleRoute(context);
    if (prev.alat.length) { followup = true; rules = { ...prev, hari: rules.hari ?? prev.hari, komoditas: rules.komoditas || prev.komoditas }; }
  }
  if (!rules.alat.length && env.GEMINI_API_KEY) {
    try {
      const out = JSON.parse(await gemini(env, fetchImpl, ROUTER_PROMPT, question,
        { type: "OBJECT", properties: { alat: { type: "ARRAY", items: { type: "STRING", enum: Object.keys(TOOLS) } } }, required: ["alat"] }));
      llmTools = (out.alat || []).filter(t => TOOL_FUNCS[t]).slice(0, 3);
    } catch { /* router aturan saja */ }
  }
  const tools = [...new Set([...rules.alat, ...llmTools])].slice(0, 3);
  const place = place0 || (followup ? resolvePlace(context, gaz) : null);
  const params = { hari: rules.hari, min_magnitudo: rules.min_magnitudo, komoditas: rules.komoditas, topik: rules.topik,
                   place, _q: (followup ? `${context} ${question}` : question).toLowerCase() };
  const results = [];
  for (const t of tools) {
    try { results.push(await TOOL_FUNCS[t](params, ctx)); }
    catch (e) { results.push({ alat: t, fakta: [], error: "data belum tersedia" }); }
  }
  const facts = results.flatMap(r => r.fakta || []);
  const focus = place ? { lat: place.lat, lng: place.lng, zoom: place.level === 1 ? 7 : 9, nama: place.nama } : null;
  const toolsOut = tools.map(t => ({ nama: t, parameter: Object.fromEntries(Object.entries({ lokasi: place?.nama, hari: params.hari, komoditas: params.komoditas,
                                                                                        min_magnitudo: params.min_magnitudo || null }).filter(([, v]) => v)) }));
  const base = { tools: toolsOut, facts, data: results, focus, router: { aturan: rules.alat, llm: llmTools, lanjutan: followup },
                 sources: results.flatMap(r => (r.berita || []).map(b => ({ judul: b.judul, link: b.link }))).slice(0, 8) };
  if (!results.length) return { ...base, answer: OUT_OF_SCOPE, model: "aturan", mode: "out_of_scope", ms: Date.now() - t0 };
  try {
    if (!env.GEMINI_API_KEY) throw new Error("no key");
    const data = JSON.stringify(results).slice(0, 6000);
    const answer = await gemini(env, fetchImpl, ANSWER_PROMPT, (followup ? `PERTANYAAN SEBELUMNYA: ${context}\n` : "") + `PERTANYAAN: ${question}\n\nDATA:\n${data}`);
    if (!answer) throw new Error("empty");
    return { ...base, answer, model: env.MODEL || "gemini-2.5-flash", mode: "llm", ms: Date.now() - t0 };
  } catch {
    return { ...base, answer: "Jawaban AI sedang tidak tersedia (kuota). Berikut fakta yang dihitung sistem:\n" + facts.map(x => "- " + x).join("\n"),
             model: "fakta (tanpa AI)", mode: "facts", ms: Date.now() - t0 };
  }
}
