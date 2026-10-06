// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Intent, PopoverPosition, Tag, Tooltip } from '@blueprintjs/core';
import GlobalSwitch from './GlobalSwitch';
import { TEST_IDS } from '../definitions/TestIds';
import 'styles/components/LateDeallocationControl.scss';

const UNKNOWN_COUNT = '–';

interface LateDeallocationControlProps {
    /** `null` when the count isn't known; shown as a dash so it can't read as an all-clear. */
    count: number | null;
    /** Tooltip and accessible name for the count; callers word it for what they count. */
    countSummary: string;
    checked: boolean;
    onChange: () => void;
    disabled?: boolean;
}

/**
 * The "Mark late tensor deallocations" switch with its finding count beside it
 * (#963, #1862). The count shows whether or not the overlay is on, so the
 * switch advertises whether it is worth flipping.
 */
function LateDeallocationControl({
    count,
    countSummary,
    checked,
    onChange,
    disabled = false,
}: LateDeallocationControlProps) {
    return (
        <div className='late-dealloc-control'>
            <GlobalSwitch
                label='Mark late tensor deallocations'
                checked={checked}
                onChange={onChange}
                disabled={disabled}
            />
            <Tooltip
                content={countSummary}
                placement={PopoverPosition.BOTTOM}
            >
                <Tag
                    // Warning colour asserts there is something to look
                    // at, so a zero stays neutral rather than dressing
                    // an all-clear as a finding.
                    intent={count !== null && count > 0 ? Intent.WARNING : Intent.NONE}
                    minimal
                    round
                    // The tag renders a bare numeral, and the tooltip
                    // that explains it only wires `aria-describedby`
                    // while its popover is open — so without a name of
                    // its own the count is announced as just a number.
                    aria-label={countSummary}
                    data-testid={TEST_IDS.LATE_DEALLOC_COUNT}
                >
                    {count ?? UNKNOWN_COUNT}
                </Tag>
            </Tooltip>
        </div>
    );
}

export default LateDeallocationControl;
