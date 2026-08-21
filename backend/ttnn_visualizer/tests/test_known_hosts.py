# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import subprocess
from http import HTTPStatus
from pathlib import Path

import pytest
from ttnn_visualizer.enums import HostKeyIssue
from ttnn_visualizer.known_hosts import (
    append_host_keys,
    host_key_fingerprint,
    known_hosts_entry_name,
    resolve_ssh_target,
    scan_host_keys,
    search_known_hosts,
)
from ttnn_visualizer.models import HostKeyOffer, HostKeyTarget

HOST_KEY_ENDPOINT = "/api/remote/host-key"
HOST_KEY_TRUST_ENDPOINT = "/api/remote/host-key/trust"

# Real GitHub host keys, kept with the fingerprints `ssh-keygen -l` prints for them so
# the pure fingerprint computation is pinned against OpenSSH rather than against itself.
ED25519_BLOB = "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"
ED25519_FINGERPRINT = "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"
ECDSA_BLOB = (
    "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwF"
    "B9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg="
)
ECDSA_FINGERPRINT = "SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM"

SCAN_HOST = "aus-wh-05"
SCAN_PORT = 45985
SCAN_ENTRY = f"[{SCAN_HOST}]:{SCAN_PORT}"


def _target(**overrides) -> HostKeyTarget:
    return HostKeyTarget(
        **{"host": SCAN_HOST, "port": SCAN_PORT, "identityFile": None, **overrides}
    )


def _completed(stdout: str = "", stderr: str = "", returncode: int = 0):
    return subprocess.CompletedProcess(
        args=[], returncode=returncode, stdout=stdout, stderr=stderr
    )


def _offer_line(blob: str = ED25519_BLOB, entry: str = SCAN_ENTRY) -> str:
    key_type = "ssh-ed25519" if blob == ED25519_BLOB else "ecdsa-sha2-nistp256"
    return f"{entry} {key_type} {blob}"


def _patch_run(monkeypatch, handler):
    """Route `subprocess.run` in this module by the program being invoked."""
    monkeypatch.setattr("ttnn_visualizer.known_hosts.subprocess.run", handler)


class TestFingerprints:
    @pytest.mark.parametrize(
        "blob,expected",
        [(ED25519_BLOB, ED25519_FINGERPRINT), (ECDSA_BLOB, ECDSA_FINGERPRINT)],
    )
    def test_the_fingerprint_matches_what_ssh_keygen_prints(self, blob, expected):
        assert host_key_fingerprint(blob) == expected

    @pytest.mark.parametrize("blob", ["not base64!", "", "===="])
    def test_an_unreadable_blob_has_no_fingerprint(self, blob):
        assert host_key_fingerprint(blob) is None


class TestEntryNames:
    def test_the_default_port_is_keyed_on_the_bare_host(self):
        assert known_hosts_entry_name("h", 22) == "h"

    def test_any_other_port_is_keyed_in_brackets(self):
        assert known_hosts_entry_name("h", 2222) == "[h]:2222"


