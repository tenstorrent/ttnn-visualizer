// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Collapsible from '../src/components/Collapsible';

// Function children exist so a caller whose collapsed content is enormous (the NPE
// zone filter can hold ~100k rows) never builds that element tree while shut. #1803
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Collapsible function children', () => {
    it('does not invoke the child builder while collapsed', () => {
        const build = vi.fn(() => <div data-testid='content'>body</div>);

        render(
            <Collapsible
                label='Section'
                isOpen={false}
                keepChildrenMounted={false}
            >
                {build}
            </Collapsible>,
        );

        expect(build).not.toHaveBeenCalled();
        expect(screen.queryByTestId('content')).toBeNull();
    });

    it('still offers the expand toggle when collapsed children are lazy', () => {
        // The toggle only renders when `children` is truthy — a function has to
        // count, or a lazy section could never be opened.
        render(
            <Collapsible
                label='Section'
                isOpen={false}
                keepChildrenMounted={false}
            >
                {() => <div data-testid='content'>body</div>}
            </Collapsible>,
        );

        expect(screen.getByRole('button', { name: /Section/ })).toBeTruthy();
    });

    it('builds and mounts the children once expanded', () => {
        const build = vi.fn(() => <div data-testid='content'>body</div>);

        render(
            <Collapsible
                label='Section'
                isOpen={false}
                keepChildrenMounted={false}
            >
                {build}
            </Collapsible>,
        );
        fireEvent.click(screen.getByRole('button', { name: /Section/ }));

        expect(build).toHaveBeenCalled();
        expect(screen.getByTestId('content')).toBeTruthy();
    });

    it('renders plain element children unchanged', () => {
        // Backwards compatibility: the other call sites pass elements, not builders.
        render(
            <Collapsible
                label='Section'
                isOpen
            >
                <div data-testid='content'>body</div>
            </Collapsible>,
        );

        expect(screen.getByTestId('content')).toBeTruthy();
    });
});
