import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from logging import getLogger

from flask import current_app
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

file_chunks = {}


def emit_file_status(progress: FileProgress, tab_id=None):
    """Debounced emit for file status updates using a debounce timer."""
    global debounce_timer, last_emit_time

    def emit_now():
        global last_emit_time
        last_emit_time = time.time()
        data = progress.to_dict()
        data.update({"tab_id": tab_id})
        if socketio is not None and hasattr(socketio, "emit"):
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
            socketio.emit("pong")
        else:
            print("No tabId provided, disconnecting client.")
            disconnect()

    @socketio.on("ping")
    def handle_ping(data):

        from flask import request

        tab_id = request.args.get("tabId")
        print(f"Received ping from tabId: {tab_id}")
        print(data)

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

    @socketio.on("upload-report")
    def handle_upload_report(data):
        local_data_directory = current_app.config["LOCAL_DATA_DIRECTORY"]
        directory = data.get("directory")
        file_name = data.get("fileName")
        chunk = data.get("chunk")
        is_last_chunk = data.get("isLastChunk")

        if not (directory and file_name and chunk is not None):
            return {"error": "Invalid data received"}

        file_key = f"{directory}/{file_name}"

        # Initialize file_chunks[file_key] if it's the start of a new upload
        if file_key not in file_chunks or is_last_chunk:
            file_chunks[file_key] = []

        file_chunks[file_key].append(chunk)

        # Write the file when the last chunk is received
        if is_last_chunk:
            save_path = os.path.join(local_data_directory, file_key)

            logger.info(f"Writing file: {save_path}")

            # Ensure the directory exists
            os.makedirs(os.path.dirname(save_path), exist_ok=True)

            # Write chunks to the file in binary mode to overwrite any existing file
            with open(save_path, "wb") as f:
                for chunk in file_chunks[file_key]:
                    f.write(chunk)

            # Clear the chunks from memory after writing
            del file_chunks[file_key]

            logger.info(f"File {file_name} saved successfully at {save_path}")
            return {"status": "File uploaded successfully"}

        # Return success for each chunk received
        return {"status": "Chunk received"}
