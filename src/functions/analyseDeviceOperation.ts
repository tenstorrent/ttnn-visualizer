// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { DeviceOperationNode, TensorNode } from '../model/APIData';

const DEVICE_OPERATION_NAME = {
    RESHAPE: 'tensor::reshape',
};

export enum DEVICE_OPERATION_ANALYSIS_RESULT {
    OK,
    NOOP,
}

export const DEVICE_OPERATION_ANALYSIS_RESULT_LABEL = {
    [DEVICE_OPERATION_ANALYSIS_RESULT.OK]: '',
    [DEVICE_OPERATION_ANALYSIS_RESULT.NOOP]: 'Operations appears to be a no-op and may be removable',
};

export const analyseDeviceOperation = (operation?: DeviceOperationNode) => {
    if (!operation) {
        return DEVICE_OPERATION_ANALYSIS_RESULT.OK;
    }
    const { params, inputs, outputs } = operation;
    const { name } = params;

    if (name.toLowerCase() === DEVICE_OPERATION_NAME.RESHAPE) {
        const inputTensor: TensorNode = inputs?.[0] as TensorNode;
        const outputTensor = outputs?.[0] as TensorNode;
        if (inputTensor && outputTensor) {
            const inputShape = inputTensor.params.shape;
            const outputShape = outputTensor.params.shape;
            if (inputShape === outputShape) {
                return DEVICE_OPERATION_ANALYSIS_RESULT.NOOP;
            }
        }
    }
    return DEVICE_OPERATION_ANALYSIS_RESULT.OK;
};
