// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import classNames from 'classnames';
import { Fragment } from 'react/jsx-runtime';
import { formatSize } from '../functions/math';
import { getCoreColour, getOpToOpGapColour } from '../functions/perfFunctions';
import { DeviceOperationMapping, useGetDeviceOperationListPerf } from '../hooks/useAPI';
import { OperationDescription } from '../model/APIData';

interface OperationListPerfDataProps {
    operation: OperationDescription;
}

const OperationListPerfData = ({ operation }: OperationListPerfDataProps) => {
    const perfData = useGetDeviceOperationListPerf();

    return (
        <div className='perf-data'>
            {perfData
                ?.filter((perf: DeviceOperationMapping) => perf.id === operation.id)
                .map(
                    (perf) =>
                        perf.perfData && (
                            <Fragment key={perf.id + perf.operationName}>
                                <strong>{perf.perfData?.raw_op_code}</strong>
                                <div>
                                    <span className={classNames('monospace', getCoreColour(perf.perfData?.cores))}>
                                        {parseInt(perf.perfData?.cores, 10)} core
                                        {parseInt(perf.perfData?.cores, 10) > 1 && 's'}
                                    </span>
                                    , execution time{' '}
                                    <span className='monospace'>
                                        {formatSize(parseFloat(perf.perfData?.device_time))} µs
                                    </span>{' '}
                                    <span className='monospace'>
                                        ({formatSize(parseFloat(perf.perfData?.total_percent))} %)
                                    </span>
                                    {perf.perfData?.op_to_op_gap && (
                                        <>
                                            ,{' '}
                                            <span
                                                className={classNames(
                                                    'monospace',
                                                    getOpToOpGapColour(perf.perfData.op_to_op_gap),
                                                )}
                                            >
                                                {formatSize(parseFloat(perf.perfData.op_to_op_gap))} µs
                                            </span>{' '}
                                            op-to-op gap.
                                        </>
                                    )}
                                </div>
                            </Fragment>
                        ),
                )}
        </div>
    );
};

export default OperationListPerfData;
