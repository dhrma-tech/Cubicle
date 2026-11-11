# Security

Cubicle is a static React site plus three small serverless functions (`site/api/chat.js`, `news.js`, `video.js`). It has no accounts and no database.

## Reporting a problem

Open a private security advisory on GitHub (Security tab, "Report a vulnerability") for this repository. Please do not post exploit details in a public issue. Expect a reply within a few days.

## What is protected

- **No secrets in the repo.** The history and tree were scanned for provider keys, tokens and private keys. `.env` files are git-ignored.
- **Provider keys are server-side only.** `GEMINI_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` live in Vercel environment variables. The browser never receives them.
- **AI proxy hardening (`api/chat.js`):** Origin or Referer must match the site host (or `ALLOWED_ORIGINS`), request body and message sizes are capped, JSON parsing is guarded, there is a per-visitor and a global daily limit, and upstream error details are hidden unless `AI_DEBUG=1`.
- **Link safety:** news and video URLs from live feeds are accepted only if they start with `http://` or `https://`, on both the server and the client.
- **Browser hardening (`site/vercel.json`):** Content-Security-Policy (scripts from self only, no inline scripts, no eval, framing denied, object-src none), HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy`.
- **No dangerous sinks:** the code does not use `dangerouslySetInnerHTML`, `eval` or `innerHTML`. AI replies are rendered as plain text.
- **Dependencies:** `npm audit` reports no known vulnerabilities at the time of release.
- **Service worker:** never caches `/api/` responses.

## Known limits (read before deploying)

- **Rate limits are best effort.** They are held in memory per serverless instance, so a determined attacker can exceed them. Set a monthly spend cap at every AI provider. That cap is your real protection against cost abuse.
- **User-supplied Gemini key.** If a visitor pastes their own key, it is stored in their browser's localStorage and sent directly to Google. Any script running on the origin could read it, which is why the CSP blocks third-party scripts. Visitors should use a restricted, free-tier key.
- **User data is local.** Notes, plans and progress sit in localStorage, are unencrypted and are cleared with Settings, Erase everything.
- **YouTube Data API key (pipeline only).** Restrict it to the YouTube Data API v3 in Google Cloud. It is used by the Python pipeline and is not needed by the site.

## If a key leaks

Revoke it at the provider immediately, create a new one, update the Vercel environment variable and redeploy. Pasting a key anywhere public (chat, issue, commit) should be treated as a leak.
