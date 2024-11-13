from io import BytesIO
from pathlib import Path

import torch

from ttnn_visualizer.models import TabSession
from ttnn_visualizer.queries import DatabaseQueries
from ttnn_visualizer.sftp_operations import read_remote_file


class TensorComparator:
    def __init__(self, session, db=None):
        self.session = session
        self.report_path = Path(session.report_path).parent.joinpath("tensors")
        self.db = (
            db if db else DatabaseQueries(session)
        )  # Use provided db or create a new instance

    def compare_tensor(self, tensor_id, local=False):
        """Main method to compare tensors and return the absolute difference as a tensor."""
        if local:
            comparison = self.db.query_local_comparison_records(tensor_id)
        else:
            comparison = self.db.query_global_tensor_comparisons_by_tensor_id(tensor_id)

        if not comparison:
            raise ValueError("Comparison record not found")

        tensor_1 = self.read_tensor(tensor_id)
        tensor_2 = self.read_tensor(comparison.golden_tensor_id)

        if tensor_1 is None or tensor_2 is None:
            raise ValueError("One or both tensors could not be loaded")

        if tensor_1.size() != tensor_2.size():
            raise ValueError("Tensors must have the same shape to be compared")

        return torch.abs(tensor_1 - tensor_2)  # Returns raw tensor difference

    def get_comparison_json(self, tensor_id, local=False):
        """Fetches the absolute difference between tensors in JSON-serializable format."""
        diff_tensor = self.compare_tensor(tensor_id, local=local)
        return self.make_torch_json_serializable(diff_tensor)

    def get_tensor_json(self, tensor_id):
        """Fetches a single tensor and returns it in JSON-serializable format."""
        tensor = self.read_tensor(tensor_id)
        if tensor is None:
            raise ValueError(f"Tensor with ID {tensor_id} could not be found or loaded")
        return self.make_torch_json_serializable(tensor)

    def read_tensor(self, tensor_id):
        """Reads tensor based on session type: local or remote."""
        tensor_file_path = self.report_path.joinpath(f"{tensor_id}.pt")

        if self.session.remote_connection:
            return self._read_remote_tensor(tensor_file_path)
        else:
            return self._read_local_tensor(tensor_file_path)

    def _read_remote_tensor(self, tensor_file_path):
        """Reads tensor from remote location."""
        tensor_content = read_remote_file(
            self.session.remote_connection, tensor_file_path
        )
        if tensor_content:
            buffer = BytesIO(tensor_content)
            return torch.load(buffer)

        return None

    def _read_local_tensor(self, tensor_file_path):
        """Reads tensor from local file system using a buffer."""
        try:
            with open(tensor_file_path, "rb") as f:
                buffer = BytesIO(f.read())
                return torch.load(buffer)
        except FileNotFoundError:
            raise ValueError("Tensor file not found")

    @staticmethod
    def make_torch_json_serializable(data):
        """Recursively convert PyTorch tensors and complex data structures to JSON-serializable types."""
        if isinstance(data, torch.Tensor):
            return data.tolist()  # Convert tensor to list
        elif isinstance(data, dict):
            return {
                key: TensorComparator.make_torch_json_serializable(value)
                for key, value in data.items()
            }
        elif isinstance(data, list):
            return [
                TensorComparator.make_torch_json_serializable(item) for item in data
            ]
        elif isinstance(data, tuple):
            return tuple(
                TensorComparator.make_torch_json_serializable(item) for item in data
            )
        return data  # Return the data as is if it's already JSON-serializable
