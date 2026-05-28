// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Drawer, DrawerSize, Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtomValue, useSetAtom } from 'jotai';
import { Link } from 'react-router-dom';
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
                        Row ID {selectedRow.id}: {selectedRow.raw_op_code}
                    </span>
                ) : (
                    'Tensor details'
                )
            }
            size={DrawerSize.SMALL}
            className='perf-tensor-drawer'
            data-testid={TEST_IDS.PERF_TENSOR_DRAWER}
        >
            <div className='perf-tensor-drawer-content'>
                {matchedOperation ? (
                    <>
                        <p className='perf-tensor-drawer-op-link'>
                            <Link
                                className='perf-tensor-drawer-op-link-anchor'
                                to={`${ROUTES.OPERATIONS}/${matchedOperation.id}`}
                            >
                                <Icon icon={IconNames.CUBE} />
                                <span>
                                    View operation {matchedOperation.id}: {matchedOperation.name}
                                </span>
                            </Link>
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
