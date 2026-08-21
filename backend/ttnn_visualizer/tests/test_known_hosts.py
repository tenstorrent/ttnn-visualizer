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
    rekey_host_line,
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


@pytest.fixture(autouse=True)
def isolated_known_hosts(monkeypatch, tmp_path):
    """Keep every test in this module away from the real ``~/.ssh/known_hosts``.

    ``append_host_keys`` and ``search_known_hosts`` fall back to
    ``DEFAULT_KNOWN_HOSTS_PATH`` when given no path, and the trust endpoint reaches
    ``append_host_keys`` for real. One test that forgets to stub it would otherwise
    append host keys to the developer's own security-sensitive file — so this is pinned
    for the module rather than remembered per test. Both functions read the module
    global at call time, so patching it is enough.
    """
    isolated = tmp_path / "isolated_ssh" / "known_hosts"
    monkeypatch.setattr(
        "ttnn_visualizer.known_hosts.DEFAULT_KNOWN_HOSTS_PATH", isolated
    )
    return isolated


def _resolved(**overrides):
    """A `ResolvedSshTarget` whose fields differ from the payload unless overridden."""
    from ttnn_visualizer.known_hosts import ResolvedSshTarget

    fields = {
        "requested_host": SCAN_HOST,
        "username": None,
        "scan_host": SCAN_HOST,
        "scan_port": SCAN_PORT,
        "entry_name": SCAN_ENTRY,
        "is_proxied": False,
        "known_hosts_files": (Path("/home/u/.ssh/known_hosts"),),
        "write_target": Path("/home/u/.ssh/known_hosts"),
    }
    fields.update(overrides)
    return ResolvedSshTarget(**fields)


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

        match = search_known_hosts(SCAN_ENTRY, [Path("/home/u/.ssh/known_hosts")])

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
    """Point both endpoints at fixtures, with the local-only gate open.

    Stubs *record* their arguments rather than ignoring them: the whole point of the
    resolution machinery is that the endpoint searches and scans the resolved target
    rather than the typed one, and argument-ignoring lambdas would keep passing while
    the app recorded a key under a name nothing looks up.
    """
    app.config["SERVER_MODE"] = False
    calls: dict = {"searched": [], "scanned": [], "appended": []}

    if resolved is not None:
        monkeypatch.setattr(
            "ttnn_visualizer.views.resolve_ssh_target", lambda target: resolved
        )
    if existing is not None:

        def record_search(entry, paths=None):
            calls["searched"].append((entry, tuple(paths or ())))
            return existing

        monkeypatch.setattr("ttnn_visualizer.views.search_known_hosts", record_search)
    if offers is not None:

        def record_scan(host, port):
            calls["scanned"].append((host, port))
            return list(offers)

        monkeypatch.setattr("ttnn_visualizer.views.scan_host_keys", record_scan)

    def record_append(lines, path=None):
        calls["appended"].append((list(lines), path))

    monkeypatch.setattr("ttnn_visualizer.views.append_host_keys", record_append)
    return calls


