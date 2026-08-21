# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import dataclasses
import json
import logging
import platform
import re
import shutil
import time
import urllib
import urllib.request
from enum import Enum
from http import HTTPStatus
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import orjson
import yaml
import zstd
from flask import Blueprint, Response, abort, current_app, jsonify, request, session
from pydantic import ValidationError
from ttnn_visualizer.csv_queries import (
    DeviceLogProfilerQueries,
    NPEQueries,
    OpsPerformanceQueries,
    OpsPerformanceReportQueries,
)
from ttnn_visualizer.decorators import (
    local_only,
    refuse_in_direct_report_mode,
    with_instance,
)
from ttnn_visualizer.enums import (
    ConnectionTestStates,
    HostKeyIssue,
    StackSourceOrigin,
)
from ttnn_visualizer.exceptions import (
    DataFormatError,
    InvalidRequestPayload,
    PerformanceReportNotLoadedException,
    RemoteConnectionException,
    RemoteFileReadException,
    error_response,
    response_bad_request,
    response_forbidden,
    response_internal_server_error,
    response_not_found,
    response_unprocessable_entity,
)
from ttnn_visualizer.file_uploads import (
    extract_npe_name,
    resolve_parent_folder_name,
    save_uploaded_files,
    validate_files,
)
from ttnn_visualizer.instances import get_instances, update_instance
from ttnn_visualizer.known_hosts import (
    append_host_keys,
    resolve_ssh_target,
    scan_host_keys,
    search_known_hosts,
)
from ttnn_visualizer.local_remote_reports import (
    list_local_synced_performance_folders,
    list_local_synced_profiler_folders,
    local_synced_report_path,
)
from ttnn_visualizer.mlir import (
    dumps_graph_bundle,
    relabel_graph_ids,
    test_mlir_server_connection,
    upload_and_convert_mlir,
)
from ttnn_visualizer.models import (
    ConnectionStatusMessage,
    HostKeyOfferResponse,
    HostKeyTarget,
    HostKeyTrustRequest,
    Instance,
    MlirServerConnection,
    RemoteConnection,
    RemoteReportFolder,
    ReportLocation,
    StatusMessage,
    folder_segment_from_remote_path,
    sanitise_path_segment,
    sanitise_remote_host_segment,
)
from ttnn_visualizer.npe_index import ensure_index, read_summary, read_window
from ttnn_visualizer.queries import DatabaseQueries
from ttnn_visualizer.report_source_file import (
    read_report_source_file,
    report_source_file_available,
)
from ttnn_visualizer.serializers import (
    serialize_buffer,
    serialize_buffer_chunks,
    serialize_devices,
    serialize_operation,
    serialize_operation_buffers,
    serialize_operations,
    serialize_operations_buffers,
    serialize_tensors,
)
from ttnn_visualizer.sftp_operations import (
    MULTIHOST_REPORT_LAYOUT_HINT,
    RemoteReportPathOutcome,
    RemoteSearchRootState,
    check_remote_path_for_reports,
    get_active_sync_method,
    get_remote_performance_folders,
    get_remote_profiler_folders,
    sync_remote_performance_folders,
    sync_remote_profiler_folders,
)
from ttnn_visualizer.ssh_client import SSHClient
from ttnn_visualizer.ssh_config import load_ssh_config_hosts
from ttnn_visualizer.stack_trace_source import (
    check_stack_source_local_with_origin,
    check_stack_source_remote_with_origin,
    read_stack_source_local,
    read_stack_source_remote,
    stack_source_response,
)
from ttnn_visualizer.usage import (
    MAX_USAGE_BATCH_EVENTS,
    UsageEvent,
    UsageEventRejected,
    is_recording_enabled,
    record_events,
    validate_client_event,
)
from ttnn_visualizer.utils import (
    PERFORMANCE_OPS_PERF_PREFIX,
    PERFORMANCE_REPORT_REQUIRED_FILES,
    create_path_resolver,
    get_mlir_path,
    get_performance_path,
    get_profiler_path,
    is_valid_performance_report_dir,
    is_valid_profiler_report_dir,
    pick_cluster_descriptor_path,
    pick_mesh_descriptor_path,
    pick_profiler_config_paths,
    read_last_synced_file,
    read_profiler_config_api_payload,
    read_profiler_report_name,
    str_to_bool,
    timer,
)


def test_ssh_connection(connection) -> bool:
    """Test SSH connection by running a simple command."""
    ssh_client = SSHClient(connection)
    return ssh_client.test_connection()


logger = logging.getLogger(__name__)

api = Blueprint("api", __name__)

# Sent on JSON endpoints that stream report-derived content so browsers can't
# MIME-sniff the response as HTML and execute embedded markup.
_NOSNIFF_HEADERS = {"X-Content-Type-Options": "nosniff"}

# What one permitted page may write into a privacy-reviewed artefact in a single request.
# Not inherited: `MAX_CONTENT_LENGTH` defaults to no limit at all (`settings.py`), so the
# limit has to be set per request. It has to stay consistent with `MAX_USAGE_BATCH_EVENTS`,
# which lives in `usage.py` beside the write-atomicity guarantee it bounds — a full batch
# of the largest permitted event must still fit inside this.
MAX_USAGE_REQUEST_BYTES = 16 * 1024

# Module-private, unlike the cap above: that is part of the contract the tests pin, this
# is just the envelope's field name. The shape of an event *inside* the envelope belongs
# to `usage.py`, which validates it.
_USAGE_EVENTS_FIELD = "events"


def _stack_source_request_params():
    """
    Parse ``?filePath=`` and optional ``?sourceFileId=`` for stack-trace GET requests.

    Returns ``(file_path, source_file_id, None)`` or ``(None, None, error_response)``.
    """
    file_path = request.args.get("filePath")
    if file_path is not None and not isinstance(file_path, str):
        return None, None, response_bad_request("Invalid filePath")

    source_file_id: Optional[int] = None
    raw_source_file_id = request.args.get("sourceFileId")
    if raw_source_file_id is not None and raw_source_file_id != "":
        try:
            source_file_id = int(raw_source_file_id)
        except (TypeError, ValueError):
            return (
                None,
                None,
                response_bad_request(
                    "Invalid query parameter 'sourceFileId': expected an integer."
                ),
            )

    if source_file_id is None and (not file_path or not file_path.strip()):
        return (
            None,
            None,
            response_bad_request(
                "Missing or invalid query: provide filePath and/or sourceFileId."
            ),
        )

    return file_path, source_file_id, None


_DEFAULT_RANK = 0
# `int()` is arbitrary-precision, so an unbounded parse lets a value too large for
# SQLite's int64 binding reach the driver, where it raises OverflowError as an
# unhandled 500. These routes aren't `@local_only`, so that is reachable by anyone
# under SERVER_MODE. A world size never approaches this, and rejecting negatives
# here also matches the 400 the file-backed routes already return for them.
_MAX_RANK = 2**31 - 1
_INVALID_RANK_MSG = (
    f"Invalid query parameter 'rank': expected an integer "
    f"between {_DEFAULT_RANK} and {_MAX_RANK}."
)


def _rank_query_param() -> int:
    """
    Parse ``?rank=`` for multi-host report DBs, defaulting to rank 0.

    An absent rank must mean rank 0, never "every rank". The report writer
    restarts ``operation_id`` and ``tensor_id`` at 1 for each rank and
    re-normalises ``device_id`` per rank, so an unfiltered read unions the
    ranks and collides on all three. File-backed routes (cluster/mesh
    descriptor, profiler config) already defaulted to 0; DB-backed routes
    passed None and returned the union. #1842
    """
    raw = request.args.get("rank")
    if raw is None or raw == "":
        return _DEFAULT_RANK

    try:
        rank: Optional[int] = int(raw)
    except (TypeError, ValueError):
        rank = None

    if rank is None or not _DEFAULT_RANK <= rank <= _MAX_RANK:
        abort(400, description=_INVALID_RANK_MSG)
        # Unreachable: Flask annotates `abort` as `NoReturn`, but
        # `follow_imports = "skip"` under `[tool.mypy]` stops mypy from reading
        # that annotation, so it still requires a terminating return here.
        return _DEFAULT_RANK

    return rank


_NONZERO_RANK_UNSUPPORTED_MSG = (
    "This report database does not store per-rank data. "
    "Omit the rank query parameter or use rank=0 only."
)


def _reject_nonzero_rank_on_legacy_db(db: DatabaseQueries, rank: int):
    """
    Legacy reports only represent rank 0. If the client asks for a different rank
    but the schema has no ``rank`` column, return 422 instead of returning all rows
    (which would misleadingly appear as rank 0 in the API).
    """
    if rank == _DEFAULT_RANK:
        return None
    if db.report_has_rank_column():
        return None
    return response_unprocessable_entity(_NONZERO_RANK_UNSUPPORTED_MSG)


def _stack_source_availability_response(
    is_available: bool, source: Optional[StackSourceOrigin] = None
) -> Response:
    # Match stack_source_response: same filePath can resolve differently after
    # re-syncing remote reports, so don't let caches serve a stale answer.
    payload = {
        "available": is_available,
        "source": source.value if is_available and source is not None else None,
    }
    resp = jsonify(payload)
    resp.headers["Cache-Control"] = "no-store"

    return resp


def _remote_stack_source_path_availability(
    instance: Instance,
    file_path: Optional[str],
    source_file_id: Optional[int] = None,
):
    """Whether stack source is readable (report DB, then local or SSH tt-metal)."""
    with DatabaseQueries(instance) as db:
        if report_source_file_available(
            db, source_file_id=source_file_id, file_path=file_path
        ):
            return _stack_source_availability_response(
                True, source=StackSourceOrigin.DATABASE
            )

    remote_connection = instance.remote_connection

    if not file_path:
        return _stack_source_availability_response(False)

    # `remapped` is None when the file is unavailable, False on a literal-path hit,
    # and True when resolved via a /tt-metal/ remap. The /test endpoint surfaces this
    # distinction so clients can warn only about approximate (remapped) matches.
    # SERVER_MODE gates the SSH branch as well as the local one; see the note in
    # _remote_stack_source_read for why a stored connection can't be trusted here.
    remapped: Optional[bool] = None
    is_server_mode = bool(current_app.config.get("SERVER_MODE"))
    if remote_connection and not is_server_mode:
        try:
            ssh_client = SSHClient(remote_connection)
            remapped = check_stack_source_remote_with_origin(ssh_client, file_path)
        except RemoteConnectionException:
            return _stack_source_availability_response(False)
    elif not remote_connection and not is_server_mode:
        remapped = check_stack_source_local_with_origin(file_path)

    if remapped is None:
        return _stack_source_availability_response(False)
    return _stack_source_availability_response(
        True,
        source=StackSourceOrigin.REMAPPED if remapped else StackSourceOrigin.PATH,
    )


