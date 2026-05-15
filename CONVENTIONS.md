<!--
SPDX-License-Identifier: Apache-2.0

SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
-->

# Code style and conventions (full reference)

Companion to [`AGENTS.md`](./AGENTS.md). `AGENTS.md` states each convention in one line; this document expands every rule with **rationale, file/line examples, and counter-examples**.

> **Maintenance contract.** When you discover or introduce a convention worth codifying, add it to **both** files — `AGENTS.md` gets the one-liner so agents/contributors scanning the entry point catch it; this doc gets the detail so reviewers and humans can dig in. Don't add a rule to one without the other.

## Table of contents

- [Comments](#comments)
- [TypeScript](#typescript)
- [CSS / SCSS](#css--scss)
- [State management (Jotai)](#state-management-jotai)
- [Data fetching (React Query)](#data-fetching-react-query)
- [Errors and toasts](#errors-and-toasts)
- [File organization and modules](#file-organization-and-modules)
- [Naming](#naming)
- [Lint discipline](#lint-discipline)
- [Testing](#testing)
- [Frontend data integrity](#frontend-data-integrity)
- [Upload security](#upload-security)
- [Toolchain and package management](#toolchain-and-package-management)
- [Database schema changes](#database-schema-changes)
- [Backend conventions](#backend-conventions)
- [Known inconsistencies](#known-inconsistencies)

---

## Comments

### Comments must explain *why*, not *what*

**Rationale.** Code already says what it does. Comments earn their keep by surfacing intent, trade-offs, or non-obvious constraints. Narration creates maintenance debt: when the code changes, narration goes stale and starts lying.

**Good.** The comment surfaces a constraint not visible from the code:

```src/hooks/useAPI.tsx:76:78
 * Mutates the passed array in place for performance — these arrays can be
 * very large and are consumed immediately by the hooks below.
 */
```

**Don't.** Comments that restate the code:

```ts
// Increment counter
counter++;

// Return the result
return result;
```

### Preserve placeholder `//` lines in literals

Some array/object literals have empty `//` lines deliberately inserted between elements to prevent auto-formatters (Prettier in particular) from collapsing the literal onto a single line. They look pointless — they're not. Don't strip them.

```ts
const items = [
    'a', //
    'b', //
    'c', //
];
```

### Stale comments are bugs

If you change behaviour, update or delete the comment. Reviewers will flag stale comments as blockers.

---

## TypeScript

### Prefer named enums over string-literal unions when the union has semantic meaning

```ts
enum NodeRelation {
    Input = 'input',
    Output = 'output',
}
```

Used in `src/components/OperationGraphComponent.tsx` after refactoring from `'input' | 'output' | null`. Enums are searchable, autocompletable, and rename-safe. **One-off booleans/flags** (`'asc' | 'desc'` on a single call site) don't need promotion to enums.

### Spell out generic type parameters on third-party containers

```ts
const dataset = new DataSet<OperationNode>(initial);
const cache = new Map<string, Buffer>();
```

When using `DataSet<T>` from `vis-network`, `Map<K, V>`, or a similar container, write the type parameter. Letting inference quietly widen to `any`/`unknown` is the single most common source of latent typing bugs we hit.

### Respect `react-hooks/exhaustive-deps`

If you genuinely need to omit a dependency, leave a one-line comment explaining why the missing dep is stable enough to skip:

```ts
useEffect(() => {
    // networkRef is set once on mount and never reassigned
    networkRef.current?.fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

### `interface ComponentNameProps` for component props

Default to `interface` for component props, declared immediately above the component. The `Props` suffix is required.

```tsx
interface SearchFieldProps {
    placeholder: string;
    onSearch: (term: string) => void;
}

export default function SearchField({ placeholder, onSearch }: SearchFieldProps) { … }
```

Reserve `type` for unions, generic-constrained mappings, and `Omit`/`Pick` derivations:

```ts
type ToastVariant = 'info' | 'success' | 'warning' | 'error';
type PartialBuffer = Omit<Buffer, 'pages'> & { pageCount: number };
```

---

## CSS / SCSS

### No hex literals in TS/TSX

**Rationale.** Hardcoded colours can't be themed, can't be reused across components without copy-paste, and drift over time.

**The flow:**

1. Define the CSS custom property in `src/scss/_base.scss`:

   ```scss
   --graph-focused-node: #f6bc42;
   ```

2. Expose it via `GRAPH_COLORS` in `src/definitions/GraphColors.tsx` using the `cssVar()` helper:

   ```ts
   export const GRAPH_COLORS = {
       focusedNode: cssVar('--graph-focused-node'),
       // …
   };
   ```

3. Import from `GRAPH_COLORS` in components — never literal `'#f6bc42'`.

### Same rule for magic layout numbers

If a pixel value, threshold, or duration is used in more than one place, promote it to an SCSS variable or CSS custom property. One-off literals at a single call site are fine.

---

## State management (Jotai)

### All shared atoms live in `src/store/app.ts`

The file is organized into commented sections (`// App state`, `// Reports`, `// Operations route`, etc.) — add new atoms to the section that matches their feature area. **Components don't declare module-scope atoms.** If you need component-local state, use `useState`.

### Atom names end with `Atom`

Every export in `src/store/app.ts` follows this:

```src/store/app.ts:40:48
export const activeProfilerReportAtom = atom<ReportFolder | null>(null);
export const operationRangeAtom = atom<NumberRange | null>(null);
export const selectedOperationRangeAtom = atom<NumberRange | null>(null);
export const performanceReportLocationAtom = atom<ReportLocation | null>(null);
export const activePerformanceReportAtom = atom<ReportFolder | null>(null);
export const performanceRangeAtom = atom<NumberRange | null>(null);
export const selectedPerformanceRangeAtom = atom<NumberRange | null>(null);
export const activeNpeOpTraceAtom = atom<string | null>(null);
export const activeMlirJsonAtom = atom<string | null>(null);
```

The suffix makes atoms grep-friendly and visually distinct from plain values at call sites.

### Prefer `useAtomValue` for read-only consumers

If a component reads an atom but never sets it, use `useAtomValue` — don't destructure off `useAtom` and ignore the setter. It documents intent and avoids over-subscription in larger trees.

```ts
import { useAtomValue, useSetAtom } from 'jotai';

const activeReport = useAtomValue(activeProfilerReportAtom);  // read-only
const setActive = useSetAtom(activeProfilerReportAtom);        // write-only
const [report, setReport] = useAtom(activeProfilerReportAtom); // read+write
```

### Use `atomWithStorage` for persistent user preferences

UI toggles and view preferences that should survive a reload go through `atomWithStorage`, not raw `localStorage`/`sessionStorage`. Examples currently in the store:

```src/store/app.ts:34:36
export const showHexAtom = atomWithStorage('showHex', false); // Used in Buffers and Operation Details
export const showMemoryRegionsAtom = atomWithStorage('showMemoryRegions', true); // Used in Buffers and Operation Details
export const renderMemoryLayoutAtom = atomWithStorage('renderMemoryLayout', false); // Used in Buffers and Operation Details
```

The first argument is the storage key — pick something stable; renaming it later orphans existing users' settings.

---

## Data fetching (React Query)

### Every hook is typed `useQuery<Data, AxiosError>`

Don't let the error parameter fall back to `unknown`. Call sites depend on `AxiosError` shape — most commonly `error?.status === HttpStatusCode.UnprocessableEntity`.

```src/hooks/useAPI.tsx:244:247
return useQuery<Buffer[], AxiosError>({
    queryFn: () => fetchAllBuffersData(bufferType),
    queryKey: ['fetch-all-buffers', bufferType, activeProfilerReport?.path],
    staleTime: Infinity,
```

### Query keys are tuples of `['kebab-string-name', ...reactiveDeps]`

The first element is the human-readable name, then every reactive value the query depends on. Re-used keys (invalidated from another module) are exported as `*_QUERY_KEY` constants.

```src/hooks/useAPI.tsx:325:328
queryKey: ['get-operation-buffers', operationId],
```

### `staleTime: Infinity` for report-bound queries

If the underlying data only changes when the user loads a different report (i.e. `activeProfilerReportAtom` shifts), use `staleTime: Infinity` — that pins React Query and avoids unnecessary background refetches on focus/network reconnect.

Time-bound or session-bound queries use a finite value:

```src/hooks/useAPI.tsx:497:499
queryKey: ['fetch-npe', fileName],
…
staleTime: 30000,
```

### `enabled` to gate dependent queries

When a query depends on another query's result (e.g. only fetch detail when a list returned an ID), set `enabled` rather than throwing in `queryFn`:

```ts
return useQuery({
    queryFn: () => fetchMLIRJson(),
    queryKey: ['fetch-mlir-json', fileName],
    enabled: fileName !== null,
});
```

---

## Errors and toasts

### Funnel error-string extraction through `getResponseError`

The helper in `src/functions/getResponseError.ts` handles `AxiosError` (looking for `{ error: string }` in `error.response.data`), plain `Error` instances, raw strings, and an optional fallback. Don't reach into `error.response.data.error` inline at the call site.

```ts
import getResponseError from '../functions/getResponseError';

try {
    await mutation();
} catch (err) {
    const message = getResponseError(err, 'Upload failed');
    setStatus(message);
}
```

### Emit toasts via `createToastNotification`

`src/functions/createToastNotification.tsx` is the single entry point. It wraps `react-toastify`'s `toast` with the `ToastFileChange` template the rest of the app uses, and it delegates to `toast[type](...)` so the same call site can produce info/success/warning/error toasts.

```ts
import createToastNotification, { ToastType } from '../functions/createToastNotification';

createToastNotification('MLIR', file.name, ToastType.SUCCESS);
```

**Don't.** Importing `toast` from `react-toastify` directly in a component creates two parallel toast pipelines and breaks the visual contract. The `<ToastContainer>` is mounted once in `Layout.tsx`.

---

## File organization and modules

### `src/definitions/` vs `src/model/`

- **`src/definitions/`** holds *primitives* — enums, route/endpoint maps, plot/colour configs, plain interfaces with no behaviour. Examples: `Endpoints.ts`, `Routes.ts`, `TestIds.ts`, `GraphColors.tsx`, `BufferSummary.ts`.
- **`src/model/`** holds *domain types* — API response shapes (often interfaces that mirror a backend model), sometimes classes with methods. Examples: `APIData.ts`, `BufferType.ts`, `MLIRJsonModel.ts`, `NPEModel.ts`, `ClusterModel.ts`.

Rule of thumb: **if it mirrors a backend response, it's a model.** If it's a constant, mapping, or enum used purely on the frontend, it's a definition.

### Centralize URLs in `Endpoints`

API URLs live in the `Endpoints` enum:

```src/definitions/Endpoints.ts:5:26
enum Endpoints {
    BUFFER = '/api/buffer',
    BUFFERS_LIST = '/api/buffers',
    BUFFER_PAGES = '/api/buffer-pages',
    // …
}
```

Never inline a string URL in a component or hook. New endpoints get a new enum entry first.

### Centralize routes in `ROUTES`

Frontend route paths live in `src/definitions/Routes.ts` (a `Object.freeze`'d const). Same logic as endpoints — never hardcode `'/operations'` in a `<Link>` or a `useNavigate(...)` call.

### Centralize test IDs in `TEST_IDS`

`src/definitions/TestIds.ts` exports a frozen `TEST_IDS` const. Components reference it from their `data-testid={TEST_IDS.something}` attribute; tests reference it from their `getByTestId(TEST_IDS.something)` calls. No hardcoded test-id strings on either side — that's how test brittleness creeps in.

---

## Naming

### Function-name prefixes carry meaning

| Prefix | Purpose | Example |
|---|---|---|
| `use*` | React hook (must follow rules of hooks) | `useReportMetadata`, `useMLIR` |
| `handle*` | Event handler bound to a UI event | `handleFileChange`, `handleNodeClick` |
| `get*` | Pure accessor or formatter | `getResponseError`, `getNodeRelationToFocused` |
| `is*`, `has*` | Boolean predicate | `isDeviceOperation`, `hasClusterDescriptionAtom` |
| `fetch*` | Async axios wrapper returning `Promise<T>` | `fetchInstance`, `fetchBufferPages` |

```src/hooks/useAPI.tsx:108:116
export const fetchInstance = async (): Promise<Instance | null> => {
    const response = await axiosInstance.get<Instance>(Endpoints.INSTANCE);
    return response?.data ?? null;
};

export const updateInstance = async (payload: Partial<Instance>): Promise<Instance | null> => {
    const response = await axiosInstance.put<Instance>(Endpoints.INSTANCE, payload);
    return response?.data ?? null;
};
```

If you find yourself mixing prefixes (e.g. `getUserData` doing an `await fetch(...)`), the prefix is wrong — rename to `fetchUserData`.

### Top-level constants are `SCREAMING_SNAKE_CASE`

```ts
const DEFAULT_ERROR_MESSAGE = 'An unexpected error occurred';
const MAX_RETRIES = 3;
export const EMPTY_PERF_RETURN = { report: [], stacked_report: [], signposts: [] };
```

### Backend module-private helpers prefix with a single underscore

```python
def _file_path_from_stack_source_request(stack_trace: str) -> Path:
    ...
```

The underscore signals "not part of this module's public API" and excludes the function from `from foo import *` semantics.

---

## Lint discipline

### Pre-existing lints are not yours to fix in unrelated PRs

If you find a long-standing lint warning while touching code nearby, surface it (in PR description or a follow-up issue) — don't sprawl the diff. Reviewers will reject scope creep faster than they'll reject the lint.

### Suppressions require an explanatory comment

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processLegacyPayload(payload: any) { … }
```

```python
# type: ignore[attr-defined]  # SQLAlchemy 2.x typing gap, fixed in next major
result = query.first()
```

If you can't articulate why the suppression is correct, you don't yet understand the warning.

### Assess validity before suppressing

ESLint warnings often point at a real latent issue. Example: a `react-hooks/refs-in-render` warning on a `useMemo` that reads `someRef.current` looked spurious — turns out the cleanest fix was promoting the ref to a `useMemo` that holds the value directly, which also removed a `useEffect` and made the intent explicit. The lint was right; the suppression would have hidden it.

---

## Testing

### Frontend: Vitest + `@testing-library/react`

Run with `pnpm test`. Test files live next to the source as `*.spec.ts` / `*.spec.tsx`, or in `tests/` for cross-cutting fixtures and characterisation suites.

### Backend: pytest + the shared `client` fixture

The Flask test client (`app.test_client()`) is exposed as the `client` fixture in `backend/ttnn_visualizer/tests/conftest.py:50`. Use it directly:

```python
def test_local_upload_rejects_non_json(client, tmp_path):
    response = client.post(
        "/local/upload/mlir",
        data={"files": (BytesIO(b"hello"), "evil.exe")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 200
    assert response.get_json()["status"] == "FAILED"
```

Use `caplog` for log assertions, `tmp_path` for filesystem-touching tests. Don't construct a raw `werkzeug.test.Client` — go through the Flask wrapper so the app context and request hooks fire correctly.

### Build shared fixture helpers for large test suites

When a suite (characterisation tests, refactor regressions) needs more than a couple of common setups, factor them into a `tests/<feature>Fixtures/` module rather than copy-pasting. Pattern in the repo:

- `tests/mlirFixtures/builders.ts` — primitive builders (nodes, edges, cliques, chains)
- `tests/mlirFixtures/scenarios.ts` — curated graph scenarios stitched together from builders
- `tests/mlirFixtures/invariants.ts` — cross-cutting invariants (e.g. "every edge endpoint resolves to a known node")

Tests then look like `expect(graphInvariantHolds(result, NODE_HAS_UNIQUE_ID)).toBe(true)` instead of repeating the same loop in every spec.

---

## Frontend data integrity

### Validate user-uploaded JSON on the client

If the user uploads a file the app parses as JSON, validate it on the frontend before letting the backend round-trip a 5xx. Cheaper, faster, and the error UI can be friendlier.

```ts
const fetchMLIRJson = async (): Promise<GraphBundle> => {
    const response = await axiosInstance.get<GraphBundle>(Endpoints.MLIR);
    try {
        JSON.stringify(response.data); // shape-check sentinel
    } catch (e) {
        throw new AxiosError(
            'MLIR JSON is malformed',
            HttpStatusCode.UnprocessableEntity.toString(),
        );
    }
    return response.data;
};
```

Pair `try { JSON.parse(...) } catch (e) { ... }` with shape-check predicates (`if (!Array.isArray(data.nodes)) ...`) when the data has known structure. Surface a friendly toast or callout rather than a stack trace.

---

## Upload security

### Apply `Path(filename).name` at the boundary

`werkzeug.FileStorage.filename` is client-controlled and can contain `../`, absolute paths, backslashes, or platform-specific separators. **Treat it as untrusted input.**

```python
from pathlib import Path

prefixed_filename = f"{prefix}{Path(file.filename).name}"
dest_path = Path(target_directory) / prefixed_filename
```

`Path(...).name` collapses `'../../etc/passwd'` to `'passwd'` and strips drive letters / absolute prefixes — surgical, cheap, no dependencies. Add a regression test that submits a crafted traversal filename and asserts the file lands inside the intended directory.

### Guard `file.filename` is non-empty before validating extension

```python
for file in files:
    if not file.filename or not file.filename.endswith(".json"):
        return StatusMessage(
            status=ConnectionTestStates.FAILED,
            message="Upload requires a valid .json file",
        ).model_dump()
```

`file.filename` is typed `str | None`. Calling `.endswith()` on `None` raises `AttributeError` and surfaces as a 500.

### Guard against empty `files` list

```python
files = request.files.getlist("files")
if not files:
    return response_bad_request("No files provided")
```

Without the guard, downstream `files[0]` indexing or empty-collection iteration falls over silently or with an opaque error.

> **Note:** the rules above cover **single-file** uploads (NPE, MLIR, future single-blob endpoints). **Folder-upload** branches (profiler/performance report trees) deliberately preserve subpath structure and need a different fix shape — a resolved-path containment check (`dest.resolve().is_relative_to(target.resolve())`). That hardening is tracked separately; ask before extending the `.name` pattern into folder uploads.

---

## Toolchain and package management

### pnpm is the only supported frontend package manager

`engines.pnpm` is set to `">=11"` in `package.json`. Don't use `npm install` or `yarn add` — the lockfile is pnpm-format and will diverge.

### Node version is pinned via `.nvmrc`

Use `nvm use` from the repo root. On Node 16+, `corepack` handles pnpm shimming automatically; if `pnpm` isn't available after a fresh `nvm install`, run `corepack prepare pnpm@<version> --activate`.

### Python: managed via a `venv` at the repo root

Backend tooling (`black`, `isort`, `mypy`, `pytest`, `alembic`) is run from the project's Python environment. Don't install globally.

---

## Database schema changes

### New columns go through Alembic migrations

Migrations live in `backend/ttnn_visualizer/alembic/versions/`. The app declares `alembic~=1.18.0` in `pyproject.toml` and runs migrations on startup (`run_alembic_migrations` in `app.py`).

Don't add ad-hoc `ALTER TABLE` statements anywhere in app code. Don't add columns that exist only as SQLAlchemy `Column(...)` declarations without a matching migration — existing databases won't have the column and queries will blow up.

### New columns must be nullable or have a default

```python
class Instance(db.Model):
    mlir_path = Column(String, nullable=True)  # ✅ existing DBs survive until migration runs
```

```python
class Instance(db.Model):
    mlir_path = Column(String, nullable=False)  # ❌ existing DBs break before migration applies
```

---

## Backend conventions

### Module-level logger at the top of every backend module

```python
import logging

logger = logging.getLogger(__name__)
```

Use `logger.info / warning / error / exception` — never `print`. `logger.exception(...)` automatically captures the stack trace in the `except` branch and should be preferred over `logger.error(str(e))`.

### View decorator stack order

```python
@api.route("/local/upload/mlir", methods=["POST"])
@local_only
@with_instance
@timer
def create_mlir_file(instance):
    ...
```

- `@api.route` outermost (Flask registers the URL).
- `@local_only` (from `decorators.py:147`) gates endpoints that must refuse `SERVER_MODE` — aborts with 403 automatically.
- `@with_instance` (from `decorators.py:26`) resolves the `instanceId` query param into an `instance` kwarg and updates the session's report list.
- `@timer` innermost — wraps just the view body for timing.

### Error responses go through helpers, not hand-rolled `jsonify`

`backend/ttnn_visualizer/exceptions.py` exposes:

```python
def response_bad_request(message: Optional[str] = None, detail: Optional[str] = None): …
def response_not_found(message: Optional[str] = None, detail: Optional[str] = None): …
def response_forbidden(message: Optional[str] = None, detail: Optional[str] = None): …
def response_unprocessable_entity(message: Optional[str] = None, detail: Optional[str] = None): …
def response_internal_server_error(message: Optional[str] = None, detail: Optional[str] = None): …
```

All five funnel through `error_response(...)` which produces a consistent `{"error": "...", "detail": "..."}` shape. Don't hand-roll `return jsonify({"error": "..."}), 400` — `getResponseError` on the frontend will fall back to a generic message because the shape diverges.

### `StatusMessage` for operational responses

Upload, sync, and connection-test endpoints return a Pydantic `StatusMessage` that carries a `ConnectionTestStates` status alongside the message. The frontend reads `response.data.status` to drive UI state machines (`PROGRESS` → `OK`/`FAILED`/`WARNING`). Use it whenever the response is consumed by a `ConnectionTestStates`-aware UI; use `response_*` helpers for everything else.

### Env-var booleans go through `str_to_bool`

```python
SERVER_MODE = str_to_bool(os.getenv("SERVER_MODE", "false"))
```

`bool(os.getenv("SERVER_MODE", "false"))` is **truthy** for the string `"false"` — a common foot-gun. The `str_to_bool` helper accepts the usual `"true"/"false"/"1"/"0"/"yes"/"no"` set.

### Domain exceptions live in `exceptions.py`

When raising or catching application errors, use the dedicated classes:

- `RemoteConnectionException` and `AuthenticationFailedException` for SSH-flavoured failures (they carry HTTP status as a property).
- `DataFormatError`, `InvalidReportPath`, `InvalidProfilerPath` for content/structure problems.
- `NoReportsException`, `DatabaseFileNotFoundException`, `RemoteFileReadException` for specific not-found cases.

Don't `raise Exception("...")` — there's an existing class for almost every case.

---

## Known inconsistencies

These exist in the codebase today and don't yet have a single canonical answer. Reviewers should flag new code that goes either direction without considering both:

- **Folder-upload sanitization.** Single-file uploads sanitize filenames via `Path(...).name`; folder uploads preserve subpaths and need a resolved-path containment check instead. The latter isn't yet implemented (tracked as a follow-up).
- **`extract_npe_name` is a misnomer.** It's used by both NPE and MLIR upload handlers. Rename to `extract_uploaded_name` is tracked as a follow-up; don't perpetuate the NPE-specific name in new helpers.
- **`errorMessage` vs `statusMessage` in file loaders.** `MlirJsonFileLoader.tsx` and `NPEFileLoader.tsx` overload a state field called `errorMessage` with both success and failure text. A rename to `statusMessage` is pending.
- **Upload size cap.** No `MAX_CONTENT_LENGTH` is set on the Flask app; large uploads succeed until they exhaust memory. Tracked as a separate hardening task.
- **Default-export vs named-export of components.** The codebase mixes `export default function Foo()` and `export function Foo()`. Components are predominantly default-exported; hooks and utility functions are predominantly named-exported. Mirror the file you're editing.
- **`React.FC` is not used.** Components are typed via the props parameter (`function Foo({ x }: FooProps)`) rather than `React.FC<FooProps>`. Continue this style — `React.FC` has known foot-guns (implicit `children`, etc.) and the codebase has actively moved away from it.
