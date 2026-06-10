# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import json
import logging
import os
import shlex
import subprocess
import time
from http import HTTPStatus
from pathlib import Path
from threading import Thread
from typing import List, NoReturn, Optional

import yaml
from flask import current_app
from ttnn_visualizer.decorators import remote_exception_handler
from ttnn_visualizer.enums import ConnectionTestStates, SyncMethod
from ttnn_visualizer.exceptions import (
    AuthenticationException,
    HostKeyVerificationException,
    NoReportsException,
    NoValidConnectionsError,
    RemoteConnectionException,
    SSHException,
)
from ttnn_visualizer.models import Instance, RemoteConnection, RemoteReportFolder
from ttnn_visualizer.sockets import FileProgress, FileStatus, emit_file_status
from ttnn_visualizer.ssh_client import SSHClient, raise_for_ssh_subprocess_error
from ttnn_visualizer.utils import (
    PROFILER_CONFIG_BASENAME,
    pick_cluster_descriptor_path,
    ranked_profiler_config_basenames,
    update_last_synced,
)

logger = logging.getLogger(__name__)

# Hosts where the SFTP subsystem is unavailable but scp over SSH still works,
# keyed by (username, host, port). Process-global and never evicted: a single
# subsystem failure pins that endpoint to scp for the rest of the process
# lifetime (across users under SERVER_MODE). That's an intentional tradeoff —
# scp is a safe superset fallback, so a stale entry only costs an unnecessary
# scp where sftp might now work, never a failed sync. A restart clears it.
_sftp_subsystem_unavailable: set[tuple[str, str, int]] = set()


def _remote_transfer_key(remote_connection: RemoteConnection) -> tuple[str, str, int]:
    return (
        remote_connection.username,
        remote_connection.host,
        remote_connection.port,
    )


def _is_sftp_subsystem_unavailable(stderr: str) -> bool:
    return "subsystem request failed" in (stderr or "").lower()


def get_active_sync_method(remote_connection: RemoteConnection) -> SyncMethod:
    """Which transport this host is currently using (scp once SFTP has failed)."""
    if _remote_transfer_key(remote_connection) in _sftp_subsystem_unavailable:
        return SyncMethod.SCP
    return SyncMethod.SFTP


def _ssh_subprocess_timeout_seconds() -> int:
    """Timeout for SSH subprocess ops (find, stat, cat, list). Configurable via SSH_SUBPROCESS_TIMEOUT."""
    try:
        return int(current_app.config["SSH_SUBPROCESS_TIMEOUT"])
    except RuntimeError:
        return int(os.getenv("SSH_SUBPROCESS_TIMEOUT", "120"))


def _ssh_remote_check_timeout_seconds() -> int:
    """Timeout per quick SSH check (e.g. test -f per folder). Configurable via SSH_REMOTE_CHECK_TIMEOUT."""
    try:
        return int(current_app.config["SSH_REMOTE_CHECK_TIMEOUT"])
    except RuntimeError:
        return int(os.getenv("SSH_REMOTE_CHECK_TIMEOUT", "45"))


TEST_CONFIG_FILE = PROFILER_CONFIG_BASENAME
TEST_DB_FILE = "db.sqlite"
TEST_PROFILER_FILE = "profile_log_device.csv"


def _ssh_cmd_prefix(remote_connection: RemoteConnection) -> List[str]:
    """Build SSH command prefix (never prompts for password). Includes BatchMode=yes and optional identity file."""
    cmd = ["ssh"]
    identity = (getattr(remote_connection, "identityFile", None) or "").strip()
    if identity:
        cmd.extend(["-F", os.devnull])
    cmd.extend(["-o", "BatchMode=yes", "-o", "PasswordAuthentication=no"])
    if identity:
        cmd.extend(["-o", "IdentitiesOnly=yes", "-i", identity])
    if remote_connection.port != 22:
        cmd.extend(["-p", str(remote_connection.port)])
    cmd.append(f"{remote_connection.username}@{remote_connection.host}")
    return cmd


def _sftp_cmd_prefix(remote_connection: RemoteConnection) -> List[str]:
    """Build SFTP command prefix (never prompts for password). Includes BatchMode=yes and optional identity file."""
    cmd = ["sftp"]
    identity = (getattr(remote_connection, "identityFile", None) or "").strip()
    if identity:
        cmd.extend(["-F", os.devnull])
    cmd.extend(["-o", "BatchMode=yes", "-o", "PasswordAuthentication=no"])
    if identity:
        cmd.extend(["-o", "IdentitiesOnly=yes", "-i", identity])
    if remote_connection.port != 22:
        cmd.extend(["-P", str(remote_connection.port)])
    cmd.extend(["-b", "-", f"{remote_connection.username}@{remote_connection.host}"])
    return cmd


