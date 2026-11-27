# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from http import HTTPStatus

from ttnn_visualizer.tests.report_schemas import SCHEMA_V2, SCHEMA_V2_1


def _source_files(client, instance_id):
    response = client.get("/api/source-files", query_string={"instanceId": instance_id})
    assert response.status_code == HTTPStatus.OK
    return response.get_json()


def test_it_lists_the_files_a_read_can_return(client, make_report):
    """Only rows a read would serve. Stack trace frames are linked only to these
    files, so a linked frame opens without an availability probe. The viewer behind
    the Source button can still find other files outside server mode."""
    instance_id = make_report(
        schema_sql=SCHEMA_V2_1,
        inserts_sql="""
        INSERT INTO source_files VALUES (1, '/proj/model.py', 'def forward(): pass');
        INSERT INTO source_files VALUES (2, '/proj/empty.py', '');
        INSERT INTO source_files VALUES (3, '/proj/null.py', NULL);
        INSERT INTO source_files VALUES (4, '/proj/blob.py', x'');
        INSERT INTO source_files VALUES (5, '/proj/../escape.py', 'x = 1');
        INSERT INTO source_files VALUES (6, '/proj/helpers.py', 'def helper(): pass');
        """,
    )

    assert _source_files(client, instance_id) == [
        {"id": 1, "path": "/proj/model.py", "aliases": []},
        {"id": 6, "path": "/proj/helpers.py", "aliases": []},
    ]


def test_a_report_without_the_table_has_no_source_files(client, make_report):
    instance_id = make_report(schema_sql=SCHEMA_V2, inserts_sql="")

    assert _source_files(client, instance_id) == []


def test_it_is_served_outside_server_mode_too(app, client, make_report):
    """The shared test settings run hosted, so the tests above already pin that this
    route answers under ``SERVER_MODE``; gating it ``@local_only`` would drop every
    stack trace frame link there. Frames link the same way on a local install."""
    app.config["SERVER_MODE"] = False
    instance_id = make_report(
        schema_sql=SCHEMA_V2_1,
        inserts_sql="INSERT INTO source_files VALUES (1, '/proj/model.py', 'x = 1');",
    )

    assert _source_files(client, instance_id) == [
        {"id": 1, "path": "/proj/model.py", "aliases": []}
    ]


def _trace(path):
    return f'  File "{path}", line 3, in run\n    ttnn.add(a, b)'


def test_it_names_each_file_by_the_raw_paths_its_traces_were_stored_with(
    client, make_report
):
    """The writer stores a file under its realpath, so a trace captured through a
    symlinked checkout names it by a path no stored path equals. The trace's own
    pairing maps that path to the file, so later frames naming it can link."""
    real = "/localdev/u/tt-metal/models/a.py"
    linked = "/home/u/tt-metal/models/a.py"
    instance_id = make_report(
        schema_sql=SCHEMA_V2_1,
        inserts_sql=f"""
        INSERT INTO source_files VALUES (1, '{real}', 'x = 1');
        INSERT INTO source_files VALUES (2, '/proj/empty.py', '');
        INSERT INTO stack_traces VALUES (1, '{_trace(linked)}', 1);
        INSERT INTO stack_traces VALUES (2, '{_trace(linked)}', 1);
        INSERT INTO stack_traces VALUES (3, '{_trace(real)}', 1);
        INSERT INTO stack_traces VALUES (4, '{_trace("/home/u/empty.py")}', 2);
        INSERT INTO stack_traces VALUES (5, '{_trace("/home/u/../a.py")}', 1);
        INSERT INTO stack_traces VALUES (6, '{_trace(" /home/u/padded.py")}', 1);
        """,
    )

    # Once each; never its own stored path, an unservable file's, an unsafe
    # path, or one validation would trim and the frontend could never match.
    assert _source_files(client, instance_id) == [
        {"id": 1, "path": real, "aliases": [linked]}
    ]


def test_a_raw_path_stored_with_two_files_names_neither(client, make_report):
    instance_id = make_report(
        schema_sql=SCHEMA_V2_1,
        inserts_sql=f"""
        INSERT INTO source_files VALUES (1, '/real/a.py', 'x = 1');
        INSERT INTO source_files VALUES (2, '/real/b.py', 'y = 2');
        INSERT INTO stack_traces VALUES (1, '{_trace("/link/a.py")}', 1);
        INSERT INTO stack_traces VALUES (2, '{_trace("/link/a.py")}', 2);
        INSERT INTO stack_traces VALUES (3, '{_trace("/link/a.py")}', 1);
        """,
    )

    assert [entry["aliases"] for entry in _source_files(client, instance_id)] == [
        [],
        [],
    ]


def test_another_files_stored_path_is_never_an_alias(client, make_report):
    """An exact stored path names its own file, whatever a trace paired it with."""
    instance_id = make_report(
        schema_sql=SCHEMA_V2_1,
        inserts_sql=f"""
        INSERT INTO source_files VALUES (1, '/real/a.py', 'x = 1');
        INSERT INTO source_files VALUES (2, '/real/b.py', 'y = 2');
        INSERT INTO stack_traces VALUES (1, '{_trace("/real/b.py")}', 1);
        """,
    )

    assert [entry["aliases"] for entry in _source_files(client, instance_id)] == [
        [],
        [],
    ]


def test_it_pairs_the_path_the_writer_took_not_the_first_file_frame(
    client, make_report
):
    """tt-metal's writer also takes a bare ``path:line`` line, so the id belongs
    to that path, and the `File` frame after it is no alias of the file."""
    trace = "/link/kernel.cpp:12\n" + _trace("/link/a.py")
    instance_id = make_report(
        schema_sql=SCHEMA_V2_1,
        inserts_sql=f"""
        INSERT INTO source_files VALUES (1, '/real/kernel.cpp', 'int x;');
        INSERT INTO stack_traces VALUES (1, '{trace}', 1);
        """,
    )

    assert _source_files(client, instance_id) == [
        {"id": 1, "path": "/real/kernel.cpp", "aliases": ["/link/kernel.cpp"]}
    ]
