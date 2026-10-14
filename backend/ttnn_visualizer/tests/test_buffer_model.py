# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import pytest
from ttnn_visualizer.models import Buffer, BufferType


def _buffer(buffer_type) -> Buffer:
    return Buffer(
        operation_id=1,
        device_id=0,
        address=100,
        max_size_per_bank=256,
        buffer_type=buffer_type,
    )


# A buffer whose type stays text never matches its tensor, whose type is
# always coerced, so the frontend loses every tensor in such a report.
@pytest.mark.parametrize(
    ("stored", "expected"),
    [
        (1, BufferType.L1),
        ("L1", BufferType.L1),
        ("L1_SMALL", BufferType.L1_SMALL),
        (BufferType.DRAM, BufferType.DRAM),
    ],
)
def test_a_stored_buffer_type_is_coerced_whichever_form_it_takes(stored, expected):
    assert _buffer(stored).buffer_type is expected


def test_a_text_buffer_type_serialises_as_the_tensors_does():
    assert _buffer("L1").to_dict()["buffer_type"] == BufferType.L1.value