def _scp_cmd_prefix(remote_connection: RemoteConnection) -> List[str]:
    """Build scp command prefix (never prompts for password). Mirrors ssh/sftp options.

    `-O` forces the legacy SCP/rcp transfer protocol. OpenSSH 9+ defaults scp to
    the SFTP subsystem, which is exactly the subsystem that's unavailable on the
    hosts this fallback targets; `-O` transfers over a plain remote exec instead.
    """
    cmd = ["scp", "-O"]
    identity = (getattr(remote_connection, "identityFile", None) or "").strip()
    if identity:
        cmd.extend(["-F", os.devnull])
    cmd.extend(["-o", "BatchMode=yes", "-o", "PasswordAuthentication=no"])
    if identity:
        cmd.extend(["-o", "IdentitiesOnly=yes", "-i", identity])
    if remote_connection.port != 22:
        cmd.extend(["-P", str(remote_connection.port)])
    return cmd


def handle_ssh_subprocess_error(
    e: subprocess.CalledProcessError, remote_connection: RemoteConnection
) -> NoReturn:
    """
    Convert subprocess SSH errors to appropriate exceptions with clear messages.

    Always raises (`NoReturn`); the type checker now treats every line after
    a call to this helper as unreachable, which keeps the call sites tidy
    and prevents accidental fall-through.
    """
    raw_error = (e.stderr or "").strip() or "No stderr output"
    logger.warning(
        f"SSH error for {remote_connection.username}@{remote_connection.host}: {raw_error}"
    )
    raise_for_ssh_subprocess_error(e, remote_connection)


def start_background_task(task, *args):
    with current_app.app_context():
        if current_app.config["USE_WEBSOCKETS"]:
            with current_app.app_context():
                # Use SocketIO's background task mechanism if available
                from ttnn_visualizer.extensions import socketio

                socketio.start_background_task(task, *args)
        else:
            # Use a basic thread if WebSockets are not enabled
            thread = Thread(target=task, args=args)
            thread.start()


def resolve_file_path(remote_connection, file_path: str) -> str:
    """
    Resolve the file path if it contains a wildcard ('*') by using glob on the remote machine.

    :param remote_connection: A RemoteConnection object containing the remote connection information.
    :param file_path: The file path, which may include wildcards.
    :return: The resolved file path.
    :raises FileNotFoundError: If no files match the pattern.
    """
    if "*" in file_path:
        # Build SSH command to list files matching the pattern (never prompts for password)
        ssh_cmd = _ssh_cmd_prefix(remote_connection) + [f"ls -1 '{file_path}'"]

        try:
            result = subprocess.run(
                ssh_cmd,
                capture_output=True,
                text=True,
                check=True,
                timeout=_ssh_subprocess_timeout_seconds(),
            )

            files = result.stdout.strip().splitlines()

            if not files or (len(files) == 1 and files[0] == ""):
                raise FileNotFoundError(f"No files found matching pattern: {file_path}")

            # Return the first file found
            return files[0]

        except subprocess.CalledProcessError as e:
            logger.error(f"SSH command failed: {e}")
            logger.error(f"stderr: {e.stderr}")

            # Check if it's an SSH-specific error (authentication, connection, etc.)
            if e.returncode == 255:  # SSH returns 255 for SSH protocol errors
                handle_ssh_subprocess_error(e, remote_connection)
            else:
                # File not found or other command error
                raise FileNotFoundError(f"No files found matching pattern: {file_path}")
        except Exception as e:
            logger.error(f"Error resolving file path: {e}")
            raise FileNotFoundError(f"Error resolving file path: {file_path}")

    return file_path


def get_cluster_desc(instance: Instance, logical_rank: int = 0):
    if not instance.profiler_path:
        return None
    report_path = Path(instance.profiler_path).parent
    cluster_path, _err = pick_cluster_descriptor_path(report_path, logical_rank)
    if cluster_path is None:
        return None

    with open(cluster_path, "r", encoding="utf-8") as cluster_desc_file:
        return yaml.safe_load(cluster_desc_file)


def is_excluded(file_path, exclude_patterns):
    """Check if a file path should be excluded based on patterns."""
    for pattern in exclude_patterns:
        if pattern in file_path:
            return True
    return False


def _is_unsupported_printf_error(stderr: str) -> bool:
    """True when stderr looks like a find variant rejecting `-printf`.

    Covers the messages seen from BSD find (macOS, FreeBSD) and busybox
    find. We deliberately match the literal `-printf` token plus an
    "unknown"/"unrecognized" signal so that ordinary failures (permission
    denied, path not found, etc.) do not silently downgrade to the
    size-less fallback.
    """
    lowered = stderr.lower()
    if "-printf" not in lowered:
        return False
    return any(
        marker in lowered
        for marker in ("unknown", "unrecognized", "not supported", "illegal option")
    )


