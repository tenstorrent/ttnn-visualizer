// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Callout, Intent } from '@blueprintjs/core';
import { useMemo } from 'react';
import 'styles/components/UnattachedErrorsCallout.scss';
import { MAX_UNATTACHED_ERRORS_LISTED } from '../definitions/ReportErrors';
import { TEST_IDS } from '../definitions/TestIds';
import { getAllocationFailureDetail } from '../functions/parseAllocationFailure';
import { useReportErrors } from '../hooks/useAPI';
import RecordedErrorDetails from './RecordedErrorDetails';

// The report importer records errors it cannot place on an operation, such as one that
// crashed before it was written, under an id that names no operation or an unrelated one.
// A second row for an operation that already shows one is also unattached. No operation
// shows these, so without this they would be invisible (#2082).
function UnattachedErrorsCallout() {
    const { data: reportErrors } = useReportErrors();
    const unattachedErrors = useMemo(
        () =>
            reportErrors
                ?.filter((error) => !error.attached)
                .map((error) => ({
                    error,
                    // An operation that crashes allocating memory is a likely reason its error
                    // was never placed on it. No captured graph comes with the error, so no
                    // failed device op can be named.
                    allocationFailure: getAllocationFailureDetail({
                        id: error.operation_id,
                        name: error.operation_name,
                        error,
                        device_operations: [],
                    }),
                })) ?? [],
        [reportErrors],
    );

    if (unattachedErrors.length === 0) {
        return null;
    }

    const isSingle = unattachedErrors.length === 1;
    const hiddenCount = unattachedErrors.length - MAX_UNATTACHED_ERRORS_LISTED;

    return (
        <Callout
            className='unattached-errors-callout'
            data-testid={TEST_IDS.UNATTACHED_ERRORS}
            intent={Intent.DANGER}
            title={`${unattachedErrors.length} error${isSingle ? '' : 's'} recorded that ${isSingle ? 'is' : 'are'} not shown on any operation`}
            compact
        >
            <ul>
                {unattachedErrors.slice(0, MAX_UNATTACHED_ERRORS_LISTED).map(({ error, allocationFailure }, index) => (
                    <li key={index}>
                        <strong>{error.operation_name || 'Unknown operation'}</strong> {error.error_type}
                        <RecordedErrorDetails
                            error={error}
                            allocationFailure={allocationFailure}
                        />
                    </li>
                ))}
            </ul>

            {hiddenCount > 0 && <p>And {hiddenCount} more.</p>}
        </Callout>
    );
}

export default UnattachedErrorsCallout;
