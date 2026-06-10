// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, Drawer, DrawerSize, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import 'styles/components/PerfTensorDrawer.scss';
import { TypedPerfTableRow } from '../../definitions/PerfTable';
import ROUTES from '../../definitions/Routes';
import { TEST_IDS } from '../../definitions/TestIds';
import { StackTraceLanguage } from '../../definitions/StackTrace';
import isValidNumber from '../../functions/isValidNumber';
import { useOperationsList } from '../../hooks/useAPI';
import { selectedPerfRowIdAtom } from '../../store/app';
import PerfTensorPanel from './PerfTensorPanel';
import SourceFileButton from '../operation-details/SourceFileButton';
import { extractOperationSourceData } from '../../functions/stackTraceSource';

interface PerfTensorDrawerProps {
    rows: TypedPerfTableRow[];
}

function PerfTensorDrawer({ rows }: PerfTensorDrawerProps) {
    const [selectedPerfRowId, setSelectedPerfRowId] = useAtom(selectedPerfRowIdAtom);
    const { data: operations = [] } = useOperationsList();
    const navigate = useNavigate();

    const selectedRow = rows.find((row) => row.id === selectedPerfRowId) ?? null;
    const matchedOperation = isValidNumber(selectedRow?.op)
        ? (operations.find((operation) => operation.id === selectedRow.op) ?? null)
        : null;
    const matchedOperationSourceData = matchedOperation ? extractOperationSourceData(matchedOperation) : null;

    const handleClose = () => {
        setSelectedPerfRowId(null);
    };

    return (
        <Drawer
            isOpen={selectedRow !== null}
            onClose={handleClose}
            title={
                selectedRow ? (
                    <span className='perf-tensor-drawer-title'>
                        {matchedOperation?.id} {matchedOperation?.name}
                    </span>
                ) : (
                    'Tensor details'
                )
            }
            size={DrawerSize.SMALL}
            className='perf-tensor-drawer'
        >
            <div
                className='perf-tensor-drawer-content'
                data-testid={TEST_IDS.PERF_TENSOR_DRAWER}
            >
                {matchedOperation ? (
                    <>
                        <p className='perf-tensor-drawer-op-link'>
                            <Button
                                className='navigate-button'
                                endIcon={IconNames.SEGMENTED_CONTROL}
                                intent={Intent.PRIMARY}
                                onClick={() => navigate(`${ROUTES.OPERATIONS}/${matchedOperation.id}`)}
                            >
                                Memory Details
                            </Button>
                            {matchedOperationSourceData && (
                                <SourceFileButton
                                    filePath={matchedOperationSourceData.filePath}
                                    sourceFileId={matchedOperation?.stack_trace_source_file_id ?? null}
                                    lineNumber={matchedOperationSourceData.lineNumber}
                                    language={StackTraceLanguage.PYTHON}
                                    testId={TEST_IDS.SHOW_OPERATION_SOURCE_BUTTON}
                                    ariaLabel={`View source for operation ${matchedOperation?.id} ${matchedOperation?.name}`}
                                    eagerProbe
                                />
                            )}
                        </p>

                        <PerfTensorPanel
                            operation={matchedOperation}
                            operations={operations}
                        />
                    </>
                ) : (
                    <p className='perf-tensor-drawer-empty'>
                        <em>No linked profiler operation for this row.</em>
                    </p>
                )}
            </div>
        </Drawer>
    );
}

export default PerfTensorDrawer;
