// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { type Ref, createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MlirOpFilter, { type MlirFilterMode, type MlirOpFilterHandle } from '../src/components/mlir/MlirOpFilter';
import { TestProviders } from './helpers/TestProviders';

afterEach(cleanup);

interface Overrides {
    query?: string;
    mode?: MlirFilterMode;
    isRegexInvalid?: boolean;
    matchCount?: number;
    hiddenMatchCount?: number;
    currentMatchIndex?: number | null;
    onQueryChange?: (next: string) => void;
    onModeChange?: (next: MlirFilterMode) => void;
    onPrev?: () => void;
    onNext?: () => void;
    ref?: Ref<MlirOpFilterHandle>;
}

const renderFilter = (overrides: Overrides = {}) => {
    const onQueryChange = overrides.onQueryChange ?? vi.fn();
    const onModeChange = overrides.onModeChange ?? vi.fn();
    const onPrev = overrides.onPrev ?? vi.fn();
    const onNext = overrides.onNext ?? vi.fn();

    const utils = render(
        <TestProviders>
            <MlirOpFilter
                ref={overrides.ref}
                query={overrides.query ?? ''}
                onQueryChange={onQueryChange}
                mode={overrides.mode ?? 'substring'}
                onModeChange={onModeChange}
                isRegexInvalid={overrides.isRegexInvalid ?? false}
                matchCount={overrides.matchCount ?? 0}
                hiddenMatchCount={overrides.hiddenMatchCount ?? 0}
                currentMatchIndex={overrides.currentMatchIndex ?? null}
                onPrev={onPrev}
                onNext={onNext}
            />
        </TestProviders>,
    );

    return { ...utils, onQueryChange, onModeChange, onPrev, onNext };
};

const getInput = () => screen.getByPlaceholderText(/^Filter ops/) as HTMLInputElement;
const getModeToggle = () => screen.getByRole('button', { name: /Switch to (regex|substring) mode/ });

