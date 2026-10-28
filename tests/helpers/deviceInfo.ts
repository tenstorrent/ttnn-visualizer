// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { DeviceInfo } from '../../src/model/APIData';

// A device row with every field the L1 window ignores zeroed, for specs that only care about
// its geometry.
export const makeDevice = (fields: Partial<DeviceInfo> & Pick<DeviceInfo, 'device_id'>): DeviceInfo => ({
    address_at_first_l1_bank: 0,
    address_at_first_l1_cb_buffer: 0,
    cb_limit: 0,
    l1_bank_size: 0,
    l1_num_banks: 0,
    num_banks_per_storage_core: 0,
    num_compute_cores: 0,
    num_x_compute_cores: 0,
    num_x_cores: 0,
    num_y_compute_cores: 0,
    num_y_cores: 0,
    total_l1_for_interleaved_buffers: 0,
    total_l1_for_sharded_buffers: 0,
    total_l1_for_tensors: 0,
    total_l1_memory: 0,
    worker_l1_size: 0,
    ...fields,
});
