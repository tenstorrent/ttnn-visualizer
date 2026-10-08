// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { Callout, Intent } from '@blueprintjs/core';
import AllocationFailureDetails from '../AllocationFailureDetails';
import { TEST_IDS } from '../../definitions/TestIds';
import { getFailedDeviceOperationNames } from '../../functions/linkableDeviceOperations';
import { parseAllocationFailure } from '../../functions/parseAllocationFailure';
import { OperationDetailsData } from '../../model/APIData';

interface OperationAllocationFailureCalloutProps {
    operation: OperationDetailsData | null;
}

function OperationAllocationFailureCallout({ operation }: OperationAllocationFailureCalloutProps) {
    const failure = useMemo(() => (operation ? parseAllocationFailure(operation) : null), [operation]);
    const failedDeviceOperations = useMemo(
        () => getFailedDeviceOperationNames(operation?.device_operations),
        [operation],
    );

    if (!failure) {
        return null;
    }

    return (
        <Callout
            className='operation-allocation-failure-callout'
            data-testid={TEST_IDS.OPERATION_ALLOCATION_FAILURE_CALLOUT}
            intent={Intent.DANGER}
            compact
        >
            <AllocationFailureDetails
                failure={failure}
                failedDeviceOperations={failedDeviceOperations}
            />
        </Callout>
    );
}

export default OperationAllocationFailureCallout;
