# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for the file-status socket debounce behaviour.

The debounce smooths out chatty intermediate updates (STARTED/DOWNLOADING)
during fast multi-file syncs. Terminal updates (FINISHED/FAILED) must
*always* flush immediately so the client sees the final state before its
own post-request reset (otherwise a 500ms-delayed FINISHED can land after
the overlay has been reset and briefly reopen it).
"""

from unittest.mock import MagicMock

import pytest
from ttnn_visualizer import sockets
from ttnn_visualizer.sockets import FileProgress, FileStatus, emit_file_status


@pytest.fixture
def fake_socketio(monkeypatch):
    """Replace module-level `socketio` with a mock and reset debounce state."""
    fake = MagicMock()
    monkeypatch.setattr(sockets, "socketio", fake)
    monkeypatch.setattr(sockets, "debounce_timer", None)
    monkeypatch.setattr(sockets, "last_emit_time", 0)
    yield fake
    # Stop any timer the test may have spawned so it doesn't fire post-teardown.
    if sockets.debounce_timer is not None:
        sockets.debounce_timer.cancel()
    sockets.debounce_timer = None


def _progress(status: FileStatus) -> FileProgress:
    return FileProgress(
        current_file_name="example.txt",
        number_of_files=1,
        percent_of_current=0,
        finished_files=0,
        status=status,
    )


def test_intermediate_status_emits_first_call_immediately(fake_socketio):
    # First emit after a long idle period flushes immediately.
    emit_file_status(_progress(FileStatus.DOWNLOADING), instance_id="abc")
    assert fake_socketio.emit.call_count == 1


def test_intermediate_burst_is_debounced(fake_socketio):
    # First call flushes; immediate follow-ups within the debounce window
    # should *not* emit synchronously (they schedule a timer instead).
    emit_file_status(_progress(FileStatus.DOWNLOADING), instance_id="abc")
    assert fake_socketio.emit.call_count == 1

    emit_file_status(_progress(FileStatus.DOWNLOADING), instance_id="abc")
    emit_file_status(_progress(FileStatus.DOWNLOADING), instance_id="abc")
    assert fake_socketio.emit.call_count == 1
    assert sockets.debounce_timer is not None


def test_finished_status_flushes_immediately_even_during_debounce(fake_socketio):
    # Prime the debounce so the next intermediate call would be queued.
    emit_file_status(_progress(FileStatus.DOWNLOADING), instance_id="abc")
    emit_file_status(_progress(FileStatus.DOWNLOADING), instance_id="abc")
    assert fake_socketio.emit.call_count == 1
    assert sockets.debounce_timer is not None

    emit_file_status(_progress(FileStatus.FINISHED), instance_id="abc")

    # FINISHED must emit synchronously and cancel the queued intermediate.
    assert fake_socketio.emit.call_count == 2
    assert sockets.debounce_timer is None


def test_failed_status_flushes_immediately(fake_socketio):
    emit_file_status(_progress(FileStatus.DOWNLOADING), instance_id="abc")
    emit_file_status(_progress(FileStatus.DOWNLOADING), instance_id="abc")
    assert fake_socketio.emit.call_count == 1

    emit_file_status(_progress(FileStatus.FAILED), instance_id="abc")

    assert fake_socketio.emit.call_count == 2
    assert sockets.debounce_timer is None


def test_finished_payload_carries_terminal_status(fake_socketio):
    emit_file_status(_progress(FileStatus.FINISHED), instance_id="abc")
    assert fake_socketio.emit.call_count == 1
    _, args, kwargs = fake_socketio.emit.mock_calls[0]
    payload = args[1]
    assert payload["status"] == FileStatus.FINISHED.value
    assert payload["instance_id"] == "abc"
    assert kwargs.get("to") == "abc"


def test_terminal_status_does_not_race_a_firing_timer(fake_socketio):
    """A queued timer callback that fires *after* a terminal FINISHED has
    cancelled it must bail out, not emit a stale DOWNLOADING.

    Deterministic reconstruction of the production race:
      1. Queue a DOWNLOADING timer (captures its callback closure).
      2. Send FINISHED — flushes immediately, clears `debounce_timer`.
      3. Manually invoke the captured callback, simulating the case where
         `Timer.run()` had already entered the callback before `cancel()`
         won the race. The identity check inside `deferred_emit` must
         observe `debounce_timer is not scheduled[0]` and return without
         emitting.

    No `time.sleep`, no real timer scheduling — flake-free on slow CI.
    """
    emit_file_status(_progress(FileStatus.DOWNLOADING), instance_id="abc")  # flushes
    emit_file_status(_progress(FileStatus.DOWNLOADING), instance_id="abc")  # queued
    assert fake_socketio.emit.call_count == 1
    assert sockets.debounce_timer is not None

    queued_callback = sockets.debounce_timer.function

    emit_file_status(_progress(FileStatus.FINISHED), instance_id="abc")
    assert fake_socketio.emit.call_count == 2
    assert sockets.debounce_timer is None

    # Simulate the racing Timer thread invoking its callback after the
    # terminal flush has already cleared `debounce_timer`.
    queued_callback()

    assert fake_socketio.emit.call_count == 2  # still 2 — bailed out
    statuses = [call.args[1]["status"] for call in fake_socketio.emit.mock_calls]
    assert statuses == [FileStatus.DOWNLOADING.value, FileStatus.FINISHED.value]
    assert sockets.debounce_timer is None
