# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

from pathlib import Path
import logging
import re

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
    for file in files:
        current_file_name = str(file.filename)
        logger.info(f"Processing file: {current_file_name}")

        file_path = Path(current_file_name).name

        destination_file = Path(base_directory) / parent_folder_name / str(file_path)

        logger.info(f"Writing file to {destination_file}")

        # Create directory if it doesn't exist
        if not destination_file.parent.exists():
            logger.info(
                f"{destination_file.parent.name} does not exist. Creating directory"
            )
            destination_file.parent.mkdir(exist_ok=True, parents=True)

        file.save(destination_file)
