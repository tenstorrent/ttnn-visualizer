// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type KeyboardEvent, forwardRef, useImperativeHandle, useRef } from 'react';
import { Button, ButtonVariant, InputGroup, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import 'styles/components/MlirOpFilter.scss';
import { MlirFilterMode } from './mlirFilter';

export { MlirFilterMode };

export interface MlirOpFilterHandle {
    focus: () => void;
}

interface MlirOpFilterProps {
    query: string;
    onQueryChange: (next: string) => void;
    mode: MlirFilterMode;
    onModeChange: (next: MlirFilterMode) => void;
    // True only when in regex mode and the current query fails to compile —
    // drives the danger-intent input styling and the counter text.
    isRegexInvalid: boolean;
    // Number of visible reps prev/next steps through; collapsed anchors
    // standing in for buried descendants are counted here.
    matchCount: number;
    // Buried descendants across all anchors; drives the "+K inside" suffix.
    hiddenMatchCount: number;
    // 0-based cursor within `matchCount`, or null when no match is focused.
    currentMatchIndex: number | null;
    onPrev: () => void;
    onNext: () => void;
}

// Floating filter control over the React Flow canvas. Dim/highlight lives
// in the view component; this is just the input + counter + prev/next.
const MlirOpFilter = forwardRef<MlirOpFilterHandle, MlirOpFilterProps>(
    (
        {
            query,
            onQueryChange,
            mode,
            onModeChange,
            isRegexInvalid,
            matchCount,
            hiddenMatchCount,
            currentMatchIndex,
            onPrev,
            onNext,
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
        const isRegexMode = mode === MlirFilterMode.Regex;
        const hiddenSuffix = hiddenMatchCount > 0 ? ` (+${hiddenMatchCount} inside)` : '';
        // Ignore a stale cursor whose index no longer lives inside the current
        // match set (e.g. after an expand/collapse changed the visible reps)
        // so the counter can't render impossible ratios like "5 / 2".
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

        const toggleMode = () => onModeChange(isRegexMode ? MlirFilterMode.Substring : MlirFilterMode.Regex);

        return (
            <div className='mlir-op-filter'>
                <InputGroup
                    inputRef={inputRef}
                    leftIcon={IconNames.SEARCH}
                    placeholder={isRegexMode ? 'Filter ops (regex)' : 'Filter ops (substring)'}
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    onKeyDown={handleKeyDown}
                    intent={isRegexInvalid ? Intent.DANGER : Intent.NONE}
                    rightElement={
                        <div className='mlir-op-filter-right-slot'>
                            <Button
                                className='mlir-op-filter-mode'
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
                                    className='mlir-op-filter-clear'
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
                {counterText ? <span className='mlir-op-filter-counter'>{counterText}</span> : null}
                <Button
                    className='mlir-op-filter-step'
                    variant={ButtonVariant.MINIMAL}
                    icon={IconNames.CHEVRON_UP}
                    aria-label='Previous match'
                    disabled={matchCount === 0}
                    onClick={onPrev}
                />
                <Button
                    className='mlir-op-filter-step'
                    variant={ButtonVariant.MINIMAL}
                    icon={IconNames.CHEVRON_DOWN}
                    aria-label='Next match'
                    disabled={matchCount === 0}
                    onClick={onNext}
                />
            </div>
        );
    },
);

MlirOpFilter.displayName = 'MlirOpFilter';

export default MlirOpFilter;
