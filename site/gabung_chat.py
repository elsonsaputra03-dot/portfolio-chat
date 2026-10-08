"""Pasang "Ask any question" di site/index.html: tombol mengambang, ajakan di atas Contact, dan popup percakapan.

Pemakaian (dari folder repo indo-realtime-monitor):
    python3 gabung_chat.py https://portfolio-chat.<akun>.workers.dev
Aman dijalankan ulang (versi lama, termasuk kotak tanya inline, diganti). Cabut dengan: python3 gabung_chat.py --hapus
"""
import re, shutil, sys
from pathlib import Path

START, END = "<!-- ask-portfolio:start -->", "<!-- ask-portfolio:end -->"
CHIPS = ["What did Elson build with Kafka?", "Is he Google Cloud certified?", "What was his most recent role?", "Pengalaman di Huawei dan Ericsson?"]
SPARK = ('<svg class="ap-spark" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2l2.6 8.4L27 13l-8.4 2.6L16 24l-2.6-8.4L5 13l8.4-2.6z"/>'
         '<path d="M26 20l1.1 3.4 3.4 1.1-3.4 1.1L26 29l-1.1-3.4-3.4-1.1 3.4-1.1z"/><path d="M6 21l.8 2.2 2.2.8-2.2.8L6 27l-.8-2.2-2.2-.8 2.2-.8z"/></svg>')
