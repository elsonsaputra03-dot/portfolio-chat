"""Tambahkan kotak "Ask about my work" ke site/index.html (sebelum bagian Contact) dan salin ask-portfolio.js.

Pemakaian (dari folder repo indo-realtime-monitor):
    python3 gabung_chat.py https://portfolio-chat.<akun>.workers.dev
Aman dijalankan ulang; URL Worker diperbarui bila berubah. Cabut dengan: python3 gabung_chat.py --hapus
"""
import re, shutil, sys
from pathlib import Path

START, END = "<!-- ask-portfolio:start -->", "<!-- ask-portfolio:end -->"
CSS = """
  #ask-portfolio form{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 8px}
  #ask-portfolio input{flex:1 1 320px;padding:11px 13px;border:1px solid var(--rule,#d9e1e6);border-radius:8px;font:inherit}
  #ask-portfolio button[type=submit]{padding:11px 18px;border-radius:8px;border:0;background:#1D2A33;color:#fff;font:inherit;cursor:pointer}
  #ask-portfolio button[disabled]{opacity:.6;cursor:wait}
  #ask-portfolio .ap-chips{display:flex;flex-wrap:wrap;gap:6px}
  #ask-portfolio .ap-chip{border:1px solid var(--rule,#d9e1e6);background:transparent;border-radius:16px;padding:5px 11px;font:inherit;font-size:.86rem;cursor:pointer}
  #ask-portfolio .ap-out{margin-top:14px;min-height:1em}
  #ask-portfolio .ap-answer{font-size:1.02rem;line-height:1.6}
  #ask-portfolio .ap-sources{font-size:.86rem;color:#5D6D78}
  #ask-portfolio blockquote{border-left:3px solid #d9e1e6;margin:8px 0;padding:2px 12px;color:#33424C;font-size:.9rem}
  #ask-portfolio .ap-note{font-size:.8rem;color:#5D6D78;margin-top:10px}
  #ask-portfolio .ap-err{color:#8E2A22}
"""


def block(url: str) -> str:
    chips = ["What did Elson build with Kafka?", "Is he Google Cloud certified?", "What is his current role?", "Pengalaman di Huawei dan Ericsson?"]
    return f"""{START}
<section id="ask-portfolio" data-endpoint="{url}">
  <style>{CSS}</style>
  <div class="wrap">
    <div class="sec-head"><span class="idx">AI</span><h2>Ask about my work</h2></div>
    <p>Ask in English or Indonesian. Answers come only from this portfolio and the project READMEs, with numbered sources;
      when something isn't there, the assistant says so instead of guessing.</p>
    <form><input name="q" maxlength="300" placeholder="e.g. Which projects use ClickHouse?" aria-label="Your question" autocomplete="off">
      <button type="submit">Ask</button></form>
    <div class="ap-chips">{''.join(f'<button type="button" class="ap-chip">{c}</button>' for c in chips)}</div>
    <div class="ap-out" aria-live="polite"></div>
    <p class="ap-note">Questions are sent to Google Gemini to write the answer and are not stored by this site. Please don't enter personal
      information. <a href="https://github.com/elsonsaputra03-dot/portfolio-chat" target="_blank" rel="noopener noreferrer">How it works</a></p>
  </div>
</section>
<script src="assets/ask-portfolio.js" defer></script>
{END}"""


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    p = Path("site/index.html"); s = p.read_text(encoding="utf-8")
    s = re.sub(re.escape(START) + r".*?" + re.escape(END) + r"\n?", "", s, flags=re.S)
    if sys.argv[1] != "--hapus":
        url = sys.argv[1].rstrip("/")
        if not re.fullmatch(r"https://[a-z0-9.-]+\.workers\.dev|https://[a-z0-9.-]+", url):
            sys.exit("URL Worker harus https://..., mis. https://portfolio-chat.nama.workers.dev")
        m = re.search(r'<section[^>]*id="contact"', s)
        if not m:
            sys.exit("bagian Contact tidak ditemukan di site/index.html")
        s = s[:m.start()] + block(url) + "\n" + s[m.start():]
        shutil.copy(Path(__file__).with_name("ask-portfolio.js"), "site/assets/ask-portfolio.js")
    else:
        Path("site/assets/ask-portfolio.js").unlink(missing_ok=True)
    p.write_text(s, encoding="utf-8")
    print("kotak tanya", "dicabut" if sys.argv[1] == "--hapus" else f"terpasang -> {sys.argv[1]}")


if __name__ == "__main__":
    main()