def _remote_stack_source_read(
    instance: Instance,
    file_path: Optional[str],
    source_file_id: Optional[int] = None,
):
    """Return JSON stack source (content + resolved_path) from report DB, then local or SSH tt-metal."""
    with DatabaseQueries(instance) as db:
        report_result = read_report_source_file(
            db, source_file_id=source_file_id, file_path=file_path
        )
        if report_result is not None:
            content, resolved_path = report_result
            return stack_source_response(content, resolved_path)

    remote_connection = instance.remote_connection

    if not file_path:
        return response_not_found("Source file not found.")

    # Both branches are gated, not just the local one. The endpoints that store a
    # connection on an instance are @local_only, so a hosted instance should never carry
    # one — but nothing revalidates that at read time, and a database carried over from a
    # local install would otherwise make the hosted server open outbound SSH connections
    # on an unauthenticated request, with the file it read coming back in the response.
    if current_app.config.get("SERVER_MODE"):
        return response_forbidden(
            "Stack source reads are not available in server mode.",
        )

    if remote_connection:
        try:
            ssh_client = SSHClient(remote_connection)
            content, resolved, _remapped = read_stack_source_remote(
                ssh_client, file_path
            )
            return stack_source_response(content, resolved)
        except RemoteConnectionException as e:
            return error_response(e.http_status, e.message)
        except RemoteFileReadException as e:
            return error_response(e.http_status, str(e), e.detail)

    try:
        content, resolved, _remapped = read_stack_source_local(file_path)
        return stack_source_response(content, resolved)
    except ValueError as e:
        return response_bad_request(str(e))
    except FileNotFoundError as e:
        return response_not_found(str(e) or "File not found.")
    except PermissionError as e:
        return response_forbidden(str(e))


@api.before_request
def _trim_session_report_lists():
    """Keep session cookie under size limits by capping report lists (FIFO)."""
    if not current_app.config.get("SERVER_MODE"):
        return
    max_reports = current_app.config["SESSION_MAX_UPLOADED_REPORTS"]
    for key in ("profiler_paths", "performance_paths", "npe_paths", "instances"):
        lst = session.get(key, [])
        if len(lst) > max_reports:
            session[key] = lst[-max_reports:]


@api.route("/system-capabilities", methods=["GET"])
def get_system_capabilities():
    """Return host/backend capabilities so the frontend can adapt (e.g. disable remote sync in hosted mode)."""
    capabilities = {
        "os": platform.system(),
        "processor": platform.machine(),
        "remote_sync_methods": {
            "sftp": shutil.which("sftp") is not None,
            "rsync": shutil.which("rsync") is not None,
        },
    }

    return Response(
        orjson.dumps(capabilities),
        mimetype="application/json",
    )


@api.route("/operations", methods=["GET"])
@with_instance
@timer
def operation_list(instance: Instance):
    rank = _rank_query_param()
    with DatabaseQueries(instance) as db:
        rejected = _reject_nonzero_rank_on_legacy_db(db, rank)
        if rejected is not None:
            return rejected
        operations = list(
            db.query_operations(db.merge_rank_filter("operations", None, rank))
        )
        operations.sort(key=lambda o: o.operation_id)
        operation_arguments = list(
            db.query_operation_arguments(
                db.merge_rank_filter("operation_arguments", None, rank)
            )
        )
        device_operations = list(
            db.query_device_operations(
                db.merge_rank_filter("captured_graph", None, rank)
            )
        )
        stack_traces = list(
            db.query_stack_traces(db.merge_rank_filter("stack_traces", None, rank))
        )
        outputs = list(
            db.query_output_tensors(db.merge_rank_filter("output_tensors", None, rank))
        )
        tensors = list(db.query_tensors(db.merge_rank_filter("tensors", None, rank)))
        inputs = list(
            db.query_input_tensors(db.merge_rank_filter("input_tensors", None, rank))
        )
        devices = list(db.query_devices(db.merge_rank_filter("devices", None, rank)))
        producers_consumers = list(db.query_producers_consumers(rank=rank))

        error_records = None
        if db._check_table_exists("errors"):
            error_records = list(
                db.query_error_records(db.merge_rank_filter("errors", None, rank))
            )

        serialized_operations = serialize_operations(
            inputs,
            operation_arguments,
            operations,
            outputs,
            stack_traces,
            tensors,
            devices,
            producers_consumers,
            device_operations,
            error_records,
        )
        return Response(
            orjson.dumps(serialized_operations),
            mimetype="application/json",
        )


@api.route("/operations/<operation_id>", methods=["GET"])
@with_instance
@timer
def operation_detail(operation_id, instance: Instance):
    rank = _rank_query_param()
    with DatabaseQueries(instance) as db:
        rejected = _reject_nonzero_rank_on_legacy_db(db, rank)
        if rejected is not None:
            return rejected

        device_id = request.args.get("device_id", None)
        operations = list(
            db.query_operations(
                db.merge_rank_filter(
                    "operations",
                    {"operation_id": operation_id},
                    rank,
                )
            )
        )

        if not operations:
            return response_not_found()

        operation = operations[0]

        buffers = list(
            db.query_buffers(
                db.merge_rank_filter(
                    "buffers",
                    {"operation_id": operation_id, "device_id": device_id},
                    rank,
                )
            )
        )
        operation_arguments = list(
            db.query_operation_arguments(
                db.merge_rank_filter(
                    "operation_arguments",
                    {"operation_id": operation_id},
                    rank,
                )
            )
        )
        stack_traces = list(
            db.query_stack_traces(
                db.merge_rank_filter(
                    "stack_traces",
                    {"operation_id": operation_id},
                    rank,
                )
            )
        )

        stack_trace = None
        for st in stack_traces:
            if st.rank == operation.rank:
                stack_trace = st
                break
        if stack_trace is None and stack_traces:
            stack_trace = stack_traces[0]

        inputs = list(
            db.query_input_tensors(
                db.merge_rank_filter(
                    "input_tensors",
                    {"operation_id": operation_id},
                    rank,
                )
            )
        )
        outputs = list(
            db.query_output_tensors(
                db.merge_rank_filter(
                    "output_tensors",
                    {"operation_id": operation_id},
                    rank,
                )
            )
        )

        input_tensor_ids = [i.tensor_id for i in inputs]
        output_tensor_ids = [o.tensor_id for o in outputs]
        tensor_ids = input_tensor_ids + output_tensor_ids
        # Empty tensor_ids: query_tensors skips empty IN lists and would return all tensors.
        if not tensor_ids:
            tensors = []
            local_comparisons = []
            global_comparisons = []
        else:
            tensors = list(
                db.query_tensors(
                    db.merge_rank_filter(
                        "tensors",
                        {"tensor_id": tensor_ids},
                        rank,
                    )
                )
            )
            local_comparisons = list(
                db.query_tensor_comparisons(filters={"tensor_id": tensor_ids})
            )
            global_comparisons = list(
                db.query_tensor_comparisons(
                    local=False, filters={"tensor_id": tensor_ids}
                )
            )

        device_operations = db.query_device_operations(
            db.merge_rank_filter(
                "captured_graph",
                {"operation_id": operation_id},
                rank,
            )
        )

        producers_consumers = list(
            filter(
                lambda pc: pc.tensor_id in tensor_ids,
                db.query_producers_consumers(rank=rank),
            )
        )

        devices = list(db.query_devices(db.merge_rank_filter("devices", None, rank)))

        error_record = None
        if db._check_table_exists("errors"):
            error_records = list(
                db.query_error_records(
                    db.merge_rank_filter(
                        "errors",
                        {"operation_id": operation_id},
                        rank,
                    )
                )
            )
            for e in error_records:
                if e.rank == operation.rank:
                    error_record = e
                    break
            if error_record is None and error_records:
                error_record = error_records[0]

        serialized_operation = serialize_operation(
            buffers,
            inputs,
            operation,
            operation_arguments,
            outputs,
            stack_trace,
            tensors,
            global_comparisons,
            local_comparisons,
            devices,
            producers_consumers,
            device_operations,
            error_record,
        )

        return Response(
            orjson.dumps(serialized_operation),
            mimetype="application/json",
        )


@api.route("/operation-history", methods=["GET"])
@with_instance
@timer
def operation_history(instance: Instance):
    operation_history_filename = "operation_history.json"
    operation_history_file = (
        Path(str(instance.profiler_path)).parent / operation_history_filename
    )
    if not operation_history_file.exists():
        return jsonify([])
    with open(operation_history_file, "r") as file:
        return Response(
            orjson.dumps(json.load(file)),
            mimetype="application/json",
        )


@api.route("/errors", methods=["GET"])
@with_instance
@timer
def errors_list(instance: Instance):
    rank = _rank_query_param()
    with DatabaseQueries(instance) as db:
        rejected = _reject_nonzero_rank_on_legacy_db(db, rank)
        if rejected is not None:
            return rejected
        if not db._check_table_exists("errors"):
            return response_unprocessable_entity(
                message="Error records table does not exist in this report database."
            )

        error_records = list(
            db.query_error_records(db.merge_rank_filter("errors", None, rank))
        )
        serialized_errors = [dataclasses.asdict(error) for error in error_records]

        return Response(
            orjson.dumps(serialized_errors),
            mimetype="application/json",
        )


@api.route("/report-metadata", methods=["GET"])
@with_instance
@timer
def report_metadata(instance: Instance):
    with DatabaseQueries(instance) as db:
        if not db._check_table_exists("report_metadata"):
            return response_unprocessable_entity(
                message="Report metadata table does not exist in this report database."
            )
        rows = db.query_report_metadata()
        payload = {row[0]: row[1] for row in rows}
        return Response(
            orjson.dumps(payload),
            mimetype="application/json",
        )


@api.route("/config", methods=["GET"])
@with_instance
@timer
def get_config(instance: Instance):
    """
    Return the profiler ``config.json`` object for this report.

    For multi-host ranked configs (``config_<n>_of_<world>.json``), the response
    is the same shape as a single config file: one JSON object. Default is
    logical rank 0 (``config_1_of_<world>.json``). Pass ``?rank=<logical_rank>``
    to read another host's file (debugging).
    """
    report_dir = Path(str(instance.profiler_path)).parent
    logical_rank = _rank_query_param()

    payload, err = read_profiler_config_api_payload(report_dir, logical_rank)
    if err == "rank_out_of_range":
        return response_bad_request(
            f"Invalid rank for this report: {logical_rank}. "
            "Rank must be within the world size for this report's config files."
        )
    if err == "missing_rank_file":
        return response_not_found(f"No profiler config file for rank {logical_rank}.")
    if err == "parse_error":
        return {}
    if payload is None:
        return {}
    return Response(
        orjson.dumps(payload),
        mimetype="application/json",
    )


@api.route("/tensors", methods=["GET"])
@with_instance
@timer
def tensors_list(instance: Instance):
    rank = _rank_query_param()
    with DatabaseQueries(instance) as db:
        rejected = _reject_nonzero_rank_on_legacy_db(db, rank)
        if rejected is not None:
            return rejected
        device_id = request.args.get("device_id", None)
        buffer_type_param = request.args.get("buffer_type", None)
        tensor_filters: dict = {}
        if device_id is not None:
            tensor_filters["device_id"] = device_id
        if buffer_type_param is not None and str.isdigit(buffer_type_param):
            tensor_filters["buffer_type"] = int(buffer_type_param)
        tensors = list(
            db.query_tensors(db.merge_rank_filter("tensors", tensor_filters, rank))
        )
        local_comparisons = list(db.query_tensor_comparisons(rank=rank))
        global_comparisons = list(db.query_tensor_comparisons(local=False, rank=rank))
        producers_consumers = list(db.query_producers_consumers(rank=rank))
        serialized_tensors = serialize_tensors(
            tensors, producers_consumers, local_comparisons, global_comparisons
        )
        return Response(
            orjson.dumps(serialized_tensors),
            mimetype="application/json",
        )


