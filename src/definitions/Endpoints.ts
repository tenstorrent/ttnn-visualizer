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
    NPE_SUMMARY = '/api/npe/summary',
    NPE_WINDOW = '/api/npe/window',
    MLIR = '/api/mlir',
    OPERATION_BUFFERS = '/api/operation-buffers',
    OPERATIONS_LIST = '/api/operations',
    PERFORMANCE = '/api/performance',
    PERFORMANCE_RESULTS_REPORT = '/api/performance/perf-results/report',
    PROFILER = '/api/profiler',
    REMOTE = '/api/remote',
    REMOTE_HOST_KEY = '/api/remote/host-key',
    REMOTE_PROFILER_REPORTS = '/api/remote/profiler-reports',
    REMOTE_PERFORMANCE_REPORTS = '/api/remote/performance-reports',
    REMOTE_LOCAL_PROFILER_REPORTS = '/api/remote/local-profiler-reports',
    REMOTE_LOCAL_PERFORMANCE_REPORTS = '/api/remote/local-performance-reports',
    REMOTE_SSH_CONFIG_HOSTS = '/api/remote/ssh-config-hosts',
    REPORT_METADATA = '/api/report-metadata',
    SYSTEM_CAPABILITIES = '/api/system-capabilities', // Currently unused
    TENSOR_LIST = '/api/tensors',
    EVENT_LOGGING = '/api/event-log/events',
    LATEST_VERSION = '/api/latest-version',
}

export default Endpoints;
