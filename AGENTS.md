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
- Supported versions are Python 3.10–3.14.

Backend package layout lives under `backend/` (e.g. `python -m ttnn_visualizer.app` with `PYTHONPATH=backend`).

## Architecture (high level)

- **Flask** exposes APIs, file/sync plumbing, and gateway-style behavior.
- **React** (Vite-built SPA under `src/`) holds **most product and visualization logic**. Backend changes are often thin routes, proxies, or services—not a second copy of report semantics.

If you mainly work in Python, you still benefit from knowing that many behaviors live in the frontend; for UI-only issues, prefer `src/` and API contracts over growing Flask-only business rules.

## HTTP API conventions

- **Instance scoping:** Report-backed routes (operations, tensors, buffers, metadata, stack-trace, etc.) expect **`instanceId` as a query parameter**. The React app’s `axiosInstance` injects it on every request from session storage / URL; paths do not embed instance IDs.
- **`/api/remote` subtree:** Remote SSH flows are grouped under **`/api/remote/...`**. Canonical names include `POST /api/remote/profiler-reports`, `POST /api/remote/performance-reports`, `POST /api/remote/test`, `POST /api/remote/sync`, `POST /api/remote/use`.
- **GET vs POST:** Read-only stack trace file checks use **`GET /api/remote/stack-trace/test`** and **`GET /api/remote/stack-trace/read`** with `?filePath=...`. **POST** is used where the body carries SSH connection material (folder listing, sync, use, test).

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

### Backend

All **Python** code in this project should satisfy **Black**, **isort**, and **mypy** as configured here. The exact `pnpm` wrappers live in **`package.json`** (for example `flask:lint`, `flask:format`, `flask:mypy`); use those scripts so flags and paths stay consistent with CI.

### Frontend

Treat **`tsconfig*`**, **ESLint**, **Stylelint**, and **Prettier** as the source of truth for TypeScript/React and stylesheet work (including `.css`, `.scss`, and `.sass`). Prefer the style already present in files you edit when it stays compatible with those configs, and keep typing strict under the project compiler options.

Avoid introducing lint suppressions unless the user explicitly asks for them. For edits you make, run linters when practical and fix problems your change causes; format touched code with Prettier and stay within ignore boundaries rather than reformatting unrelated paths. When a formatter and a linter disagree, follow how this repository wires them together instead of ad-hoc overrides; if a rule genuinely blocks the right fix, surface that and confirm before relaxing standards.

All frontend changes should pass **ESLint**: run **`pnpm lint`** to check, or **`pnpm lint:fix`** where automatic fixes apply.

### SPDX

Any **new source code files** you add must include a **valid SPDX license identifier** in the file header, consistent with how existing files in this repository are annotated. The **`pnpm lint:spdx`** script (see **`package.json`**) validates SPDX headers for supported paths. When creating a new source code file, ensure the year in the SPDX header is the current year. If editing an existing file, do not change the year unless explicitly requested to do so.

## Repository and issue tracking

Development happens on GitHub under:

- **Organization:** `tenstorrent`
- **Repository:** `ttnn-visualizer`

When looking up **issues, pull requests, or releases**, use **github.com/tenstorrent/ttnn-visualizer** as the canonical source.

### Pull request base branch

Open pull requests with **`dev`** as the base branch by default.

## Code style and conventions

> See [`CONVENTIONS.md`](./CONVENTIONS.md) for the expanded reference — same rules as below, with examples, file/line references, and rationale.

### Comments

- Comments must explain **why**, not what. Avoid restating what the code obviously does (`// increment counter`, `// import module`). Don't narrate the change you're making in a comment (`// Fixed the bug by adding a guard`).
- Preserve `//` placeholder lines inside multi-line array/object literals where they already exist — they intentionally prevent auto-formatters from collapsing the line.
- Stale comments are bugs. If you change behaviour, update or delete the comment.

### TypeScript

