// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import OpGraphToolbar from '../src/components/operation-graph/OpGraphToolbar';
import { PERF_OVERLAY_TOOLTIP, PerfOverlayStatus } from '../src/definitions/PerfOverlayStatus';
import { GraphFilterMode } from '../src/definitions/GraphFilterMode';

const renderToolbar = (status: PerfOverlayStatus, onPerfOverlayChange: (next: boolean) => void = vi.fn()) => {
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
            isDisabled={false}
        />,
    );

    // The label is Blueprint's own wrapper and the tooltip's hover target, so
    // querying it rather than a test-only container keeps these assertions
    // pointed at the element a user actually reaches for.
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
        ['no report loaded', PerfOverlayStatus.UNAVAILABLE],
        ['a report that does not match', PerfOverlayStatus.UNLINKED],
    ])('cannot be turned on with %s', (_label, status) => {
        const { input } = renderToolbar(status);

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
    // The two states that disable the switch are the two whose tooltip explains
    // why it's disabled, so "reachable while disabled" is the property worth
    // holding — not the markup that happens to deliver it today.
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
