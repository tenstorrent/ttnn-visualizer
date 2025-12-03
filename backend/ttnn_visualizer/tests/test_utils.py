# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from unittest.mock import mock_open, patch

from ttnn_visualizer.utils import (
    find_gunicorn_path,
    get_app_data_directory,
    is_running_in_container,
)


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


# Tests for is_running_in_container()


@patch("os.path.exists")
@patch("os.getenv")
def test_container_detection_via_dockerenv(mock_getenv, mock_exists):
    """Test container detection via /.dockerenv file."""
    mock_exists.return_value = True
    mock_getenv.return_value = None

    result = is_running_in_container()

    assert result is True
    mock_exists.assert_called_once_with("/.dockerenv")


@patch("os.path.exists")
@patch(
    "builtins.open",
    new_callable=mock_open,
    read_data="12:pids:/docker/abc123\n11:cpuset:/docker/abc123",
)
@patch("os.getenv")
def test_container_detection_via_cgroup_docker(mock_getenv, mock_file, mock_exists):
    """Test container detection via /proc/self/cgroup containing 'docker'."""
    mock_exists.return_value = False  # No /.dockerenv
    mock_getenv.return_value = None

    result = is_running_in_container()

    assert result is True
    mock_file.assert_called_once_with("/proc/self/cgroup", "r")


@patch("os.path.exists")
@patch(
    "builtins.open",
    new_callable=mock_open,
    read_data="12:pids:/containerd/abc123\n11:cpuset:/containerd/abc123",
)
@patch("os.getenv")
def test_container_detection_via_cgroup_containerd(mock_getenv, mock_file, mock_exists):
    """Test container detection via /proc/self/cgroup containing 'containerd'."""
    mock_exists.return_value = False
    mock_getenv.return_value = None

    result = is_running_in_container()

    assert result is True


@patch("os.path.exists")
@patch(
    "builtins.open",
    new_callable=mock_open,
    read_data="12:pids:/lxc/container123\n11:cpuset:/lxc/container123",
)
@patch("os.getenv")
def test_container_detection_via_cgroup_lxc(mock_getenv, mock_file, mock_exists):
    """Test container detection via /proc/self/cgroup containing 'lxc'."""
    mock_exists.return_value = False
    mock_getenv.return_value = None

    result = is_running_in_container()

    assert result is True


@patch("os.path.exists")
@patch(
    "builtins.open",
    new_callable=mock_open,
    read_data="12:pids:/kubepods/besteffort/pod123\n11:cpuset:/kubepods/besteffort/pod123",
)
@patch("os.getenv")
def test_container_detection_via_cgroup_kubepods(mock_getenv, mock_file, mock_exists):
    """Test container detection via /proc/self/cgroup containing 'kubepods'."""
    mock_exists.return_value = False
    mock_getenv.return_value = None

    result = is_running_in_container()

    assert result is True


@patch("os.path.exists")
@patch("builtins.open", side_effect=FileNotFoundError())
@patch("os.getenv")
def test_container_detection_cgroup_file_not_found(mock_getenv, mock_file, mock_exists):
    """Test container detection handles FileNotFoundError from /proc/self/cgroup."""
    mock_exists.return_value = False

    def getenv_side_effect(key):
        return None

    mock_getenv.side_effect = getenv_side_effect

    result = is_running_in_container()

    assert result is False


@patch("os.path.exists")
@patch("builtins.open", side_effect=PermissionError())
@patch("os.getenv")
def test_container_detection_cgroup_permission_error(
    mock_getenv, mock_file, mock_exists
):
    """Test container detection handles PermissionError from /proc/self/cgroup."""
    mock_exists.return_value = False

    def getenv_side_effect(key):
        return None

    mock_getenv.side_effect = getenv_side_effect

    result = is_running_in_container()

    assert result is False


