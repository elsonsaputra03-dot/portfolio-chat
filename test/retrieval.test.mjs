// Evaluasi pencarian tanpa biaya LLM: setiap pertanyaan harus menemukan sumber yang benar di 3 hasil teratas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { search, tokenize, expand } from "../src/retrieve.js";

const kb = JSON.parse(readFileSync(new URL("../src/kb.json", import.meta.url)));

const CASES = [
  ["What did Elson build with Kafka?", /App Tagging Stream/],
  ["Which project uses ClickHouse and Kafka?", /App Tagging Stream|Indonesia Realtime Monitor/],
  ["How does the BigQuery toolkit reduce cost?", /BigQuery|bq-governance-toolkit/],
  ["What did the real BigQuery runs find?", /bq-governance-toolkit/],
  ["Is he Google Cloud certified?", /Google Cloud Certified|Professional Data Engineer/],
  ["Which network vendors has he worked with?", /OSS|Network KPI|Experience/],
  ["When did he work as a NOC operator?", /NOC Operator/],
  ["What is his current role?", /Data Engineer \(Managed Service\)/],
  ["How is the realtime monitor hosted for free?", /GitHub Pages|Indonesia Realtime Monitor|indo-realtime-monitor/],
  ["How can I contact him?", /Contact/],
  ["Pengalaman di Huawei?", /Experience|OSS/],
  ["Sertifikasi apa yang dimiliki?", /Google Cloud Certified|Professional Data Engineer/],
  ["Proyek apa yang memakai Kafka?", /App Tagging Stream|Indonesia Realtime Monitor/],
  ["Bagaimana cara menghubungi Elson?", /Contact/],
  ["How does the LLM assistant avoid making things up?", /Ask the Data|guard/i],
];

for (const [q, want] of CASES) {
  test(`retrieval: ${q}`, () => {
    const titles = search(kb, q, 3).map(h => h.title);
    assert.ok(titles.some(t => want.test(t)), `${q}\n  got: ${titles.join(" | ")}`);
  });
}

test("Indonesian terms expand to the English vocabulary of the sources", () => {
  assert.deepEqual(expand("pengalaman"), ["pengalaman", "experience"]);
  assert.ok(!tokenize("apa yang dan the of").length);
});

test("every chunk links back to a published source", () => {
  for (const c of kb.chunks) assert.match(c.url, /^https:\/\/(elsonsaputra03-dot\.github\.io|github\.com\/elsonsaputra03-dot)\//);
});
