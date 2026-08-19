// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import OpGraphToolbar from '../src/components/operation-graph/OpGraphToolbar';
import { PERF_OVERLAY_TOOLTIP, PerfOverlayStatus } from '../src/definitions/PerfOverlayStatus';
import { GraphFilterMode } from '../src/definitions/GraphFilterMode';

const renderToolbar = (
    status: PerfOverlayStatus,
    onPerfOverlayChange: (next: boolean) => void = vi.fn(),
    isDisabled = false,
) => {
    render(
        <OpGraphToolbar
            filterRef={null}
            query=''
            onQueryChange={vi.fn()}
            mode={GraphFilterMode.SUBSTRING}
            onModeChange={vi.fn()}
            isRegexInvalid={false}
            matchCount={0}
            currentMatchIndex={null}
            onPrevMatch={vi.fn()}
            onNextMatch={vi.fn()}
            selectedOperationId={1}
            previousOperationId={null}
            nextOperationId={2}
            onGoToOperation={vi.fn()}
            hideDeallocate
            onHideDeallocateChange={vi.fn()}
            isPerfOverlayActive={false}
            onPerfOverlayChange={onPerfOverlayChange}
            perfOverlayStatus={status}
            linkedOpCount={180}
            totalOpCount={302}
            isDisabled={isDisabled}
        />,
    );

    // Blueprint's own wrapper and the tooltip's hover target, so this queries
    // the element a user reaches for rather than a test-only container.
    const label = screen.getByText(/^Perf overlay/).closest('label') as HTMLElement;
    return { label, input: label.querySelector('input') as HTMLInputElement };
};

afterEach(cleanup);

describe('perf overlay switch', () => {
    it('is operable and counts the linked ops once the reports line up', () => {
        const { input } = renderToolbar(PerfOverlayStatus.READY);

        expect(input).toBeEnabled();
        // The share of the graph the overlay can speak for. Without it, a mostly
        // unmatched report looks identical to a fully matched one. #1610
        expect(screen.getByText('Perf overlay (180/302)')).toBeInTheDocument();
    });

    it('drops the count when there is nothing linked to count', () => {
        renderToolbar(PerfOverlayStatus.UNLINKED);

        expect(screen.getByText('Perf overlay')).toBeInTheDocument();
        expect(screen.queryByText(/180\/302/)).not.toBeInTheDocument();
    });

    it.each([
        ['no report loaded', PerfOverlayStatus.UNAVAILABLE, false],
        ['a report that does not match', PerfOverlayStatus.UNLINKED, false],
        // The other half of the switch's disjunction: mid-build the op ids the
        // overlay keys on are about to be replaced, so a report that lines up
        // perfectly still must not be switchable yet.
        ['a graph still being laid out', PerfOverlayStatus.READY, true],
    ])('cannot be turned on with %s', (_label, status, isDisabled) => {
        const { input } = renderToolbar(status, vi.fn(), isDisabled);

        expect(input).toBeDisabled();
    });

    it('turns on when toggled', () => {
        const onChange = vi.fn();
        const { input } = renderToolbar(PerfOverlayStatus.READY, onChange);

        fireEvent.click(input);

        expect(onChange).toHaveBeenCalledWith(true);
    });
});

describe('perf overlay switch tooltip', () => {
    // Disabled is when the tooltip matters most, so "reachable while disabled"
    // is the property worth holding — not today's markup.
    it.each([
        ['unavailable', PerfOverlayStatus.UNAVAILABLE],
        ['unlinked', PerfOverlayStatus.UNLINKED],
        ['ready', PerfOverlayStatus.READY],
    ])('explains the %s state on hover', async (_label, status) => {
        const { label } = renderToolbar(status);

        fireEvent.mouseEnter(label);

        await waitFor(() => expect(screen.getByText(PERF_OVERLAY_TOOLTIP[status])).toBeInTheDocument());
    });
});
