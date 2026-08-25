// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { IconName, IconNames } from '@blueprintjs/icons';
import ROUTES from './Routes';

// What an item needs loaded before it can be entered. Kept as data rather than JSX so the
// rail, the hook that resolves reachability and the SCSS colour mixin all key off one list.
export enum NavRequirement {
    NONE = 'none',
    PROFILER_REPORT = 'profiler-report',
    PERFORMANCE_REPORT = 'performance-report',
    CLUSTER_DESCRIPTION = 'cluster-description',
    MLIR_FILE = 'mlir-file',
}

export const NAV_DISABLED_REASON: Readonly<Record<NavRequirement, string>> = Object.freeze({
    [NavRequirement.NONE]: '',
    [NavRequirement.PROFILER_REPORT]: 'Upload or select an active memory report to enable this feature',
    [NavRequirement.PERFORMANCE_REPORT]: 'Upload or select an active performance report to enable this feature',
    [NavRequirement.CLUSTER_DESCRIPTION]: 'Active memory report does not contain cluster data',
    [NavRequirement.MLIR_FILE]: 'Upload and select an active MLIR file to enable this feature',
});

export interface NavigationItem {
    label: string;
    route: string;
    icon: IconName;
    // Drives the per-tab colours in the shared SCSS mixin, so it must match the
    // selector in scss/mixins/_navigation.scss.
    className: string;
    requirement: NavRequirement;
    // Opens over the current page rather than replacing it (react-router background state).
    isModal?: boolean;
    badge?: string;
    hiddenInServerMode?: boolean;
}

export const NAVIGATION_ITEMS: readonly NavigationItem[] = Object.freeze([
    {
        label: 'Reports',
        route: ROUTES.HOME,
        icon: IconNames.DOCUMENT_OPEN,
        className: 'reports-button',
        requirement: NavRequirement.NONE,
    },
    {
        label: 'Operations',
        route: ROUTES.OPERATIONS,
        icon: IconNames.CUBE,
        className: 'operations-button',
        requirement: NavRequirement.PROFILER_REPORT,
    },
    {
        label: 'Tensors',
        route: ROUTES.TENSORS,
        icon: IconNames.FLOW_LINEAR,
        className: 'tensors-button',
        requirement: NavRequirement.PROFILER_REPORT,
    },
    {
        label: 'Buffers',
        route: ROUTES.BUFFERS,
        icon: IconNames.HORIZONTAL_BAR_CHART,
        className: 'buffers-button',
        requirement: NavRequirement.PROFILER_REPORT,
    },
    {
        label: 'Graph',
        route: ROUTES.GRAPHTREE,
        icon: IconNames.GRAPH,
        className: 'graph-button',
        requirement: NavRequirement.PROFILER_REPORT,
    },
    {
        label: 'Performance',
        route: ROUTES.PERFORMANCE,
        icon: IconNames.LIGHTNING,
        className: 'performance-button',
        requirement: NavRequirement.PERFORMANCE_REPORT,
    },
    {
        label: 'NPE',
        route: ROUTES.NPE,
        icon: IconNames.Random,
        className: 'npe-button',
        requirement: NavRequirement.NONE,
    },
    {
        label: 'Topology',
        route: ROUTES.CLUSTER,
        icon: IconNames.LayoutGrid,
        className: 'cluster-button modal',
        requirement: NavRequirement.CLUSTER_DESCRIPTION,
        isModal: true,
    },
    {
        label: 'MLIR',
        route: ROUTES.MLIR,
        icon: IconNames.Layout,
        className: 'mlir-button',
        requirement: NavRequirement.MLIR_FILE,
        badge: 'beta',
        hiddenInServerMode: true,
    },
]);
