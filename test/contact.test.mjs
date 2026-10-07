// Pesan langsung ke Elson via Telegram: validasi, honeypot, isi pesan, dan tidak ada panggilan bila belum dikonfigurasi.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { contactElson, parseContact, telegramMessage } from "../src/worker.js";

const ORIGIN = "https://elsonsaputra03-dot.github.io";
const ENV = { ALLOWED_ORIGINS: ORIGIN, TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_CHAT_ID: "42" };
const ok = { question: "Apakah Elson tersedia untuk proyek BigQuery?", contact: "0812-3456-7890", name: "Rina", consent: true };
const tg = (seen, status = 200) => async (url, init) => { seen.push({ url, body: JSON.parse(init.body) }); return new Response("{}", { status }); };

test("contact parsing: email and Indonesian WhatsApp numbers", () => {
  assert.deepEqual(parseContact("Rina@Example.com"), { kind: "email", value: "rina@example.com" });
  assert.deepEqual(parseContact("0812-3456-7890"), { kind: "phone", value: "6281234567890" });
  assert.deepEqual(parseContact("+62 812 3456 7890"), { kind: "phone", value: "6281234567890" });
  assert.deepEqual(parseContact("81234567890"), { kind: "phone", value: "6281234567890" });
  for (const bad of ["", "abc", "rina@", "12345", "<script>@x.com"]) assert.equal(parseContact(bad), null, bad);
});

test("sends one Telegram message with a WhatsApp reply button and escaped text", async () => {
  const seen = [];
  const [status, out] = await contactElson({ ...ok, question: "Pengalaman <b>Kafka</b>?", aiAnswer: "He built App Tagging Stream [1]." }, ENV,
                                           { fetchImpl: tg(seen) });
  assert.equal(status, 200); assert.equal(out.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.telegram.org/bot123:abc/sendMessage");
  assert.equal(seen[0].body.chat_id, "42");
  assert.match(seen[0].body.text, /&lt;b&gt;Kafka&lt;\/b&gt;/);
  assert.match(seen[0].body.text, /\+6281234567890 \(WhatsApp\)/);
  assert.match(seen[0].body.text, /App Tagging Stream/);
  const btn = seen[0].body.reply_markup.inline_keyboard[0][0];
  assert.equal(btn.text, "Balas via WhatsApp");
  assert.ok(btn.url.startsWith("https://wa.me/6281234567890?text=Halo%20Rina"));
});

test("email contact gets a Gmail compose button (Telegram buttons cannot open mailto:)", () => {
  const m = telegramMessage({ name: "", contact: { kind: "email", value: "hr@example.com" }, question: "Halo?", aiAnswer: "", page: "" });
  const btn = m.reply_markup.inline_keyboard[0][0];
  assert.equal(btn.text, "Balas via email");
  assert.ok(btn.url.startsWith("https://mail.google.com/mail/?view=cm&fs=1&to=hr%40example.com"));
});

test("rejects missing consent, bad contact, short or long text; honeypot is accepted silently without sending", async () => {
  const seen = [];
  const f = tg(seen);
  assert.equal((await contactElson({ ...ok, consent: false }, ENV, { fetchImpl: f }))[0], 400);
  assert.equal((await contactElson({ ...ok, contact: "nope" }, ENV, { fetchImpl: f }))[0], 400);
  assert.equal((await contactElson({ ...ok, question: "hi" }, ENV, { fetchImpl: f }))[0], 400);
  assert.equal((await contactElson({ ...ok, question: "x".repeat(501) }, ENV, { fetchImpl: f }))[0], 400);
  assert.deepEqual(await contactElson({ ...ok, website: "spam.example" }, ENV, { fetchImpl: f }), [200, { ok: true }]);
  assert.equal(seen.length, 0);
});

test("not configured: 503 and no network call; Telegram failure: 502", async () => {
  const seen = [];
  assert.equal((await contactElson(ok, { ALLOWED_ORIGINS: ORIGIN }, { fetchImpl: tg(seen) }))[0], 503);
  assert.equal(seen.length, 0);
  assert.equal((await contactElson(ok, ENV, { fetchImpl: tg(seen, 400) }))[0], 502);
});

test("POST /contact through the Worker: origin check and its own rate limiter", async () => {
  const seen = [];
  const mk = origin => new Request("https://w.example/contact", { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" }, body: JSON.stringify(ok) });
  assert.equal((await worker.fetch(mk("https://evil.example"), ENV, {}, { fetchImpl: tg(seen) })).status, 403);
  const limited = { ...ENV, CONTACT_LIMITER: { limit: async () => ({ success: false }) } };
  assert.equal((await worker.fetch(mk(ORIGIN), limited, {}, { fetchImpl: tg(seen) })).status, 429);
  const r = await worker.fetch(mk(ORIGIN), ENV, {}, { fetchImpl: tg(seen) });
  assert.equal(r.status, 200); assert.equal(seen.length, 1);
});
