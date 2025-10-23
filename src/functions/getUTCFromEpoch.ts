// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

const getUTCFromEpoch = (epoch: number): Date => {
    const date = new Date(0);
    date.setUTCSeconds(epoch);

    return date;
};

export default getUTCFromEpoch;
