# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
SQL DDL constants representing historical TTNN report database schema versions.

Import these into tests to build SQLite fixture databases via the
``make_report`` fixture defined in conftest.py.  Each constant is a complete
DDL block — no data rows — so test data can be supplied independently
through the ``inserts_sql`` argument.

The ``SCHEMA_V*`` constants below are verbatim ``.schema`` dumps from
representative TTNN report databases, lightly normalised (12-space indent
collapsed to 4-space) for readability. To regenerate from a fresh
representative report::

    sqlite3 path/to/db.sqlite ".schema" \\
        | sed 's/^            /    /; s/^        );/);/'

Then paste the output into the corresponding triple-quoted string. A
provenance comment above each constant records which TTNN feature flag
shape produced it.
"""

# Source: TTNN profiler report from before stack-trace source-file storage
# was introduced (no ``source_files`` table; ``stack_traces`` has only
# ``operation_id`` and ``stack_trace`` columns).
SCHEMA_V2 = """
CREATE TABLE devices (
    device_id int,
    num_y_cores int,
    num_x_cores int,
    num_y_compute_cores int,
    num_x_compute_cores int,
    worker_l1_size int,
    l1_num_banks int,
    l1_bank_size int,
    address_at_first_l1_bank int,
    address_at_first_l1_cb_buffer int,
    num_banks_per_storage_core int,
    num_compute_cores int,
    num_storage_cores int,
    total_l1_memory int,
    total_l1_for_tensors int,
    total_l1_for_interleaved_buffers int,
    total_l1_for_sharded_buffers int,
    cb_limit int
);
CREATE TABLE operations (
    operation_id int UNIQUE,
    name text,
    duration float
);
CREATE TABLE operation_arguments (
    operation_id int,
    name text,
    value text
);
CREATE TABLE tensors (
    tensor_id int UNIQUE,
    shape text,
    dtype text,
    layout text,
    memory_config text,
    device_id int,
    address int,
    buffer_type int
);
CREATE TABLE device_tensors (
    tensor_id int,
    device_id int,
    address int
);
CREATE TABLE buffers (
    operation_id int,
    device_id int,
    address int,
    max_size_per_bank int,
    buffer_type int,
    buffer_layout int
);
CREATE TABLE captured_graph (
    operation_id int,
    captured_graph text
);
CREATE TABLE nodes (
    operation_id int,
    unique_id int,
    node_operation_id int,
    name text
);
CREATE TABLE edges (
    operation_id int,
    source_unique_id int,
    sink_unique_id int,
    source_output_index int,
    sink_input_index int,
    key int
);
CREATE TABLE report_metadata (
    key text UNIQUE,
    value text
);
CREATE TABLE errors (
    operation_id int,
    operation_name text,
    error_type text,
    error_message text,
    stack_trace text,
    timestamp text
);
CREATE TABLE stack_traces (
    operation_id int,
    stack_trace text
);
CREATE TABLE input_tensors (
    operation_id int,
    input_index int,
    tensor_id int
);
CREATE TABLE output_tensors (
    operation_id int,
    output_index int,
    tensor_id int
);
CREATE TABLE local_tensor_comparison_records (
    tensor_id int,
    golden_tensor_id int,
    matches int,
    desired_pcc float,
    actual_pcc float
);
CREATE TABLE global_tensor_comparison_records (
    tensor_id int,
    golden_tensor_id int,
    matches int,
    desired_pcc float,
    actual_pcc float
);
CREATE TABLE buffer_pages (
    operation_id int,
    device_id int,
    address int,
    core_y int,
    core_x int,
    bank_id int,
    page_index int,
    page_address int,
    page_size int,
    buffer_type int
);
"""

# Source: TTNN profiler report after stack-trace source-file storage was
# introduced. Verbatim differences from ``SCHEMA_V2``: a new ``source_files``
# table with ``path text UNIQUE NOT NULL``, a
# ``source_file_id int REFERENCES source_files(id)`` column on
# ``stack_traces``, and an ``idx_stack_traces_source_file_id`` index.
#
# Note: the foreign key on ``stack_traces.source_file_id`` is structural-only
# in test contexts. SQLite enforces foreign keys per-connection only when
# ``PRAGMA foreign_keys = ON`` is set, which neither ``make_report`` nor
# ``DatabaseQueries`` issues — matching production TTNN behaviour. Test data
# may reference nonexistent ``source_files.id`` values without raising.
SCHEMA_V2_1 = """
CREATE TABLE devices (
    device_id int,
    num_y_cores int,
    num_x_cores int,
    num_y_compute_cores int,
    num_x_compute_cores int,
    worker_l1_size int,
    l1_num_banks int,
    l1_bank_size int,
    address_at_first_l1_bank int,
    address_at_first_l1_cb_buffer int,
    num_banks_per_storage_core int,
    num_compute_cores int,
    num_storage_cores int,
    total_l1_memory int,
    total_l1_for_tensors int,
    total_l1_for_interleaved_buffers int,
    total_l1_for_sharded_buffers int,
    cb_limit int
);
CREATE TABLE operations (
    operation_id int UNIQUE,
    name text,
    duration float
);
CREATE TABLE operation_arguments (
    operation_id int,
    name text,
    value text
);
CREATE TABLE tensors (
    tensor_id int UNIQUE,
    shape text,
    dtype text,
    layout text,
    memory_config text,
    device_id int,
    address int,
    buffer_type int
);
CREATE TABLE device_tensors (
    tensor_id int,
    device_id int,
    address int
);
CREATE TABLE buffers (
    operation_id int,
    device_id int,
    address int,
    max_size_per_bank int,
    buffer_type int,
    buffer_layout int
);
CREATE TABLE captured_graph (
    operation_id int,
    captured_graph text
);
CREATE TABLE nodes (
    operation_id int,
    unique_id int,
    node_operation_id int,
    name text
);
CREATE TABLE edges (
    operation_id int,
    source_unique_id int,
    sink_unique_id int,
    source_output_index int,
    sink_input_index int,
    key int
);
CREATE TABLE report_metadata (
    key text UNIQUE,
    value text
);
CREATE TABLE errors (
    operation_id int,
    operation_name text,
    error_type text,
    error_message text,
    stack_trace text,
    timestamp text
);
CREATE TABLE source_files (
    id INTEGER PRIMARY KEY,
    path text UNIQUE NOT NULL,
    contents text
);
CREATE TABLE stack_traces (
    operation_id int,
    stack_trace text,
    source_file_id int REFERENCES source_files(id)
);
CREATE TABLE input_tensors (
    operation_id int,
    input_index int,
    tensor_id int
);
CREATE TABLE output_tensors (
    operation_id int,
    output_index int,
    tensor_id int
);
CREATE TABLE local_tensor_comparison_records (
    tensor_id int,
    golden_tensor_id int,
    matches int,
    desired_pcc float,
    actual_pcc float
);
CREATE TABLE global_tensor_comparison_records (
    tensor_id int,
    golden_tensor_id int,
    matches int,
    desired_pcc float,
    actual_pcc float
);
CREATE TABLE buffer_pages (
    operation_id int,
    device_id int,
    address int,
    core_y int,
    core_x int,
    bank_id int,
    page_index int,
    page_address int,
    page_size int,
    buffer_type int
);
CREATE INDEX idx_stack_traces_source_file_id ON stack_traces (source_file_id);
"""

# Hand-derived: TTNN does not yet emit reports with the ``tensor_lifetime``
# table in production, so this schema cannot be sourced via ``.schema``. The
# DDL below tracks the shape proposed in PR #1430 ("Add lifetime to tensor
# API responses"). Once a TTNN release ships ``tensor_lifetime``, regenerate
# this constant from a real report the same way as ``SCHEMA_V2`` above and
# fold it into a versioned ``SCHEMA_V2_2``.
SCHEMA_V2_WITH_LIFETIME = SCHEMA_V2 + """
CREATE TABLE tensor_lifetime (
    tensor_id int UNIQUE,
    producer_operation_id int,
    last_use_operation_id int,
    deallocate_operation_id int,
    producer_source_file text,
    producer_source_line int,
    last_use_source_file text,
    last_use_source_line int
);
"""
