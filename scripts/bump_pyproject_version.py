# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from pathlib import Path

import toml


# Load pyproject.toml

pyproject_file = (
    Path(__file__).parent.parent.resolve().joinpath("pyproject.toml").resolve()
)


with open(pyproject_file, "r") as f:
    pyproject = toml.load(f)


# Extract the current version
version = pyproject["project"]["version"]
major, minor, patch = map(int, version.split("."))

# Increment the patch version (you can customize this)
patch += 1

new_version = f"{major}.{minor}.{patch}"


# Update the version
pyproject["project"]["version"] = new_version

# Write back to pyproject.toml
with open(pyproject_file, "w") as f:
    toml.dump(pyproject, f)

print(f"Bumped version to {new_version}")
