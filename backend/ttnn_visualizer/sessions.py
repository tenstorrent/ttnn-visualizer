from flask import request, jsonify, session, current_app, Request
from pathlib import Path


def update_tab_session(tab_id, active_report_data, remote_connection_data=None):
    """
    Overwrite the active report for a given tab session or create a new session if one doesn't exist.
    Store everything in Flask-Session using tab_id as the key.
    """
    # Create or update the active report
    active_report = {"name": active_report_data.get("name")}

    # Check if remote connection data is provided and add it to the active report
    if remote_connection_data:
        remote_connection = {
            "name": remote_connection_data.get("name"),
            "username": remote_connection_data.get("username"),
            "host": remote_connection_data.get("host"),
            "port": remote_connection_data.get("port"),
            "path": remote_connection_data.get("path"),
        }
        active_report["remote_connection"] = remote_connection

    # Store the active report in the session using the tab_id as the key
    session[tab_id] = {"active_report": active_report}

    session.modified = True
    return jsonify({"message": "Tab session updated with new active report"}), 200


def get_or_create_tab_session(
    tab_id, active_report_data=None, remote_connection_data=None
):
    """
    Retrieve an existing tab session or create a new one if it doesn't exist.
    Uses Flask-Session for session management with tab_id as the key.
    Initializes session data as an empty dictionary if it doesn't exist.
    """
    # Check if the session exists for the given tab_id
    session_data = session.get(tab_id)

    # If session doesn't exist, initialize it as an empty dictionary
    if not session_data:
        session[tab_id] = {}  # Initialize empty session data
        session_data = session.get(tab_id)

    # If active_report_data is provided, update the session with the new report
    if active_report_data:
        update_tab_session(tab_id, active_report_data, remote_connection_data)

    session.modified = True

    return session.get(tab_id), not bool(session_data)


def get_tab_session():
    """
    Middleware to retrieve or create a tab session based on the tab_id.
    """
    tab_id = request.args.get("tabId", None)

    current_app.logger.info(f"get_tab_session: Received tab_id: {tab_id}")
    if not tab_id:
        current_app.logger.error("get_tab_session: No tab_id found")
        return jsonify({"error": "tabId is required"}), 400

    active_report, created = get_or_create_tab_session(tab_id)
    current_app.logger.info(f"get_tab_session: Session retrieved: {active_report}")


# Function to initialize the session logic and middleware
def init_sessions(app):
    """
    Initializes session middleware and hooks it into Flask.
    """
    app.before_request(get_tab_session)

    app.logger.info("Sessions middleware initialized.")