@remote_exception_handler
def sync_files_and_directories(
    remote_connection: RemoteConnection,
    remote_profiler_folder: str,
    destination_dir: Path,
    exclude_patterns=None,
    sid=None,
) -> SyncMethod:
    """Download files and directories using SFTP with progress reporting.

    Returns the transport actually used (``sftp``, or ``scp`` when the remote
    SFTP subsystem was unavailable and we fell back).
    """
    exclude_patterns = exclude_patterns or []

    # Ensure the destination directory exists
    destination_dir.mkdir(parents=True, exist_ok=True)

    logger.info(
        f"Starting SFTP sync from {remote_profiler_folder} to {destination_dir}"
    )

    # First, get list of all files and directories
    logger.info("Getting remote file and directory lists...")
    all_files = get_remote_file_list(
        remote_connection, remote_profiler_folder, exclude_patterns
    )
    all_dirs = get_remote_directory_list(
        remote_connection, remote_profiler_folder, exclude_patterns
    )

    logger.info(f"Found {len(all_files)} files and {len(all_dirs)} directories to sync")

    # `find -type d` on an existing readable folder always returns at least
    # the folder itself, so an empty dir list is the unambiguous "listing
    # failed" signal (permission denied, missing path, SSH downgrade to
    # fallback after a real error, etc.). Surface it as a real error rather
    # than letting the loop fall through to a misleading "0 files synced"
    # FINISHED. The list helpers already log the underlying stderr.
    if not all_dirs:
        if current_app.config["USE_WEBSOCKETS"]:
            # Emit FAILED before raising so the overlay closes even if a
            # caller swallows the exception; flush ordering matters because
            # `emit_file_status` treats FAILED as terminal and bypasses the
            # debounce.
            emit_file_status(
                FileProgress(
                    current_file_name="",
                    number_of_files=0,
                    percent_of_current=0,
                    finished_files=0,
                    status=FileStatus.FAILED,
                ),
                sid,
            )
        # 422, not 500: the remote path is user-supplied input that the
        # server *could* talk to over SSH but cannot read at the requested
        # location. Matches the precedent set by `AuthenticationFailedException`.
        raise RemoteConnectionException(
            message=(
                f"Could not list remote folder {remote_profiler_folder!r}. "
                "Check that the path exists and is readable by the SSH user."
            ),
            status=ConnectionTestStates.FAILED,
            http_status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )

    # Create local directory structure
    logger.info("Creating local directory structure...")
    for remote_dir in all_dirs:
        try:
            # Calculate relative path from the base remote folder
            relative_path = Path(remote_dir).relative_to(remote_profiler_folder)
            local_dir = destination_dir / relative_path
            local_dir.mkdir(parents=True, exist_ok=True)
        except ValueError:
            # Skip if remote_dir is not relative to remote_profiler_folder
            continue

    # Download files with progress reporting.
    #
    # NOTE: byte progress is file-granular, not streaming. SFTP gives us no
    # per-chunk callback, so `bytes_transferred` jumps up only after each
    # full file completes; the UI may look idle between updates while a
    # large file is in flight (compounded by the 500ms debounce in
    # emit_file_status). Acceptable for v1 — streaming byte progress would
    # require Paramiko or rsync.
    total_files = len(all_files)
    total_bytes = sum(size for _, size in all_files)
    finished_files = 0
    failed_count = 0
    bytes_transferred = 0
    last_download_error: Optional[str] = None
    # Track the transport actually used this run rather than reading the
    # process-global fallback cache, so the reported method reflects *this*
    # sync (and this port), not a stale guess from a prior host.
    methods_used: set[SyncMethod] = set()

    logger.info(f"Starting download of {total_files} files...")

    # Skip all transfer-progress websocket emits when there's nothing to
    # download — STARTED is an *active* status on the client, so emitting it
    # for an empty folder would briefly open the overlay only to close it on
    # FINISHED below.
    should_emit_progress = current_app.config["USE_WEBSOCKETS"] and total_files > 0

    if should_emit_progress:
        emit_file_status(
            FileProgress(
                current_file_name="",
                number_of_files=total_files,
                percent_of_current=0,
                finished_files=0,
                bytes_transferred=0,
                bytes_total=total_bytes,
                current_file_size=0,
                status=FileStatus.STARTED,
            ),
            sid,
        )

    for remote_file, remote_file_size in all_files:
        try:
            # Calculate relative path from the base remote folder
            relative_path = Path(remote_file).relative_to(remote_profiler_folder)
            local_file = destination_dir / relative_path

            if should_emit_progress:
                emit_file_status(
                    FileProgress(
                        current_file_name=str(relative_path),
                        number_of_files=total_files,
                        percent_of_current=0,
                        finished_files=finished_files,
                        bytes_transferred=bytes_transferred,
                        bytes_total=total_bytes,
                        current_file_size=remote_file_size,
                        status=FileStatus.DOWNLOADING,
                    ),
                    sid,
                )

            # Download the file using SFTP (or scp fallback)
            methods_used.add(
                download_single_file_sftp(remote_connection, remote_file, local_file)
            )

            finished_files += 1
            bytes_transferred += remote_file_size

            # Emit progress
            progress = FileProgress(
                current_file_name=str(relative_path),
                number_of_files=total_files,
                percent_of_current=100,  # We don't get per-file progress with SFTP
                finished_files=finished_files,
                bytes_transferred=bytes_transferred,
                bytes_total=total_bytes,
                current_file_size=remote_file_size,
                status=FileStatus.DOWNLOADING,
            )

            if should_emit_progress:
                emit_file_status(progress, sid)

            if finished_files % 10 == 0:  # Log every 10 files
                logger.info(f"Downloaded {finished_files}/{total_files} files")

        except ValueError:
            # Skip if remote_file is not relative to remote_profiler_folder
            logger.warning(f"Skipping file outside base folder: {remote_file}")
            continue
        except (
            HostKeyVerificationException,
            AuthenticationException,
            NoValidConnectionsError,
            SSHException,
        ):
            # Fatal SSH errors must not be swallowed — the decorator maps host-key
            # and auth failures to actionable 422 responses; connectivity
            # (NoValidConnectionsError) surfaces as a 500.
            raise
        except Exception as e:
            last_download_error = f"{remote_file}: {e}"
            logger.error("Failed to download %s: %s", remote_file, e)
            failed_count += 1
            # Best-effort: try remaining files, but do not report success if any fail.
            continue

    # scp wins the label if any file needed the fallback; otherwise sftp.
    run_sync_method = (
        SyncMethod.SCP if SyncMethod.SCP in methods_used else SyncMethod.SFTP
    )

    sync_incomplete = total_files > 0 and finished_files < total_files
    if sync_incomplete:
        sync_method = run_sync_method
        logger.error(
            "%s sync incomplete: downloaded %s/%s files (%s failed). Last error: %s",
            sync_method.value,
            finished_files,
            total_files,
            failed_count,
            last_download_error or "unknown",
        )
        if current_app.config["USE_WEBSOCKETS"]:
            emit_file_status(
                FileProgress(
                    current_file_name="",
                    number_of_files=total_files,
                    percent_of_current=0,
                    finished_files=finished_files,
                    bytes_transferred=bytes_transferred,
                    bytes_total=total_bytes,
                    current_file_size=0,
                    status=FileStatus.FAILED,
                ),
                sid,
            )
        message = (
            f"Sync incomplete: downloaded {finished_files} of {total_files} "
            f"file(s) ({failed_count} failed) via {sync_method.value}."
        )
        if last_download_error:
            message = f"{message} Last error: {last_download_error}"
        raise RemoteConnectionException(
            message=message,
            status=ConnectionTestStates.FAILED,
            http_status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
            detail=last_download_error,
            sync_method=sync_method.value,
        )

    # Only stamp success after every queued file downloaded.
    update_last_synced(destination_dir)

    final_progress = FileProgress(
        current_file_name="",
        number_of_files=total_files,
        percent_of_current=100,
        finished_files=finished_files,
        bytes_transferred=bytes_transferred,
        bytes_total=total_bytes,
        current_file_size=0,
        status=FileStatus.FINISHED,
    )

    if should_emit_progress:
        emit_file_status(final_progress, sid)

    logger.info(
        "%s sync completed. Downloaded %s/%s files.",
        run_sync_method.value,
        finished_files,
        total_files,
    )
    return run_sync_method


