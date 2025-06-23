# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent Inc.

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

    for file in files:
        file_path = Path(file.filename)

        if file_path.name in required_files or (
            pattern and file_path.name.startswith(pattern)
        ):
            found_files.add(file_path.name)
            if not folder_name and len(file_path.parents) != 2:
                logger.warning(
                    f"File {file.filename} is not under a single parent folder."
                )
                return False

    missing_files = required_files - found_files
    if pattern and not any(name.startswith(pattern) for name in found_files):
        missing_files.add(f"{pattern}*")

    if missing_files:
        logger.warning(f"Missing required files: {', '.join(missing_files)}")
        return False

    return True


def extract_folder_name_from_files(files):
    """Extract the report name from the first file."""
    if not files:
        return None
    unsplit_name = str(files[0].filename)
    return unsplit_name.split("/")[0]

def extract_npe_name(files):
    if not files:
        return None

    return re.sub(r"\.(json|npeviz\.zst)$", "", files[0].filename)


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
        (_, temp_path) = tempfile.mkstemp()
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
        prefixed_folder_name = f"{prefix}{folder_name}"
        dest_path = Path(target_directory) / prefixed_folder_name / str(file.filename)
    else:
        prefixed_filename = f"{prefix}{file.filename}"
        dest_path = Path(target_directory) / prefixed_filename

    return dest_path
