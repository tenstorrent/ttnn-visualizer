// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export enum DeviceOperationAnalysisResult {
    OK,
    NOOP,
}

export const DEVICE_OPERATION_ANALYSIS_RESULT_LABEL = {
    [DeviceOperationAnalysisResult.OK]: '',
    [DeviceOperationAnalysisResult.NOOP]: 'Operation appears to be a no-op and may be removable',
};
