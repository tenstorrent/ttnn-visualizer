// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

enum Endpoints {
    BUFFER = '/api/buffer',
    BUFFERS_LIST = '/api/buffers',
    BUFFER_PAGES = '/api/buffer-pages',
    CLUSTER_DESCRIPTOR = '/api/cluster-descriptor',
    CONFIG = '/api/config',
    DEVICES = '/api/devices',
    INSTANCE = '/api/instance',
    LOCAL = '/api/local',
    MESH_DESCRIPTOR = '/api/mesh-descriptor',
    NPE = '/api/npe',
    OPERATION_BUFFERS = '/api/operation-buffers',
    OPERATIONS_LIST = '/api/operations',
    PERFORMANCE = '/api/performance',
    PROFILER = '/api/profiler',
    REMOTE = '/api/remote',
    TENSOR_LIST = '/api/tensors',
}

export default Endpoints;
