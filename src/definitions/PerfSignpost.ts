// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export interface Signpost {
    id: number;
    op_code: string;
}

export enum MathFidelity {
    HiFi4 = 'HiFi4',
    HiFi2 = 'HiFi2',
    LoFi = 'LoFi',
}