CSS = """
  :root{--ap-violet:#C9A7FF;--ap-ink:#14161F;--ap-deep:#4B1FB0}
  .ap-btn{display:inline-flex;align-items:center;gap:10px;cursor:pointer;border:2.5px solid var(--ap-ink);border-radius:999px;
    background:var(--ap-violet);color:var(--ap-ink);font:800 1.02rem/1 'Barlow Condensed',Barlow,system-ui,sans-serif;letter-spacing:.06em;
    text-transform:uppercase;padding:13px 24px 13px 18px;box-shadow:0 0 0 2px rgba(255,255,255,.85),5px 5px 0 2px var(--ap-ink);
    transition:transform .12s ease,box-shadow .12s ease}
  .ap-btn:hover{transform:translate(-2px,-2px);box-shadow:0 0 0 2px rgba(255,255,255,.85),7px 7px 0 2px var(--ap-ink)}
  .ap-btn:active{transform:translate(3px,3px);box-shadow:0 0 0 2px rgba(255,255,255,.85),2px 2px 0 2px var(--ap-ink)}
  .ap-btn:focus-visible{outline:3px solid var(--ap-deep);outline-offset:3px}
  .ap-btn .ap-ai{display:inline-flex;align-items:center;gap:3px;color:var(--ap-deep);font-size:1.15rem}
  .ap-spark{width:20px;height:20px;fill:var(--ap-deep)}
  .ap-fab{position:fixed;right:22px;bottom:calc(22px + env(safe-area-inset-bottom,0px));z-index:900}
  @media (max-width:560px){.ap-fab{right:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px));padding:11px 16px 11px 13px;font-size:.92rem}}
  #ask-portfolio .ap-cta{display:flex;flex-wrap:wrap;align-items:center;gap:22px;margin-top:14px}
  #ask-portfolio .ap-cta p{margin:0;max-width:640px}
  html.ap-lock{overflow:hidden}
  #ap-dialog{border:2.5px solid var(--ap-ink);border-radius:18px;padding:0;width:min(640px,94vw);max-height:min(760px,88vh);
    box-shadow:8px 8px 0 var(--ap-ink);background:#fff;color:#1D2A33;overflow:hidden}
  #ap-dialog[open]{display:flex;flex-direction:column}
  #ap-dialog::backdrop{background:rgba(15,18,28,.55);backdrop-filter:blur(2px)}
  @media (max-width:560px){#ap-dialog{width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;border-radius:0;border:0;box-shadow:none}}
  .ap-head{display:flex;align-items:center;gap:10px;padding:14px 16px;background:var(--ap-violet);border-bottom:2.5px solid var(--ap-ink)}
  .ap-head h2{margin:0;font:800 1.2rem/1.1 'Barlow Condensed',Barlow,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--ap-ink)}
  .ap-head .ap-spark{fill:var(--ap-deep);width:24px;height:24px}
  .ap-close{margin-left:auto;border:2px solid var(--ap-ink);background:#fff;border-radius:50%;width:34px;height:34px;font-size:1.1rem;cursor:pointer;line-height:1}
  .ap-log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;min-height:220px}
  .ap-intro{color:#5D6D78;font-size:.95rem}
  .ap-msg{max-width:88%;padding:10px 13px;border-radius:14px;line-height:1.55;font-size:.97rem}
  .ap-q{align-self:flex-end;background:var(--ap-ink);color:#fff;border-bottom-right-radius:4px}
  .ap-a{align-self:flex-start;background:#F3EEFF;border:1.5px solid #E2D6FF;border-bottom-left-radius:4px}
  .ap-a p{margin:0} .ap-a sup a{color:var(--ap-deep);text-decoration:none;font-weight:700}
  .ap-a blockquote{margin:8px 0 0;padding:2px 10px;border-left:3px solid #C9A7FF;color:#33424C;font-size:.88rem}
  .ap-src{margin:8px 0 0;padding-left:20px;font-size:.82rem;color:#5D6D78} .ap-src a{color:#33424C}
  .ap-err{background:#FDECEA;border-color:#F6C9C3;color:#8E2A22}
  .ap-dots{display:inline-flex;gap:4px} .ap-dots i{width:7px;height:7px;border-radius:50%;background:var(--ap-deep);animation:ap-b 1s infinite ease-in-out}
  .ap-dots i:nth-child(2){animation-delay:.15s} .ap-dots i:nth-child(3){animation-delay:.3s}
  @keyframes ap-b{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
  @media (prefers-reduced-motion:reduce){.ap-dots i{animation:none}.ap-btn{transition:none}}
  .ap-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px}
  .ap-chip{border:1.5px solid var(--ap-ink);background:#fff;border-radius:16px;padding:5px 11px;font:inherit;font-size:.84rem;cursor:pointer}
  .ap-chip:hover{background:#F3EEFF}
  .ap-form{display:flex;gap:8px;padding:12px 16px;border-top:1.5px solid #E6E9EC}
  .ap-form input{flex:1;min-width:0;padding:11px 13px;border:2px solid var(--ap-ink);border-radius:10px;font:inherit}
  .ap-form button{border:2px solid var(--ap-ink);background:var(--ap-violet);color:var(--ap-ink);font-weight:800;border-radius:10px;padding:0 16px;cursor:pointer}
  .ap-form button[disabled]{opacity:.55;cursor:wait}
  .ap-note{margin:0;padding:0 16px 12px;font-size:.75rem;color:#5D6D78}
  .ap-link{border:0;background:none;padding:0;font:inherit;color:var(--ap-deep);font-weight:700;text-decoration:underline;cursor:pointer}
  .ap-direct{padding:12px 16px;border-top:1.5px solid #E6E9EC;background:#FAF7FF;overflow-y:auto;max-height:52vh}
  .ap-direct[hidden]{display:none}
  .ap-direct p{margin:0 0 8px;font-size:.88rem;color:#33424C}
  .ap-direct textarea,.ap-direct input:not([type=checkbox]){width:100%;box-sizing:border-box;padding:9px 11px;border:2px solid var(--ap-ink);border-radius:10px;font:inherit;font-size:.92rem}
  .ap-direct textarea{resize:vertical;min-height:70px}
  .ap-row{display:flex;gap:8px;margin-top:8px} .ap-row>*{flex:1;min-width:0}
  .ap-hp{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;opacity:0}
  .ap-consent{display:flex;gap:8px;align-items:flex-start;margin-top:8px;font-size:.8rem;color:#5D6D78;line-height:1.4}
  .ap-direct button{border:2px solid var(--ap-ink);border-radius:10px;padding:9px 12px;font-weight:800;cursor:pointer;background:var(--ap-violet);color:var(--ap-ink)}
  .ap-direct button.ap-dcancel{background:#fff;flex:0 0 auto}
  .ap-direct button[disabled]{opacity:.55;cursor:wait}
  .ap-dstatus{margin:8px 0 0!important;font-size:.84rem!important}
  .ap-dstatus.err{color:#8E2A22!important}
  .ap-ok{background:#E6F6EA;border-color:#B7E4C2}
  .ap-a .ap-link{display:inline-block;margin-top:8px}
"""


