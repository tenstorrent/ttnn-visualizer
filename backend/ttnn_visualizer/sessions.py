# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from logging import getLogger

from flask import request

from ttnn_visualizer.utils import get_report_path, get_profiler_path, get_npe_path
from ttnn_visualizer.models import (
    TabSessionTable,
)
from ttnn_visualizer.extensions import db

logger = getLogger(__name__)

from flask import jsonify, current_app
from sqlalchemy.exc import SQLAlchemyError
import json


def update_existing_tab_session(
    session_data,
    report_name,
    profile_name,
    npe_name,
    remote_connection,
    remote_folder,
    remote_profile_folder,
    clear_remote,
):
    active_report = session_data.active_report or {}

    if report_name:
        active_report["report_name"] = report_name
    if profile_name:
        active_report["profile_name"] = profile_name
    if npe_name:
        active_report["npe_name"] = npe_name

    session_data.active_report = active_report

    if remote_connection:
        session_data.remote_connection = remote_connection.model_dump()
    if remote_folder:
        session_data.remote_folder = remote_folder.model_dump()
    if remote_profile_folder:
        session_data.remote_profile_folder = remote_profile_folder.model_dump()

    if clear_remote:
        clear_remote_data(session_data)

    update_paths(
        session_data, active_report, remote_connection
    )


def clear_remote_data(session_data):
    session_data.remote_connection = None
    session_data.remote_folder = None
    session_data.remote_profile_folder = None


def handle_sqlalchemy_error(error):
    current_app.logger.error(f"Failed to update tab session: {str(error)}")
    db.session.rollback()


def commit_and_log_session(session_data, tab_id):
    db.session.commit()

    session_data = TabSessionTable.query.filter_by(tab_id=tab_id).first()
    current_app.logger.info(
        f"Session data for tab {tab_id}: {json.dumps(session_data.to_dict(), indent=4)}"
    )


def update_paths(
    session_data, active_report, remote_connection
):
    if active_report.get("profile_name"):
        session_data.profiler_path = get_profiler_path(
            profile_name=active_report["profile_name"],
            current_app=current_app,
            remote_connection=remote_connection,
        )

    if active_report.get("report_name"):
        session_data.report_path = get_report_path(
            active_report=active_report,
            current_app=current_app,
            remote_connection=remote_connection,
        )

    if active_report.get("npe_name"):
        session_data.npe_path = get_npe_path(
            npe_name=active_report["npe_name"],
            current_app=current_app
        )


def create_new_tab_session(
    tab_id,
    report_name,
    profile_name,
    npe_name,
    remote_connection,
    remote_folder,
    remote_profile_folder,
    clear_remote,
):
    active_report = {}
    if report_name:
        active_report["report_name"] = report_name
    if profile_name:
        active_report["profile_name"] = profile_name
    if npe_name:
        active_report["npe_name"] = npe_name

    if clear_remote:
        remote_connection = None
        remote_folder = None
        remote_profile_folder = None

    session_data = TabSessionTable(
        tab_id=tab_id,
        active_report=active_report,
        report_path=get_report_path(
            active_report,
            current_app=current_app,
            remote_connection=remote_connection,
        ),
        remote_connection=(
            remote_connection.model_dump() if remote_connection else None
        ),
        remote_folder=remote_folder.model_dump() if remote_folder else None,
        remote_profile_folder=(
            remote_profile_folder.model_dump() if remote_profile_folder else None
        ),
    )
    db.session.add(session_data)
    return session_data


def update_tab_session(
    tab_id,
    report_name=None,
    profile_name=None,
    npe_name=None,
    remote_connection=None,
    remote_folder=None,
    remote_profile_folder=None,
    clear_remote=False,
):
    try:
        session_data = get_or_create_tab_session(tab_id)

        if session_data:
            update_existing_tab_session(
                session_data,
                report_name,
                profile_name,
                npe_name,
                remote_connection,
                remote_folder,
                remote_profile_folder,
                clear_remote,
            )
        else:
            session_data = create_new_tab_session(
                tab_id,
                report_name,
                profile_name,
                npe_name,
                remote_connection,
                remote_folder,
                remote_profile_folder,
                clear_remote,
            )

        commit_and_log_session(session_data, tab_id)
        return jsonify({"message": "Tab session updated successfully"}), 200

    except SQLAlchemyError as e:
        handle_sqlalchemy_error(e)
        return jsonify({"error": "Failed to update tab session"}), 500


def get_or_create_tab_session(
    tab_id,
    report_name=None,
    profile_name=None,
    npe_name=None,
    remote_connection=None,
    remote_folder=None,
):
    """
    Retrieve an existing tab session or create a new one if it doesn't exist.
    Uses the TabSession model to manage session data and supports conditional updates.
    """
    try:
        # Query the database for the tab session
        session_data = TabSessionTable.query.filter_by(tab_id=tab_id).first()

        # If session doesn't exist, initialize it
        if not session_data:
            session_data = TabSessionTable(
                tab_id=tab_id,
                active_report={},
                remote_connection=None,
                remote_folder=None,
            )
            db.session.add(session_data)
            db.session.commit()

        # Update the session if any new data is provided
        if report_name or profile_name or npe_name or remote_connection or remote_folder:
            update_tab_session(
                tab_id=tab_id,
                report_name=report_name,
                profile_name=profile_name,
                npe_name=npe_name,
                remote_connection=remote_connection,
                remote_folder=remote_folder,
            )

        # Query again to get the updated session data
        session_data = TabSessionTable.query.filter_by(tab_id=tab_id).first()

        return session_data

    except SQLAlchemyError as e:
        current_app.logger.error(f"Failed to get or create tab session: {str(e)}")
        db.session.rollback()
        return None


def get_tab_session():
    """
    Middleware to retrieve or create a tab session based on the tab_id.
    """
    tab_id = request.args.get("tabId", None)

    current_app.logger.info(f"get_tab_session: Received tab_id: {tab_id}")
    if not tab_id:
        current_app.logger.error("get_tab_session: No tab_id found")
        return jsonify({"error": "tabId is required"}), 400

    active_report = get_or_create_tab_session(tab_id)
    current_app.logger.info(
        f"get_tab_session: Session retrieved: {active_report.active_report}"
    )

    return jsonify({"active_report": active_report.active_report}), 200


def init_sessions(app):
    """
    Initializes session middleware and hooks it into Flask.
    """
    app.before_request(get_tab_session)
    app.logger.info("Sessions middleware initialized.")