class TestResolvingTheTarget:
    def test_config_resolves_both_the_hostname_and_the_port(self, monkeypatch):
        """`ssh -G` answers with the stanza's HostName *and* Port.

        Taking only the hostname would key the entry on the port the user typed, which
        is not the port OpenSSH connects to.
        """
        _patch_run(
            monkeypatch,
            lambda *a, **k: _completed(
                stdout="user git\nhostname ssh.github.com\nport 443\n"
            ),
        )

        resolved = resolve_ssh_target(_target(port=22))

        assert resolved.scan_host == "ssh.github.com"
        assert resolved.scan_port == 443
        assert resolved.entry_name == "[ssh.github.com]:443"
        assert resolved.alias == SCAN_HOST

    def test_a_host_key_alias_wins_over_the_resolved_name(self, monkeypatch):
        _patch_run(
            monkeypatch,
            lambda *a, **k: _completed(
                stdout="hostname 10.0.0.1\nport 22\nhostkeyalias lab-key\n"
            ),
        )

        assert resolve_ssh_target(_target()).entry_name == "lab-key"

    def test_a_jump_host_is_reported_as_proxied(self, monkeypatch):
        _patch_run(
            monkeypatch,
            lambda *a, **k: _completed(
                stdout="hostname internal.example\nport 22\nproxyjump lab\n"
            ),
        )

        assert resolve_ssh_target(_target()).is_proxied is True

    def test_an_unset_proxy_command_is_not_proxied(self, monkeypatch):
        """`ssh -G` spells "no ProxyCommand" as the literal string "none"."""
        _patch_run(
            monkeypatch,
            lambda *a, **k: _completed(
                stdout="hostname h\nport 22\nproxycommand none\n"
            ),
        )

        assert resolve_ssh_target(_target()).is_proxied is False

    def test_a_repeated_keyword_keeps_the_first_value(self, monkeypatch):
        _patch_run(
            monkeypatch,
            lambda *a, **k: _completed(stdout="hostname first\nhostname second\n"),
        )

        assert resolve_ssh_target(_target()).scan_host == "first"

    def test_an_identity_file_skips_resolution_entirely(self, monkeypatch):
        """With `-F os.devnull` the connection reads no config, so nor do we.

        Running `ssh -G` here would resolve an alias the real connection never resolves,
        and record the key under a name it will not look up.
        """

        def fail(*args, **kwargs):
            raise AssertionError("ssh -G must not run when an identity file is set")

        _patch_run(monkeypatch, fail)

        resolved = resolve_ssh_target(_target(identityFile="/home/u/.ssh/id_ed25519"))

        assert resolved.scan_host == SCAN_HOST
        assert resolved.scan_port == SCAN_PORT
        assert resolved.entry_name == SCAN_ENTRY
        assert resolved.alias is None

    def test_the_port_flag_is_passed_only_for_a_non_default_port(self, monkeypatch):
        """Mirrors `SSHClient._build_base_ssh_cmd`: `-p` only when the port isn't 22.

        Passing it unconditionally would override a stanza's own `Port`, so the resolved
        target would disagree with the connection's.
        """
        argv_seen = []

        def record(argv, *args, **kwargs):
            argv_seen.append(argv)
            return _completed(stdout="hostname h\nport 22\n")

        _patch_run(monkeypatch, record)

        resolve_ssh_target(_target(port=22))
        resolve_ssh_target(_target(port=2222))

        assert "-p" not in argv_seen[0]
        assert argv_seen[1][argv_seen[1].index("-p") + 1] == "2222"

    def test_a_failed_resolution_falls_back_to_what_was_typed(self, monkeypatch):
        _patch_run(monkeypatch, lambda *a, **k: _completed(returncode=255))

        resolved = resolve_ssh_target(_target())

        assert resolved.scan_host == SCAN_HOST
        assert resolved.entry_name == SCAN_ENTRY


