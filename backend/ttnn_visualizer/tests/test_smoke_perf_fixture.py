# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The committed smoke-test performance fixture has to keep satisfying its readers.

`scripts/fixtures/smoke-performance-report/` is a trimmed copy of a real report,
and its README documents four invariants that a careless regeneration would
break silently: the manifest/report `global_call_count` join, the verbatim first
line of the device log, the full retained column set, and manifest
schema-cleanliness.

Until now the only thing checking any of that was the Playwright suite, which
needs a wheel build plus a built SPA and runs as five matrix legs. These
assertions run in seconds against the committed bytes, so a bad regeneration
fails long before CI gets to the browser.
"""

import json
from pathlib import Path

import pytest
from ttnn_visualizer.csv_queries import (
    DeviceLogProfilerQueries,
    NPEQueries,
    OpsPerformanceReportQueries,
)
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import Instance, InstanceTable
from ttnn_visualizer.utils import is_valid_performance_report_dir

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_DIR = REPO_ROOT / "scripts" / "fixtures" / "smoke-performance-report"
MANIFEST_SCHEMA = REPO_ROOT / "src" / "schemas" / "npe-manifest.schema.json"

DEVICE_LOG = FIXTURE_DIR / "profile_log_device.csv"
MANIFEST = FIXTURE_DIR / "npe_viz" / "manifest.json"

META_ENDPOINT = "/api/performance/device-log/meta"


@pytest.fixture(scope="module")
def generated_report():
    """The report the perf endpoint would serve for this fixture."""
    instance = Instance(
        instance_id="pytest-smoke-fixture", performance_path=str(FIXTURE_DIR)
    )
    return OpsPerformanceReportQueries.generate_report(instance)["report"]


@pytest.fixture
def fixture_instance(app):
    """An instance mounted on the committed fixture, for endpoint-level checks."""
    instance_id = "pytest-smoke-perf-fixture"

    with app.app_context():
        db.session.add(
            InstanceTable(
                instance_id=instance_id,
                active_report={},
                performance_path=str(FIXTURE_DIR),
            )
        )
        db.session.commit()

    return instance_id


def test_fixture_is_present():
    assert FIXTURE_DIR.is_dir(), f"Missing smoke test fixture at {FIXTURE_DIR}"


def test_fixture_validates_as_a_performance_report():
    """What `GET /api/performance` filters the folder list on."""
    assert is_valid_performance_report_dir(FIXTURE_DIR)


def test_fixture_has_no_tracy_file():
    """Tracy is optional, and omitting it keeps that ingestion path covered."""
    assert not (FIXTURE_DIR / "tracy_profile_log_host.tracy").exists()


def test_report_generation_yields_rows(generated_report):
    """A fixture trimmed too far would still upload but render an empty table."""
    assert len(generated_report) > 0


def test_device_log_preamble_parses(client, fixture_instance):
    """Line 1 is kept verbatim because the meta endpoint regexes it directly."""
    response = client.get(META_ENDPOINT, query_string={"instanceId": fixture_instance})

    assert response.status_code == 200, response.get_data(as_text=True)

    meta = response.get_json()
    assert meta["architecture"], "ARCH: missing from the device log's first line"
    assert meta["frequency"], "CHIP_FREQ[MHz]: missing from the device log's first line"


def test_device_log_rows_have_the_expected_field_count():
    """Pandas does not complain about a ragged row, so something has to.

    A short row is silently NaN-padded; a long one promotes the first column to
    an index and shifts every value. Either way a stray comma in `source file`
    or `meta data` corrupts the data with no parse error, so a regeneration that
    introduced one would surface as wrong numbers rather than a failure. Column
    *naming* is pinned by the test below.
    """
    lines = DEVICE_LOG.read_text(encoding="utf-8").splitlines()

    assert len(lines) > 2, "Device log has no data rows"

    expected_fields = len(lines[1].split(","))
    for row_number, line in enumerate(lines[2:], start=3):
        if not line.strip():
            continue
        assert (
            len(line.split(",")) == expected_fields
        ), f"Device log line {row_number} has the wrong field count"


def test_device_log_columns_are_read_by_name():
    """The fixture has 13 columns, which is what hid #1941 for so long.

    A hardcoded 13-name list overwrote the header positionally, so this file's
    count matched and every name from `data` onward shifted by one — `type` was
    served as `zone name`, so a zone query returned nothing for a real zone and
    rows for `ZONE_START`. Both answered 200, so the smoke test never noticed.
    """
    instance = Instance(
        instance_id="pytest-smoke-fixture-columns", performance_path=str(FIXTURE_DIR)
    )

    with DeviceLogProfilerQueries(instance) as csv:
        entries = csv.get_all_entries(as_dict=True)

    assert entries, "Fixture device log has no data rows"

    zone_names = {entry["zone_name"] for entry in entries}
    assert (
        "BRISC-FW" in zone_names
    ), f"`zone name` is serving another column: {zone_names}"
    assert {entry["type"] for entry in entries} <= {"ZONE_START", "ZONE_END", "TS_DATA"}


def test_manifest_matches_its_schema():
    """The SPA validates this with Ajv and throws on a mismatch."""
    schema = json.loads(MANIFEST_SCHEMA.read_text(encoding="utf-8"))
    item_schema = schema["items"]
    allowed = set(item_schema["properties"])
    required = set(item_schema["required"])

    entries = json.loads(MANIFEST.read_text(encoding="utf-8"))

    assert isinstance(entries, list) and entries, "Manifest must be a non-empty array"

    for entry in entries:
        keys = set(entry)
        assert required <= keys, f"Manifest entry missing {required - keys}"
        if item_schema.get("additionalProperties") is False:
            assert keys <= allowed, f"Manifest entry has extra keys {keys - allowed}"
        assert isinstance(entry["global_call_count"], int)
        assert isinstance(entry["file"], str)


def test_manifest_entries_join_a_report_row(generated_report):
    """The NPE launch button only renders when this join holds.

    `PerfTable` matches a manifest entry against a row's `global_call_count`, and
    the smoke test clicks that button to reach the timeline endpoint. If a
    regeneration broke the join the button would silently never appear.
    """
    report_call_counts = {str(row.get("global_call_count")) for row in generated_report}
    entries = json.loads(MANIFEST.read_text(encoding="utf-8"))

    for entry in entries:
        assert str(entry["global_call_count"]) in report_call_counts, (
            f"Manifest entry {entry['global_call_count']} matches no report row; "
            "regenerate with scripts/generate_smoke_perf_fixture.py"
        )


def test_manifest_files_exist_on_disk():
    entries = json.loads(MANIFEST.read_text(encoding="utf-8"))

    for entry in entries:
        assert (MANIFEST.parent / entry["file"]).is_file()


def test_npe_manifest_is_readable_through_the_query_layer():
    """What `GET /api/performance/npe/manifest` serves."""
    instance = Instance(
        instance_id="pytest-smoke-fixture-npe", performance_path=str(FIXTURE_DIR)
    )

    assert NPEQueries.get_npe_manifest(instance)
