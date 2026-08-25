// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InitialEntry, useLocation } from 'react-router';
import {
    activeMlirJsonAtom,
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    isNavigationCollapsedAtom,
} from '../src/store/app';
import { useGetClusterDescription } from '../src/hooks/useAPI';
import clusterDescription from './data/clusterDescription.json';
import SideNavigation from '../src/components/SideNavigation';
import ROUTES from '../src/definitions/Routes';
import { TEST_IDS } from '../src/definitions/TestIds';
import getButtonWithText from './helpers/getButtonWithText';
import { TestProviders } from './helpers/TestProviders';
import { AtomProviderInitialValues } from './helpers/atomProvider';
import { ServerConfig } from '../src/definitions/ServerConfig';

afterEach(() => {
    cleanup();
    // `import.meta.env.DEV` is stubbed by the MLIR tests; left set it would decide the
    // reachability of every test that runs after them.
    vi.unstubAllEnvs();
});

const getServerConfigMock = vi.hoisted(() => vi.fn((): Partial<ServerConfig> => ({ SERVER_MODE: false })));

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useGetClusterDescription: vi.fn(),
}));

vi.mock('../src/functions/getServerConfig', () => ({
    default: getServerConfigMock,
}));

// Reads the real router rather than a `useNavigate` spy, so a wrong route in
// NAVIGATION_ITEMS fails as loudly as a handler that never fires.
const LOCATION_PROBE_ID = 'location-probe';

function LocationProbe() {
    const location = useLocation();

    return (
        <div
            data-testid={LOCATION_PROBE_ID}
            data-pathname={location.pathname}
            data-background={location.state?.background?.pathname ?? ''}
        />
    );
}

const renderRail = (initialAtomValues?: AtomProviderInitialValues, initialEntries?: InitialEntry[]) =>
    render(
        <TestProviders
            initialAtomValues={initialAtomValues}
            initialEntries={initialEntries}
        >
            <SideNavigation />
            <LocationProbe />
        </TestProviders>,
    );

const getLocation = () => {
    const probe = screen.getByTestId(LOCATION_PROBE_ID);

    return {
        pathname: probe.getAttribute('data-pathname'),
        background: probe.getAttribute('data-background'),
    };
};

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

    // The collapsed rail hides the label with `display: none`, which takes it out of the
    // accessibility tree as well, so `aria-label` is the *only* thing naming these buttons.
    // Asserting on the accessible name can't show that: vitest.config.ts doesn't enable
    // `test.css`, so the label text nodes are present in jsdom either way and satisfy the
    // name computation on their own -- a name query passes with `aria-label` deleted. Hence
    // the assertion on the attribute itself.
    it("names every item with aria-label, the collapsed rail's only source of names", () => {
        renderRail([[isNavigationCollapsedAtom, true]]);

        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION)).toHaveClass('collapsed');
        expect(getButtonWithText('reports')).toHaveAttribute('aria-label', 'Reports');
        expect(getButtonWithText('npe')).toHaveAttribute('aria-label', 'NPE');
        expect(getButtonWithText('operations')).toHaveAttribute('aria-label', 'Operations');
    });

    it('keeps every item reachable while collapsed', () => {
        renderRail([[isNavigationCollapsedAtom, true]]);

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

describe('SideNavigation navigating', () => {
    // Every other assertion in this file is about how the rail looks. The rail moved from
    // `<Link>` markup to `onClick` -> `useNavigate`, so without these an inert handler, a
    // wrong route in the descriptors, or a dropped `void navigate(...)` ships green.
    it('navigates to the route the pressed item names', () => {
        renderRail([[activeProfilerReportAtom, activeReport]]);

        fireEvent.click(getButtonWithText('operations'));

        expect(getLocation().pathname).toBe(ROUTES.OPERATIONS);
        expect(getLocation().background).toBe('');
    });

    // A modal route keeps the page beneath it mounted, and react-router resolves that page
    // from the background location rather than from the path. Lose the state and Topology
    // stops being an overlay.
    it('carries the current page as the background when entering a modal item', () => {
        (useGetClusterDescription as Mock).mockReturnValue({ data: clusterDescription });

        renderRail([[activeProfilerReportAtom, activeReport]], [ROUTES.OPERATIONS]);

        fireEvent.click(getButtonWithText('topology'));

        expect(getLocation().pathname).toBe(ROUTES.CLUSTER);
        expect(getLocation().background).toBe(ROUTES.OPERATIONS);
    });

    // Re-entering an open modal would record its own route as the background, leaving the
    // overlay with itself underneath. The SCSS guard stops the pointer only, so keyboard
    // users reached this and mouse users didn't.
    it('ignores a modal item that is already showing', () => {
        (useGetClusterDescription as Mock).mockReturnValue({ data: clusterDescription });

        renderRail(
            [[activeProfilerReportAtom, activeReport]],
            [{ pathname: ROUTES.CLUSTER, state: { background: { pathname: ROUTES.OPERATIONS } } }],
        );

        fireEvent.click(getButtonWithText('topology'));

        expect(getLocation().pathname).toBe(ROUTES.CLUSTER);
        expect(getLocation().background).toBe(ROUTES.OPERATIONS);
    });

    it('leaves a disabled item inert', () => {
        renderRail([[activeProfilerReportAtom, null]], [ROUTES.HOME]);

        fireEvent.click(getButtonWithText('operations'));

        expect(getLocation().pathname).toBe(ROUTES.HOME);
    });
});

describe('SideNavigation active item', () => {
    // `isActivePath` drives both the per-tab identity colours and, now, the modal re-entry
    // guard above, so all four of its branches are load-bearing.
    it('marks the item whose route is the current path', () => {
        renderRail([[activeProfilerReportAtom, activeReport]], [ROUTES.OPERATIONS]);

        expect(getButtonWithText('operations')).toHaveClass('bp6-active');
        expect(getButtonWithText('tensors')).not.toHaveClass('bp6-active');
    });

    // Operation details sit under the Operations route, and the rail has no item of their
    // own to light up.
    it('marks the item a nested route belongs to', () => {
        renderRail([[activeProfilerReportAtom, activeReport]], [`${ROUTES.OPERATIONS}/42`]);

        expect(getButtonWithText('operations')).toHaveClass('bp6-active');
    });

    // Home is every path's prefix, so the nested match has to exclude it or Reports would
    // read as active everywhere.
    it('does not mark Reports active from a nested path', () => {
        renderRail([[activeProfilerReportAtom, activeReport]], [`${ROUTES.OPERATIONS}/42`]);

        expect(getButtonWithText('reports')).not.toHaveClass('bp6-active');
    });

    // With a modal open the page underneath is still where the user is, so both items
    // report active.
    it('marks both the modal and the page behind it', () => {
        (useGetClusterDescription as Mock).mockReturnValue({ data: clusterDescription });

        renderRail(
            [[activeProfilerReportAtom, activeReport]],
            [{ pathname: ROUTES.CLUSTER, state: { background: { pathname: `${ROUTES.OPERATIONS}/42` } } }],
        );

        expect(getButtonWithText('topology')).toHaveClass('bp6-active');
        expect(getButtonWithText('operations')).toHaveClass('bp6-active');
    });
});

describe('SideNavigation MLIR reachability', () => {
    // A dev checkout reaches the MLIR view without a loaded file so the page itself can be
    // worked on -- which means the disabled branch is unreachable under vitest unless DEV
    // is stubbed, and the requirement went untested until it was.
    it('needs an active MLIR file in a production build', () => {
        vi.stubEnv('DEV', false);

        renderRail([[activeMlirJsonAtom, null]]);

        expect(getButtonWithText('mlir')).toBeDisabled();
    });

    it('enables MLIR in a production build once a file is active', () => {
        vi.stubEnv('DEV', false);

        renderRail([[activeMlirJsonAtom, { name: 'test.mlir' }]]);

        expect(getButtonWithText('mlir')).toBeEnabled();
    });

    it('enables MLIR in a dev checkout with no file', () => {
        vi.stubEnv('DEV', true);

        renderRail([[activeMlirJsonAtom, null]]);

        expect(getButtonWithText('mlir')).toBeEnabled();
    });
});

describe('SideNavigation collapse persistence', () => {
    // `getOnInit` exists so a user who collapsed the rail doesn't get an expanded first
    // paint and a reflow of the page beside it. Nothing else would notice the key being
    // renamed or the option being dropped.
    it('renders collapsed on first paint when the stored preference says so', () => {
        localStorage.setItem('navigationCollapsed', 'true');

        renderRail();

        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION)).toHaveClass('collapsed');
        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION_TOGGLE)).toHaveAttribute('aria-expanded', 'false');
    });

    it('stores the preference when the rail is collapsed', () => {
        renderRail();

        fireEvent.click(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION_TOGGLE));

        expect(localStorage.getItem('navigationCollapsed')).toBe('true');
    });
});

