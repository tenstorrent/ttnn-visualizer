// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The client half of the event-log vocabulary.
 *
 * These mirror the enums in `backend/ttnn_visualizer/event_logging.py`, which is the authority:
 * validation happens in the handler, because client-side checks protect nothing when
 * anything `ALLOWED_ORIGINS` permits can post. `test_event_logging_frontend_parity.py` pins the
 * two together and is the only thing that would notice them diverging — a posted event
 * the server rejects produces a 422 that this client deliberately swallows and never
 * surfaces.
 *
 * String-valued because every member crosses a serialisation boundary. Every value must
 * satisfy the backend's `_SAFE_VALUE_PATTERN` (`^[A-Za-z0-9._:+-]+$`): a value carrying a
 * space or an `=` would be dropped when the line is formatted, silently.
 */

export enum EventLogEvent {
    // Recorded by the server at launch. Present so this enum mirrors the Python one, but
    // the endpoint refuses it from a client — a page able to post launches could forge
    // the population every other figure is read against.
    APP_START = 'app_start',
    REPORT_LOADED = 'report_loaded',
    REPORT_LOAD_FAILED = 'report_load_failed',
    VIEW_OPENED = 'view_opened',
    VIEW_ENGAGED = 'view_engaged',
    // Recorded by `ttnn-visualizer-mcp` when a registered tool reaches its handler.
    // Unknown names and malformed calls are not counted. The HTTP route refuses it
    // for the same reason as `app_start`: a page able to post tool use could forge Q4.
    MCP_TOOL_CALLED = 'mcp_tool_called',
    PERF_CHART_VIEWED = 'perf_chart_viewed',
    PERF_TABLE_OPTION_TOGGLED = 'perf_table_option_toggled',
    PERF_COMPARISON_USED = 'perf_comparison_used',
    NPE_PLAYBACK_STARTED = 'npe_playback_started',
    NPE_MODE_CHANGED = 'npe_mode_changed',
    MLIR_FILE_LOADED = 'mlir_file_loaded',
    MLIR_SPLIT_VIEW_USED = 'mlir_split_view_used',
    DRILLDOWN_OPENED = 'drilldown_opened',
    FILTER_USED = 'filter_used',
    REMOTE_CONNECTION_TEST = 'remote_connection_test',
}

export enum ReportKind {
    PROFILER = 'profiler',
    PERFORMANCE = 'performance',
    NPE = 'npe',
    MLIR = 'mlir',
    CLUSTER_DESCRIPTOR = 'cluster_descriptor',
}

export enum ReportSource {
    UPLOAD = 'upload',
    REMOTE_SYNC = 'remote_sync',
    LOCAL_TT_METAL = 'local_tt_metal',
    DEMO = 'demo',
}

export enum ReportLoadFailureReason {
    // NPE-only today: profiler/performance incompatible DB versions still load.
    UNSUPPORTED_VERSION = 'unsupported_version',
    MISSING_FILE = 'missing_file',
    PARSE_ERROR = 'parse_error',
    TOO_LARGE = 'too_large',
    PERMISSION = 'permission',
    OTHER = 'other',
}

/**
 * The navigable surfaces worth counting.
 *
 * `TOPOLOGY` belongs here despite `ROUTES.CLUSTER` carrying `element: null`: the element
 * is null *because* `Layout` renders `ClusterRenderer` itself as an overlay keyed on
 * `location.state.background`. The surface is fully implemented, so a route-to-view
 * mapping derived from route elements would silently drop it — derive from `ROUTES`.
 *
 * `styleguide` is excluded and stays excluded: counting a development surface would
 * pollute reach.
 *
 * `OPERATION_DETAILS` is owned by `view_opened`, which is why `DrilldownTarget` leaves
 * it out: one navigation would otherwise be counted as two different actions. It counts
 * once per operation viewed rather than once per visit to the surface, so its total is
 * not comparable to the other ten and should be read per-session or deduplicated.
 */
export enum EventLogView {
    REPORTS = 'reports',
    OPERATIONS = 'operations',
    OPERATION_DETAILS = 'operation_details',
    TENSORS = 'tensors',
    BUFFERS = 'buffers',
    GRAPH = 'graph',
    PERFORMANCE = 'performance',
    NPE = 'npe',
    MLIR = 'mlir',
    TOPOLOGY = 'topology',
    MCP = 'mcp',
}

/**
 * The vocabularies below serve the per-surface events from #1837. What each one counts,
 * and the caveats for reading it, live on its Python twin in `event_logging.py` and in
 * `docs/src/event-logging.md`.
 */

// The `PerfChartId` members without their `perf-chart-` DOM prefix, so the exported label
// does not move with markup.
export enum PerfChart {
    OP_DURATION_HISTOGRAM = 'op_duration_histogram',
    OP_COUNT_VS_RUNTIME = 'op_count_vs_runtime',
    CORE_COUNT_KERNEL_RUNTIME = 'core_count_kernel_runtime',
    KERNEL_DURATION_VS_CORE_COUNT = 'kernel_duration_vs_core_count',
    MATMUL_CORE_COUNT_UTILIZATION = 'matmul_core_count_utilization',
    MATMUL_DEVICE_TIME = 'matmul_device_time',
    MATMUL_KERNEL_DURATION_UTILIZATION = 'matmul_kernel_duration_utilization',
    MATMUL_UTILIZATION_VS_KERNEL_DURATION = 'matmul_utilization_vs_kernel_duration',
    CONV_CORE_COUNT_UTILIZATION = 'conv_core_count_utilization',
    CONV_DEVICE_TIME = 'conv_device_time',
    CONV_KERNEL_DURATION_UTILIZATION = 'conv_kernel_duration_utilization',
    CONV_UTILIZATION_VS_KERNEL_DURATION = 'conv_utilization_vs_kernel_duration',
    OPERATION_TYPES = 'operation_types',
}

