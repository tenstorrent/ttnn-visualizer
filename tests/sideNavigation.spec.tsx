// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activePerformanceReportAtom, activeProfilerReportAtom, isNavigationCollapsedAtom } from '../src/store/app';
import { useGetClusterDescription } from '../src/hooks/useAPI';
import clusterDescription from './data/clusterDescription.json';
import SideNavigation from '../src/components/SideNavigation';
import { TEST_IDS } from '../src/definitions/TestIds';
import getButtonWithText from './helpers/getButtonWithText';
import { TestProviders } from './helpers/TestProviders';

afterEach(cleanup);

// The collapsed state persists through `atomWithStorage`, so without this a test that
// collapses the rail decides the starting state of every test that runs after it.
beforeEach(() => {
    localStorage.clear();
});

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useGetClusterDescription: vi.fn(),
}));

describe('SideNavigation reachability', () => {
    // The same matrix mainNavigation.spec.tsx asserts. Both menus resolve it from
    // useMainNavigationItems, so a divergence between the two is what these pin.
    it('disables specific options by default', () => {
        (useGetClusterDescription as Mock).mockReturnValue({ data: null });

        render(
            <TestProviders initialAtomValues={[[activeProfilerReportAtom, null]]}>
                <SideNavigation />
            </TestProviders>,
        );

        expect(getButtonWithText('reports')).toBeEnabled();
        expect(getButtonWithText('operations')).toBeDisabled();
        expect(getButtonWithText('tensors')).toBeDisabled();
        expect(getButtonWithText('buffers')).toBeDisabled();
        expect(getButtonWithText('graph')).toBeDisabled();
        expect(getButtonWithText('performance')).toBeDisabled();
        expect(getButtonWithText('npe')).toBeEnabled();
        expect(getButtonWithText('topology')).toBeDisabled();
    });

    it('enables specific options when there is an active memory report', () => {
        (useGetClusterDescription as Mock).mockReturnValue({ data: clusterDescription });

        render(
            <TestProviders initialAtomValues={[[activeProfilerReportAtom, { reportName: 'test', path: 'testPath' }]]}>
                <SideNavigation />
            </TestProviders>,
        );

        expect(getButtonWithText('operations')).toBeEnabled();
        expect(getButtonWithText('tensors')).toBeEnabled();
        expect(getButtonWithText('buffers')).toBeEnabled();
        expect(getButtonWithText('graph')).toBeEnabled();
        expect(getButtonWithText('performance')).toBeDisabled();
        expect(getButtonWithText('topology')).toBeEnabled();
    });

    // The regression: cluster availability used to be mirrored into an atom written only by
    // the footer's range slider, which unmounts with no active report — so a report that had
    // cluster data left Topology enabled for reports that don't.
    it('disables topology for an active report that has no cluster data', () => {
        (useGetClusterDescription as Mock).mockReturnValue({ data: null });

        render(
            <TestProviders initialAtomValues={[[activeProfilerReportAtom, { reportName: 'test', path: 'testPath' }]]}>
                <SideNavigation />
            </TestProviders>,
        );

        expect(getButtonWithText('operations')).toBeEnabled();
        expect(getButtonWithText('topology')).toBeDisabled();
    });

    // The shared product-colour mixin suppresses itself with `:not(.bp6-disabled)`, and its
    // selectors outrank Blueprint's own disabled styling. If an upgrade stopped emitting
    // this class, unavailable views would quietly paint themselves as ready again.
    it('marks unavailable items with the class the colour rules key off', () => {
        (useGetClusterDescription as Mock).mockReturnValue({ data: null });

        render(
            <TestProviders initialAtomValues={[[activeProfilerReportAtom, null]]}>
                <SideNavigation />
            </TestProviders>,
        );

        expect(getButtonWithText('operations')).toHaveClass('bp6-disabled');
        expect(getButtonWithText('reports')).not.toHaveClass('bp6-disabled');
    });

    it('enables performance when there is an active performance report', () => {
        (useGetClusterDescription as Mock).mockReturnValue({ data: null });

        render(
            <TestProviders
                initialAtomValues={[[activePerformanceReportAtom, { reportName: 'test', path: 'testPath' }]]}
            >
                <SideNavigation />
            </TestProviders>,
        );

        expect(getButtonWithText('performance')).toBeEnabled();
        expect(getButtonWithText('operations')).toBeDisabled();
    });
});

describe('SideNavigation collapsing', () => {
    // Assertions are structural rather than visual: vitest.config.ts does not enable
    // `test.css`, so no stylesheet is ever applied in jsdom and a visibility assertion on
    // the label would pass in both states.
    it('starts expanded and reports it on the toggle', () => {
        (useGetClusterDescription as Mock).mockReturnValue({ data: null });

        render(
            <TestProviders>
                <SideNavigation />
            </TestProviders>,
        );

        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION)).not.toHaveClass('collapsed');
        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION_TOGGLE)).toHaveAttribute('aria-expanded', 'true');
    });

    it('collapses when the toggle is pressed', () => {
        (useGetClusterDescription as Mock).mockReturnValue({ data: null });

        render(
            <TestProviders>
                <SideNavigation />
            </TestProviders>,
        );

        fireEvent.click(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION_TOGGLE));

        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION)).toHaveClass('collapsed');
        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION_TOGGLE)).toHaveAttribute('aria-expanded', 'false');
    });

    it('swaps the lockup for the square mark while collapsed', () => {
        (useGetClusterDescription as Mock).mockReturnValue({ data: null });

        render(
            <TestProviders>
                <SideNavigation />
            </TestProviders>,
        );

        expect(screen.getByAltText('tenstorrent')).toHaveAttribute('src', expect.stringContaining('tt_logo_color'));

        fireEvent.click(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION_TOGGLE));

        // The collapsed rail is too narrow for the lockup, and the mark is a `public/` file
        // whose URL has to pick up Vite's base rather than being rooted at `/`.
        expect(screen.getByAltText('tenstorrent')).toHaveAttribute('src', '/logo-small.png');
    });

    it('keeps every item reachable by name while collapsed', () => {
        (useGetClusterDescription as Mock).mockReturnValue({ data: null });

        render(
            <TestProviders initialAtomValues={[[isNavigationCollapsedAtom, true]]}>
                <SideNavigation />
            </TestProviders>,
        );

        // The icon-only rail is unusable if collapsing costs the buttons their accessible
        // names, so the labels have to survive as `aria-label` rather than as text nodes.
        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION)).toHaveClass('collapsed');
        expect(getButtonWithText('reports')).toBeEnabled();
        expect(getButtonWithText('npe')).toBeEnabled();
        expect(getButtonWithText('operations')).toBeDisabled();
    });
});