@api.route("/buffer", methods=["GET"])
@with_instance
@timer
def buffer_detail(instance: Instance):
    address = request.args.get("address")
    operation_id = request.args.get("operation_id")

    if not address or not operation_id:
        return response_bad_request()

    if operation_id and str.isdigit(operation_id):
        operation_id = int(operation_id)
    else:
        return response_bad_request()

    rank = _rank_query_param()
    with DatabaseQueries(instance) as db:
        rejected = _reject_nonzero_rank_on_legacy_db(db, rank)
        if rejected is not None:
            return rejected
        buffer = db.query_next_buffer(operation_id, address, rank=rank)
        if not buffer:
            return response_not_found()
        return Response(
            orjson.dumps(dataclasses.asdict(buffer)),
            mimetype="application/json",
        )


@api.route("/buffer-pages", methods=["GET"])
@with_instance
@timer
def buffer_pages(instance: Instance):
    address = request.args.get("address")
    operation_id = request.args.get("operation_id")
    buffer_type = request.args.get("buffer_type", "")
    device_id = request.args.get("device_id", None)

    if address:
        addresses = [addr.strip() for addr in address.split(",")]
    else:
        addresses = None

    if buffer_type and str.isdigit(buffer_type):
        buffer_type = int(buffer_type)
    else:
        buffer_type = None

    rank = _rank_query_param()
    with DatabaseQueries(instance) as db:
        rejected = _reject_nonzero_rank_on_legacy_db(db, rank)
        if rejected is not None:
            return rejected

        source_table = db.buffer_chunks_source_table()
        chunk_filters = {
            "operation_id": operation_id,
            "device_id": device_id,
            "address": addresses,
            "buffer_type": buffer_type,
        }
        if source_table is not None:
            chunk_filters = db.merge_rank_filter(source_table, chunk_filters, rank)
        chunks = list(db.query_buffer_chunks(chunk_filters))
        return Response(
            orjson.dumps(serialize_buffer_chunks(chunks)),
            mimetype="application/json",
        )


@api.route("/tensors/<tensor_id>", methods=["GET"])
@with_instance
@timer
def tensor_detail(tensor_id, instance: Instance):
    rank = _rank_query_param()
    with DatabaseQueries(instance) as db:
        rejected = _reject_nonzero_rank_on_legacy_db(db, rank)
        if rejected is not None:
            return rejected
        tensors = list(
            db.query_tensors(
                db.merge_rank_filter("tensors", {"tensor_id": tensor_id}, rank)
            )
        )
        if not tensors:
            return response_not_found()

        return Response(
            orjson.dumps(dataclasses.asdict(tensors[0])),
            mimetype="application/json",
        )


@api.route("/buffers", methods=["GET"])
@with_instance
def get_all_buffers(instance: Instance):
    buffer_type = request.args.get("buffer_type", "")
    device_id = request.args.get("device_id", None)
    if buffer_type and str.isdigit(buffer_type):
        buffer_type = int(buffer_type)
    else:
        buffer_type = None

    rank = _rank_query_param()
    with DatabaseQueries(instance) as db:
        rejected = _reject_nonzero_rank_on_legacy_db(db, rank)
        if rejected is not None:
            return rejected
        buffers = list(
            db.query_buffers(
                db.merge_rank_filter(
                    "buffers",
                    {"buffer_type": buffer_type, "device_id": device_id},
                    rank,
                )
            )
        )
        serialized = [serialize_buffer(b) for b in buffers]
        return Response(orjson.dumps(serialized), mimetype="application/json")


@api.route("/operation-buffers", methods=["GET"])
@with_instance
def get_operations_buffers(instance: Instance):
    buffer_type = request.args.get("buffer_type", "")
    device_id = request.args.get("device_id", None)

    if buffer_type and str.isdigit(buffer_type):
        buffer_type = int(buffer_type)
    else:
        buffer_type = None

    rank = _rank_query_param()
    with DatabaseQueries(instance) as db:
        rejected = _reject_nonzero_rank_on_legacy_db(db, rank)
        if rejected is not None:
            return rejected
        buffers = list(
            db.query_buffers(
                db.merge_rank_filter(
                    "buffers",
                    {"buffer_type": buffer_type, "device_id": device_id},
                    rank,
                )
            )
        )
        operations = list(
            db.query_operations(db.merge_rank_filter("operations", None, rank))
        )
        return Response(
            orjson.dumps(serialize_operations_buffers(operations, buffers)),
            mimetype="application/json",
        )


@api.route("/operation-buffers/<operation_id>", methods=["GET"])
@with_instance
def get_operation_buffers(operation_id, instance: Instance):
    buffer_type = request.args.get("buffer_type", "")
    device_id = request.args.get("device_id", None)
    if buffer_type and str.isdigit(buffer_type):
        buffer_type = int(buffer_type)
    else:
        buffer_type = None

    rank = _rank_query_param()
    with DatabaseQueries(instance) as db:
        rejected = _reject_nonzero_rank_on_legacy_db(db, rank)
        if rejected is not None:
            return rejected
        operations = list(
            db.query_operations(
                db.merge_rank_filter(
                    "operations",
                    {"operation_id": operation_id},
                    rank,
                )
            )
        )
        if not operations:
            return response_not_found()
        operation = operations[0]
        buffers = list(
            db.query_buffers(
                db.merge_rank_filter(
                    "buffers",
                    {
                        "operation_id": operation_id,
                        "buffer_type": buffer_type,
                        "device_id": device_id,
                    },
                    rank,
                )
            )
        )
        if not operation:
            return response_not_found()

        return Response(
            orjson.dumps(serialize_operation_buffers(operation, buffers)),
            mimetype="application/json",
        )


@api.route("/profiler", methods=["GET"])
@with_instance
def get_profiler_data_list(instance: Instance):
    # Use PathResolver to get the base path for profiler reports
    resolver = create_path_resolver(current_app)

    # Note: "profiler" in app terminology maps to tt-metal's ttnn/reports
    path = resolver.get_base_report_path("profiler")

    if not path.exists():
        if resolver.is_direct_report_mode:
            logger.warning(f"TT-Metal profiler reports not found: {path}")
            return []
        else:
            path.mkdir(parents=True, exist_ok=True)

    valid_dirs = []

    if current_app.config["SERVER_MODE"]:
        session_instances = session.get("instances", [])
        instances = get_instances(session_instances)
        db_paths = [
            instance.profiler_path for instance in instances if instance.profiler_path
        ]
        db_directory_names = [str(Path(db_path).parent.name) for db_path in db_paths]
        session_paths = session.get("profiler_paths", [])
        session_directory_names = [
            str(Path(session_path).parent.name) for session_path in session_paths
        ]
        demo_directory_names = []
        demo_pattern = re.compile(r"^demo", re.IGNORECASE)
        for report in path.glob("*"):
            if demo_pattern.match(report.name):
                demo_directory_names.append(report.name)
        directory_names = list(
            set(db_directory_names + session_directory_names + demo_directory_names)
        )
    else:
        directory_names = [
            directory.name for directory in path.iterdir() if directory.is_dir()
        ]

    # Sort directory names by modified time (most recent first)
    def get_modified_time(dir_name):
        dir_path = Path(path) / dir_name
        if dir_path.exists():
            return dir_path.stat().st_mtime
        return 0

    directory_names.sort(key=get_modified_time, reverse=True)

    for dir_name in directory_names:
        dir_path = Path(path) / dir_name
        if not dir_path.is_dir() or not is_valid_profiler_report_dir(dir_path):
            continue
        if pick_profiler_config_paths(dir_path):
            report_name = read_profiler_report_name(dir_path)
        else:
            report_name = dir_path.name

        valid_dirs.append({"path": dir_path.name, "reportName": report_name})

    return Response(orjson.dumps(valid_dirs), mimetype="application/json")


def _report_directory_to_delete(directory_name_key: str, report_name: str) -> Path:
    """Resolve a delete request to one report directory under the local data directory.

    ``refuse_in_direct_report_mode`` rejects the request before this runs, so the listings
    these deletes are paired with (``GET /profiler``, ``GET /performance``) only ever read
    the local data directory, making that the only tree a delete may reach — and only one
    report inside it, since anything wider removes reports the client never listed.
    """
    return (
        Path(current_app.config["LOCAL_DATA_DIRECTORY"])
        / current_app.config[directory_name_key]
        / sanitise_path_segment(report_name)
    )


@api.route("/profiler/<profiler_name>", methods=["DELETE"])
@with_instance
@local_only
@refuse_in_direct_report_mode
def delete_profiler_report(profiler_name, instance: Instance):
    if not profiler_name:
        return response_bad_request("Report name is required.")

    try:
        path = _report_directory_to_delete("PROFILER_DIRECTORY_NAME", profiler_name)
    except (TypeError, ValueError):
        return response_bad_request(f"Invalid report name: {profiler_name}")

    if instance.active_report and instance.active_report.profiler_name == profiler_name:
        instance_id = request.args.get("instanceId")
        update_instance(instance_id=instance_id, profiler_name="")

    if path.exists() and path.is_dir():
        shutil.rmtree(path)
    else:
        return response_not_found(f"Report does not exist: {path}")

    return Response(
        status=HTTPStatus.NO_CONTENT, response=f"Report deleted successfully: {path}"
    )


@api.route("/performance", methods=["GET"])
@with_instance
def get_performance_data_list(instance: Instance):
    # Use PathResolver to get the base path for performance reports
    resolver = create_path_resolver(current_app)

    # Note: "performance" in app terminology maps to tt-metal's profiler/reports
    path = resolver.get_base_report_path("performance")

    if not path.exists():
        if resolver.is_direct_report_mode:
            logger.warning(f"TT-Metal performance reports not found: {path}")
            return jsonify([])

    if current_app.config["SERVER_MODE"]:
        session_instances = session.get("instances", [])
        instances = get_instances(session_instances)
        db_paths = [
            instance.performance_path
            for instance in instances
            if instance.performance_path
        ]
        db_directory_names = [str(Path(db_path).name) for db_path in db_paths]
        session_paths = session.get("performance_paths", [])
        session_directory_names = [
            str(Path(session_path).name) for session_path in session_paths
        ]
        demo_directory_names = []
        demo_pattern = re.compile(r"^demo", re.IGNORECASE)
        for report in path.glob("*"):
            if demo_pattern.match(report.name):
                demo_directory_names.append(report.name)
        directory_names = list(
            set(db_directory_names + session_directory_names + demo_directory_names)
        )
    else:
        # PathResolver already handles remote vs local logic
        directory_names = (
            [directory.name for directory in path.iterdir() if directory.is_dir()]
            if path.exists()
            else []
        )

    valid_dirs = []

    # Sort directory names by modified time (most recent first)
    def get_modified_time(dir_name):
        dir_path = Path(path) / dir_name
        if dir_path.exists():
            return dir_path.stat().st_mtime
        return 0

    directory_names.sort(key=get_modified_time, reverse=True)

    for dir_name in directory_names:
        dir_path = Path(path) / dir_name
        if not dir_path.is_dir() or not is_valid_performance_report_dir(dir_path):
            continue

        valid_dirs.append(
            {
                "path": dir_path.name,
                "reportName": dir_path.name,
            }
        )

    return Response(orjson.dumps(valid_dirs), mimetype="application/json")


