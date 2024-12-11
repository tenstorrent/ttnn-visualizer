# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from logging import getLogger

from flask_socketio import join_room, disconnect, leave_room

from ttnn_visualizer.utils import SerializeableDataclass


logger = getLogger(__name__)


class Messages(object):
    FILE_TRANSFER_PROGRESS = "fileTransferProgress"


class FileStatus(Enum):
    DOWNLOADING = "DOWNLOADING"
    FAILED = "FAILED"
    COMPRESSING = "COMPRESSING"
    FINISHED = "FINISHED"
    STARTED = "STARTED"


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


# For tracking connected clients subscriber ID
tab_clients = {}

# Global variables for debouncing
debounce_timer = None
debounce_delay = 0.5  # Delay in seconds (adjust as needed)
last_emit_time = 0


def emit_file_status(progress: FileProgress, tab_id=None):
    """Debounced emit for file status updates using a debounce timer."""
    global debounce_timer, last_emit_time

    def emit_now():
        global last_emit_time
        last_emit_time = time.time()
        data = progress.to_dict()
        data.update({"tab_id": tab_id})
        try:
            if socketio is not None and hasattr(socketio, "emit"):
                socketio.emit(Messages.FILE_TRANSFER_PROGRESS, data, to=tab_id)
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


def register_handlers(socketio_instance):
    global socketio
    socketio = socketio_instance

    @socketio.on("connect")
    def handle_connect():
        from flask import request

        sid = getattr(request, "sid", "")

        tab_id = request.args.get("tabId")
        print(f"Received tabId: {tab_id}, socket ID: {sid}")  # Log for debugging

        if tab_id:
            join_room(tab_id)  # Join the room identified by the tabId
            tab_clients[tab_id] = sid  # Store the socket ID associated with this tabId
            print(f"Joined room: {tab_id}")
        else:
            print("No tabId provided, disconnecting client.")
            disconnect()

    @socketio.on("disconnect")
    def handle_disconnect():
        from flask import request

        tab_id = None
        # Find and remove the socket ID associated with this tabId
        sid = getattr(request, "sid", "")
        for key, value in tab_clients.items():

            if value == sid:
                tab_id = key
                break
        if tab_id:
            leave_room(tab_id)
            del tab_clients[tab_id]
            print(f"Client disconnected from tabId: {tab_id}, Socket ID: {sid}")
