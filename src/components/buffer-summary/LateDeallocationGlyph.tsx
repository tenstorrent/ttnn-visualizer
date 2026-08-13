// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { LATE_DEALLOC_GLYPH_SIZE } from '../../definitions/LateDeallocation';

/**
 * Shared OUTDATED glyph for the gutter badge and the navigation-rail dots —
 * they are meant to read as the same marker twice.
 */
function LateDeallocationGlyph() {
    return (
        <Icon
            icon={IconNames.OUTDATED}
            size={LATE_DEALLOC_GLYPH_SIZE}
        />
    );
}

export default LateDeallocationGlyph;