@api.route("/performance/device-log", methods=["GET"])
@with_instance
def get_performance_data(instance: Instance):
    with DeviceLogProfilerQueries(instance) as csv:
        result = csv.get_all_entries(as_dict=True, limit=100)
        return Response(orjson.dumps(result), mimetype="application/json")


@api.route("/performance/perf-results", methods=["GET"])
@with_instance
def get_profiler_performance_data(instance: Instance):
    with OpsPerformanceQueries(instance) as csv:
        # result = csv.query_by_op_code(op_code="(torch) contiguous", as_dict=True)
        result = csv.get_all_entries(as_dict=True, limit=100)
        return Response(orjson.dumps(result), mimetype="application/json")


@api.route("/performance/<performance_name>", methods=["DELETE"])
@with_instance
@local_only
@refuse_in_direct_report_mode
def delete_performance_report(performance_name, instance: Instance):
    if not performance_name:
        return response_bad_request("Report name is required.")

    try:
        path = _report_directory_to_delete(
            "PERFORMANCE_DIRECTORY_NAME", performance_name
        )
    except (TypeError, ValueError):
        return response_bad_request(f"Invalid report name: {performance_name}")

    if (
        instance.active_report
        and instance.active_report.performance_name == performance_name
    ):
        instance_id = request.args.get("instanceId")
        update_instance(instance_id=instance_id, performance_name="")

    if path.exists() and path.is_dir():
        shutil.rmtree(path)
    else:
        return response_not_found(f"Report does not exist: {path}")

    return Response(
        status=HTTPStatus.NO_CONTENT, response=f"Report deleted successfully: {path}"
    )


def _apply_requested_performance_name(instance: Instance) -> None:
    """Point the instance at the ``?name=`` report for the duration of the request.

    Lets the comparison selector read a sibling report without re-mounting. The
    name is the synced folder name the listing handed the client — including any
    ``_rank<N>`` qualifier — so it is resolved as given rather than guessed at: a
    rank fallback here could answer with a different rank's numbers.

    All three routes that honour ``?name=`` come through here, so the query value
    is collapsed to a single segment once rather than trusted at each caller.
    """
    name = request.args.get("name", None)
    if not name or current_app.config["SERVER_MODE"]:
        return
    if not instance.performance_path:
        raise PerformanceReportNotLoadedException()

    try:
        requested_name = sanitise_path_segment(name)
    except (TypeError, ValueError):
        logger.warning("Ignoring unusable performance report name: %r", name)
        return

    instance.performance_path = str(
        Path(instance.performance_path).parent / requested_name
    )
    logger.info(f"Performance path set to {instance.performance_path}")


@api.route("/performance/perf-results/raw", methods=["GET"])
@with_instance
def get_performance_results_data_raw(instance: Instance):
    content = OpsPerformanceQueries.get_raw_csv(instance)
    return Response(
        content,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=op_perf_results.csv"},
    )


@api.route("/performance/perf-results/report", methods=["GET"])
@with_instance
def get_performance_results_report(instance: Instance):
    start_signpost = request.args.get("start_signpost", None)
    end_signpost = request.args.get("end_signpost", None)
    print_signposts = str_to_bool(request.args.get("print_signposts", "true"))
    hide_host_ops = str_to_bool(request.args.get("hide_host_ops", "true"))
    merge_devices = str_to_bool(request.args.get("merge_devices", "true"))
    tracing_mode = str_to_bool(request.args.get("tracing_mode", "false"))
    group_by = request.args.get("group_by", None)

    if not instance.performance_path:
        raise PerformanceReportNotLoadedException()

    _apply_requested_performance_name(instance)

    try:
        report = OpsPerformanceReportQueries.generate_report(
            instance,
            start_signpost=start_signpost,
            print_signposts=print_signposts,
            end_signpost=end_signpost,
            hide_host_ops=hide_host_ops,
            merge_devices=merge_devices,
            tracing_mode=tracing_mode,
            group_by=group_by,
        )
    except DataFormatError as error:
        return response_unprocessable_entity(str(error))

    return Response(orjson.dumps(report), mimetype="application/json")


# this is no longer used atm. keeping for now until confirmed "not needed"
@api.route("/performance/device-log/raw", methods=["GET"])
@with_instance
def get_performance_data_raw(instance: Instance):
    if not instance.performance_path:
        raise PerformanceReportNotLoadedException()

    _apply_requested_performance_name(instance)

    content = DeviceLogProfilerQueries.get_raw_csv(instance)

    return Response(
        content,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=profile_log_device.csv"},
    )


@api.route("/performance/device-log/meta", methods=["GET"])
@with_instance
def get_performance_device_meta(instance: Instance):
    def get_first_line(file_path: Path) -> str:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.readline().strip()

    def parse_arch_and_freq(line: str):
        arch_match = re.search(r"ARCH:\s*([\w\d_]+)", line)
        freq_match = re.search(r"CHIP_FREQ\[MHz\]:\s*(\d+)", line)
        cores_match = re.search(r"Max Compute Cores:\s*(\d+)", line)

        architecture = arch_match.group(1) if arch_match else None
        frequency = int(freq_match.group(1)) if freq_match else None
        max_cores = int(cores_match.group(1)) if cores_match else None

        return {
            "architecture": architecture,
            "frequency": frequency,
            "max_cores": max_cores,
        }

    if not instance.performance_path:
        raise PerformanceReportNotLoadedException()

    _apply_requested_performance_name(instance)

    file_path = Path(
        instance.performance_path,
        DeviceLogProfilerQueries.DEVICE_LOG_FILE,
    )

    if not file_path.exists():
        return response_not_found()

    try:
        first_line = get_first_line(file_path)
        meta = parse_arch_and_freq(first_line)
        return jsonify(meta)

    except Exception as e:
        logger.exception("Failed to parse device meta")
        return response_internal_server_error(str(e))


@api.route("/performance/npe/manifest", methods=["GET"])
@with_instance
def get_npe_manifest(instance: Instance):
    try:
        content = NPEQueries.get_npe_manifest(instance)
    except FileNotFoundError:
        return jsonify([])

    return Response(orjson.dumps(content), mimetype="application/json")


@api.route("/performance/npe/timeline", methods=["GET"])
@with_instance
def get_npe_timeline(instance: Instance):
    filename = request.args.get("filename", default=None)

    if not filename:
        return Response(orjson.dumps({}), mimetype="application/json")

    filename = Path(filename).name

    try:
        content = NPEQueries.get_npe_timeline(instance, filename=filename)
    except FileNotFoundError:
        return Response(orjson.dumps({}), mimetype="application/json")

    return Response(orjson.dumps(content), mimetype="application/json")


@api.route("/performance/device-log/zone/<zone>", methods=["GET"])
@with_instance
def get_zone_statistics(zone, instance: Instance):
    with DeviceLogProfilerQueries(instance) as csv:
        result = csv.query_zone_statistics(zone_name=zone, as_dict=True)
        return Response(orjson.dumps(result), mimetype="application/json")


@api.route("/devices", methods=["GET"])
@with_instance
def get_devices(instance: Instance):
    rank = _rank_query_param()
    with DatabaseQueries(instance) as db:
        rejected = _reject_nonzero_rank_on_legacy_db(db, rank)
        if rejected is not None:
            return rejected
        devices = list(db.query_devices(db.merge_rank_filter("devices", None, rank)))
        return Response(
            orjson.dumps(serialize_devices(devices)),
            mimetype="application/json",
        )


@api.route("/local/upload/profiler", methods=["POST"])
def create_profiler_files():
    files = request.files.getlist("files")
    folder_name = request.form.get(
        "folderName"
    )  # Optional folder name - Used for Safari compatibility
    profiler_directory = (
        current_app.config["LOCAL_DATA_DIRECTORY"]
        / current_app.config["PROFILER_DIRECTORY_NAME"]
    )

    if not validate_files(files, {"db.sqlite"}, folder_name=folder_name):
        return StatusMessage(
            status=ConnectionTestStates.FAILED,
            message="Invalid project directory.",
        ).model_dump()

    if not profiler_directory.exists():
        profiler_directory.mkdir(parents=True, exist_ok=True)

    parent_folder_name = resolve_parent_folder_name(files, folder_name)

    logger.info(f"Writing report files to {profiler_directory}/{parent_folder_name}")

    try:
        paths = save_uploaded_files(files, profiler_directory, parent_folder_name)
    except DataFormatError:
        return response_unprocessable_entity()

    profiler_path = next((p for p in paths if Path(p).name == "db.sqlite"), None)

    instance_id = request.args.get("instanceId")

    update_instance(
        instance_id=instance_id,
        profiler_name=parent_folder_name,
        profiler_location=ReportLocation.LOCAL.value,
        clear_remote=True,
        profiler_path=str(profiler_path) if profiler_path else None,
    )

    report_dir = profiler_directory / parent_folder_name
    report_name = None
    if pick_profiler_config_paths(report_dir):
        report_name = read_profiler_report_name(report_dir)
    else:
        report_name = parent_folder_name

    if current_app.config["SERVER_MODE"]:
        # Set session data (FIFO cap to avoid cookie size limits)
        max_reports = current_app.config["SESSION_MAX_UPLOADED_REPORTS"]
        session["profiler_paths"] = (
            session.get("profiler_paths", []) + [str(profiler_path)]
        )[-max_reports:]
        session.permanent = True

    return {
        "path": parent_folder_name,
        "reportName": report_name,
    }


