// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, ButtonVariant, PopoverPosition, Switch, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { type FormEvent, type Ref, memo } from 'react';
import GraphOpFilter, { type GraphOpFilterHandle } from '../GraphOpFilter';
import type { GraphFilterMode } from '../../definitions/GraphFilterMode';
import { CRITICAL_PATH_TOOLTIP, PERF_OVERLAY_TOOLTIP, PerfOverlayStatus } from '../../definitions/PerfOverlayStatus';
import 'styles/components/OpGraphToolbar.scss';

interface PerfGatedSwitchProps {
    tooltipByStatus: Record<PerfOverlayStatus, string>;
    label: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    perfOverlayStatus: PerfOverlayStatus;
    isDisabled: boolean;
}

// Both switches read per-op durations, so a report that can't feed the bars can't
// weigh the path either — the gate below is that shared contract, held in one
// place so the two can't drift apart. #1613
//
// The tooltip is bound to the Switch, not a wrapper: Blueprint targets the
// enclosing label, which still emits pointer events while the input is disabled —
// and disabled is when the tooltip explaining why matters most. #1880
const PerfGatedSwitch = ({
    tooltipByStatus,
    label,
    checked,
    onChange,
    perfOverlayStatus,
    isDisabled,
}: PerfGatedSwitchProps) => (
    <Tooltip
        placement={PopoverPosition.BOTTOM}
        content={tooltipByStatus[perfOverlayStatus]}
    >
        <Switch
            className='op-graph-toolbar-switch'
            checked={checked}
            onChange={(event: FormEvent<HTMLInputElement>) => onChange(event.currentTarget.checked)}
            label={label}
            disabled={isDisabled || perfOverlayStatus !== PerfOverlayStatus.READY}
        />
    </Tooltip>
);

interface OpGraphToolbarProps {
    filterRef: Ref<GraphOpFilterHandle>;
    query: string;
    onQueryChange: (next: string) => void;
    mode: GraphFilterMode;
    onModeChange: (next: GraphFilterMode) => void;
    isRegexInvalid: boolean;
    matchCount: number;
    currentMatchIndex: number | null;
    onPrevMatch: () => void;
    onNextMatch: () => void;
    selectedOperationId: number | null;
    previousOperationId: number | null;
    nextOperationId: number | null;
    onGoToOperation: (operationId: number) => void;
    hideDeallocate: boolean;
    onHideDeallocateChange: (next: boolean) => void;
    focusUnrelatedEdges: boolean;
    onFocusUnrelatedEdgesChange: (next: boolean) => void;
    isPerfOverlayActive: boolean;
    onPerfOverlayChange: (next: boolean) => void;
    isCriticalPathActive: boolean;
    onCriticalPathChange: (next: boolean) => void;
    perfOverlayStatus: PerfOverlayStatus;
    linkedOpCount: number;
    totalOpCount: number;
    isDisabled: boolean;
    hiddenMatchCount?: number;
    hasBlocks?: boolean;
    areAllBlocksExpanded?: boolean;
    areAllBlocksCollapsed?: boolean;
    onExpandAllBlocks?: () => void;
    onCollapseAllBlocks?: () => void;
}

