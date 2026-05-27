# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any

from flask_socketio import disconnect, join_room, leave_room
from ttnn_visualizer.utils import SerializeableDataclass

logger = logging.getLogger(__name__)

# Set in register_handlers; may be None when websockets are disabled
socketio: Any | None = None


class Messages(object):
    FILE_TRANSFER_PROGRESS = "fileTransferProgress"
    REPORT_GENERATED = "reportGenerated"


class FileStatus(Enum):
    DOWNLOADING = "DOWNLOADING"
    FAILED = "FAILED"
    FINISHED = "FINISHED"
    STARTED = "STARTED"


class ExitStatus(Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    ERROR = "ERROR"


@dataclass
class FileProgress(SerializeableDataclass):
    current_file_name: str
    number_of_files: int
    percent_of_current: float
    finished_files: int
    status: FileStatus
    # Bytes-level progress is optional so upload paths that have no size info
    # (and any future transport) can omit it without breaking the wire format.
    bytes_transferred: int = 0
    bytes_total: int = 0
    current_file_size: int = 0
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def __post_init__(self):
        self.percent_of_current = round(self.percent_of_current, 2)


@dataclass
class ReportGenerated(SerializeableDataclass):
    report_name: str
    profiler_path: str | None = None
    performance_path: str | None = None
    exit_status: ExitStatus | None = None
    message_type: str = "report_generated"
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())


# For tracking connected clients subscriber ID (instance_id -> socket sid)
tab_clients: dict[str, str] = {}

# Global variables for debouncing
debounce_timer = None
debounce_delay = 0.5  # Delay in seconds (adjust as needed)
last_emit_time = 0

# Single lock guards every read/write of `debounce_timer` and
# `last_emit_time`, plus the body of the deferred `emit_now`. Without it,
# a worker calling `emit_file_status(FINISHED, ...)` can cancel the timer
# *after* `Timer.run()` has already begun executing the queued callback,
# so the client would see FINISHED followed by a stale DOWNLOADING.
# Holding the lock in both the cancel/flush path and inside the timer
# callback collapses that window: the timer callback either runs to
# completion before the terminal flush, or sees that `debounce_timer` has
# been replaced/cleared and bails out.
_emit_lock = threading.Lock()

# Terminal statuses bypass debouncing: a delayed FINISHED/FAILED can land
# *after* the HTTP response and the client-side reset, briefly reopening the
# overlay or leaving the atom non-inactive until the next user action.
_TERMINAL_STATUSES = frozenset({FileStatus.FINISHED, FileStatus.FAILED})


def emit_file_status(progress: FileProgress, instance_id=None):
    """Debounced emit for file status updates.

    Intermediate progress (STARTED/DOWNLOADING) is debounced to avoid
    flooding the socket on fast multi-file syncs. Terminal updates
    (FINISHED/FAILED) flush immediately and cancel any pending debounce so
    the client sees the final state before its own post-request reset.
    """
    global debounce_timer, last_emit_time

    def emit_now():
        global last_emit_time
        last_emit_time = time.time()
        data = progress.to_dict()
        data.update({"instance_id": instance_id})
        try:
            if socketio is not None and hasattr(socketio, "emit"):
                socketio.emit(Messages.FILE_TRANSFER_PROGRESS, data, to=instance_id)
        except NameError:
            pass  # Can silently pass since we know the NameError is from sockets being disabled

    # Holder lets the deferred callback identify *its own* timer instance
    # without a forward reference. If the callback enters the lock and
    # finds `debounce_timer` no longer matches, a newer caller has
    # already superseded it and the queued payload is stale.
    scheduled: list[threading.Timer | None] = [None]

    def deferred_emit():
        with _emit_lock:
            if debounce_timer is not scheduled[0]:
                return
            _clear_timer_locked()
            emit_now()

    with _emit_lock:
        # Cancel any existing debounce timer if it exists and is still
        # active. We do this for *all* emits — the pending payload is now
        # stale relative to either the new intermediate update or the
        # incoming terminal one. `Timer.cancel()` only prevents a not-yet-
        # started callback; the identity check inside `deferred_emit`
        # handles the case where `run()` already entered the callback
        # before we acquired the lock.
        _clear_timer_locked()

        if progress.status in _TERMINAL_STATUSES:
            emit_now()
            return

        # Check if the last emit was longer than debounce_delay
        if time.time() - last_emit_time > debounce_delay:
            emit_now()
        else:
            new_timer = threading.Timer(debounce_delay, deferred_emit)
            scheduled[0] = new_timer
            debounce_timer = new_timer
            new_timer.start()


def _clear_timer_locked():
    """Cancel and forget any pending debounce timer. Caller must hold `_emit_lock`."""
    global debounce_timer
    if debounce_timer is not None and isinstance(debounce_timer, threading.Timer):
        debounce_timer.cancel()
    debounce_timer = None


def emit_report_generated(report_generated: ReportGenerated):
    """Emit a report update notification to all connected clients."""
    try:
        if socketio is not None and hasattr(socketio, "emit"):
            data = report_generated.to_dict()
            socketio.emit(Messages.REPORT_GENERATED, data)
            logger.info(
                f"Report update notification sent: {report_generated.report_name}"
            )
    except NameError:
        logger.warning("SocketIO not available - skipping report update notification")
        pass  # Can silently pass since we know the NameError is from sockets being disabled


def register_handlers(socketio_instance):
    global socketio
    socketio = socketio_instance

    @socketio.on("connect")
    def handle_connect():
        from flask import request

        sid = getattr(request, "sid", "")

        instance_id = request.args.get("instanceId")
        logger.info(f"Received instanceId: {instance_id}, socket ID: {sid}")

        if instance_id:
            join_room(instance_id)  # Join the room identified by the instanceId
            tab_clients[instance_id] = (
                sid  # Store the socket ID associated with this instanceId
            )
            logger.info(f"Joined room: {instance_id}")
        else:
            logger.warning("No instanceId provided, disconnecting client.")
            disconnect()

    @socketio.on("disconnect")
    def handle_disconnect():
        from flask import request

        instance_id = None
        # Find and remove the socket ID associated with this instanceId
        sid = getattr(request, "sid", "")
        for key, value in tab_clients.items():

            if value == sid:
                instance_id = key
                break
        if instance_id:
            leave_room(instance_id)
            del tab_clients[instance_id]
            logger.info(
                f"Client disconnected from instanceId: {instance_id}, Socket ID: {sid}"
            )
