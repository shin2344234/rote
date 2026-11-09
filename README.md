# Rote

A Chrome extension that parses your resume locally and fills job applications on any site. Scanning and filling use no AI and no server. Nothing leaves the browser except what you put on a job form, unless you turn on the AI review below and click its button.

Rote is free. If it helps you get hired, you can [buy me a coffee](https://buymeacoffee.com/SethWalker234).

## Install

```bash
npm install
```

```bash
npm run build
```

Building needs Node 20 or newer. Open `chrome://extensions`, turn on Developer mode, click Load unpacked, and pick the `dist` folder. After a code change, run the build again and click the reload icon on the extension's card.

## Use

Click the toolbar icon to open the side panel, then Profile and logs. Add a PDF, DOCX or TXT resume, correct the parsed data, fill in the answers a resume can't provide, and click Save profile.

After updating the extension, click Reparse next to a saved resume to run the new parser on the stored file. The result loads into the form and overwrites what the parser finds, including your edits to those fields. Nothing is saved until you click Save profile. A field the new parser no longer finds keeps its saved value.

On an application page, click Scan page, then Fill form. Green outlines are confident fills. Amber outlines need a look. The panel lists what still needs you. On multi-step forms, scan again on each step.

The tool never clicks submit, never solves a CAPTCHA, and never stores or fills SSNs, dates of birth, passwords or bank details. Single checkboxes stay untouched because they are usually consent statements.

## AI review

The review works with Claude, with other hosted providers, and with a model running on this PC. The button and the messages name whichever one you picked, so the examples below say Claude.

Review missed with Claude sends the fields the tool could not answer to Claude, along with your whole profile and answer bank. Claude answers only from that data. Each answer goes onto the page, then waits in the side panel. Edit it if it is wrong, then click Save answer to keep it in the answer bank or Use without saving to keep it for this application only.

Open-ended questions in the Needs you list get a Draft reply with Claude button. Each click sends that one question, your profile, your answer bank and the page title, and the draft goes through the same approval. Claude writes the draft only from your data, so a question about motives may come back partial or empty.

SSN, date of birth and bank fields, file uploads, lone checkboxes and fields that already hold a value are never sent.

Pick the connection under Profile and logs. An Anthropic API key bills your API account, and the key is stored unencrypted in this Chrome profile. Claude Code on this PC uses your Claude Code sign-in and counts against that plan. It needs Windows, PowerShell 7 and Node, and one setup command run from this folder.

When you pick Claude Code on this PC or Codex on this PC, the page checks the PC and says whether the bridge and each tool are there. If the bridge is missing, it shows the setup command with your extension's ID filled in and a button that copies it. Paste it into PowerShell, then click Check again. Running `bridge\install.ps1 -Uninstall` removes the registration.

Each API key box has a link to the page where that provider issues keys. A pasted key is checked at once, and the check generates no text.

### OpenAI and Codex

OpenAI API key works like the Anthropic key. Enter the key, click Test connection to list the models, pick one and save. Requests bill your OpenAI account.

Codex on this PC runs the Codex CLI through the same bridge as Claude Code, so the one setup command above covers both. It uses your Codex sign-in and counts against that plan. The Model box is optional, and an empty box leaves the choice to Codex. Each request runs in an empty temporary folder with a read-only sandbox and without your Codex config, rules or MCP servers.

### Other providers and local models

Choose Other provider or local model as the connection, then pick a provider. The hosted presets are OpenAI, Google Gemini, OpenRouter, Groq, Mistral, DeepSeek, xAI and Together AI. Each needs its own API key, stored unencrypted in this Chrome profile, and each bills your account with that provider. Your whole profile goes to that provider when you click Review.

The local presets are Ollama, LM Studio and llama.cpp. They need no key, and the profile stays on this PC. Start the server first. Ollama refuses requests from extensions until you set the `OLLAMA_ORIGINS` environment variable to `chrome-extension://*` and restart it. LM Studio needs CORS turned on in its server settings.

OpenRouter also has a Sign in with OpenRouter button. It opens openrouter.ai, where you approve Rote, and OpenRouter creates a key for the extension. No key is copied by hand, and requests bill your OpenRouter credits. The model starts as `openrouter/auto`, which lets OpenRouter choose, and you can change it.

Custom server takes any base URL that accepts the OpenAI chat completions format, such as vLLM, Jan or a LiteLLM proxy.

Test connection lists the server's models without generating text. Pick one in the Model box and click Save. Small local models answer less reliably than the hosted ones, so check their answers with more care.

## Debugging from logs

Profile and logs has an Export JSONL button. Every scan writes one `field.matched`, `field.unmatched` or `field.blocked` entry per field, with its label, name, id, DOM path, option list, top candidate keys and scores. Every fill writes a `field.result`. Entries from one run share a `runId`.

Values are redacted unless Debug logging is on, which turns itself off after 30 minutes. Exports made during debug logging contain personal data.

## Bug reports

Report a bug, in the side panel and under Profile and logs, sends a description and the log to `https://rote.walker-computers.com/report`. Preview report shows everything first. The report holds the description, an optional contact address, the extension and browser versions, the page host, the AI connection and model name, and the newest 3,000 log entries. Every entry is redacted again before it goes, so entries written during debug logging lose their personal values too. No resume, profile or saved answer is included.

The relay in `relay/` is a small Node server. It commits the zip to `reports/` in a private GitHub repo and opens an issue that links to it. It also serves the home and privacy pages. It refuses reports over 1.5 MB and more than five a minute from one address.

To host your own, change `REPORT_URL` in `src/shared/report.ts` and `CALLBACK_URL` in `src/shared/openrouter.ts` to your domain. Copy `relay/.env.example` to `relay/.env` and fill in a private repo, a fine-grained GitHub token for that one repo with read and write access to Contents and Issues, and the Docker network your reverse proxy or tunnel is on. The container publishes no port, so the proxy reaches it at `http://rote-relay:8787`. Then run this in `relay/`:

```bash
docker compose up -d --build
```

To teach it a new field, add a phrase to the matching entry in `src/engine/catalog.ts`, or add a new entry. The matcher, profile form and gap report all read that table.

## Layout

| Path | Contents |
| --- | --- |
| `src/parser` | PDF and DOCX text extraction and the rule-based resume parser |
| `src/engine` | Field catalog, scoring, option picking, fill plan |
| `src/content` | Page scanner and filler, injected only on Scan |
| `src/ui` | Side panel and options page |
| `src/shared` | Types, IndexedDB storage, logging and redaction, AI providers, bug reports |
| `bridge` | Native messaging host that runs Claude Code or Codex |
| `relay` | Node server that files bug reports and serves the site |

The profile is stored unencrypted in the extension's IndexedDB. Content scripts never read it and receive only the values being filled.

## Tests

```bash
npm test
```

```bash
npm run test:e2e
```

`test:e2e` drives real Chromium against the pages in `tests/fixtures`. To see how detection does on live public Greenhouse, Lever and Ashby forms, set `LIVE_SCAN=1` and run `npx playwright test live-scan`. That run only scans and never fills or uploads.

Put real resumes for manual testing in `test-resumes/`, which git ignores.

## License

MIT. See `LICENSE`.
