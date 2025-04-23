# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import json
import random
import string
from logging import getLogger
from pathlib import Path

from flask import request

from ttnn_visualizer.exceptions import InvalidReportPath, InvalidProfilerPath
from ttnn_visualizer.utils import get_profiler_path, get_performance_path, get_npe_path
from ttnn_visualizer.models import (
    InstanceTable,
)
from ttnn_visualizer.extensions import db

logger = getLogger(__name__)

from flask import jsonify, current_app
from sqlalchemy.exc import SQLAlchemyError


def update_existing_instance(
    session_data,
    profiler_name,
    performance_name,
    npe_name,
    remote_connection,
    remote_profiler_folder,
    remote_performance_folder,
    clear_remote,
):
    active_report = session_data.active_report or {}

    # First ifs are explicit deletes and elifs are updates
    if profiler_name == "":
        active_report.pop("profiler_name", None)
    elif profiler_name is not None:
        active_report["profiler_name"] = profiler_name

    if performance_name == "":
        active_report.pop("performance_name", None)
    elif performance_name is not None:

        active_report["performance_name"] = performance_name
    if npe_name == "":
        active_report.pop("npe_name", None)
    elif npe_name is not None:
        active_report["npe_name"] = npe_name

    session_data.active_report = active_report

    if remote_connection:
        session_data.remote_connection = remote_connection.model_dump()
    if remote_profiler_folder:
        session_data.remote_profiler_folder = remote_profiler_folder.model_dump()
    if remote_performance_folder:
        session_data.remote_performance_folder = remote_performance_folder.model_dump()

    if clear_remote:
        clear_remote_data(session_data)

    update_paths(
        session_data, active_report, remote_connection
    )


def clear_remote_data(session_data):
    session_data.remote_connection = None
    session_data.remote_profiler_folder = None
    session_data.remote_performance_folder = None


def handle_sqlalchemy_error(error):
    current_app.logger.error(f"Failed to update tab session: {str(error)}")
    db.session.rollback()


def commit_and_log_session(session_data, instance_id):
    db.session.commit()

    session_data = InstanceTable.query.filter_by(instance_id=instance_id).first()
    current_app.logger.info(
        f"Session data for instance {instance_id}: {json.dumps(session_data.to_dict(), indent=4)}"
    )


def update_paths(
    session_data, active_report, remote_connection
):
    if active_report.get("performance_name"):
        session_data.performance_path = get_performance_path(
            performance_name=active_report["performance_name"],
            current_app=current_app,
            remote_connection=remote_connection,
        )

    if active_report.get("profiler_name"):
        session_data.profiler_path = get_profiler_path(
            profiler_name=active_report["profiler_name"],
            current_app=current_app,
            remote_connection=remote_connection,
        )

    if active_report.get("npe_name"):
        session_data.npe_path = get_npe_path(
            npe_name=active_report["npe_name"],
            current_app=current_app
        )


def create_new_instance(
    instance_id,
    profiler_name,
    performance_name,
    npe_name,
    remote_connection,
    remote_profiler_folder,
    remote_performance_folder,
    clear_remote,
):
    active_report = {}
    if profiler_name:
        active_report["profiler_name"] = profiler_name
    if performance_name:
        active_report["performance_name"] = performance_name
    if npe_name:
        active_report["npe_name"] = npe_name

    if clear_remote:
        remote_connection = None
        remote_profiler_folder = None
        remote_performance_folder = None

    session_data = InstanceTable(
        instance_id=instance_id,
        active_report=active_report,
        profiler_path=get_profiler_path(
            active_report["profiler_name"],
            current_app=current_app,
            remote_connection=remote_connection,
        ),
        remote_connection=(
            remote_connection.model_dump() if remote_connection else None
        ),
        remote_profiler_folder=remote_profiler_folder.model_dump() if remote_profiler_folder else None,
        remote_performance_folder=(
            remote_performance_folder.model_dump() if remote_performance_folder else None
        ),
    )
    db.session.add(session_data)
    return session_data


