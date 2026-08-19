// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import OpGraphToolbar from '../src/components/operation-graph/OpGraphToolbar';
import { CRITICAL_PATH_TOOLTIP, PERF_OVERLAY_TOOLTIP, PerfOverlayStatus } from '../src/definitions/PerfOverlayStatus';
import { GraphFilterMode } from '../src/definitions/GraphFilterMode';

interface RenderToolbarOptions {
    status: PerfOverlayStatus;
    onPerfOverlayChange?: (next: boolean) => void;
    onCriticalPathChange?: (next: boolean) => void;
}

const renderToolbar = ({
    status,
    onPerfOverlayChange = vi.fn(),
    onCriticalPathChange = vi.fn(),
}: RenderToolbarOptions) => {
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
            isCriticalPathActive={false}
            onCriticalPathChange={onCriticalPathChange}
            perfOverlayStatus={status}
            linkedOpCount={180}
            totalOpCount={302}
            isDisabled={false}
        />,
    );
};

// Blueprint's own wrapper and the tooltip's hover target, so this queries the
// element a user reaches for rather than a test-only container.
const switchNamed = (label: RegExp) => {
    const host = screen.getByText(label).closest('label') as HTMLElement;
    return { label: host, input: host.querySelector('input') as HTMLInputElement };
};

const perfOverlaySwitch = () => switchNamed(/^Perf overlay/);
const criticalPathSwitch = () => switchNamed(/^Highlight critical path/);

afterEach(cleanup);

describe('perf overlay switch', () => {
    it('is operable and counts the linked ops once the reports line up', () => {
        renderToolbar({ status: PerfOverlayStatus.READY });

        expect(perfOverlaySwitch().input).toBeEnabled();
        // The share of the graph the overlay can speak for. Without it, a mostly
        // unmatched report looks identical to a fully matched one. #1610
        expect(screen.getByText('Perf overlay (180/302)')).toBeInTheDocument();
    });

    it('drops the count when there is nothing linked to count', () => {
        renderToolbar({ status: PerfOverlayStatus.UNLINKED });

        expect(screen.getByText('Perf overlay')).toBeInTheDocument();
        expect(screen.queryByText(/180\/302/)).not.toBeInTheDocument();
    });

    it.each([
        ['no report loaded', PerfOverlayStatus.UNAVAILABLE],
        ['a report that does not match', PerfOverlayStatus.UNLINKED],
    ])('cannot be turned on with %s', (_label, status) => {
        renderToolbar({ status });

        expect(perfOverlaySwitch().input).toBeDisabled();
    });

    it('turns on when toggled', () => {
        const onPerfOverlayChange = vi.fn();
        renderToolbar({ status: PerfOverlayStatus.READY, onPerfOverlayChange });

        fireEvent.click(perfOverlaySwitch().input);

        expect(onPerfOverlayChange).toHaveBeenCalledWith(true);
    });
});

describe('critical path switch', () => {
    it('is operable once the reports line up', () => {
        renderToolbar({ status: PerfOverlayStatus.READY });

        expect(criticalPathSwitch().input).toBeEnabled();
    });

    it.each([
        ['no report loaded', PerfOverlayStatus.UNAVAILABLE],
        ['a report that does not match', PerfOverlayStatus.UNLINKED],
    ])('cannot be turned on with %s', (_label, status) => {
        // Same gate as the overlay: both read per-op durations, so a report that
        // can't feed the bars can't weigh the path either.
        renderToolbar({ status });

        expect(criticalPathSwitch().input).toBeDisabled();
    });

    it('turns on when toggled', () => {
        const onCriticalPathChange = vi.fn();
        renderToolbar({ status: PerfOverlayStatus.READY, onCriticalPathChange });

        fireEvent.click(criticalPathSwitch().input);

        expect(onCriticalPathChange).toHaveBeenCalledWith(true);
    });

    it('is independent of the overlay switch', () => {
        // The path can be traced with the bars off, so the two switches must not
        // share a handler.
        const onPerfOverlayChange = vi.fn();
        const onCriticalPathChange = vi.fn();
        renderToolbar({ status: PerfOverlayStatus.READY, onPerfOverlayChange, onCriticalPathChange });

        fireEvent.click(criticalPathSwitch().input);

        expect(onCriticalPathChange).toHaveBeenCalledWith(true);
        expect(onPerfOverlayChange).not.toHaveBeenCalled();
    });
});

describe('switch tooltips', () => {
    // Disabled is when the tooltip matters most, so "reachable while disabled"
    // is the property worth holding — not today's markup.
    it.each([
        ['unavailable', PerfOverlayStatus.UNAVAILABLE],
        ['unlinked', PerfOverlayStatus.UNLINKED],
        ['ready', PerfOverlayStatus.READY],
    ])('explains the %s overlay state on hover', async (_label, status) => {
        renderToolbar({ status });

        fireEvent.mouseEnter(perfOverlaySwitch().label);

        await waitFor(() => expect(screen.getByText(PERF_OVERLAY_TOOLTIP[status])).toBeInTheDocument());
    });

    it.each([
        ['unavailable', PerfOverlayStatus.UNAVAILABLE],
        ['unlinked', PerfOverlayStatus.UNLINKED],
        ['ready', PerfOverlayStatus.READY],
    ])('explains the %s critical path state on hover', async (_label, status) => {
        renderToolbar({ status });

        fireEvent.mouseEnter(criticalPathSwitch().label);

        await waitFor(() => expect(screen.getByText(CRITICAL_PATH_TOOLTIP[status])).toBeInTheDocument());
    });
});
