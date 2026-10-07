# Portfolio chat

Ask questions about my work in English or Indonesian, on my [portfolio](https://elsonsaputra03-dot.github.io/indo-realtime-monitor/#ask-portfolio).
Answers come only from what I have already published (the portfolio page and my project READMEs), with numbered sources. When the
answer isn't there, it says so instead of guessing.

```
portfolio page ──POST /ask──► Cloudflare Worker ──► BM25 search over published text ──► Gemini 2.5 Flash ──► answer + sources
                              (origin allow-list,       (index built at deploy from        (sources are data,
                               5 questions/min/visitor)   the portfolio and READMEs)          not instructions)
```

## How it stays honest

| Guard | What it does |
|---|---|
| Closed sources | The model sees only the 4 best-matching passages and must cite them; `[n]` beyond those is stripped |
| Says "not in the portfolio" | If the passages don't answer the question, the model replies `NOT_IN_SOURCES` and the visitor sees a polite not-found message |
| Off-limits topics | Salary, contracts and personal questions are refused before any model call, in the language of the question |
| Prompt injection | "Ignore previous instructions"-style questions are refused; passages are framed as data |
| Abuse and cost | Only the portfolio origin may call the Worker; 5 questions per minute per visitor; 300-character questions; 400-token answers |
| Quota exhausted | Falls back to the most relevant passages, with links, instead of an error |
| Privacy | The Worker stores nothing. Questions are sent to Google Gemini to write the answer; direct questions go only to Elson's Telegram, with consent |

## Ask Elson directly

When the AI can't answer (or a visitor simply prefers a person), the chat offers **Ask Elson directly**: the visitor writes a
question, leaves an email or WhatsApp number and ticks a consent box. `POST /contact` forwards it to Elson's Telegram with a
one-tap reply button (WhatsApp `wa.me` link with a prefilled greeting, or a Gmail compose link for email). Nothing is stored:
the Worker only relays the message.

| Guard | What it does |
|---|---|
| Consent | The form can't be sent without the visitor agreeing that their question and contact go to Elson |
| Spam | Hidden honeypot field, 2 messages per minute per visitor, 5–500 characters, portfolio origin only |
| Valid contact | Email, or a phone number normalised to WhatsApp format (`0812…` → `62812…`) |
| Safe message | Visitor text is HTML-escaped before it reaches Telegram |

Setup (once): create a bot with [@BotFather](https://t.me/BotFather), send it any message, then read your chat id from
`https://api.telegram.org/bot<TOKEN>/getUpdates` (`message.chat.id`). Store both as secrets:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

Until they are set, `/contact` answers 503 and the page says direct messages aren't available.

## Knowledge base

`npm run build-kb` reads the published portfolio page (one passage per project card, role, skill group and section) and the README
of each public repository, splits them by heading, and builds a BM25 index into `src/kb.json`. Indonesian questions are expanded with
English equivalents (pengalaman → experience, keahlian → skills, …) because the sources are in English. A repository that is not
public yet is skipped with a warning.

## Tests

`npm test` runs 36 offline tests: a retrieval evaluation of 15 English and Indonesian questions that must find the right source in the
top three, and Worker behaviour with Gemini and the rate limiter mocked (citations, not-found, refusals without a model call,
quota fallback, CORS, limits) and the direct-message relay with Telegram mocked (validation, consent, honeypot, escaping, reply buttons).

## Deploy

```bash
npm run build-kb
npx wrangler login
npx wrangler secret put GEMINI_API_KEY      # the key never appears in code or config
npx wrangler deploy
```

Cloudflare Workers Free allows 100,000 requests a day; the Gemini API free tier has its own limits, after which the fallback applies.

## License

MIT
