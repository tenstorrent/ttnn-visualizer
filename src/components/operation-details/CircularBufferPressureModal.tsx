// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useEffect, useMemo, useState } from 'react';
import {
    Button,
    ButtonGroup,
    ButtonVariant,
    Card,
    Icon,
    Overlay2,
    PopoverPosition,
    Size,
    Switch,
    Tag,
    Tooltip,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { useDevices } from '../../hooks/useAPI';
import LoadingSpinner from '../LoadingSpinner';
import { formatMemorySize, prettyPrintAddress } from '../../functions/math';
import { getBufferColor } from '../../functions/colorGenerator';
import { CBAllocationSummary, CBPressureSnapshot } from '../../functions/processMemoryAllocations';
import 'styles/components/CircularBufferPressureModal.scss';

const CORE_KEY = (x: number, y: number) => `${x},${y}`;

type Normalisation = 'local' | 'budget';

// Cell geometry — mirrors the L1 tensix grid (tensixSize=120, /3 height) used
// by TensorVisualisationComponent so the two visualisations feel like siblings.
const TENSIX_WIDTH = 120;
const TENSIX_HEIGHT = TENSIX_WIDTH / 3;
const STRIP_HEIGHT = 16;

// SVG strokes are centered on the geometric edge of the rect by default, so a
// rect at `y=0, height=H` with a 1.5px stroke would have its bottom 0.75px
// rendered *outside* the SVG viewport and clipped. Insetting by 1px on each
// side keeps the geometric edge 1px inside the SVG, fully containing the max
// 2px stroke (selected state). Only applies to the per-core strip — the
// zoomed plot uses a frame-wrapper + `overflow="visible"` approach instead
// (see `ZoomedCorePlot`) so its rects don't need a y-inset.
const STRIP_STROKE_INSET = 1;

// Fallback grey for the rare case where the palette generator returns
// undefined (e.g. address falls outside its known bands); keeps the rect
// visible instead of letting SVG default to black.
const CB_FALLBACK_COLOR = '#888';

const cbColor = (cb: CBAllocationSummary): string =>
    getBufferColor(cb.address + (cb.allocateOperationId ?? 0)) ?? CB_FALLBACK_COLOR;

/**
 * SVG paints siblings in document order, so the *last* rect in a sibling group
 * wins at shared boundaries. The selected rect wears a thicker, brighter
 * (2px yellow) stroke that must not be covered by an adjacent rect's stroke
 * at a shared address edge — otherwise the selection outline drops on the
 * shared side and the user sees only three of four edges. Pulling the
 * selected rect to the end of the list guarantees its outline survives on
 * every side. No-op when nothing is selected or the rect isn't in the list.
 */
const reorderSelectedLast = (cbs: CBAllocationSummary[], selectedNodeId: number | null): CBAllocationSummary[] => {
    if (selectedNodeId === null) {
        return cbs;
    }
    const idx = cbs.findIndex((c) => c.nodeId === selectedNodeId);
    if (idx === -1 || idx === cbs.length - 1) {
        return cbs;
    }
    const next = cbs.slice();
    const [selected] = next.splice(idx, 1);
    next.push(selected);
    return next;
};

interface MiniCBStripProps {
    cbs: CBAllocationSummary[];
    memoryStart: number;
    memoryEnd: number;
    selectedCBNodeId: number | null;
}

/**
 * Per-core L1 strip showing where each contributing CB sits in the address
 * space. Inline SVG (rather than reusing SVGBufferRenderer) because we work
 * with CBAllocationSummary, not BufferChunk, and we want a hover/selection
 * outline that the existing primitive doesn't expose.
 *
 * Aliased CBs (`globallyAllocated`) render outline-only — same colour family,
 * no fill — to communicate "this is a view into an existing buffer, not a
 * new allocation". They keep their slot in the strip so the address position
 * still matches the legend, but visually subordinate the anonymous CBs that
 * are actually contributing pressure on this core. See #1651.
 */
const MiniCBStrip = ({ cbs, memoryStart, memoryEnd, selectedCBNodeId }: MiniCBStripProps) => {
    const memoryRange = Math.max(1, memoryEnd - memoryStart);
    const orderedCbs = useMemo(() => reorderSelectedLast(cbs, selectedCBNodeId), [cbs, selectedCBNodeId]);
    return (
        <svg
            className='cb-strip'
            height={STRIP_HEIGHT}
            width='100%'
            preserveAspectRatio='none'
        >
            {orderedCbs.map((cb) => {
                const xPercent = ((cb.address - memoryStart) / memoryRange) * 100;
                const widthPercent = (cb.size / memoryRange) * 100;
                const isSelected = selectedCBNodeId === cb.nodeId;
                const colour = cbColor(cb);
                const isAliased = cb.globallyAllocated;
                return (
                    <rect
                        key={cb.nodeId}
                        x={`${xPercent}%`}
                        y={STRIP_STROKE_INSET}
                        width={`${widthPercent}%`}
                        height={STRIP_HEIGHT - STRIP_STROKE_INSET * 2}
                        fill={isAliased ? 'none' : colour}
                        // SVG `stroke` attribute would be clobbered by CSS rules
                        // on `.cb-strip-chunk`, so we surface the per-chunk colour
                        // through a CSS custom property and let the `.aliased`
                        // selector pick it up at the right specificity.
                        style={isAliased ? ({ '--cb-color': colour } as React.CSSProperties) : undefined}
                        className={classNames('cb-strip-chunk', {
                            selected: isSelected,
                            aliased: isAliased,
                        })}
                    />
                );
            })}
        </svg>
    );
};

interface ZoomedCorePlotProps {
    cbs: CBAllocationSummary[];
    memoryStart: number;
    memoryEnd: number;
    l1Budget: number;
    selectedCBNodeId: number | null;
    onSelectCB: (nodeId: number | null) => void;
}

/**
 * Wider per-core L1 plot rendered in the details panel when a cell is
 * selected. Shares its `[memoryStart, memoryEnd]` window with the grid so
 * the zoom panel is a true magnification — a CB at the same x-offset in
 * the grid strip lands at the same x-offset down here, just bigger.
 */
const ZoomedCorePlot = ({
    cbs,
    memoryStart,
    memoryEnd,
    l1Budget,
    selectedCBNodeId,
    onSelectCB,
}: ZoomedCorePlotProps) => {
    const memoryRange = Math.max(1, memoryEnd - memoryStart);
    const memoryMid = memoryStart + memoryRange / 2;
    const plotHeight = 64;
    // Width threshold for the inline `addr · size` label, expressed as a
    // percentage of the address window. The `prettyPrintAddress · size`
    // string needs ~70px in our monospace font, and the zoomed panel sits
    // in a ~600px column, so anything narrower than ~12% of the window
    // can't fit the label without clipping. Below this we drop the label
    // and lean on the tooltip / legend for identity.
    const MIN_WIDTH_PERCENT_FOR_LABEL = 12;
    const orderedCbs = useMemo(() => reorderSelectedLast(cbs, selectedCBNodeId), [cbs, selectedCBNodeId]);

    return (
        <div className='zoomed-core-plot'>
            {/* Frame wrapper owns the border + background + a 2px inner
                padding. Rect strokes that spill past the SVG viewport (top,
                bottom, *and* the left/right edges where x/width are in `%`
                and we can't easily inset in pixels) render into that padding
                area instead of being clipped — combined with the SVG's
                `overflow="visible"` below. Without this, Firefox in
                particular clips the bottom/right strokes of outline-only
                (aliased) rects that land flush against the SVG bounds,
                leaving the border looking cut off. */}
            <div className='zoomed-core-svg-frame'>
                <svg
                    className='zoomed-core-svg'
                    width='100%'
                    height={plotHeight}
                    preserveAspectRatio='none'
                    overflow='visible'
                >
                    {orderedCbs.map((cb) => {
                        const xPercent = ((cb.address - memoryStart) / memoryRange) * 100;
                        const widthPercent = (cb.size / memoryRange) * 100;
                        const isSelected = selectedCBNodeId === cb.nodeId;
                        // Width-as-fraction-of-window is enough to decide
                        // whether there's room for a label without forcing
                        // a layout pass.
                        const labelFits = widthPercent > MIN_WIDTH_PERCENT_FOR_LABEL;
                        const colour = cbColor(cb);
                        const isAliased = cb.globallyAllocated;
                        const titleText = isAliased
                            ? `${prettyPrintAddress(cb.address, l1Budget)}  ${formatMemorySize(cb.size, 2)} · Aliased to tensor @ ${prettyPrintAddress(cb.address, l1Budget)} — no new allocation`
                            : `${prettyPrintAddress(cb.address, l1Budget)}  ${formatMemorySize(cb.size, 2)}`;
                        return (
                            <g
                                key={cb.nodeId}
                                className={classNames('zoomed-chunk', { selected: isSelected, aliased: isAliased })}
                                // CSS variable lets the `.aliased` rule
                                // provide the outline colour at higher
                                // specificity than the base
                                // `.zoomed-chunk-rect` stroke. Same pattern
                                // as the per-core strip above.
                                style={isAliased ? ({ '--cb-color': colour } as React.CSSProperties) : undefined}
                                onClick={() => onSelectCB(isSelected ? null : cb.nodeId)}
                            >
                                <title>{titleText}</title>
                                <rect
                                    x={`${xPercent}%`}
                                    y={0}
                                    width={`${widthPercent}%`}
                                    height={plotHeight}
                                    // `transparent` (rgba(0,0,0,0)) keeps
                                    // the visual identical to `none` but
                                    // counts as "painted" under the default
                                    // `pointer-events: visiblePainted`, so
                                    // the whole interior of outline-only
                                    // (aliased) rects routes clicks up to
                                    // the `<g>` onClick handler instead of
                                    // only the 1.5px stroke being
                                    // hit-testable.
                                    fill={isAliased ? 'transparent' : colour}
                                    className='zoomed-chunk-rect'
                                />
                                {labelFits && (
                                    <text
                                        x={`${xPercent + widthPercent / 2}%`}
                                        y={plotHeight / 2}
                                        textAnchor='middle'
                                        dominantBaseline='central'
                                        className='zoomed-chunk-label'
                                    >
                                        {prettyPrintAddress(cb.address, l1Budget)} · {formatMemorySize(cb.size, 2)}
                                    </text>
                                )}
                            </g>
                        );
                    })}
                </svg>
            </div>
            <div className='zoomed-axis monospace'>
                <span>{prettyPrintAddress(memoryStart, l1Budget)}</span>
                <span>{prettyPrintAddress(memoryMid, l1Budget)}</span>
                <span>{prettyPrintAddress(memoryEnd, l1Budget)}</span>
            </div>
        </div>
    );
};

export interface CircularBufferPressureModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    snapshot: CBPressureSnapshot | null;
}

