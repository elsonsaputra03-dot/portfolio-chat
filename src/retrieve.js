// Pencarian BM25 atas potongan dokumen. Indeks dibangun saat build (scripts/build-kb.mjs) supaya Worker hanya menghitung
// skor untuk beberapa kata kueri: murah dalam batas CPU 10 ms Workers Free.
const STOP = new Set(("a an and are as at be by for from has have he i in is it its of on or that the this to was were what when where which who " +
  "why will with how do does did can you your about me my his him elson saputra " +
  "dan di ke dari yang untuk dengan apa siapa bagaimana apakah adalah ini itu dia ia saya kamu anda pada atau juga ada bisa").split(" "));

export function tokenize(text) {
  return (text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9][a-z0-9+#.-]*[a-z0-9+#]|[a-z0-9]/g) || [])
    .filter(t => t.length > 1 && !STOP.has(t));
}

export function buildIndex(chunks) {
  const df = {}, docs = [];
  for (const c of chunks) {
    const tf = {};
    for (const t of tokenize(`${c.title} ${c.title} ${c.text}`)) tf[t] = (tf[t] || 0) + 1;     // judul diberi bobot ganda
    docs.push({ tf, len: Object.values(tf).reduce((a, b) => a + b, 0) });
    for (const t of Object.keys(tf)) df[t] = (df[t] || 0) + 1;
  }
  const n = chunks.length, idf = {};
  for (const [t, d] of Object.entries(df)) idf[t] = Math.log(1 + (n - d + 0.5) / (d + 0.5));
  return { idf, avgdl: docs.reduce((a, d) => a + d.len, 0) / Math.max(n, 1), docs };
}

// Basis pengetahuan berbahasa Inggris; pertanyaan berbahasa Indonesia diperluas dengan padanan Inggrisnya.
const ID_EN = {
  pengalaman: "experience", kerja: "experience role", bekerja: "experience role", pekerjaan: "experience role", karier: "experience",
  jabatan: "role", posisi: "role current", keahlian: "skills", kemampuan: "skills", menguasai: "skills", proyek: "project projects",
  projek: "project projects", portofolio: "portfolio", sertifikat: "certification certified", sertifikasi: "certification certified",
  penghargaan: "recognition award", kontak: "contact email linkedin", hubungi: "contact email linkedin",
  menghubungi: "contact email linkedin", dihubungi: "contact email linkedin", email: "email contact", perusahaan: "company",
  dikerjakan: "project", membangun: "built build", dibangun: "built build", sertifikatnya: "certification",
  peran: "role", saatini: "current", terakhir: "current present", memakai: "uses", menggunakan: "uses",
  biaya: "cost", hemat: "cost reduce", penghematan: "cost reduce", kualitas: "quality", pemantauan: "monitoring", gempa: "earthquake",
  kebakaran: "hotspot fire", udara: "air quality", harga: "price prices", pangan: "food", berita: "news", jaringan: "network",
  pelanggan: "subscriber", migrasi: "migration", tahun: "years", sekarang: "present current", domisili: "based", tinggal: "based",
  lokasi: "based location", pendidikan: "education", kampus: "education", alat: "tools", bahasa: "languages", vendor: "vendors",
  current: "current recent", latest: "recent", now: "recent", noc: "noc network operations center omc",
};

export function expand(query) {
  return tokenize(query).flatMap(t => (ID_EN[t] ? [t, ...ID_EN[t].split(" ")] : [t]));
}

export function search(kb, query, k = 4, { k1 = 1.2, b = 0.75 } = {}) {
  const terms = [...new Set(expand(query))].filter(t => kb.index.idf[t] !== undefined);
  if (!terms.length) return [];
  const out = [];
  kb.index.docs.forEach((d, i) => {
    let s = 0;
    for (const t of terms) {
      const f = d.tf[t];
      if (f) s += kb.index.idf[t] * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / kb.index.avgdl));
    }
    if (s > 0) out.push({ i, score: s });
  });
  return out.sort((x, y) => y.score - x.score).slice(0, k).map(r => ({ ...kb.chunks[r.i], score: +r.score.toFixed(3) }));
}