@api.route("/local/upload/performance", methods=["POST"])
def create_performance_files():
    files = request.files.getlist("files")
    folder_name = request.form.get("folderName")  # Optional folder name
    data_directory = Path(current_app.config["LOCAL_DATA_DIRECTORY"])

    if not validate_files(
        files,
        PERFORMANCE_REPORT_REQUIRED_FILES,
        pattern=PERFORMANCE_OPS_PERF_PREFIX,
        folder_name=folder_name,
    ):
        return StatusMessage(
            status=ConnectionTestStates.FAILED,
            message="Invalid project directory.",
        ).model_dump()

    target_directory = data_directory / current_app.config["PERFORMANCE_DIRECTORY_NAME"]

    if not target_directory.exists():
        target_directory.mkdir(parents=True, exist_ok=True)

    parent_folder_name = resolve_parent_folder_name(files, folder_name)

    logger.info(f"Saving performance report files {parent_folder_name}")

    try:
        paths = save_uploaded_files(
            files,
            target_directory,
            parent_folder_name,
        )
    except DataFormatError:
        return response_unprocessable_entity()

    # Take the report root from the destination we chose, not from anything in
    # the payload. Two things make a payload scan wrong here:
    #
    # - `save_uploaded_files` returns paths in multipart order and
    #   `construct_dest_path` preserves sub-paths for folder uploads, so
    #   `paths[0].parent` binds to `npe_viz/` whenever one of its files leads
    #   the body, and browser `FileList` ordering is not specified.
    # - Scanning for the device log instead is no safer: `validate_files` skips
    #   its depth check when `folderName` is supplied, so a part named
    #   `<anything>/profile_log_device.csv` lands the log a level deeper and
    #   makes the final segment caller-chosen. That segment is the hosted
    #   session scoping key in `get_performance_data_list`, so it must stay
    #   server-derived.
    #
    # `parts[0]` is the folder `construct_dest_path` actually created,
    # timestamp prefix and all, which keeps `performance_path` consistent with
    # the `performance_name` written alongside it.
    report_root = target_directory / paths[0].relative_to(target_directory).parts[0]
    performance_path = str(report_root)

    instance_id = request.args.get("instanceId")
    update_instance(
        instance_id=instance_id,
        performance_name=parent_folder_name,
        performance_location=ReportLocation.LOCAL.value,
        clear_remote=True,
        performance_path=performance_path,
    )

    if current_app.config["SERVER_MODE"]:
        max_reports = current_app.config["SESSION_MAX_UPLOADED_REPORTS"]
        session["performance_paths"] = (
            session.get("performance_paths", []) + [str(performance_path)]
        )[-max_reports:]
        session.permanent = True

    return StatusMessage(
        status=ConnectionTestStates.OK, message="Success."
    ).model_dump()


@api.route("/local/upload/npe", methods=["POST"])
def create_npe_files():
    files = request.files.getlist("files")
    data_directory = current_app.config["LOCAL_DATA_DIRECTORY"]

    for file in files:
        if (
            not file.filename.endswith(".json")
            and not file.filename.endswith(".zst")
            and not file.filename.endswith(".npeviz")
        ):
            return StatusMessage(
                status=ConnectionTestStates.FAILED,
                message="NPE requires a valid .json or .zst file",
            ).model_dump()

    npe_name = extract_npe_name(files)
    target_directory = data_directory / current_app.config["NPE_DIRECTORY_NAME"]
    target_directory.mkdir(parents=True, exist_ok=True)

    try:
        paths = save_uploaded_files(files, target_directory)
    except DataFormatError:
        return response_unprocessable_entity()

    instance_id = request.args.get("instanceId")
    npe_path = str(paths[0])
    update_instance(
        instance_id=instance_id,
        npe_name=npe_name,
        npe_location=ReportLocation.LOCAL.value,
        clear_remote=True,
        npe_path=npe_path,
    )

    if current_app.config["SERVER_MODE"]:
        max_reports = current_app.config["SESSION_MAX_UPLOADED_REPORTS"]
        session["npe_paths"] = (session.get("npe_paths", []) + [str(npe_path)])[
            -max_reports:
        ]
        session.permanent = True

    return StatusMessage(status=ConnectionTestStates.OK, message="Success").model_dump()


@api.route("/remote/profiler-reports", methods=["POST"])
@local_only
def list_remote_reports_profiler():
    return _respond_remote_report_list(
        get_remote_profiler_folders, "PROFILER_DIRECTORY_NAME"
    )


@api.route("/remote/performance-reports", methods=["POST"])
@local_only
def list_remote_reports_performance():
    return _respond_remote_report_list(
        get_remote_performance_folders, "PERFORMANCE_DIRECTORY_NAME"
    )


@api.route("/remote/local-profiler-reports", methods=["POST"])
@local_only
def list_local_remote_reports_profiler():
    """List profiler reports already synced under REMOTE_DATA_DIRECTORY/<host>/ (no SSH)."""
    return _respond_local_synced_folders(
        list_local_synced_profiler_folders,
        "PROFILER_DIRECTORY_NAME",
    )


@api.route("/remote/local-performance-reports", methods=["POST"])
@local_only
def list_local_remote_reports_performance():
    """List performance reports already synced under REMOTE_DATA_DIRECTORY/<host>/ (no SSH)."""
    return _respond_local_synced_folders(
        list_local_synced_performance_folders,
        "PERFORMANCE_DIRECTORY_NAME",
    )


def _annotate_last_synced(
    folders: List[RemoteReportFolder], host: str, directory_config_key: str
) -> None:
    remote_data = Path(current_app.config["REMOTE_DATA_DIRECTORY"])
    dir_name = current_app.config[directory_config_key]
    for rf in folders:
        # The listing already carries the segment sync writes. Re-deriving it
        # here would let a rank's badge report the sync state of whichever rank
        # was downloaded into that folder.
        directory_name = rf.syncedName
        if not directory_name:
            continue
        local_path = local_synced_report_path(
            remote_data, host, dir_name, directory_name
        )
        logger.debug("Checking last synced for %s", directory_name)
        rf.lastSynced = read_last_synced_file(str(local_path))
        if not rf.lastSynced:
            logger.debug("%s not yet synced", directory_name)


def _validated_remote_connection(connection_data: Any) -> RemoteConnection:
    """Parse a request body's connection, refusing an unusable one as a 400.

    A rejected host, username or report path is user input, not a server fault,
    and the value can arrive from the client's own stored connections, so every
    ``/api/remote`` route needs the same answer rather than a 500.
    """
    try:
        return RemoteConnection.model_validate(connection_data, strict=False)
    except ValidationError as validation_error:
        raise InvalidRequestPayload("Invalid connection data") from validation_error


def _validated_remote_report_folder(folder_data: Any) -> RemoteReportFolder:
    """As ``_validated_remote_connection``, for a report folder in a request body."""
    try:
        return RemoteReportFolder.model_validate(folder_data, strict=False)
    except ValidationError as validation_error:
        raise InvalidRequestPayload("Invalid report data") from validation_error


def _respond_remote_report_list(fetch_fn, directory_config_key: str):
    connection_data = request.get_json()

    if not connection_data:
        return response_bad_request("Missing connection data")

    connection = _validated_remote_connection(connection_data)

    try:
        remote_folders: List[RemoteReportFolder] = fetch_fn(connection)
        if not remote_folders:
            return Response(status=HTTPStatus.NO_CONTENT)

        _annotate_last_synced(remote_folders, connection.host, directory_config_key)

        return Response(
            orjson.dumps([folder.model_dump() for folder in remote_folders]),
            mimetype="application/json",
        )
    except RemoteConnectionException as e:
        return error_response(e.http_status, e.message)


def _respond_local_synced_folders(list_fn, directory_config_key: str):
    connection_data = request.get_json()

    if not connection_data:
        return response_bad_request("Missing connection data")

    connection = _validated_remote_connection(connection_data)

    folders = list_fn(
        connection,
        Path(current_app.config["REMOTE_DATA_DIRECTORY"]),
        current_app.config[directory_config_key],
    )
    if not folders:
        return Response(status=HTTPStatus.NO_CONTENT)

    return Response(
        orjson.dumps([folder.model_dump() for folder in folders]),
        mimetype="application/json",
    )


@api.route("/cluster-descriptor", methods=["GET"])
@with_instance
def get_cluster_descriptor(instance: Instance):
    if not instance.profiler_path:
        return response_not_found("cluster_descriptor.yaml not found")

    report_dir = Path(instance.profiler_path).parent
    logical_rank = _rank_query_param()

    path, err = pick_cluster_descriptor_path(report_dir, logical_rank)
    if err == "rank_out_of_range":
        return response_bad_request(
            f"Invalid rank for this report: {logical_rank}. "
            "Rank must be within the world size for this report's cluster descriptor files."
        )
    if err == "missing_rank_file":
        return response_not_found(
            f"No cluster descriptor file for rank {logical_rank}."
        )
    if path is None:
        return response_not_found("cluster_descriptor.yaml not found")

    try:
        with open(path, "r", encoding="utf-8") as cluster_desc_file:
            cluster_desc = yaml.safe_load(cluster_desc_file)
        return jsonify(cluster_desc), HTTPStatus.OK

    except yaml.YAMLError as e:
        return response_bad_request(f"Failed to parse YAML: {str(e)}")

    except Exception as e:
        return response_internal_server_error(f"An unexpected error occurred: {str(e)}")


@api.route("/mesh-descriptor", methods=["GET"])
@with_instance
def get_mesh_descriptor(instance: Instance):
    if not instance.profiler_path:
        return response_not_found(
            "physical_chip_mesh_coordinate_mapping.yaml not found"
        )

    report_dir = Path(instance.profiler_path).parent
    logical_rank = _rank_query_param()

    path, err = pick_mesh_descriptor_path(report_dir, logical_rank)
    if err == "rank_out_of_range":
        return response_bad_request(
            f"Invalid rank for this report: {logical_rank}. "
            "Rank must be within the world size for this report's mesh descriptor files."
        )
    if err == "missing_rank_file":
        return response_not_found(f"No mesh descriptor file for rank {logical_rank}.")
    if path is None:
        return response_not_found(
            "physical_chip_mesh_coordinate_mapping.yaml not found"
        )

    try:
        with open(path, "r", encoding="utf-8") as mesh_descriptor_path:
            # Mesh-descriptor files in some multi-host reports are emitted as a
            # multi-document YAML stream (one ``chips:`` block per rank). The
            # legacy single-doc shape is still common, so preserve it; expose
            # multi-doc files under a ``docs`` envelope so the FE can pick the
            # block that matches the requested rank.
            docs = [
                doc
                for doc in yaml.safe_load_all(mesh_descriptor_path)
                if isinstance(doc, dict)
            ]
        if not docs:
            # Keep the single-doc contract stable so the FE doesn't have to
            # special-case an empty-payload shape.
            return jsonify({"chips": {}})
        if len(docs) == 1:
            return jsonify(docs[0])
        return jsonify({"docs": docs})
    except yaml.YAMLError as e:
        return response_bad_request(f"Failed to parse YAML: {str(e)}")


# Why a table rather than a guard per state: this is the only place that reads
# `RemoteSearchRootState`, so a state added without copy has nothing forcing the
# second edit. Looking the copy up means that omission raises here, where the
# state arrived, instead of falling through to the "no reports found" warning —
# which is the exact mis-description `NOT_A_DIRECTORY` was added to stop.
_FAILURE_COPY_BY_ROOT_STATE = {
    RemoteSearchRootState.MISSING: (
        "{subject} directory does not exist or cannot be accessed"
    ),
    RemoteSearchRootState.NOT_A_DIRECTORY: "{subject} path is not a directory",
    RemoteSearchRootState.UNKNOWN: (
        "{subject} directory could not be checked because the search did not complete"
    ),
}