const CircularBufferPressureModal = ({ isOpen, onClose, title, snapshot }: CircularBufferPressureModalProps) => {
    const { data: devices } = useDevices();
    const [selectedCore, setSelectedCore] = useState<string | null>(null);
    const [selectedCBNodeId, setSelectedCBNodeId] = useState<number | null>(null);
    const [normalisation, setNormalisation] = useState<Normalisation>('local');
    const [showAbsolute, setShowAbsolute] = useState<boolean>(true);
    // Default-on per the #1655 spec: aliased CBs are visible until the user
    // explicitly hides them. Sticky across snapshot changes (same as
    // showAbsolute / normalisation) - it's a viewing preference, not a
    // per-DeviceOp selection.
    const [showAliasedCBs, setShowAliasedCBs] = useState<boolean>(true);

    // We render null on close instead of unmounting, so useState slots
    // persist across open/close cycles. Drop the per-snapshot selections
    // whenever a new snapshot arrives — they'd otherwise point at stale
    // nodeIds / cores from the previously-inspected DeviceOp. Normalisation
    // and the byte-overlay toggle are user preferences, so they're kept.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedCore(null);
        setSelectedCBNodeId(null);
    }, [snapshot]);

    if (!isOpen) {
        return null;
    }

    if (!snapshot || !devices) {
        return (
            <Overlay2
                isOpen={isOpen}
                enforceFocus
                hasBackdrop
                usePortal
                canEscapeKeyClose
                transitionDuration={0}
                onClose={onClose}
                canOutsideClickClose
                portalClassName='cb-pressure-overlay'
            >
                <Card className='loading-container'>
                    <LoadingSpinner />
                </Card>
            </Overlay2>
        );
    }

    if (devices.length === 0) {
        return null;
    }

    return (
        <Overlay2
            isOpen={isOpen}
            enforceFocus
            hasBackdrop
            usePortal
            canEscapeKeyClose
            transitionDuration={0}
            onClose={onClose}
            canOutsideClickClose
            portalClassName='cb-pressure-overlay'
        >
            <Card className='cb-pressure'>
                <CircularBufferPressureBody
                    title={title}
                    snapshot={snapshot}
                    deviceWidth={devices[0].num_x_cores}
                    deviceHeight={devices[0].num_y_cores}
                    l1Budget={devices[0].worker_l1_size}
                    selectedCore={selectedCore}
                    setSelectedCore={setSelectedCore}
                    selectedCBNodeId={selectedCBNodeId}
                    setSelectedCBNodeId={setSelectedCBNodeId}
                    normalisation={normalisation}
                    setNormalisation={setNormalisation}
                    showAbsolute={showAbsolute}
                    setShowAbsolute={setShowAbsolute}
                    showAliasedCBs={showAliasedCBs}
                    setShowAliasedCBs={setShowAliasedCBs}
                    onClose={onClose}
                />
            </Card>
        </Overlay2>
    );
};

