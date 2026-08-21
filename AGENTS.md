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

The app ships in two first-class shapes, and changes should work in both unless a feature is explicitly local-only:

- **Local install** on the engineer's own machine — full feature set, including local filesystem access, uploads, and remote SSH sync.
- **Hosted** at **ttnn-visualizer.tenstorrent.com** — runs with `SERVER_MODE` enabled, so `@local_only` endpoints return 403 and the frontend hides the matching UI via `getServerConfig()`.

Treat the hosted deployment as **multi-user and untrusted-input**: requests can come from anyone, instances are not mutually trusted, and uploaded payloads must be validated rather than blindly parsed. Authentication is not part of the app's model, so two boundaries carry the security posture between them and a change can weaken either:

- **`@local_only`** decides *who may call what*. It returns 403 under `SERVER_MODE`, and the matching UI is hidden via `getServerConfig()`. When adding endpoints, sockets, or data flows, decide consciously whether they're safe under `SERVER_MODE`, and gate genuinely local-only features on **both** backend and frontend.
- **`ALLOWED_ORIGINS`** decides *which pages may call us at all*. Nothing is authenticated, and `@local_only` endpoints hand out SSH host, username, and local path metadata, so on a local install CORS is what stops a page served from another localhost port reading it. It defaults to the narrowest set that still works, and the same allowlist gates the socket.io handshake (`build_socketio_origin_check`) because sockets carry the same instance-scoped data. Don't widen it for convenience.

