// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Callout, Intent } from '@blueprintjs/core';
import { useMemo } from 'react';
import 'styles/components/UnattachedErrorsCallout.scss';
import { StackTraceLanguage } from '../definitions/StackTrace';
import { TEST_IDS } from '../definitions/TestIds';
import { useReportErrors } from '../hooks/useAPI';
import StackTrace from './operation-details/StackTrace';

// The report importer records errors it cannot place on an operation, such as one that
// crashed before it was written, under an id that names no operation or an unrelated one.
// No operation shows them, so without this they would be invisible (#2082).
function UnattachedErrorsCallout() {
    const { data: reportErrors } = useReportErrors();
    const unattachedErrors = useMemo(() => reportErrors?.filter((error) => !error.attached) ?? [], [reportErrors]);

    if (unattachedErrors.length === 0) {
        return null;
    }

    const isSingle = unattachedErrors.length === 1;

    return (
        <Callout
            className='unattached-errors-callout'
            data-testid={TEST_IDS.UNATTACHED_ERRORS}
            intent={Intent.DANGER}
            title={`${unattachedErrors.length} error${isSingle ? '' : 's'} recorded that could not be matched to an operation`}
            compact
        >
            <ul>
                {unattachedErrors.map((error, index) => (
                    <li key={index}>
                        <strong>{error.operation_name || 'Unknown operation'}</strong> {error.error_type}
                        <StackTrace
                            className='memory-error'
                            title='Error Message'
                            stackTrace={error.error_message}
                            language={StackTraceLanguage.CPP}
                            intent={Intent.DANGER}
                            hideSourceButton
                            isInline
                        />
                        {error.stack_trace && (
                            <StackTrace
                                className='memory-error'
                                title='Error Stack Trace'
                                stackTrace={error.stack_trace}
                                language={StackTraceLanguage.CPP}
                                intent={Intent.DANGER}
                                hideSourceButton
                                isInline
                            />
                        )}
                    </li>
                ))}
            </ul>
        </Callout>
    );
}

export default UnattachedErrorsCallout;
