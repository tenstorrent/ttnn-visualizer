# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import logging
import os
import shlex
import shutil
import subprocess
import tempfile
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


def extract_profiler_name(files):
    """Extract the report name from the first file."""
    if not files:
        return None
    unsplit_profiler_name = str(files[0].filename)
    return unsplit_profiler_name.split("/")[0]

def extract_npe_name(files):
    if not files:
        return None

    file_path = Path(files[0].filename)
    return file_path.stem


def save_uploaded_files(
    files,
    target_directory,
    folder_name=None,
):
    """
    Save uploaded files to the target directory.

    :param files: List of files to be saved.
    :param target_directory: The base directory for saving the files.
    :param folder_name: The name to use for the directory.
    """
    for file in files:
        current_file_name = str(file.filename)
        logger.info(f"Processing file: {current_file_name}")

        file_path = Path(current_file_name)

        if folder_name:
            destination_file = Path(target_directory) / folder_name / str(file_path)
        else:
            destination_file = Path(target_directory) / str(file_path)

        if current_app.config["MALWARE_SCANNER"]:
            (_, temp_path) = tempfile.mkstemp()
            file.save(temp_path)

           # Run malware scanner
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
                    # No virus found, move file to final destination
                    if not destination_file.parent.exists():
                        destination_file.parent.mkdir(exist_ok=True, parents=True)

                    shutil.move(temp_path, destination_file)
                    logger.info(f"File scanned clean and saved to {destination_file}")
                else:
                    os.unlink(temp_path)
                    logger.warning(f"Malware scanner flagged file: {current_file_name}")
                    raise DataFormatError()
            except Exception as e:
                if os.path.exists(temp_path):
                    os.unlink(temp_path)
                raise
        else:
            logger.info(f"Writing file to {destination_file}")

            # Create directory if it doesn't exist
            if not destination_file.parent.exists():
                logger.info(
                    f"{destination_file.parent.name} does not exist. Creating directory"
                )
                destination_file.parent.mkdir(exist_ok=True, parents=True)

            file.save(destination_file)
