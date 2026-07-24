# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import json
import tempfile
from pathlib import Path

from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable


def test_performance_manifest_returns_404_when_no_performance_path(app, client):
    with app.app_context():
        instance = InstanceTable(
            instance_id="test-no-perf-path",
            active_report={},
            performance_path=None,
        )
        db.session.add(instance)
        db.session.commit()

    response = client.get(
        "/api/performance/manifest",
        query_string={"instanceId": "test-no-perf-path"},
    )
    assert response.status_code == 404


def test_performance_manifest_returns_404_when_file_missing(app, client):
    with tempfile.TemporaryDirectory() as tmpdir:
        with app.app_context():
            instance = InstanceTable(
                instance_id="test-missing-manifest",
                active_report={},
                performance_path=tmpdir,
            )
            db.session.add(instance)
            db.session.commit()

        response = client.get(
            "/api/performance/manifest",
            query_string={"instanceId": "test-missing-manifest"},
        )
        assert response.status_code == 404
        data = response.get_json()
        assert data is not None
        assert "manifest" in data["error"].lower()


def test_performance_manifest_returns_json_on_success(app, client):
    with tempfile.TemporaryDirectory() as tmpdir:
        manifest = {
            "run_id": "3122e52b-3417-4c39-ae20-0a26dff1be8a",
            "artifact": "performance",
            "created_at": "2026-07-24T16:07:42.943583+00:00",
        }
        Path(tmpdir, "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

        with app.app_context():
            instance = InstanceTable(
                instance_id="test-with-manifest",
                active_report={},
                performance_path=tmpdir,
            )
            db.session.add(instance)
            db.session.commit()

        response = client.get(
            "/api/performance/manifest",
            query_string={"instanceId": "test-with-manifest"},
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data == manifest