See [CONVENTIONS.md](./CONVENTIONS.md#trust-boundaries) for what each boundary does and does not cover — in particular, the app derives its own origin from the request only for hosts that can only mean this machine (an IP address, `localhost`, or the `--host` it was launched with), so a proxied hostname needs configuring; and the allowlist governs which *other* origins may talk to us, not what a socket event may reveal, so emits still need scoping to their own instance.

## Python environment

- Use **[uv](https://docs.astral.sh/uv/)** to manage Python versions and dependencies. The pinned version is in [`.python-version`](.python-version) (currently 3.10.16); run `uv python install` to install it, then `uv sync` to create `.venv` and install the project editable.
- Supported versions are Python 3.10–3.14 (`requires-python` in `pyproject.toml`).
- Run backend commands via **`uv run`** (e.g. `uv run python -m ttnn_visualizer.app` or `pnpm run flask:start`).

Backend package layout lives under `backend/`; `uv sync` makes `ttnn_visualizer` importable without `PYTHONPATH`.

## Architecture (high level)

- **Flask** exposes APIs, file/sync plumbing, and gateway-style behavior.
- **React** (Vite-built SPA under `src/`) holds **most product and visualization logic**. Backend changes are often thin routes, proxies, or services—not a second copy of report semantics.

If you mainly work in Python, you still benefit from knowing that many behaviors live in the frontend; for UI-only issues, prefer `src/` and API contracts over growing Flask-only business rules.

## HTTP API conventions

- **Instance scoping:** Report-backed routes (operations, tensors, buffers, metadata, stack-trace, etc.) expect **`instanceId` as a query parameter**. The React app’s `axiosInstance` injects it on every request from session storage / URL; paths do not embed instance IDs.
- **`/api/remote` subtree:** Remote SSH flows are grouped under **`/api/remote/...`**. Canonical names include `POST /api/remote/profiler-reports`, `POST /api/remote/performance-reports`, `POST /api/remote/test`, `POST /api/remote/sync`, `POST /api/remote/use`, and `GET /api/remote/ssh-config-hosts`.
- **GET vs POST:** Read-only requests that take no SSH connection material use **GET** — the stack trace file checks **`GET /api/remote/stack-trace/test`** and **`GET /api/remote/stack-trace/read`** with `?filePath=...`, and **`GET /api/remote/ssh-config-hosts`**, which reads the local `~/.ssh/config` and takes no parameters at all (never a caller-supplied path). **POST** is used where the body carries SSH connection material (folder listing, sync, use, test).

## Running the app from a development checkout

Prerequisites: **Node** + **pnpm** (see `package.json` `engines`) and an activated **Python virtual environment**.

- **`FLASK_ENV=development`** (or unset) — frontend dev. Run **`pnpm dev`** (Vite, hot reload) and **`pnpm flask:start-debug`** in parallel.
- **`FLASK_ENV=production`** — Flask serves the built SPA. Run **`pnpm build`** after frontend changes, then `pnpm flask:start-debug`. Suits Python-focused developers who rarely touch the UI.

## Code quality and linting

### Backend

All **Python** code in this project should satisfy **Black**, **isort**, and **mypy** as configured here. The exact `pnpm` wrappers live in **`package.json`** (for example `flask:lint`, `flask:format`, `flask:mypy`); use those scripts so flags and paths stay consistent with CI.

### Frontend

`tsconfig*`, **ESLint**, **Stylelint**, and **Prettier** are the source of truth for TypeScript/React and stylesheet work (`.css`, `.scss`, `.sass`). Match the style already in the file you're editing and keep typing strict. Don't add lint suppressions unless explicitly requested — assess whether the warning is right first (it usually is). Format only the code you touched; don't reformat unrelated paths. All frontend changes should pass **`pnpm lint`** (`pnpm lint:fix` for auto-fixes).

### SPDX

New source files need a valid SPDX header in the project format with the **current year**. Validate with **`pnpm lint:spdx`**. Don't bump the year when editing existing files.

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
- In component-local SCSS, prefer app-owned classnames over direct `.bp6-*` selector overrides; reserve Blueprint-wide overrides for `src/scss/_blueprintjs.scss`.
- Use **`@use`**, never `@import` (deprecated by Sass, already migrated). `as *` for tokens meant to be ergonomic at call sites (colour variables); a short namespace for everything else (`variables.$base-font`).
- **Partials carry a leading underscore, component stylesheets don't.** Shared partials, definitions, and mixins live in `src/scss/` as `_base.scss` / `definitions/_colours.scss` / `mixins/_scrollShade.scss`; component sheets live in `src/scss/components/` and are **PascalCase** matching their component (`OperationDetailsComponent.scss`).
- Import stylesheets through the **`styles/`** alias (`import 'styles/components/SearchField.scss'`), which maps 1:1 to `src/scss/`, rather than relative `../scss/...`. The alias is wired in `tsconfig.json`, `vite.config.ts`, and `vitest.config.ts` — all three must stay in sync.

### Lint discipline

- Pre-existing lints in code you didn't touch are not yours to fix in unrelated PRs. Surface them if they matter; don't sprawl scope.
- Lint suppressions (`// eslint-disable-next-line ...`, `# type: ignore`, etc.) require an explanatory comment on the same or preceding line.
- When a lint warning looks wrong, assess its **validity** before reaching for a suppression. Many warnings point at a real latent issue worth fixing properly (e.g. ref-read-in-render warnings often signal a stable-singleton pattern that could be expressed more cleanly).

### Testing

- Frontend: **Vitest** + `@testing-library/react` (`pnpm test`).
- Backend: **pytest** with `caplog`, `tmp_path`, and the shared **`client`** fixture (Flask's `app.test_client()`, defined in `backend/ttnn_visualizer/tests/conftest.py`) for endpoint tests. A fixture that builds its own app takes its settings from **`base_test_settings`** (`tests/fixture_settings.py`) rather than a hand-rolled dict — `test_every_app_under_test_is_built_from_the_shared_baseline` enforces it.
- Frontend tests live in **`tests/` at the repo root**, not co-located with source. Use **`.spec.ts`** for non-React tests and **`.spec.tsx`** when the test renders JSX — never `.test.ts(x)`. Shared harnesses go in `tests/helpers/`, JSON fixtures in `tests/data/`.
- Backend: pass parameters via **`client.get(url, query_string={...})`** — don't string-concatenate URLs, which drifts and produces empty-string params the backend then has to disambiguate from `None`.
- When mocking, **patch where the symbol is bound** (the consumer module, e.g. `ttnn_visualizer.views.read_stack_source_local`), not where it's defined. A patch that "isn't taking" is almost always pointing at the source module.
- For larger test suites — characterisation tests, refactor regressions — build **shared fixture helpers** (see `tests/mlirFixtures/builders.ts`) and **cross-cutting invariant checks** (see `tests/mlirFixtures/invariants.ts`) instead of repeating ad-hoc setup.

### Canvas and rendering performance

Applies on touch to views that draw data-proportional visuals (NPE chip cluster and timeline). Each rule's failure mode is spelled out in [CONVENTIONS.md](./CONVENTIONS.md#canvas-and-rendering-performance) — they are all correctness bugs, not just slow paths.

- **Downsample to at most one column per *device* pixel, summarised with a `max`** — never one rect or DOM node per datum when the data outnumbers the pixels. A mean or last-wins reduction hides spikes. Keep the reduction pure and separate from colour mapping (`src/functions/reduceToColumns.ts`).
- **Cap the raster scale** (`MAX_BACKING_SCALE`). Backing stores grow with the square of `devicePixelRatio` × on-screen scale; uncapped, elements render blank rather than slow.
- **High-frequency feedback gets its own layer, never state.** Move hover markers and playheads imperatively via a ref or in CSS; prefer a positioned element to a second canvas for a single line. Cache `getBoundingClientRect()` for hit-testing with a bounded lifetime.
- **`memo()` makes prop stability a contract.** Every prop is a primitive, a `useCallback`-stable handler, or a memoized value — no inline lambdas or fresh literals from callers. Prefer a shared frozen constant to `?? []`, and narrow handler props to the narrowest signature that works.
- Derive an ancestor's effective scale by **measuring the element**, not by threading its zoom down as a prop.

### Frontend data integrity

- Prefer **client-side JSON validation** for user-uploaded JSON before the backend parses it. Surface validation errors with a friendly UI message rather than a 5xx round-trip. Use `try { JSON.parse(...) } catch (e) { ... }` and shape-check predicates.

### Upload security

- All **single-file** upload handlers must apply `Path(filename).name` to the user-supplied filename before composing a destination path, and carry a regression test that submits a crafted traversal filename and asserts where the file lands. `.name` is not a full cross-platform sanitiser — backslash and drive-letter forms survive it — and the **folder-upload** branch uses a resolved-path containment check instead, not this collapse. Both caveats: [CONVENTIONS.md](./CONVENTIONS.md#upload-security).

### Toolchain and package management

- **pnpm** is the only supported frontend package manager (`engines.pnpm >= 11`). Don't `npm install` or `yarn add`.
- The Node version is pinned via **`.nvmrc`**. Use `nvm use` from the repo root; `corepack` handles pnpm shimming automatically on Node 16+.

### Database schema changes

- New columns on existing tables go via **Alembic migrations**, not ad-hoc `ALTER TABLE`. The app declares `alembic` in `pyproject.toml` and runs migrations on startup.
- When adding a column referenced by ORM models, declare it `nullable=True` (or with a default) so existing databases don't break before migrations apply.

### State management (Jotai)

- Shared atoms live under **`src/store/`**, end with the `Atom` suffix (`activeProfilerReportAtom`), and are declared in **`src/store/app.ts`** under the section comment matching their feature area. Components and hooks consume atoms — they never declare one inline. An atom co-located elsewhere to break a circular import (e.g. `store/fileTransferRegistry.ts`) is **re-exported from `app.ts`**, and call sites import from `app.ts` — the co-located module is an implementation detail, not a second public API.
- Prefer **`useAtomValue`** for read-only consumers and **`useSetAtom`** for write-only consumers; use **`useAtom`** when a component both reads and writes the same atom. Don't subscribe via `useAtom` if you only need one half of the tuple.
- Use **`atomWithStorage`** from `jotai/utils` for user-preference flags that need to survive reloads — never reach for `localStorage` directly.
- **Key persisted data by a shared identity helper, not by a display name.** Storage keys, React list keys, and `isSame*` comparisons all derive from one exported helper (e.g. **`remoteConnectionKey`**, `src/functions/remoteConnection.ts`) so the key and the equality check can't disagree — names aren't unique. Changing a key's shape is a migration: add a read fallback for the old shape. See [CONVENTIONS.md](./CONVENTIONS.md#key-persisted-data-by-a-shared-identity-helper-not-by-a-display-name).

### Network layer

- **Use `axiosInstance` (`src/libs/axiosInstance.ts`) for every HTTP request; never `axios.get/post/put/delete/patch/head` at a call site.** The shared instance carries the request interceptor that injects `instanceId` and the response interceptor that retries the operations endpoint when a large payload comes back as a string — bypassing it loses both. Importing *types and helpers* from `axios` (`AxiosError`, `HttpStatusCode`, `AxiosProgressEvent`, `axios.isAxiosError`) at a call site is fine and idiomatic.
- **Cross-cutting retries belong in the interceptor, not in a `queryFn`.** Extend the interceptor so every consumer of the endpoint benefits.
- **One module-scope `socket`** in `src/libs/SocketProvider.tsx` — StrictMode remounts would otherwise double the listeners. Pair every `socket.on(name)` with a matching `socket.off(name)` in the effect cleanup, in the same change; don't add a second `io(...)` anywhere.
- Two documented exceptions compose their URL by hand because neither goes through axios: the socket connection URL, and the unload beacon in `recordUsage.ts`. Both are described in [CONVENTIONS.md](./CONVENTIONS.md#network-layer) — don't add a third without the same treatment.

### Data fetching (React Query)

- Type every hook as **`useQuery<Data, AxiosError>`** — don't let the error parameter fall back to `unknown`. Call sites depend on `AxiosError` shape (e.g. `error?.status === HttpStatusCode.UnprocessableEntity`).
- Query keys are tuples of `['kebab-string-name', ...reactiveDeps]` (e.g. `['fetch-all-buffers', bufferType, activeProfilerReport?.path]`). Report-bound queries use `staleTime: Infinity`. Keys that need invalidation from another module are exported as `*_QUERY_KEY` constants.
- Report-bound query keys must include the active report's identity — typically **`activeProfilerReport?.path`** or **`activePerformanceReport?.path`** — because operation ids reset per report, so a key without it serves stale payloads across reports. See #1674.
- **Anything deciding whether two reports describe the same run reads `useLinkedPerformanceReport()`, never `usePerformanceReport()`.** The latter keys on the performance tab's view filters, so a view toggle would move the answer; the former pins them. Build both keys through `performanceReportQueryKey.ts` rather than assembling a key inline. See #1812.
- **A derived value read by several hooks *and* by one component instance per virtualised row goes through `memoiseLatest`, not `useMemo`.** Row fanout is what makes the trade pay; a value with few consumers and no per-row reader stays on `useMemo`. Every argument must come from a source all consumers share (a query result, not a per-caller `useMemo`), results are shared so treat them as immutable, and pair any `queryClient.clear()` with `clearReportCaches`. Why each constraint: [CONVENTIONS.md](./CONVENTIONS.md#share-derived-values-with-memoiselatest-not-usememo).

### Errors and toasts

- Funnel error-string extraction through **`getResponseError(error, fallback?)`** (`src/functions/getResponseError.ts`). Don't reach into `error.response.data.error` ad-hoc — the helper handles AxiosError, Error, and string fallbacks consistently.
- Emit toasts via **`createToastNotification(message, fileName, ToastType.X)`** (`src/functions/createToastNotification.tsx`; `ToastType` lives in `src/definitions/ToastType.ts`). Don't import `toast` from `react-toastify` directly in components. The `<ToastContainer>` is mounted once in `Layout.tsx`.

### Usage recording (frontend)

`src/functions/recordUsage.ts` posts local usage events to `POST /api/usage`. Four invariants a reader cannot infer from the code alone — all detailed, with the caps table and the route's deliberate decorator stack, in [CONVENTIONS.md](./CONVENTIONS.md#usage-recording-frontend):

- **`usage.py` owns the vocabulary; `src/definitions/UsageEvent.ts` is a copy.** Change both sides in one commit: a divergence is silent at runtime, and `backend/ttnn_visualizer/tests/test_usage_frontend_parity.py` is the only thing that notices.
- **`MAX_BUFFERED_EVENTS` must equal `MAX_USAGE_BATCH_EVENTS`**, which bounds write atomicity rather than merely an HTTP body.
- **The unload beacon must send a `Blob` typed `application/json`** — that content type is what keeps the request non-simple, and a bare-string beacon goes as `text/plain` and is refused.
- **Failures are silent and batches are never re-buffered.** The only diagnostic is a `console.warn` under `import.meta.env.DEV` carrying the status, never a response body.

### File organization and modules

- **`src/definitions/`** holds *primitives*: enums, route/endpoint maps, plot/colour configs, plain interfaces. **`src/model/`** holds richer domain types — usually API response shapes, sometimes classes with methods. If it mirrors a backend response, it's a model. Apply this split for **new code and files you touch**; older domain-shaped types still under `definitions/` migrate on-touch (see CONVENTIONS.md Known inconsistencies).
- **`src/routes/`** holds page components and React Router wiring (`routeObjectList.tsx`). Path *strings* stay in `definitions/Routes.ts` (`ROUTES`); route *config* and page modules live under `routes/`.
- **New routes add an entry to `routeObjectList`** (plus a matching `RouteRequirements` entry if the page needs an active report) — `main.tsx` consumes that list and nothing else, so don't hardcode routes into `createBrowserRouter` separately. `stripFirstSlash` bridges `ROUTES`' absolute paths to React Router's relative children.
- **Page titles go through `react-helmet-async`:** `Layout.tsx` declares `titleTemplate='%s | TT-NN Visualizer'` once and each route mounts its own `<Helmet title='…' />`. `HelmetProvider` is mounted once in `src/main.tsx` — don't add a second provider or override the template per page.
- URL endpoints are centralized in the **`Endpoints` enum** (`src/definitions/Endpoints.ts`); routes in the **`ROUTES` frozen const** (`src/definitions/Routes.ts`). Never inline a URL string in a component.
- Test IDs are centralized in **`TEST_IDS`** (`src/definitions/TestIds.ts`, `Object.freeze`'d) and referenced from both component `data-testid` attributes and test queries. No hardcoded test-id strings.
- General value formatters (`toReadableShape`, `formatDuration`, `stripEnum`, etc.) live in **`src/functions/formatting.ts`**. Add new pure formatters there instead of redefining ad-hoc helpers inside feature modules.

### Naming

- Function-name prefixes carry meaning. Match them when you add new functions:

  | Prefix | Purpose |
  |---|---|
  | `use*` | React hook (must follow rules of hooks) |
  | `handle*` | Event handler bound to a UI event |
  | `get*` | Pure accessor or formatter |
  | `is*`, `has*` | Boolean predicate |
  | `fetch*` | Async axios wrapper returning `Promise<T>` |

- **Prefer named constants over magic strings or numbers.** Promote semantic literals — user-visible copy, status keys, thresholds, durations, retry counts, storage keys — to **`SCREAMING_SNAKE_CASE`** at module scope; `const` for module-private, exported from `src/definitions/` when shared. The bar is "could a reviewer guess *why* this value, not just *what*?". Self-evident arithmetic and one-shot constructor arguments stay inline. Colour and shared layout literals follow the stricter [CSS / SCSS](#css--scss) rules instead. Worked examples: [CONVENTIONS.md](./CONVENTIONS.md#prefer-named-constants-over-magic-strings-or-numbers).
- **Prefer an enum when constants belong to a related set** — status values, mode kinds, error codes, toast types — declared in `src/definitions/` (or the owning module) rather than a bag of independent consts. **String-valued** when the value crosses a serialisation boundary (JSON, URL params, storage keys, backend comparisons); numeric only for purely internal sets. Every call site uses the member, never the underlying literal. **Members are `SCREAMING_SNAKE_CASE`** — older PascalCase enums exist, new code doesn't copy them. Rationale: [CONVENTIONS.md](./CONVENTIONS.md#prefer-an-enum-for-a-related-set-of-constants).
- **Name `Map`/`Record` accumulators after the relation they encode** — pattern `valueByKey` (`deviceTimeByOpId`, `aggregatesByOpId`, `operationNamesById`). Don't use bare `map`, `obj`, or `result` outside a trivially short scope.
- Backend module-private helpers prefix with a single underscore (e.g. `_file_path_from_stack_source_request`).

### Backend conventions

- Module-level logger: **`logger = logging.getLogger(__name__)`** at the top of every backend module that logs. Use `logger.info/warning/error/exception`, never `print`. Prefer `logger.exception(...)` inside an `except` branch over `logger.error(str(e))` — it captures the stack trace.
- **One module-scope `api = Blueprint("api", __name__)`** in `views.py`, mounted at `{BASE_PATH}api`, so route definitions use bare paths (`/operations`, not `/api/operations`). Don't add a second blueprint sharing the same prefix — that creates silent registration-order bugs. Cross-route helpers stay in `views.py` with a leading underscore.
- Prefer **`Response(orjson.dumps(payload), mimetype="application/json")`** for read-mostly endpoints: much faster than `jsonify`'s stdlib `json`, handles `bytes`/`datetime`/`Enum`, and supports **`orjson.Fragment(...)`** for splicing already-serialised JSON (how `serializers.py` streams `captured_graph` without a parse/re-dump round trip). `jsonify` is still fine for tiny payloads — don't mix the two inside one endpoint.
- View decorator stack order: **`@api.route → @with_instance → @timer`**. Use **`@local_only`** to gate endpoints that must refuse `SERVER_MODE` (uploads, local-only flows); it returns 403 automatically.
- Raise the **domain exceptions in `exceptions.py`** rather than `raise Exception("...")` — there's an existing class for almost every case (`RemoteConnectionException`, `AuthenticationFailedException`, `DataFormatError`, `InvalidReportPath`, `InvalidProfilerPath`, `DatabaseFileNotFoundException`, `RemoteFileReadException`).
- Error responses go through the helpers in `backend/ttnn_visualizer/exceptions.py`: **`response_bad_request / response_not_found / response_forbidden / response_unprocessable_entity / response_internal_server_error`**. Don't hand-roll `jsonify({...}), 400`. Use **`StatusMessage`** (Pydantic) when the response needs to carry a `ConnectionTestStates` status alongside the message (uploads, sync, connection-test endpoints).
- Env-var booleans go through **`_parse_env_bool("FOO", False)`** in `settings.py`, or **`str_to_bool`** elsewhere (query params, `devtools/`) — never `bool(os.getenv(...))`, which is truthy for `"false"`. **`parse_bool` owns the vocabulary** (`true`/`1`/`false`/`0` only); never re-declare those tokens at a call site, and treat widening the set as a change to the SPA's `isFlagEnabled` and the perf-report query params too.
- **`settings.py` has traps worth reading before you touch it** — all of them in [CONVENTIONS.md](./CONVENTIONS.md#env-var-booleans-go-through-_parse_env_bool--str_to_bool). In short: `SERVER_MODE` is in `_STRICT_BOOLEANS` and *refuses to start* on a value it can't read; `DEBUG` is fed by `FLASK_DEBUG` via `_ENV_ALIASES` and forced off under `SERVER_MODE`; `override_with_env_variables` skips everything in `_ENV_OVERRIDE_SKIP`, so put new derivations in `recompute_derived_settings()`, not at a call site; and `USAGE_RECORDING_DISABLED` deliberately **obeys** an unrecognised value rather than keeping the default (`_is_recording_disabled_by_environment`, `usage.py`) — don't "fix" it back to `str_to_bool`.
- **Adding a setting means classifying it twice**, and a test fails until you do each: into `_OVERRIDABLE_SETTINGS` or one of the skip sets, and — if overridable — as pinned or inherited for the test fixtures. See #1869.