const OpGraphToolbar = memo(
    ({
        filterRef,
        query,
        onQueryChange,
        mode,
        onModeChange,
        isRegexInvalid,
        matchCount,
        currentMatchIndex,
        onPrevMatch,
        onNextMatch,
        selectedOperationId,
        previousOperationId,
        nextOperationId,
        onGoToOperation,
        hideDeallocate,
        onHideDeallocateChange,
        focusUnrelatedEdges,
        onFocusUnrelatedEdgesChange,
        isPerfOverlayActive,
        onPerfOverlayChange,
        isCriticalPathActive,
        onCriticalPathChange,
        perfOverlayStatus,
        linkedOpCount,
        totalOpCount,
        isDisabled,
        hiddenMatchCount = 0,
        hasBlocks = false,
        areAllBlocksExpanded = false,
        areAllBlocksCollapsed = true,
        onExpandAllBlocks,
        onCollapseAllBlocks,
    }: OpGraphToolbarProps) => (
        <div className='op-graph-toolbar'>
            <GraphOpFilter
                ref={filterRef}
                query={query}
                onQueryChange={onQueryChange}
                mode={mode}
                onModeChange={onModeChange}
                isRegexInvalid={isRegexInvalid}
                matchCount={matchCount}
                currentMatchIndex={currentMatchIndex}
                onPrev={onPrevMatch}
                onNext={onNextMatch}
                hiddenMatchCount={hiddenMatchCount}
                isDisabled={isDisabled}
            />

            <div className='op-graph-toolbar-row'>
                <Tooltip
                    placement={PopoverPosition.BOTTOM}
                    content={`Go to previous operation ${previousOperationId}`}
                    disabled={isDisabled || previousOperationId === null}
                >
                    <Button
                        icon={IconNames.ARROW_LEFT}
                        variant={ButtonVariant.OUTLINED}
                        disabled={isDisabled || previousOperationId === null}
                        onClick={() => previousOperationId !== null && onGoToOperation(previousOperationId)}
                        aria-label={
                            previousOperationId !== null
                                ? `Go to previous operation ${previousOperationId}`
                                : 'No previous operation'
                        }
                    />
                </Tooltip>
                <Tooltip
                    placement={PopoverPosition.BOTTOM}
                    content={`Center on operation ${selectedOperationId}`}
                    disabled={isDisabled || selectedOperationId === null}
                >
                    <Button
                        variant={ButtonVariant.OUTLINED}
                        disabled={isDisabled || selectedOperationId === null}
                        onClick={() => selectedOperationId !== null && onGoToOperation(selectedOperationId)}
                        aria-label={
                            selectedOperationId !== null
                                ? `Center on operation ${selectedOperationId}`
                                : 'No operation selected'
                        }
                    >
                        {selectedOperationId}
                    </Button>
                </Tooltip>
                <Tooltip
                    placement={PopoverPosition.BOTTOM}
                    content={`Go to next operation ${nextOperationId}`}
                    disabled={isDisabled || nextOperationId === null}
                >
                    <Button
                        icon={IconNames.ARROW_RIGHT}
                        variant={ButtonVariant.OUTLINED}
                        disabled={isDisabled || nextOperationId === null}
                        onClick={() => nextOperationId !== null && onGoToOperation(nextOperationId)}
                        aria-label={
                            nextOperationId !== null ? `Go to next operation ${nextOperationId}` : 'No next operation'
                        }
                    />
                </Tooltip>

                <Switch
                    className='op-graph-toolbar-switch'
                    checked={hideDeallocate}
                    onChange={(event: FormEvent<HTMLInputElement>) =>
                        onHideDeallocateChange(event.currentTarget.checked)
                    }
                    label='Hide deallocate ops'
                    disabled={isDisabled}
                />

                <Switch
                    className='op-graph-toolbar-switch'
                    checked={focusUnrelatedEdges}
                    onChange={(event: FormEvent<HTMLInputElement>) =>
                        onFocusUnrelatedEdgesChange(event.currentTarget.checked)
                    }
                    label='Dim unrelated edges'
                    disabled={isDisabled}
                />

                <PerfGatedSwitch
                    tooltipByStatus={PERF_OVERLAY_TOOLTIP}
                    label={
                        perfOverlayStatus === PerfOverlayStatus.READY
                            ? `Perf overlay (${linkedOpCount}/${totalOpCount})`
                            : 'Perf overlay'
                    }
                    checked={isPerfOverlayActive}
                    onChange={onPerfOverlayChange}
                    perfOverlayStatus={perfOverlayStatus}
                    isDisabled={isDisabled}
                />

                <PerfGatedSwitch
                    tooltipByStatus={CRITICAL_PATH_TOOLTIP}
                    label='Highlight critical path'
                    checked={isCriticalPathActive}
                    onChange={onCriticalPathChange}
                    perfOverlayStatus={perfOverlayStatus}
                    isDisabled={isDisabled}
                />
            </div>

            {hasBlocks ? (
                <div className='op-graph-toolbar-row'>
                    <span className='op-graph-toolbar-group-label'>Repeats</span>
                    <Button
                        variant={ButtonVariant.OUTLINED}
                        disabled={isDisabled || areAllBlocksExpanded}
                        onClick={onExpandAllBlocks}
                        aria-label='Unroll all repeats'
                    >
                        Unroll
                    </Button>
                    <Button
                        variant={ButtonVariant.OUTLINED}
                        disabled={isDisabled || areAllBlocksCollapsed}
                        onClick={onCollapseAllBlocks}
                        aria-label='Fold all repeats'
                    >
                        Fold
                    </Button>
                </div>
            ) : null}
        </div>
    ),
);

OpGraphToolbar.displayName = 'OpGraphToolbar';

export default OpGraphToolbar;