def get_remote_file_list(
    remote_connection: RemoteConnection, remote_folder: str, exclude_patterns=None
) -> List[tuple[str, int]]:
    """Get a list of (path, size_bytes) for all files in the remote directory.

    Uses GNU find's -printf to fetch size and path in one SSH call; falls back
    to plain -type f (sizes = 0) if the remote find lacks -printf support.
    """
    exclude_patterns = exclude_patterns or []

    # GNU find: emit '<size>\t<path>\0' records. NUL terminator is illegal in
    # POSIX paths, so paths containing tabs/newlines round-trip safely; the
    # first '\t' in each record is the unambiguous separator between the
    # decimal size and the path. Falls back below if -printf is unsupported.
    quoted_folder = shlex.quote(remote_folder)
    ssh_cmd = _ssh_cmd_prefix(remote_connection) + [
        f"find {quoted_folder} -type f -printf '%s\\t%p\\0'",
    ]

    try:
        result = subprocess.run(
            ssh_cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=_ssh_subprocess_timeout_seconds(),
        )

        entries: List[tuple[str, int]] = []
        for record in result.stdout.split("\x00"):
            if not record:
                continue
            size_str, separator, path_str = record.partition("\t")
            if not separator or not path_str or is_excluded(path_str, exclude_patterns):
                continue
            try:
                size = int(size_str)
            except ValueError:
                size = 0
            entries.append((path_str, size))

        return entries

    except subprocess.CalledProcessError as e:
        if e.returncode == 255:  # SSH protocol errors
            handle_ssh_subprocess_error(e, remote_connection)  # always raises
        stderr = (e.stderr or "").strip()
        # Only fall back when stderr indicates the remote find lacks -printf
        # support (BSD/busybox find variants). Other non-255 failures
        # (permission denied, missing directory, etc.) must surface as an
        # empty list + error log instead of triggering a second SSH call
        # that would hide the real cause.
        if _is_unsupported_printf_error(stderr):
            logger.warning(
                "find -printf unsupported on remote (%s); retrying without size information.",
                stderr or "no stderr",
            )
            return _get_remote_file_list_without_sizes(
                remote_connection, remote_folder, exclude_patterns
            )
        logger.error(
            "Error getting file list from %s: %s",
            remote_folder,
            stderr or "no stderr",
        )
        return []
    except subprocess.TimeoutExpired:
        logger.error(f"Timeout getting file list from: {remote_folder}")
        return []
    except Exception as e:
        logger.error(f"Error getting file list: {e}")
        return []


