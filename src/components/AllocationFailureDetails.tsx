// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue } from 'jotai';
import 'styles/components/AllocationFailureDetails.scss';
import { ALLOCATION_FAILURE_KIND_LABELS } from '../definitions/AllocationFailure';
import { TEST_IDS } from '../definitions/TestIds';
import { getAllocationFailureDiagnosis, getAllocationFailureSummary } from '../functions/parseAllocationFailure';
import { AllocationFailure } from '../model/AllocationFailure';
import { showHexAtom } from '../store/app';

interface AllocationFailureDetailsProps {
    failure: AllocationFailure;
    failedDeviceOperations: string[];
}

function AllocationFailureDetails({ failure, failedDeviceOperations }: AllocationFailureDetailsProps) {
    const showHex = useAtomValue(showHexAtom);
    const diagnosis = getAllocationFailureDiagnosis(failure, showHex);

    return (
        <div
            className='allocation-failure-details'
            data-testid={TEST_IDS.ALLOCATION_FAILURE_DETAILS}
        >
            <strong>{ALLOCATION_FAILURE_KIND_LABELS[failure.kind]}</strong>
            <p>{getAllocationFailureSummary(failure, showHex)}</p>
            {diagnosis && <p className='allocation-failure-diagnosis'>{diagnosis}</p>}
            {failedDeviceOperations.length > 0 && <p>Failed in {failedDeviceOperations.join(', ')}</p>}
        </div>
    );
}

export default AllocationFailureDetails;
