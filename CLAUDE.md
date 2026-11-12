# Rote (Resume Autofill)

## Debugging on a live page

Don't use computer use to look at Seth's Chrome. Read Rote's logs and drive pages with Claude in Chrome (`mcp__claude-in-chrome__*`) instead. Seth asked for this on 12 November 2026.

Claude in Chrome only sees tabs in its own tab group. To inspect a page Seth has open, ask for the URL and open it in a new tab there.

## Where Rote keeps things

The local install unpacks to `%LOCALAPPDATA%\Rote\extension` and runs as an unpacked extension in the Default Chrome profile with ID `fpgpekpjndigfgmmmfegedhphdhnbkmi`. `install.ps1` copies a build there, and `dist/` holds the latest local build.

Logs live in the extension's IndexedDB database `resume-autofill`, object store `logs`, capped at 20,000 entries (`src/shared/db.ts`). Every part of the extension writes through `src/shared/log.ts`, and the service worker redacts personal values and URL query strings unless debug logging is on.

Claude in Chrome can't open `chrome-extension://` pages, so read the logs from disk. Copy `%LOCALAPPDATA%\Google\Chrome\User Data\Default\IndexedDB\chrome-extension_fpgpekpjndigfgmmmfegedhphdhnbkmi_0.indexeddb.leveldb` to the scratchpad (the `LOCK` file won't copy while Chrome runs, which is fine). Recent entries sit in the `.log` file as V8-serialized objects. Find each record by the bytes `o"\x02ts` and decode the tags `"` (latin-1 string), `c` (UTF-16 string), `I` (zigzag varint), `N` (double), `T`/`F`, `o`...`{` (object) and `A`/`a` (arrays). Older entries move into `.ldb` files, which are block-compressed and need a real LevelDB reader.

Seth can also open the Profile and logs page himself. It shows the newest 200 entries and has an export button that saves NDJSON.

The database also holds `kv` (settings and profiles), `resumes`, `answers` and `applications`.
