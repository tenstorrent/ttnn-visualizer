# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

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
from sqlalchemy.exc import IntegrityError, SQLAlchemyError


_sentinel = object()


def update_existing_instance(
    instance_data,
    profiler_name,
    performance_name,
    npe_name,
    remote_connection,
    remote_profiler_folder,
    remote_performance_folder,
    clear_remote,
    profiler_path=_sentinel,
    performance_path=_sentinel,
    npe_path=_sentinel,
):
    active_report = instance_data.active_report or {}

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

    instance_data.active_report = active_report

    if remote_connection:
        instance_data.remote_connection = remote_connection.model_dump()
    if remote_profiler_folder:
        instance_data.remote_profiler_folder = remote_profiler_folder.model_dump()
    if remote_performance_folder:
        instance_data.remote_performance_folder = remote_performance_folder.model_dump()

    if clear_remote:
        clear_remote_data(instance_data)

    if profiler_path is not _sentinel:
        instance_data.profiler_path = profiler_path
    else:
        if active_report.get("profiler_name"):
            instance_data.profiler_path = get_profiler_path(
                profiler_name=active_report["profiler_name"],
                current_app=current_app,
                remote_connection=remote_connection,
            )

    if performance_path is not _sentinel:
        instance_data.performance_path = performance_path
    else:
        if active_report.get("performance_name"):
            instance_data.performance_path = get_performance_path(
                performance_name=active_report["performance_name"],
                current_app=current_app,
                remote_connection=remote_connection,
            )

    if npe_path is not _sentinel:
        instance_data.npe_path = npe_path
    else:
        if active_report.get("npe_name"):
            instance_data.npe_path = get_npe_path(
                npe_name=active_report["npe_name"],
                current_app=current_app
            )


def clear_remote_data(instance_data):
    instance_data.remote_connection = None
    instance_data.remote_profiler_folder = None
    instance_data.remote_performance_folder = None


def handle_sqlalchemy_error(error):
    current_app.logger.error(f"Failed to update tab instance: {str(error)}")
    db.session.rollback()


def commit_and_log_session(instance_data, instance_id):
    db.session.commit()

    instance_data = InstanceTable.query.filter_by(instance_id=instance_id).first()
    current_app.logger.info(
        f"Data for instance {instance_id}: {json.dumps(instance_data.to_dict(), indent=4)}"
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
    profiler_path=_sentinel,
    performance_path=_sentinel,
    npe_path=_sentinel,
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

    instance_data = InstanceTable(
        instance_id=instance_id,
        active_report=active_report,
        profiler_path=profiler_path if profiler_path is not _sentinel else get_profiler_path(
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

    if performance_path is not _sentinel:
        instance_data.performance_path = performance_path

    if npe_path is not _sentinel:
        instance_data.npe_path = npe_path

    db.session.add(instance_data)
    return instance_data


def update_instance(
    instance_id,
    profiler_name=None,
    performance_name=None,
    npe_name=None,
    remote_connection=None,
    remote_profiler_folder=None,
    remote_performance_folder=None,
    clear_remote=False,
    profiler_path=_sentinel,
    performance_path=_sentinel,
    npe_path=_sentinel,
):
    try:
        instance_data = get_or_create_instance(instance_id)

        if instance_data:
            update_existing_instance(
                instance_data,
                profiler_name,
                performance_name,
                npe_name,
                remote_connection,
                remote_profiler_folder,
                remote_performance_folder,
                clear_remote,
                profiler_path,
                performance_path,
                npe_path,
            )
        else:
            instance_data = create_new_instance(
                instance_id,
                profiler_name,
                performance_name,
                npe_name,
                remote_connection,
                remote_profiler_folder,
                remote_performance_folder,
                clear_remote,
                profiler_path,
                performance_path,
                npe_path,
            )

        commit_and_log_session(instance_data, instance_id)
        return jsonify({"message": "Tab instance updated successfully"}), 200

    except SQLAlchemyError as e:
        handle_sqlalchemy_error(e)
        return jsonify({"error": "Failed to update tab instance"}), 500


def get_or_create_instance(
    instance_id,
    profiler_name=None,
    performance_name=None,
    npe_name=None,
    remote_connection=None,
    remote_profiler_folder=None,
):
    """
    Retrieve an existing tab instance or create a new one if it doesn't exist.
    Uses the Instance model to manage instance data and supports conditional updates.
    """
    try:
        # Query the database for the tab instance
        instance_data = InstanceTable.query.filter_by(instance_id=instance_id).first()

        # If instance doesn't exist, initialize it
        if not instance_data:
            instance_data = InstanceTable(
                instance_id=instance_id,
                active_report={},
                remote_connection=None,
                remote_profiler_folder=None,
            )
            db.session.add(instance_data)

            try:
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                instance_data = InstanceTable.query.filter_by(instance_id=instance_id).first()

        # Update the instance if any new data is provided
        if profiler_name or performance_name or npe_name or remote_connection or remote_profiler_folder:
            update_instance(
                instance_id=instance_id,
                profiler_name=profiler_name,
                performance_name=performance_name,
                npe_name=npe_name,
                remote_connection=remote_connection,
                remote_profiler_folder=remote_profiler_folder,
            )

            # Query again to get the updated instance data
            instance_data = InstanceTable.query.filter_by(instance_id=instance_id).first()

        return instance_data

    except SQLAlchemyError as e:
        current_app.logger.error(f"Failed to get or create tab instance: {str(e)}")
        db.session.rollback()
        return None


def get_instance():
    """
    Middleware to retrieve or create a tab instance based on the instance_id.
    """
    instance_id = request.args.get("instanceId", None)

    current_app.logger.info(f"get_instance: Received instance_id: {instance_id}")
    if not instance_id:
        current_app.logger.error("get_instance: No instance_id found")
        return jsonify({"error": "instanceId is required"}), 400

    active_report = get_or_create_instance(instance_id)
    current_app.logger.info(
        f"get_instance: active report retrieved: {active_report.active_report}"
    )

    return jsonify({"active_report": active_report.active_report}), 200


def get_instances(instance_ids):
    instances = []

    for instance_id in instance_ids:
        instance = InstanceTable.query.filter_by(instance_id=instance_id).first()
        if instance:
            instances.append(instance)

    return instances


def init_instances(app):
    """
    Initializes instance middleware and hooks it into Flask.
    """
    app.before_request(get_instance)
    app.logger.info("Instances middleware initialized.")


def create_random_instance_id():
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=45))


def create_instance_from_local_paths(profiler_path, performance_path):
    _profiler_path = Path(profiler_path) if profiler_path else None
    _performance_path = Path(performance_path) if performance_path else None

    if _profiler_path and (not _profiler_path.exists() or not _profiler_path.is_dir()):
        raise InvalidReportPath()

    if _performance_path and (not _performance_path.exists() or not _performance_path.is_dir()):
        raise InvalidProfilerPath()

    profiler_name = _profiler_path.parts[-1] if _profiler_path and len(_profiler_path.parts) > 2 else ""
    performance_name = _performance_path.parts[-1] if _performance_path and len(_performance_path.parts) > 2 else ""
    instance_data = InstanceTable(
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
    db.session.add(instance_data)
    db.session.commit()
    return instance_data
