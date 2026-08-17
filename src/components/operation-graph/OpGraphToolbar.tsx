// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, ButtonVariant, PopoverPosition, Switch, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { type FormEvent, type Ref, memo } from 'react';
import { PERF_OVERLAY_TOOLTIP, PerfOverlayStatus } from '../../definitions/PerfOverlayStatus';
import OpGraphFilter, { type OpGraphFilterHandle } from './OpGraphFilter';
import type { OpGraphFilterMode } from './opGraphFilterMatcher';
import 'styles/components/OpGraphToolbar.scss';

interface OpGraphToolbarProps {
    filterRef: Ref<OpGraphFilterHandle>;
    query: string;
    onQueryChange: (next: string) => void;
    mode: OpGraphFilterMode;
    onModeChange: (next: OpGraphFilterMode) => void;
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
    isPerfOverlayActive: boolean;
    onPerfOverlayChange: (next: boolean) => void;
    perfOverlayStatus: PerfOverlayStatus;
    linkedOpCount: number;
    totalOpCount: number;
    isDisabled: boolean;
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
        isPerfOverlayActive,
        onPerfOverlayChange,
        perfOverlayStatus,
        linkedOpCount,
        totalOpCount,
        isDisabled,
    }: OpGraphToolbarProps) => (
        <div className='op-graph-toolbar'>
            <OpGraphFilter
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

                {/* Bound to the Switch itself, not a wrapper: Blueprint's
                    tooltip target is the enclosing label, which keeps emitting
                    pointer events while the input inside it is disabled. That
                    matters because the two states that disable this control are
                    exactly the ones whose tooltip explains why. #1880 */}
                <Tooltip
                    placement={PopoverPosition.BOTTOM}
                    content={PERF_OVERLAY_TOOLTIP[perfOverlayStatus]}
                >
                    <Switch
                        className='op-graph-toolbar-switch'
                        checked={isPerfOverlayActive}
                        onChange={(event: FormEvent<HTMLInputElement>) =>
                            onPerfOverlayChange(event.currentTarget.checked)
                        }
                        label={
                            perfOverlayStatus === PerfOverlayStatus.READY
                                ? `Perf overlay (${linkedOpCount}/${totalOpCount})`
                                : 'Perf overlay'
                        }
                        disabled={isDisabled || perfOverlayStatus !== PerfOverlayStatus.READY}
                    />
                </Tooltip>
            </div>
        </div>
    ),
);

OpGraphToolbar.displayName = 'OpGraphToolbar';

export default OpGraphToolbar;