class TestScanningHostKeys:
    def test_banner_comments_on_stdout_are_not_read_as_keys(self, monkeypatch):
        """`ssh-keyscan` writes its `# host:port SSH-2.0-…` banner to stdout, not stderr."""
        stdout = (
            f"# {SCAN_HOST}:{SCAN_PORT} SSH-2.0-OpenSSH_9.6\n"
            f"{_offer_line(ED25519_BLOB)}\n"
            f"# {SCAN_HOST}:{SCAN_PORT} SSH-2.0-OpenSSH_9.6\n"
            f"{_offer_line(ECDSA_BLOB)}\n"
        )
        _patch_run(monkeypatch, lambda *a, **k: _completed(stdout=stdout))

        offers = scan_host_keys(SCAN_HOST, SCAN_PORT)

        assert [offer.keyType for offer in offers] == [
            "ssh-ed25519",
            "ecdsa-sha2-nistp256",
        ]
        assert [offer.fingerprint for offer in offers] == [
            ED25519_FINGERPRINT,
            ECDSA_FINGERPRINT,
        ]
        # The line is echoed back verbatim so trusting appends what OpenSSH would.
        assert offers[0].line == _offer_line(ED25519_BLOB)

    def test_a_zero_exit_with_no_keys_is_a_failure_not_an_empty_host(self, monkeypatch):
        """`ssh-keyscan` exits 0 even when every lookup failed.

        Judging success by the status code would report "this host offers no keys" for a
        name that does not resolve, and the trust flow would then append nothing while
        looking like it worked.
        """
        _patch_run(
            monkeypatch,
            lambda *a, **k: _completed(
                stdout="",
                stderr=f"getaddrinfo {SCAN_HOST}: nodename nor servname provided\n",
                returncode=0,
            ),
        )

        assert scan_host_keys(SCAN_HOST, SCAN_PORT) == []

    def test_a_key_that_cannot_be_fingerprinted_is_dropped(self, monkeypatch):
        _patch_run(
            monkeypatch,
            lambda *a, **k: _completed(
                stdout=f"{SCAN_ENTRY} ssh-ed25519 not-base64!\n"
            ),
        )

        assert scan_host_keys(SCAN_HOST, SCAN_PORT) == []

    def test_a_timeout_yields_no_offers(self, monkeypatch):
        def timeout(*args, **kwargs):
            raise subprocess.TimeoutExpired(cmd="ssh-keyscan", timeout=1)

        _patch_run(monkeypatch, timeout)

        assert scan_host_keys(SCAN_HOST, SCAN_PORT) == []


class TestSearchingKnownHosts:
    def test_a_found_entry_reports_its_lines_and_location(self, monkeypatch):
        stdout = (
            f"# Host {SCAN_ENTRY} found: line 7 \n" f"{_offer_line(ED25519_BLOB)}\n"
        )
        _patch_run(monkeypatch, lambda *a, **k: _completed(stdout=stdout))

        match = search_known_hosts(SCAN_ENTRY, Path("/home/u/.ssh/known_hosts"))

        assert bool(match) is True
        assert match.location == "/home/u/.ssh/known_hosts:7"

    def test_exit_one_means_nothing_is_recorded(self, monkeypatch):
        _patch_run(monkeypatch, lambda *a, **k: _completed(returncode=1))

        assert bool(search_known_hosts(SCAN_ENTRY)) is False

    def test_exit_two_five_five_means_there_is_no_file(self, monkeypatch):
        _patch_run(
            monkeypatch,
            lambda *a, **k: _completed(
                returncode=255, stderr="Cannot stat: No such file or directory"
            ),
        )

        assert bool(search_known_hosts(SCAN_ENTRY)) is False

    def test_an_entry_matches_by_key_material_not_by_host_field(self, monkeypatch):
        """The host field differs between a scan and a stored entry under HostKeyAlias.

        Comparing whole lines would then call an already-trusted key "changed".
        """
        stdout = f"# Host x found: line 1 \nlab-key ssh-ed25519 {ED25519_BLOB}\n"
        _patch_run(monkeypatch, lambda *a, **k: _completed(stdout=stdout))

        match = search_known_hosts("lab-key")

        assert match.matches_any([_offer_line(ED25519_BLOB)]) is True
        assert match.matches_any([_offer_line(ECDSA_BLOB)]) is False


