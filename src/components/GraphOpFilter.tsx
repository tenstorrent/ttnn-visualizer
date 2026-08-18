// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, ButtonVariant, InputGroup, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { type KeyboardEvent, forwardRef, memo, useImperativeHandle, useRef } from 'react';
import { GraphFilterMode } from '../definitions/GraphFilterMode';
import 'styles/components/GraphOpFilter.scss';

export interface GraphOpFilterHandle {
    focus: () => void;
}

interface GraphOpFilterProps {
    query: string;
    onQueryChange: (next: string) => void;
    mode: GraphFilterMode;
    onModeChange: (next: GraphFilterMode) => void;
    // True only when in regex mode and the current query fails to compile —
    // drives the danger-intent input styling and the counter text.
    isRegexInvalid: boolean;
    // What prev/next steps through. In MLIR a collapsed anchor standing in for
    // buried descendants counts as one.
    matchCount: number;
    // 0-based cursor within `matchCount`, or null when no match is focused.
    currentMatchIndex: number | null;
    onPrev: () => void;
    onNext: () => void;
    // Matches hidden inside collapsed namespaces, which drives the "+K inside"
    // suffix. Only MLIR has a hierarchy deep enough to bury one.
    hiddenMatchCount?: number;
    isDisabled?: boolean;
}

// Input, counter and prev/next only; the dim/highlight lives in the view that
// owns the canvas.
const GraphOpFilterInner = forwardRef<GraphOpFilterHandle, GraphOpFilterProps>(
    (
        {
            query,
            onQueryChange,
            mode,
            onModeChange,
            isRegexInvalid,
            matchCount,
            currentMatchIndex,
            onPrev,
            onNext,
            hiddenMatchCount = 0,
            isDisabled = false,
        },
        ref,
    ) => {
        const inputRef = useRef<HTMLInputElement>(null);

        useImperativeHandle(ref, () => ({
            focus: () => {
                inputRef.current?.focus();
                inputRef.current?.select();
            },
        }));

        const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onQueryChange('');
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                if (event.shiftKey) {
                    onPrev();
                } else {
                    onNext();
                }
            }
        };

        const hasQuery = query.length > 0;
        const isRegexMode = mode === GraphFilterMode.REGEX;
        const hiddenSuffix = hiddenMatchCount > 0 ? ` (+${hiddenMatchCount} inside)` : '';
        // A cursor left over from a wider match set would render an impossible
        // ratio like "5 / 2" after the query narrows — or, in MLIR, after an
        // expand/collapse changed which reps are visible.
        const activeMatchIndex =
            currentMatchIndex !== null && currentMatchIndex < matchCount ? currentMatchIndex : null;
        let counterText: string | null = null;
        if (hasQuery) {
            if (isRegexInvalid) {
                counterText = 'invalid regex';
            } else if (matchCount === 0 && hiddenMatchCount === 0) {
                counterText = 'no matches';
            } else if (activeMatchIndex !== null) {
                counterText = `${activeMatchIndex + 1} / ${matchCount}${hiddenSuffix}`;
            } else {
                counterText = `${matchCount} matches${hiddenSuffix}`;
            }
        }

        const toggleMode = () => onModeChange(isRegexMode ? GraphFilterMode.SUBSTRING : GraphFilterMode.REGEX);

        return (
            <div className='graph-op-filter'>
                <InputGroup
                    inputRef={inputRef}
                    leftIcon={IconNames.SEARCH}
                    placeholder={isRegexMode ? 'Filter ops (regex)' : 'Filter ops (substring)'}
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    onKeyDown={handleKeyDown}
                    intent={isRegexInvalid ? Intent.DANGER : Intent.NONE}
                    disabled={isDisabled}
                    rightElement={
                        <div className='graph-op-filter-right-slot'>
                            <Button
                                className='graph-op-filter-mode'
                                variant={ButtonVariant.MINIMAL}
                                active={isRegexMode}
                                text='.*'
                                aria-label={isRegexMode ? 'Switch to substring mode' : 'Switch to regex mode'}
                                title={
                                    isRegexMode
                                        ? 'Regex mode (click for substring)'
                                        : 'Substring mode (click for regex)'
                                }
                                onClick={toggleMode}
                            />
                            {hasQuery ? (
                                <Button
                                    className='graph-op-filter-clear'
                                    variant={ButtonVariant.MINIMAL}
                                    icon={IconNames.CROSS}
                                    aria-label='Clear filter'
                                    onClick={() => onQueryChange('')}
                                />
                            ) : null}
                        </div>
                    }
                    spellCheck={false}
                    autoComplete='off'
                />
                {counterText ? <span className='graph-op-filter-counter'>{counterText}</span> : null}
                <Button
                    className='graph-op-filter-step'
                    variant={ButtonVariant.MINIMAL}
                    icon={IconNames.CHEVRON_UP}
                    aria-label='Previous match'
                    disabled={isDisabled || matchCount === 0}
                    onClick={onPrev}
                />
                <Button
                    className='graph-op-filter-step'
                    variant={ButtonVariant.MINIMAL}
                    icon={IconNames.CHEVRON_DOWN}
                    aria-label='Next match'
                    disabled={isDisabled || matchCount === 0}
                    onClick={onNext}
                />
            </div>
        );
    },
);

const GraphOpFilter = memo(GraphOpFilterInner);
GraphOpFilter.displayName = 'GraphOpFilter';

export default GraphOpFilter;
