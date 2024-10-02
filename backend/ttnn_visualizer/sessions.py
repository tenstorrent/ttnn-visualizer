import sqlite3
import json
import threading
from pathlib import Path
from typing import TypedDict, cast

from flask import request, jsonify, g, Request

# Path to the SQLite database for sessions
DATABASE = "sessions.db"


# Define a TypedDict for the nested structure of the request data
class ActiveReport(TypedDict, total=False):
    name: str
    hostname: str


class TabSessionData(TypedDict):
    active_report: ActiveReport


# Custom request class with session data
class CustomRequest(Request):
    tab_session_data: TabSessionData
    tab_id: str
    report_path: str


def get_report_path_from_request():
    """
    Gets the currently active report path from the request
    :return:
    """
    from flask import current_app, request as flask_request

    database_file_name = current_app.config["SQLITE_DB_PATH"]
    local_dir = current_app.config["LOCAL_DATA_DIRECTORY"]
    remote_dir = current_app.config["REMOTE_DATA_DIRECTORY"]

    # For type hinting
    request = cast(CustomRequest, flask_request)

    if hasattr(request, "tab_session_data"):
        tab_session_data = request.tab_session_data
        active_report = tab_session_data.get("active_report", None)
        if active_report:
            hostname = active_report.get("hostname", None)
            if hostname:
                base_dir = Path(remote_dir).joinpath(hostname)
            else:
                base_dir = local_dir
            report_path = Path(base_dir).joinpath(active_report.get("name", ""))
            target_path = str(Path(report_path).joinpath(database_file_name))
            request.report_path = target_path or ""
        else:
            request.report_path = ""


# Function to initialize the SQLite database and create the tab_sessions table if it doesn't exist
def init_session_db():

    with threading.Lock():
        print("Initializing session database")
        with sqlite3.connect(DATABASE, timeout=30, isolation_level=None) as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS tab_sessions (
                    tab_id TEXT PRIMARY KEY,
                    session_data TEXT
                )
            """
            )
            conn.commit()


# Function to get a database connection from the Flask `g` object
def get_db():
    with threading.Lock():
        db = getattr(g, "_session_database", None)
        if db is None:
            db = g._database = sqlite3.connect(
                DATABASE, timeout=30, isolation_level=None
            )
        return db


# Function to handle session data retrieval and creation
def handle_tab_session(tab_id):
    db = get_db()
    cur = db.cursor()
    cur.execute("SELECT session_data FROM tab_sessions WHERE tab_id = ?", (tab_id,))
    row = cur.fetchone()

    if row is None:
        # No session data found, create a new session for this tab as a dictionary
        session_data = {"tab_id": tab_id}
        cur.execute(
            "INSERT INTO tab_sessions (tab_id, session_data) VALUES (?, ?)",
            (tab_id, json.dumps(session_data)),
        )
        db.commit()
    else:
        # Session data exists, load it and convert back to a dictionary
        session_data = json.loads(
            row[0]
        )  # Deserialize the JSON string back to a Python dictionary

    return session_data


# Function to update the session data for a given tab_id
def update_tab_session(new_data):
    tab_id = request.args.get("tabId", None)
    if not tab_id:
        return
    db = get_db()
    cur = db.cursor()

    # Retrieve existing session data
    cur.execute("SELECT session_data FROM tab_sessions WHERE tab_id = ?", (tab_id,))
    row = cur.fetchone()

    if row:
        # Update the session data by merging the existing data with new data
        existing_data = json.loads(row[0])  # Deserialize the existing JSON string
        existing_data.update(new_data)  # Update the dictionary with new data
        cur.execute(
            "UPDATE tab_sessions SET session_data = ? WHERE tab_id = ?",
            (json.dumps(existing_data), tab_id),
        )
    else:
        # If no existing session, create a new session with the new data
        session_data = new_data
        cur.execute(
            "INSERT INTO tab_sessions (tab_id, session_data) VALUES (?, ?)",
            (tab_id, json.dumps(session_data)),
        )

    db.commit()


# Middleware to fetch or create per-tab session data and attach it to the `request` object
def get_tab_session():
    tab_id = request.args.get("tabId", None)
    if tab_id:
        request.tab_id = tab_id
        request.tab_session_data = handle_tab_session(tab_id)


# Middleware to close the SQLite database connection after each request
def close_db_connection(exception):
    db = getattr(g, "_session_database", None)
    if db is not None:
        db.close()


# Function to initialize the session logic and middleware
def init_sessions(app):

    # Add the middleware to the Flask app
    app.before_request(get_tab_session)
    app.before_request(get_report_path_from_request)
    app.teardown_appcontext(close_db_connection)

    app.logger.info("Sessions middleware initialized.")
