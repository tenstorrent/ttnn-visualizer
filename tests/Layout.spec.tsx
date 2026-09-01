// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import type { ComponentType } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UsageEvent, UsageView } from '../src/definitions/UsageEvent';

/**
 * Covers the shell's wiring and the one structural invariant it asserts about itself.
 *
 * `initUsageRecording` is called from exactly one place, so without this spec deleting
 * that line breaks usage recording entirely and fails nothing.
 *
 * The children are stubbed -- rendering the real ones drags in the router, the query
 * client and the whole atom graph -- but as identifiable markers rather than `null`, so
 * where `Layout` mounts each of them is observable. `ServerModeBanner`'s own docblock
 * claims it sits beside the navigation rather than inside it, and `Layout` comments that
 * the fixed footer and the overlays stay outside `.app-shell`; both are claims about this
 * file's markup that no unit spec of those components can see.
 */

const teardown = vi.hoisted(() => vi.fn());
const initUsageRecording = vi.hoisted(() => vi.fn(() => teardown));
const recordUsage = vi.hoisted(() => vi.fn());

vi.mock('../src/functions/recordUsage', () => ({ default: recordUsage, initUsageRecording }));

vi.mock('../src/components/SideNavigation', () => ({ default: () => <div data-testid='stub-side-navigation' /> }));
vi.mock('../src/components/ServerModeBanner', () => ({ default: () => <div data-testid='stub-server-mode-banner' /> }));
vi.mock('../src/components/FooterInfobar', () => ({ default: () => <div data-testid='stub-footer-infobar' /> }));
vi.mock('../src/components/FeedbackButton', () => ({ default: () => null }));
vi.mock('../src/components/FileStatusOverlay', () => ({ default: () => null }));
vi.mock('../src/components/cluster/ClusterRenderer', () => ({ default: () => null }));
vi.mock('../src/components/mlir/MlirFileResultsOverlay', () => ({ default: () => null }));
vi.mock('../src/libs/ModalAwareOutlet', () => ({ ModalAwareOutlet: () => null }));

function renderLayout(Layout: ComponentType) {
    return render(
        <StrictMode>
            <HelmetProvider>
                <MemoryRouter>
                    <Layout />
                </MemoryRouter>
            </HelmetProvider>
        </StrictMode>,
    );
}

describe('Layout usage recording wiring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('starts usage recording on mount', async () => {
        const { default: Layout } = await import('../src/components/Layout');

        renderLayout(Layout);

        expect(initUsageRecording).toHaveBeenCalled();
    });

    it('records the initial route once under StrictMode', async () => {
        const { default: Layout } = await import('../src/components/Layout');

        renderLayout(Layout);

        expect(recordUsage).toHaveBeenCalledTimes(1);
        expect(recordUsage).toHaveBeenCalledWith({
            event: UsageEvent.VIEW_OPENED,
            details: { view: UsageView.REPORTS },
        });
    });

    it('balances every start with a teardown, including StrictMode remount', async () => {
        const { default: Layout } = await import('../src/components/Layout');

        const { unmount } = renderLayout(Layout);

        // StrictMode deliberately mounts, unmounts and remounts in dev, so the first
        // teardown has already run by now. An unbalanced pair here would leave the
        // discarded instance's listeners attached to the shared document — the exact leak
        // the explicit teardown exists to prevent.
        expect(initUsageRecording).toHaveBeenCalledTimes(2);
        expect(teardown).toHaveBeenCalledTimes(1);

        unmount();

        expect(teardown).toHaveBeenCalledTimes(2);
    });
});

describe('Layout shell placement', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    const renderShell = async () => {
        const { default: Layout } = await import('../src/components/Layout');

        const { container } = renderLayout(Layout);

        return container.querySelector('.app-shell');
    };

    // The rail shares horizontal space with the page, so it belongs to the flex shell.
    it('mounts the navigation inside the app shell, beside main', async () => {
        const shell = await renderShell();

        expect(shell).toContainElement(screen.getByTestId('stub-side-navigation'));
        expect(shell).toContainElement(document.querySelector('main'));
    });

    // The banner is the hosted deployment's only signpost. Inside the shell it would be a
    // flex child competing with the rail and main instead of overlaying the top of the page.
    it('mounts the server mode banner outside the app shell', async () => {
        const shell = await renderShell();

        expect(screen.getByTestId('stub-server-mode-banner')).toBeInTheDocument();
        expect(shell).not.toContainElement(screen.getByTestId('stub-server-mode-banner'));
    });

    // `Layout` says the fixed footer must stay outside so the flex shell can't reposition it.
    it('mounts the footer outside the app shell', async () => {
        const shell = await renderShell();

        expect(shell).not.toContainElement(screen.getByTestId('stub-footer-infobar'));
    });
});
