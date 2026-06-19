# Issue #1517 — Annotate top-N slowest ops on the memory chart timeline

> Local planning doc. Not committed. Tweak as we go.

## Surface

The "memory chart timeline" is the **Buffer Summary** view (`/buffer-summary`) — a virtualized vertical stack of one row per op. There is no horizontal Plotly time axis on this surface; the x-axis is **memory address**. So the issue's vocabulary ("vertical line", "labeled tick") rotates 90° here:

- Inline rank badge → the existing **y-axis-tick gutter** at the right of each row.
- "Dot above the chart" → a thin **minimap rail** to the right of the scrollable area, dots placed by `rowIndex * OPERATION_EL_HEIGHT`, visible even when the row is scrolled out of view.

## Design decisions locked

| Question | Decision |
| --- | --- |
| Annotation style | Gutter rank badge **+** minimap dot rail (both gated by the same toggle). |
| Persistence | `N` and selected `mode` persist via `atomWithStorage`. On/off toggle is local `useState`, resets when the active profiler **or** performance report changes (mirrors `OperationGraphComponent` perf overlay pattern). |
| Scope | Both modes in one PR: `Perf time` (matched perf rows) and `L1 fullness` (existing `useL1PressureByOperation`). Mode selector is a Blueprint `<HTMLSelect>` (or `<SegmentedControl>` if it reads better) wired through a single dropdown. |
| Tabs | Both L1 and DRAM. L1 fullness mode is **L1-only** — disabled with a tooltip on the DRAM tab since fullness % is computed against the L1 budget. |
| Color | Reuse `perfColorScale(t)` + `PERF_BINS` for both modes — same hot/cold semantics. |
| Click marker | `virtualizer.scrollToIndex(rowIndex, { align: 'center' })`. Do **not** auto-route to op details — too destructive. The y-tick `<Link>` is already there if the user wants to navigate. |
| Tooltip on badge | Rank ("#3 slowest"), op id, op name, the mode-specific metric value (formatted ns for perf, formatted % for L1 fullness). |
| `N` default | `DEFAULT_TOP_N_SLOWEST = 10`. Numeric input bounded `[1, 50]`. |
| Availability | Tri-state mirrored on `OperationGraphComponent`'s `PerfOverlayStatus` (`UNAVAILABLE` / `UNLINKED` / `READY`). Disabled select option + tooltip when a mode isn't available on the current tab/report combination. |

## Files

### New

- `src/functions/topNAnnotations.ts`
  - Mode enum (`'perf' | 'l1Fullness'`).
  - Common ranked annotation shape `{ opId, rank, t, valueLabel }`.
  - Pure selector: `selectTopNAnnotations({ mode, perfAggregates?, l1Pressure?, operations, n })` →
    `Map<opId, RankedAnnotation>`. Stable sort by value desc, tie-break on opId asc, slice 0..N. Only emits annotations for ops that are present in the `operations` array (DRAM segmenting friendly).
  - Score normalisation reuses `scoreOps` shape (log10 for perf, plain linear 0..100 for L1 fullness).
- `tests/topNAnnotations.spec.ts` — Pure unit tests covering both modes, empty inputs, all-equal values, op-id filtering for segmented DRAM lists, N bounds.

### Modified

- `src/store/app.ts`
  - `topNAnnotationModeAtom = atomWithStorage<'perf' | 'l1Fullness'>('topNAnnotationMode', 'perf')`
  - `topNAnnotationCountAtom = atomWithStorage<number>('topNAnnotationCount', 10)`
- `src/components/buffer-summary/BufferSummaryPlotControls.tsx`
  - New "Highlight top ops" cluster: `<Switch>` + `<HTMLSelect>` mode picker + `<NumericInput>`.
  - Disabled switch + tooltip when no mode is available (`PerfOverlayStatus.UNAVAILABLE` or `UNLINKED`).
- `src/components/buffer-summary/BufferSummaryVirtualizedList.tsx`
  - New prop: `annotationsByOpId?: Map<number, RankedAnnotation>`.
  - Render rank badge inside the existing y-tick gutter when an op has an annotation.
  - Render minimap rail (`<div className='top-n-rail'>` absolutely positioned), one dot per annotated op at `top = rowIndex * OPERATION_EL_HEIGHT`, click → `virtualizer.scrollToIndex(rowIndex, { align: 'center' })`. Rail tracks the **scroll element height**, not the virtualHeight (so dots map to the same vertical space as the rows).
- `src/components/buffer-summary/BufferSummaryPlotRenderer.tsx` (L1)
  - Wire up perf aggregates (via `useGetDeviceOperationListPerf` → `PerfOverlaySource[]` → `aggregatePerfByOp`) and L1 pressure (via existing hook).
  - Compute `annotationsByOpId` based on selected mode + toggle state.
  - Reset toggle on `activeProfilerReport`/`activePerformanceReport` change (same as graph overlay).
  - Pass annotations + status to `BufferSummaryVirtualizedList`.
- `src/components/buffer-summary/BufferSummaryPlotRendererDRAM.tsx`
  - Same wiring, but L1-fullness mode is forced `UNAVAILABLE` here (gate with a constant).
- `src/scss/components/BufferSummaryPlot.scss`
  - Styles for the rank badge in the y-tick gutter and the minimap rail.
- `src/scss/components/BufferSummaryControls.scss` (or extend existing)
  - Styles for the new controls cluster (label + mode select + numeric input on one row).

### Tests

- `tests/topNAnnotations.spec.ts` — pure helper.
- Extend `tests/BufferSummaryVirtualizedList.spec.tsx` (or add if missing) for rank-badge rendering + rail rendering + click → `scrollToIndex` call.
- Extend `tests/BufferSummaryPlotControls.spec.tsx` (or add if missing) for disabled/tooltip tri-state across modes and tabs.

## Implementation order

1. Pure helper + tests (decoupled, low risk).
2. Atoms.
3. Controls UI (default-disabled, tooltip wiring) — visible immediately even before parent renderer wiring.
4. L1 renderer wiring + virtualized list rendering.
5. DRAM renderer wiring + L1-fullness disabled.
6. Tests + SCSS polish.
7. Manual sweep on `resnet50_main_jun10_2110` (or similar) with a perf report loaded.

## Open follow-ups (not in this PR)

- Heatmap mode on memory chart (#1587) — keep mode enum extensible so a future `'heatmap'` mode can slot in.
- Cross-link from the perf table's "slowest" rows directly to the memory chart with the top-N filter pre-applied (potential follow-up; doable once a shared `selectedOperationIdAtom` lands).