class TestAppendingHostKeys:
    def test_existing_content_is_left_byte_identical(self, tmp_path):
        known_hosts = tmp_path / "known_hosts"
        original = "other.example ssh-rsa AAAAB3Nz\n"
        known_hosts.write_text(original, encoding="utf-8")

        append_host_keys([_offer_line(ED25519_BLOB)], known_hosts)

        contents = known_hosts.read_text(encoding="utf-8")
        assert contents.startswith(original)
        assert contents.endswith(f"{_offer_line(ED25519_BLOB)}\n")

    def test_a_file_without_a_trailing_newline_is_not_joined_onto(self, tmp_path):
        """Appending to an unterminated last line would corrupt both entries."""
        known_hosts = tmp_path / "known_hosts"
        known_hosts.write_text("other.example ssh-rsa AAAAB3Nz", encoding="utf-8")

        append_host_keys([_offer_line(ED25519_BLOB)], known_hosts)

        lines = known_hosts.read_text(encoding="utf-8").splitlines()
        assert lines == ["other.example ssh-rsa AAAAB3Nz", _offer_line(ED25519_BLOB)]

    def test_a_missing_file_and_directory_are_created_with_ssh_modes(self, tmp_path):
        known_hosts = tmp_path / ".ssh" / "known_hosts"

        append_host_keys([_offer_line(ED25519_BLOB)], known_hosts)

        assert known_hosts.read_text(encoding="utf-8") == f"{_offer_line()}\n"
        # OpenSSH refuses a group- or world-readable key store.
        assert known_hosts.stat().st_mode & 0o777 == 0o600
        assert known_hosts.parent.stat().st_mode & 0o777 == 0o700

    def test_an_empty_file_gains_no_leading_blank_line(self, tmp_path):
        known_hosts = tmp_path / "known_hosts"
        known_hosts.touch()

        append_host_keys([_offer_line(ED25519_BLOB)], known_hosts)

        assert known_hosts.read_text(encoding="utf-8") == f"{_offer_line()}\n"


def _open_local_gate(app, monkeypatch, *, resolved=None, existing=None, offers=None):
    """Point both endpoints at fixtures, with the local-only gate open."""
    app.config["SERVER_MODE"] = False

    if resolved is not None:
        monkeypatch.setattr(
            "ttnn_visualizer.views.resolve_ssh_target", lambda target: resolved
        )
    if existing is not None:
        monkeypatch.setattr(
            "ttnn_visualizer.views.search_known_hosts", lambda entry: existing
        )
    if offers is not None:
        monkeypatch.setattr(
            "ttnn_visualizer.views.scan_host_keys", lambda host, port: list(offers)
        )


@pytest.fixture
def resolved_target():
    from ttnn_visualizer.known_hosts import ResolvedSshTarget

    return ResolvedSshTarget(
        requested_host=SCAN_HOST,
        scan_host=SCAN_HOST,
        scan_port=SCAN_PORT,
        entry_name=SCAN_ENTRY,
        is_proxied=False,
    )


@pytest.fixture
def offered_key():
    return HostKeyOffer(
        keyType="ssh-ed25519",
        fingerprint=ED25519_FINGERPRINT,
        line=_offer_line(ED25519_BLOB),
    )


def _payload(**overrides):
    return {"host": SCAN_HOST, "port": SCAN_PORT, **overrides}