export enum PerfTableOption {
    HIDE_HOST_OPS = 'hide_host_ops',
    MERGE_DEVICES = 'merge_devices',
    TRACING_MODE = 'tracing_mode',
    MATMUL_ADVICE = 'matmul_advice',
    HIGHLIGHT_HIGH_DISPATCH = 'highlight_high_dispatch',
    NORMALISE_DATA = 'normalise_data',
}

export enum ComparisonReportCountBucket {
    ONE = 'one',
    TWO = 'two',
    THREE_OR_MORE = 'three_or_more',
}

export enum NpeMode {
    CONGESTION = 'congestion',
    TRANSFERS = 'transfers',
    NOC0 = 'noc0',
    NOC1 = 'noc1',
    ALL_NOCS = 'all_nocs',
    FABRIC_EVENTS = 'fabric_events',
    LOCAL_EVENTS = 'local_events',
    ALT_CONGESTION_COLOURS = 'alt_congestion_colours',
    TIMESTEPS_SCALE = 'timesteps_scale',
    CYCLES_SCALE = 'cycles_scale',
    ZONES = 'zones',
}

// Every member but `OTHER` is an extension in `MLIR_SERVER_ACCEPTED_EXTENSIONS`, without the dot.
export enum MlirFileFormat {
    PB = 'pb',
    PBTXT = 'pbtxt',
    GRAPHDEF = 'graphdef',
    TFLITE = 'tflite',
    JSON = 'json',
    PT2 = 'pt2',
    MLIR = 'mlir',
    MLIRBC = 'mlirbc',
    OTHER = 'other',
}

// `operation_details` is absent on purpose: it is a route, and `view_opened` owns it.
export enum DrilldownTarget {
    TENSOR_DETAILS = 'tensor_details',
    BUFFER_DETAILS = 'buffer_details',
    STACK_TRACE = 'stack_trace',
    SOURCE_FILE = 'source_file',
}

export enum FilterSurface {
    OPERATIONS = 'operations',
    TENSORS = 'tensors',
    PERF_OP_CODE = 'perf_op_code',
    MLIR_OP = 'mlir_op',
}

export enum RemoteConnectionTestResult {
    SUCCESS = 'success',
    AUTH_FAILED = 'auth_failed',
    HOST_KEY_REJECTED = 'host_key_rejected',
    UNREACHABLE = 'unreachable',
    NO_REPORTS_FOUND = 'no_reports_found',
    REPORT_PATH_FAILED = 'report_path_failed',
    OTHER = 'other',
}

/**
 * One event as it goes over the wire.
 *
 * `details` is nested rather than flattened beside `event`, and every property in it is
 * required: `validate_client_event` closes the envelope to exactly these two keys and
 * compares the detail keys as a set, so a missing key fails identically to an unknown one
 * and takes the whole batch with it.
 *
 * `reason_class` and `report_count_bucket` are snake_case because they are wire fields, not
 * TS properties — renaming either to camelCase would break every post that carries it.
 *
 * An event with no details is typed `Record<string, never>` and posts `details: {}`: the
 * server still requires the key, and `@typescript-eslint/no-empty-object-type` rejects a
 * bare `{}` type.
 */
export type EventLogEventPayload =
    | { event: EventLogEvent.REPORT_LOADED; details: { kind: ReportKind; source: ReportSource } }
    | {
          event: EventLogEvent.REPORT_LOAD_FAILED;
          details: { kind: ReportKind; reason_class: ReportLoadFailureReason };
      }
    | { event: EventLogEvent.VIEW_OPENED; details: { view: EventLogView } }
    | { event: EventLogEvent.VIEW_ENGAGED; details: { view: EventLogView } }
    | { event: EventLogEvent.PERF_CHART_VIEWED; details: { chart: PerfChart } }
    | { event: EventLogEvent.PERF_TABLE_OPTION_TOGGLED; details: { option: PerfTableOption } }
    | {
          event: EventLogEvent.PERF_COMPARISON_USED;
          details: { report_count_bucket: ComparisonReportCountBucket };
      }
    | { event: EventLogEvent.NPE_PLAYBACK_STARTED; details: Record<string, never> }
    | { event: EventLogEvent.NPE_MODE_CHANGED; details: { mode: NpeMode } }
    | { event: EventLogEvent.MLIR_FILE_LOADED; details: { format: MlirFileFormat } }
    | { event: EventLogEvent.MLIR_SPLIT_VIEW_USED; details: Record<string, never> }
    | { event: EventLogEvent.DRILLDOWN_OPENED; details: { target: DrilldownTarget } }
    | { event: EventLogEvent.FILTER_USED; details: { surface: FilterSurface } }
    | { event: EventLogEvent.REMOTE_CONNECTION_TEST; details: { result: RemoteConnectionTestResult } };