def _get_remote_file_list_without_sizes(
    remote_connection: RemoteConnection,
    remote_folder: str,
    exclude_patterns: List[str],
) -> List[tuple[str, int]]:
    """Fallback when GNU find -printf is unavailable. Sizes default to 0."""
    quoted_folder = shlex.quote(remote_folder)
    ssh_cmd = _ssh_cmd_prefix(remote_connection) + [
        f"find {quoted_folder} -type f",
    ]
    try:
        result = subprocess.run(
            ssh_cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=_ssh_subprocess_timeout_seconds(),
        )
        entries: List[tuple[str, int]] = []
        for line in result.stdout.splitlines():
            path = line.strip()
            if not path or is_excluded(path, exclude_patterns):
                continue
            entries.append((path, 0))
        return entries
    except subprocess.CalledProcessError as e:
        if e.returncode == 255:  # SSH protocol errors
            handle_ssh_subprocess_error(e, remote_connection)  # always raises
        logger.error(f"Error getting file list: {e.stderr}")
        return []
    except Exception as e:
        logger.error(f"Error getting file list: {e}")
        return []


def get_remote_directory_list(
    remote_connection: RemoteConnection, remote_folder: str, exclude_patterns=None
) -> List[str]:
    """Get a list of all directories in the remote directory recursively, applying exclusion patterns."""
    exclude_patterns = exclude_patterns or []

    # Build SSH command to find all directories recursively (never prompts for password)
    quoted_folder = shlex.quote(remote_folder)
    ssh_cmd = _ssh_cmd_prefix(remote_connection) + [
        f"find {quoted_folder} -type d",
    ]

    try:
        result = subprocess.run(
            ssh_cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=_ssh_subprocess_timeout_seconds(),
        )

        all_dirs = result.stdout.strip().splitlines()

        # Filter out excluded directories
        filtered_dirs = []
        for dir_path in all_dirs:
            if not is_excluded(dir_path, exclude_patterns):
                filtered_dirs.append(dir_path.strip())

        return filtered_dirs

    except subprocess.CalledProcessError as e:
        if e.returncode == 255:  # SSH protocol errors
            handle_ssh_subprocess_error(e, remote_connection)  # always raises
        logger.error(f"Error getting directory list: {e.stderr}")
        return []
    except subprocess.TimeoutExpired:
        logger.error(f"Timeout getting directory list from: {remote_folder}")
        return []
    except Exception as e:
        logger.error(f"Error getting directory list: {e}")
        return []


def _scp_remote_target(remote_connection: RemoteConnection, remote_file: str) -> str:
    """Build scp remote target for argv (no shell quoting — subprocess passes it verbatim)."""
    return f"{remote_connection.username}@{remote_connection.host}:{remote_file}"


def download_single_file_scp(
    remote_connection: RemoteConnection, remote_file: str, local_file: Path
) -> SyncMethod:
    """Download a single file using scp (when the remote SFTP subsystem is disabled)."""
    local_file.parent.mkdir(parents=True, exist_ok=True)
    remote_spec = _scp_remote_target(remote_connection, remote_file)
    scp_cmd = _scp_cmd_prefix(remote_connection) + [remote_spec, str(local_file)]
    try:
        subprocess.run(
            scp_cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=300,
        )
        logger.debug("Downloaded via scp: %s -> %s", remote_file, local_file)
        return SyncMethod.SCP
    except subprocess.CalledProcessError as e:
        logger.error(
            "scp download failed for %s (rc=%s): %s",
            remote_file,
            e.returncode,
            (e.stderr or "").strip() or "no stderr",
        )
        if e.returncode == 255:
            handle_ssh_subprocess_error(e, remote_connection)  # always raises
        detail = (e.stderr or "").strip() or "no stderr"
        raise RuntimeError(f"Failed to download {remote_file}: {detail}")
    except subprocess.TimeoutExpired:
        logger.error("Timeout downloading file via scp: %s", remote_file)
        raise RuntimeError(f"Timeout downloading {remote_file}")


