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
        {"id": 1, "path": "/proj/model.py"},
        {"id": 6, "path": "/proj/helpers.py"},
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

    assert _source_files(client, instance_id) == [{"id": 1, "path": "/proj/model.py"}]
