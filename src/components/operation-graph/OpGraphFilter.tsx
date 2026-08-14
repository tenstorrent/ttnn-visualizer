// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, ButtonVariant, InputGroup, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { type KeyboardEvent, forwardRef, memo, useImperativeHandle, useRef } from 'react';
import { OpGraphFilterMode } from './opGraphFilterMatcher';
import 'styles/components/OpGraphFilter.scss';

export interface OpGraphFilterHandle {
    focus: () => void;
}

interface OpGraphFilterProps {
    query: string;
    onQueryChange: (next: string) => void;
    mode: OpGraphFilterMode;
    onModeChange: (next: OpGraphFilterMode) => void;
    isRegexInvalid: boolean;
    matchCount: number;
    // 0-based cursor within `matchCount`, or null when no match is focused.
    currentMatchIndex: number | null;
    onPrev: () => void;
    onNext: () => void;
    isDisabled: boolean;
}

// Input, counter and prev/next only; the fade itself lives in the view.
const OpGraphFilterInner = forwardRef<OpGraphFilterHandle, OpGraphFilterProps>(
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
            isDisabled,
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
        const isRegexMode = mode === OpGraphFilterMode.REGEX;
        // A cursor left over from a wider match set would render an impossible
        // ratio like "5 / 2" after the query narrows.
        const activeMatchIndex =
            currentMatchIndex !== null && currentMatchIndex < matchCount ? currentMatchIndex : null;
        let counterText: string | null = null;
        if (hasQuery) {
            if (isRegexInvalid) {
                counterText = 'invalid regex';
            } else if (matchCount === 0) {
                counterText = 'no matches';
            } else if (activeMatchIndex !== null) {
                counterText = `${activeMatchIndex + 1} / ${matchCount}`;
            } else {
                counterText = `${matchCount} matches`;
            }
        }

        const toggleMode = () => onModeChange(isRegexMode ? OpGraphFilterMode.SUBSTRING : OpGraphFilterMode.REGEX);

        return (
            <div className='op-graph-filter'>
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
                        <div className='op-graph-filter-right-slot'>
                            <Button
                                className='op-graph-filter-mode'
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
                                    className='op-graph-filter-clear'
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
                {counterText ? <span className='op-graph-filter-counter'>{counterText}</span> : null}
                <Button
                    className='op-graph-filter-step'
                    variant={ButtonVariant.MINIMAL}
                    icon={IconNames.CHEVRON_UP}
                    aria-label='Previous match'
                    disabled={isDisabled || matchCount === 0}
                    onClick={onPrev}
                />
                <Button
                    className='op-graph-filter-step'
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

const OpGraphFilter = memo(OpGraphFilterInner);
OpGraphFilter.displayName = 'OpGraphFilter';

export default OpGraphFilter;
