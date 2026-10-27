# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Reading an operation's tensor signature from the performance CSV (#2155).

`diff_reports` finds a row's signature by the CSV position its report id names, so a
signature read from the wrong row would compare one operation's time under another's
tensors without any sign of it.
"""

import io

import pandas as pd
import pytest
from ttnn_visualizer.agent.op_signatures import read_signatures
from ttnn_visualizer.exceptions import DataFormatError

OLDER_HEADER = (
    "OP CODE,INPUT_0_W,INPUT_0_Z,INPUT_0_Y,INPUT_0_X,INPUT_0_LAYOUT,INPUT_0_DATATYPE,"
    "INPUT_0_MEMORY,INPUT_1_W,INPUT_1_Z,INPUT_1_Y,INPUT_1_X,INPUT_1_LAYOUT,"
    "INPUT_1_DATATYPE,INPUT_1_MEMORY,OUTPUT_0_W,OUTPUT_0_Z,OUTPUT_0_Y,OUTPUT_0_X,"
    "OUTPUT_0_LAYOUT,OUTPUT_0_DATATYPE,OUTPUT_0_MEMORY"
)
NEWER_HEADER = (
    "OP CODE,INPUT_0_W_PAD[LOGICAL],INPUT_0_Z_PAD[LOGICAL],INPUT_0_Y_PAD[LOGICAL],"
    "INPUT_0_X_PAD[LOGICAL],INPUT_0_LAYOUT,INPUT_0_DATATYPE,INPUT_0_MEMORY,"
    "OUTPUT_0_W_PAD[LOGICAL],OUTPUT_0_Z_PAD[LOGICAL],OUTPUT_0_Y_PAD[LOGICAL],"
    "OUTPUT_0_X_PAD[LOGICAL],OUTPUT_0_LAYOUT,OUTPUT_0_DATATYPE,OUTPUT_0_MEMORY"
)


def _signatures(*lines):
    return read_signatures(io.StringIO("\n".join(lines) + "\n")).by_position


def test_an_older_capture_names_each_tensor_in_order():
    (signature,) = _signatures(
        OLDER_HEADER,
        "Matmul,1,1,32,4096,TILE,BFLOAT16,DEV_0_L1_WIDTH_SHARDED,"
        "1,1,4096,1024,TILE,BFLOAT8_B,DEV_0_DRAM_INTERLEAVED,"
        "1,1,32,1024,TILE,BFLOAT16,DEV_0_L1_WIDTH_SHARDED",
    )

    assert signature == (
        "in0 1x1x32x4096 TILE BFLOAT16 L1_WIDTH_SHARDED; "
        "in1 1x1x4096x1024 TILE BFLOAT8_B DRAM_INTERLEAVED; "
        "out0 1x1x32x1024 TILE BFLOAT16 L1_WIDTH_SHARDED"
    )


def test_a_newer_capture_keeps_only_the_padding_that_differs():
    """`384[384]` is one size, but `32[1]` is a tile-padded 1, not a 32."""
    (signature,) = _signatures(
        NEWER_HEADER,
        "LayerNorm,8[8],1[1],32[1],768[768],TILE,BFLOAT16,DEV_1_DRAM_INTERLEAVED,"
        "8[8],1[1],32[32],768[768],TILE,BFLOAT16,DEV_1_L1_BLOCK_SHARDED",
    )

    assert signature == (
        "in0 8x1x32[1]x768 TILE BFLOAT16 DRAM_INTERLEAVED; "
        "out0 8x1x32x768 TILE BFLOAT16 L1_BLOCK_SHARDED"
    )


def test_the_same_tensors_on_two_devices_read_the_same():
    """A mesh writes each device's copy of an operation with its own `DEV_n_`."""
    first, second = _signatures(
        NEWER_HEADER,
        "Add,1[1],1[1],32[32],32[32],TILE,BFLOAT16,DEV_0_L1_INTERLEAVED,"
        "1[1],1[1],32[32],32[32],TILE,BFLOAT16,DEV_0_L1_INTERLEAVED",
        "Add,1[1],1[1],32[32],32[32],TILE,BFLOAT16,DEV_7_L1_INTERLEAVED,"
        "1[1],1[1],32[32],32[32],TILE,BFLOAT16,DEV_7_L1_INTERLEAVED",
    )

    assert first == second
    assert "DEV_" not in first


def test_an_unused_position_is_left_out_and_a_row_with_none_has_no_signature():
    unary, host = _signatures(
        OLDER_HEADER,
        "Relu,1,1,32,32,TILE,BFLOAT16,DEV_0_L1_INTERLEAVED,,,,,,,,"
        "1,1,32,32,TILE,BFLOAT16,DEV_0_L1_INTERLEAVED",
        "(torch) contiguous" + "," * OLDER_HEADER.count(","),
    )

    assert unary == (
        "in0 1x1x32x32 TILE BFLOAT16 L1_INTERLEAVED; "
        "out0 1x1x32x32 TILE BFLOAT16 L1_INTERLEAVED"
    )
    assert host is None


def test_rows_are_numbered_as_the_report_numbers_them():
    """tt-perf-report numbers a report row by its pandas index: an empty or a
    whitespace-only line is no row, and a quoted newline does not start one."""
    text = "\n".join(
        [
            OLDER_HEADER,
            "A,1,1,1,1,TILE,BFLOAT16,DEV_0_L1_INTERLEAVED" + "," * 14,
            "",
            '"B\nwith a newline",1,1,2,2,TILE,BFLOAT16,DEV_0_L1_INTERLEAVED' + "," * 14,
            " \t ",
            "C,1,1,3,3,TILE,BFLOAT16,DEV_0_L1_INTERLEAVED" + "," * 14,
        ]
    )

    signatures = read_signatures(io.StringIO(text)).by_position
    rows = pd.read_csv(io.StringIO(text), low_memory=False)

    assert len(signatures) == len(rows) == 3
    assert [signature.split()[1] for signature in signatures] == [
        "1x1x1x1",
        "1x1x2x2",
        "1x1x3x3",
    ]


def test_it_says_whether_sizes_are_recorded_as_padded_and_logical():
    """Older captures record a tile-padded size alone, so their signatures differ."""
    older = read_signatures(io.StringIO(OLDER_HEADER + "\n"))
    newer = read_signatures(io.StringIO(NEWER_HEADER + "\n"))

    assert (older.logical_sizes, newer.logical_sizes) == (False, True)


def test_a_csv_without_tensor_columns_has_no_signatures():
    header = "OP CODE,DEVICE KERNEL DURATION [ns]"

    assert read_signatures(io.StringIO(header + "\nMatmul,100\n")) is None


def test_a_repeated_signature_is_held_once():
    """A model repeats each signature once per layer, and every capture is kept."""
    row = "Add,1,1,32,32,TILE,BFLOAT16,DEV_0_L1_INTERLEAVED" + "," * 14
    first, second = _signatures(OLDER_HEADER, row, row)

    assert first is second


def test_an_unreadable_csv_is_a_data_format_error():
    undecodable = io.TextIOWrapper(
        io.BytesIO(OLDER_HEADER.encode() + b"\nMatmul,\xff\xfe\n"), encoding="utf-8"
    )

    with pytest.raises(DataFormatError, match="could not be read"):
        read_signatures(undecodable)
