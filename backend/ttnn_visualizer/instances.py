# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import json
import random
import string
from logging import getLogger
from pathlib import Path

from flask import request
from ttnn_visualizer.exceptions import InvalidProfilerPath, InvalidReportPath
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable, RemoteConnection, ReportLocation
from ttnn_visualizer.utils import get_npe_path, get_performance_path, get_profiler_path

logger = getLogger(__name__)

from flask import current_app, jsonify
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

# Active report dictionary keys
KEY_PROFILER_NAME = "profiler_name"
KEY_PROFILER_LOCATION = "profiler_location"
KEY_PERFORMANCE_NAME = "performance_name"
KEY_PERFORMANCE_LOCATION = "performance_location"
KEY_NPE_NAME = "npe_name"
KEY_NPE_LOCATION = "npe_location"

_sentinel = object()


def _get_remote_connection(
    active_report: dict,
    report_name_key: str,
    report_location_key: str,
    remote_connection: RemoteConnection | None,
) -> RemoteConnection | None:
    if not active_report.get(report_name_key):
        return None
    if active_report.get(report_location_key) == ReportLocation.REMOTE.value:
        return remote_connection
    return None


def _resolve_report_path(
    report_name: str | None,
    path_getter,
    report_name_key: str,
    report_location_key: str,
    active_report: dict,
    remote_connection: RemoteConnection | None,
) -> str | None:
    # If report_name is provided, use it; otherwise check if it's in active_report
    name_to_resolve = report_name or active_report.get(report_name_key)
    if not name_to_resolve:
        return None
    return path_getter(
        name_to_resolve,
        current_app,
        remote_connection=_get_remote_connection(
            active_report, report_name_key, report_location_key, remote_connection
        ),
    )


def _update_active_report(
    active_report: dict,
    report_name: str | None,
    report_location,
    name_key: str,
    location_key: str,
) -> None:
    """Update or delete a report entry in active_report dict."""
    if report_name == "":
        active_report.pop(name_key, None)
        active_report.pop(location_key, None)
    elif report_name is not None and report_location is not None:
        active_report[name_key] = report_name
        active_report[location_key] = report_location


def _build_active_report(
    profiler_name: str | None,
    profiler_location,
    performance_name: str | None,
    performance_location,
    npe_name: str | None,
    npe_location,
) -> dict:
    """Build active_report dict from report name/location tuples."""
    report = {}
    if profiler_name and profiler_location is not None:
        report[KEY_PROFILER_NAME] = profiler_name
        report[KEY_PROFILER_LOCATION] = profiler_location
    if performance_name and performance_location is not None:
        report[KEY_PERFORMANCE_NAME] = performance_name
        report[KEY_PERFORMANCE_LOCATION] = performance_location
    if npe_name and npe_location is not None:
        report[KEY_NPE_NAME] = npe_name
        report[KEY_NPE_LOCATION] = npe_location
    return report


