# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""A file's identity on disk, which a cache or a handle pins its reads to."""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Union


@dataclass(frozen=True)
class FileSource:
    """Rewritten in place or replaced, a file is another source."""

    path: str
    modified_ns: int
    changed_ns: int
    inode: int
    size: int

    @classmethod
    def of(cls, path: str, found: os.stat_result) -> "FileSource":
        return cls(
            path, found.st_mtime_ns, found.st_ctime_ns, found.st_ino, found.st_size
        )

    @classmethod
    def at(cls, path: Union[str, Path]) -> "FileSource":
        """The file `path` resolves to, as it is now; OSError if it can't be stat'ed."""
        resolved = Path(path).resolve()
        return cls.of(str(resolved), resolved.stat())
