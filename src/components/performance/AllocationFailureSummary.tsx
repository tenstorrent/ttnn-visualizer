// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Callout, Intent } from '@blueprintjs/core';
import { useAtomValue } from 'jotai';
import { Link } from 'react-router';
import 'styles/components/AllocationFailureSummary.scss';
import { ALLOCATION_FAILURE_KIND_LABELS, MAX_ALLOCATION_FAILURES_LISTED } from '../../definitions/AllocationFailure';
import ROUTES from '../../definitions/Routes';
import { TEST_IDS } from '../../definitions/TestIds';
import { getAllocationFailureSummary } from '../../functions/parseAllocationFailure';
import { AllocationFailureListing } from '../../model/AllocationFailure';
import { showHexAtom } from '../../store/app';

// Speaks of the report, not the table: the callout also shows in the stacked view, which
// has no Flags column, and filters, the range or the column picker can hide the rows.
const getRunStatus = ({ failedDeviceOperations, linkedRowCount }: AllocationFailureListing): string => {
    const hasFailedDeviceOperations = failedDeviceOperations.length > 0;
    const failedAt = hasFailedDeviceOperations ? ` in ${failedDeviceOperations.join(', ')}` : '';

    // A capture can stop before the failing operation's graph, so without a recorded
    // device op there is nothing to say whether any of it reached the device.
    if (linkedRowCount === 0 && !hasFailedDeviceOperations) {
        return 'The memory report recorded no device ops for it, so no row in this report is linked to it.';
    }

    if (linkedRowCount === 0) {
        return `Failed${failedAt} before reaching the device, so it has no row in this report.`;
    }

    const isSingle = linkedRowCount === 1;

    return `Failed${failedAt}; ${linkedRowCount} earlier device op${isSingle ? '' : 's'} ran, so it has ${linkedRowCount} row${isSingle ? '' : 's'} in this report.`;
};

interface AllocationFailureSummaryProps {
    listings: AllocationFailureListing[];
}

function AllocationFailureSummary({ listings }: AllocationFailureSummaryProps) {
    const showHex = useAtomValue(showHexAtom);

    if (listings.length === 0) {
        return null;
    }

    const hiddenCount = listings.length - MAX_ALLOCATION_FAILURES_LISTED;

    return (
        <Callout
            className='allocation-failure-summary'
            data-testid={TEST_IDS.PERF_ALLOCATION_FAILURE_SUMMARY}
            intent={Intent.DANGER}
            title={`${listings.length} allocation failure${listings.length === 1 ? '' : 's'} recorded in the linked memory report`}
            compact
        >
            <ul>
                {listings.slice(0, MAX_ALLOCATION_FAILURES_LISTED).map((listing) => {
                    const { failure } = listing;

                    return (
                        <li key={failure.operationId}>
                            <Link to={`${ROUTES.OPERATIONS}/${failure.operationId}`}>
                                {failure.operationId} {failure.operationName}
                            </Link>{' '}
                            <strong>{ALLOCATION_FAILURE_KIND_LABELS[failure.kind]}</strong>
                            <p>{getAllocationFailureSummary(failure, showHex)}</p>
                            <p className='allocation-failure-run-status'>{getRunStatus(listing)}</p>
                        </li>
                    );
                })}
            </ul>

            {hiddenCount > 0 && <p>And {hiddenCount} more, listed with their errors in the operations view.</p>}
        </Callout>
    );
}

export default AllocationFailureSummary;
