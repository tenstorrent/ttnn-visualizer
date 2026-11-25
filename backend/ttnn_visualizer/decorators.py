# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import logging
import re
import secrets
from functools import wraps
from typing import Any, Callable, Optional
from urllib.parse import quote

from flask import Response, abort, after_this_request, request, session
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.exceptions import (
    AuthenticationException,
    AuthenticationFailedException,
    ConnectionDroppedError,
    HostKeyVerificationException,
    HostKeyVerificationFailedException,
    NoValidConnectionsError,
    RemoteConnectionException,
    RemoteFileReadException,
    SSHException,
    UnreachableHostException,
    response_forbidden,
)
from ttnn_visualizer.extensions import db
from ttnn_visualizer.instances import get_or_create_instance
from ttnn_visualizer.models import InstanceTable
from ttnn_visualizer.ssh_client import SSH_AUTH_FAILURE_MESSAGE

logger = logging.getLogger(__name__)

# Mirrored by ACTIVE_MEMORY_REPORT_HEADER in src/definitions/ReportHeaders.ts;
# tests/test_report_headers_frontend_parity.py pins the two together.
ACTIVE_MEMORY_REPORT_HEADER = "X-Active-Memory-Report"


# The `reason` a hosted request gets when its instance belongs to another session. The
# frontend matches it to start the tab afresh on a new instance ID.
INSTANCE_NOT_OWNED = "instance_not_owned"


def ensure_instance_owner() -> str:
    """This hosted session's owner token, made on first use.

    The page itself mints it (`app.catch_all`): a page load's first API requests leave
    together, and if each minted its own, all but one would be refused as another
    session's. Minting here as well covers clients that never load the page.
    """
    owner = session.get("instance_owner")
    if not owner:
        owner = secrets.token_urlsafe(16)
        session["instance_owner"] = owner
    return owner


def _hosted_instance_for_session(instance_id: str) -> Optional[InstanceTable]:
    """The instance *instance_id* names, or None when this hosted session doesn't own it.

    A new ID becomes this session's instance. An existing one is this session's only if
    it was created here: instance IDs travel in every query string, so holding one
    proves nothing. A row with no owner goes to the first session that uses it; hosted
    rows always have one, since `DB_VERSION` moved with migration 002 and rows from
    before it stay in the old database file.
    """
    owner = ensure_instance_owner()
    instance_data = get_or_create_instance(instance_id=instance_id, owner=owner)
    if instance_data is None:
        abort(500)
    if instance_data.owner == owner:
        return instance_data
    if instance_data.owner is None:
        instance_data.owner = owner
        db.session.commit()
        return instance_data
    return None


def _instance_not_owned_response():
    return response_forbidden(
        "This instance belongs to another session.", reason=INSTANCE_NOT_OWNED
    )


def hosted_instance_owner_required(func):
    """Refuse a hosted request naming an instance another session owns.

    For routes that read `instanceId` themselves rather than through `with_instance`.
    Locally there is one user, so every instance is theirs.
    """

    @wraps(func)
    def wrapper(*args, **kwargs):
        from flask import current_app

        instance_id = request.args.get("instanceId")
        if (
            current_app.config["SERVER_MODE"]
            and instance_id
            and _hosted_instance_for_session(instance_id) is None
        ):
            logger.warning("Refusing a hosted request for another session's instance")
            return _instance_not_owned_response()

        return func(*args, **kwargs)

    return wrapper


def with_instance(func):
    """Resolves the request's instance and passes it to the view as ``instance``.

    Every response names the memory report the view read in the
    ``X-Active-Memory-Report`` header, percent-encoded because folder names need not
    be Latin-1. A later pick can make another report active before an earlier
    request is handled, and the client caches each answer under the report it asked
    about, so it discards an answer for another report rather than caching it
    (#2375). The name comes from the same snapshot the view reads, and the header is
    set through ``after_this_request`` so error-handler responses carry it too.
    """

    @wraps(func)
    def wrapper(*args, **kwargs):
        from flask import current_app

        instance_id = request.args.get("instanceId")

        if not instance_id:
            current_app.logger.error("No instanceId present on request, returning 400")
            abort(400, description="Missing required query parameter: instanceId")

        if current_app.config["SERVER_MODE"]:
            instance_query_data = _hosted_instance_for_session(instance_id)
            if instance_query_data is None:
                logger.warning(
                    "Refusing a hosted request for another session's instance"
                )
                return _instance_not_owned_response()
        else:
            instance_query_data = get_or_create_instance(instance_id=instance_id)

        # Handle case where get_or_create_instance returns None due to database error
        if instance_query_data is None:
            current_app.logger.error(
                f"Failed to get or create instance with ID: {instance_id}"
            )
            abort(500)

        instance = instance_query_data.to_pydantic()

        kwargs["instance"] = instance

        active_memory_report = (
            instance.active_report.profiler_name if instance.active_report else None
        ) or ""

        @after_this_request
        def _name_active_memory_report(response: Response) -> Response:
            response.headers[ACTIVE_MEMORY_REPORT_HEADER] = quote(
                active_memory_report, safe=""
            )
            return response

        if "instances" not in session:
            session["instances"] = []

        if instance.instance_id not in session["instances"]:
            max_reports = current_app.config["SESSION_MAX_UPLOADED_REPORTS"]
            session["instances"] = (
                session.get("instances", []) + [instance.instance_id]
            )[-max_reports:]

        return func(*args, **kwargs)

    return wrapper


