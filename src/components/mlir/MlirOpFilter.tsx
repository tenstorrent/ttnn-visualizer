// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { KeyboardEvent, forwardRef, useImperativeHandle, useRef } from 'react';
import { Button, ButtonVariant, InputGroup } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import 'styles/components/MlirOpFilter.scss';

export interface MlirOpFilterHandle {
    focus: () => void;
}

interface MlirOpFilterProps {
    query: string;
    onQueryChange: (next: string) => void;
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
    ({ query, onQueryChange, matchCount, hiddenMatchCount, currentMatchIndex, onPrev, onNext }, ref) => {
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
        const hiddenSuffix = hiddenMatchCount > 0 ? ` (+${hiddenMatchCount} inside)` : '';
        let counterText: string | null = null;
        if (hasQuery) {
            if (matchCount === 0 && hiddenMatchCount === 0) {
                counterText = 'no matches';
            } else if (currentMatchIndex !== null) {
                counterText = `${currentMatchIndex + 1} / ${matchCount}${hiddenSuffix}`;
            } else {
                counterText = `${matchCount} matches${hiddenSuffix}`;
            }
        }

        return (
            <div className='mlir-op-filter'>
                <InputGroup
                    inputRef={inputRef}
                    leftIcon={IconNames.SEARCH}
                    placeholder='Filter ops (substring)'
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    onKeyDown={handleKeyDown}
                    rightElement={
                        hasQuery ? (
                            <Button
                                className='mlir-op-filter-clear'
                                variant={ButtonVariant.MINIMAL}
                                icon={IconNames.CROSS}
                                aria-label='Clear filter'
                                onClick={() => onQueryChange('')}
                            />
                        ) : undefined
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
