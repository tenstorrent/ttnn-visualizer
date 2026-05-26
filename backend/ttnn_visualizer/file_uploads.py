# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import logging
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from flask import current_app
from ttnn_visualizer.exceptions import DataFormatError

logger = logging.getLogger(__name__)


def validate_files(files, required_files, pattern=None, folder_name=None):
    """Validate uploaded files against required file names and an optional pattern."""
    found_files = set()
    leading_segments = set()

    for file in files:
        file_path = Path(file.filename)
        raw_name = str(file.filename)

        # Track the per-file leading folder segment for the cross-file
        # consistency check below. Bare basenames (no `/`) carry no segment
        # to compare and are skipped — `parents != 2` already rejects bare
        # *required* files in the inferred-folder branch.
        if "/" in raw_name:
            leading_segments.add(raw_name.split("/", 1)[0])

        if file_path.name in required_files or (
            pattern and file_path.name.startswith(pattern)
        ):
            found_files.add(file_path.name)
            if not folder_name and len(file_path.parents) != 2:
                logger.warning(
                    f"File {file.filename} is not under a single parent folder."
                )
                return False

    # When the destination folder is inferred from the files themselves
    # (Chromium / Firefox preserve `webkitRelativePath` in the multipart
    # filename), every file with a leading segment must agree on what that
    # segment is. Otherwise `resolve_parent_folder_name` infers from
    # `files[0]` and the dedup in `construct_dest_path` keys on that single
    # name, silently nesting any disagreeing files under the inferred folder
    # (e.g. `reportA/db.sqlite` + `reportB/config.json` would land as
    # `reportA/db.sqlite` + `reportA/reportB/config.json`).
    if not folder_name and len(leading_segments) > 1:
        logger.warning(
            "Uploaded files span multiple parent folders: %s",
            sorted(leading_segments),
        )
        return False

    missing_files = required_files - found_files
    if pattern and not any(name.startswith(pattern) for name in found_files):
        missing_files.add(f"{pattern}*")

    if missing_files:
        logger.warning(f"Missing required files: {', '.join(missing_files)}")
        return False

    return True


def _extract_folder_name_from_files(files):
    """Extract the report name from the first file's relative path.

    Module-private: the only call site is `resolve_parent_folder_name`, which
    is the public entry point for views to use. Folder-style upload handlers
    should always go through `resolve_parent_folder_name` so that the
    explicit-vs-inferred precedence stays consistent across endpoints.
    """
    if not files:
        return None
    unsplit_name = str(files[0].filename)
    return unsplit_name.split("/")[0]


def resolve_parent_folder_name(files, folder_name):
    """Pick the destination folder name for a folder-style upload.

    The frontend sends the report folder name in one of two ways:

    * As an explicit ``folderName`` form field (Safari, where the multipart
      filename is just the basename and the relative path is lost), or
    * Implicitly, as the leading segment of each file's relative path
      (Chromium / Firefox preserve `webkitRelativePath` in the multipart
      filename).

    Centralising this resolution keeps the two upload handlers aligned and
    avoids the easy mistake of passing the raw ``folder_name`` form field
    (which is ``None`` for non-Safari clients) straight through to
    `save_uploaded_files`, leaving files to land at the root of the target
    directory instead of under their report folder.
    """
    if folder_name:
        return folder_name
    return _extract_folder_name_from_files(files)


def extract_npe_name(files):
    if not files:
        return None

    # Strip directory components before stripping the extension so a crafted
    # multipart filename like `"../etc/passwd.json"` becomes `"passwd"`, not
    # `"../etc/passwd"`. The resulting name is written to the DB and later
    # rebuilt into a read path by `get_mlir_path` / `get_npe_path`; without
    # `.name` here, write-side hardening alone wouldn't fix the read path.
    return re.sub(r"\.(json|npeviz\.zst)$", "", Path(files[0].filename).name)