def download_single_file_sftp(
    remote_connection: RemoteConnection, remote_file: str, local_file: Path
) -> SyncMethod:
    """Download a single file using SFTP, falling back to scp when needed.

    Returns the transport actually used for this file.
    """
    transfer_key = _remote_transfer_key(remote_connection)
    if transfer_key in _sftp_subsystem_unavailable:
        return download_single_file_scp(remote_connection, remote_file, local_file)

    local_file.parent.mkdir(parents=True, exist_ok=True)
    sftp_cmd = _sftp_cmd_prefix(remote_connection)
    # Batch script is parsed by sftp, not the shell — quote paths for spaces/special chars.
    sftp_commands = (
        f"get {shlex.quote(remote_file)} {shlex.quote(str(local_file))}\nquit\n"
    )

    try:
        subprocess.run(
            sftp_cmd,
            input=sftp_commands,
            capture_output=True,
            text=True,
            check=True,
            timeout=300,  # 5 minute timeout per file
        )
        logger.debug("Downloaded via sftp: %s -> %s", remote_file, local_file)
        return SyncMethod.SFTP

    except subprocess.CalledProcessError as e:
        stderr = e.stderr or ""
        if _is_sftp_subsystem_unavailable(stderr):
            logger.warning(
                "SFTP subsystem unavailable on %s@%s:%s; using scp for remaining files",
                remote_connection.username,
                remote_connection.host,
                remote_connection.port,
            )
            _sftp_subsystem_unavailable.add(transfer_key)
            return download_single_file_scp(remote_connection, remote_file, local_file)
        logger.error(
            "Error downloading file %s (rc=%s): %s",
            remote_file,
            e.returncode,
            stderr.strip() or "no stderr",
        )
        if e.returncode == 255:  # SSH protocol errors
            handle_ssh_subprocess_error(e, remote_connection)  # always raises
        detail = stderr.strip() or "no stderr"
        raise RuntimeError(f"Failed to download {remote_file}: {detail}")
    except subprocess.TimeoutExpired:
        logger.error("Timeout downloading file: %s", remote_file)
        raise RuntimeError(f"Timeout downloading {remote_file}")
    except Exception as e:
        logger.error(
            "Error downloading file %s: %s: %s",
            remote_file,
            type(e).__name__,
            e,
        )
        raise RuntimeError(f"Failed to download {remote_file}: {type(e).__name__}: {e}")


def get_remote_profiler_folder_from_config_path(
    remote_connection: RemoteConnection, config_path: str
) -> RemoteReportFolder:
    """Read a remote config file and return RemoteFolder object."""
    folder_path = Path(config_path).parent
    parent_folder_name = folder_path.name
    folder_str = str(folder_path).rstrip("/")
    ssh_timeout = _ssh_subprocess_timeout_seconds()
    check_timeout = _ssh_remote_check_timeout_seconds()

    def ssh_run_checked(cmd: List[str]) -> subprocess.CompletedProcess:
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=ssh_timeout,
        )

    def ssh_stat_mtime(path: str) -> int:
        stat_cmd = _ssh_cmd_prefix(remote_connection) + [
            "stat",
            "-c",
            "%Y",
            path,
        ]
        stat_result = ssh_run_checked(stat_cmd)
        return int(float(stat_result.stdout.strip()))

    def ssh_cat(path: str) -> str:
        cat_cmd = _ssh_cmd_prefix(remote_connection) + ["cat", path]
        cat_result = ssh_run_checked(cat_cmd)
        return cat_result.stdout

    def ssh_test_file(path: str) -> bool:
        test_cmd = _ssh_cmd_prefix(remote_connection) + ["test", "-f", path]
        result = subprocess.run(
            test_cmd,
            capture_output=True,
            text=True,
            timeout=check_timeout,
        )
        return result.returncode == 0

    def ssh_list_ranked_config_paths() -> List[str]:
        # One argv after user@host: OpenSSH may wrap multi-arg remote commands in
        # `sh -c` on the server and break `for ...; do ...; done`. Pass a single
        # `bash -lc '<script>'` string instead. Use find so the script has no
        # shell loop syntax.
        inner = (
            f"find {shlex.quote(folder_str)} -maxdepth 1 "
            "-name 'config_*_of_*.json' -print"
        )
        remote_cmd = "bash -lc " + shlex.quote(inner)
        list_cmd = _ssh_cmd_prefix(remote_connection) + [remote_cmd]
        result = subprocess.run(
            list_cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=ssh_timeout,
        )
        lines = [ln.strip() for ln in result.stdout.splitlines() if ln.strip()]
        by_base = {Path(l).name: l for l in lines}
        ordered = ranked_profiler_config_basenames(by_base.keys())
        return [by_base[n] for n in ordered]

    try:
        single_config = str(Path(config_path))  # .../config.json from caller
        read_path: Optional[str] = None
        mtime_paths: List[str] = []

        if ssh_test_file(single_config):
            read_path = single_config
            mtime_paths = [single_config]
        else:
            ranked_paths = ssh_list_ranked_config_paths()
            if ranked_paths:
                read_path = ranked_paths[0]
                mtime_paths = ranked_paths

        if read_path is None:
            return RemoteReportFolder(
                remotePath=folder_str,
                reportName=parent_folder_name,
                lastModified=int(time.time()),
            )

        last_modified = max(ssh_stat_mtime(p) for p in mtime_paths)
        raw_json = ssh_cat(read_path)
        data = json.loads(raw_json)
        report_name = data.get("report_name") if isinstance(data, dict) else None

        return RemoteReportFolder(
            remotePath=folder_str,
            reportName=report_name,
            lastModified=last_modified,
        )

    except subprocess.CalledProcessError as e:
        logger.error(f"SSH command failed while reading config: {e}")
        logger.error(f"stderr: {e.stderr}")

        if e.returncode == 255:  # SSH returns 255 for SSH protocol errors
            handle_ssh_subprocess_error(e, remote_connection)
        # Fall back to current time if we can't get modification time.
        return RemoteReportFolder(
            remotePath=folder_str,
            reportName=parent_folder_name,
            lastModified=int(time.time()),
        )
    except (json.JSONDecodeError, ValueError) as e:
        logger.error(f"Error parsing config file {config_path}: {e}")
        # Fall back to current time and no report name
        return RemoteReportFolder(
            remotePath=folder_str,
            reportName=parent_folder_name,
            lastModified=int(time.time()),
        )


