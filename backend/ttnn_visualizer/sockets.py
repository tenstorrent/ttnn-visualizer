# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from logging import getLogger

from flask_socketio import disconnect, join_room, leave_room
from ttnn_visualizer.utils import SerializeableDataclass

logger = getLogger(__name__)


class Messages(object):
    FILE_TRANSFER_PROGRESS = "fileTransferProgress"
    REPORT_GENERATED = "reportGenerated"


class FileStatus(Enum):
    DOWNLOADING = "DOWNLOADING"
    FAILED = "FAILED"
    COMPRESSING = "COMPRESSING"
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
    status: FileStatus  # Use the FileStatus Enum
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


# For tracking connected clients subscriber ID
tab_clients = {}

# Global variables for debouncing
debounce_timer = None
debounce_delay = 0.5  # Delay in seconds (adjust as needed)
last_emit_time = 0


def emit_file_status(progress: FileProgress, instance_id=None):
    """Debounced emit for file status updates using a debounce timer."""
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

    # Cancel any existing debounce timer if it exists and is still active
    if debounce_timer and isinstance(debounce_timer, threading.Timer):
        debounce_timer.cancel()

    # Check if the last emit was longer than debounce_delay
    if time.time() - last_emit_time > debounce_delay:
        emit_now()
    else:
        # Set a new debounce timer
        debounce_timer = threading.Timer(debounce_delay, emit_now)
        debounce_timer.start()


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
        print(
            f"Received instanceId: {instance_id}, socket ID: {sid}"
        )  # Log for debugging

        if instance_id:
            join_room(instance_id)  # Join the room identified by the instanceId
            tab_clients[instance_id] = (
                sid  # Store the socket ID associated with this instanceId
            )
            print(f"Joined room: {instance_id}")
        else:
            print("No instanceId provided, disconnecting client.")
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
            print(
                f"Client disconnected from instanceId: {instance_id}, Socket ID: {sid}"
            )