def save_uploaded_files(
    files,
    base_directory,
    parent_folder_name=None,
):
    """
    Save uploaded files to the target directory.

    :param files: List of files to be saved.
    :param base_directory: The base directory for saving the files.
    :param parent_folder_name: The name to use for the directory.
    """
    saved_paths = []

    if current_app.config["MALWARE_SCANNER"]:
        scanned_files = scan_uploaded_files(files, base_directory, parent_folder_name)

        for temp_path, dest_path in scanned_files:
            if not dest_path.parent.exists():
                dest_path.parent.mkdir(exist_ok=True, parents=True)

            logger.info(f"Saving uploaded file (clean): {dest_path}")

            shutil.move(temp_path, dest_path)
            saved_paths.append(dest_path)
    else:
        for file in files:
            dest_path = construct_dest_path(file, base_directory, parent_folder_name)
            logger.info(f"Writing file to {dest_path}")

            # Create directory if it doesn't exist
            if not dest_path.parent.exists():
                logger.info(
                    f"{dest_path.parent.name} does not exist. Creating directory"
                )
                dest_path.parent.mkdir(exist_ok=True, parents=True)

            logger.info(f"Saving uploaded file: {dest_path}")
            file.save(dest_path)
            saved_paths.append(dest_path)

    for saved_path in saved_paths:
        # Update the modified time of the parent directory (for sorting purposes)
        os.utime(saved_path.parent, None)

    # Update the modified time of the uploaded directory
    if parent_folder_name:
        uploaded_dir = Path(base_directory) / parent_folder_name
    else:
        uploaded_dir = Path(base_directory)

    if uploaded_dir.exists():
        os.utime(uploaded_dir, None)

    return saved_paths


def scan_uploaded_files(
    files,
    target_directory,
    folder_name=None,
):
    scanned_files = []

    for file in files:
        _, temp_path = tempfile.mkstemp()
        file.save(temp_path)
        dest_path = construct_dest_path(file, target_directory, folder_name)

        cmd_list = shlex.split(current_app.config["MALWARE_SCANNER"])
        cmd_list.append(temp_path)

        try:
            result = subprocess.run(
                cmd_list,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            if result.returncode == 0:
                scanned_files.append((temp_path, dest_path))
            else:
                os.unlink(temp_path)
                logger.warning(f"Malware scanner flagged file: {file.filename}")
                raise DataFormatError()
        except Exception as e:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise

    return scanned_files


def construct_dest_path(file, target_directory, folder_name):
    prefix = f"{int(time.time())}_" if current_app.config["SERVER_MODE"] else ""

    if folder_name:
        # Folder uploads legitimately carry sub-paths in `file.filename`
        # (e.g. `subdir/file.csv`) and `validate_files` / `os.utime` accounting
        # depend on that, so we can't just collapse to the basename the way
        # the single-file branch does. Instead, build the candidate path and
        # then assert a resolved-path containment check below.
        prefixed_folder_name = f"{prefix}{folder_name}"
        # Chromium-based browsers send each file's relative path as the
        # multipart filename (e.g. `report/db.sqlite`), while Safari sends just
        # the basename and the destination folder name as a separate form
        # field. Strip a duplicate leading segment so we land at
        # `target/report/db.sqlite` rather than `target/report/report/db.sqlite`.
        relative_filename = str(file.filename)
        head, sep, tail = relative_filename.partition("/")
        if sep and head == folder_name:
            relative_filename = tail
        report_root = Path(target_directory) / prefixed_folder_name
        dest_path = report_root / relative_filename

        # Defense against `../` (or absolute-path) traversal in the
        # client-supplied filename. The single-file branch hardens this by
        # collapsing to `Path(...).name`, which we can't do here because legit
        # folder uploads need their sub-paths preserved. Instead, resolve both
        # paths and require the destination to stay within the per-report
        # directory. `resolve(strict=False)` normalises `..` segments and (on
        # macOS) walks shared symlinks like `/tmp` -> `/private/tmp`, so the
        # comparison is symlink-stable.
        resolved_dest = dest_path.resolve(strict=False)
        resolved_root = report_root.resolve(strict=False)
        if not (
            resolved_dest == resolved_root
            or resolved_dest.is_relative_to(resolved_root)
        ):
            logger.warning(
                "Upload filename %r escapes report directory %s",
                str(file.filename),
                resolved_root,
            )
            raise DataFormatError(
                f"Upload filename {file.filename!r} escapes report directory"
            )
    else:
        # Single-file branch (NPE, MLIR): collapse the client-supplied
        # filename to its basename so `"../etc/passwd.json"` / `"/etc/x.json"`
        # can't escape `target_directory`. `Path(...).name` returns just the
        # last path component, mirroring what `werkzeug.utils.secure_filename`
        # does *without* mangling Unicode / spaces in legitimate filenames.
        prefixed_filename = f"{prefix}{Path(file.filename).name}"
        dest_path = Path(target_directory) / prefixed_filename

    return dest_path