@pytest.fixture
def resolved_target():
    return _resolved()


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
        self, app, client, monkeypatch, resolved_target, offered_key
    ):
        from ttnn_visualizer.known_hosts import KnownHostsMatch

        calls = _open_local_gate(
            app,
            monkeypatch,
            resolved=resolved_target,
            existing=KnownHostsMatch(lines=[]),
            offers=[offered_key],
        )
        response = client.post(
            HOST_KEY_TRUST_ENDPOINT,
            json={"target": _payload(), "fingerprints": [ED25519_FINGERPRINT]},
        )

        assert response.status_code == HTTPStatus.OK
        assert calls["appended"] == [([offered_key.line], resolved_target.write_target)]

    def test_an_existing_entry_is_refused_and_left_untouched(
        self, app, client, monkeypatch, resolved_target, offered_key
    ):
        """The refusal that keeps this from being a one-click "trust anyway"."""
        from ttnn_visualizer.known_hosts import KnownHostsMatch

        calls = _open_local_gate(
            app,
            monkeypatch,
            resolved=resolved_target,
            existing=KnownHostsMatch(lines=["something else"], location="kh:2"),
            offers=[offered_key],
        )
        response = client.post(
            HOST_KEY_TRUST_ENDPOINT,
            json={"target": _payload(), "fingerprints": [ED25519_FINGERPRINT]},
        )

        assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
        assert "ssh-keygen -R" in response.get_json()["error"]
        assert calls["appended"] == []

    def test_a_key_swapped_since_the_offer_is_refused(
        self, app, client, monkeypatch, resolved_target, offered_key
    ):
        """Guards the gap between showing a fingerprint and the user clicking trust."""
        from ttnn_visualizer.known_hosts import KnownHostsMatch

        calls = _open_local_gate(
            app,
            monkeypatch,
            resolved=resolved_target,
            existing=KnownHostsMatch(lines=[]),
            offers=[offered_key],
        )
        response = client.post(
            HOST_KEY_TRUST_ENDPOINT,
            json={"target": _payload(), "fingerprints": [ECDSA_FINGERPRINT]},
        )

        assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
        assert calls["appended"] == []

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
        calls = _open_local_gate(
            app,
            monkeypatch,
            resolved=resolved_target,
            existing=KnownHostsMatch(lines=[]),
            offers=[offered_key, extra],
        )

        response = client.post(
            HOST_KEY_TRUST_ENDPOINT,
            json={"target": _payload(), "fingerprints": [ED25519_FINGERPRINT]},
        )

        assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY

    def test_a_proxied_host_cannot_be_trusted(self, app, client, monkeypatch):
        _open_local_gate(
            app,
            monkeypatch,
            resolved=_resolved(
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


class TestTheEndpointHonoursResolution:
    """The wiring the resolution machinery exists for.

    `resolve_ssh_target` is unit-tested in isolation above, but nothing checked that the
    endpoint *uses* what it returns. With argument-ignoring stubs, passing the typed host
    where the resolved one belongs kept every endpoint test green while the app recorded
    a key under a name OpenSSH never looks up.
    """

    RESOLVED = dict(
        scan_host="ssh.github.com",
        scan_port=443,
        entry_name="lab-key",
        known_hosts_files=(Path("/home/u/.ssh/alt_known_hosts"),),
        write_target=Path("/home/u/.ssh/alt_known_hosts"),
    )

    def test_the_offer_searches_and_scans_the_resolved_target(
        self, app, client, monkeypatch, offered_key
    ):
        from ttnn_visualizer.known_hosts import KnownHostsMatch

        calls = _open_local_gate(
            app,
            monkeypatch,
            resolved=_resolved(**self.RESOLVED),
            existing=KnownHostsMatch(lines=[]),
            offers=[offered_key],
        )

        body = client.post(HOST_KEY_ENDPOINT, json=_payload()).get_json()

        assert calls["searched"] == [
            ("lab-key", (Path("/home/u/.ssh/alt_known_hosts"),))
        ]
        assert calls["scanned"] == [("ssh.github.com", 443)]
        assert body["host"] == "ssh.github.com"
        assert body["port"] == 443
        assert body["entryName"] == "lab-key"
        assert body["alias"] == SCAN_HOST

    def test_trust_appends_to_the_resolved_file_under_the_resolved_name(
        self, app, client, monkeypatch, offered_key
    ):
        """The HostKeyAlias case: the scanned line is keyed on the address, not the alias.

        Appending it unchanged records the key under a name OpenSSH never reads, so the
        retest fails identically and every retry appends another unused copy.
        """
        from ttnn_visualizer.known_hosts import KnownHostsMatch

        calls = _open_local_gate(
            app,
            monkeypatch,
            resolved=_resolved(**self.RESOLVED),
            existing=KnownHostsMatch(lines=[]),
            offers=[offered_key],
        )

        response = client.post(
            HOST_KEY_TRUST_ENDPOINT,
            json={"target": _payload(), "fingerprints": [ED25519_FINGERPRINT]},
        )

        assert response.status_code == HTTPStatus.OK
        lines, path = calls["appended"][0]
        assert path == Path("/home/u/.ssh/alt_known_hosts")
        assert lines == [f"lab-key ssh-ed25519 {ED25519_BLOB}"]

    def test_an_existing_entry_plus_a_failed_scan_is_not_reported_as_changed(
        self, app, client, monkeypatch, resolved_target
    ):
        """A known host that is merely unreachable must not read as an interception.

        Every scan failure — host down, DNS, timeout — comes back as zero keys, so
        judging by "entry exists and nothing matched" cries wolf on the one warning that
        has to be believed, down the same path a real MITM takes.
        """
        from ttnn_visualizer.known_hosts import KnownHostsMatch

        _open_local_gate(
            app,
            monkeypatch,
            resolved=resolved_target,
            existing=KnownHostsMatch(lines=["existing line"], location="kh:1"),
            offers=[],
        )

        body = client.post(HOST_KEY_ENDPOINT, json=_payload()).get_json()

        assert body["issue"] is None
        assert body["scanFailed"] is True

    def test_the_offer_carries_the_commands_the_ui_renders(
        self, app, client, monkeypatch, offered_key
    ):
        """One producer for both commands, so the UI never re-derives them."""
        from ttnn_visualizer.known_hosts import KnownHostsMatch

        _open_local_gate(
            app,
            monkeypatch,
            resolved=_resolved(scan_port=2222, entry_name="[aus-wh-05]:2222"),
            existing=KnownHostsMatch(lines=[]),
            offers=[offered_key],
        )

        body = client.post(HOST_KEY_ENDPOINT, json=_payload()).get_json()

        assert body["removalCommand"] == "ssh-keygen -R '[aus-wh-05]:2222'"
        assert body["terminalCommand"] == "ssh -p 2222 aus-wh-05"


class TestTheTargetIsSanitisedBeforeReachingArgv:
    """`host` and `username` land in `ssh -G` / `ssh-keyscan` argv positions.

    The model's validators are the only thing between a form field and an option-like
    argument, and nothing pinned them for this model — so a refactor that simplified
    `HostKeyTarget.host` to a plain `str` would reopen option injection with a green
    suite.
    """

    @pytest.mark.parametrize(
        "host",
        ["-oProxyCommand=id", "-J jump", "-p2222", "--"],
        ids=["proxy-command", "jump", "port", "end-of-options"],
    )
    def test_an_option_like_host_is_refused(self, app, client, monkeypatch, host):
        _open_local_gate(app, monkeypatch)

        response = client.post(HOST_KEY_ENDPOINT, json=_payload(host=host))

        assert response.status_code == HTTPStatus.BAD_REQUEST

    @pytest.mark.parametrize(
        "username",
        ["-oProxyCommand=id", "-l root"],
        ids=["proxy-command", "login-name"],
    )
    def test_an_option_like_username_is_refused(
        self, app, client, monkeypatch, username
    ):
        _open_local_gate(app, monkeypatch)

        response = client.post(HOST_KEY_ENDPOINT, json=_payload(username=username))

        assert response.status_code == HTTPStatus.BAD_REQUEST

    def test_a_path_bearing_host_is_collapsed_to_an_inert_segment(self):
        """Documents the surprising half: a payload with a separator is basenamed."""
        assert HostKeyTarget(host="/etc/../tmp/pwn", port=22).host == "pwn"


class TestResolvingKnownHostsFiles:
    def test_every_configured_file_is_searched_user_files_first(self, monkeypatch):
        """OpenSSH accepts a key matching an entry in *any* of these.

        Deciding "unknown" from the default file alone would call a globally-pinned host
        new, and appending to the user's file would then override the admin's pin.
        """
        _patch_run(
            monkeypatch,
            lambda *a, **k: _completed(
                stdout=(
                    "hostname h\nport 22\n"
                    "userknownhostsfile /u/.ssh/known_hosts /u/.ssh/known_hosts2\n"
                    "globalknownhostsfile /etc/ssh/ssh_known_hosts\n"
                )
            ),
        )

        resolved = resolve_ssh_target(_target())

        assert resolved.known_hosts_files == (
            Path("/u/.ssh/known_hosts"),
            Path("/u/.ssh/known_hosts2"),
            Path("/etc/ssh/ssh_known_hosts"),
        )
        # Never a global file: those are the administrator's, and OpenSSH never writes
        # to them either.
        assert resolved.write_target == Path("/u/.ssh/known_hosts")

    def test_a_global_only_file_is_searched_but_never_written_to(
        self, monkeypatch, isolated_known_hosts
    ):
        _patch_run(
            monkeypatch,
            lambda *a, **k: _completed(
                stdout=(
                    "hostname h\nport 22\n"
                    "globalknownhostsfile /etc/ssh/ssh_known_hosts\n"
                )
            ),
        )

        resolved = resolve_ssh_target(_target())

        assert Path("/etc/ssh/ssh_known_hosts") in resolved.known_hosts_files
        assert resolved.write_target == isolated_known_hosts

    def test_a_known_hosts_file_of_none_is_dropped(
        self, monkeypatch, isolated_known_hosts
    ):
        """`ssh -G` spells "no file" as the literal string "none"."""
        _patch_run(
            monkeypatch,
            lambda *a, **k: _completed(
                stdout="hostname h\nport 22\nuserknownhostsfile none\n"
            ),
        )

        assert resolve_ssh_target(_target()).known_hosts_files == (
            isolated_known_hosts,
        )

    def test_a_quoted_path_containing_a_space_survives(self, monkeypatch):
        _patch_run(
            monkeypatch,
            lambda *a, **k: _completed(
                stdout='hostname h\nport 22\nuserknownhostsfile "/u/my hosts"\n'
            ),
        )

        assert resolve_ssh_target(_target()).write_target == Path("/u/my hosts")

    def test_the_username_is_passed_so_match_user_stanzas_apply(self, monkeypatch):
        """`Match user …` can set HostName, Port, HostKeyAlias and ProxyJump.

        Resolving without it answers for a different connection than the one that
        failed — and getting `proxyjump` wrong means offering to scan a host only
        reachable through a jump.
        """
        argv_seen = []

        def record(argv, *args, **kwargs):
            argv_seen.append(argv)
            return _completed(stdout="hostname h\nport 22\n")

        _patch_run(monkeypatch, record)

        resolve_ssh_target(_target(username="alice"))
        resolve_ssh_target(_target(username=None))

        assert argv_seen[0][argv_seen[0].index("-l") + 1] == "alice"
        assert "-l" not in argv_seen[1]

    def test_a_search_across_files_reports_the_first_location(self, monkeypatch):
        def per_file(argv, *args, **kwargs):
            if "/u/second" in argv:
                return _completed(
                    stdout=f"# Host x found: line 4 \n{_offer_line(ED25519_BLOB)}\n"
                )
            return _completed(returncode=1)

        _patch_run(monkeypatch, per_file)

        match = search_known_hosts(SCAN_ENTRY, [Path("/u/first"), Path("/u/second")])

        assert bool(match) is True
        assert match.location == "/u/second:4"

    def test_a_single_path_is_accepted_as_well_as_a_sequence(self, monkeypatch):
        _patch_run(
            monkeypatch,
            lambda *a, **k: _completed(
                stdout=f"# Host x found: line 1 \n{_offer_line(ED25519_BLOB)}\n"
            ),
        )

        assert bool(search_known_hosts(SCAN_ENTRY, Path("/u/known_hosts"))) is True


class TestRekeyingAScannedLine:
    def test_the_host_field_is_replaced_and_the_key_kept(self):
        line = _offer_line(ED25519_BLOB)

        assert rekey_host_line(line, "lab-key") == f"lab-key ssh-ed25519 {ED25519_BLOB}"

    def test_a_line_already_keyed_correctly_is_unchanged(self):
        line = _offer_line(ED25519_BLOB)

        assert rekey_host_line(line, SCAN_ENTRY) == line

    def test_a_truncated_line_is_left_alone(self):
        assert rekey_host_line("just-a-host", "lab-key") == "just-a-host"


class TestTheChangedKeyEntryIsPopulated:
    def test_a_changed_key_status_carries_the_offending_entry(self, monkeypatch):
        """The pointer the changed-key callout renders, which was always null before."""
        from ttnn_visualizer.known_hosts import host_key_status

        def run(argv, *args, **kwargs):
            if "-G" in argv:
                return _completed(stdout="hostname h\nport 22\n")
            return _completed(stdout=f"# Host h found: line 9 \n{_offer_line()}\n")

        _patch_run(monkeypatch, run)

        status = host_key_status(_target(port=22), HostKeyIssue.CHANGED)

        assert status.knownHostsEntry is not None
        assert status.knownHostsEntry.endswith(":9")
        assert status.removalCommand == "ssh-keygen -R h"

    def test_an_unknown_key_does_not_pay_for_the_lookup(self, monkeypatch):
        """Only the changed case needs the entry, and the lookup costs a subprocess."""
        from ttnn_visualizer.known_hosts import host_key_status

        argv_seen = []

        def run(argv, *args, **kwargs):
            argv_seen.append(argv)
            return _completed(stdout="hostname h\nport 22\n")

        _patch_run(monkeypatch, run)

        host_key_status(_target(), HostKeyIssue.UNKNOWN)

        assert all(argv[0] != "ssh-keygen" for argv in argv_seen)

    def test_a_failed_lookup_costs_only_the_pointer(self, monkeypatch):
        """A resolution that worked must not be discarded because the lookup did not."""
        from ttnn_visualizer.known_hosts import host_key_status

        def run(argv, *args, **kwargs):
            if "-G" in argv:
                return _completed(stdout="hostname resolved.example\nport 2222\n")
            raise RuntimeError("lookup exploded")

        _patch_run(monkeypatch, run)

        status = host_key_status(_target(), HostKeyIssue.CHANGED)

        assert status.host == "resolved.example"
        assert status.port == 2222
        assert status.knownHostsEntry is None