def button(cls: str, extra: str = "") -> str:
    return (f'<button type="button" class="ap-btn {cls}" data-ap-open {extra}><span class="ap-ai">{SPARK}AI</span>'
            f'<span>Ask any question</span></button>')


def block(url: str) -> str:
    return f"""{START}
<style>{CSS}</style>
<section id="ask-portfolio">
  <div class="wrap">
    <div class="sec-head"><span class="idx">AI</span><h2>Ask about my work</h2></div>
    <div class="ap-cta">
      <p>Ask in English or Indonesian. Answers come only from this portfolio and the project READMEs, with numbered sources;
        when something isn't there, the assistant says so instead of guessing.</p>
      {button("", 'aria-haspopup="dialog"')}
    </div>
  </div>
</section>
{button("ap-fab", 'aria-haspopup="dialog" aria-label="Ask any question about my work"')}
<dialog id="ap-dialog" data-endpoint="{url}" aria-labelledby="ap-title">
  <div class="ap-head">{SPARK}<h2 id="ap-title">Ask about my work</h2>
    <button type="button" class="ap-close" aria-label="Close">✕</button></div>
  <div class="ap-log" aria-live="polite">
    <p class="ap-intro">Hi! Ask anything about Elson's projects, experience or skills, in English or Indonesian.
      Every answer cites the portfolio or a project README.</p>
  </div>
  <div class="ap-chips">{''.join(f'<button type="button" class="ap-chip">{c}</button>' for c in CHIPS)}</div>
  <div class="ap-direct" hidden>
    <form class="ap-dform" novalidate>
      <p><b>Ask Elson directly.</b> He gets a notification on his phone and replies to you by email or WhatsApp.</p>
      <textarea name="question" maxlength="500" rows="3" placeholder="Your question for Elson" aria-label="Your question for Elson"></textarea>
      <div class="ap-row"><input name="name" maxlength="60" placeholder="Your name (optional)" aria-label="Your name" autocomplete="name">
        <input name="contact" maxlength="120" placeholder="Email or WhatsApp number" aria-label="Email or WhatsApp number" autocomplete="email"></div>
      <label class="ap-consent"><input type="checkbox" name="consent"> I agree that my question, name and contact are sent to Elson
        (via Telegram) so he can reply. This site does not store them.</label>
      <div class="ap-row"><button type="submit">Send to Elson</button><button type="button" class="ap-dcancel">Cancel</button></div>
      <p class="ap-dstatus" role="status" aria-live="polite"></p>
    </form>
  </div>
  <form class="ap-form"><input autofocus maxlength="300" placeholder="Type your question…" aria-label="Your question" autocomplete="off">
    <button type="submit">Ask</button></form>
  <p class="ap-note">Prefer a human answer? <button type="button" class="ap-link" data-ap-direct>Ask Elson directly</button>.
    AI questions are sent to Google Gemini to write the answer and are not stored by this site. Please don't enter
    personal information. <a href="https://github.com/elsonsaputra03-dot/portfolio-chat" target="_blank" rel="noopener noreferrer">How it works</a></p>
</dialog>
<script src="assets/ask-portfolio.js" defer></script>
{END}"""


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    p = Path("site/index.html"); s = p.read_text(encoding="utf-8")
    s = re.sub(re.escape(START) + r".*?" + re.escape(END) + r"\n?", "", s, flags=re.S)
    if sys.argv[1] != "--hapus":
        url = sys.argv[1].rstrip("/")
        if not re.fullmatch(r"https://[a-z0-9.-]+", url):
            sys.exit("URL Worker harus https://..., mis. https://portfolio-chat.nama.workers.dev")
        m = re.search(r'<section[^>]*id="contact"', s)
        if not m:
            sys.exit("bagian Contact tidak ditemukan di site/index.html")
        s = s[:m.start()] + block(url) + "\n" + s[m.start():]
        shutil.copy(Path(__file__).with_name("ask-portfolio.js"), "site/assets/ask-portfolio.js")
    else:
        Path("site/assets/ask-portfolio.js").unlink(missing_ok=True)
    p.write_text(s, encoding="utf-8")
    print("Ask any question", "dicabut" if sys.argv[1] == "--hapus" else f"terpasang -> {sys.argv[1]}")


if __name__ == "__main__":
    main()
