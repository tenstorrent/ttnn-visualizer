// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import classNames from 'classnames';
import { ConnectionStatus } from '../../definitions/ConnectionStatus';
import { CONNECTION_TEST_LEGEND, STALE_CONNECTION_TESTS_CLASS } from '../../definitions/ConnectionDialog';
import { TEST_IDS } from '../../definitions/TestIds';
import ConnectionTestMessage from './ConnectionTestMessage';

interface ConnectionTestResultsProps {
    /** The name check, recomputed as the user types rather than captured by a test run. */
    nameStatus: ConnectionStatus;
    /** Whether the name collides, which is the one verdict worth giving unprompted. */
    isNameTaken: boolean;
    /** What the last run found, if one has been asked for. */
    tests: readonly ConnectionStatus[];
    /** Marks the run's results as no longer describing what the form now holds. */
    isStale?: boolean;
}

/**
 * The verdict block both connection dialogs show above their actions. A name that collides can
 * only be something the user typed, so reporting it before they ask for a test is feedback
 * rather than an unprompted complaint; a name not filled in yet is the latter, so it waits for
 * the run the rest of the results arrive with.
 */
const ConnectionTestResults = ({ nameStatus, isNameTaken, tests, isStale = false }: ConnectionTestResultsProps) => {
    if (tests.length === 0 && !isNameTaken) {
        return null;
    }

    return (
        <fieldset>
            <legend>{CONNECTION_TEST_LEGEND}</legend>

            <ConnectionTestMessage
                status={nameStatus.status}
                message={nameStatus.message}
            />

            {/* Server results only exist once a test has run. Editing a field the test
                exercises leaves them on screen, marked as no longer applying — which the
                name above never is, so it sits outside the marking. */}
            <div
                className={classNames('connection-test-results', { [STALE_CONNECTION_TESTS_CLASS]: isStale })}
                data-testid={TEST_IDS.CONNECTION_TEST_RESULTS}
            >
                {tests.map((test, index) => (
                    <ConnectionTestMessage
                        key={`${test.message}-${index}`}
                        status={test.status}
                        message={test.message}
                        detail={test.detail}
                    />
                ))}
            </div>
        </fieldset>
    );
};

export default ConnectionTestResults;
