// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useMemo, useState } from 'react';
import {
    Button,
    ButtonGroup,
    ButtonVariant,
    Card,
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

// Fallback grey for the rare case where the palette generator returns
// undefined (e.g. address falls outside its known bands); keeps the rect
// visible instead of letting SVG default to black.
const CB_FALLBACK_COLOR = '#888';

const cbColor = (cb: CBAllocationSummary): string =>
    getBufferColor(cb.address + (cb.allocateOperationId ?? 0)) ?? CB_FALLBACK_COLOR;

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
 */
const MiniCBStrip = ({ cbs, memoryStart, memoryEnd, selectedCBNodeId }: MiniCBStripProps) => {
    const memoryRange = Math.max(1, memoryEnd - memoryStart);
    return (
        <svg
            className='cb-strip'
            height={STRIP_HEIGHT}
            width='100%'
            preserveAspectRatio='none'
        >
            {cbs.map((cb) => {
                const xPercent = ((cb.address - memoryStart) / memoryRange) * 100;
                const widthPercent = (cb.size / memoryRange) * 100;
                const isSelected = selectedCBNodeId === cb.nodeId;
                return (
                    <rect
                        key={cb.nodeId}
                        x={`${xPercent}%`}
                        y={0}
                        width={`${widthPercent}%`}
                        height={STRIP_HEIGHT}
                        fill={cbColor(cb)}
                        className={classNames('cb-strip-chunk', { selected: isSelected })}
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
    // Pixel threshold above which we surface the inline `addr · size`
    // label. Below this the rect collapses to colour-only and we lean
    // on the tooltip / legend for identity.
    const MIN_PX_FOR_LABEL = 70;

    return (
        <div className='zoomed-core-plot'>
            <svg
                className='zoomed-core-svg'
                width='100%'
                height={plotHeight}
                preserveAspectRatio='none'
            >
                {cbs.map((cb) => {
                    const xPercent = ((cb.address - memoryStart) / memoryRange) * 100;
                    const widthPercent = (cb.size / memoryRange) * 100;
                    const isSelected = selectedCBNodeId === cb.nodeId;
                    // Width-as-fraction-of-window is enough to decide whether
                    // there's room for a label without forcing a layout pass.
                    const labelFits = widthPercent > MIN_PX_FOR_LABEL / 6;
                    return (
                        <g
                            key={cb.nodeId}
                            className={classNames('zoomed-chunk', { selected: isSelected })}
                            onClick={() => onSelectCB(isSelected ? null : cb.nodeId)}
                        >
                            <title>{`${prettyPrintAddress(cb.address, l1Budget)}  ${formatMemorySize(cb.size, 2)}`}</title>
                            <rect
                                x={`${xPercent}%`}
                                y={0}
                                width={`${widthPercent}%`}
                                height={plotHeight}
                                fill={cbColor(cb)}
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
    onClose,
}: BodyProps) => {
    // Quick lookup for "is core part of selected CB" highlighting.
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
        for (const cb of snapshot.allocations) {
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
    }, [snapshot.allocations]);

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
    const [memStart, memEnd] = useMemo(() => {
        let lo = Number.POSITIVE_INFINITY;
        let hi = Number.NEGATIVE_INFINITY;
        // '?' bucket (numCores === 0) is excluded — it doesn't have a
        // meaningful position on the per-core address axis.
        for (const cb of snapshot.allocations) {
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
    }, [snapshot.allocations]);

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
                </div>
            </div>

            <div className='chip-and-legend'>
                <div className='chip'>
                    {memEnd > memStart && (
                        <div className='axis-caption monospace'>
                            <span>{prettyPrintAddress(memStart, l1Budget)}</span>
                            <span className='axis-range'>
                                L1 address window · {formatMemorySize(memEnd - memStart, 2)}
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
                    <ul className='cb-list with-total'>
                        {snapshot.allocations.map((cb) => {
                            const isSelected = selectedCBNodeId === cb.nodeId;
                            const swatchColor = getBufferColor(cb.address + (cb.allocateOperationId ?? 0));
                            return (
                                <li key={cb.nodeId}>
                                    <button
                                        type='button'
                                        className={classNames('cb-row', { active: isSelected })}
                                        onClick={() => setSelectedCBNodeId(isSelected ? null : cb.nodeId)}
                                    >
                                        <span
                                            className='swatch'
                                            style={{ backgroundColor: swatchColor }}
                                        />
                                        <span className='cb-row-body monospace'>
                                            <span className='addr'>{prettyPrintAddress(cb.address, l1Budget)}</span>
                                            <span className='size'>{formatMemorySize(cb.size, 2)}</span>
                                            <span className='cores'>
                                                {cb.numCores > 0 ? `× ${cb.numCores} cores` : 'unattributed'}
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    {snapshot.allocations.length > 0 &&
                        (() => {
                            const cbSum = snapshot.allocations.reduce((sum, cb) => sum + cb.size, 0);
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
