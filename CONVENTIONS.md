<!--
SPDX-License-Identifier: Apache-2.0

SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
-->

# Code style and conventions (full reference)

Companion to [`AGENTS.md`](./AGENTS.md). `AGENTS.md` states each convention in one line; this document expands every rule with **rationale, file/line examples, and counter-examples**.

> **Maintenance contract.** When you discover or introduce a convention worth codifying, add it to **both** files — `AGENTS.md` gets the one-liner so agents/contributors scanning the entry point catch it; this doc gets the detail so reviewers and humans can dig in. Don't add a rule to one without the other.

## Table of contents

- [SPDX headers](#spdx-headers)
- [Comments](#comments)
- [TypeScript](#typescript)
- [CSS / SCSS](#css--scss)
- [State management (Jotai)](#state-management-jotai)
- [Network layer](#network-layer)
- [Data fetching (React Query)](#data-fetching-react-query)
- [Errors and toasts](#errors-and-toasts)
- [Usage recording (frontend)](#usage-recording-frontend)
- [File organization and modules](#file-organization-and-modules)
- [Routing and page metadata](#routing-and-page-metadata)
- [Naming](#naming)
- [Lint discipline](#lint-discipline)
- [Testing](#testing)
- [Canvas and rendering performance](#canvas-and-rendering-performance)
- [Frontend data integrity](#frontend-data-integrity)
- [Trust boundaries](#trust-boundaries)
- [Upload security](#upload-security)
- [Toolchain and package management](#toolchain-and-package-management)
- [Database schema changes](#database-schema-changes)
- [Backend conventions](#backend-conventions)
- [Known inconsistencies](#known-inconsistencies)

---

## SPDX headers

### Every source file carries an SPDX header in the project format

`pnpm lint:spdx` (`scripts/check-spdx.mjs`) validates `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, `.scss`, `.xml`, and `.py` files for a header comment; `package.json` is a separate single-file check on its `license` + `author` fields. Everything else (markdown, YAML, TOML, other JSON) is skipped. Missing or malformed headers on covered files fail CI.

The brand string is **`Tenstorrent AI ULC`** and the licence is **`Apache-2.0`**. Two accepted comment styles, keyed on file extension:

```ts
// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
```

```python
# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
```

### The year is the file's creation year, not the edit year

New files take the current year. Don't bump the year when editing existing files.

---

## Comments

### Comments must explain *why*, not *what*

**Rationale.** Code already says what it does. Comments earn their keep by surfacing intent, trade-offs, or non-obvious constraints. Narration creates maintenance debt: when the code changes, narration goes stale and starts lying.

**Good.** The comment surfaces a constraint not visible from the code:

`src/hooks/useAPI.tsx`

```tsx
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

Declared in `src/definitions/NodeRelation.ts` after refactoring from `'input' | 'output' | null`. Enums are searchable, autocompletable, and rename-safe. **One-off booleans/flags** (`'asc' | 'desc'` on a single call site) don't need promotion to enums.

### Spell out generic type parameters on third-party containers

```ts
const dataset = new DataSet<OperationNode>(initial);
const cache = new Map<string, Buffer>();
```

When using `DataSet<T>` from `vis-data` (paired with `Edge`/`Node`/`Network` from `vis-network` — see `src/components/operation-details/DeviceOperationsGraphComponent.tsx`), `Map<K, V>`, or a similar container, write the type parameter. Letting inference quietly widen to `any`/`unknown` is the single most common source of latent typing bugs we hit.

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

### Don't use `React.FC` / `FC` for component typing

`React.FC` is deprecated by the React team and the codebase has standardised on typing props on the function signature instead. ESLint bans `FC`, `React.FC`, `FunctionComponent`, and `React.FunctionComponent` via `no-restricted-syntax` in `eslint.config.cjs`.

```tsx
interface SocketProviderProps {
    children: ReactNode;
}

export const SocketProvider = ({ children }: SocketProviderProps) => { … };

// Don't
const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => { … };
```

Components that accept element children declare `children: ReactNode` (or `children?: ReactNode`) on `*Props` — don't wrap the interface in `PropsWithChildren` just to satisfy `React.FC`. Reserve `type` for unions, generic-constrained mappings, and `Omit`/`Pick` derivations:

```ts
type ToastVariant = 'info' | 'success' | 'warning' | 'error';
type PartialBuffer = Omit<Buffer, 'pages'> & { pageCount: number };
```

### Prefer `null` over `undefined` for intentional absence

Use **`null`** when you mean “no value yet” or “cleared” in values you own: React state, refs you initialise, return types from helpers, and fields that round-trip through JSON (JSON has `null`, not `undefined`). Prefer `T | null` and default to `null` rather than mixing `| null | undefined` without reason.

**Don't fight the platform.** Optional properties (`prop?: string`), rest/spread omissions, and many library types still use `undefined` — that is fine. Do not coerce every `undefined` from `axios` or the DOM into `null` at boundaries unless it removes real confusion.

---

## CSS / SCSS

### No hex literals in TS/TSX

**Rationale.** Hardcoded colours can't be themed, can't be reused across components without copy-paste, and drift over time.

**The flow:**

1. Define the CSS custom property in `src/scss/_base.scss`:

   ```scss
   --graph-focused-node: #f6bc42;
   ```

2. Expose it via `GRAPH_COLORS` in `src/definitions/GraphColors.ts` using the `cssVar()` helper:

   ```ts
   export const GRAPH_COLORS = {
       focusedNode: cssVar('--graph-focused-node'),
       // …
   };
   ```

3. Import from `GRAPH_COLORS` in components — never literal `'#f6bc42'`.

#### Read on use when the value is needed before the stylesheet is guaranteed to have applied

`GRAPH_COLORS` is an object literal, so its `cssVar()` calls resolve **once, at module evaluation**. That is fine for a value first read during a user interaction, but a module imported before the stylesheet applies captures empty strings for good.

Where that risk is real, expose a **getter** instead of a property and keep everything else about the flow — `getPerfChartChrome()` in `src/definitions/PlotConfigurations.ts` is the reference: the properties still live in `_base.scss`, components still never see a literal, but each call re-reads.

```ts
export const getPerfChartChrome = (): PerfChartChrome => ({
    line: cssVar('--perf-chart-line'),
    // …
});
```

Prefer `GRAPH_COLORS` by default; reach for a getter only when import-time evaluation is a genuine hazard, and say so in a docstring, because the repeat `getComputedStyle` read is not free — call it once per render pass, not per element.

### Same rule for magic layout numbers

If a pixel value, threshold, or duration is used in more than one place, promote it to an SCSS variable or CSS custom property. One-off literals at a single call site are fine.

### `@use`, not `@import`; namespace what needs disambiguation

**Rationale.** Sass deprecated `@import` and the codebase has already migrated. `@use` requires explicit handling of name collisions; the convention is `as *` for tokens we want ergonomic at call sites (colour variables, `$tt-grey-2`) and a short namespace for everything else (`variables.$base-font`).

`src/scss/_base.scss`

```scss
@use 'definitions/colours' as *;
@use 'definitions/variables' as variables;
```

### SCSS file naming mirrors Sass partial conventions; component sheets are PascalCase

- **Partials** (intended to be `@use`d, never compiled standalone) carry a leading underscore: `_base.scss`, `_common.scss`, `_layout.scss`, `_blueprintjs.scss`. All live in `src/scss/`.
- **Component stylesheets** in `src/scss/components/` are **PascalCase** matching their owning React component: `LoadingSpinner.scss`, `MainNavigation.scss`, `OperationDetailsComponent.scss`. No leading underscore — these are compiled top-level when their component imports them.
- **Definition partials** (`src/scss/definitions/_colours.scss`, `_variables.scss`) carry the leading underscore.
- **Mixin partials** (`src/scss/mixins/_perfReportColours.scss`, `_scrollShade.scss`) carry the leading underscore.

Don't mix the two: a new component stylesheet doesn't need an underscore, and a new shared partial does.

### Prefer app-owned classnames over direct Blueprint selector overrides

In component stylesheets, prefer styling classes we own (for example wrapper or element classes) rather than targeting Blueprint internals like `.bp6-menu-item`, `.bp6-button`, etc.

- Preferred: add a project classname in TSX and style that classname.
- Avoid by default in new or touched component-local SCSS: direct `.bp6-*` overrides.
- Exception: global Blueprint theming/normalisation in `src/scss/_blueprintjs.scss` when there is no stable app-owned hook.

This keeps styles resilient to Blueprint markup changes and avoids cross-component side effects.

### Stylesheet imports go through the `styles/` alias

The `styles/` alias is wired up in three places that must stay in sync — `tsconfig.json`, `vite.config.ts`, and `vitest.config.ts`. Relative paths still resolve, but they drift when files move and look noisy in long import blocks.

`src/components/SearchField.tsx`

```tsx
import { IconNames } from '@blueprintjs/icons';
import 'styles/components/SearchField.scss';
import classNames from 'classnames';
```

The alias resolves `styles/` to `src/scss/` so the path inside the import maps 1:1 to the path under `src/scss/`. New stylesheets go under `src/scss/components/MyComponent.scss` and are imported as `'styles/components/MyComponent.scss'`. Prefer this form over relative `../scss/...` imports so paths stay stable when files move.

---

## State management (Jotai)

### Shared atoms live under `src/store/`

Prefer declaring atoms in **`src/store/app.ts`**, organized into commented sections (`// App state`, `// Reports`, `// Operations route`, etc.) — add new atoms to the section that matches their feature area. **Components don't declare module-scope atoms.** If you need component-local state, use `useState`.

When atoms must be co-located with mutators in another `store/` module (e.g. `store/fileTransferRegistry.ts`, to avoid a circular import with `app.ts`), still **re-export the atoms and mutators from `app.ts`**. Call sites **import from `app.ts`**, not from the co-located module — that file exists only to break the cycle; it is not a second public API. Existing direct imports from `fileTransferRegistry` (and similar) are on-touch cleanup, not a pattern to copy.

### Atom names end with `Atom`

Every shared atom export follows this:

`src/store/app.ts`

```ts
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

### Prefer `useSetAtom` for write-only consumers

If a component only dispatches updates to an atom and never reads its value, use **`useSetAtom`** — don't write `const [, setX] = useAtom(xAtom)` or destructure a tuple you only use for the setter. Same benefits as `useAtomValue`: intent is obvious and you avoid subscribing the component to value changes it never reads.

```ts
import { useAtomValue, useSetAtom, useAtom } from 'jotai';

const activeReport = useAtomValue(activeProfilerReportAtom);  // read-only
const setActive = useSetAtom(activeProfilerReportAtom);        // write-only
const [report, setReport] = useAtom(activeProfilerReportAtom); // read+write
```

### Use `atomWithStorage` for persistent user preferences

UI toggles and view preferences that should survive a reload go through `atomWithStorage`, not raw `localStorage`/`sessionStorage`. Examples currently in the store:

`src/store/app.ts`

```ts
export const showHexAtom = atomWithStorage('showHex', false); // Used in Buffers and Operation Details
export const showMemoryRegionsAtom = atomWithStorage('showMemoryRegions', true); // Used in Buffers and Operation Details
export const renderMemoryLayoutAtom = atomWithStorage('renderMemoryLayout', false); // Used in Buffers and Operation Details
```

The first argument is the storage key — pick something stable; renaming it later orphans existing users' settings.

### Key persisted data by a shared identity helper, not by a display name

Preference flags get a fixed key, but data stored *per domain entity* needs a derived one, and the derivation belongs in a single exported helper next to the equality check it must agree with:

`src/functions/remoteConnection.ts`

```ts
export const isSameConnection = (a?: RemoteConnection | null, b?: RemoteConnection | null): boolean =>
    !!a && !!b && a.name === b.name && a.host === b.host && a.port === b.port;

export const remoteConnectionKey = (connection?: RemoteConnection | null): string =>
    connection ? `${connection.name}|${connection.host}|${connection.port}` : '';
```

**Rationale.** Every consumer that keys data by that entity must use the same helper — storage keys (`savedReportFoldersKey` in `src/hooks/useRemote.tsx`), React list keys, and `find`/`map` lookups alike. Two risks, both silent:

- **Keying on a display name.** Names aren't unique. A name-keyed cache lets two connections share a slot while `isSameConnection` counts them as distinct, so deleting or renaming one discards the other's data — the bug that moved these keys off `connection.name`.
- **A key that disagrees with the equality check.** If the key covers fewer fields than `isSame*` compares (or more), entities that compare equal land in different slots, or vice versa. Deriving both from adjacent helpers over the same fields keeps them honest; if you add a field to the identity, both change together.

**Changing a key's shape is a migration.** The key is a compatibility surface exactly like an `atomWithStorage` key. When the shape changes, existing entries become unreachable *and* orphaned — the delete path only ever targets the new shape, so they're never cleaned up. Add a one-time read fallback that looks up the old shape, re-writes under the new one, and deletes the stale entry, with a test that seeds an old-format key.

---

## Network layer

### Use `axiosInstance` for HTTP requests; never call raw `axios.get/post/put/delete` at a call site

**Rationale.** The shared instance in `src/libs/axiosInstance.ts` carries two interceptors every consumer depends on: a request interceptor that injects `instanceId` into query params, and a response interceptor that auto-retries the operations endpoint when a large payload comes back as a string instead of an array. Bypassing the instance means losing both.

**Scope.** This rule applies to **HTTP request methods** (`.get/.post/.put/.delete/.patch/.head`). Importing types and helpers from the `axios` package — `AxiosError`, `AxiosProgressEvent`, `AxiosRequestConfig`, `HttpStatusCode`, `axios.isAxiosError` — at a call site is fine and idiomatic; you'll see this pattern in `src/functions/getResponseError.ts`, `src/hooks/useRemote.tsx`, `src/hooks/useAPI.tsx`, and elsewhere. The thing to never do is `axios.get(url, ...)` at a call site — that bypasses the interceptors.

`src/libs/axiosInstance.ts`

```ts
const axiosInstance = axios.create({
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    baseURL,
});
```

`src/libs/axiosInstance.ts`

```ts
axiosInstance.interceptors.request.use(
    (config) => {
        const instanceId = getOrCreateInstanceId();

        if (instanceId) {
            // Add the instanceId to the query params
            config.params = {
                ...config.params,
                instanceId,
            };
        }

        return config;
    },
    …
);
```

### `instanceId` travels as a query parameter, never in the URL path

For HTTP API calls going through `axiosInstance`, the frontend never embeds the instance ID in the URL — it's set once by the request interceptor and read on the backend by `@with_instance` (`backend/ttnn_visualizer/decorators.py`) via `request.args.get("instanceId")`. Endpoints that take an `:id` path parameter mean something else (e.g. `/api/operations/<operation_id>` is an operation ID, not an instance ID).

**Don't.** Building a URL like `${Endpoints.OPERATIONS_LIST}/${instanceId}` collides with the operation-detail route shape and loses session scoping for every other call sharing the axios config.

**Documented exception.** The unload flush in `src/functions/recordUsage.ts` calls `navigator.sendBeacon` rather than `axiosInstance`, because a beacon is the only request the browser guarantees to send while the document is being discarded. It therefore gets neither interceptor, and composes `BASE_PATH` + `Endpoints.USAGE` by hand — deliberately without `instanceId`, since `POST /api/usage` is machine-scoped and takes no `@with_instance`. The body must be a `Blob` typed `application/json`: the route requires that content type so the request stays non-simple and a hostile origin needs a preflight `ALLOWED_ORIGINS` refuses, and a bare-string beacon is sent as `text/plain` and rejected.

**Documented exception.** The Socket.IO connection URL is built at module scope in `src/libs/SocketProvider.tsx` (`io(\`${BASE_PATH}?instanceId=${getOrCreateInstanceId()}\`)`) because `io(...)` doesn't go through axios and there's no interceptor to inject the param. The instance ID still travels as a `?instanceId=...` query string — just one assembled by hand rather than injected.

**Report-bound read errors.** Memory-profiler routes (`/api/operations`, `/api/tensors`, `/api/buffers`, …) open the instance's `profiler_path` via `LocalQueryRunner` (`backend/ttnn_visualizer/queries.py`); performance routes (`/api/performance/...`) open `performance_path` via `backend/ttnn_visualizer/csv_queries.py`. Status codes:

| Condition | HTTP | Body `error` |
|-----------|------|--------------|
| `instanceId` query param absent | **400** | `Missing required query parameter: instanceId` (`@with_instance`) |
| `instanceId` present, instance has no `profiler_path` | **404** | `No profiler report loaded for this instance` (`ProfilerReportNotLoadedException`) |
| `instanceId` present, instance has no `performance_path` | **404** | `No performance report loaded for this instance` (`PerformanceReportNotLoadedException`) |
| `profiler_path` set but `db.sqlite` missing on disk | **404** | `Database not found at path: <path>` (`DatabaseFileNotFoundException`) |

Arbitrary `instanceId` strings are valid tab identifiers — the server creates the row on first request — so `?instanceId=fake-instance-id` without a prior upload/sync gets **404**, not **400**.

Both `…NotLoadedException` classes inherit from `ReportNotLoadedException` and share one 404 handler in `app.py`; the body string lives on each subclass as `DEFAULT_MESSAGE` so call sites raise without a message argument. Helpers raise at the top of every path that touches a missing report path, so routes don't need a parallel `if not instance.<kind>_path` guard **when the helper is the next thing they call**.

Routes that **dereference `instance.<kind>_path` directly** before invoking a helper must keep an explicit `raise <Kind>ReportNotLoadedException()` at the top — otherwise mypy fails (`Path(None)`) and runtime crashes. NPE and MLIR routes do their own filesystem IO and still use per-route `response_not_found()` guards.

The `?name=` performance swap is no longer one of those cases: `views.py::_apply_requested_performance_name` owns the whole block — reading the query param, honouring the `SERVER_MODE` gate, collapsing the value through `sanitise_path_segment`, and raising when no report is loaded. `get_performance_results_report`, `get_performance_data_raw` and `get_performance_device_meta` call it rather than resolving a name themselves; new routes that accept `?name=` should do the same instead of rebuilding `Path(instance.performance_path).parent / name`.

### Cross-cutting retries belong in the interceptor, not in individual hooks

The operations endpoint occasionally returns a string instead of an array under heavy load. The response interceptor handles this with `MAX_RETRIES = 3` and exponential backoff (`src/libs/axiosInstance.ts`). Don't replicate retry logic inside a `queryFn` — extend the interceptor instead so every consumer of the endpoint benefits.

### The `socket` instance is module-scope in `SocketProvider`

**Rationale.** React StrictMode mounts then re-mounts components in development. A `socket = io(...)` call inside the provider's body (or even inside a `useState` initialiser) would re-open the connection on every mount, double the listeners, and surface as duplicate `fileTransferProgress` updates in dev. Module scope guarantees one connection per page load.

`src/libs/SocketProvider.tsx`

```tsx
const { BASE_PATH } = getServerConfig();

const socket = io(`${BASE_PATH}?instanceId=${getOrCreateInstanceId()}`);

const SocketContext = createContext<SocketContextType>(null);
```

Listeners live inside `useEffect`. The convention is to pair every `socket.on(name)` with a matching `socket.off(name)` in the cleanup so the singleton's listener list doesn't leak across mounts:

`src/libs/SocketProvider.tsx`

```tsx
return () => {
    // socket.offAny();
    socket.off('connect');
    socket.off('disconnect');
    socket.off('connect_error');
    socket.off('reconnect');
    socket.off('fileTransferProgress');
};
```

Adding a new event handler? Add the matching `off()` in the same change. Don't introduce a second `io(...)` call elsewhere in the codebase — the connection is shared.

---

## Data fetching (React Query)

### Every hook is typed `useQuery<Data, AxiosError>`

Don't let the error parameter fall back to `unknown`. Call sites depend on `AxiosError` shape — most commonly `error?.status === HttpStatusCode.UnprocessableEntity`.

`src/hooks/useAPI.tsx`

```tsx
return useQuery<Buffer[], AxiosError>({
    queryFn: () => fetchAllBuffersData(bufferType),
    queryKey: ['fetch-all-buffers', bufferType, activeProfilerReport?.path],
    staleTime: Infinity,
```

### Query keys are tuples of `['kebab-string-name', ...reactiveDeps]`

The first element is the human-readable name, then every reactive value the query depends on. Re-used keys (invalidated from another module) are exported as `*_QUERY_KEY` constants.

Report-bound queries must include the active report's identity in the key (typically `activeProfilerReport?.path` or `activePerformanceReport?.path`). Operation ids reset per report, so a key like `['get-operation-detail', operationId]` collides across reports and serves stale payloads when the same id is revisited under a different report. See #1674.

`src/hooks/useAPI.tsx`

```tsx
queryKey: ['get-operation-buffers', operationId, activeProfilerReport?.path],
```

### `staleTime: Infinity` for report-bound queries

If the underlying data only changes when the user loads a different report (i.e. `activeProfilerReportAtom` shifts), use `staleTime: Infinity` — that pins React Query and avoids unnecessary background refetches on focus/network reconnect.

Time-bound or session-bound queries use a finite value:

`src/hooks/useAPI.tsx`

```tsx
queryKey: ['fetch-npe', fileName],
…
staleTime: 30000,
```

### `enabled` to gate dependent queries

When a query depends on another query's result (e.g. only fetch detail when a list returned an ID), set `enabled` rather than throwing in `queryFn`:

```ts
return useQuery({
    queryFn: () => fetchOperationDetails(operationId),
    queryKey: ['get-operation-detail', operationId, activeProfilerReport?.path],
    enabled: operationId !== null,
});
```

### View-filtered and link-pinned performance reports are different queries

There are two hooks for the performance report, and picking the wrong one is a correctness bug rather than a style slip:

- **`usePerformanceReport(name)`** — the report as the performance tab is displaying it, with every view filter applied. For rendering the tab.
- **`useLinkedPerformanceReport()`** — the same report pinned to devices merged, host ops hidden, whole run, default grouping, tracing mode off. For *anything that decides whether two reports describe the same run*: the link badge, the perf-table Op column, L1-pressure columns, tensor-drawer gating, the graph perf overlay, top-N annotations.

Link status is a property of the reports, not of the current view. Resolving it from the filtered query means toggling **Merge devices** flips the badge to "Failed to link" and drops every dependent feature with it — and `ReportLinkStatus` persists that verdict to `localStorage`, so the failure outlives the toggle (#1812).

Build both keys through `src/functions/performanceReportQueryKey.ts` rather than assembling one inline, so the two cannot drift into keying on different filters. **Every** filter is pinned, so `getLinkedPerformanceReportParams()` takes no arguments — a view control that needs threading through it is a sign the call site wants `usePerformanceReport` instead.

`tracingMode` was the last carve-out, and it was removed on a mistaken premise: that a trace-captured run's traced order is the one that lines up with the memory report, so pinning it would make those pairs unlinkable. It doesn't reach the match. `tracingMode` only suppresses a `HOST START TS` sort in `tt-perf-report` (`perf_report.py:2168`), and because the link query pins `mergeDevices: true`, `merge_device_rows` always runs and ends by re-sorting on `ORIGINAL_ROW` — raw CSV order (`perf_report.py:1947-1949`). The merge re-sort overwrites the tracing branch, so for a single-device report the sequence is identical either way.

Two consequences worth knowing before touching this. Pinning `tracingMode` **adds** Tracing mode to the controls whose toggle forks the link query onto a second `perf-results/report` build for the session, so it makes #1886 more pressing, not less. And `merge_device_rows` pairs per-device queues positionally, so on a multi-device report a changed input order can still change which physical row represents a merged op — pinning makes that deterministic rather than eliminating it.

### Share derived values with `memoiseLatest`, not `useMemo`

`useMemo` caches per hook invocation. A derived value read by several hooks *and* by one component instance per virtualised row is therefore recomputed once per consumer, even though every consumer sees the same query data — an O(rows) match plus a flatMap, per row.

`src/functions/memoiseLatest.ts` is a module-level cache of one, keyed on reference-equal arguments:

`src/hooks/useAPI.tsx`

```ts
const getDeviceOperationListPerf = memoiseLatest(matchDeviceOperationsToPerf);

export const useGetDeviceOperationListPerf = () =>
    getDeviceOperationListPerf(deviceOperations, (data ?? EMPTY_PERF_RETURN).report, devices?.length ?? 0);
```

Three constraints come with it:

- **Every argument must come from a source all consumers share** — a query result, not a per-caller `useMemo`. A cache of one degrades to *no* cache when two live callers pass different arguments, and then hands each a fresh identity, invalidating every downstream `useMemo` keyed on the result. Note the `EMPTY_PERF_RETURN.report` fallback above rather than `data?.report ?? []`: a fresh `[]` per render would miss the cache every time.
- **Results are shared, so treat them as immutable.** Sorting or pushing in place corrupts every other consumer's view. Copy first (`useSortTable` does).
- **The cache outlives the query data.** Pair report teardown with the reset — `clearReportCaches(queryClient)` rather than a bare `queryClient.clear()` — or the previous report's rows stay reachable from module state for the lifetime of the page.

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
import createToastNotification from '../functions/createToastNotification';
import { ToastType } from '../definitions/ToastType';

createToastNotification('MLIR', file.name, ToastType.SUCCESS);
```

**Don't.** Importing `toast` from `react-toastify` directly in a component creates two parallel toast pipelines and breaks the visual contract. The `<ToastContainer>` is mounted once in `Layout.tsx`.

---

## Usage recording (frontend)

`src/functions/recordUsage.ts` buffers local usage events and posts them to `POST /api/usage`, which appends them to a log under the user's home directory (`backend/ttnn_visualizer/usage.py`). Nothing is transmitted off the machine. The invariants below are not visible from either side alone.

### `usage.py` owns the vocabulary; `src/definitions/UsageEvent.ts` is a copy

**Rationale.** Validation is server-side because a client cannot enforce it — anything `ALLOWED_ORIGINS` permits could post. The failure mode is silent: the route answers **422** for an event it can't parse and the client swallows it by design, so a divergence produces no runtime error anywhere.

`backend/ttnn_visualizer/tests/test_usage_frontend_parity.py` is the only thing that notices, and it pins more than the enums: the detail fields each client event declares, the route path, the `{ events }` envelope key, and that a full batch of the largest event still fits `MAX_USAGE_REQUEST_BYTES`. **Adding an event or a detail value means editing both files in one commit.**

### Three caps, and each pair has to stay consistent

| Constant | Where | What it bounds |
|---|---|---|
| `MAX_BUFFERED_EVENTS` | `src/functions/recordUsage.ts` | Events the client holds, and the size of a batch it builds |
| `MAX_USAGE_BATCH_EVENTS` | `backend/ttnn_visualizer/usage.py` | Lines one `os.write` in `_append_line` must hold — **write atomicity**, not an HTTP body |
| `MAX_USAGE_REQUEST_BYTES` | `backend/ttnn_visualizer/views.py` | Bytes one page may post per request (`request.max_content_length`) |

The first two **must be equal**, so a batch the client builds can never be refused wholesale; the third must fit a full batch of the largest event. The batch cap lives in `usage.py`, beside the atomicity guarantee it bounds — raising it in `views.py` alone would silently relax that guarantee, and `_write_events` enforces it so a second caller can't bypass the route.

### The unload beacon must send a `Blob` typed `application/json`

The route calls `request.get_json(silent=True)` **without** `force=True` on purpose: requiring `application/json` makes the request non-simple, so a hostile origin needs a preflight `ALLOWED_ORIGINS` refuses. A bare-string `sendBeacon` goes as `text/plain` and is rejected.

```ts
navigator.sendBeacon(getUsageEndpointUrl(), new Blob([body], { type: 'application/json' }));
```

**Don't** pass the JSON string directly — this is the one place a content type is a trust boundary rather than a formality (see [CORS is a trust boundary](#cors-is-a-trust-boundary-not-deployment-plumbing)). The beacon is also a documented exception to the [`axiosInstance` rule](#use-axiosinstance-for-http-requests-never-call-raw-axiosgetpostputdelete-at-a-call-site), composing `BASE_PATH` + `Endpoints.USAGE` by hand the way axios's `combineURLs` does so a non-root `BASE_PATH` still resolves.

### Failures are silent, and batches are never re-buffered

The endpoint answers **204** whether it wrote, whether recording is switched off locally, or whether the batch was dropped — so there is nothing to branch on and the client never backs off. A refused or unreachable endpoint therefore *drops* the batch: re-buffering would grow the buffer without bound for the life of the tab, and a malformed batch would be resubmitted forever. Overflow past `MAX_BUFFERED_EVENTS` is dropped for the same reason.

The only diagnostic is a `console.warn` under `import.meta.env.DEV` carrying **the status only** — never a response body, which would put server text back into a subsystem whose whole point is that it holds none. Warn from the rejection path as well as the success path: axios resolves only on 2xx, so a 422 never reaches `.then`.

### Recording stays off the render path

`recordUsage` costs a predicate and an array push and never flushes inline — these events instrument the NPE timeline and the performance table, where per-frame and per-row work is what the [canvas rules](#canvas-and-rendering-performance) exist to prevent. The scheduled flush bounds the request rate however fast a caller records, and `requestIdleCallback` is armed only *after* the coalescing window elapses: its `timeout` is an upper bound on the delay, not a lower one, so on a quiet tab each event would otherwise get its own request.

### The route's decorator stack is a deliberate exception

```python
@api.route("/usage", methods=["POST"])
@local_only
def record_usage_events():
```

No `@with_instance`, because the log is machine-scoped rather than report-scoped — an exception to the rule every report-backed route follows, not an omission to tidy up. No `@timer`, because the endpoint is called often by design. `@local_only` is the control that matters: nothing is authenticated, so the handler validates against a closed schema rather than trusting a permitted page not to write arbitrary lines into a file another team parses. Every event is validated before any is written, so a batch carrying one bad event appends nothing.

`initUsageRecording()` is called once, from `Layout`, rather than registering listeners at module scope — so importing the module has no side effect. Its teardown **drains** rather than discards, since it has already cancelled the pending flush.

---

## File organization and modules

### `src/definitions/` vs `src/model/`

- **`src/definitions/`** holds *primitives* — enums, route/endpoint maps, plot/colour configs, plain interfaces with no behaviour. Examples: `Endpoints.ts`, `Routes.ts`, `TestIds.ts`, `GraphColors.ts`, `BufferSummary.ts`, `TopNAnnotations.ts` (enums / labels / shared annotation result shapes).
- **`src/model/`** holds *domain types* — API response shapes (often interfaces that mirror a backend model), persisted app-domain records, sometimes classes with methods. Examples: `APIData.ts`, `BufferType.ts`, `MLIRJsonModel.ts`, `NPEModel.ts`, `ClusterModel.ts`, `MemoryConfig.ts`, `L1Pressure.ts`, `ReportLinks.ts` (`ReportLink` / `ReportLinkAccess`), `Signpost.ts`, `CoreCoord.ts`.

Rule of thumb: **if it mirrors a backend response (or a persisted domain record), it's a model.** If it's a constant, mapping, or enum used purely on the frontend, it's a definition.

**Scope.** This split is mandatory for **new modules and files you touch**. The tree still has older domain-shaped types under `definitions/` (e.g. parts of `PerfTable.ts`, `RemoteConnection.ts`, `MlirServer.ts`, `PlotConfigurations.ts`); migrate them when you edit those areas, don't treat every leftover as a reason to ignore the rule. See [Known inconsistencies](#known-inconsistencies).

### `src/routes/`

Page components and React Router configuration live under **`src/routes/`** (`Home.tsx`, `Operations.tsx`, `routeObjectList.tsx`, …). Absolute path strings stay in **`src/definitions/Routes.ts`** (`ROUTES`); `routeObjectList` maps those paths to page elements and `RouteRequirements`. Don't put page modules under `definitions/` or inline router trees in `main.tsx` outside `routeObjectList`.

### Centralize URLs in `Endpoints`

API URLs live in the `Endpoints` enum:

`src/definitions/Endpoints.ts`

```ts
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

## Routing and page metadata

### Frontend route definitions go through `routeObjectList`

`ROUTES` (`src/definitions/Routes.ts`) holds absolute paths so that `<Link to={ROUTES.OPERATIONS} />` reads naturally. React Router's nested-route children take **relative** paths, so `stripFirstSlash` in `src/routes/routeObjectList.tsx` bridges the two and keeps `ROUTES` as the single source of truth:

```tsx
export const routeObjectList = [
    { index: true, element: <Home /> },
    { path: stripFirstSlash(ROUTES.OPERATIONS), element: <Operations /> },
    { path: stripFirstSlash(`${ROUTES.OPERATIONS}/:operationId`), element: <OperationDetails /> },
    …
];
```

New routes add an entry to `routeObjectList` and (if they require an active report) a matching entry to `RouteRequirements` in the same file. `main.tsx` consumes `routeObjectList` and nothing else — don't hardcode routes into `createBrowserRouter` separately.

### Page titles via `react-helmet-async`; layout sets the template, routes set the title

`Layout.tsx` declares `titleTemplate='%s | TT-NN Visualizer'` once, and each route file mounts its own `<Helmet title='Operations' />`. `HelmetProvider` is mounted at the top of the tree in `src/main.tsx` — don't add a second provider or override `titleTemplate` at the page level.

---

## Naming

### Function-name prefixes carry meaning

| Prefix | Purpose | Example |
|---|---|---|
| `use*` | React hook (must follow rules of hooks) | `useReportMetadata`, `useNpe` |
| `handle*` | Event handler bound to a UI event | `handleFileChange`, `handleNodeClick` |
| `get*` | Pure accessor or formatter | `getResponseError`, `getNodeRelationToFocused` |
| `is*`, `has*` | Boolean predicate | `isDeviceOperation`, `hasClusterDescriptionAtom` |
| `fetch*` | Async axios wrapper returning `Promise<T>` | `fetchInstance`, `fetchBufferPages` |

`src/hooks/useAPI.tsx`

```tsx
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

### Prefer named constants over magic strings or numbers

Module-level constants use **`SCREAMING_SNAKE_CASE`** — declared at the outer scope of the file, not inside a function or block. Use `const` (no `export`) for module-private values; export shared constants from a sensible central place like `src/definitions/` (see [File organization](#file-organization-and-modules)) rather than ad-hoc from a leaf component.

Inline literals lose the *why*. `setTimeout(retry, 500)` and `if (status === 'started')` read as folklore. Once a literal has a name, reviewers can see intent without re-reading every call site, and shared values can't drift between reader and writer.

**Apply when the literal carries semantic meaning**, regardless of how many call sites it has:

- User-visible copy repeated in multiple places, or product-specific phrasing (`'Preparing transfer…'`, `'No files found'`).
- Status / mode / kind keys used in equality checks (`status === 'started'` → use the enum or a `STATUS_*` const).
- Thresholds, durations, retry counts, debounce/poll intervals, byte sizes (`MAX_RETRIES`, `ELAPSED_REFRESH_MS`).
- Storage keys, query keys, endpoint suffixes, header names — anything that needs to stay in lockstep across reader/writer (`'fetch-all-buffers'` is already exported as `*_QUERY_KEY`).
- The same literal in test setup and production code (promote, then import on both sides).

**Don't sprawl** to literals that are self-explanatory at the call site:

- Arithmetic plumbing (`arr.length - 1`, `index + 1`, `total > 0`, division by `100`, `Math.floor(x / 60)`).
- Array indices on a tuple whose shape is local (`[head] = pathParts`).
- Constructor arguments that are obvious in context (`new Date(0)`, `JSON.stringify(obj, null, 2)`).
- One-shot regex literals that are clearer inline than as a named const.

**Counter-example (don't):**

```tsx
setInterval(() => setNow(Date.now()), 1000);

if (retries < 3) {
    setTimeout(retry, 500);
}
```

**Good:**

```tsx
const ELAPSED_REFRESH_MS = 1000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 500;

setInterval(() => setNow(Date.now()), ELAPSED_REFRESH_MS);

if (retries < MAX_RETRIES) {
    setTimeout(retry, RETRY_BACKOFF_MS);
}
```

When the literal is a user-facing string that already has a canonical home — e.g. the status-keyed map in `src/functions/getFileStatusLabel.ts` — route the new copy through that helper instead of introducing a parallel `*_LABEL` const at the call site. The point is *one* source of truth, not just "anywhere but inline". Colour literals and shared layout values follow the stricter rules under [CSS / SCSS](#css--scss) (CSS custom property / SCSS variable, not a TS const).

### Prefer an enum for a related set of constants

When literals come in a *related set* — status values, mode kinds, validation states, toast types — collect them in an `enum` rather than scattering N independent `SCREAMING_SNAKE_CASE` consts. An enum buys things a bag of consts can't:

- **Exhaustive checks for free.** `Record<MLIRValidationError, { title: string }>` (`src/components/MlirProcessingStatus.tsx`) is a compile error the moment a new enum member is added without a label.
- **One canonical symbol.** Components compare `errorCode === MLIRValidationError.INVALID_JSON` against a single import instead of four sibling consts whose relationship has to be inferred by name.
- **Pairs with the type-side rule.** [Prefer named enums over string-literal unions](#prefer-named-enums-over-string-literal-unions-when-the-union-has-semantic-meaning) covers the *type* side (`'input' | 'output'` → `enum NodeRelation`); this rule covers the *runtime-value* side (`'idle' | 'progress' | 'ok' | 'failed' | 'warning'` literals scattered across modules → `enum ConnectionTestStates`).

**Apply when** the literals belong to one closed semantic set, are referenced from more than one module (equality checks, switches, object keys), or come from a backend response that the frontend wants compile-time confidence about handling exhaustively.

**Don't reach for an enum when** the values are independent constants that share nothing but a `const` keyword (`MAX_RETRIES`, `RETRY_BACKOFF_MS`, `ELAPSED_REFRESH_MS` — individually named, not bolted into a synthetic enum), or when the set is a TypeScript type union used only as a type — the [string-literal-union rule](#prefer-named-enums-over-string-literal-unions-when-the-union-has-semantic-meaning) handles that.

**Numeric vs string-valued.** Default to **string-valued** enums when the value crosses any serialisation boundary (logs, JSON, URL params, storage keys, backend-string comparisons). Numeric enums are reserved for purely internal sets. `ConnectionTestStates` (`src/definitions/ConnectionStatus.ts`) is the canonical numeric exception — `backend/ttnn_visualizer/tests/test_file_uploads.py` deliberately asserts on `ConnectionTestStates.FAILED.value` (i.e. `2`), so reordering members silently breaks the wire contract. New numeric enums need that kind of cross-stack lock-in to justify the choice.

**Good** (string-valued enum, used at every call site):

```ts
// src/definitions/ToastType.ts
export enum ToastType {
    INFO = 'info',
    SUCCESS = 'success',
    WARNING = 'warning',
    ERROR = 'error',
}

createToastNotification('MLIR', file.name, ToastType.SUCCESS);
```

**Don't** — never reintroduce the underlying value at a call site, even when the literal would compile:

```ts
createToastNotification('MLIR', file.name, 'success' as ToastType); // bypasses the enum
```

### Backend module-private helpers prefix with a single underscore

```python
def _file_path_from_stack_source_request(stack_trace: str) -> Path:
    ...
```

The underscore signals "not part of this module's public API" and excludes the function from `from foo import *` semantics.

This covers helpers in **test modules** too — `_documented_boolean_defaults` in `test_settings.py` — where the prefix also reads as "not a test case". Pytest fixtures are the exception: pytest resolves them by name from the test signature, so they stay unprefixed, as do `unittest` lifecycle methods (`setUp`, `tearDownClass`).

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

### Floating promises require an explicit `void` (or IIFE)

`@typescript-eslint/no-floating-promises` is configured as **error** with `ignoreVoid: true` and `ignoreIIFE: true`:

`eslint.config.cjs`

```js
'@typescript-eslint/no-floating-promises': [
    'error',
    {
        ignoreVoid: true,
        ignoreIIFE: true,
    },
],
```

Practically:

```ts
// ❌ Flagged — silent unhandled-rejection risk
queryClient.invalidateQueries({ queryKey: ['fetch-tensors'] });

// ✅ Acknowledged fire-and-forget
void queryClient.invalidateQueries({ queryKey: ['fetch-tensors'] });
```

The lint exists to surface "did you forget to `await`?" — when the answer is genuinely "no, this is intentionally background", the explicit `void` documents the intent so reviewers don't have to re-derive it.

### Pinned ESLint rules

#### `no-param-reassign` — allow mutating parameter properties

Airbnb-base enables `no-param-reassign` with `props: true` (forbids `fn(arg) { arg.foo = … }`). We override to `props: false` so in-place mutation of object properties on parameters remains allowed — common in axios interceptors, graph builders, and reduce-style accumulators passed by reference.

`eslint.config.cjs`

```js
'no-param-reassign': ['error', { props: false }], // overrides airbnb-base `props: true`
```

Reassigning the parameter binding itself (`arg = …`) is still an error. Only property writes on the parameter object are permitted.

#### `react/display-name` — off

`plugin:react/recommended` would error on anonymous components (e.g. `memo(...)`, Blueprint `ItemRenderer` factories). Full Airbnb (previously pulled in via erb) disabled this rule; we pin it off for the same reason. Named `function`/`const` components are still encouraged; this avoids noise on inline render callbacks that aren't exported.

```js
'react/display-name': 'off',
```

#### `react/no-danger` — warn

Flags `dangerouslySetInnerHTML` (XSS risk). Configured as **warn** so existing, reviewed suppressions stay valid under `--max-warnings 0`. New uses need a justification comment on the `eslint-disable-next-line`:

```tsx
// HTML tags are escaped by hljs
// eslint-disable-next-line react/no-danger
<code dangerouslySetInnerHTML={{ __html: highlighted }} />
```

See `StackTrace.tsx`, `SourceFileOverlay.tsx`, and `DeviceOperationsFullRender.tsx` for the established pattern. Prefer safer alternatives when hljs (or similar trusted escaping) isn't in play.

#### `.cjs` config files

`eslint.config.cjs` and `.stylelintrc.cjs` are linted via a dedicated flat-config block (`files: ['**/*.cjs']`) with CommonJS-appropriate rule relaxations (`@typescript-eslint/no-require-imports` off, etc.). CI includes changed `.cjs` files in the frontend lint step (`.github/workflows/lint-and-test.yml`).

---

## Testing

### Frontend: Vitest + `@testing-library/react`

Run with `pnpm test`. Tests live in `tests/` at the repo root — see [the dedicated subsection below](#frontend-tests-live-in-tests-at-the-repo-root-not-co-located-with-source) for the layout breakdown.

### Backend: pytest + the shared `client` fixture

The Flask test client (`app.test_client()`) is exposed as the `client` fixture in `backend/ttnn_visualizer/tests/conftest.py`. Routes are mounted under the **`{BASE_PATH}api`** prefix — `backend/ttnn_visualizer/app.py` registers the `api = Blueprint("api", __name__)` blueprint with `url_prefix=f"{app.config['BASE_PATH']}api"`. When `BASE_PATH` is `/` (the default in `conftest.app` and in single-tenant deployments) the effective prefix is `/api`; when `BASE_PATH` is something like `/visualizer/` the prefix becomes `/visualizer/api`. Tests run against `conftest.app` so `/api/...` is the right path in test URLs — just don't hard-code that assumption into production-facing docs or curl examples. Endpoints decorated with `@with_instance` require an `instanceId` query param — the `make_report` fixture returns one. Pass it through `query_string={...}` (see the dedicated subsection below).

Every fixture that builds an app starts from **`base_test_settings`** in `backend/ttnn_visualizer/tests/fixture_settings.py`, not from a hand-rolled dict. Three `conftest.app` defaults bite in particular:

- **`SERVER_MODE=True`** — `@local_only` handlers like `/api/remote/mlir/upload` return `403 Forbidden` until you override it.
- **`LOCAL_DATA_DIRECTORY` is a `str`** but production `settings.py` initialises it as a `Path` and handlers do `data_directory / config["MLIR_DIRECTORY_NAME"]`. Cast it to `Path` in the test so you exercise the same operand types as the deployed app.
- **The settings in `PINNED_ENV_SETTINGS` are pinned away from the environment**, `TT_METAL_HOME` among them. `DefaultConfig` reads them from the environment and `TT_METAL_HOME` is exported on any machine that profiles TT-Metal, so an unpinned fixture serves reports from a TT-Metal tree the test never created. A fixture that genuinely wants one passes it to `base_test_settings` explicitly — see `direct_mode_app` in `views/test_report_deletion.py`. Adding an overridable setting means classifying it: `test_the_test_fixtures_pin_every_env_reachable_setting` fails until you do. See #1869.

**Pinning a setting and unsetting its variable are not the same thing**, and the difference is easy to get backwards. `Config` is a process singleton whose class attributes bind at *import*, and `override_with_env_variables` skips any key whose variable is unset — so `monkeypatch.delenv` cannot un-bind an import-time value, and for anything reaching an app the only lever is `settings_override`, which `create_app` applies last. For a test that constructs a config itself, pick by how the value arrives: `delenv` when it comes through the override loop or a live descriptor, `monkeypatch.setattr(DefaultConfig, ...)` when the class body bound it, and **both** when either alone still reads the operator's value (`DEV_SERVER_HOST` in `test_settings.py`). Beware blanket env scrubbing in an autouse fixture: `test_the_documented_defaults_match_the_code_defaults` reads `os.environ` as *input* to decide what to skip, so deleting a variable turns that test red.

The first two overrides match the canonical pattern at `backend/ttnn_visualizer/tests/test_file_uploads.py`. A runnable example:

```python
def test_local_upload_rejects_invalid_extension(app, client, make_report):
    instance_id = make_report()
    app.config["SERVER_MODE"] = False
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])

    response = client.post(
        "/api/local/upload/npe",
        query_string={"instanceId": instance_id},
        data={"files": (BytesIO(b"hello"), "evil.exe")},
        content_type="multipart/form-data",
    )

    assert response.status_code == HTTPStatus.OK
    assert response.get_json()["status"] == ConnectionTestStates.FAILED.value
```

`StatusMessage.status` is a `ConnectionTestStates` enum (`FAILED` serialises as `2`). Use `caplog` for log assertions, `tmp_path` for filesystem-touching tests. Don't construct a raw `werkzeug.test.Client` — go through the Flask wrapper so the app context and request hooks fire correctly.

### Build shared fixture helpers for large test suites

When a suite (characterisation tests, refactor regressions) needs more than a couple of common setups, factor them into a `tests/<feature>Fixtures/` module rather than copy-pasting. Pattern in the repo:

- `tests/mlirFixtures/builders.ts` — primitive builders (nodes, edges, cliques, chains)
- `tests/mlirFixtures/scenarios.ts` — curated graph scenarios stitched together from builders
- `tests/mlirFixtures/invariants.ts` — cross-cutting invariants (e.g. "every edge endpoint resolves to a known node")

Tests then look like `expect(graphInvariantHolds(result, NODE_HAS_UNIQUE_ID)).toBe(true)` instead of repeating the same loop in every spec.

### Frontend tests live in `tests/` at the repo root, not co-located with source

**Rationale.** Vitest picks up both layouts, but the codebase has settled on a single location. Co-located `*.spec.ts` files would mean test scaffolding leaks into the source tree even when `noEmit` keeps it out of the build; centralising in `tests/` keeps the source tree focused on shipping code and makes fixtures shareable.

Layout:

- `tests/<name>.spec.ts(x)` — unit / integration tests, one per source unit.
- `tests/helpers/` — shared providers and harnesses (`TestProviders.tsx`, `atomProvider.tsx`, `queryClientProvider.tsx`, `getButtonWithText.tsx`).
- `tests/data/` — JSON fixtures.
- `tests/<feature>Fixtures/` — large characterisation-suite fixture modules.

Use `.spec.ts` for non-React tests, `.spec.tsx` for tests that render JSX. Don't use `.test.ts(x)` — wrong extension for this repo.

### Backend tests: use `client.get(url, query_string={...})` — don't string-concatenate URLs

`query_string=` is the Flask test-client idiom and survives encoding (commas, spaces, unicode) correctly. Manual concatenation drifts: `?foo=&bar=` produces empty-string params that the backend then has to disambiguate from `None`.

`backend/ttnn_visualizer/tests/views/test_remote_stack_source_routes.py`

```python
def test_stack_source_availability_requires_instance(client):
    response = client.get(
        "/api/remote/stack-trace/test", query_string={"filePath": "/some/path"}
    )
    assert response.status_code == HTTPStatus.NOT_FOUND
```

### When mocking, patch where the symbol is *bound*, not where it's defined

**Rationale.** `views.py` does `from ttnn_visualizer.stack_trace_source import read_stack_source_local` at module load. Patching `ttnn_visualizer.stack_trace_source.read_stack_source_local` after that import has happened replaces the *defining* module's binding — but `views.py` already captured its own reference, so the view code calls the real function. Always patch the consumer's namespace.

`backend/ttnn_visualizer/tests/views/test_remote_stack_source_routes.py`

```python
def test_stack_source_content_local_read_sets_no_store(app, client, make_report):
    instance_id = make_report()
    app.config["SERVER_MODE"] = False
    with patch(
        "ttnn_visualizer.views.read_stack_source_local",
        return_value=("print('hi')\n", "/abs/resolved.py", False),
    ):
        response = client.get(
            "/api/remote/stack-trace/read",
            query_string={"instanceId": instance_id, "filePath": "/any/path"},
        )
    assert response.status_code == HTTPStatus.OK
```

If a patch "isn't taking", the path is almost always pointing at the source module instead of the consumer.

---

## Canvas and rendering performance

Applies on touch, to views that draw data-proportional visuals (NPE chip cluster and
timeline today). The canonical examples are `src/components/npe/ChipCongestionCanvas.tsx`
and `src/components/npe/NPETimelineComponent.tsx`.

### Downsample time series to one column per device pixel

Never emit one rect (or one DOM node) per datum when the data outnumbers the pixels.
Reduce to at most one column per **device** pixel and summarise each column with a
**max**, not a mean or a last-wins write. Sub-pixel rects are not just wasted work —
they blend, so an isolated spike disappears, which for a congestion view is a
correctness bug. Keep the reduction pure and separate from colour mapping
(`src/functions/reduceToColumns.ts`) so a palette change doesn't rescan the series.

### Cap the raster scale

Backing stores scale with `devicePixelRatio × any on-screen scale`, and area grows
with the square. Clamp the linear scale (see `MAX_BACKING_SCALE`) — uncapped, a
multi-chip cluster under a zoom control can ask for hundreds of MB, at which point the
browser silently discards buffers and elements render blank rather than slow.

### High-frequency feedback goes on its own layer, never through state

Hover markers, playheads and similar per-pointer/per-tick visuals get a separate
element and are moved imperatively via a ref, or positioned in CSS. Routing pointer
position or scrub position through React state re-renders the owning view on every
event. Prefer a positioned element over a second canvas when the visual is a single
border or line — a full-size backing store buys nothing.

Cache `getBoundingClientRect()` for pointer hit-testing and invalidate it on
resize/scroll; reading it per `mousemove` forces a synchronous layout flush.

### `memo()` makes prop stability a contract

When a component is wrapped in `memo()`, every prop must be a primitive, a
`useCallback`-stable handler, or a memoized value — and callers must not pass inline
lambdas or fresh literals. Two consequences worth applying deliberately:

- Prefer a shared module-level frozen constant to `?? []` for an absent collection.
  A fresh literal gives every render a new identity and defeats the memo.
- Narrow handler props to the narrowest signature that works (`onEmptyCellClick: () => void`
  rather than a wide selection handler), so the only thing worth passing is already stable.

Derive an ancestor's effective scale by measuring the element rather than threading
the ancestor's zoom down as a prop — one source of truth, and it stays correct if the
ancestor is ever scaled by another mechanism.

---

## Frontend data integrity

### Validate user-uploaded JSON on the client

If the user uploads a file the app parses as JSON, validate it on the frontend before letting the backend round-trip a 5xx. Cheaper, faster, and the error UI can be friendlier. Pair `try { JSON.parse(...) } catch (e) { ... }` with shape-check predicates (`if (!Array.isArray(data.nodes)) ...`) when the data has known structure. Surface a friendly toast or callout rather than a stack trace.

### Convert client-side validation failures into a synthetic `AxiosError` with a real `HttpStatusCode`

Downstream route components key off `error?.status === HttpStatusCode.UnprocessableEntity` to drive validation-error UI. When the failure is a client-side `JSON.parse` of a fetched payload (e.g. the backend streams uploaded bytes without parsing them), throw a synthetic `AxiosError` with the right status so existing call sites still work:

```tsx
throw new AxiosError(
    'MLIR file is not valid JSON',
    AxiosError.ERR_BAD_RESPONSE,
    response.config,
    response.request,
    { ...response, status: HttpStatusCode.UnprocessableEntity },
);
```

Pass the original `response.config` and `response.request` (omitting them breaks callers that assume they exist), spread the response so type guards on the error shape still work (don't pass a fresh object), and use the numeric `HttpStatusCode` constant from `axios` — call sites compare with `===`.

---

## Trust boundaries

### `@local_only` and `ALLOWED_ORIGINS` are two separate boundaries

Nothing in the app is authenticated, so these two controls are what stand between a caller and the data. They answer different questions, and satisfying one says nothing about the other:

| Boundary | Question it answers | Failure mode if you get it wrong |
|---|---|---|
| `@local_only` (`backend/ttnn_visualizer/decorators.py`) | *Who may call what?* | A local-only flow (uploads, SSH sync, filesystem access) becomes reachable on the hosted, multi-user deployment |
| `ALLOWED_ORIGINS` (`backend/ttnn_visualizer/settings.py`) | *Which pages may call us at all?* | Any page in the user's browser can read SSH hosts, usernames, and local report paths off their local install |

A new endpoint needs a conscious decision on both. `@local_only` returns 403 automatically under `SERVER_MODE`, and the frontend must hide the matching UI via `getServerConfig()` — gating one side only leaves a feature that 403s in the UI or an endpoint anyone can reach.

### CORS is a trust boundary, not deployment plumbing

**Rationale.** `@local_only` endpoints are the *most* sensitive ones on a local install, not the least: they hand out `~/.ssh/config` host aliases, usernames, and local filesystem paths. Since there's no authentication, the only thing stopping a page served from another localhost port from reading that is the origin allowlist. `_build_allowed_origins` therefore defaults to the narrowest set that still works — `http://localhost:<PORT>`, plus the Vite dev server outside production — rather than to `*`. Note that this default names localhost regardless of what the app is bound to: a non-localhost binding works through the same-origin exemption below, not by appearing in the list, so a proxied hostname is a configuration step.

**The socket handshake needs the same allowlist, expressed as a callable.** Socket events carry the same instance-scoped report and file-transfer data as the HTTP API, so `socketio.init_app` is passed `build_socketio_origin_check(...)`. Pass a **callable**, never the bare list: engine.io treats `cors_allowed_origins == []` as *skip the origin check entirely*, so configuring `ALLOWED_ORIGINS=""` to trust nothing would widen the socket to every origin instead of narrowing it. A callable is always consulted.

**Self-derivation stops at hosts that can only mean this machine.** The app still has to talk to itself where the default allowlist can't name the origin in advance, so `_request_own_origins` derives one from the request's `Host`/`X-Forwarded-Host` — but only when `_names_this_machine` accepts it: any IP literal, `localhost`, or the address passed to `--host`. The distinction is what a same-origin claim can be forged from, since self-derivation only ever matches same-origin: DNS rebinding forges one for a *hostname* (a page on `attacker.example` points the name at 127.0.0.1, so its origin and its `Host` agree), but not for an address, because none is resolved. The socket is the exposed half — engine.io consults the origin at handshake while `flask_cors` merely withholds headers. Reaching the app under any other hostname, a proxy's included, is a configuration step (`ALLOWED_ORIGINS`); widening `_names_this_machine` to hostnames instead reopens the rebinding path.

**What the allowlist still does not cover.** It governs which **other** origins may talk to us, not what any given socket event may reveal. Scope emits to the owning instance's room (`emit_file_status`) rather than broadcasting, and treat an upstream that forwards client-supplied `X-Forwarded-*` headers as a separate concern from the origin check.

**Testing.** The origin check is a pure function and should be unit-tested as one (`backend/ttnn_visualizer/tests/test_settings.py`), but also assert the **wiring**: `socketio.test_client` never reaches engine.io's origin gate, so a regression to `"*"` passes a suite that only tests the builder. Check `socketio.server.eio.cors_allowed_origins` is the callable and that it rejects a foreign origin — engine.io owns the gate, so `socketio.Server` has no such attribute of its own. Cover the HTTP half too: `flask_cors` withholds the header rather than refusing the request, so assert an unlisted `Origin` gets no `Access-Control-Allow-Origin` back and a listed one does.

---

## Upload security

### Apply `Path(filename).name` at the boundary

`werkzeug.FileStorage.filename` is client-controlled and can contain `../`, absolute paths, backslashes, or platform-specific separators. **Treat it as untrusted input.**

```python
from pathlib import Path

prefixed_filename = f"{prefix}{Path(file.filename).name}"
dest_path = Path(target_directory) / prefixed_filename
```

`Path(...).name` on POSIX (our Linux/macOS deployments) collapses `/`-separated traversal: `'../../etc/passwd'` → `'passwd'`, `'/absolute/path'` → `'path'`.

**Caveat.** `\` isn't a path separator under `PurePosixPath`, so backslash-separated paths and Windows drive-letter prefixes (`'..\\..\\etc\\passwd'`, `'C:\\evil\\file'`) survive `.name` unchanged — they become literal filename characters inside the target directory, so containment holds, but the helper isn't a full cross-platform sanitiser. If a deployment needs to handle Windows-style filenames, layer on `werkzeug.utils.secure_filename` or an equivalent normalisation step.

Add a regression test that submits a crafted traversal filename and asserts the file lands inside the intended directory.

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

> **Note:** the rules above cover **single-file** uploads (NPE, MLIR, future single-blob endpoints). **Folder-upload** branches (profiler/performance report trees) deliberately preserve subpath structure and use a different fix shape — a resolved-path containment check inside `construct_dest_path` that rejects any candidate whose resolved path lands outside the per-report folder (raising `DataFormatError`, which the view handlers map to 422). Don't extend the `.name` collapse pattern into the folder branch; rely on the containment check.

---

## Toolchain and package management

### pnpm is the only supported frontend package manager

`engines.pnpm` is set to `">=11"` in `package.json`. Don't use `npm install` or `yarn add` — the lockfile is pnpm-format and will diverge.

### Node version is pinned via `.nvmrc`

Use `nvm use` from the repo root. On Node 16+, `corepack` handles pnpm shimming automatically; if `pnpm` isn't available after a fresh `nvm install`, run `corepack prepare pnpm@<version> --activate`.

### Python: managed via uv at the repo root

The Python version is pinned in [`.python-version`](.python-version). Run `uv python install` (or let `uv sync` install it automatically), then `uv sync` to create `.venv` and install dev dependencies. Use `uv run` (or `pnpm run flask:*`) for backend tooling (`black`, `isort`, `mypy`, `pytest`, `alembic`). Don't install globally.

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

### One module-scope `api = Blueprint("api", __name__)`

`backend/ttnn_visualizer/views.py` declares the single blueprint:

`backend/ttnn_visualizer/views.py`

```python
api = Blueprint("api", __name__)
```

Every route in the file decorates with `@api.route("/path", methods=[...])` and is registered onto `api` at module load. `app.py` mounts the blueprint at `url_prefix=f"{app.config['BASE_PATH']}api"` — `/api` when `BASE_PATH=/` (single-tenant deployments, including tests), `/<prefix>/api` under a prefixed mount. Either way, route definitions in `views.py` use bare paths like `/operations`, not `/api/operations`.

**Don't.** Create a second blueprint for a new endpoint group unless you genuinely need a separate `url_prefix` and lifecycle (e.g. an unauthenticated `/health` namespace). Two blueprints with the same prefix create silent registration-order bugs.

Module-private helpers inside `views.py` (cross-route utilities like rank-parameter parsing) carry a leading underscore — covered under [Naming](#naming). Examples currently in `views.py`: `_file_path_from_stack_source_request`, `_rank_query_param`, `_reject_nonzero_rank_on_legacy_db`, `_stack_source_availability_response`. New cross-endpoint helpers go in the same file with the same prefix; only reach for a separate module if the helper is needed outside `views.py`.

### Prefer `Response(orjson.dumps(payload), mimetype="application/json")` for read-mostly endpoints

**Rationale.** `orjson` is typically **much faster** than the standard-library `json` that `jsonify` uses for encoding, handles `bytes`/`datetime`/`enum.Enum` out of the box, and — critically — supports `orjson.Fragment(...)` for splicing already-serialised JSON blobs into the response without re-parsing. The serializers in `backend/ttnn_visualizer/serializers.py` rely on `orjson.Fragment` to stream `captured_graph` strings straight from the report DB into the response, avoiding a parse/re-dump round trip.

Standard pattern:

`backend/ttnn_visualizer/views.py`

```python
return Response(
    orjson.dumps(serialized_operations),
    mimetype="application/json",
)
```

`jsonify` is still fine for tiny payloads where the performance delta doesn't matter and Flask's request-context coercion adds value — e.g. health checks. **Don't** mix the two patterns inside one endpoint, and don't reach for `orjson.dumps` if the response is `[]` and you'd be returning a `jsonify([])` one line later (`views.py`).

### Module-level logger at the top of every backend module

```python
import logging

logger = logging.getLogger(__name__)
```

Use `logger.info / warning / error / exception` — never `print`. `logger.exception(...)` automatically captures the stack trace in the `except` branch and should be preferred over `logger.error(str(e))`.

### View decorator stack order

Most read endpoints use the two-decorator stack `@api.route → @with_instance → @timer` (e.g. `views.py` for the NPE GET endpoint). Endpoints that must refuse `SERVER_MODE` insert `@local_only` between `@with_instance` and the function:

`backend/ttnn_visualizer/views.py`

```python
@api.route("/profiler/<profiler_name>", methods=["DELETE"])
@with_instance
@local_only
def delete_profiler_report(profiler_name, instance: Instance):
```

- `@api.route` outermost (Flask registers the URL).
- `@with_instance` (from `decorators.py`) resolves the `instanceId` query param into an `instance` kwarg and updates the session's report list. Always present on `/api/*` endpoints.
- `@local_only` (from `decorators.py`), when needed, aborts with 403 in `SERVER_MODE`. Sits **below** `@with_instance` so the 403 fires after instance resolution.
- `@timer` innermost — wraps just the view body for timing. Used selectively on hot-path read endpoints; not present on every route.

### Error responses go through helpers, not hand-rolled `jsonify`

`backend/ttnn_visualizer/exceptions.py` exposes:

```python
def response_bad_request(message: Optional[str] = None, detail: Optional[str] = None): …
def response_not_found(message: Optional[str] = None, detail: Optional[str] = None): …
def response_forbidden(message: Optional[str] = None, detail: Optional[str] = None): …
def response_unprocessable_entity(message: Optional[str] = None, detail: Optional[str] = None): …
def response_internal_server_error(message: Optional[str] = None, detail: Optional[str] = None): …
```

All five funnel through `error_response(...)` which produces a consistent `{"error": "...", "detail": "..."}` shape and the matching HTTP status code. Don't hand-roll `return jsonify({"error": "..."}), 400` — the frontend's `getResponseError` happens to recognise that minimal shape, but going through the helper buys you (a) the right `HTTPStatus.*` constant so the status code matches the semantic, (b) the optional `detail` field for additional context that the bare `jsonify` form drops, and (c) a single place to evolve the response shape if it ever needs to change. Duplicating the response-building inline diverges over time.

### `StatusMessage` for operational responses

Upload, sync, and connection-test endpoints return a Pydantic `StatusMessage` that carries a `ConnectionTestStates` status alongside the message. The frontend reads `response.data.status` to drive UI state machines (`PROGRESS` → `OK`/`FAILED`/`WARNING`). Use it whenever the response is consumed by a `ConnectionTestStates`-aware UI; use `response_*` helpers for everything else.

### Env-var booleans go through `_parse_env_bool` / `str_to_bool`

```python
SERVER_MODE = _parse_env_bool("SERVER_MODE", False)
```

`bool(os.getenv("SERVER_MODE", "false"))` is **truthy** for the string `"false"` — a common foot-gun.

**Two parse paths, and they must agree.** Every setting is parsed twice: once in the class body at import, and once in `override_with_env_variables` — which runs after `create_app` calls `load_dotenv`, so a `.env` can introduce a spelling the class body never vetted. That is why every rule below is registered **per setting** in a keyed registry (`_ENV_PARSERS`, `_STRICT_BOOLEANS`, `_ENV_ALIASES`, `_ENV_OVERRIDE_SKIP`) rather than passed at a call site: a rule only one path honoured would leave the other accepting what it refuses. The sub-sections that follow are applications of this one premise.

#### `parse_bool` owns the vocabulary; never re-declare the tokens

`parse_bool` (`utils.py`) is the only place the accepted spellings are written down. It returns `True`, `False`, or `None` for a value it doesn't recognise, and `str_to_bool` is a thin wrapper over it (`parse_bool(value) is True`) for query params and other callers where "unrecognised" and "false" are the same answer.

A second copy of the token list drifts, and **both drift directions fail silently**: add a spelling to one and the other rejects a value the rest of the app honours; remove one and it starts meaning `False`. If a caller needs to know that a value was a typo, take `None` from `parse_bool` — don't re-implement the membership test.

This holds outside `settings.py` too: `create_app`'s root-log-level check, the gunicorn `--reload` check, and `devtools/npe_render_probe.py`'s `SERVER_MODE` refusal all call `str_to_bool`. A dev tool that refuses on a *wider* set than the app looks harmless and isn't — it means the two disagree about what the deployment is.

#### The vocabulary is deliberately narrow, and matched across three consumers

Only `true` / `1` / `false` / `0`, case-insensitive and whitespace-trimmed. That is what `.env.sample` documents, what the SPA's `isFlagEnabled` (`src/functions/getServerConfig.ts`) accepts — the predicate behind both `isServerModeEnabled` and `USAGE_RECORDING_ACTIVE`, and — because `str_to_bool` backs them — what the `print_signposts` / `hide_host_ops` / `merge_devices` / `tracing_mode` query params on `GET /api/performance/perf-results/report` accept. So `SERVER_MODE` and `VITE_SERVER_MODE` can't select opposite postures from the same spelling. **Widening one side means widening the others in the same change.**

The query params are the easiest consumer to forget and the least noisy when broken: a spelling that stops being recognised doesn't error, it silently means `False`, so `?hide_host_ops=t` returns a different report rather than a 4xx. The SPA sends real axios booleans, so only scripted callers notice. `backend/ttnn_visualizer/tests/test_perf_report_params.py` pins the contract.

#### Config reports a typo rather than obeying it, and `_STRICT_BOOLEANS` refuses to start

`str_to_bool` maps anything unrecognised to `False`, which for `SERVER_MODE` is the *local* posture — the one whose endpoints publish SSH host, username, and path metadata. So `settings.py` reads booleans through `_parse_env_bool`, which logs the value and keeps the coded default instead.

**`USAGE_RECORDING_DISABLED` is the one exception, and obeys a value it doesn't recognise.** `_is_recording_disabled_by_environment` (`usage.py`) warns and then switches recording *off* for anything set that isn't a recognised `false`. Keeping the default there would mean reading `USAGE_RECORDING_DISABLED=yes` as consent to record; the cost of obeying a typo is one missing data point, and the cost of ignoring it is recording against an explicit request. The vocabulary itself is unchanged — it still comes from `parse_bool`, and only the treatment of `None` differs. Don't generalise this to other settings, and don't "fix" it back to `str_to_bool`: `test_an_unrecognised_disable_value_switches_recording_off` pins it.

A setting listed in **`_STRICT_BOOLEANS`** raises instead of warning. `SERVER_MODE` is the only member: it is the one boolean whose fallback is itself a security posture, so a value we can't read has to stop the app rather than quietly pick the permissive answer — and the warning that would otherwise cover it is emitted at import, before `create_app` configures logging, so it lands on `stderr` and not in the deployment's logs. Everything else is a feature flag and doesn't warrant refusing to boot.

Strictness is registered per setting for the reason above: a flag only the class body honoured would leave `.env`-introduced typos selecting the local posture.

`MAX_CONTENT_LENGTH` is the second setting that can abort startup, for the same reason by a different route: its class-body call to `_parse_max_content_length` is unguarded, and the value it would fall back to is *no limit at all*, so an unreadable upload cap stops the app rather than silently removing it. Both refusals name the variable and the accepted values, because they are what an operator sees instead of a traceback.

The strict path is import-time, so nothing in-process can exercise it — pytest has already imported the module. `test_importing_settings_refuses_an_unreadable_server_mode` re-imports `settings` in a subprocess; without it, deleting `SERVER_MODE` from `_STRICT_BOOLEANS` leaves the whole suite green.

Because a narrow vocabulary makes previously-accepted spellings fatal, **treat widening or narrowing it as a deployment-affecting change**: a hosted install running `SERVER_MODE=yes` now fails to start rather than silently serving in local posture, which is the intended outcome but still an outage if nobody was told.

#### The hosted posture wins over debug mode

`SERVER_MODE` and a truthy `DEBUG` are mutually exclusive, and `override_with_env_variables` forces `DEBUG` off when both are set. `Flask.debug` is not merely verbosity: it suppresses the catch-all error handler, so an unhandled exception answers an untrusted caller with a traceback, and with `USE_WEBSOCKETS=false` it mounts Werkzeug's interactive console (`DebuggedApplication(evalex=True)`), which evaluates arbitrary Python for whoever reaches it. `middleware()` gates that console on the posture as well, since `settings_override` reaches it without passing through the config layer.

#### `override_with_env_variables` coerces rather than assigns

`_coerce_env_value` parses each environment string back to the declared attribute's type, so setting a variable explicitly no longer undoes the class body's parse. It **declines** what it can't represent — an uncoercible `int`, an unrecognised boolean, and any declared type it has no rule for (the `Path` directories, the engine-options dict) — logging and keeping the declared value rather than handing the app a raw string.

Settings that parse more richly than their type register a named parser in `_ENV_PARSERS`: `SSH_DEFAULT_PORT` (range check) and `MAX_CONTENT_LENGTH` (empty means no limit) would both be broken by plain `int` dispatch. Three rules for that registry, and for `_STRICT_BOOLEANS` / `_ENV_OVERRIDE_SKIP` alongside it:

- **One named function where both paths parse the same setting** (`_parse_max_content_length`). Where the two genuinely differ, say why in the docstring: `_parse_ssh_port` falls back to the default because the class body has nothing else to keep, while the registry uses `require_tcp_port` so a bad override is reported rather than silently changing the port. The range itself is still written once, in `require_tcp_port`, which `parse_tcp_port` wraps. Don't "fix" that asymmetry — it is the difference between having a declared value to keep and not.
- **Key every registry by the attribute name.** `_ENV_PARSERS`, `_STRICT_BOOLEANS`, `_ENV_ALIASES`, and `_ENV_OVERRIDE_SKIP` are all keyed by attribute; the variable is resolved through `_env_name_for` at lookup time and used only in messages. Keying one by the *variable* would pass the guard tests and never fire for the one setting that has an alias.
- **Keys are strings, so nothing binds them to the attribute.** A rename leaves a dead entry that silently falls back to type dispatch — or, in `_STRICT_BOOLEANS`, downgrades a refusal to a warning; or, in `_ENV_OVERRIDE_SKIP`, starts accepting env strings for a derived attribute. `test_every_env_parser_names_a_real_setting`, `test_every_strict_boolean_names_a_real_boolean_setting`, `test_every_env_override_skip_names_a_real_setting` and `test_every_registry_is_keyed_the_way_it_is_looked_up` are what catch it.

#### `_ENV_ALIASES` where the variable isn't named after the attribute

Every setting reads a variable named after its attribute, which is right for all of them but `DEBUG`: it is fed by `FLASK_DEBUG`, because a bare `DEBUG` is the log-level knob (see the entry under [Known inconsistencies](#known-inconsistencies)). `_ENV_ALIASES` maps the attribute to the variable that owns it and `_env_name_for` is the single reader, so the aliased spelling is written once. Without it, `DEBUG=true` — what `pnpm flask:start-debug` sets — turned on Flask's debug mode under `FLASK_ENV=production`, which suppresses the catch-all error handler and returns tracebacks. Add an entry here rather than a special case in the loop if another setting ever grows a differently-named variable.

#### The loop walks the MRO and skips derived settings

It iterates `reversed(type(self).__mro__)`, so inherited settings on `DefaultConfig` are reachable when `Config()` returns a subclass, and subclass declarations win. Descriptors (`ALLOWED_ORIGINS`, `USAGE_RECORDING_ACTIVE`) are skipped because assigning a raw string would shadow them.

Everything else the loop leaves alone is named in one of three frozensets, unioned into **`_ENV_OVERRIDE_SKIP`** at the point of use. They have different lifetimes, so a maintainer adding a setting can tell which rule applies:

- **`_ENV_OVERRIDE_DERIVED`** — computed from other settings or the filesystem, and rebuilt as a group by `recompute_derived_settings()`. A string-typed one (`GUNICORN_BIND`, `SQLALCHEMY_DATABASE_URI`, `APPLICATION_DIR`) would otherwise accept an env string and diverge from its parents; `Path` / `dict` ones are also declined by `_coerce_env_value` as a backstop.
- **`_ENV_OVERRIDE_CONSTANTS`** — structural values the app is built around. Changing one is a code change.
- **`_ENV_OVERRIDE_UNCONFIGURED`** — deployment knobs whose answer today is "no", not "never" (the two `SESSION_COOKIE_*` settings, `PRINT_ENV`). This is the group to revisit first; moving one out is a one-line change plus a class-body `os.getenv`.

A variable naming a skipped setting is reported through `_report_ignored_skip` rather than dropped in silence — for a hand-maintained list, an inert variable is otherwise indistinguishable from a typo in its name.

**`recompute_derived_settings()` is the single owner of the derived group.** It runs at the end of the override loop and from `main()`'s `--tt_metal_home` handling, rebuilding `APP_DATA_DIRECTORY`, `REPORT_DATA_DIRECTORY`, `LOCAL_`/`REMOTE_DATA_DIRECTORY`, `SQLALCHEMY_DATABASE_URI` and `GUNICORN_BIND` together. Add a derivation there, not at a call site: the bug it exists to prevent is a new `TT_METAL_HOME` serving reports from `$TT_METAL_HOME/generated` while the database stays on the import-time tree.

`create_app` runs `load_dotenv` *before* `Config()`, but the class body already ran at import — so a `.env` value that was absent at import only takes effect because the override loop revisits it. That includes `SERVER_MODE`. The two `load_dotenv` calls don't even read the same file (`settings.py` searches from the working directory, `create_app` targets `backend/.env`), which is exactly how the two reads come to differ. `APP_DATA_DIRECTORY` and `REPORT_DATA_DIRECTORY` stay out of the loop but are still honoured — `recompute_derived_settings` reads them with the same precedence the class body gives them (`_RECOMPUTE_HONOURS` marks them, so they don't draw the ignored-variable warning), and rebuilds their children around whichever value wins.

`test_every_env_override_skip_names_a_real_setting` catches a dead skip entry after a rename. `test_the_settings_inventory_is_pinned` catches the other direction — it asserts `vars(DefaultConfig)` partitions exactly into `_OVERRIDABLE_SETTINGS` and `_ENV_OVERRIDE_SKIP`, so a new attribute that nobody classified fails rather than silently becoming env-overridable. Update that inventory when you add a setting; it is the forced decision, not busywork. An overridable setting needs a second decision as well — pinned away from the environment for the test fixtures, or deliberately inherited — which `test_the_test_fixtures_pin_every_env_reachable_setting` forces; see [the pytest section](#backend-pytest--the-shared-client-fixture).

### Domain exceptions live in `exceptions.py`

When raising or catching application errors, use the dedicated classes:

- `RemoteConnectionException` and `AuthenticationFailedException` for SSH-flavoured failures (they carry HTTP status as a property).
- `DataFormatError`, `InvalidReportPath`, `InvalidProfilerPath` for content/structure problems.
- `DatabaseFileNotFoundException`, `RemoteFileReadException` for specific not-found cases.

Don't `raise Exception("...")` — there's an existing class for almost every case.

---

## Known inconsistencies

These exist in the codebase today and don't yet have a single canonical answer. Reviewers should flag new code that goes either direction without considering both. Each entry names the inconsistency, the direction new code takes, and its tracking issue; the rule itself lives in the section above that owns it.

- **`definitions/` still holds some domain-shaped types** (`PerfTable.ts`, `RemoteConnection.ts`, `MlirServer.ts`, `PlotConfigurations.ts`). New types follow the [`definitions/` vs `model/` boundary](#srcdefinitions-vs-srcmodel); leftovers migrate **on-touch**, not in a big-bang move. (#1910)
- **Two accessors for CSS-custom-property colours.** `GRAPH_COLORS` resolves at module load; `getPerfChartChrome()` re-reads per call. Both are legitimate and both keep the literal in `_base.scss` — pick per [No hex literals in TS/TSX](#no-hex-literals-in-tstsx), and don't add a third mechanism. (#1911)
- **Direct imports from `store/fileTransferRegistry.ts`.** New call sites import the re-exports from `app.ts`; older ones are on-touch cleanup. (#1912)
- **`extract_npe_name` is a misnomer** — used by both NPE and MLIR upload handlers. A rename to `extract_uploaded_name` is a tracked follow-up; don't perpetuate the NPE-specific name in new helpers. (#1913)
- **`errorMessage` vs `statusMessage` in file loaders.** `MlirJsonFileLoader.tsx` and `NPEFileLoader.tsx` overload `errorMessage` with both success and failure text. Rename to `statusMessage` is pending. (#1914)
- **Upload size cap.** `MAX_CONTENT_LENGTH` is a real, honoured setting but **unset by default**, so out of the box large uploads succeed until they exhaust memory. Choosing a shipped default is tracked separately. (#1915)
- **Default-export vs named-export of components.** Components are predominantly default-exported, hooks and utilities named-exported. Mirror the file you're editing. (#1916)
- **Raw `toast()` in `useBufferFocus`.** Needs `autoClose: false` and persists the returned `Id` into `activeToastAtom` — capabilities `createToastNotification` doesn't expose. An intentional exception, not a precedent: extend the wrapper if you need richer options. (#1917)
- **`flake8 max-line-length = 79` vs `black line-length = 88`.** Black wins in practice because `pnpm flask:format` runs it; CI never runs flake8 in isolation. Don't reflow files to satisfy 79 — **88 is the source of truth**. (#1918)
- **`Config.__new__` lacks a return annotation**, surfacing a mypy `attr-defined` error in `database_migrations.py`. Fix is `def __new__(cls) -> "DefaultConfig":`; tracked as a follow-up. (#1919)
- **`useQuery<Data, AxiosError>` not universal.** Four hooks in `useAPI.tsx` (`useGetClusterDescription`, `useInstance`, `useReportFolderList`, `usePerfFolderList`) leave both generics implicit. Tighten when you touch them. (#1920)
- **`USAGE_RECORDING_ACTIVE` is a config attribute with no matching variable** — it is fed by `USAGE_RECORDING_DISABLED`, the opposite polarity, so it is named for the state instead. Borrowing the variable's name would make `PRINT_ENV` publish `true` when recording is off. (#1921)
- **`DEBUG` and `FLASK_DEBUG` are different knobs with confusable names.** `FLASK_DEBUG` feeds the `DEBUG` *config* value (Flask's debug mode); the `DEBUG` *environment variable* raises the root log level and is what `pnpm flask:start-debug` sets. Both are in `.env.sample`. Read the name at the call site rather than assuming. (#1922)
