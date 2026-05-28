// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { Button, ButtonVariant, Drawer, DrawerSize, Intent } from '@blueprintjs/core';
import { useNavigate } from 'react-router-dom';
import { useAtom } from 'jotai';
import { IconNames } from '@blueprintjs/icons';
import { TypedPerfTableRow } from '../../definitions/PerfTable';
import { TEST_IDS } from '../../definitions/TestIds';
import ROUTES from '../../definitions/Routes';
import { useOperationsList } from '../../hooks/useAPI';
import { selectedPerfRowIdAtom } from '../../store/app';
import PerfTensorPanel from './PerfTensorPanel';
import 'styles/components/PerfTensorDrawer.scss';

interface PerfTensorDrawerProps {
    rows: TypedPerfTableRow[];
}

function PerfTensorDrawer({ rows }: PerfTensorDrawerProps) {
    const [selectedPerfRowId, setSelectedPerfRowId] = useAtom(selectedPerfRowIdAtom);
    const { data: operations = [] } = useOperationsList();
    const navigate = useNavigate();

    const selectedRow = useMemo(
        () => rows.find((row) => row.id === selectedPerfRowId) ?? null,
        [rows, selectedPerfRowId],
    );

    const matchedOperation = useMemo(() => {
        if (!selectedRow?.op) {
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
                        Row {selectedRow.id} — {selectedRow.raw_op_code}
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
                {selectedRow ? (
                    <>
                        {matchedOperation ? (
                            <p className='perf-tensor-drawer-op-link'>
                                <Button
                                    onClick={() => navigate(`${ROUTES.OPERATIONS}/${matchedOperation.id}`)}
                                    variant={ButtonVariant.SOLID}
                                    icon={IconNames.CUBE}
                                    intent={Intent.PRIMARY}
                                >
                                    View operation {matchedOperation.id}: {matchedOperation.name}
                                </Button>
                            </p>
                        ) : null}

                        <PerfTensorPanel
                            row={selectedRow}
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
