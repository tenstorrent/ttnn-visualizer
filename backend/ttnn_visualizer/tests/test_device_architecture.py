# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The one architecture vocabulary the flags and the hardware counters share. #2371"""

from pathlib import Path

import pytest
from ttnn_visualizer.device_architecture import DeviceArchitecture, architecture_of
from ttnn_visualizer.tests.frontend_parity import typescript_enum_values

_DEFINITIONS = Path(__file__).resolve().parents[3] / "src" / "definitions"


def test_it_matches_the_frontends_copy():
    """The frontend's `UNKNOWN` is the empty string, which the reader skips."""
    assert typescript_enum_values(
        _DEFINITIONS / "DeviceArchitecture.ts", "DeviceArchitecture"
    ) == {member.value for member in DeviceArchitecture if member.value}


@pytest.mark.parametrize(
    ("name", "architecture"),
    [
        ("wormhole_b0", DeviceArchitecture.WORMHOLE),
        ("blackhole", DeviceArchitecture.BLACKHOLE),
        ("Blackhole", DeviceArchitecture.BLACKHOLE),
        ("quasar", DeviceArchitecture.QUASAR),
        ("grayskull", DeviceArchitecture.GRAYSKULL),
        ("horizon", DeviceArchitecture.UNKNOWN),
        ("", DeviceArchitecture.UNKNOWN),
        (None, DeviceArchitecture.UNKNOWN),
        (7, DeviceArchitecture.UNKNOWN),
    ],
)
def test_the_device_logs_arch_names_an_architecture(name, architecture):
    assert architecture_of(name) is architecture


def test_wormhole_is_spelled_as_the_device_log_spells_it():
    assert DeviceArchitecture.WORMHOLE.value == "wormhole_b0"
