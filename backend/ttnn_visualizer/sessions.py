# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

from logging import getLogger

from flask import request

from ttnn_visualizer.utils import get_report_path, get_profiler_path
from ttnn_visualizer.models import (
    TabSessionTable,
)
from ttnn_visualizer.extensions import db

logger = getLogger(__name__)

from flask import jsonify, current_app
from sqlalchemy.exc import SQLAlchemyError
import json


def update_tab_session(
    tab_id,
    report_name=None,
    profile_name=None,
    remote_connection=None,
    remote_folder=None,
):
    """
    Conditionally update the active report and related fields for a given tab session.
    Updates `report_name`, `profile_name`, `remote_connection`, and/or `remote_folder` if provided.
    Retains existing data and creates a new session if one doesn't exist.
    """
    try:
        # Query the database for the existing tab session
        session_data = TabSessionTable.query.filter_by(tab_id=tab_id).first()

        if session_data:
            # Retain existing active report data
            active_report = session_data.active_report or {}

            # Conditionally update active report fields
            if report_name:
                active_report["report_name"] = report_name
            if profile_name:
                active_report["profile_name"] = profile_name

            # Explicitly assign the updated active_report back to the session_data
            session_data.active_report = active_report
            if remote_connection:
                session_data.remote_connection = remote_connection.model_dump()
            if remote_folder:
                session_data.remote_folder = remote_folder.model_dump()

            # Update the report path if `report_name` or `remote_connection` changes
            session_data.report_path = get_report_path(
                active_report,
                current_app=current_app,
                remote_connection=remote_connection,
            )

            if active_report.get("report_name", None) and active_report.get(
                "profile_name", None
            ):
                # Update the report path if `report_name` or `remote_connection` changes
                session_data.profiler_path = get_profiler_path(
                    profile_name=active_report["profile_name"],
                    current_app=current_app,
                    report_name=active_report["report_name"],
                )

        else:
            # Create a new tab session with the provided data
            active_report = {}
            if report_name:
                active_report["report_name"] = report_name
            if profile_name:
                active_report["profile_name"] = profile_name

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
            )
            db.session.add(session_data)

        # Commit changes to the database
        db.session.commit()

        # Re-retrieve the session data to ensure we log the latest state
        session_data = TabSessionTable.query.filter_by(tab_id=tab_id).first()

        current_app.logger.info(
            f"Session data for tab {tab_id}: {json.dumps(session_data.to_dict(), indent=4)}"
        )

        return jsonify({"message": "Tab session updated successfully"}), 200

    except SQLAlchemyError as e:
        current_app.logger.error(f"Failed to update tab session: {str(e)}")
        db.session.rollback()
        return jsonify({"error": "Failed to update tab session"}), 500


def get_or_create_tab_session(
    tab_id,
    report_name=None,
    profile_name=None,
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
        if report_name or profile_name or remote_connection or remote_folder:
            update_tab_session(
                tab_id=tab_id,
                report_name=report_name,
                profile_name=profile_name,
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
