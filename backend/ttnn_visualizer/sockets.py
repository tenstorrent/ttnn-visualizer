import dataclasses
import threading
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
from logging import getLogger

from flask_socketio import join_room, disconnect, leave_room

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
class BaseModel:
    def to_dict(self) -> dict:
        # Convert the dataclass to a dictionary and handle Enums.
        return {
            key: (value.value if isinstance(value, Enum) else value)
            for key, value in asdict(self).items()
        }


@dataclass
class FileProgress(BaseModel):
    current_file_name: str
    number_of_files: int
    percent_of_current: float
    finished_files: int
    status: FileStatus  # Use the FileStatus Enum
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def __post_init__(self):
        if isinstance(self.status, str):
            self.status = FileStatus(self.status)
        self.percent_of_current = round(self.percent_of_current, 2)

    def to_dict(self):
        # Use asdict and manually handle enums to convert them to their value
        data = asdict(self)
        data["status"] = self.status.value if self.status else None
        return data


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
        data = dataclasses.asdict(progress)
        data.update({"tab_id": tab_id})
        socketio.emit(Messages.FILE_TRANSFER_PROGRESS, data, to=tab_id)

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


def emit_compression_progress(client, remote_tar_path, folder_size, sid):
    """Emit progress during the compression."""
    compressed_size = 0
    while compressed_size < folder_size:
        stdin, stdout, stderr = client.exec_command(f"du -sb {remote_tar_path}")
        compressed_size_str = stdout.read().decode().strip().split("\t")[0]
        compressed_size = int(compressed_size_str)
        percent_of_compression = (compressed_size / folder_size) * 100
        progress = FileProgress(
            current_file_name=remote_tar_path,
            number_of_files=1,
            percent_of_current=percent_of_compression,
            finished_files=0,
            status=FileStatus.COMPRESSING,
        )
        emit_file_status(progress, tab_id=sid)


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