class TestTheOfferEndpoint:
    def test_an_unknown_host_is_offered_with_its_fingerprint(
        self, app, client, monkeypatch, resolved_target, offered_key
    ):
        from ttnn_visualizer.known_hosts import KnownHostsMatch

        _open_local_gate(
            app,
            monkeypatch,
            resolved=resolved_target,
            existing=KnownHostsMatch(lines=[]),
            offers=[offered_key],
        )

        response = client.post(HOST_KEY_ENDPOINT, json=_payload())

        assert response.status_code == HTTPStatus.OK
        body = response.get_json()
        assert body["issue"] == HostKeyIssue.UNKNOWN.value
        assert body["offers"][0]["fingerprint"] == ED25519_FINGERPRINT

    def test_a_changed_key_is_reported_without_any_offer(
        self, app, client, monkeypatch, resolved_target, offered_key
    ):
        """No fingerprint is offered for a changed key, so nothing can be trusted."""
        from ttnn_visualizer.known_hosts import KnownHostsMatch

        _open_local_gate(
            app,
            monkeypatch,
            resolved=resolved_target,
            existing=KnownHostsMatch(
                lines=[f"{SCAN_ENTRY} ssh-ed25519 {ECDSA_BLOB}"],
                location="/home/u/.ssh/known_hosts:3",
            ),
            offers=[offered_key],
        )

        response = client.post(HOST_KEY_ENDPOINT, json=_payload())

        body = response.get_json()
        assert body["issue"] == HostKeyIssue.CHANGED.value
        assert body["offers"] == []
        assert body["knownHostsEntry"] == "/home/u/.ssh/known_hosts:3"

    def test_an_already_trusted_key_reports_no_issue(
        self, app, client, monkeypatch, resolved_target, offered_key
    ):
        """A recorded key that still matches means the failure was about something else."""
        from ttnn_visualizer.known_hosts import KnownHostsMatch

        _open_local_gate(
            app,
            monkeypatch,
            resolved=resolved_target,
            existing=KnownHostsMatch(lines=[offered_key.line], location="kh:1"),
            offers=[offered_key],
        )

        response = client.post(HOST_KEY_ENDPOINT, json=_payload())

        assert response.get_json()["issue"] is None

    def test_a_payload_without_a_host_is_rejected(self, app, client, monkeypatch):
        _open_local_gate(app, monkeypatch)

        response = client.post(HOST_KEY_ENDPOINT, json={"port": 22})

        assert response.status_code == HTTPStatus.BAD_REQUEST

    def test_a_port_out_of_range_is_rejected(self, app, client, monkeypatch):
        _open_local_gate(app, monkeypatch)

        response = client.post(HOST_KEY_ENDPOINT, json=_payload(port=99999))

        assert response.status_code == HTTPStatus.BAD_REQUEST

    def test_the_offer_endpoint_is_forbidden_in_server_mode(self, app, client):
        assert app.config["SERVER_MODE"] is True

        assert client.post(HOST_KEY_ENDPOINT, json=_payload()).status_code == 403