def remote_exception_handler(func):
    from flask import current_app

    def remote_handler(*args, **kwargs):
        if kwargs.get("connection", None):
            connection = kwargs["connection"]
        elif kwargs.get("remote_connection", None):
            connection = kwargs["remote_connection"]
        else:
            connection = args[0]
        try:
            return func(*args, **kwargs)
        except HostKeyVerificationException as err:
            current_app.logger.warning(
                "SSH host key not trusted for %s@%s:%s",
                connection.username,
                connection.host,
                connection.port,
            )
            raise HostKeyVerificationFailedException(
                message=str(err),
                status=ConnectionTestStates.FAILED,
            )
        except AuthenticationException as err:
            current_app.logger.warning(
                f"SSH authentication failed for {connection.username}@{connection.host}: SSH key authentication required"
            )
            raise AuthenticationFailedException(
                message=SSH_AUTH_FAILURE_MESSAGE,
                status=ConnectionTestStates.FAILED,
            )
        except FileNotFoundError as err:
            current_app.logger.error(f"File not found: {str(err)}")
            raise RemoteConnectionException(
                status=ConnectionTestStates.FAILED,
                message=f"Unable to open path: {str(err)}",
            )
        except ConnectionDroppedError as err:
            # Ahead of its parent below: the host answered and then went away, so the
            # refused-every-attempt advice would send the user to check the hostname.
            current_app.logger.warning(
                f"SSH connection lost for {connection.username}@{connection.host}: {str(err)}"
            )
            raise UnreachableHostException.for_dropped_connection(
                connection.host, detail=str(err)
            )
        except NoValidConnectionsError as err:
            current_app.logger.warning(
                f"SSH connection failed for {connection.username}@{connection.host}: {str(err)}"
            )

            raise UnreachableHostException.for_host(connection.host)

        except IOError as err:
            message = f"Error opening remote folder: {str(err)}"
            if "Name or service not known" in str(err):
                message = f"Unable to connect to {connection.host} - check hostname"
            raise RemoteConnectionException(
                status=ConnectionTestStates.FAILED,
                message=message,
            )
        except SSHException as err:
            if str(err) == "No existing session":
                message = "SSH authentication failed. Please ensure SSH keys are configured and ssh-agent is running."
            else:
                err_message = re.sub(r"\[.*?]", "", str(err)).strip()
                message = f"SSH connection error to {connection.host}: {err_message}. Ensure SSH key-based authentication is properly configured."

            raise RemoteConnectionException(
                status=ConnectionTestStates.FAILED, message=message
            )
        except RemoteFileReadException:
            raise
        except RemoteConnectionException:
            # Already a domain-shaped error with its own http_status / detail;
            # rewrapping it via the catch-all below would silently drop any
            # custom http_status_code (e.g. 422 for "path unreadable") and
            # downgrade it to the default 500.
            raise
        except Exception as err:
            # Catch any other unhandled exceptions
            current_app.logger.exception(
                f"Unexpected error during remote operation for {connection}: {str(err)}"
            )
            raise RemoteConnectionException(
                status=ConnectionTestStates.FAILED,
                message=str(err),
            )

    return remote_handler


def local_only(f):
    from flask import current_app

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if current_app.config["SERVER_MODE"]:
            abort(403, description="Endpoint not accessible")

        return f(*args, **kwargs)

    return decorated_function


DIRECT_REPORT_MODE_DELETE_REFUSAL = (
    "Reports read from TT_METAL_HOME are not managed by TT-NN Visualizer "
    "and cannot be deleted."
)


def refuse_in_direct_report_mode(f: Callable[..., Any]) -> Callable[..., Any]:
    """Refuse a report delete when the paired listing reads the TT-Metal tree.

    In direct-report mode ``GET /profiler`` and ``GET /performance`` list
    ``$TT_METAL_HOME/generated/...``, which the app neither created nor manages. Saying so
    is more honest than a 404 against a local data directory the client never saw listed.

    Returns the refusal rather than calling ``abort`` so the body carries the reason as
    ``{"error": ...}``, which is the shape the SPA's ``getResponseError`` reads.
    """
    from flask import current_app
    from ttnn_visualizer.utils import create_path_resolver

    @wraps(f)
    def decorated_function(*args: Any, **kwargs: Any) -> Any:
        if create_path_resolver(current_app).is_direct_report_mode:
            return response_forbidden(DIRECT_REPORT_MODE_DELETE_REFUSAL)

        return f(*args, **kwargs)

    return decorated_function
