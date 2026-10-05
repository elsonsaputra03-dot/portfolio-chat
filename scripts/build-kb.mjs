// Bangun basis pengetahuan dari sumber yang SUDAH dipublikasikan: halaman portofolio dan README repo publik.
// Tidak ada sumber lain: chatbot hanya bisa mengatakan apa yang sudah Elson tulis dan setujui di tempat-tempat ini.
import { writeFileSync } from "node:fs";
import { buildIndex } from "../src/retrieve.js";

const OWNER = "elsonsaputra03-dot";
const SITE = "https://elsonsaputra03-dot.github.io/indo-realtime-monitor/";
const REPOS = ["indo-realtime-monitor", "bq-governance-toolkit", "app-tagging-stream", "mysql-to-postgres"];
const MAX = 1400;

const raw = (repo, path) => `https://raw.githubusercontent.com/${OWNER}/${repo}/main/${path}`;
const decode = s => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&middot;/g, "·").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const text = h => decode(h.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function split(title, body, url, source) {
  const out = [];
  let buf = "";
  for (const para of body.split(/\n{2,}|(?<=\.)\s(?=[A-Z])/)) {
    if ((buf + " " + para).length > MAX && buf) { out.push(buf.trim()); buf = ""; }
    buf += " " + para;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.map((t, i) => ({ title: out.length > 1 ? `${title} (${i + 1})` : title, text: t, url, source }));
}

export function fromPortfolio(html) {
  html = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, "");
  const chunks = [];
  const hero = html.match(/<header[\s\S]*?<\/header>/);
  if (hero) chunks.push(...split("Portfolio overview", text(hero[0]), SITE, "portfolio"));
  for (const m of html.matchAll(/<section[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)) {
    const [, id, body] = m;
    // Elemen daftar (kartu proyek, peran kerja, kelompok keahlian, sertifikat) dipotong dari tag pembukanya sampai tag
    // pembuka berikutnya. Pola "<div ...>...</div>" tidak bisa dipakai: <div class="job"> berisi <div> lain, sehingga
    // pencocokan berhenti di </div> pertama dan hanya mengambil tanggal (ditemukan saat membangun indeks pertama kali).
    const starts = [...body.matchAll(/<(article|div)[^>]*class="(?:project|job|skill|cert)(?:\s[^"]*)?"[^>]*>/g)].map(m => m.index);
    const head = text((body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [, id])[1]);
    if (starts.length >= 2) {
      starts.forEach((st, k) => {
        const seg = body.slice(st, k + 1 < starts.length ? starts[k + 1] : body.length);
        const t = text((seg.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [, ""])[1]) || text((seg.match(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/) || [, head])[1]);
        let body2 = text(seg);
        if (id === "experience") {
          // label bentukan dari data yang sama, supaya "current role" menemukan entri "… – Present" (bukan fakta baru)
          body2 = `Role: ${t}${/Present/.test(body2) ? " (current role)" : ""}. ${body2}`;
        }
        split(`${head}: ${t}`, body2, `${SITE}#${id}`, "portfolio").forEach(c => chunks.push(c));
      });
    } else {
      split(head, text(body), `${SITE}#${id}`, "portfolio").forEach(c => chunks.push(c));
    }
  }
  return chunks;
}

export function fromMarkdown(md, repo) {
  const url = `https://github.com/${OWNER}/${repo}`;
  const chunks = [];
  md = md.replace(/```[\s\S]*?```/g, m => (m.length > 600 ? m.slice(0, 600) + "\n```" : m));       // blok kode panjang dipangkas
  const sections = md.split(/\n(?=#{1,3} )/);
  for (const sec of sections) {
    const h = (sec.match(/^#{1,3} (.+)/) || [, repo])[1].trim();
    const body = sec.replace(/^#{1,3} .+\n?/, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
    if (body.length < 40) continue;
    const anchor = h.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/\s+/g, "-");
    split(`${repo}: ${h}`, body, `${url}#${anchor}`, repo).forEach(c => chunks.push(c));
  }
  return chunks;
}

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

export async function build({ fetchText = get } = {}) {
  const chunks = [], skipped = [];
  chunks.push(...fromPortfolio(await fetchText(raw("indo-realtime-monitor", "site/index.html"))));
  for (const repo of REPOS) {
    try { chunks.push(...fromMarkdown(await fetchText(raw(repo, "README.md")), repo)); }
    catch (e) { skipped.push(`${repo}: ${e.message}`); }
  }
  chunks.forEach((c, i) => (c.id = i + 1));
  return { built_at: new Date().toISOString(), sources: [SITE, ...REPOS.map(r => `https://github.com/${OWNER}/${r}`)], skipped,
           chunks, index: buildIndex(chunks) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const kb = await build();
  writeFileSync(new URL("../src/kb.json", import.meta.url), JSON.stringify(kb));
  const bySrc = kb.chunks.reduce((m, c) => ((m[c.source] = (m[c.source] || 0) + 1), m), {});
  console.log(`kb.json: ${kb.chunks.length} chunks`, bySrc, kb.skipped.length ? `skipped: ${kb.skipped.join("; ")}` : "");
}
