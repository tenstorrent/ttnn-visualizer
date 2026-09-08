# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Regression tests for Flask-SocketIO integration.

A full connect must run Flask-SocketIO's request-context + managed-session
setup. Flask 3.1+ made ``RequestContext.session`` read-only; older
Flask-SocketIO expected to assign to ``ctx.session``, which raised
``AttributeError: can't set attribute 'session'`` on every connection.
"""

from ttnn_visualizer.extensions import socketio


def test_socketio_connect_runs_handler(app):
    """A Socket.IO connect should complete without error (session + handler).

    The production connect handler in ``sockets`` requires ``instanceId``; without
    it the handler calls ``disconnect()``. We pass ``instanceId`` so the
    connection stays up and the handler body runs, while still exercising the
    same connect path that previously broke under Flask 3.1.
    """
    http = app.test_client()
    sio = socketio.test_client(
        app,
        query_string="instanceId=pytest-socketio",
        flask_test_client=http,
    )
    try:
        assert sio.is_connected(
            "/"
        ), "Socket.IO client should be connected on the default namespace"
    finally:
        if sio.is_connected("/"):
            sio.disconnect()
