import os
import threading
import logging

logger = logging.getLogger(__name__)


class FileUploader:

    target_directory = None

    def __init__(self):
        self.file_chunks = {}
        self.locks = {}

    def get_file_key(self, directory, file_name):
        # Calculate the file key by getting the relative path
        relative_path = os.path.relpath(file_name, start=directory)
        return f"{directory}/{relative_path}"

    def save_chunks_to_file(self, save_path, chunks):
        """Write the list of chunks to the specified save_path."""
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        with open(save_path, "wb") as f:
            for chunk in chunks:
                f.write(chunk)

    def get_lock(self, tab_id):
        """Get a lock for the given tabId, creating one if it doesn't exist."""
        if tab_id not in self.locks:
            self.locks[tab_id] = threading.Lock()
        return self.locks[tab_id]

    def handle_chunk(self, data, target_directory, lock_id):
        directory = data.get("directory")
        file_name = data.get("fileName")
        chunk = data.get("chunk")
        is_last_chunk = data.get("isLastChunk")

        # Validate data
        if not (lock_id and directory and file_name and chunk is not None):
            return {"error": "Invalid data received"}

        # Use a specific lock for this tabId
        with self.get_lock(lock_id):
            if lock_id not in self.file_chunks:
                self.file_chunks[lock_id] = {}

            file_key = self.get_file_key(directory, file_name)

            if file_key not in self.file_chunks[lock_id]:
                self.file_chunks[lock_id][file_key] = []

            self.file_chunks[lock_id][file_key].append(chunk)

            if is_last_chunk:
                save_path = os.path.join(target_directory, file_key)
                self.save_chunks_to_file(save_path, self.file_chunks[lock_id][file_key])

                del self.file_chunks[lock_id][file_key]

                if not self.file_chunks[lock_id]:
                    del self.file_chunks[lock_id]
                    del self.locks[lock_id]  # Clean up the lock as well

                logger.info(f"File {file_name} saved successfully at {save_path}")
                return {"status": "File uploaded successfully"}

        # Confirm chunk received if not the last one
        return {"status": "Chunk received"}