def update_instance(
    instance_id,
    profiler_name=None,
    performance_name=None,
    npe_name=None,
    remote_connection=None,
    remote_profiler_folder=None,
    remote_performance_folder=None,
    clear_remote=False,
):
    try:
        session_data = get_or_create_instance(instance_id)

        if session_data:
            update_existing_instance(
                session_data,
                profiler_name,
                performance_name,
                npe_name,
                remote_connection,
                remote_profiler_folder,
                remote_performance_folder,
                clear_remote,
            )
        else:
            session_data = create_new_instance(
                instance_id,
                profiler_name,
                performance_name,
                npe_name,
                remote_connection,
                remote_profiler_folder,
                remote_performance_folder,
                clear_remote,
            )

        commit_and_log_session(session_data, instance_id)
        return jsonify({"message": "Tab session updated successfully"}), 200

    except SQLAlchemyError as e:
        handle_sqlalchemy_error(e)
        return jsonify({"error": "Failed to update tab session"}), 500


def get_or_create_instance(
    instance_id,
    profiler_name=None,
    performance_name=None,
    npe_name=None,
    remote_connection=None,
    remote_profiler_folder=None,
):
    """
    Retrieve an existing tab session or create a new one if it doesn't exist.
    Uses the Instance model to manage session data and supports conditional updates.
    """
    try:
        # Query the database for the tab session
        session_data = InstanceTable.query.filter_by(instance_id=instance_id).first()

        # If session doesn't exist, initialize it
        if not session_data:
            session_data = InstanceTable(
                instance_id=instance_id,
                active_report={},
                remote_connection=None,
                remote_profiler_folder=None,
            )
            db.session.add(session_data)
            db.session.commit()

        # Update the session if any new data is provided
        if profiler_name or performance_name or npe_name or remote_connection or remote_profiler_folder:
            update_instance(
                instance_id=instance_id,
                profiler_name=profiler_name,
                performance_name=performance_name,
                npe_name=npe_name,
                remote_connection=remote_connection,
                remote_profiler_folder=remote_profiler_folder,
            )

        # Query again to get the updated session data
        session_data = InstanceTable.query.filter_by(instance_id=instance_id).first()

        return session_data

    except SQLAlchemyError as e:
        current_app.logger.error(f"Failed to get or create tab session: {str(e)}")
        db.session.rollback()
        return None


def get_instance():
    """
    Middleware to retrieve or create a tab session based on the instance_id.
    """
    instance_id = request.args.get("instanceId", None)

    current_app.logger.info(f"get_instance: Received instance_id: {instance_id}")
    if not instance_id:
        current_app.logger.error("get_instance: No instance_id found")
        return jsonify({"error": "instanceId is required"}), 400

    active_report = get_or_create_instance(instance_id)
    current_app.logger.info(
        f"get_instance: Session retrieved: {active_report.active_report}"
    )

    return jsonify({"active_report": active_report.active_report}), 200


def init_sessions(app):
    """
    Initializes session middleware and hooks it into Flask.
    """
    app.before_request(get_instance)
    app.logger.info("Sessions middleware initialized.")


def create_random_instance_id():
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=10))


def create_instance_from_local_paths(profiler_path, performance_path):
    _profiler_path = Path(profiler_path) if profiler_path else None
    _performance_path = Path(performance_path) if performance_path else None

    if _profiler_path and (not _profiler_path.exists() or not _profiler_path.is_dir()):
        raise InvalidReportPath()

    if _performance_path and (not _performance_path.exists() or not _performance_path.is_dir()):
        raise InvalidProfilerPath()

    profiler_name = _profiler_path.parts[-1] if _profiler_path and len(_profiler_path.parts) > 2 else ""
    performance_name = _performance_path.parts[-1] if _performance_path and len(_performance_path.parts) > 2 else ""
    session_data = InstanceTable(
        instance_id=create_random_instance_id(),
        active_report={
            "profiler_name": profiler_name,
            "performance_name": performance_name,
            "npe_name": None,
        },
        profiler_path=f"{_profiler_path}/db.sqlite" if profiler_path else None,
        performance_path=performance_path if performance_path else None,
        remote_connection=None,
        remote_profiler_folder=None,
        remote_performance_folder=None,
    )
    db.session.add(session_data)
    db.session.commit()
    return session_data
