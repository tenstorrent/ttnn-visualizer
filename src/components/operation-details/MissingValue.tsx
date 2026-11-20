// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

const MISSING_VALUE = '—';

interface MissingValueProps {
    reason: string;
}

// The role lets the dash carry the reason as its name: ARIA ignores `aria-label` on a bare span.
const MissingValue = ({ reason }: MissingValueProps) => (
    <span
        className='hardware-counter-missing'
        title={reason}
        role='img'
        aria-label={reason}
    >
        {MISSING_VALUE}
    </span>
);

export default MissingValue;