class TestTheTrustEndpoint:
    def test_a_confirmed_key_is_appended(
        self, app, client, monkeypatch, resolved_target, offered_key, tmp_path
    ):
        from ttnn_visualizer.known_hosts import KnownHostsMatch

        appended = []
        _open_local_gate(
            app,
            monkeypatch,
            resolved=resolved_target,
            existing=KnownHostsMatch(lines=[]),
            offers=[offered_key],
        )
        monkeypatch.setattr(
            "ttnn_visualizer.views.append_host_keys",
            lambda lines: appended.extend(lines),
        )

        response = client.post(
            HOST_KEY_TRUST_ENDPOINT,
            json={"target": _payload(), "fingerprints": [ED25519_FINGERPRINT]},
        )

        assert response.status_code == HTTPStatus.OK
        assert appended == [offered_key.line]

    def test_an_existing_entry_is_refused_and_left_untouched(
        self, app, client, monkeypatch, resolved_target, offered_key
    ):
        """The refusal that keeps this from being a one-click "trust anyway"."""
        from ttnn_visualizer.known_hosts import KnownHostsMatch

        def fail(lines):
            raise AssertionError("must not write over an existing entry")

        _open_local_gate(
            app,
            monkeypatch,
            resolved=resolved_target,
            existing=KnownHostsMatch(lines=["something else"], location="kh:2"),
            offers=[offered_key],
        )
        monkeypatch.setattr("ttnn_visualizer.views.append_host_keys", fail)

        response = client.post(
            HOST_KEY_TRUST_ENDPOINT,
            json={"target": _payload(), "fingerprints": [ED25519_FINGERPRINT]},
        )

        assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
        assert "ssh-keygen -R" in response.get_json()["error"]

    def test_a_key_swapped_since_the_offer_is_refused(
        self, app, client, monkeypatch, resolved_target, offered_key
    ):
        """Guards the gap between showing a fingerprint and the user clicking trust."""
        from ttnn_visualizer.known_hosts import KnownHostsMatch

        def fail(lines):
            raise AssertionError("must not append a key the user never saw")

        _open_local_gate(
            app,
            monkeypatch,
            resolved=resolved_target,
            existing=KnownHostsMatch(lines=[]),
            offers=[offered_key],
        )
        monkeypatch.setattr("ttnn_visualizer.views.append_host_keys", fail)

        response = client.post(
            HOST_KEY_TRUST_ENDPOINT,
            json={"target": _payload(), "fingerprints": [ECDSA_FINGERPRINT]},
        )

        assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY

    def test_an_extra_key_appearing_since_the_offer_is_refused(
        self, app, client, monkeypatch, resolved_target, offered_key
    ):
        """An exact set match, so a key added between preview and click also refuses."""
        from ttnn_visualizer.known_hosts import KnownHostsMatch

        extra = HostKeyOffer(
            keyType="ecdsa-sha2-nistp256",
            fingerprint=ECDSA_FINGERPRINT,
            line=_offer_line(ECDSA_BLOB),
        )
        _open_local_gate(
            app,
            monkeypatch,
            resolved=resolved_target,
            existing=KnownHostsMatch(lines=[]),
            offers=[offered_key, extra],
        )
        monkeypatch.setattr(
            "ttnn_visualizer.views.append_host_keys",
            lambda lines: (_ for _ in ()).throw(AssertionError("must not append")),
        )

        response = client.post(
            HOST_KEY_TRUST_ENDPOINT,
            json={"target": _payload(), "fingerprints": [ED25519_FINGERPRINT]},
        )

        assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY

    def test_a_proxied_host_cannot_be_trusted(self, app, client, monkeypatch):
        from ttnn_visualizer.known_hosts import ResolvedSshTarget

        _open_local_gate(
            app,
            monkeypatch,
            resolved=ResolvedSshTarget(
                requested_host=SCAN_HOST,
                scan_host="internal.example",
                scan_port=22,
                entry_name="internal.example",
                is_proxied=True,
            ),
        )

        response = client.post(
            HOST_KEY_TRUST_ENDPOINT,
            json={"target": _payload(), "fingerprints": [ED25519_FINGERPRINT]},
        )

        assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
        assert "jump host" in response.get_json()["error"]

    def test_a_host_offering_nothing_is_refused(
        self, app, client, monkeypatch, resolved_target
    ):
        from ttnn_visualizer.known_hosts import KnownHostsMatch

        _open_local_gate(
            app,
            monkeypatch,
            resolved=resolved_target,
            existing=KnownHostsMatch(lines=[]),
            offers=[],
        )

        response = client.post(
            HOST_KEY_TRUST_ENDPOINT,
            json={"target": _payload(), "fingerprints": [ED25519_FINGERPRINT]},
        )

        assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY

    def test_a_request_without_a_target_is_rejected(self, app, client, monkeypatch):
        _open_local_gate(app, monkeypatch)

        response = client.post(
            HOST_KEY_TRUST_ENDPOINT, json={"fingerprints": [ED25519_FINGERPRINT]}
        )

        assert response.status_code == HTTPStatus.BAD_REQUEST

    def test_the_trust_endpoint_is_forbidden_in_server_mode(self, app, client):
        """Writing to the server's known_hosts must never be reachable when hosted."""
        assert app.config["SERVER_MODE"] is True

        response = client.post(
            HOST_KEY_TRUST_ENDPOINT,
            json={"target": _payload(), "fingerprints": [ED25519_FINGERPRINT]},
        )

        assert response.status_code == 403


def test_a_broken_resolver_does_not_cost_us_the_verdict(monkeypatch):
    """`host_key_status` runs while handling an exception, so it must not raise.

    Losing the host-key verdict to a resolver hiccup is the same class of bug as the one
    this flow fixes, so resolution degrades to the typed host rather than propagating.
    """
    from ttnn_visualizer.known_hosts import host_key_status

    def explode(*args, **kwargs):
        raise RuntimeError("resolver is having a day")

    _patch_run(monkeypatch, explode)

    status = host_key_status(_target(), HostKeyIssue.UNKNOWN)

    assert status.issue == HostKeyIssue.UNKNOWN.value
    assert status.host == SCAN_HOST
    assert status.port == SCAN_PORT
