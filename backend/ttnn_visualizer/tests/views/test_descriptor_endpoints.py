# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import tempfile
from pathlib import Path

from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable


def _create_instance_without_profiler(app, instance_id: str) -> None:
    with app.app_context():
        instance = InstanceTable(
            instance_id=instance_id,
            active_report={},
            profiler_path=None,
        )
        db.session.add(instance)
        db.session.commit()


def _register_profiler_instance_with_dir(
    app, instance_id: str, report_dir: Path
) -> None:
    # The mesh-descriptor endpoint resolves files relative to
    # `Path(instance.profiler_path).parent`, so we point profiler_path at any
    # file inside the report directory.
    sentinel = report_dir / "db.sqlite"
    sentinel.touch()
    with app.app_context():
        existing = InstanceTable.query.filter_by(instance_id=instance_id).first()
        if existing:
            db.session.delete(existing)
            db.session.commit()
        instance = InstanceTable(
            instance_id=instance_id,
            active_report={},
            profiler_path=str(sentinel),
        )
        db.session.add(instance)
        db.session.commit()


def test_cluster_descriptor_returns_404_when_no_profiler_path(app, client):
    instance_id = "test-no-profiler-cluster"
    _create_instance_without_profiler(app, instance_id)

    response = client.get(
        "/api/cluster-descriptor",
        query_string={"instanceId": instance_id},
    )

    assert response.status_code == 404
    data = response.get_json()
    assert data is not None
    assert "cluster_descriptor.yaml not found" in data["error"]


def test_mesh_descriptor_returns_404_when_no_profiler_path(app, client):
    instance_id = "test-no-profiler-mesh"
    _create_instance_without_profiler(app, instance_id)

    response = client.get(
        "/api/mesh-descriptor",
        query_string={"instanceId": instance_id},
    )

    assert response.status_code == 404
    data = response.get_json()
    assert data is not None
    assert "physical_chip_mesh_coordinate_mapping.yaml not found" in data["error"]


def test_mesh_descriptor_returns_single_doc_shape_when_file_has_one_doc(app, client):
    instance_id = "test-mesh-single-doc"
    with tempfile.TemporaryDirectory() as tmp:
        report_dir = Path(tmp)
        (report_dir / "physical_chip_mesh_coordinate_mapping.yaml").write_text(
            "chips:\n  0: [0, 0]\n  1: [0, 1]\n",
            encoding="utf-8",
        )
        _register_profiler_instance_with_dir(app, instance_id, report_dir)

        response = client.get(
            "/api/mesh-descriptor",
            query_string={"instanceId": instance_id},
        )

        assert response.status_code == 200
        data = response.get_json()
        # Legacy single-doc shape: `chips` at top level, no `docs` envelope.
        assert "docs" not in data
        assert data["chips"] == {"0": [0, 0], "1": [0, 1]}


def test_mesh_descriptor_returns_docs_envelope_for_multi_doc_file(app, client):
    """
    Some multi-host reports emit `physical_chip_mesh_coordinate_mapping_*.yaml`
    as a multi-document YAML stream (one `chips:` block per rank). The endpoint
    should surface every doc so the FE can resolve the one that matches the
    requested rank.
    """
    instance_id = "test-mesh-multi-doc"
    with tempfile.TemporaryDirectory() as tmp:
        report_dir = Path(tmp)
        (report_dir / "physical_chip_mesh_coordinate_mapping_1_of_2.yaml").write_text(
            "chips:\n  0: [0, 12]\n  5: [0, 8]\n---\nchips:\n  0: [0, 6]\n  5: [0, 2]\n",
            encoding="utf-8",
        )
        _register_profiler_instance_with_dir(app, instance_id, report_dir)

        response = client.get(
            "/api/mesh-descriptor",
            query_string={"instanceId": instance_id, "rank": "0"},
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "docs" in data
        assert len(data["docs"]) == 2
        # Both docs surfaced verbatim — rank-doc selection happens in the FE.
        assert data["docs"][0]["chips"] == {"0": [0, 12], "5": [0, 8]}
        assert data["docs"][1]["chips"] == {"0": [0, 6], "5": [0, 2]}


def test_mesh_descriptor_returns_empty_chips_shape_when_yaml_has_no_dict_docs(
    app, client
):
    """An empty / scalar-only YAML file still returns the single-doc shape so
    the FE doesn't need a separate empty-payload branch."""
    instance_id = "test-mesh-empty-docs"
    with tempfile.TemporaryDirectory() as tmp:
        report_dir = Path(tmp)
        (report_dir / "physical_chip_mesh_coordinate_mapping.yaml").write_text(
            "",
            encoding="utf-8",
        )
        _register_profiler_instance_with_dir(app, instance_id, report_dir)

        response = client.get(
            "/api/mesh-descriptor",
            query_string={"instanceId": instance_id},
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data == {"chips": {}}
