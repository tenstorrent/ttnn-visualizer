# Agent guidance for TT-NN Visualizer

This file orients coding agents and contributors who work on this repository.

## Purpose

TT-NN Visualizer lets users inspect **memory profiler** and **performance profiler** reports produced when using the Tenstorrent **TTNN** library (with TT-Metal). The UI is built around loading, browsing, and analyzing those reports—not general-purpose ML training or arbitrary workloads.

## Where reports come from

Reports can reach the app in several ways:

- **Upload** through the application.
- **Sync from a remote machine** over SSH.
- **Local TT-Metal tree** when the app runs on the same machine as TTNN/TT-Metal: default/conventional locations include paths under the TT-Metal checkout such as `tt-metal/generated/ttnn/reports/` and `tt-metal/generated/profiler/reports/` (memory vs profiler outputs).

When changing ingestion, sync, or path logic, keep these flows and paths in mind.

## Deployment and security posture

In practice the app is usually **run by the engineer on their own machine** while developing or profiling. The instance at **ttnn-visualizer.tenstorrent.com** is a **demo**, not the primary product shape.

Do **not** assume a multi-tenant hosted SaaS model for defaults, threat model, or feature tradeoffs: treat “runs locally for one user” as the common case unless a change explicitly targets the demo deployment.

## Python environment

- Use a **Python virtual environment** when running or developing the backend.
- The **main target** Python version is **3.10** (aligned with project and packaging expectations).

Backend package layout lives under `backend/` (e.g. `python -m ttnn_visualizer.app` with `PYTHONPATH=backend`).

## Architecture (high level)

- **Flask** exposes APIs, file/sync plumbing, and gateway-style behavior.
- **React** (Vite-built SPA under `src/`) holds **most product and visualization logic**. Backend changes are often thin routes, proxies, or services—not a second copy of report semantics.

If you mainly work in Python, you still benefit from knowing that many behaviors live in the frontend; for UI-only issues, prefer `src/` and API contracts over growing Flask-only business rules.

## Running the app from a development checkout

Prerequisites include **Node** and **pnpm** (see `package.json` `engines`) for scripts that orchestrate Flask and the frontend.

1. Activate your **Python virtual environment**.
2. Start Flask (debug-friendly entrypoint used in development):

   ```bash
   pnpm flask:start-debug
   ```

### Production-style Flask (single process serves built static UI)

If **`FLASK_ENV`** is **`production`** (`.env` or real environment), Flask can serve the built SPA; you do **not** need a separate Vite dev server. After **frontend** changes, rebuild static assets:

```bash
pnpm build
```

Typical workflow for a Python-focused developer who rarely edits the UI: keep `FLASK_ENV=production`, run `pnpm build` when the UI changes, then run Flask.

### Development-style (hot reload, two processes)

With **`FLASK_ENV=development`** (or unset defaulting to development per app settings), frontend developers run **both**:

- **`pnpm dev`** — Vite dev server (hot reload; no need to `pnpm build` on each edit).
- **`pnpm flask:start-debug`** — Flask API.

Both must be running for full local dev with live frontend updates.

## Code quality and linting

All **Python** code in this project should satisfy **Black**, **isort**, and **mypy** as configured here. The exact `pnpm` wrappers live in **`package.json`** (for example `flask:lint`, `flask:format`, `flask:mypy`); use those scripts so flags and paths stay consistent with CI.

All **frontend** (TypeScript/React) changes should pass **ESLint**. Run **`pnpm lint`** to check, or **`pnpm lint:fix`** to apply automatic fixes where supported.

## Repository and issue tracking

Development happens on GitHub under:

- **Organization:** `tenstorrent`
- **Repository:** `ttnn-visualizer`

When looking up **issues, pull requests, or releases**, use **github.com/tenstorrent/ttnn-visualizer** as the canonical source.

### Pull request base branch

Open pull requests with **`dev`** as the base branch by default.

Only open a PR against **`main`** when the user has **said it is a hotfix** or the **branch name starts with `hotfix`** (for example `hotfix/fix-sync-timeout`). In all other cases, use **`dev`**.
