// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { DEVICE_OPERATION_ANALYSIS_RESULT } from '../definitions/DeviceOperationAnalysis';
import { DeviceOperationNode, TensorNode } from '../model/APIData';

const DEVICE_OPERATION_NAME = {
    RESHAPE: 'tensor::reshape',
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
        if (inputTensor && outputTensor && inputTensor.params.shape && outputTensor.params.shape) {
            if (inputTensor.params.shape === outputTensor.params.shape) {
                return DEVICE_OPERATION_ANALYSIS_RESULT.NOOP;
            }
        }
    }
    return DEVICE_OPERATION_ANALYSIS_RESULT.OK;
};
