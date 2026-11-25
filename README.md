# Label Print Agent

Lets your website print PDF labels straight to one specific printer (a Brother QL-1100C) with no
print dialog. A browser page can't choose a printer by itself, so a small agent runs on the computer
the printer is plugged into, and the page sends the PDF to it:

```
your website (browser) --POST PDF--> http://127.0.0.1:9123/print --> agent --> lp (macOS) / SumatraPDF (Windows) --> QL-1100C
```

**There is one codebase for macOS and Windows.** Only `src/printers/cups.js` (macOS) and
`src/printers/windows.js` (Windows) differ, and the agent picks one at startup. Every other change
applies to both automatically. Each machine has its own `.env`; that's the only thing not copied.

## Requirements

- Node.js 20.6 or newer (`node -v`). No npm packages; there's nothing to `npm install`.
- The Brother QL-1100 driver installed from Brother's support site, so the printer shows up as an OS printer. On an Apple Silicon Mac it also needs Rosetta (see Troubleshooting).
- Windows only: [SumatraPDF](https://www.sumatrapdfreader.org/download-free-pdf-viewer) (the portable `.exe` is fine). Windows has no built-in command that prints a PDF to a named printer.
- Chrome or Edge for the website. Safari is untested.

## Test on the Mac

```bash
cp .env.example .env
```

Edit `.env`: set `ALLOWED_ORIGINS` to your site's origin (for local dev, e.g. `http://localhost:3000`).
Then start the agent:

```bash
npm start
```

Open http://127.0.0.1:9123/. That test page lists the printers the agent can see. Copy the
Brother's exact name into `PRINTER_NAME`, restart, and click **Print test label**.

No Brother on the Mac yet? Set `DRY_RUN_DIR=./dry-run-output`. Each PDF is then saved to that folder
instead of being printed, so you can test the whole website flow without a printer.

Run the tests after every change. They check both the macOS and the Windows printer commands, so
they catch a change that would break Windows even though you're on a Mac:

```bash
npm test
```

## Install on the Windows computer

1. Install Node.js (LTS), the Brother QL-1100 driver, and SumatraPDF.
2. Copy this whole folder to the computer, e.g. `C:\label-print-agent`. Leave out your Mac's `.env`, `dry-run-output/` and `samples/`.
3. Copy `.env.example` to `.env` and fill it in. `PRINTER_NAME` is usually different on Windows (e.g. `Brother QL-1100`); the test page shows the exact name. Set `SUMATRA_PATH` to the full path of `SumatraPDF.exe`, and set the paper size in the driver (see **Label size and orientation**).
4. Double-click `start-windows.bat` and check http://127.0.0.1:9123/ in the browser.
5. When it works, close that window and make the agent start automatically at logon:
   ```
   powershell -ExecutionPolicy Bypass -File scripts\install-windows-autostart.ps1
   ```
   Undo it with the same command plus `-Uninstall`. The log goes to `agent.log` in the folder.

To update the Windows computer later, copy the changed files over (everything except `.env`) and
restart the agent: run the install script with `-Uninstall` (which also stops the running agent), then again without it.

## Label size and orientation (both machines)

The printer driver decides the paper size, not the PDF. The size you choose must match the roll
that's loaded, or the printer stops with a blinking red light (`com.brother-paper-size-error`).

**Setup for the DK-2205 roll (62 mm continuous):**

- On the Mac, the driver's `62mm` size is always **62 × 100 mm**; it ignores the tape-length and
  trim-tape options. So design every label as a **100 × 62 mm landscape PDF** and let the agent
  rotate it onto the tape:
  ```
  LP_OPTIONS=media=62mm
  ORIENTATION=landscape
  ```
- On Windows: Printers & scanners → Brother QL-1100 → Printing preferences → Paper size **62mm**,
  length **100 mm**, and `ORIENTATION=landscape`. `PRINT_SCALE=noscale` (the default) prints at 1:1;
  use `fit` if the PDF size doesn't match exactly.

**Keep content at least 3 mm from every edge.** The printer can't print the outer ~1.5 mm at the
sides or ~3 mm at the cut ends, so anything there is clipped.

For other rolls, list the sizes the Mac driver knows with `lpoptions -p <PRINTER_NAME> -l` and set
`LP_OPTIONS=media=<size>`. Portrait designs that match the label exactly use `ORIENTATION=portrait`.

Make a test PDF with `npm run make-test-label -- <width> <height>` (default 100 × 62); it's written to
`samples/test-label.pdf`.

## Use it from your website

Copy `client/label-printer.js` into your site and call it with a PDF (a `Blob` or bytes), usually one your backend generated:

```js
import { printLabel, agentStatus } from './label-printer.js';

const pdf = await (await fetch(`/orders/${id}/label.pdf`)).blob();
await printLabel(pdf, { copies: 1 });   // throws with a readable message on failure
```

`examples/website-example.html` is a working page that does this. The first time an HTTPS site calls
the agent, Chrome/Edge ask whether the site may access devices on your local network. Click **Allow**.

## API

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/health` | | `{ ok, platform, printer, dryRun }` |
| GET | `/printers` | | `{ configured, configuredFound, printers[] }` |
| POST | `/print` | body: the PDF, `Content-Type: application/pdf`; `?copies=1..100` | `{ ok, copies, bytes, jobId, savedTo? }` |
| GET | `/` | | test page |

`POST /print` answers only once the job has really finished, usually a few seconds. `ok: true` means
the printer printed it. If the printer can't print, the agent cancels the job (so it won't print later
by surprise) and answers 502 with the reason, e.g. `The print queue is paused…` or
`The printer reports com.brother-paper-size-error`. A problem has to last 5 seconds before it counts,
and a job that hasn't finished after 30 s + 2 s per copy is cancelled too.

Errors are JSON `{ error }` with status 400 (not a PDF / bad copies), 403 (origin or host not allowed),
413 (PDF over 10 MB), 415 (wrong Content-Type), 502 (printing failed; the reason is included).

## Security

- The agent listens on `127.0.0.1` only, so other computers on the network can't reach it.
- Only web pages from `ALLOWED_ORIGINS` (plus the agent's own test page) can print. The check runs on every request, not only on CORS preflight.
- Requests whose `Host` isn't `127.0.0.1`/`localhost` are refused, which blocks DNS-rebinding tricks.
- Requests with no `Origin` (curl, local scripts) are accepted: any program on the computer can already print.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Website says the agent is not reachable | Agent not running, the site's exact origin isn't in `ALLOWED_ORIGINS` (`http://localhost:3000` and `http://127.0.0.1:3000` are different origins), or the local-network prompt was blocked. |
| `Printing failed: ... does not exist` | `PRINTER_NAME` doesn't match exactly; copy it from the test page. |
| Label prints tiny, cut off, or on two labels | The PDF page size and the driver's paper size differ, or the orientation is wrong; see **Label size and orientation**. |
| Agent exits at start with `Config error` | The message names the missing or invalid `.env` setting. |
| Mac: jobs show "Filter failed" (`com.apple.badarch-error`) | Brother's Mac driver is Intel-only. On Apple Silicon, install Rosetta: `sudo softwareupdate --install-rosetta --agree-to-license`. |
| `The print queue is paused` | After a printer error the OS pauses the queue. Fix the printer, then resume it: Mac: System Settings → Printers & Scanners → Resume, or `cupsenable <PRINTER_NAME>`; Windows: the printer's queue window → Printer → uncheck Pause Printing. |
| `The printer reports com.brother-paper-size-error` | The loaded roll doesn't match the configured size; see **Label size and orientation**. |
| `The printer reports com.brother-tape-feed-error`, `PaperOut`, … | The roll is empty, not seated, or the cover is open. Fix it, then print again; the failed job was already cancelled. |