interface BodyProps {
    title: string;
    snapshot: CBPressureSnapshot;
    deviceWidth: number;
    deviceHeight: number;
    l1Budget: number;
    selectedCore: string | null;
    setSelectedCore: (v: string | null) => void;
    selectedCBNodeId: number | null;
    setSelectedCBNodeId: (v: number | null) => void;
    normalisation: Normalisation;
    setNormalisation: (v: Normalisation) => void;
    showAbsolute: boolean;
    setShowAbsolute: (v: boolean) => void;
    showAliasedCBs: boolean;
    setShowAliasedCBs: (v: boolean) => void;
    onClose: () => void;
}

const CircularBufferPressureBody = ({
    title,
    snapshot,
    deviceWidth,
    deviceHeight,
    l1Budget,
    selectedCore,
    setSelectedCore,
    selectedCBNodeId,
    setSelectedCBNodeId,
    normalisation,
    setNormalisation,
    showAbsolute,
    setShowAbsolute,
    showAliasedCBs,
    setShowAliasedCBs,
    onClose,
}: BodyProps) => {
    // #1655: Aliased (`globallyAllocated`) CBs can flood dense ops where most
    // CBs are tensor views. The toggle relieves grid-density only - the
    // legend keeps all rows always so the right panel stays informationally
    // complete; aliased rows just dim when the toggle is off. The data
    // layer (snapshot.maxBytes, byCore, etc.) already excludes aliased
    // bytes from pressure totals per #1651, so peak / total numbers stay
    // anchored to the anonymous bytes regardless of toggle state.
    const aliasedCount = useMemo(
        () => snapshot.allocations.reduce((n, cb) => n + (cb.globallyAllocated ? 1 : 0), 0),
        [snapshot.allocations],
    );

    // `gridVisibleAllocations` powers the per-core grid strip, zoomed
    // plot, and address-axis window - the surfaces where rendering aliased
    // CBs clutters the dense kernel-side view. The legend deliberately
    // does NOT consume this; it always renders the full list.
    const gridVisibleAllocations: CBAllocationSummary[] = useMemo(() => {
        if (showAliasedCBs) {
            return snapshot.allocations;
        }
        return snapshot.allocations.filter((cb) => !cb.globallyAllocated);
    }, [snapshot.allocations, showAliasedCBs]);

    const hiddenAliasedCount = showAliasedCBs ? 0 : aliasedCount;

    // Quick lookup for "is core part of selected CB" highlighting. Uses
    // the full snapshot so clicking a dimmed aliased row still lights up
    // the cores it touches in the grid - the row stays interactive even
    // when its strip rect is hidden.
    const selectedCBCores: Set<string> | null = useMemo(() => {
        if (selectedCBNodeId === null) {
            return null;
        }
        const cb = snapshot.allocations.find((a) => a.nodeId === selectedCBNodeId);
        if (!cb) {
            return null;
        }
        return new Set(cb.cores.map((c) => CORE_KEY(c.x, c.y)));
    }, [snapshot.allocations, selectedCBNodeId]);

    // Pre-build a per-core CB list so the grid doesn't filter allocations
    // for every cell on every render (cells × allocations gets expensive on
    // big chips). Only cores that actually have a CB get an entry.
    const cbsByCore: Map<string, CBAllocationSummary[]> = useMemo(() => {
        const map = new Map<string, CBAllocationSummary[]>();
        for (const cb of gridVisibleAllocations) {
            for (const c of cb.cores) {
                const key = CORE_KEY(c.x, c.y);
                const list = map.get(key);
                if (list) {
                    list.push(cb);
                } else {
                    map.set(key, [cb]);
                }
            }
        }
        return map;
    }, [gridVisibleAllocations]);

    // CBs that contribute to the currently focused core; powers the "core
    // selected" detail panel without re-walking allocations on every render.
    const cbsForSelectedCore: CBAllocationSummary[] = useMemo(() => {
        if (!selectedCore) {
            return [];
        }
        return cbsByCore.get(selectedCore) ?? [];
    }, [cbsByCore, selectedCore]);

    // Global address-axis clip. Cells share one [memStart, memEnd] so a
    // CB at the same address lines up across cores at the same x-offset.
    // Derives from `gridVisibleAllocations` so that hiding aliased CBs
    // tightens the address window around the anonymous (pressure-
    // contributing) CBs instead of leaving a sparsely-populated strip.
    const [memStart, memEnd] = useMemo(() => {
        let lo = Number.POSITIVE_INFINITY;
        let hi = Number.NEGATIVE_INFINITY;
        // '?' bucket (numCores === 0) is excluded — it doesn't have a
        // meaningful position on the per-core address axis.
        for (const cb of gridVisibleAllocations) {
            if (cb.numCores > 0) {
                if (cb.address < lo) {
                    lo = cb.address;
                }
                const end = cb.address + cb.size;
                if (end > hi) {
                    hi = end;
                }
            }
        }
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
            return [0, 1];
        }
        return [lo, hi];
    }, [gridVisibleAllocations]);

    const norm = normalisation === 'budget' ? l1Budget : snapshot.maxBytes || 1;

    return (
        <>
            <div className='header'>
                <h3 className='title'>
                    <span className='title-text'>{title}</span>
                    <Button
                        icon={IconNames.CROSS}
                        variant={ButtonVariant.MINIMAL}
                        size={Size.SMALL}
                        onClick={onClose}
                    />
                </h3>

                <div className='summary monospace'>
                    <Tag
                        minimal
                        large
                    >
                        Peak: {formatMemorySize(snapshot.maxBytes, 2)}
                    </Tag>
                    <Tag
                        minimal
                        large
                    >
                        L1 budget: {formatMemorySize(l1Budget, 2)}
                    </Tag>
                    <Tag
                        minimal
                        large
                    >
                        CBs: {snapshot.allocations.length}
                    </Tag>
                    {snapshot.unattributedBytes > 0 && (
                        <Tooltip
                            content={
                                <span>
                                    CBs with an empty <code>core_range_set</code> couldn&apos;t be attributed to a
                                    specific worker core. They&apos;re tracked here as a single bucket.
                                </span>
                            }
                        >
                            <Tag
                                intent='warning'
                                large
                            >
                                Unattributed: {formatMemorySize(snapshot.unattributedBytes, 2)}
                            </Tag>
                        </Tooltip>
                    )}
                </div>

                <div className='controls'>
                    <ButtonGroup>
                        <Button
                            size={Size.SMALL}
                            intent={normalisation === 'local' ? 'primary' : 'none'}
                            onClick={() => setNormalisation('local')}
                        >
                            Local max
                        </Button>
                        <Button
                            size={Size.SMALL}
                            intent={normalisation === 'budget' ? 'primary' : 'none'}
                            onClick={() => setNormalisation('budget')}
                        >
                            vs. L1 budget
                        </Button>
                    </ButtonGroup>
                    <Switch
                        checked={showAbsolute}
                        label='Show bytes on cells'
                        onChange={(e) => setShowAbsolute(e.currentTarget.checked)}
                    />
                    {/* The aliased-CB toggle only renders when this snapshot
                        has aliased CBs to hide - otherwise it's a no-op
                        affordance that just adds noise to the control row.
                        See #1655 for the design rationale (default-on,
                        per-snapshot opt-out, sibling to "Show bytes"). */}
                    {aliasedCount > 0 && (
                        <div className='aliased-toggle'>
                            <Switch
                                checked={showAliasedCBs}
                                label='Show globally allocated CBs'
                                onChange={(e) => setShowAliasedCBs(e.currentTarget.checked)}
                            />
                            {hiddenAliasedCount > 0 && (
                                <span className='aliased-hidden-hint monospace'>({hiddenAliasedCount} hidden)</span>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className='chip-and-legend'>
                <div className='chip'>
                    {memEnd > memStart && (
                        <div className='axis-caption monospace'>
                            <span>{prettyPrintAddress(memStart, l1Budget)}</span>
                            <span className='axis-range'>
                                {/* "Address range" rather than "L1 address window" so the
                                    chart-window size doesn't get conflated with the per-core
                                    L1 capacity shown in the header's `L1 budget` tag — they
                                    are different quantities measured in different bytes. */}
                                Address range · {formatMemorySize(memEnd - memStart, 2)}
                            </span>
                            <span>{prettyPrintAddress(memEnd, l1Budget)}</span>
                        </div>
                    )}
                    <div
                        className='tensix-grid'
                        style={{
                            gridTemplateColumns: `repeat(${deviceWidth || 0}, minmax(0, ${TENSIX_WIDTH}px))`,
                            gridTemplateRows: `repeat(${deviceHeight || 0}, ${TENSIX_HEIGHT}px)`,
                        }}
                    >
                        {Array.from({ length: deviceWidth * deviceHeight }).map((_, index) => {
                            const x = index % deviceWidth;
                            const y = Math.floor(index / deviceWidth);
                            const key = CORE_KEY(x, y);
                            const bytes = snapshot.byCore[key] ?? 0;
                            const intensity = bytes === 0 ? 0 : Math.min(1, bytes / (norm || 1));
                            const isActive = selectedCore === key;
                            const isHighlighted = selectedCBCores?.has(key) ?? false;
                            const overBudget = bytes > l1Budget;
                            const coreCBs = cbsByCore.get(key) ?? [];

                            return (
                                <button
                                    type='button'
                                    key={key}
                                    className={classNames('tensix', {
                                        'has-bytes': bytes > 0,
                                        active: isActive,
                                        highlighted: isHighlighted,
                                        'over-budget': overBudget,
                                    })}
                                    style={{
                                        gridColumn: x + 1,
                                        gridRow: y + 1,
                                        // SCSS picks this up to drive the
                                        // heatmap wash behind the address strip.
                                        ['--cb-intensity' as string]: intensity.toFixed(3),
                                    }}
                                    onClick={() => setSelectedCore(isActive ? null : key)}
                                    title={`(${x}, ${y})  ${formatMemorySize(bytes, 2)}${
                                        bytes > 0 ? `  (${((bytes / l1Budget) * 100).toFixed(1)}% of L1)` : ''
                                    }`}
                                >
                                    <span className='tensix-meta'>
                                        <span className='coord monospace'>
                                            {x},{y}
                                        </span>
                                        {showAbsolute && bytes > 0 && (
                                            <span className='value monospace'>{formatMemorySize(bytes, 2)}</span>
                                        )}
                                    </span>
                                    {coreCBs.length > 0 && (
                                        <MiniCBStrip
                                            cbs={coreCBs}
                                            memoryStart={memStart}
                                            memoryEnd={memEnd}
                                            selectedCBNodeId={selectedCBNodeId}
                                        />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className='legend'>
                    <h4>Circular buffers</h4>
                    {snapshot.allocations.length === 0 && (
                        <p className='empty-message'>No live CBs in this DeviceOp.</p>
                    )}
                    <ul className='cb-list'>
                        {snapshot.allocations.map((cb) => {
                            const isSelected = selectedCBNodeId === cb.nodeId;
                            const swatchColor = cbColor(cb);
                            const isAliased = cb.globallyAllocated;
                            // Dim aliased rows when the toggle is off.
                            // Visual demotion only - the row stays clickable
                            // (selection still highlights cores in the grid),
                            // it just reads as secondary to the anonymous CBs
                            // the user is currently focused on.
                            const isDimmed = isAliased && !showAliasedCBs;
                            // Outline-only fill for aliased CBs ("border" instead of "background")
                            // mirrors the in-cell strip treatment and keeps the colour signal
                            // tied to the tensor they alias. See #1651.
                            const swatchStyle = isAliased
                                ? { borderColor: swatchColor, backgroundColor: 'transparent' }
                                : { backgroundColor: swatchColor, borderColor: swatchColor };
                            const aliasedTooltip = (
                                <span>
                                    Aliased to tensor @ {prettyPrintAddress(cb.address, l1Budget)} &mdash; no new
                                    allocation
                                </span>
                            );
                            const row = (
                                <button
                                    type='button'
                                    className={classNames('cb-row', {
                                        active: isSelected,
                                        aliased: isAliased,
                                        'aliased-dimmed': isDimmed,
                                    })}
                                    onClick={() => setSelectedCBNodeId(isSelected ? null : cb.nodeId)}
                                >
                                    <span
                                        className={classNames('swatch', { 'swatch-outline': isAliased })}
                                        style={swatchStyle}
                                    />
                                    <span className='cb-row-body monospace'>
                                        <span className='addr'>{prettyPrintAddress(cb.address, l1Budget)}</span>
                                        <span className='size'>{formatMemorySize(cb.size, 2)}</span>
                                        <span className='cores'>
                                            {cb.numCores > 0 ? `× ${cb.numCores} cores` : 'unattributed'}
                                        </span>
                                    </span>
                                    {isAliased && (
                                        <span
                                            className='aliased-marker'
                                            // Inline aria-label keeps the row a single tab-stop
                                            // while still surfacing the "aliased" semantic to AT.
                                            aria-label='Globally allocated — aliased to tensor at this address'
                                        >
                                            <Icon
                                                icon={IconNames.LINK}
                                                size={11}
                                            />
                                            <span className='aliased-label'>Globally allocated</span>
                                        </span>
                                    )}
                                </button>
                            );
                            return (
                                <li key={cb.nodeId}>
                                    {isAliased ? (
                                        <Tooltip
                                            content={aliasedTooltip}
                                            position={PopoverPosition.LEFT}
                                        >
                                            {row}
                                        </Tooltip>
                                    ) : (
                                        row
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                    {snapshot.allocations.length > 0 &&
                        (() => {
                            // Filter out globally-allocated (aliased) CBs so this
                            // sum matches snapshot.maxBytes' semantics - aliased
                            // CBs are views into existing tensors, intentionally
                            // excluded from per-core pressure totals (#1651). If
                            // we left them in, `cbSum > maxBytes` would fire any
                            // time the snapshot has aliased CBs even when all
                            // anonymous CBs share the same cores, mis-firing the
                            // tooltip's "disjoint core sets" explanation.
                            const cbSum = snapshot.allocations
                                .filter((cb) => !cb.globallyAllocated)
                                .reduce((sum, cb) => sum + cb.size, 0);
                            // Sum only diverges from peak when CBs span disjoint
                            // core sets (no single core carries the full sum).
                            // Hiding it in the common case keeps the legend
                            // uncluttered; surfacing it on divergence makes
                            // the "CBs don't share core sets" signal explicit.
                            const showSum = cbSum > snapshot.maxBytes;
                            return (
                                <div className='cb-list-totals monospace'>
                                    <Tooltip
                                        content={
                                            <span>
                                                Highest per-core CB load. Caps L1 budget headroom; matches the Peak tag
                                                in the header.
                                            </span>
                                        }
                                        position={PopoverPosition.TOP}
                                    >
                                        <div className='cb-list-total row-peak'>
                                            <span className='label'>Peak per core</span>
                                            <span className='value'>{formatMemorySize(snapshot.maxBytes, 2)}</span>
                                        </div>
                                    </Tooltip>
                                    {showSum && (
                                        <Tooltip
                                            content={
                                                <span>
                                                    Total CB bytes across the snapshot (sum of each CB&apos;s per-core
                                                    size). Larger than peak here because CBs land on disjoint core sets
                                                    &mdash; no single core carries the full total.
                                                </span>
                                            }
                                            position={PopoverPosition.TOP}
                                        >
                                            <div className='cb-list-total row-sum'>
                                                <span className='label'>Total CBs</span>
                                                <span className='value'>{formatMemorySize(cbSum, 2)}</span>
                                            </div>
                                        </Tooltip>
                                    )}
                                </div>
                            );
                        })()}
                </div>
            </div>

            {selectedCore && (
                <div className='tensix-details'>
                    <div className='tensix-details-header'>
                        <h4 className='monospace'>
                            Core ({selectedCore}) · {formatMemorySize(snapshot.byCore[selectedCore] ?? 0, 2)}
                            <span className='subtle'>
                                {' '}
                                · {cbsForSelectedCore.length} {cbsForSelectedCore.length === 1 ? 'CB' : 'CBs'}
                            </span>
                        </h4>
                        <Button
                            icon={IconNames.CROSS}
                            variant={ButtonVariant.MINIMAL}
                            size={Size.SMALL}
                            onClick={() => setSelectedCore(null)}
                        />
                    </div>
                    {cbsForSelectedCore.length === 0 ? (
                        <p className='empty-message'>No CB contributions for this core.</p>
                    ) : (
                        <ZoomedCorePlot
                            cbs={cbsForSelectedCore}
                            memoryStart={memStart}
                            memoryEnd={memEnd}
                            l1Budget={l1Budget}
                            selectedCBNodeId={selectedCBNodeId}
                            onSelectCB={setSelectedCBNodeId}
                        />
                    )}
                </div>
            )}
        </>
    );
};

export default CircularBufferPressureModal;
