from logging import getLogger

from flask import request, jsonify, current_app

from ttnn_visualizer.models import RemoteConnection, RemoteFolder, TabSession
from ttnn_visualizer.extensions import db

logger = getLogger(__name__)


def update_tab_session(
    tab_id,
    active_report_data,
    remote_connection: RemoteConnection = None,
    remote_folder: RemoteFolder = None,
):
    """
    Overwrite the active report for a given tab session or create a new session if one doesn't exist.
    Store everything in the database using the TabSession model.
    """
    active_report = {"name": active_report_data.get("name")}

    # Query the database to find the existing tab session
    session_data = TabSession.query.filter_by(tab_id=tab_id).first()
    remote_folder_data = remote_folder.dict() if remote_folder else None
    remote_connection_data = remote_connection.dict() if remote_connection else None

    if session_data:
        session_data.remote_folder = remote_folder_data
        session_data.remote_connection = remote_connection_data
        session_data.active_report = active_report

    else:
        # Create a new session entry
        session_data = TabSession(
            tab_id=tab_id,
            active_report=active_report,
            remote_connection=remote_connection_data,
            remote_folder=remote_folder_data,
        )

        db.session.add(session_data)

    db.session.commit()

    current_app.logger.info(f"Session data for tab {tab_id}: {session_data.__dict__}")

    return jsonify({"message": "Tab session updated with new active report"}), 200


def get_or_create_tab_session(
    tab_id, active_report_data=None, remote_connection=None, remote_folder=None
):
    """
    Retrieve an existing tab session or create a new one if it doesn't exist.
    Uses the TabSession model to manage session data.
    """
    # Query the database for the tab session
    session_data = TabSession.query.filter_by(tab_id=tab_id).first()

    # If session doesn't exist, initialize it
    if not session_data:
        session_data = TabSession(
            tab_id=tab_id, active_report={}, remote_connection=None
        )
        db.session.add(session_data)
        db.session.commit()

    # If active_report_data is provided, update the session with the new report
    if active_report_data:
        update_tab_session(tab_id, active_report_data, remote_connection, remote_folder)

    return session_data


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