def update_existing_instance(
    instance_data,
    profiler_name,
    profiler_location,
    performance_name,
    performance_location,
    npe_name,
    npe_location,
    remote_connection,
    remote_profiler_folder,
    remote_performance_folder,
    clear_remote,
    profiler_path=_sentinel,
    performance_path=_sentinel,
    npe_path=_sentinel,
):
    active_report = instance_data.active_report or {}

    # Update active_report entries using helper
    _update_active_report(
        active_report,
        profiler_name,
        profiler_location,
        KEY_PROFILER_NAME,
        KEY_PROFILER_LOCATION,
    )
    _update_active_report(
        active_report,
        performance_name,
        performance_location,
        KEY_PERFORMANCE_NAME,
        KEY_PERFORMANCE_LOCATION,
    )
    _update_active_report(
        active_report, npe_name, npe_location, KEY_NPE_NAME, KEY_NPE_LOCATION
    )

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
        instance_data.profiler_path = _resolve_report_path(
            profiler_name,
            get_profiler_path,
            KEY_PROFILER_NAME,
            KEY_PROFILER_LOCATION,
            active_report,
            remote_connection,
        )

    if performance_path is not _sentinel:
        instance_data.performance_path = performance_path
    else:
        instance_data.performance_path = _resolve_report_path(
            performance_name,
            get_performance_path,
            KEY_PERFORMANCE_NAME,
            KEY_PERFORMANCE_LOCATION,
            active_report,
            remote_connection,
        )

    if npe_path is not _sentinel:
        instance_data.npe_path = npe_path
    else:
        instance_data.npe_path = _resolve_report_path(
            npe_name,
            get_npe_path,
            KEY_NPE_NAME,
            KEY_NPE_LOCATION,
            active_report,
            remote_connection,
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
    profiler_location,
    performance_name,
    performance_location,
    npe_name,
    npe_location,
    remote_connection,
    remote_profiler_folder,
    remote_performance_folder,
    clear_remote,
    profiler_path=_sentinel,
    performance_path=_sentinel,
    npe_path=_sentinel,
):
    active_report = _build_active_report(
        profiler_name,
        profiler_location,
        performance_name,
        performance_location,
        npe_name,
        npe_location,
    )

    if clear_remote:
        remote_connection = None
        remote_profiler_folder = None
        remote_performance_folder = None

    resolved_profiler_path = (
        profiler_path
        if profiler_path is not _sentinel
        else _resolve_report_path(
            profiler_name,
            get_profiler_path,
            KEY_PROFILER_NAME,
            KEY_PROFILER_LOCATION,
            active_report,
            remote_connection,
        )
    )

    instance_data = InstanceTable(
        instance_id=instance_id,
        active_report=active_report,
        profiler_path=resolved_profiler_path,
        remote_connection=(
            remote_connection.model_dump() if remote_connection else None
        ),
        remote_profiler_folder=(
            remote_profiler_folder.model_dump() if remote_profiler_folder else None
        ),
        remote_performance_folder=(
            remote_performance_folder.model_dump()
            if remote_performance_folder
            else None
        ),
    )

    if performance_path is not _sentinel:
        instance_data.performance_path = performance_path
    else:
        instance_data.performance_path = _resolve_report_path(
            performance_name,
            get_performance_path,
            KEY_PERFORMANCE_NAME,
            KEY_PERFORMANCE_LOCATION,
            active_report,
            remote_connection,
        )

    if npe_path is not _sentinel:
        instance_data.npe_path = npe_path
    else:
        instance_data.npe_path = _resolve_report_path(
            npe_name,
            get_npe_path,
            KEY_NPE_NAME,
            KEY_NPE_LOCATION,
            active_report,
            remote_connection,
        )

    db.session.add(instance_data)
    return instance_data


def update_instance(
    instance_id,
    profiler_name=None,
    profiler_location=None,
    performance_name=None,
    performance_location=None,
    npe_name=None,
    npe_location=None,
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
                profiler_location,
                performance_name,
                performance_location,
                npe_name,
                npe_location,
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
                profiler_location,
                performance_name,
                performance_location,
                npe_name,
                npe_location,
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
    profiler_location=None,
    performance_name=None,
    performance_location=None,
    npe_name=None,
    npe_location=None,
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
                instance_data = InstanceTable.query.filter_by(
                    instance_id=instance_id
                ).first()

        # Update the instance if any new data is provided
        if (
            profiler_name
            or profiler_location is not None
            or performance_name
            or performance_location is not None
            or npe_name
            or npe_location is not None
            or remote_connection
            or remote_profiler_folder
        ):
            update_instance(
                instance_id=instance_id,
                profiler_name=profiler_name,
                profiler_location=profiler_location,
                performance_name=performance_name,
                performance_location=performance_location,
                npe_name=npe_name,
                npe_location=npe_location,
                remote_connection=remote_connection,
                remote_profiler_folder=remote_profiler_folder,
            )

            # Query again to get the updated instance data
            instance_data = InstanceTable.query.filter_by(
                instance_id=instance_id
            ).first()

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
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=45))


def create_instance_from_local_paths(profiler_path, performance_path):
    _profiler_path = Path(profiler_path) if profiler_path else None
    _performance_path = Path(performance_path) if performance_path else None

    if _profiler_path and (not _profiler_path.exists() or not _profiler_path.is_dir()):
        raise InvalidReportPath()

    if _performance_path and (
        not _performance_path.exists() or not _performance_path.is_dir()
    ):
        raise InvalidProfilerPath()

    profiler_name = (
        _profiler_path.parts[-1]
        if _profiler_path and len(_profiler_path.parts) > 2
        else ""
    )
    performance_name = (
        _performance_path.parts[-1]
        if _performance_path and len(_performance_path.parts) > 2
        else ""
    )
    instance_data = InstanceTable(
        instance_id=create_random_instance_id(),
        active_report={
            KEY_PROFILER_NAME: profiler_name,
            KEY_PERFORMANCE_NAME: performance_name,
            KEY_NPE_NAME: None,
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