def get_remote_performance_folder(
    remote_connection: RemoteConnection, profile_folder: str
) -> RemoteReportFolder:
    """Get remote performance folder info and return RemoteFolder object."""
    performance_name = profile_folder.split("/")[-1]
    remote_path = profile_folder

    # Get modification time using subprocess SSH command
    try:
        ssh_command = _ssh_cmd_prefix(remote_connection) + [
            f"stat -c %Y '{profile_folder}'",
        ]

        result = subprocess.run(
            ssh_command,
            capture_output=True,
            text=True,
            timeout=_ssh_subprocess_timeout_seconds(),
        )

        if result.returncode == 0:
            last_modified = int(result.stdout.strip())
        else:
            # If stat fails, handle SSH errors
            if result.returncode == 255:
                handle_ssh_subprocess_error(
                    subprocess.CalledProcessError(
                        result.returncode, ssh_command, result.stdout, result.stderr
                    ),
                    remote_connection,
                )
            logger.warning(
                f"Could not get modification time for {profile_folder}, using current time"
            )
            last_modified = int(time.time())
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError, ValueError) as e:
        logger.warning(
            f"Error getting modification time for {profile_folder}: {e}, using current time"
        )
        last_modified = int(time.time())

    return RemoteReportFolder(
        remotePath=str(remote_path),
        reportName=str(performance_name),
        lastModified=last_modified,
    )


@remote_exception_handler
def read_remote_file(
    remote_connection,
    remote_path=None,
):
    """Read a remote file using SSH cat command."""
    if remote_path:
        path = Path(remote_path)
    else:
        path = Path(remote_connection.profilerPath)

    ssh_client = SSHClient(remote_connection)
    return ssh_client.read_file(path, timeout=30)


@remote_exception_handler
def check_remote_path_for_reports(remote_connection):
    remote_profiler_paths = []
    if remote_connection.profilerPath:
        remote_profiler_paths = find_folders_by_files(
            remote_connection, remote_connection.profilerPath, [TEST_DB_FILE]
        )
    else:
        logger.info("No profiler path configured; skipping check")

    remote_performance_paths = []
    if remote_connection.performancePath:
        remote_performance_paths = find_folders_by_files(
            remote_connection, remote_connection.performancePath, [TEST_PROFILER_FILE]
        )
    else:
        logger.info("No performance path configured; skipping check")

    errors = []
    if not remote_profiler_paths and remote_connection.profilerPath:
        errors.append(f"Profiler folder path: {remote_connection.profilerPath}")
    if not remote_performance_paths and remote_connection.performancePath:
        errors.append(f"Performance folder path: {remote_connection.performancePath}")

    if errors:
        raise NoReportsException(
            message="; ".join(errors),
            status=ConnectionTestStates.WARNING,
        )

    return True


@remote_exception_handler
def check_remote_path_exists(remote_connection: RemoteConnection, path_key: str):
    """Check if a remote path exists using SSH test command."""
    path = getattr(remote_connection, path_key)

    ssh_client = SSHClient(remote_connection)

    try:
        if ssh_client.check_path_exists(path, timeout=10):
            return True
        else:
            # Directory does not exist or is inaccessible
            if path_key == "performancePath":
                message = "Performance directory does not exist or cannot be accessed"
            if path_key == "profilerPath":
                message = "Profiler directory does not exist or cannot be accessed"
            else:
                message = f"Remote path '{path}' does not exist or cannot be accessed"

            logger.error(message)
            raise RemoteConnectionException(
                message=message, status=ConnectionTestStates.FAILED
            )
    except SSHException as e:
        logger.error(f"Error checking remote path: {path}")
        raise RemoteConnectionException(
            message=f"Error checking remote path: {path}: {str(e)}",
            status=ConnectionTestStates.FAILED,
        )


