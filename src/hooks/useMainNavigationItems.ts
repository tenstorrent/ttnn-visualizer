// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue } from 'jotai';
import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { NAVIGATION_ITEMS, NAV_DISABLED_REASON, NavRequirement, NavigationItem } from '../definitions/NavigationItems';
import ROUTES from '../definitions/Routes';
import { activeMlirJsonAtom, activePerformanceReportAtom, activeProfilerReportAtom } from '../store/app';
import { useGetClusterDescription } from './useAPI';
import getServerConfig from '../functions/getServerConfig';

export interface ResolvedNavigationItem extends NavigationItem {
    isDisabled: boolean;
    // Null rather than an empty string so a caller can't render a blank tooltip.
    disabledReason: string | null;
    // Paints the item as the user's current location, including the page behind an open
    // modal -- so more than one item can be active at a time.
    isActive: boolean;
    // The one item matching the actual pathname. Separate from `isActive` because a
    // navigation must expose a single current page to assistive technology.
    isCurrentPage: boolean;
}

export interface MainNavigationItems {
    items: ResolvedNavigationItem[];
    handleNavigate: (item: ResolvedNavigationItem) => void;
}

export function useMainNavigationItems(): MainNavigationItems {
    const navigate = useNavigate();
    const location = useLocation();
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const activeMlirJson = useAtomValue(activeMlirJsonAtom);
    // Read from the report-scoped query rather than a mirrored flag: the query key carries
    // the active report's path, so clearing or switching reports cannot leave Topology
    // enabled on a report that has no cluster data.
    const { data: clusterDescription } = useGetClusterDescription();
    const serverMode = getServerConfig().SERVER_MODE;

    const isRequirementMet = (requirement: NavRequirement): boolean => {
        switch (requirement) {
            case NavRequirement.PROFILER_REPORT:
                return !!activeProfilerReport;
            case NavRequirement.PERFORMANCE_REPORT:
                return !!activePerformanceReport;
            case NavRequirement.CLUSTER_DESCRIPTION:
                return !!clusterDescription;
            case NavRequirement.MLIR_FILE:
                // A dev checkout reaches the MLIR view without a loaded file so the
                // page itself can be worked on.
                return import.meta.env.DEV || !!activeMlirJson;
            case NavRequirement.NONE:
            default:
                return true;
        }
    };

    const isNestedMatch = (candidate: string, path: string) => candidate.includes(path) && path !== ROUTES.HOME;

    // The page the browser is actually on. Exactly one item can match: no route in ROUTES
    // is a substring of another, and HOME is excluded from the nested match.
    const isCurrentPath = (path: string): boolean =>
        location.pathname === path || isNestedMatch(location.pathname, path);

    // Also counts the page behind an open modal, which is what the identity colours want --
    // the user is still on that page. Two items can match at once, so this must not drive
    // `aria-current`; see `isCurrentPage`.
    const isActivePath = (path: string): boolean => {
        if (isCurrentPath(path)) {
            return true;
        }

        const backgroundPath = location.state?.background?.pathname;

        return !!backgroundPath && (backgroundPath === path || isNestedMatch(backgroundPath, path));
    };

    const items = NAVIGATION_ITEMS.filter((item) => !(item.hiddenInServerMode && serverMode)).map((item) => {
        const isDisabled = !isRequirementMet(item.requirement);

        return {
            ...item,
            isDisabled,
            disabledReason: isDisabled ? NAV_DISABLED_REASON[item.requirement] : null,
            isActive: isActivePath(item.route),
            isCurrentPage: isCurrentPath(item.route),
        };
    });

    const handleNavigate = useCallback(
        (item: ResolvedNavigationItem) => {
            // Re-entering a modal that is already showing would record the modal's own route
            // as its background, leaving the overlay with itself underneath. The SCSS guard
            // only stops the pointer, so the check has to live here to cover Enter/Space too.
            if (item.isModal && item.isActive) {
                return;
            }

            // A modal route keeps the page beneath it mounted, which react-router does
            // from the background location rather than from the path.
            void navigate(item.route, item.isModal ? { state: { background: location } } : undefined);
        },
        [navigate, location],
    );

    return { items, handleNavigate };
}