def _report_search_status(
    label: str,
    outcome: RemoteReportPathOutcome,
    *,
    in_rank_subdirectories: bool = False,
) -> StatusMessage:
    """The one connection-test line a configured report path earns.

    The path check and the report search answer halves of the same question, so
    they report as a single result per report kind — including when that result
    is a failure, which is why the copy for all four outcomes lives here rather
    than half of it being raised from the search.

    ``label`` is lower case for the count line ("Found 3 memory reports") and
    capitalised for the rest, so a user reading a failure sees the same noun as
    the form field they have to correct.
    """
    subject = label.capitalize()

    if outcome.error_message:
        return StatusMessage(
            status=ConnectionTestStates.FAILED.value,
            message=outcome.error_message,
            detail=outcome.error_detail,
        )

    if outcome.root_state is not RemoteSearchRootState.PRESENT:
        return StatusMessage(
            status=ConnectionTestStates.FAILED.value,
            message=_FAILURE_COPY_BY_ROOT_STATE[outcome.root_state].format(
                subject=subject
            ),
        )

    count = outcome.report_count
    if count:
        plural = "report" if count == 1 else "reports"
        location = " in per-rank subdirectories" if in_rank_subdirectories else ""
        return StatusMessage(
            status=ConnectionTestStates.OK.value,
            message=f"Found {count} {label} {plural}{location}",
        )

    # Naming the expected layout turns the most likely misconfiguration
    # (pointing at the parent of the per-rank folders) into a self-diagnosing
    # warning.
    hint = (
        f" (multihost is enabled, so reports are expected at "
        f"{MULTIHOST_REPORT_LAYOUT_HINT}/<report> under this path)"
        if in_rank_subdirectories
        else ""
    )
    return StatusMessage(
        status=ConnectionTestStates.WARNING.value,
        message=f"{subject} path exists but no reports found{hint}",
    )


@api.route("/remote/ssh-config-hosts", methods=["GET"])
@local_only
def list_remote_ssh_config_hosts():
    """List concrete Host aliases from the local user's ~/.ssh/config."""
    return jsonify(load_ssh_config_hosts().model_dump(exclude_none=True))


def _validated_host_key_target(payload) -> HostKeyTarget:
    """Validate a host-key request body, or answer 400 through the app handler.

    Deliberately not ``RemoteConnection``: that requires ``profilerPath``, which a
    connection configured with only a performance path leaves empty, and no report
    path bears on a host key.
    """
    try:
        return HostKeyTarget.model_validate(payload)
    except ValidationError:
        raise InvalidRequestPayload(
            "A host key request requires a host and a port in range"
        )


@api.route("/remote/host-key", methods=["POST"])
@local_only
def read_remote_host_key():
    """Report what ``~/.ssh/known_hosts`` knows about a host, and what it offers.

    ``@local_only`` because the paired trust endpoint writes to the server's own
    ``known_hosts``; exposing either under ``SERVER_MODE`` would let an
    unauthenticated caller pin arbitrary keys and poison every other user of that
    machine. This half only reads, but it names local SSH config and so is gated with
    it. POST rather than GET because the body carries ``identityFile``, a local key
    path that has no business in a query string.
    """
    if not request.json:
        return response_bad_request("Missing host key target")

    target = _validated_host_key_target(request.json)
    resolved = resolve_ssh_target(target)
    existing = search_known_hosts(resolved.entry_name)

    def offer_response(issue, offers=(), known_hosts_entry=None):
        return jsonify(
            HostKeyOfferResponse(
                issue=issue,
                host=resolved.scan_host,
                port=resolved.scan_port,
                alias=resolved.alias,
                isProxied=resolved.is_proxied,
                knownHostsEntry=known_hosts_entry,
                offers=list(offers),
            ).model_dump()
        )

    # Scanned before the branch below so a key already recorded can be recognised by
    # its material rather than by the mere presence of an entry — a host that has
    # rotated to an additional key type is known, not changed.
    offers = (
        []
        if resolved.is_proxied
        else scan_host_keys(resolved.scan_host, resolved.scan_port)
    )

    if existing:
        if existing.matches_any([offer.line for offer in offers]):
            # Already trusted, so whatever the caller saw fail was not the host key.
            return offer_response(None)
        return offer_response(HostKeyIssue.CHANGED, known_hosts_entry=existing.location)

    return offer_response(HostKeyIssue.UNKNOWN, offers=offers)


@api.route("/remote/host-key/trust", methods=["POST"])
@local_only
def trust_remote_host_key():
    """Append a host's currently-offered keys to ``~/.ssh/known_hosts``.

    This is trust on first use and nothing stronger: the key is fetched over the same
    unauthenticated network path as the connection itself, so what makes the decision
    meaningful is that the user made it with the fingerprint in front of them — not
    that we verified anything. Hence the two refusals below, which are the difference
    between reproducing OpenSSH's prompt and quietly disabling verification.
    """
    if not request.json:
        return response_bad_request("Missing host key trust request")

    try:
        trust_request = HostKeyTrustRequest.model_validate(request.json)
    except ValidationError:
        raise InvalidRequestPayload(
            "A trust request requires a host key target and the fingerprints shown"
        )

    resolved = resolve_ssh_target(trust_request.target)
    if resolved.is_proxied:
        return response_unprocessable_entity(
            f"{resolved.scan_host} is reached through a jump host, so its key cannot "
            "be fetched. Accept it in a terminal instead."
        )

    existing = search_known_hosts(resolved.entry_name)
    if existing:
        # Refused rather than replaced: an entry that differs is the changed-key case,
        # which only the user can resolve, and one that matches needs nothing.
        return response_unprocessable_entity(
            f"A host key is already recorded for {resolved.entry_name}. Remove it "
            "yourself with ssh-keygen -R if you are sure it should change.",
            detail=existing.location,
        )

    offers = scan_host_keys(resolved.scan_host, resolved.scan_port)
    if not offers:
        return response_unprocessable_entity(
            f"No host key could be fetched from {resolved.scan_host} on port "
            f"{resolved.scan_port}."
        )

    # Re-scanned and compared against what the user was shown, so a key substituted
    # between the preview and the click is refused instead of silently trusted.
    offered_fingerprints = {offer.fingerprint for offer in offers}
    if offered_fingerprints != set(trust_request.fingerprints):
        logger.warning(
            "Host key for %s changed between offer and trust; refusing",
            resolved.entry_name,
        )
        return response_unprocessable_entity(
            f"The keys offered by {resolved.scan_host} changed since they were shown. "
            "Run the test again and re-check the fingerprint before trusting it."
        )

    append_host_keys([offer.line for offer in offers])

    return jsonify(
        StatusMessage(
            status=ConnectionTestStates.OK,
            message=f"Trusted {len(offers)} host key(s) for {resolved.entry_name}",
        ).model_dump()
    )


@api.route("/remote/test", methods=["POST"])
@local_only
def test_remote_folder():
    connection_data = request.json

    if not connection_data:
        return response_bad_request("Missing connection data")

    connection = _validated_remote_connection(connection_data)

    logger.debug(
        "test_remote_folder request identityFile=%r, connection.identityFile=%r",
        connection_data.get("identityFile"),
        getattr(connection, "identityFile", None),
    )
    statuses = []

    def add_status(status, message, detail=None, host_key=None):
        # `ConnectionStatusMessage` only where a host-key verdict may ride along, so
        # the plain `StatusMessage` responses elsewhere don't gain a `hostKey` field.
        statuses.append(
            ConnectionStatusMessage(
                status=status, message=message, detail=detail, hostKey=host_key
            )
            if host_key is not None
            else StatusMessage(status=status, message=message, detail=detail)
        )

    def has_failures():
        return any(
            status.status == ConnectionTestStates.FAILED.value for status in statuses
        )

    # Test SSH Connection
    try:
        test_ssh_connection(connection)
        add_status(ConnectionTestStates.OK.value, "SSH connection established")
    except RemoteConnectionException as e:
        add_status(
            e.status.value,
            e.message,
            getattr(e, "detail", None),
            host_key=getattr(e, "host_key", None),
        )
        # A verdict on the connection answers the whole request, so it keeps its
        # own status code (422 for rejected credentials or an untrusted host key)
        # rather than being reported as one more line in a 200.
        if e.is_connection_verdict:
            return jsonify([status.model_dump() for status in statuses]), e.http_status

    # Both configured paths are checked and searched here, one SSH round trip
    # each: the search settles whether its root exists as part of the same
    # command, and every configured path earns exactly one line below whatever
    # the other path did, so the dialog can resolve the placeholder it seeded.
    if not has_failures():
        try:
            searches = check_remote_path_for_reports(connection)
        except RemoteConnectionException as e:
            # Only the connection's own verdict reaches this: a failure about a
            # single path — including a transport error raised mid-search — is
            # converted and carried back as that path's outcome instead.
            add_status(
                e.status.value,
                e.message,
                getattr(e, "detail", None),
                host_key=getattr(e, "host_key", None),
            )
            if e.is_connection_verdict:
                return (
                    jsonify([status.model_dump() for status in statuses]),
                    e.http_status,
                )
        else:
            if searches.profiler is not None:
                statuses.append(_report_search_status("memory", searches.profiler))
            if searches.performance is not None:
                statuses.append(
                    _report_search_status(
                        "performance",
                        searches.performance,
                        in_rank_subdirectories=connection.multihostPerformance,
                    )
                )

    return Response(
        orjson.dumps([status.model_dump() for status in statuses]),
        mimetype="application/json",
    )


@api.route("/remote/mlir/test", methods=["POST"])
@local_only
def test_mlir_server():
    connection_data = request.json

    if not connection_data:
        return response_bad_request("Missing connection data")

    try:
        mlir_connection = MlirServerConnection.model_validate(connection_data)
    except ValidationError:
        return response_bad_request(
            "MLIR server requires a host, username, port, and SSH port"
        )

    statuses = test_mlir_server_connection(mlir_connection)

    return Response(
        orjson.dumps([status.model_dump() for status in statuses]),
        mimetype="application/json",
    )


def _unique_mlir_name(base: str, used: set[str]) -> str:
    """Disambiguate a stored MLIR report name within a single upload batch.

    Two uploaded files can share a stem (e.g. ``model.mlir`` and ``model.pb``
    both reduce to ``model``); without this the second would silently clobber
    the first on disk and in the results list. Names collide only within a
    batch — a later upload of the same name intentionally replaces the earlier
    file so re-uploading a model refreshes it.
    """
    name = base or "model"
    counter = 2
    while name in used:
        name = f"{base} ({counter})"
        counter += 1
    return name


