// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Drawer, DrawerSize, Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom } from 'jotai';
import { useMemo } from 'react';
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
    const [selectedPerfRowId, setSelectedPerfRowId] = useAtom(selectedPerfRowIdAtom);
    const { data: operations = [] } = useOperationsList();

    const selectedRow = useMemo(
        () => rows.find((row) => row.id === selectedPerfRowId) ?? null,
        [rows, selectedPerfRowId],
    );

    const matchedOperation = useMemo(() => {
        if (!isValidNumber(selectedRow?.op)) {
            return null;
        }

        return operations.find((operation) => operation.id === selectedRow.op) ?? null;
    }, [operations, selectedRow]);

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
                                    View producer {matchedOperation.id}: {matchedOperation.name}
                                </span>
                            </Link>
                        </p>

                        <PerfTensorPanel
                            operation={matchedOperation}
                            operations={operations}
                        />
                    </>
                ) : null}
            </div>
        </Drawer>
    );
}

export default PerfTensorDrawer;
