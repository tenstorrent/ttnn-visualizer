# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The architecture a device log names, as `src/definitions/DeviceArchitecture.ts` has
it, so that the agent's flags and the hardware counters spell it alike."""

from enum import Enum


class DeviceArchitecture(str, Enum):
    """`DeviceArchitecture` in `src/definitions/DeviceArchitecture.ts`."""

    UNKNOWN = ""
    GRAYSKULL = "grayskull"
    WORMHOLE = "wormhole_b0"
    BLACKHOLE = "blackhole"
    QUASAR = "quasar"
    GRENDEL = "grendel"


# `stringToArchitecture`'s prefixes, in the order it tries them.
_ARCHITECTURE_PREFIXES = (
    ("wormhole", DeviceArchitecture.WORMHOLE),
    ("blackhole", DeviceArchitecture.BLACKHOLE),
    ("quasar", DeviceArchitecture.QUASAR),
    ("grendel", DeviceArchitecture.GRENDEL),
    ("grayskull", DeviceArchitecture.GRAYSKULL),
)


def architecture_of(name: object) -> DeviceArchitecture:
    """`stringToArchitecture`: an architecture by its name's prefix, else unknown."""
    if not isinstance(name, str):
        return DeviceArchitecture.UNKNOWN
    lowered = name.lower()
    return next(
        (arch for prefix, arch in _ARCHITECTURE_PREFIXES if lowered.startswith(prefix)),
        DeviceArchitecture.UNKNOWN,
    )


__all__ = ["DeviceArchitecture", "architecture_of"]