@api.route("/remote/mlir/upload", methods=["POST"])
@local_only
def upload_mlir_server():
    files = request.files.getlist("files")

    if not files:
        return response_bad_request("No files provided")

    try:
        mlir_connection = MlirServerConnection.model_validate(
            {
                "name": request.form.get("name", ""),
                "username": request.form.get("username", ""),
                "host": request.form.get("host", ""),
                "sshPort": request.form.get("sshPort", type=int) or 22,
                "port": request.form.get("port", type=int),
                "identityFile": request.form.get("identityFile") or None,
            }
        )
    except ValidationError:
        return response_bad_request(
            "MLIR server requires a host, username, and MLIR port"
        )

    try:
        safe_host = sanitise_remote_host_segment(mlir_connection.host)
    except ValueError:
        return response_bad_request("Invalid host")

    data_directory = current_app.config["REMOTE_DATA_DIRECTORY"]
    target_directory = (
        data_directory / safe_host / current_app.config["MLIR_DIRECTORY_NAME"]
    )
    target_directory.mkdir(parents=True, exist_ok=True)

    # Convert every uploaded file independently. One file failing to convert
    # must not abort the others, so per-file outcomes are collected and
    # returned as a list; the caller surfaces them in the results overlay and
    # picks which converted graph to make active. The active MLIR is set
    # separately via `/mlir/active` so nothing is activated until the user
    # chooses.
    existing_names = {path.stem for path in target_directory.glob("*.json")}
    used_names: set[str] = set()
    results = []
    for file in files:
        filename = file.filename or "model"
        result = upload_and_convert_mlir(mlir_connection, file.read(), filename)

        entry = {
            **result.status.model_dump(),
            "filename": Path(filename).name,
            "host": safe_host,
            "name": None,
            "graph": None,
        }

        if (
            result.status.status == ConnectionTestStates.OK.value
            and result.graphs is not None
        ):
            base_name = Path(Path(filename).name).stem
            unavailable_names = existing_names | used_names
            # Preserve intentional refresh semantics for the first upload using
            # the base name while still avoiding clobbering previously-created
            # disambiguated files (for example `model (2).json`).
            if base_name not in used_names:
                unavailable_names.discard(base_name)
            mlir_name = _unique_mlir_name(base_name, unavailable_names)
            used_names.add(mlir_name)
            # Model Explorer labels graphs with the temp remote upload path;
            # rewrite to the stored report stem before the single serialise.
            relabel_graph_ids(result.graphs, mlir_name)
            labelled_graph_json = dumps_graph_bundle(result.graphs)
            mlir_path = target_directory / f"{mlir_name}.json"
            mlir_path.write_text(labelled_graph_json, encoding="utf-8")

            entry["name"] = mlir_name
            # Embed the labelled JSON verbatim rather than re-serialising —
            # the caller renders it without a follow-up `/mlir` fetch.
            entry["graph"] = orjson.Fragment(labelled_graph_json.encode("utf-8"))

        results.append(entry)

    return Response(
        orjson.dumps({"results": results}),
        mimetype="application/json",
    )


@api.route("/mlir/active", methods=["POST"])
@with_instance
@local_only
def set_active_mlir(instance: Instance):
    """Make a previously-uploaded MLIR report the active one for this instance.

    Multi-file uploads store each converted graph as ``<name>.json`` but leave
    the instance untouched; this records the user's choice so `/mlir` serves it
    and a reload restores the same selection.
    """
    data = request.get_json(silent=True) or {}
    name = data.get("name")
    host = data.get("host")
    if not isinstance(name, str) or not name.strip():
        return response_bad_request("Missing required field: name")
    if host is not None and (not isinstance(host, str) or not host.strip()):
        return response_bad_request("Invalid host")

    # Strip any directory components — the stored report lives in the MLIR
    # directory and the name is only ever a file stem. Accepting `.json`
    # input from callers is fine: normalise to the stem before lookup.
    safe_name = Path(name.strip()).stem
    if host is None:
        mlir_path = get_mlir_path(
            safe_name,
            current_app,
            remote_connection=instance.remote_connection,
        )
    else:
        try:
            safe_host = sanitise_remote_host_segment(host)
        except ValueError:
            return response_bad_request("Invalid host")
        mlir_path = str(
            Path(current_app.config["REMOTE_DATA_DIRECTORY"])
            / safe_host
            / current_app.config["MLIR_DIRECTORY_NAME"]
            / f"{safe_name}.json"
        )

    if not mlir_path or not Path(mlir_path).exists():
        return response_not_found()

    update_instance(
        instance_id=instance.instance_id,
        mlir_name=safe_name,
        mlir_location=ReportLocation.REMOTE.value,
        mlir_path=mlir_path,
    )

    return Response(
        orjson.dumps({"name": safe_name, "host": host}),
        mimetype="application/json",
    )


@api.route("/remote/stack-trace/test", methods=["GET"])
@with_instance
def remote_stack_trace_test(instance: Instance):
    file_path, source_file_id, err = _stack_source_request_params()
    if err is not None:
        return err
    return _remote_stack_source_path_availability(instance, file_path, source_file_id)


@api.route("/remote/stack-trace/read", methods=["GET"])
@with_instance
def remote_stack_trace_read(instance: Instance):
    file_path, source_file_id, err = _stack_source_request_params()
    if err is not None:
        return err
    return _remote_stack_source_read(instance, file_path, source_file_id)


@api.route("/remote/sync", methods=["POST"])
@local_only
def sync_remote_folder():
    remote_dir = current_app.config["REMOTE_DATA_DIRECTORY"]
    request_body = request.get_json()

    # Check if request_body is None or not a dictionary
    if not request_body or not isinstance(request_body, dict):
        return response_bad_request("Invalid or missing JSON data")

    profiler = request_body.get("profiler")
    performance = request_body.get("performance", None)
    instance_id = request.args.get("instanceId", None)
    connection = _validated_remote_connection(request_body.get("connection"))

    if performance:
        performance_folder = _validated_remote_report_folder(performance)
        try:
            sync_method = sync_remote_performance_folders(
                connection,
                remote_dir,
                performance=performance_folder,
                exclude_patterns=[r"/tensors(/|$)"],
                sid=instance_id,
            )

            performance_folder.lastSynced = int(time.time())

            response_body = performance_folder.model_dump()
            response_body["syncMethod"] = sync_method.value
            return response_body

        except RemoteConnectionException as e:
            return error_response(
                e.http_status,
                e.message,
                detail=e.detail,
                sync_method=e.sync_method or get_active_sync_method(connection).value,
            )

    remote_profiler_folder = _validated_remote_report_folder(profiler)

    try:
        sync_method = sync_remote_profiler_folders(
            connection,
            remote_profiler_folder.remotePath,
            remote_dir,
            exclude_patterns=[r"/tensors(/|$)"],
            sid=instance_id,
        )

        remote_profiler_folder.lastSynced = int(time.time())

        response_body = remote_profiler_folder.model_dump()
        response_body["syncMethod"] = sync_method.value

        return Response(
            orjson.dumps(response_body),
            mimetype="application/json",
        )

    except RemoteConnectionException as e:
        return error_response(
            e.http_status,
            e.message,
            detail=e.detail,
            sync_method=e.sync_method or get_active_sync_method(connection).value,
        )


_REPORT_NOT_SYNCED_LOCALLY = (
    "Report is not synced locally. Use Sync to download it first."
)


def _safe_report_folder_name(
    *,
    report_name: Optional[str] = None,
    remote_path: Optional[str] = None,
    qualify_rank: bool = False,
) -> Optional[str]:
    """Local folder segment under REMOTE_DATA_DIRECTORY — must match sync destinations.

    Prefer ``remote_path`` (same segment sync writes). ``reportName`` is
    display-only and is only used when ``remote_path`` is omitted. The payload's
    own ``syncedName`` is deliberately not trusted: the segment is recomputed
    here from the path and the connection, so a client cannot name the directory
    it mounts.
    """
    if remote_path is not None:
        # Explicit remotePath — never fall back to reportName (avoids mounting an
        # unrelated folder when the basename is empty / ``.`` / ``..``).
        return folder_segment_from_remote_path(remote_path, qualify_rank=qualify_rank)
    if not report_name:
        return None
    try:
        return sanitise_path_segment(report_name)
    except (TypeError, ValueError):
        return None


@api.route("/remote/use", methods=["POST"])
@local_only
def use_remote_folder():
    data = request.get_json(force=True)
    connection_data = data.get("connection")
    profiler = data.get("profiler")
    performance = data.get("performance")

    if not connection_data or not (profiler or performance):
        return response_bad_request("Missing connection or report data")

    connection = _validated_remote_connection(connection_data)

    kwargs = {
        "instance_id": request.args.get("instanceId"),
        "remote_connection": connection,
    }

    if profiler:
        remote_profiler_folder = _validated_remote_report_folder(profiler)
        profiler_name = _safe_report_folder_name(
            report_name=remote_profiler_folder.reportName,
            remote_path=remote_profiler_folder.remotePath,
        )
        if not profiler_name:
            return response_bad_request("Invalid report path")
        local_db_path = Path(get_profiler_path(profiler_name, current_app, connection))
        if not is_valid_profiler_report_dir(local_db_path.parent):
            return response_not_found(_REPORT_NOT_SYNCED_LOCALLY)
        kwargs["remote_profiler_folder"] = remote_profiler_folder
        kwargs["profiler_name"] = profiler_name
        kwargs["profiler_location"] = ReportLocation.REMOTE.value

    if performance:
        remote_performance_folder = _validated_remote_report_folder(performance)
        performance_name = _safe_report_folder_name(
            report_name=remote_performance_folder.reportName,
            remote_path=remote_performance_folder.remotePath,
            qualify_rank=bool(connection.multihostPerformance),
        )
        if not performance_name:
            return response_bad_request("Invalid report path")
        local_perf_path = Path(
            get_performance_path(performance_name, current_app, connection)
        )
        if not is_valid_performance_report_dir(local_perf_path):
            return response_not_found(_REPORT_NOT_SYNCED_LOCALLY)
        kwargs["remote_performance_folder"] = remote_performance_folder
        kwargs["performance_name"] = performance_name
        kwargs["performance_location"] = ReportLocation.REMOTE.value

    update_instance(**kwargs)

    return Response(status=HTTPStatus.OK)


@api.route("/up", methods=["GET", "HEAD"])
def health_check():
    return Response(status=HTTPStatus.OK)


@api.route("/instance", methods=["GET"])
@with_instance
def get_instance(instance: Instance):
    # Used to gate UI functions if no report is active
    return Response(
        orjson.dumps(instance.model_dump()),
        mimetype="application/json",
    )


@api.route("/instance", methods=["PUT"])
@with_instance
def update_current_instance(instance: Instance):
    try:
        update_data = request.get_json()

        if not update_data:
            return response_bad_request("No data provided.")

        # Use current instance unless a different one is specified
        instance_id = update_data.get("instance_id") or instance.instance_id

        active_report = update_data["active_report"]
        update_kwargs = {
            "instance_id": instance_id,
            "profiler_name": active_report.get("profiler_name"),
            "profiler_location": active_report.get("profiler_location"),
            "performance_name": active_report.get("performance_name"),
            "performance_location": active_report.get("performance_location"),
            "npe_name": active_report.get("npe_name"),
            # NPE is always local right now
            "npe_location": ReportLocation.LOCAL.value,
            "mlir_name": active_report.get("mlir_name"),
            # MLIR is always remote right now
            "mlir_location": ReportLocation.REMOTE.value,
            # Doesn't handle remote at the moment
            "remote_connection": None,
            "remote_profiler_folder": None,
            "remote_performance_folder": None,
        }

        # Pass explicit `*_path` values through only when the payload supplies
        # them, so `update_instance`'s sentinel default ("recompute from name")
        # stays in effect for callers that omit them. This lets API consumers
        # pin an exact path while preserving the current frontend behaviour
        # (which sends names but not paths).
        for path_key in ("profiler_path", "performance_path", "npe_path", "mlir_path"):
            if path_key in active_report:
                update_kwargs[path_key] = active_report[path_key]

        update_instance(**update_kwargs)

        return Response(status=HTTPStatus.OK)
    except Exception as e:
        logger.error(f"Error updating instance: {str(e)}")

        return response_internal_server_error(
            "An error occurred while updating the instance.",
        )


