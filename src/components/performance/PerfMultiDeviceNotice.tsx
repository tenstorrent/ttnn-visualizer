// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Callout, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

const PerfMultiDeviceNotice = () => {
    return (
        <Callout
            className='multi-device-note'
            intent={Intent.PRIMARY}
            icon={IconNames.INFO_SIGN}
            compact
        >
            Multi device operations are merged into single rows using <u>average duration</u> for collective operations
            (AllGather, ReduceScatter, AllReduce) and <u>maximum duration</u> for all others.
        </Callout>
    );
};

export default PerfMultiDeviceNotice;
