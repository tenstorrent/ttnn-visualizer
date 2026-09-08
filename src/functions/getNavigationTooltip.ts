// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ResolvedNavigationItem } from '../hooks/useMainNavigationItems';

/**
 * What the navigation rail's tooltip should say for an item, or null when it has nothing
 * to add. Null rather than an empty string so the caller can gate the tooltip on it and
 * never render a blank one.
 *
 * Collapsed, the label is the only thing identifying an icon, so it has to reach the
 * tooltip; expanded, the label is already on screen and only a blocked item has something
 * left to say. A collapsed item that is also blocked needs both -- four items share the
 * same disabled reason, so the reason alone names nothing.
 *
 * Lives outside the component so it can be tested directly: Blueprint mounts the tooltip
 * only on hover, which jsdom does not drive.
 */
function getNavigationTooltip(item: ResolvedNavigationItem, isCollapsed: boolean): string | null {
    if (item.disabledReason) {
        return isCollapsed ? `${item.label} — ${item.disabledReason}` : item.disabledReason;
    }

    return isCollapsed ? item.label : null;
}

export default getNavigationTooltip;