@api.route("/npe", methods=["GET"])
@with_instance
@timer
def get_npe_data(instance: Instance):
    if not instance.npe_path:
        logger.error("NPE path is not set in the instance.")
        return response_not_found()

    if instance.npe_path.endswith(".zst"):
        compressed_path = Path(instance.npe_path)
        uncompressed_path = None
    elif instance.npe_path.endswith(".json") or instance.npe_path.endswith(".npeviz"):
        compressed_path = None
        uncompressed_path = Path(instance.npe_path)
    else:
        compressed_path = Path(instance.npe_path)
        uncompressed_path = Path(instance.npe_path)

    if not (compressed_path and compressed_path.exists()) and not (
        uncompressed_path and uncompressed_path.exists()
    ):
        logger.error(
            f"NPE file does not exist: {compressed_path} / {uncompressed_path}"
        )
        return response_not_found()

    try:
        if compressed_path and compressed_path.exists():
            with open(compressed_path, "rb") as file:
                compressed_data = file.read()
                npe_data = zstd.uncompress(compressed_data)
        else:
            if uncompressed_path is None:
                return response_not_found()
            with open(uncompressed_path, "r") as file:
                npe_data = file.read()
    except Exception as e:
        logger.error(f"Error reading NPE file: {e}")
        return response_unprocessable_entity()

    return Response(npe_data, mimetype="application/json")


def _npe_index_json_response(payload: dict) -> Response:
    # nosniff: the body echoes report-derived strings; pinning the type stops a
    # browser from content-sniffing this JSON as HTML (defence-in-depth XSS).
    return Response(
        orjson.dumps(payload),
        mimetype="application/json",
        headers=_NOSNIFF_HEADERS,
    )


def _resolve_npe_index(
    instance: Instance, reader: Callable[[Path], Optional[dict]]
) -> tuple[Optional[dict], Optional[Response]]:
    """Shared path-check + index build + error mapping for the NPE index routes.

    Returns (payload, None) on success or (None, error_response). Keeping
    ensure_index() and the read under one except map means /summary and /window
    can't drift on status handling (they already diverged once on zstd.Error).
    """
    if not instance.npe_path or not Path(instance.npe_path).exists():
        logger.error("NPE path is not set or file missing.")
        return None, response_not_found()

    try:
        db_path = ensure_index(instance.npe_path)
        return reader(db_path), None
    except FileNotFoundError:
        return None, response_not_found()
    except (orjson.JSONDecodeError, zstd.Error):
        # A corrupt/truncated upload — bad JSON or an undecodable .zst — is a
        # malformed report (422), not a server fault. zstd.Error is NOT a
        # ValueError, so it must be named or it falls through to the 500 arm.
        logger.exception("Malformed NPE report while building index")
        return None, response_unprocessable_entity()
    except Exception:
        logger.exception("Unexpected error building/reading NPE index")
        return None, response_internal_server_error()


# @local_only: ensure_index() parses the whole report and writes a large sidecar
# DB. The SPA calls these routes from any local (non-SERVER_MODE) build — dev and
# local prod — behind the same SERVER_MODE gate, but the blueprint registers them
# unconditionally, so on a hosted (SERVER_MODE) deploy an untrusted caller could
# still reach ensure_index() directly — a DoS + disk-growth vector. The gate
# returns 403 under SERVER_MODE, matching the feature's local-only scope; hosted
# promotion (build/RSS/disk quotas) is tracked in #1802.
@api.route("/npe/summary", methods=["GET"])
@with_instance
@local_only
@timer
def get_npe_summary(instance: Instance):
    summary, error = _resolve_npe_index(instance, read_summary)
    if error is not None:
        return error
    if summary is None:
        return response_not_found()
    return _npe_index_json_response(summary)


@api.route("/npe/window", methods=["GET"])
@with_instance
@local_only
@timer
def get_npe_window(instance: Instance):
    try:
        timestep = int(request.args.get("t", ""))
    except ValueError:
        return response_bad_request("Query param 't' must be an integer timestep.")

    window, error = _resolve_npe_index(
        instance, lambda db_path: read_window(db_path, timestep)
    )
    if error is not None:
        return error
    if window is None:
        return response_not_found()
    return _npe_index_json_response(window)


@api.route("/mlir", methods=["GET"])
@with_instance
@local_only
@timer
def get_mlir_json(instance: Instance):
    if not instance.mlir_path:
        logger.error("MLIR path is not set in the instance.")
        return response_not_found()

    mlir_path = Path(instance.mlir_path)
    if not mlir_path.exists():
        logger.error(f"MLIR file does not exist: {mlir_path}")
        return response_not_found()

    try:
        with open(mlir_path, "r") as file:
            mlir_data = file.read()
    except Exception as e:
        logger.error(f"Error reading MLIR file: {e}")
        return response_unprocessable_entity()

    return Response(mlir_data, mimetype="application/json")


@api.route("/notify", methods=["POST"])
def notify_report_update():
    """
    Endpoint to receive notifications about report updates and broadcast them via websockets.
    """
    from ttnn_visualizer.sockets import (
        ExitStatus,
        ReportGenerated,
        emit_report_generated,
    )

    try:
        data = request.get_json()
        if not data:
            return response_bad_request("No JSON data provided")

        report_name = data.get("report_name")
        exit_status_str = data.get("exit_status")

        if not report_name:
            return response_bad_request("report_name is required")

        # Validate status
        try:
            exit_status = (
                ExitStatus(exit_status_str.upper()) if exit_status_str else None
            )
        except ValueError:
            return response_bad_request("Invalid exit_status.")

        # Create and emit the report update
        report_generated = ReportGenerated(
            report_name=report_name,
            exit_status=exit_status,
            profiler_path=data.get("profiler_path"),
            performance_path=data.get("performance_path"),
        )
        emit_report_generated(report_generated)

        logger.info(f"Report generated notification processed: {report_name}")

        return Response(
            orjson.dumps(
                {
                    "report_name": report_name,
                    "profiler_path": report_generated.profiler_path,
                    "performance_path": report_generated.performance_path,
                    "exit_status": exit_status.value if exit_status else None,
                    "timestamp": report_generated.timestamp,
                }
            ),
            mimetype="application/json",
        )

    except Exception as e:
        logger.error(f"Error processing report update notification: {str(e)}")
        return response_internal_server_error("Internal server error")


@api.route("/latest-version", methods=["GET"])
def get_latest_version():
    try:
        headers = {"Content-Type": "application/xml"}
        releases_request = urllib.request.Request(
            "https://pypi.org/rss/project/ttnn-visualizer/releases.xml",
            headers=headers,
            method="GET",
        )

        with urllib.request.urlopen(releases_request, timeout=2) as url_response:
            response = url_response.read().decode("utf-8")

        match = re.search(r"<title>(\d+\.\d+\.\d+)</title>", response)
        latest_version = match.group(1) if match else None

        return Response(
            orjson.dumps(latest_version),
            mimetype="application/json",
        )
    except Exception as e:
        logger.error(f"Error fetching releases XML: {str(e)}")
        return response_internal_server_error("Failed to fetch releases")


@api.route("/usage", methods=["POST"])
@local_only
def record_usage_events():
    """Append a batch of frontend usage events to the local log.

    Recording happens frontend-side because backend API counts are misleading — React
    Query caching, prefetching and retries inflate them, and the interactions worth
    measuring (chart views, table toggles, filters, playback) never reach the API at
    all. So the client needs somewhere local to post, and this is it.

    **No ``@with_instance``, deliberately.** The log is machine-scoped rather than
    report-scoped, so this route takes no ``instanceId`` — an exception to the
    convention every report-backed route follows, not an omission to be tidied up.

    **No ``@timer`` either**: it logs a line per call, and this endpoint is called often
    by design.

    ``@local_only`` is the control that matters. Nothing here is authenticated and
    ``ALLOWED_ORIGINS`` is the only other gate, so the handler validates its body
    against a closed schema rather than trusting it: a permitted page must not be able
    to write arbitrary lines into the file we are asking IT to parse.
    """
    # Before anything reads the stream. Werkzeug enforces this both against a declared
    # `Content-Length` and while reading a stream the server has terminated, which a
    # manual `request.content_length` check would miss for chunked bodies. The resulting
    # `RequestEntityTooLarge` renders as a 413 through the app's `HTTPException` handler.
    # Assigning it per request needs Flask >= 3.1 — the attribute is read-only before
    # that, so relaxing the pin in `pyproject.toml` turns every request here into a 500
    # rather than a quietly uncapped body.
    request.max_content_length = MAX_USAGE_REQUEST_BYTES

    # Checked here as well as in the writer so a user who switched recording off does not
    # pay a 16 KB parse and a 50-event validation on every flush for the rest of the
    # session. The answer is the same 204 either way, so the client never learns which
    # branch it took and never backs off.
    if not is_recording_enabled(current_app.config["SERVER_MODE"]):
        return Response(status=HTTPStatus.NO_CONTENT)

    # Not `force=True`: requiring `application/json` is load-bearing rather than
    # pedantic. It makes this a non-simple request, so a hostile origin cannot post to it
    # without a preflight `ALLOWED_ORIGINS` refuses, whereas a `text/plain` body would
    # sail through. The client's `sendBeacon` flush must therefore send a typed Blob —
    # `new Blob([body], { type: 'application/json' })` — since a bare string beacon is
    # sent as `text/plain` and would be refused here.
    payload = request.get_json(silent=True)

    if not isinstance(payload, dict):
        return response_bad_request("Expected a JSON object")

    events = payload.get(_USAGE_EVENTS_FIELD)

    if not isinstance(events, list) or not events:
        return response_bad_request(f"Expected a non-empty {_USAGE_EVENTS_FIELD} list")

    if len(events) > MAX_USAGE_BATCH_EVENTS:
        return response_bad_request(
            f"A batch may carry at most {MAX_USAGE_BATCH_EVENTS} events"
        )

    validated: List[Tuple[UsageEvent, Dict[str, Enum]]] = []

    # Every event is validated before any is written, so a batch carrying one bad event
    # appends nothing. Partial acceptance would leave a reader unable to tell a truncated
    # batch from a complete one.
    for entry in events:
        try:
            validated.append(validate_client_event(entry))
        except UsageEventRejected as rejection:
            # `UsageEventRejected` messages describe the schema rather than echoing what
            # arrived, so passing one through cannot leak client-supplied text.
            return response_unprocessable_entity(str(rejection))

    # Deliberately the same answer whether or not the write happened. Recording being
    # switched off locally is not the client's problem, and whether a log exists on this
    # machine is not something a page needs told.
    record_events(validated)

    return Response(status=HTTPStatus.NO_CONTENT)