describe('MlirOpFilter', () => {
    describe('mode toggle', () => {
        it('reflects substring mode with a non-active toggle and matching placeholder', () => {
            renderFilter({ mode: 'substring' });

            expect(getInput().placeholder).toBe('Filter ops (substring)');
            expect(getModeToggle()).not.toHaveClass('bp6-active');
        });

        it('reflects regex mode with an active toggle and matching placeholder', () => {
            renderFilter({ mode: 'regex' });

            expect(getInput().placeholder).toBe('Filter ops (regex)');
            expect(getModeToggle()).toHaveClass('bp6-active');
        });

        it('calls onModeChange with the opposite mode when clicked', () => {
            const onModeChange = vi.fn();
            renderFilter({ mode: 'substring', onModeChange });

            fireEvent.click(getModeToggle());

            expect(onModeChange).toHaveBeenCalledWith('regex');
        });

        it('flips regex → substring on click', () => {
            const onModeChange = vi.fn();
            renderFilter({ mode: 'regex', onModeChange });

            fireEvent.click(getModeToggle());

            expect(onModeChange).toHaveBeenCalledWith('substring');
        });
    });

    describe('counter text', () => {
        it('is hidden when the query is empty', () => {
            renderFilter({ query: '' });

            expect(screen.queryByText(/matches|invalid|no matches/)).toBeNull();
        });

        it('reads "no matches" when the query is non-empty but nothing hits', () => {
            renderFilter({ query: 'foo', matchCount: 0, hiddenMatchCount: 0 });

            expect(screen.getByText('no matches')).toBeInTheDocument();
        });

        it('reads "invalid regex" when the regex fails to compile, regardless of counts', () => {
            renderFilter({ query: '(', mode: 'regex', isRegexInvalid: true });

            expect(screen.getByText('invalid regex')).toBeInTheDocument();
            expect(screen.queryByText('no matches')).toBeNull();
        });

        it('shows N-of-M when a match is focused', () => {
            renderFilter({ query: 'foo', matchCount: 5, currentMatchIndex: 2 });

            expect(screen.getByText('3 / 5')).toBeInTheDocument();
        });

        it('appends the "(+K inside)" suffix for buried matches', () => {
            renderFilter({ query: 'foo', matchCount: 5, currentMatchIndex: 2, hiddenMatchCount: 3 });

            expect(screen.getByText('3 / 5 (+3 inside)')).toBeInTheDocument();
        });

        it('shows "N matches" pre-focus when the cursor has not been placed yet', () => {
            renderFilter({ query: 'foo', matchCount: 4, currentMatchIndex: null });

            expect(screen.getByText('4 matches')).toBeInTheDocument();
        });

        it('ignores a stale currentMatchIndex that no longer fits the match set', () => {
            // Cursor was at match 5/5, then expand/collapse shrank the set to 2.
            // Counter must not read "6 / 2" — it should fall back to "2 matches".
            renderFilter({ query: 'foo', matchCount: 2, currentMatchIndex: 5 });

            expect(screen.getByText('2 matches')).toBeInTheDocument();
            expect(screen.queryByText(/6\s*\/\s*2/)).toBeNull();
        });
    });

    describe('regex-invalid styling', () => {
        it('applies bp6-intent-danger to the input group when invalid', () => {
            const { container } = renderFilter({ query: '(', mode: 'regex', isRegexInvalid: true });

            const group = container.querySelector('.bp6-input-group');
            expect(group).not.toBeNull();
            expect(group).toHaveClass('bp6-intent-danger');
        });

        it('does not apply the danger class when the regex compiles cleanly', () => {
            const { container } = renderFilter({ query: '^foo$', mode: 'regex', isRegexInvalid: false });

            const group = container.querySelector('.bp6-input-group');
            expect(group).not.toHaveClass('bp6-intent-danger');
        });
    });

    describe('keyboard shortcuts', () => {
        it('Escape clears the query', () => {
            const onQueryChange = vi.fn();
            renderFilter({ query: 'foo', onQueryChange });

            fireEvent.keyDown(getInput(), { key: 'Escape' });

            expect(onQueryChange).toHaveBeenCalledWith('');
        });

        it('Enter advances to the next match', () => {
            const onNext = vi.fn();
            renderFilter({ query: 'foo', matchCount: 3, onNext });

            fireEvent.keyDown(getInput(), { key: 'Enter' });

            expect(onNext).toHaveBeenCalledTimes(1);
        });

        it('Shift+Enter walks back to the previous match', () => {
            const onPrev = vi.fn();
            renderFilter({ query: 'foo', matchCount: 3, onPrev });

            fireEvent.keyDown(getInput(), { key: 'Enter', shiftKey: true });

            expect(onPrev).toHaveBeenCalledTimes(1);
        });
    });

    describe('clear button', () => {
        it('is hidden when the query is empty', () => {
            renderFilter({ query: '' });

            expect(screen.queryByRole('button', { name: 'Clear filter' })).toBeNull();
        });

        it('clears the query when clicked', () => {
            const onQueryChange = vi.fn();
            renderFilter({ query: 'foo', onQueryChange });

            fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));

            expect(onQueryChange).toHaveBeenCalledWith('');
        });
    });

    describe('prev/next buttons', () => {
        it('disables prev/next when there are no matches', () => {
            renderFilter({ query: 'foo', matchCount: 0 });

            expect(screen.getByRole('button', { name: 'Previous match' })).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled();
        });

        it('enables prev/next when at least one match is present', () => {
            renderFilter({ query: 'foo', matchCount: 1 });

            expect(screen.getByRole('button', { name: 'Previous match' })).not.toBeDisabled();
            expect(screen.getByRole('button', { name: 'Next match' })).not.toBeDisabled();
        });
    });

    describe('imperative focus handle', () => {
        it('focuses and selects the input when the parent calls handle.focus()', () => {
            const ref = createRef<MlirOpFilterHandle>();
            renderFilter({ query: 'foo', ref });

            ref.current?.focus();

            const input = getInput();
            expect(document.activeElement).toBe(input);
            expect(input.selectionStart).toBe(0);
            expect(input.selectionEnd).toBe('foo'.length);
        });
    });
});
