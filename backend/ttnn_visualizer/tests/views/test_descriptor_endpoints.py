# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

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
