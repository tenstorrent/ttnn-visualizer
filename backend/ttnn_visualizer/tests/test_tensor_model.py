# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""How `Tensor` settles its buffer type from the stored column and memory config.

tt-metal writes `buffer_type` as `0` for every tensor without an address, so the
column is only trusted beside one.
"""

import pytest
from ttnn_visualizer.models import BufferType, Tensor

_DECLARES_L1 = (
    "MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED,"
    "buffer_type=BufferType::L1,shard_spec=std::nullopt)"
)
_DECLARES_UNKNOWN = (
    "MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED,"
    "buffer_type=BufferType::FOO,shard_spec=std::nullopt)"
)


def _tensor(address, buffer_type, memory_config):
    return Tensor(
        1, "(1,)", "bfloat16", "TILE", memory_config, 0, address, buffer_type, []
    )


def test_an_address_of_zero_still_counts_as_an_address():
    """The guard is `is None`, so a tensor at address 0 keeps its column."""
    assert _tensor(0, 0, _DECLARES_L1).buffer_type is BufferType.DRAM


def test_an_unknown_declared_buffer_type_is_none():
    assert _tensor(None, 0, _DECLARES_UNKNOWN).buffer_type is None


@pytest.mark.parametrize("stored", [1, "L1", BufferType.L1])
def test_a_stored_buffer_type_is_coerced_whichever_form_it_takes(stored):
    assert _tensor(100, stored, None).buffer_type is BufferType.L1


@pytest.mark.parametrize("stored", [99, "FOO"])
def test_an_unrecognised_stored_buffer_type_is_passed_through(stored):
    assert _tensor(100, stored, None).buffer_type == stored
