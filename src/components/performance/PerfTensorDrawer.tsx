// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, Drawer, DrawerSize, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtomValue, useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import 'styles/components/PerfTensorDrawer.scss';
import { TypedPerfTableRow } from '../../definitions/PerfTable';
import ROUTES from '../../definitions/Routes';
import { TEST_IDS } from '../../definitions/TestIds';
import isValidNumber from '../../functions/isValidNumber';
import { useOperationsList } from '../../hooks/useAPI';
import { selectedPerfRowIdAtom } from '../../store/app';
import PerfTensorPanel from './PerfTensorPanel';

interface PerfTensorDrawerProps {
    rows: TypedPerfTableRow[];
}

function PerfTensorDrawer({ rows }: PerfTensorDrawerProps) {
    const selectedPerfRowId = useAtomValue(selectedPerfRowIdAtom);
    const setSelectedPerfRowId = useSetAtom(selectedPerfRowIdAtom);
    const { data: operations = [] } = useOperationsList();
    const navigate = useNavigate();

    const selectedRow = rows.find((row) => row.id === selectedPerfRowId) ?? null;
    const matchedOperation = isValidNumber(selectedRow?.op)
        ? (operations.find((operation) => operation.id === selectedRow.op) ?? null)
        : null;

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
