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
- [File organization and modules](#file-organization-and-modules)
- [Routing and page metadata](#routing-and-page-metadata)
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

## SPDX headers

### Every source file carries an SPDX header in the project format

**Rationale.** `pnpm lint:spdx` (`scripts/check-spdx.mjs`) walks the whole repo and validates two distinct things, each keyed on the file:

- **SPDX comment header** on files whose extension is `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, `.scss`, `.xml`, or `.py` (`scripts/check-spdx.mjs`). The accepted format is invariant enough to pin here so contributors don't reinvent it.
- **`license` + `author` object check on `package.json` specifically** (`scripts/check-spdx.mjs`). The script matches `.json` extension *and* a path that includes `'package.json'` — so this is a single-file special case, not a rule that applies to every JSON file in the repo. All other JSON files are skipped.

Files outside both buckets (markdown, YAML, TOML, plus most JSON) are skipped. Missing or malformed headers on covered files fail CI.

The brand string is **`Tenstorrent AI ULC`** and the licence is **`Apache-2.0`** (`scripts/check-spdx.mjs`). Two comment styles are accepted, keyed on file extension:

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

For `package.json` the brand metadata lives in the JSON `license` and `author` fields rather than as a header comment (`scripts/check-spdx.mjs`).

### The year is the file's creation year, not the edit year

Don't bump the year on edits — that's a hot path for noisy diffs reviewers have to wade through. New files take the current year.

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

Used in `src/components/OperationGraphComponent.tsx` after refactoring from `'input' | 'output' | null`. Enums are searchable, autocompletable, and rename-safe. **One-off booleans/flags** (`'asc' | 'desc'` on a single call site) don't need promotion to enums.

### Spell out generic type parameters on third-party containers

```ts
const dataset = new DataSet<OperationNode>(initial);
const cache = new Map<string, Buffer>();
```

When using `DataSet<T>` from `vis-data` (paired with `Edge`/`Node`/`Network` from `vis-network` — see `src/components/OperationGraphComponent.tsx`), `Map<K, V>`, or a similar container, write the type parameter. Letting inference quietly widen to `any`/`unknown` is the single most common source of latent typing bugs we hit.

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

### All shared atoms live in `src/store/app.ts`

The file is organized into commented sections (`// App state`, `// Reports`, `// Operations route`, etc.) — add new atoms to the section that matches their feature area. **Components don't declare module-scope atoms.** If you need component-local state, use `useState`.

### Atom names end with `Atom`

Every export in `src/store/app.ts` follows this:

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

**Documented exception.** The Socket.IO connection URL is built at module scope in `src/libs/SocketProvider.tsx` (`io(\`${BASE_PATH}?instanceId=${getOrCreateInstanceId()}\`)`) because `io(...)` doesn't go through axios and there's no interceptor to inject the param. The instance ID still travels as a `?instanceId=...` query string — just one assembled by hand rather than injected.

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
};
```

> The current cleanup `off()`s connect/disconnect/connect_error/reconnect but **does not** unregister the `fileTransferProgress` handler registered at `src/libs/SocketProvider.tsx`. That's tracked as a pre-existing gap (see [Known inconsistencies](#known-inconsistencies)). New listeners should follow the pairing rule.

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

`src/hooks/useAPI.tsx`

```tsx
queryKey: ['get-operation-buffers', operationId],
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

- **`src/definitions/`** holds *primitives* — enums, route/endpoint maps, plot/colour configs, plain interfaces with no behaviour. Examples: `Endpoints.ts`, `Routes.ts`, `TestIds.ts`, `GraphColors.ts`, `BufferSummary.ts`.
- **`src/model/`** holds *domain types* — API response shapes (often interfaces that mirror a backend model), sometimes classes with methods. Examples: `APIData.ts`, `BufferType.ts`, `MLIRJsonModel.ts`, `NPEModel.ts`, `ClusterModel.ts`.

Rule of thumb: **if it mirrors a backend response, it's a model.** If it's a constant, mapping, or enum used purely on the frontend, it's a definition.

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

**Rationale.** `ROUTES` (`src/definitions/Routes.ts`) holds absolute paths so that `<Link to={ROUTES.OPERATIONS} />` reads naturally. React Router's nested-route children, however, take **relative** paths. `stripFirstSlash` bridges the two and keeps `ROUTES` the single source of truth:

`src/definitions/RouteObjectList.tsx`

```tsx
// Allows us to keep absolute paths in ROUTES while using relative paths in route objects
const stripFirstSlash = (path: string) => {
    return path.startsWith('/') ? path.slice(1) : path;
};

export const routeObjectList = [
    { index: true, element: <Home /> },
    { path: stripFirstSlash(ROUTES.OPERATIONS), element: <Operations /> },
    { path: stripFirstSlash(`${ROUTES.OPERATIONS}/:operationId`), element: <OperationDetails /> },
    …
];
```

New routes add an entry to `routeObjectList` and (if they require an active report) a matching entry to `RouteRequirements` in the same file. Don't reach into `createBrowserRouter([...])` in `main.tsx` and hardcode another route — `main.tsx` consumes `routeObjectList` and nothing else.

### Page titles via `react-helmet-async`; layout sets the template, routes set the title

`Layout.tsx` declares the base template once, and each route file mounts its own short `<Helmet title='...' />`:

`src/components/Layout.tsx`

```tsx
<Helmet
    defaultTitle='TT-NN Visualizer'
    titleTemplate='%s | TT-NN Visualizer'
>
    <meta charSet='utf-8' />
    <meta
        name='description'
        content='A comprehensive tool for visualizing and analyzing model execution, …'
    />
</Helmet>
```

`src/routes/Operations.tsx`

```tsx
export default function Operations() {
    useClearSelectedBuffer();

    return (
        <>
            <Helmet title='Operations' />
            <OperationList />
        </>
    );
}
```

`HelmetProvider` is mounted once at the top of the tree in `src/main.tsx`. Don't add a second provider or override `titleTemplate` at the page level — the layout owns the suffix.

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

### Module-level constants are `SCREAMING_SNAKE_CASE`

**Module-level** means declared at the outer scope of a module (the file), not inside a function or block — it does not mean “only used in this file.” Use **`const`** (no `export`) for values private to that module. If a constant is **shared across modules**, define and export it from a sensible central place (for example `src/definitions/` next to related types or endpoint maps — see [File organization](#file-organization-and-modules)) instead of exporting ad hoc from a leaf component just because the name is `SCREAMING_SNAKE_CASE`.

```ts
const DEFAULT_ERROR_MESSAGE = 'An unexpected error occurred';
const MAX_RETRIES = 3;
const EMPTY_PERF_RETURN = { report: [], stacked_report: [], signposts: [] };
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

---

## Testing

### Frontend: Vitest + `@testing-library/react`

Run with `pnpm test`. Tests live in `tests/` at the repo root — see [the dedicated subsection below](#frontend-tests-live-in-tests-at-the-repo-root-not-co-located-with-source) for the layout breakdown.

### Backend: pytest + the shared `client` fixture

The Flask test client (`app.test_client()`) is exposed as the `client` fixture in `backend/ttnn_visualizer/tests/conftest.py`. Routes are mounted under the **`{BASE_PATH}api`** prefix — `backend/ttnn_visualizer/app.py` registers the `api = Blueprint("api", __name__)` blueprint with `url_prefix=f"{app.config['BASE_PATH']}api"`. When `BASE_PATH` is `/` (the default in `conftest.app` and in single-tenant deployments) the effective prefix is `/api`; when `BASE_PATH` is something like `/visualizer/` the prefix becomes `/visualizer/api`. Tests run against `conftest.app` so `/api/...` is the right path in test URLs — just don't hard-code that assumption into production-facing docs or curl examples. Endpoints decorated with `@with_instance` require an `instanceId` query param — the `make_report` fixture returns one. Pass it through `query_string={...}` (see the dedicated subsection below).

Two `conftest.app` defaults that bite local-upload tests in particular:

- **`SERVER_MODE=True`** (`conftest.py`) — local-only handlers like `/api/local/upload/mlir` return `403 Forbidden` until you override it.
- **`LOCAL_DATA_DIRECTORY` is a `str`** (`conftest.py`) but production `settings.py` initialises it as a `Path` and handlers do `data_directory / config["MLIR_DIRECTORY_NAME"]`. Cast it to `Path` in the test so you exercise the same operand types as the deployed app.

Both overrides match the canonical pattern at `backend/ttnn_visualizer/tests/test_file_uploads.py`. A runnable example:

```python
from http import HTTPStatus
from io import BytesIO
from pathlib import Path

from ttnn_visualizer.enums import ConnectionTestStates


def test_local_upload_rejects_non_json(app, client, make_report):
    instance_id = make_report()
    # Two conftest.app defaults that bite local-upload tests:
    # SERVER_MODE=True would block the route with 403, and
    # LOCAL_DATA_DIRECTORY ships as a str.
    app.config["SERVER_MODE"] = False
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])

    response = client.post(
        "/api/local/upload/mlir",
        query_string={"instanceId": instance_id},
        data={"files": (BytesIO(b"hello"), "evil.exe")},
        content_type="multipart/form-data",
    )

    assert response.status_code == HTTPStatus.OK
    body = response.get_json()
    # `StatusMessage.status` is a `ConnectionTestStates` enum; FAILED is `2`
    # after JSON serialisation (see `test_file_uploads.py`).
    assert body["status"] == ConnectionTestStates.FAILED.value
```

Use `caplog` for log assertions, `tmp_path` for filesystem-touching tests. Don't construct a raw `werkzeug.test.Client` — go through the Flask wrapper so the app context and request hooks fire correctly.

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

## Frontend data integrity

### Validate user-uploaded JSON on the client

If the user uploads a file the app parses as JSON, validate it on the frontend before letting the backend round-trip a 5xx. Cheaper, faster, and the error UI can be friendlier. Pair `try { JSON.parse(...) } catch (e) { ... }` with shape-check predicates (`if (!Array.isArray(data.nodes)) ...`) when the data has known structure. Surface a friendly toast or callout rather than a stack trace.

### Convert client-side validation failures into a synthetic `AxiosError` with a real `HttpStatusCode`

**Rationale.** Route components downstream key off `error?.status === HttpStatusCode.UnprocessableEntity` to drive validation-error UI. When the failure is a client-side `JSON.parse` (the backend streams the bytes without parsing), throwing a plain `Error` would force every consumer to grow a parallel branch. Throwing a synthetic `AxiosError` with the right status keeps the existing UI mapping working without changes.

`src/hooks/useAPI.tsx`

```tsx
const fetchMLIRJson = async (): Promise<GraphBundle> => {
    // Fetch as raw text and parse client-side. The backend deliberately
    // streams the uploaded file bytes without parsing them — large MLIR
    // payloads avoid the double-parse / double-stream cost on the server.
    // If the file contents are malformed JSON, surface a synthetic 422 so
    // the existing UI mapping in `routes/MLIR.tsx`
    // (422 → MLIRValidationError.INVALID_JSON) handles it without changes.
    const response = await axiosInstance.get<string>(Endpoints.MLIR, {
        responseType: 'text',
        transformResponse: [(data) => data],
    });
    try {
        return JSON.parse(response.data) as GraphBundle;
    } catch {
        throw new AxiosError(
            'MLIR file is not valid JSON',
            AxiosError.ERR_BAD_RESPONSE,
            response.config,
            response.request,
            { ...response, status: HttpStatusCode.UnprocessableEntity },
        );
    }
};
```

Three things to copy when you reuse this pattern:

1. Pass the original `response.config` and `response.request` so any code that reads those fields on the thrown `AxiosError` still sees the same objects (they can be `undefined` if omitted, which breaks callers that assume they exist).
2. Spread the response (`{ ...response, status: ... }`) so type guards on the error shape still work — don't pass a fresh object.
3. Use a numeric `HttpStatusCode` constant from `axios`, not a string literal — call sites compare with `===`.

---

## Upload security

### Apply `Path(filename).name` at the boundary

`werkzeug.FileStorage.filename` is client-controlled and can contain `../`, absolute paths, backslashes, or platform-specific separators. **Treat it as untrusted input.**

```python
from pathlib import Path

prefixed_filename = f"{prefix}{Path(file.filename).name}"
dest_path = Path(target_directory) / prefixed_filename
```

`Path(...).name` on POSIX (which is what our Linux/macOS deployments use) collapses `/`-separated traversal: `'../../etc/passwd'` becomes `'passwd'`, and `'/absolute/path'` becomes `'path'`.

**Caveat.** `\` is not a path separator under `PurePosixPath`, so backslash-separated paths and Windows drive-letter prefixes survive `.name` unchanged:

```python
>>> Path('..\\..\\etc\\passwd').name
'..\\..\\etc\\passwd'
>>> Path('C:\\evil\\file').name
'C:\\evil\\file'
```

This still doesn't *escape* the target directory on POSIX — backslashes become literal filename characters rather than separators — so containment holds. But don't read the helper as a full cross-platform sanitiser. If a future deployment ever needs to handle filenames coming from a Windows-aware client more strictly, layer on `werkzeug.utils.secure_filename` or an equivalent normalization step.

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

### One module-scope `api = Blueprint("api", __name__)`

`backend/ttnn_visualizer/views.py` declares the single blueprint:

`backend/ttnn_visualizer/views.py`

```python
api = Blueprint("api", __name__)
```

Every route in the file decorates with `@api.route("/path", methods=[...])` and is registered onto `api` at module load. `app.py` mounts the blueprint at `url_prefix=f"{app.config['BASE_PATH']}api"` — `/api` when `BASE_PATH=/` (single-tenant deployments, including tests), `/<prefix>/api` under a prefixed mount. Either way, route definitions in `views.py` use bare paths like `/operations`, not `/api/operations`.

**Don't.** Create a second blueprint for a new endpoint group unless you genuinely need a separate `url_prefix` and lifecycle (e.g. an unauthenticated `/health` namespace). Two blueprints with the same prefix create silent registration-order bugs.

Module-private helpers inside `views.py` (cross-route utilities like rank-parameter parsing) carry a leading underscore — covered under [Naming](#naming). Examples currently in `views.py`: `_file_path_from_stack_source_request`, `_optional_rank_query_param`, `_reject_nonzero_rank_on_legacy_db`, `_stack_source_availability_response`. New cross-endpoint helpers go in the same file with the same prefix; only reach for a separate module if the helper is needed outside `views.py`.

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
- **Two component-typing styles coexist: plain props parameter vs `React.FC<...>`.** Plenty of components are written as `function Foo({ x }: FooProps)`, but `React.FC<FooProps>` (and the bare `: FC<FooProps>` variant) is also in active use across ~30+ files (`src/libs/SocketProvider.tsx`, `src/routes/GraphView.tsx`, `src/components/OperationGraphComponent.tsx`, `src/components/npe/NPEViewComponent.tsx`, `src/components/operation-details/OperationDetailsComponent.tsx`, and many more). The codebase has no single canonical answer. Mirror the file you're editing. The community-wide foot-gun of `React.FC` (implicit `children` in older `@types/react`) is a real consideration, but it's not a project-wide migration in this repo.
- **Raw `toast()` in `useBufferFocus`.** `src/hooks/useBufferFocus.tsx` calls `toast()` from `react-toastify` directly because it needs `autoClose: false` and persists the returned `Id` into `activeToastAtom` — capabilities `createToastNotification` doesn't expose. Intentional exception, not a precedent. New code still goes through `createToastNotification`; if you need richer options, extend the wrapper.
- **`print()` calls in `sockets.py`.** `backend/ttnn_visualizer/sockets.py` use `print()` instead of `logger.info / debug`. Pre-existing tech debt; do not introduce new `print()` calls anywhere else in the backend.
- **`flake8 max-line-length = 79` vs `black line-length = 88`.** `.flake8` and `pyproject.toml` disagree. Black wins in practice because `pnpm flask:format` runs it; the flake8 setting only matters if `pre-commit` runs flake8 in isolation, which CI does not. Don't expand or contract files to satisfy 79 — 88 is the source of truth.
- **`Config.__new__` lacks a return annotation.** `backend/ttnn_visualizer/settings.py` returns the singleton without typing the return, surfacing a mypy `attr-defined` error in `database_migrations.py` against `cast(DefaultConfig, Config()).SQLALCHEMY_DATABASE_URI`. Fix is `def __new__(cls) -> "DefaultConfig":`; tracked as a follow-up.
- **`useQuery<Data, AxiosError>` not universal.** Four hooks in `useAPI.tsx` (`useGetClusterDescription`, `usePerfMeta`, `useReportFolderList`, `useInstance`) leave the error generic implicit (`unknown`). Call sites currently don't read `error.status` on these specific queries, but the rule is "spell out both generics" — tighten when you touch them.
- **`dataclasses.asdict(...)` vs `to_dict()` for serialisation.** Models that inherit `SerializeableDataclass` get a `to_dict()` that handles `enum.Enum` conversion; using `dataclasses.asdict` instead (e.g. `views.py`) skips that handling. Safe when the dataclass has no enum fields; otherwise use `.to_dict()`. Reviewers should flag `asdict` on any dataclass with enum-typed fields.
- **`SocketProvider` cleanup is incomplete.** `src/libs/SocketProvider.tsx` `off()`s `connect`/`disconnect`/`connect_error`/`reconnect` but not the `fileTransferProgress` handler registered alongside them. Pre-existing; the listener list will grow on every remount of the provider (rare in production, common under StrictMode in dev). New listeners follow the pairing rule; the existing miss is tracked tech debt.
