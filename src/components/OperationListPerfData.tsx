// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import classNames from 'classnames';
import { Fragment } from 'react/jsx-runtime';
import { DEVICE_TIME_SHARE_SUFFIX } from '../definitions/Performance';
import { formatSize } from '../functions/math';
import { formatDeviceTimeShare, getCoreColour, getOpToOpGapColour } from '../functions/perfFunctions';
import { useGetDeviceOperationListPerfByOpId } from '../hooks/useAPI';
import { OperationDescription } from '../model/APIData';

interface OperationListPerfDataProps {
    operation: OperationDescription;
    /** The linked report's device time, which each device operation's share divides by. */
    totalDeviceTimeUs: number;
}

const EMPTY_PERF_DEVICE_OPERATIONS: never[] = [];

interface DeviceTimeShareProps {
    deviceTimeUs: number;
    totalDeviceTimeUs: number;
}

// As in Operation Details: tt-perf-report's Total % adds the op-to-op gap, which dominates an untraced capture.
const DeviceTimeShare = ({ deviceTimeUs, totalDeviceTimeUs }: DeviceTimeShareProps) => {
    const share = formatDeviceTimeShare(deviceTimeUs, totalDeviceTimeUs);

    return (
        share && (
            <>
                {' '}
                (<span className='monospace'>{share}</span> {DEVICE_TIME_SHARE_SUFFIX})
            </>
        )
    );
};

const OperationListPerfData = ({ operation, totalDeviceTimeUs }: OperationListPerfDataProps) => {
    // Grouped by op id rather than scanned, because this renders once per row of
    // a virtualised list and a filter over the whole match is O(rows) per row.
    const perfDataByOpId = useGetDeviceOperationListPerfByOpId();
    const perfDeviceOperations = perfDataByOpId.get(operation.id) ?? EMPTY_PERF_DEVICE_OPERATIONS;

    return (
        <div className='perf-data'>
            {perfDeviceOperations.length > 0 &&
                perfDeviceOperations.map(({ perfData, operationName, id }, index) => {
                    if (!perfData) {
                        return null;
                    }

                    const deviceTimeUs = parseFloat(perfData.device_time);

                    return (
                        <Fragment key={`${operation.id}${operationName}${id}${index}`}>
                            <strong>{perfData.raw_op_code}</strong>
                            <div>
                                <span
                                    className={classNames(
                                        'monospace',
                                        getCoreColour(perfData.cores, perfData.available_cores, perfData.dram_sharded),
                                    )}
                                >
                                    {parseInt(perfData.cores, 10)} core
                                    {parseInt(perfData.cores, 10) > 1 && 's'}
                                </span>
                                , execution time <span className='monospace'>{formatSize(deviceTimeUs)} µs</span>
                                <DeviceTimeShare
                                    deviceTimeUs={deviceTimeUs}
                                    totalDeviceTimeUs={totalDeviceTimeUs}
                                />
                                {perfData.op_to_op_gap && (
                                    <>
                                        ,{' '}
                                        <span
                                            className={classNames(
                                                'monospace',
                                                getOpToOpGapColour(parseFloat(perfData.op_to_op_gap)),
                                            )}
                                        >
                                            {formatSize(parseFloat(perfData.op_to_op_gap))} µs
                                        </span>{' '}
                                        op-to-op gap.
                                    </>
                                )}
                            </div>
                        </Fragment>
                    );
                })}
            {perfDeviceOperations.length === 0 && operation.deviceOperationNameList.length > 0 && (
                <div>
                    {operation.deviceOperationNameList.map((op: string, index) => {
                        return (
                            <div key={`${operation.id}-${op}-${index}`}>
                                <strong>{op}</strong>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default OperationListPerfData;
