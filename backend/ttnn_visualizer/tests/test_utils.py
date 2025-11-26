# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from unittest.mock import patch

from ttnn_visualizer.utils import find_gunicorn_path


@patch("sys.argv", ["/home/user/.local/bin/ttnn-visualizer"])
@patch("os.access")
@patch("pathlib.Path.exists")
@patch("pathlib.Path.is_file")
@patch("shutil.which")
def test_find_gunicorn_in_same_directory(
    mock_which, mock_is_file, mock_exists, mock_access
):
    """Test finding gunicorn in the same directory as ttnn-visualizer."""
    mock_exists.return_value = True
    mock_is_file.return_value = True
    mock_access.return_value = True
    mock_which.return_value = None  # Not in PATH

    gunicorn_path, warning = find_gunicorn_path()

    assert gunicorn_path.endswith("/home/user/.local/bin/gunicorn")
    assert warning is None


@patch("sys.argv", ["/home/user/.local/bin/ttnn-visualizer"])
@patch("os.access")
@patch("pathlib.Path.exists")
@patch("pathlib.Path.is_file")
@patch("shutil.which")
def test_find_multiple_gunicorn_installations(
    mock_which, mock_is_file, mock_exists, mock_access
):
    """Test warning when multiple gunicorn installations are detected."""
    mock_exists.return_value = True
    mock_is_file.return_value = True
    mock_access.return_value = True
    mock_which.return_value = "/usr/bin/gunicorn"  # Different one in PATH

    gunicorn_path, warning = find_gunicorn_path()

    assert gunicorn_path.endswith("/home/user/.local/bin/gunicorn")
    assert warning is not None
    assert "Multiple gunicorn installations detected" in warning


@patch("sys.argv", ["/home/user/.local/bin/ttnn-visualizer"])
@patch("os.access")
@patch("pathlib.Path.exists")
@patch("pathlib.Path.is_file")
@patch("shutil.which")
def test_gunicorn_not_executable(mock_which, mock_is_file, mock_exists, mock_access):
    """Test when gunicorn exists but is not executable."""
    mock_exists.return_value = True
    mock_is_file.return_value = True
    mock_access.return_value = False  # Not executable
    mock_which.return_value = "/usr/bin/gunicorn"

    gunicorn_path, warning = find_gunicorn_path()

    assert gunicorn_path == "/usr/bin/gunicorn"
    assert warning is not None
    assert "not executable" in warning
    assert "chmod +x" in warning


@patch("sys.argv", ["/home/user/.local/bin/ttnn-visualizer"])
@patch("os.access")
@patch("pathlib.Path.exists")
@patch("pathlib.Path.is_file")
@patch("shutil.which")
def test_fallback_to_path(mock_which, mock_is_file, mock_exists, mock_access):
    """Test falling back to PATH when not in same directory."""
    mock_exists.return_value = False
    mock_is_file.return_value = False
    mock_which.return_value = "/usr/bin/gunicorn"

    gunicorn_path, warning = find_gunicorn_path()

    assert gunicorn_path == "/usr/bin/gunicorn"
    assert warning is not None
    assert "not found in" in warning
    assert "Falling back" in warning


@patch("sys.argv", ["/home/user/.local/bin/ttnn-visualizer"])
@patch("os.access")
@patch("pathlib.Path.exists")
@patch("pathlib.Path.is_file")
@patch("shutil.which")
def test_gunicorn_not_found(mock_which, mock_is_file, mock_exists, mock_access):
    """Test when gunicorn is not found anywhere."""
    mock_exists.return_value = False
    mock_is_file.return_value = False
    mock_which.return_value = None

    gunicorn_path, warning = find_gunicorn_path()

    assert gunicorn_path == "gunicorn"
    assert warning is not None
    assert "ERROR" in warning
    assert "not found" in warning
