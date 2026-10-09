// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import AllocationFailureDetails from './AllocationFailureDetails';
import OperationErrorTraces from './OperationErrorTraces';
import { AllocationFailureDetail } from '../model/AllocationFailure';
import { OperationError } from '../model/APIData';

interface RecordedErrorDetailsProps {
    error: OperationError;
    /** From `getAllocationFailureDetail`; absent when the error is not an allocation failure. */
    allocationFailure?: AllocationFailureDetail | null;
    className?: string;
    onExpandChange?: (isOpen: boolean) => void;
}

// A recorded error, explained first when it is an allocation failure
function RecordedErrorDetails({ error, allocationFailure, className, onExpandChange }: RecordedErrorDetailsProps) {
    return (
        <>
            {allocationFailure && <AllocationFailureDetails {...allocationFailure} />}

            <OperationErrorTraces
                className={className}
                error={error}
                onExpandChange={onExpandChange}
            />
        </>
    );
}

export default RecordedErrorDetails;
