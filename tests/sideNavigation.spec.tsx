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
import { AtomProviderInitialValues } from './helpers/atomProvider';
import { ServerConfig } from '../src/definitions/ServerConfig';

afterEach(cleanup);

const getServerConfigMock = vi.hoisted(() => vi.fn((): Partial<ServerConfig> => ({ SERVER_MODE: false })));

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useGetClusterDescription: vi.fn(),
}));

vi.mock('../src/functions/getServerConfig', () => ({
    default: getServerConfigMock,
}));

const renderRail = (initialAtomValues?: AtomProviderInitialValues) =>
    render(
        <TestProviders initialAtomValues={initialAtomValues}>
            <SideNavigation />
        </TestProviders>,
    );

const activeReport = { reportName: 'test', path: 'testPath' };

beforeEach(() => {
    // The collapsed state persists through `atomWithStorage`, so without this a test that
    // collapses the rail decides the starting state of every test that runs after it.
    localStorage.clear();
    // No cluster data is the majority case; the one test that needs it overrides this.
    (useGetClusterDescription as Mock).mockReturnValue({ data: null });
    // Likewise the local deployment: the hosted build is the exception, not the default.
    getServerConfigMock.mockReturnValue({ SERVER_MODE: false });
});

describe('SideNavigation reachability', () => {
    // The reachability matrix useMainNavigationItems resolves: which views a report
    // unlocks, pinned here at the menu that renders them.
    it('disables specific options by default', () => {
        renderRail([[activeProfilerReportAtom, null]]);

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

        renderRail([[activeProfilerReportAtom, activeReport]]);

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
        renderRail([[activeProfilerReportAtom, activeReport]]);

        expect(getButtonWithText('operations')).toBeEnabled();
        expect(getButtonWithText('topology')).toBeDisabled();
    });

    // The shared product-colour mixin suppresses itself with `:not(.bp6-disabled)`, and its
    // selectors outrank Blueprint's own disabled styling. If an upgrade stopped emitting
    // this class, unavailable views would quietly paint themselves as ready again.
    it('marks unavailable items with the class the colour rules key off', () => {
        renderRail([[activeProfilerReportAtom, null]]);

        expect(getButtonWithText('operations')).toHaveClass('bp6-disabled');
        expect(getButtonWithText('reports')).not.toHaveClass('bp6-disabled');
    });

    it('enables performance when there is an active performance report', () => {
        renderRail([[activePerformanceReportAtom, activeReport]]);

        expect(getButtonWithText('performance')).toBeEnabled();
        expect(getButtonWithText('operations')).toBeDisabled();
    });
});

describe('SideNavigation collapsing', () => {
    // Assertions are structural rather than visual: vitest.config.ts does not enable
    // `test.css`, so no stylesheet is ever applied in jsdom and a visibility assertion on
    // the label would pass in both states.
    it('starts expanded, showing the lockup and reporting it on the toggle', () => {
        renderRail();

        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION)).not.toHaveClass('collapsed');
        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION_TOGGLE)).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION_TOGGLE)).toHaveAttribute(
            'aria-label',
            'Collapse navigation',
        );
        expect(screen.getByAltText('tenstorrent')).toHaveAttribute('src', expect.stringContaining('tt_logo_color'));
    });

    // The single control lives below the items in both states, so it can't be the header's
    // to lose to a change in the lockup above it.
    it('renders the toggle at the foot of the rail, after the items', () => {
        renderRail();

        const toggle = screen.getByTestId(TEST_IDS.SIDE_NAVIGATION_TOGGLE);
        const rail = screen.getByTestId(TEST_IDS.SIDE_NAVIGATION);

        expect(toggle.closest('.side-navigation-footer')).toBeInTheDocument();
        expect(rail.lastElementChild).toContainElement(toggle);
        expect(getButtonWithText('reports').compareDocumentPosition(toggle)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('collapses when the toggle is pressed', () => {
        renderRail();

        fireEvent.click(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION_TOGGLE));

        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION)).toHaveClass('collapsed');
        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION_TOGGLE)).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION_TOGGLE)).toHaveAttribute('aria-label', 'Expand navigation');
        // One asset in both states: the narrow rail clips the lockup down to its leading
        // mark in CSS rather than swapping in a second image that could drift from it.
        // Hence a class assertion — the clip itself is unobservable in jsdom.
        expect(screen.getByAltText('tenstorrent')).toHaveAttribute('src', expect.stringContaining('tt_logo_color'));
        expect(screen.getByAltText('tenstorrent').closest('.side-navigation')).toHaveClass('collapsed');
    });

    it('expands when the toggle is pressed while collapsed', () => {
        renderRail([[isNavigationCollapsedAtom, true]]);

        fireEvent.click(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION_TOGGLE));

        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION)).not.toHaveClass('collapsed');
        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION_TOGGLE)).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByAltText('tenstorrent')).toHaveAttribute('src', expect.stringContaining('tt_logo_color'));
    });

    // The logo used to be the expand control while collapsed. It is now the home link it is
    // when expanded, so clicking it must not touch the rail's state.
    it('does not expand the rail when the collapsed mark is pressed', () => {
        renderRail([[isNavigationCollapsedAtom, true]]);

        fireEvent.click(screen.getByAltText('tenstorrent'));

        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION)).toHaveClass('collapsed');
        expect(screen.getByAltText('tenstorrent').closest('a')).toHaveAttribute('href', '/');
    });

    it('keeps every item reachable by name while collapsed', () => {
        renderRail([[isNavigationCollapsedAtom, true]]);

        // The icon-only rail is unusable if collapsing costs the buttons their accessible
        // names, so the labels have to survive as `aria-label` rather than as text nodes.
        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION)).toHaveClass('collapsed');
        expect(getButtonWithText('reports')).toBeEnabled();
        expect(getButtonWithText('npe')).toBeEnabled();
        expect(getButtonWithText('operations')).toBeDisabled();
    });
});

describe('SideNavigation server mode', () => {
    // The frontend half of the dual gate AGENTS.md requires: MLIR's endpoints are
    // `@local_only`, so the hosted rail must not offer a door that 403s behind it. The
    // gate is one `hiddenInServerMode` flag consumed by one filter — cheap to delete by
    // accident during a restyle, hence pinned here.
    it('offers MLIR in a local deployment', () => {
        renderRail();

        expect(getButtonWithText('mlir')).toBeInTheDocument();
    });

    it('hides MLIR in server mode and leaves the rest of the rail alone', () => {
        getServerConfigMock.mockReturnValue({ SERVER_MODE: true });

        renderRail();

        expect(screen.queryByRole('button', { name: /mlir/i })).not.toBeInTheDocument();
        // The filter drops one item, not a category.
        expect(getButtonWithText('reports')).toBeEnabled();
        expect(getButtonWithText('npe')).toBeEnabled();
    });
});
