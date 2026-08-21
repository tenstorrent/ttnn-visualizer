// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import type { ComponentType } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Covers the wiring, not the layout.
 *
 * `initUsageRecording` is called from exactly one place, so without this spec deleting
 * that line breaks usage recording entirely and fails nothing. The children are stubbed
 * because none of them is what is under test, and rendering the real ones drags in the
 * router, the query client and the whole atom graph.
 */

const teardown = vi.hoisted(() => vi.fn());
const initUsageRecording = vi.hoisted(() => vi.fn(() => teardown));

vi.mock('../src/functions/recordUsage', () => ({ initUsageRecording }));

vi.mock('../src/components/SideNavigation', () => ({ default: () => null }));
vi.mock('../src/components/ServerModeBanner', () => ({ default: () => null }));
vi.mock('../src/components/FooterInfobar', () => ({ default: () => null }));
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