@patch("os.path.exists")
@patch(
    "builtins.open",
    new_callable=mock_open,
    read_data="12:pids:/user.slice\n11:cpuset:/",
)
def test_container_detection_via_kubernetes_service_host(mock_file, mock_exists):
    """Test container detection via KUBERNETES_SERVICE_HOST environment variable."""
    mock_exists.return_value = False

    with patch.dict("os.environ", {"KUBERNETES_SERVICE_HOST": "10.0.0.1"}, clear=True):
        result = is_running_in_container()

    assert result is True


@patch("os.path.exists")
@patch(
    "builtins.open",
    new_callable=mock_open,
    read_data="12:pids:/user.slice\n11:cpuset:/",
)
def test_container_detection_via_kubernetes_port(mock_file, mock_exists):
    """Test container detection via KUBERNETES_PORT environment variable."""
    mock_exists.return_value = False

    with patch.dict(
        "os.environ", {"KUBERNETES_PORT": "tcp://10.0.0.1:443"}, clear=True
    ):
        result = is_running_in_container()

    assert result is True


@patch("os.path.exists")
@patch(
    "builtins.open",
    new_callable=mock_open,
    read_data="12:pids:/user.slice\n11:cpuset:/",
)
def test_container_detection_via_container_env(mock_file, mock_exists):
    """Test container detection via 'container' environment variable."""
    mock_exists.return_value = False

    with patch.dict("os.environ", {"container": "podman"}, clear=True):
        result = is_running_in_container()

    assert result is True


@patch("os.path.exists")
@patch(
    "builtins.open",
    new_callable=mock_open,
    read_data="12:pids:/user.slice\n11:cpuset:/",
)
@patch("os.getenv")
def test_no_container_detection(mock_getenv, mock_file, mock_exists):
    """Test that no container is detected when all checks fail."""
    mock_exists.return_value = False  # No /.dockerenv
    mock_getenv.return_value = None  # No container env vars

    result = is_running_in_container()

    assert result is False


# Tests for get_app_data_directory()


def test_get_app_data_directory_with_tt_metal_home():
    """Test that get_app_data_directory returns correct path when tt_metal_home is provided."""
    tt_metal_home = "/path/to/tt-metal"
    application_dir = "/default/app/dir"

    result = get_app_data_directory(tt_metal_home, application_dir)

    assert result == "/path/to/tt-metal/generated/ttnn-visualizer"


def test_get_app_data_directory_with_none():
    """Test that get_app_data_directory returns application_dir when tt_metal_home is None."""
    tt_metal_home = None
    application_dir = "/default/app/dir"

    result = get_app_data_directory(tt_metal_home, application_dir)

    assert result == "/default/app/dir"


def test_get_app_data_directory_with_empty_string():
    """Test that get_app_data_directory treats empty string as falsy and returns application_dir."""
    tt_metal_home = ""
    application_dir = "/default/app/dir"

    result = get_app_data_directory(tt_metal_home, application_dir)

    assert result == "/default/app/dir"


def test_get_app_data_directory_with_special_characters():
    """Test that get_app_data_directory handles paths with special characters correctly."""
    tt_metal_home = "/path/with spaces/and-dashes/tt-metal"
    application_dir = "/default/app/dir"

    result = get_app_data_directory(tt_metal_home, application_dir)

    assert result == "/path/with spaces/and-dashes/tt-metal/generated/ttnn-visualizer"


def test_get_app_data_directory_with_relative_path():
    """Test that get_app_data_directory handles relative paths correctly."""
    tt_metal_home = "../relative/path/tt-metal"
    application_dir = "/default/app/dir"

    result = get_app_data_directory(tt_metal_home, application_dir)

    assert result == "../relative/path/tt-metal/generated/ttnn-visualizer"


def test_get_app_data_directory_with_trailing_slash():
    """Test that get_app_data_directory handles paths with trailing slashes correctly."""
    tt_metal_home = "/path/to/tt-metal/"
    application_dir = "/default/app/dir"

    result = get_app_data_directory(tt_metal_home, application_dir)

    # Path.join handles trailing slashes correctly
    assert result == "/path/to/tt-metal/generated/ttnn-visualizer"
