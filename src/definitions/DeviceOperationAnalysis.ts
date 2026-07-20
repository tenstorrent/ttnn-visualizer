// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export enum DEVICE_OPERATION_ANALYSIS_RESULT {
    OK,
    NOOP,
}

export const DEVICE_OPERATION_ANALYSIS_RESULT_LABEL = {
    [DEVICE_OPERATION_ANALYSIS_RESULT.OK]: '',
    [DEVICE_OPERATION_ANALYSIS_RESULT.NOOP]: 'Operation appears to be a no-op and may be removable',
};