describe('SideNavigation assistive technology', () => {
    // Blueprint 6.6.1's button emits only `aria-disabled` -- never `aria-pressed` or
    // `aria-current` -- so `active` reaches the DOM as a class and a colour and nothing
    // else. Without this attribute the current view is unannounced.
    it('reports the current view with aria-current', () => {
        renderRail([[activeProfilerReportAtom, activeReport]], [ROUTES.OPERATIONS]);

        expect(getButtonWithText('operations')).toHaveAttribute('aria-current', 'page');
    });

    it('leaves aria-current off items that are not current', () => {
        renderRail([[activeProfilerReportAtom, activeReport]], [ROUTES.OPERATIONS]);

        expect(getButtonWithText('tensors')).not.toHaveAttribute('aria-current');
    });

    // The visual active state deliberately covers both the modal and the page behind it,
    // but a navigation must expose exactly one current page -- so `aria-current` follows
    // the real pathname while the identity colours follow both.
    it('names only one current page while a modal is open', () => {
        (useGetClusterDescription as Mock).mockReturnValue({ data: clusterDescription });

        renderRail(
            [[activeProfilerReportAtom, activeReport]],
            [{ pathname: ROUTES.CLUSTER, state: { background: { pathname: `${ROUTES.OPERATIONS}/42` } } }],
        );

        expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
        expect(getButtonWithText('topology')).toHaveAttribute('aria-current', 'page');
        expect(getButtonWithText('operations')).not.toHaveAttribute('aria-current');

        // Both still paint as active.
        expect(getButtonWithText('topology')).toHaveClass('bp6-active');
        expect(getButtonWithText('operations')).toHaveClass('bp6-active');
    });

    // `aria-expanded` on its own says something is expanded without saying what, so the
    // toggle points at the region whose width it controls.
    it('ties the toggle to the region it expands', () => {
        renderRail();

        const toggle = screen.getByTestId(TEST_IDS.SIDE_NAVIGATION_TOGGLE);
        const controlled = toggle.getAttribute('aria-controls');

        expect(controlled).toBeTruthy();
        expect(document.getElementById(controlled as string)).toContainElement(getButtonWithText('reports'));
    });
});
