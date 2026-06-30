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
    matchCount: number;
    // 0-based index of the currently focused match within `matchCount`, or
    // null when nothing is focused (e.g. before any prev/next click).
    currentMatchIndex: number | null;
    onPrev: () => void;
    onNext: () => void;
}

// Floating filter control mounted over the React Flow canvas. The visible
// dim/highlight behaviour lives in the view component; this is purely the
// input + match-count + prev/next surface.
const MlirOpFilter = forwardRef<MlirOpFilterHandle, MlirOpFilterProps>(
    ({ query, onQueryChange, matchCount, currentMatchIndex, onPrev, onNext }, ref) => {
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
        let counterText: string | null = null;
        if (hasQuery) {
            if (matchCount === 0) {
                counterText = 'no matches';
            } else if (currentMatchIndex !== null) {
                counterText = `${currentMatchIndex + 1} / ${matchCount}`;
            } else {
                counterText = `${matchCount} matches`;
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
                        counterText ? <span className='mlir-op-filter-counter'>{counterText}</span> : undefined
                    }
                    spellCheck={false}
                    autoComplete='off'
                />
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