- Prefer **named enums** over inline string-literal unions when the union has semantic meaning (e.g. `enum NodeRelation { Input = 'input', Output = 'output' }` rather than `'input' | 'output'`). Use string-valued enums so the runtime values match the previous union — bare `enum NodeRelation { Input, Output }` is a numeric enum (`Input = 0`, `Output = 1`) and silently breaks string comparisons. One-off booleans/flags don't need enum promotion.
- When using third-party generic containers (`DataSet<T>`, `Map<K, V>`), spell out the type parameter rather than relying on inference that obscures intent.
- Respect `react-hooks/exhaustive-deps`. If you suppress it, add a one-line comment explaining the trade-off and why the missing dep is intentionally stable.
- Default to **`interface ComponentNameProps`** for component props (the `Props` suffix is required), declared immediately above the component. Reserve `type` for unions, generic-constrained mappings, and `Omit`/`Pick` derivations.
- Don't annotate components with **`React.FC`**, **`FC`**, or **`React.FunctionComponent`**. Type props directly on the function (`function Foo({…}: FooProps)` / `const Foo = ({…}: FooProps) =>`). Components with children declare **`children: ReactNode`** on `FooProps`.
- Prefer **`null`** over **`undefined`** for intentional “no value” in your own state, return types, and API-shaped data (`T | null`, default `null`). Keep **`undefined`** for optional properties, omitted keys, and third-party signatures you cannot change.

### CSS / SCSS

- Don't hardcode colour values in TS/TSX. Promote to a CSS custom property in `src/scss/_base.scss` (e.g. `--graph-focused-node: #f6bc42;`), then expose it through `GRAPH_COLORS` in `src/definitions/GraphColors.ts` via the `cssVar()` helper. Components import from `GRAPH_COLORS`, never from a literal.
- The same rule applies to magic layout numbers used in more than one place — promote to a SCSS variable or CSS custom property.

### Lint discipline

- Pre-existing lints in code you didn't touch are not yours to fix in unrelated PRs. Surface them if they matter; don't sprawl scope.
- Lint suppressions (`// eslint-disable-next-line ...`, `# type: ignore`, etc.) require an explanatory comment on the same or preceding line.
- When a lint warning looks wrong, assess its **validity** before reaching for a suppression. Many warnings point at a real latent issue worth fixing properly (e.g. ref-read-in-render warnings often signal a stable-singleton pattern that could be expressed more cleanly).

### Testing

