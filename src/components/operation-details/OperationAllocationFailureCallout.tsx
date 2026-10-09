// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { Callout, Intent } from '@blueprintjs/core';
import AllocationFailureDetails from '../AllocationFailureDetails';
import { TEST_IDS } from '../../definitions/TestIds';
import { getAllocationFailureDetail } from '../../functions/parseAllocationFailure';
import { OperationDetailsData } from '../../model/APIData';

interface OperationAllocationFailureCalloutProps {
    operation: OperationDetailsData | null;
}

function OperationAllocationFailureCallout({ operation }: OperationAllocationFailureCalloutProps) {
    const detail = useMemo(() => (operation ? getAllocationFailureDetail(operation) : null), [operation]);

    if (!detail) {
        return null;
    }

    return (
        <Callout
            className='operation-allocation-failure-callout'
            data-testid={TEST_IDS.OPERATION_ALLOCATION_FAILURE_CALLOUT}
            intent={Intent.DANGER}
            compact
        >
            <AllocationFailureDetails {...detail} />
        </Callout>
    );
}

export default OperationAllocationFailureCallout;
