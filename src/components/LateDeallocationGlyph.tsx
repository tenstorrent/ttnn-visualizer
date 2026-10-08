// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { LATE_DEALLOC_GLYPH_SIZE } from '../definitions/LateDeallocation';

/**
 * Shared OUTDATED glyph for the Buffer Summary gutter badge and rail dots and
 * the Operation Details legend marker — they are meant to read as one marker.
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