def find_folders_by_files(
    remote_connection: RemoteConnection, root_folder: str, file_names: List[str]
) -> List[str]:
    """Given a remote path, return a list of top-level folders that contain any of the specified files."""
    if not root_folder:
        return []

    matched_folders: List[str] = []

    # Build SSH command to find directories in root_folder (never prompts for password)
    ssh_cmd = _ssh_cmd_prefix(remote_connection) + [
        f"find '{root_folder}' -maxdepth 1 -type d -not -path '{root_folder}'",
    ]

    try:
        result = subprocess.run(
            ssh_cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=_ssh_subprocess_timeout_seconds(),
        )

        directories = result.stdout.strip().splitlines()

        # For each directory, check if it contains any of the specified files
        for directory in directories:
            directory = directory.strip()
            if not directory:
                continue

            # Build SSH command to check for files in this directory
            file_checks = [
                f"test -f '{directory}/{file_name}'" for file_name in file_names
            ]
            check_cmd = _ssh_cmd_prefix(remote_connection) + [
                f"({' || '.join(file_checks)})",
            ]

            try:
                check_result = subprocess.run(
                    check_cmd,
                    capture_output=True,
                    check=True,
                    timeout=_ssh_remote_check_timeout_seconds(),
                )
                # If command succeeds, at least one file exists
                matched_folders.append(directory)
            except subprocess.CalledProcessError:
                # None of the files exist in this directory, skip it
                continue

        return matched_folders

    except subprocess.CalledProcessError as e:
        if e.returncode == 255:  # SSH protocol errors
            handle_ssh_subprocess_error(e, remote_connection)
        stderr = e.stderr.lower() if e.stderr else ""
        if "permission denied" in stderr:
            error_msg = (
                f"Permission denied accessing '{root_folder}'. "
                f"The user '{remote_connection.username}' does not have read access to this directory. "
                "Please check directory permissions on the remote server or choose a different path."
            )
            logger.error(f"Error finding folders: {e.stderr}")
            raise RemoteConnectionException(
                message=error_msg,
                status=ConnectionTestStates.FAILED,
                detail=e.stderr.strip() if e.stderr else None,
            )
        logger.error(f"Error finding folders: {e.stderr}")
        return []
    except subprocess.TimeoutExpired:
        logger.error(f"Timeout finding folders in: {root_folder}")
        return []
    except Exception as e:
        logger.error(f"Error finding folders: {e}")
        return []


@remote_exception_handler
def get_remote_performance_folders(
    remote_connection: RemoteConnection,
) -> List[RemoteReportFolder]:
    """Return a list of remote folders containing a profile_log_device file."""
    performance_paths = []

    if remote_connection.performancePath:
        performance_paths = find_folders_by_files(
            remote_connection, remote_connection.performancePath, [TEST_PROFILER_FILE]
        )
    else:
        logger.info("No performance path configured for this connection")
        return []

    if not performance_paths:
        logger.info(
            "No performance reports found under path: %s",
            remote_connection.performancePath,
        )
        return []

    remote_folder_data = []
    for path in performance_paths:
        remote_folder_data.append(
            get_remote_performance_folder(remote_connection, path)
        )

    return sorted(remote_folder_data, key=lambda x: x.lastModified, reverse=True)


@remote_exception_handler
def get_remote_profiler_folders(
    remote_connection: RemoteConnection,
) -> List[RemoteReportFolder]:
    """Return a list of remote folders containing a db.sqlite file."""
    profiler_paths = []

    if remote_connection.profilerPath:
        profiler_paths = find_folders_by_files(
            remote_connection, remote_connection.profilerPath, [TEST_DB_FILE]
        )
    else:
        logger.info("No profiler path configured for this connection")
        return []

    if not profiler_paths:
        logger.info(
            "No profiler reports found under path: %s",
            remote_connection.profilerPath,
        )
        return []

    remote_folder_data = []
    for path in profiler_paths:
        remote_folder = get_remote_profiler_folder_from_config_path(
            remote_connection, str(Path(path).joinpath(TEST_CONFIG_FILE))
        )
        remote_folder_data.append(remote_folder)

    return sorted(remote_folder_data, key=lambda x: x.lastModified, reverse=True)


@remote_exception_handler
def sync_remote_profiler_folders(
    remote_connection: RemoteConnection,
    remote_folder_path: str,
    path_prefix: str,
    exclude_patterns: Optional[List[str]] = None,
    sid=None,
) -> SyncMethod:
    """Main function to sync test folders, handles both compressed and individual syncs."""
    profiler_folder = Path(remote_folder_path).name
    destination_dir = Path(
        current_app.config["REPORT_DATA_DIRECTORY"],
        path_prefix,
        remote_connection.host,
        current_app.config["PROFILER_DIRECTORY_NAME"],
        profiler_folder,
    )
    destination_dir.mkdir(parents=True, exist_ok=True)

    return sync_files_and_directories(
        remote_connection, remote_folder_path, destination_dir, exclude_patterns, sid
    )


@remote_exception_handler
def sync_remote_performance_folders(
    remote_connection: RemoteConnection,
    path_prefix: str,
    performance: RemoteReportFolder,
    exclude_patterns: Optional[List[str]] = None,
    sid=None,
) -> SyncMethod:
    remote_folder_path = performance.remotePath
    profile_folder = Path(remote_folder_path).name
    destination_dir = Path(
        current_app.config["REPORT_DATA_DIRECTORY"],
        path_prefix,
        remote_connection.host,
        current_app.config["PERFORMANCE_DIRECTORY_NAME"],
        profile_folder,
    )
    destination_dir.mkdir(parents=True, exist_ok=True)
    return sync_files_and_directories(
        remote_connection, remote_folder_path, destination_dir, exclude_patterns, sid
    )
