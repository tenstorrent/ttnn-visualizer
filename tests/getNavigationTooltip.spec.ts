// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Blueprint mounts the rail's tooltip only on hover, and jsdom does not drive Blueprint's
 * hover machinery -- nor would a jsdom hover prove much, since it dispatches hover on
 * disabled buttons where a real browser does not. So the branch logic is asserted here;
 * `SideNavigation` passes the result straight to the tooltip's `content` and gates its
 * `disabled` prop on the result being empty.
 */

import { describe, expect, it } from 'vitest';
import getNavigationTooltip from '../src/functions/getNavigationTooltip';
import { ResolvedNavigationItem } from '../src/hooks/useMainNavigationItems';
import ROUTES from '../src/definitions/Routes';

const item = (overrides: Partial<ResolvedNavigationItem> = {}) =>
    ({
        label: 'Operations',
        route: ROUTES.OPERATIONS,
        disabledReason: null,
        isDisabled: false,
        isActive: false,
        ...overrides,
    }) as ResolvedNavigationItem;

const BLOCKED = 'Upload or select an active memory report to enable this feature';

describe('getNavigationTooltip', () => {
    // Four items share the PROFILER_REPORT reason, so on a collapsed icon-only rail the
    // reason alone would give four identical tooltips with nothing naming the view.
    it('names the item as well as the reason when collapsed and blocked', () => {
        expect(getNavigationTooltip(item({ disabledReason: BLOCKED }), true)).toBe(`Operations — ${BLOCKED}`);
    });

    // Expanded, the label is already on screen beside it, so repeating it is noise.
    it('gives the reason alone when expanded and blocked', () => {
        expect(getNavigationTooltip(item({ disabledReason: BLOCKED }), false)).toBe(BLOCKED);
    });

    it('names the item when collapsed and reachable', () => {
        expect(getNavigationTooltip(item(), true)).toBe('Operations');
    });

    // Null rather than an empty string, so the caller can gate `disabled` on it and never
    // render a blank tooltip.
    it('offers nothing when expanded and reachable', () => {
        expect(getNavigationTooltip(item(), false)).toBeNull();
    });
});
