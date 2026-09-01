// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The client half of the usage-event vocabulary.
 *
 * These mirror the enums in `backend/ttnn_visualizer/usage.py`, which is the authority:
 * validation happens in the handler, because client-side checks protect nothing when
 * anything `ALLOWED_ORIGINS` permits can post. `test_usage_frontend_parity.py` pins the
 * two together and is the only thing that would notice them diverging — a posted event
 * the server rejects produces a 422 that this client deliberately swallows and never
 * surfaces.
 *
 * String-valued because every member crosses a serialisation boundary. Every value must
 * satisfy the backend's `_SAFE_VALUE_PATTERN` (`^[A-Za-z0-9._:+-]+$`): a value carrying a
 * space or an `=` would be dropped when the line is formatted, silently.
 */

export enum UsageEvent {
    // Recorded by the server at launch. Present so this enum mirrors the Python one, but
    // the endpoint refuses it from a client — a page able to post launches could forge
    // the population every other figure is read against.
    APP_START = 'app_start',
    REPORT_LOADED = 'report_loaded',
    REPORT_LOAD_FAILED = 'report_load_failed',
    VIEW_OPENED = 'view_opened',
    VIEW_ENGAGED = 'view_engaged',
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
 * `OPERATION_DETAILS` is owned by `view_opened`. A future `drilldown_opened` event must
 * exclude it, or one navigation would be counted as two different actions.
 */
export enum UsageView {
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
}

/**
 * One event as it goes over the wire.
 *
 * `details` is nested rather than flattened beside `event`, and every property in it is
 * required: `validate_client_event` closes the envelope to exactly these two keys and
 * compares the detail keys as a set, so a missing key fails identically to an unknown one
 * and takes the whole batch with it.
 *
 * `reason_class` is snake_case because it is a wire field, not a TS property — renaming
 * it to camelCase would break every `report_load_failed` post.
 */
export type UsageEventPayload =
    | { event: UsageEvent.REPORT_LOADED; details: { kind: ReportKind; source: ReportSource } }
    | {
          event: UsageEvent.REPORT_LOAD_FAILED;
          details: { kind: ReportKind; reason_class: ReportLoadFailureReason };
      }
    | { event: UsageEvent.VIEW_OPENED; details: { view: UsageView } }
    | { event: UsageEvent.VIEW_ENGAGED; details: { view: UsageView } };