- Frontend: **Vitest** + `@testing-library/react` (`pnpm test`).
- Backend: **pytest** with `caplog`, `tmp_path`, and the shared **`client`** fixture (Flask's `app.test_client()`, defined in `backend/ttnn_visualizer/tests/conftest.py`) for endpoint tests.
- For larger test suites — characterisation tests, refactor regressions — build **shared fixture helpers** (see `tests/mlirFixtures/builders.ts`) and **cross-cutting invariant checks** (see `tests/mlirFixtures/invariants.ts`) instead of repeating ad-hoc setup.

### Frontend data integrity

- Prefer **client-side JSON validation** for user-uploaded JSON before the backend parses it. Surface validation errors with a friendly UI message rather than a 5xx round-trip. Use `try { JSON.parse(...) } catch (e) { ... }` and shape-check predicates.

### Upload security

- All file-upload handlers must apply `Path(filename).name` to user-supplied filenames before composing destination paths. On our Linux/macOS servers this collapses POSIX-style traversal components (`../`, absolute prefixes). **Caveat:** `\` isn't a path separator under POSIX, so backslash-separated paths and Windows drive-letter prefixes survive `.name` unchanged — they become literal filename characters inside the target directory rather than traversal vectors, so containment still holds, but don't read the helper as a full cross-platform sanitiser. Add a regression test that submits a crafted traversal filename and asserts the file lands inside the intended directory.

### Toolchain and package management

- **pnpm** is the only supported frontend package manager (`engines.pnpm >= 11`). Don't `npm install` or `yarn add`.
- The Node version is pinned via **`.nvmrc`**. Use `nvm use` from the repo root; `corepack` handles pnpm shimming automatically on Node 16+.

### Database schema changes

- New columns on existing tables go via **Alembic migrations**, not ad-hoc `ALTER TABLE`. The app declares `alembic` in `pyproject.toml` and runs migrations on startup.
- When adding a column referenced by ORM models, declare it `nullable=True` (or with a default) so existing databases don't break before migrations apply.

### State management (Jotai)

- All shared atoms live in **`src/store/app.ts`** and end with the `Atom` suffix (e.g. `activeProfilerReportAtom`). Components and hooks consume atoms — they do not declare new ones inline. Add new atoms in the section comment block matching their feature area.
- Prefer **`useAtomValue`** for read-only consumers and **`useSetAtom`** for write-only consumers; use **`useAtom`** when a component both reads and writes the same atom. Don't subscribe via `useAtom` if you only need one half of the tuple.
- Use **`atomWithStorage`** from `jotai/utils` for user-preference flags that need to survive reloads — never reach for `localStorage` directly.

### Data fetching (React Query)

- Type every hook as **`useQuery<Data, AxiosError>`** — don't let the error parameter fall back to `unknown`. Call sites depend on `AxiosError` shape (e.g. `error?.status === HttpStatusCode.UnprocessableEntity`).
- Query keys are tuples of `['kebab-string-name', ...reactiveDeps]` (e.g. `['fetch-all-buffers', bufferType, activeProfilerReport?.path]`). Report-bound queries use `staleTime: Infinity`. Keys that need invalidation from another module are exported as `*_QUERY_KEY` constants.

### Errors and toasts

- Funnel error-string extraction through **`getResponseError(error, fallback?)`** (`src/functions/getResponseError.ts`). Don't reach into `error.response.data.error` ad-hoc — the helper handles AxiosError, Error, and string fallbacks consistently.
- Emit toasts via **`createToastNotification(message, fileName, ToastType.X)`** (`src/functions/createToastNotification.tsx`). Don't import `toast` from `react-toastify` directly in components. The `<ToastContainer>` is mounted once in `Layout.tsx`.

### File organization and modules

- **`src/definitions/`** holds *primitives*: enums, route/endpoint maps, plot/colour configs, plain interfaces. **`src/model/`** holds richer domain types — usually API response shapes, sometimes classes with methods. If it mirrors a backend response, it's a model.
- URL endpoints are centralized in the **`Endpoints` enum** (`src/definitions/Endpoints.ts`); routes in the **`ROUTES` frozen const** (`src/definitions/Routes.ts`). Never inline a URL string in a component.
- Test IDs are centralized in **`TEST_IDS`** (`src/definitions/TestIds.ts`, `Object.freeze`'d) and referenced from both component `data-testid` attributes and test queries. No hardcoded test-id strings.

### Naming

- Function-name prefixes carry meaning. Match them when you add new functions:

  | Prefix | Purpose |
  |---|---|
  | `use*` | React hook (must follow rules of hooks) |
  | `handle*` | Event handler bound to a UI event |
  | `get*` | Pure accessor or formatter |
  | `is*`, `has*` | Boolean predicate |
  | `fetch*` | Async axios wrapper returning `Promise<T>` |

- **Module-level constants** use `SCREAMING_SNAKE_CASE` (`MAX_RETRIES`, `LOCAL_STORAGE_KEY_*`). **Module-level** means the outer scope of a file, not “only used in this file” — use `const` without `export` for values private to that module; export shared constants from a central module such as **`src/definitions/`** (see File organization above), not ad hoc from leaf components.
- Backend module-private helpers prefix with a single underscore (e.g. `_file_path_from_stack_source_request`).

### Backend conventions

- Module-level logger: **`logger = logging.getLogger(__name__)`** at the top of every backend module that logs. Use `logger.info/warning/error/exception`, never `print`.
- View decorator stack order: **`@api.route → @with_instance → @timer`**. Use **`@local_only`** to gate endpoints that must refuse `SERVER_MODE` (uploads, local-only flows); it returns 403 automatically.
- Error responses go through the helpers in `backend/ttnn_visualizer/exceptions.py`: **`response_bad_request / response_not_found / response_forbidden / response_unprocessable_entity / response_internal_server_error`**. Don't hand-roll `jsonify({...}), 400`. Use **`StatusMessage`** (Pydantic) when the response needs to carry a `ConnectionTestStates` status alongside the message (uploads, sync, connection-test endpoints).
- Env-var booleans go through **`str_to_bool(os.getenv("FOO", "false"))`** — never `bool(os.getenv(...))` (which is truthy for `"false"`).
