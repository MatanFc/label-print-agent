# Label Print Agent

Local HTTP agent (Node 20.6+, ESM, zero dependencies) that receives PDFs from an allowed website and
prints them to one named printer. Developed and tested on macOS; deployed to a dedicated Windows PC.
User-facing setup is in README.md.

## The one rule

One codebase serves both macOS and Windows. OS-specific code lives only in `src/printers/cups.js`
(macOS/Linux, `lp`) and `src/printers/windows.js` (Windows, SumatraPDF). A change to how a job is
printed (new option, copies, paper size, ...) or how its outcome is read must be made in **both**
adapters, with a test for each in `test/printers.test.js`. The Windows adapter can't run on the Mac,
so its tests check the exact command arguments and status classification; say so when a change is
verified only that way.

Each adapter's `print()` resolves only once the job has really printed. Adapters only translate OS
job/printer state into `{ finished, ok, detail }` / `{ finished: false, problem }`; the waiting,
grace period, timeout and cancel-on-failure live once, in `src/job-watch.js`.

## Layout

- `src/server.js`: HTTP routes, origin/host checks, PDF validation, temp-file handling
- `src/config.js`: reads `.env`; fails loudly on missing or invalid settings
- `src/job-watch.js`: shared wait-for-outcome loop used by both adapters
- `src/printers/index.js`: picks the adapter by platform; `DRY_RUN_DIR` saves PDFs instead of printing
- `src/printers/ipp.js`: minimal IPP client for CUPS job/printer state, over the CUPS Unix socket
  (CUPS may not listen on 127.0.0.1)
- `src/printers/windows.js`: finds the job in the Windows queue by the unique temp-file name the server assigns
- `client/label-printer.js`: the file websites copy to call the agent
- `client/test-label.js`: dependency-free label-sized PDF builder (browser and Node)
- `client/test-page.html`: served at `/` by the agent
- `scripts/install-windows-autostart.ps1`: logon scheduled task (install / `-Uninstall`)

## Commands

- `npm start`: run with `.env` (`node --env-file=.env src/server.js`)
- `npm test`: `node --test test/`
- `npm run make-test-label -- <wMm> <hMm> [out.pdf] [text...]`

## Conventions

- Keep it dependency-free; if a dependency becomes necessary, pin an exact version.
- New settings go in `.env.example`, `src/config.js` validation, and the README.
