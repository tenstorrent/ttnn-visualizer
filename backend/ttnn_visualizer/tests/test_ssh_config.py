# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import logging
from pathlib import Path
from typing import List

import pytest
from ttnn_visualizer.ssh_config import MAX_INCLUDE_DEPTH, load_ssh_config_hosts

SSH_CONFIG_HOSTS_ENDPOINT = "/api/remote/ssh-config-hosts"


def _write_config(tmp_path: Path, text: str, name: str = "config") -> Path:
    """Write an SSH config fixture, stripped so tests can start it on its own line."""
    path = tmp_path / name
    path.write_text(text.strip(), encoding="utf-8")
    return path


def _serve_config(app, monkeypatch, config: Path) -> None:
    """Point the endpoint at a fixture config, with the local-only gate open."""
    app.config["SERVER_MODE"] = False
    monkeypatch.setattr(
        "ttnn_visualizer.views.load_ssh_config_hosts",
        lambda: load_ssh_config_hosts(config),
    )


def _deny_read_text(monkeypatch, denied: Path) -> None:
    """Make only ``denied`` unreadable, so unrelated reads still behave normally."""
    original_read_text = Path.read_text

    def read_text(self: Path, *args, **kwargs):
        if self == denied:
            raise PermissionError("nope")
        return original_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", read_text)


@pytest.fixture
def config_reads(monkeypatch) -> List[Path]:
    """Record each file the parser reads, so Include tests can pin termination.

    Asserting on the resulting host set alone passes whether or not the parser
    revisits files, which is the failure mode these tests exist to catch.
    """
    original_read_text = Path.read_text
    reads: List[Path] = []

    def recording_read_text(self: Path, *args, **kwargs):
        reads.append(self)
        return original_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", recording_read_text)
    return reads


def test_load_ssh_config_hosts_missing_file(tmp_path: Path):
    result = load_ssh_config_hosts(tmp_path / "missing-config")
    assert result.configExists is False
    assert result.hosts == []


def test_load_ssh_config_hosts_parses_concrete_hosts(tmp_path: Path):
    config = _write_config(
        tmp_path,
        """
Host *
    User shared

Host work-gpu
    HostName gpu.example.com
    User alice
    Port 2222

Host bastion jump
    HostName bastion.example.com
    User bob

Host "*.internal" ?ingle
    HostName ignored.example.com
""",
    )

    result = load_ssh_config_hosts(config)
    assert result.configExists is True
    hosts = {host.host: host for host in result.hosts}

    assert set(hosts) == {"work-gpu", "bastion", "jump"}
    assert hosts["work-gpu"].hostName == "gpu.example.com"
    assert hosts["work-gpu"].user == "alice"
    assert hosts["work-gpu"].port == 2222
    assert hosts["bastion"].hostName == "bastion.example.com"
    assert hosts["bastion"].user == "bob"
    assert hosts["jump"].hostName == "bastion.example.com"
    assert "?ingle" not in hosts


def test_load_ssh_config_hosts_skips_negated_patterns(tmp_path: Path):
    config = _write_config(
        tmp_path,
        """
Host *.example.com !secret.example.com
    User alice

Host good !bad
    User bob
""",
    )

    hosts = {host.host for host in load_ssh_config_hosts(config).hosts}
    assert hosts == {"good"}


def test_load_ssh_config_hosts_ignores_identity_file(tmp_path: Path):
    config = _write_config(
        tmp_path,
        """
Host two-keys
    IdentityFile /tmp/first_ed25519
    IdentityFile /tmp/second_ed25519
""",
    )

    hosts = load_ssh_config_hosts(config).hosts
    assert [host.host for host in hosts] == ["two-keys"]
    assert hosts[0].to_dict() == {"host": "two-keys"}


def test_load_ssh_config_hosts_include(tmp_path: Path):
    included_dir = tmp_path / "config.d"
    included_dir.mkdir()
    _write_config(
        included_dir,
        """
Host included-host
    HostName included.example.com
    User carol
""",
        name="extra",
    )

    config = _write_config(
        tmp_path,
        f"""
Include {included_dir / "extra"}

Host main
    HostName main.example.com
""",
    )

    hosts = {host.host: host for host in load_ssh_config_hosts(config).hosts}
    assert set(hosts) == {"included-host", "main"}
    assert hosts["included-host"].user == "carol"


def test_load_ssh_config_hosts_first_wins_per_keyword_on_duplicate_alias(
    tmp_path: Path,
):
    config = _write_config(
        tmp_path,
        """
Host dup
    User first

Host dup
    User second
    Port 2200
""",
    )

    hosts = load_ssh_config_hosts(config).hosts
    assert len(hosts) == 1
    # OpenSSH keeps the first User it obtains, and takes Port from the later stanza
    # only because the first one never set it.
    assert hosts[0].user == "first"
    assert hosts[0].port == 2200


def test_load_ssh_config_hosts_unquotes_values(tmp_path: Path):
    config = _write_config(
        tmp_path,
        """
Host quoted
    HostName "gpu.example.com"
    User "alice"
    Port "2222"
""",
    )

    hosts = {host.host: host for host in load_ssh_config_hosts(config).hosts}
    assert hosts["quoted"].hostName == "gpu.example.com"
    assert hosts["quoted"].user == "alice"
    assert hosts["quoted"].port == 2222


def test_load_ssh_config_hosts_keeps_a_quoted_hash_in_a_value(tmp_path: Path):
    config = _write_config(
        tmp_path,
        """
Host hashed
    HostName "a#b.example.com"
""",
    )

    hosts = {host.host: host for host in load_ssh_config_hosts(config).hosts}
    assert hosts["hashed"].hostName == "a#b.example.com"


def test_load_ssh_config_hosts_tolerates_unbalanced_quotes(tmp_path: Path):
    config = _write_config(
        tmp_path,
        """
Host "unclosed
    User "carol
""",
    )

    hosts = {host.host: host for host in load_ssh_config_hosts(config).hosts}
    assert set(hosts) == {'"unclosed'}
    assert hosts['"unclosed'].user == '"carol'


def test_load_ssh_config_hosts_existing_but_unreadable(
    tmp_path: Path, monkeypatch, caplog
):
    config = _write_config(tmp_path, "Host lab")
    _deny_read_text(monkeypatch, config)

    with caplog.at_level(logging.WARNING):
        result = load_ssh_config_hosts(config)

    assert result.configExists is True
    assert result.hosts == []
    assert "Unable to read SSH config" in caplog.text


def test_load_ssh_config_hosts_ignores_match_blocks(tmp_path: Path):
    config = _write_config(
        tmp_path,
        """
Host real
    User real-user

Match host anything
    User matched-user
    HostName matched.example.com
""",
    )

    hosts = {host.host: host for host in load_ssh_config_hosts(config).hosts}
    assert set(hosts) == {"real"}
    assert hosts["real"].user == "real-user"
    assert hosts["real"].hostName is None


def test_load_ssh_config_hosts_strips_comments(tmp_path: Path):
    config = _write_config(
        tmp_path,
        """
# A whole-line comment
Host commented # trailing comment on the Host line
    User carol # trailing comment on a keyword
    #HostName never.example.com
""",
    )

    hosts = {host.host: host for host in load_ssh_config_hosts(config).hosts}
    assert set(hosts) == {"commented"}
    assert hosts["commented"].user == "carol"
    assert hosts["commented"].hostName is None


def test_load_ssh_config_hosts_parses_keyword_equals_value(tmp_path: Path):
    config = _write_config(
        tmp_path,
        """
Host=eq-host
    HostName=eq.example.com
    User=eq-user
    Port=2200
""",
    )

    hosts = {host.host: host for host in load_ssh_config_hosts(config).hosts}
    assert set(hosts) == {"eq-host"}
    assert hosts["eq-host"].hostName == "eq.example.com"
    assert hosts["eq-host"].user == "eq-user"
    assert hosts["eq-host"].port == 2200


def test_load_ssh_config_hosts_parses_keyword_spaced_equals_value(tmp_path: Path):
    config = _write_config(
        tmp_path,
        """
Host = spaced-host
    HostName = spaced.example.com
    User = spaced-user
    Port = 2201
""",
    )

    hosts = {host.host: host for host in load_ssh_config_hosts(config).hosts}
    assert set(hosts) == {"spaced-host"}
    assert hosts["spaced-host"].hostName == "spaced.example.com"
    assert hosts["spaced-host"].user == "spaced-user"
    assert hosts["spaced-host"].port == 2201


def test_load_ssh_config_hosts_keeps_equals_inside_a_value(tmp_path: Path):
    config = _write_config(
        tmp_path,
        """
Host odd
    HostName a=b.example.com
""",
    )

    hosts = {host.host: host for host in load_ssh_config_hosts(config).hosts}
    assert hosts["odd"].hostName == "a=b.example.com"


def test_load_ssh_config_hosts_include_inside_host_keeps_later_keywords(tmp_path: Path):
    included = _write_config(
        tmp_path,
        """
Host included-host
    User carol
""",
        name="common",
    )

    config = _write_config(
        tmp_path,
        f"""
Host outer
    User outer-user
    Include {included}
    HostName outer.example.com
    Port 2201
""",
    )

    hosts = {host.host: host for host in load_ssh_config_hosts(config).hosts}
    assert set(hosts) == {"outer", "included-host"}
    assert hosts["outer"].user == "outer-user"
    assert hosts["outer"].hostName == "outer.example.com"
    assert hosts["outer"].port == 2201
    assert hosts["included-host"].user == "carol"


def test_load_ssh_config_hosts_include_relative_glob(tmp_path: Path):
    included_dir = tmp_path / "conf.d"
    included_dir.mkdir()
    _write_config(included_dir, "Host one\n    User u1", name="one")
    _write_config(included_dir, "Host two\n    User u2", name="two")

    config = _write_config(
        tmp_path,
        """
Include conf.d/*

Host main
    HostName main.example.com
""",
    )

    hosts = {host.host: host for host in load_ssh_config_hosts(config).hosts}
    assert set(hosts) == {"one", "two", "main"}


def test_load_ssh_config_hosts_include_expands_a_home_relative_glob(
    tmp_path: Path, monkeypatch
):
    # `Include ~/.ssh/config.d/*` is the form real configs use, and the only reason
    # the include expansion calls expanduser at all.
    ssh_dir = tmp_path / ".ssh"
    included_dir = ssh_dir / "config.d"
    included_dir.mkdir(parents=True)
    _write_config(included_dir, "Host home-relative\n    User u1", name="one")
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))

    config = _write_config(ssh_dir, "Include ~/.ssh/config.d/*")

    hosts = {host.host for host in load_ssh_config_hosts(config).hosts}
    assert hosts == {"home-relative"}


def test_load_ssh_config_hosts_include_glob_skips_directories(tmp_path: Path, caplog):
    included_dir = tmp_path / "conf.d"
    included_dir.mkdir()
    (included_dir / "nested").mkdir()
    _write_config(included_dir, "Host one\n    User u1", name="one")

    config = _write_config(tmp_path, "Include conf.d/*")

    with caplog.at_level(logging.WARNING):
        hosts = {host.host: host for host in load_ssh_config_hosts(config).hosts}

    assert set(hosts) == {"one"}
    assert caplog.records == []


def test_load_ssh_config_hosts_include_cycle_terminates(
    tmp_path: Path, caplog, config_reads: List[Path]
):
    first = tmp_path / "config"
    second = tmp_path / "other"
    first.write_text(f"Include {second}\n\nHost first", encoding="utf-8")
    second.write_text(f"Include {first}\n\nHost second", encoding="utf-8")

    with caplog.at_level(logging.WARNING):
        hosts = {host.host for host in load_ssh_config_hosts(first).hosts}

    assert hosts == {"first", "second"}
    # Each file once: re-entering the cycle until the depth cap bites would still
    # produce these hosts, so only the read count distinguishes the two.
    assert len(config_reads) == 2
    assert caplog.records == []


def test_load_ssh_config_hosts_self_matching_include_glob_terminates(
    tmp_path: Path, caplog, config_reads: List[Path]
):
    included_dir = tmp_path / "conf.d"
    included_dir.mkdir()
    part_count = 5
    for index in range(part_count):
        (included_dir / f"part{index}").write_text(
            f"Include {included_dir}/*\n\nHost part{index}", encoding="utf-8"
        )

    config = _write_config(tmp_path, f"Include {included_dir}/*")

    with caplog.at_level(logging.WARNING):
        hosts = {host.host for host in load_ssh_config_hosts(config).hosts}

    assert hosts == {f"part{index}" for index in range(part_count)}
    assert len(config_reads) == part_count + 1
    assert caplog.records == []


def test_load_ssh_config_hosts_stops_at_max_include_depth(tmp_path: Path, caplog):
    # One distinct file per depth level, one level deeper than the cap, so the last
    # file is refused by the depth guard rather than by the already-visited guard.
    chain = [tmp_path / f"config{index}" for index in range(MAX_INCLUDE_DEPTH + 2)]
    for index, path in enumerate(chain):
        include = f"Include {chain[index + 1]}\n" if index + 1 < len(chain) else ""
        path.write_text(f"{include}Host depth{index}\n", encoding="utf-8")

    with caplog.at_level(logging.WARNING):
        hosts = {host.host for host in load_ssh_config_hosts(chain[0]).hosts}

    assert hosts == {f"depth{index}" for index in range(MAX_INCLUDE_DEPTH + 1)}
    assert "Include depth exceeded" in caplog.text


def test_load_ssh_config_hosts_rejects_out_of_range_ports(tmp_path: Path):
    config = _write_config(
        tmp_path,
        """
Host not-a-number
    Port notanumber

Host zero
    Port 0

Host too-large
    Port 70000
""",
    )

    hosts = {host.host: host for host in load_ssh_config_hosts(config).hosts}
    assert set(hosts) == {"not-a-number", "zero", "too-large"}
    assert all(host.port is None for host in hosts.values())


def test_ssh_config_hosts_endpoint_omits_absent_fields(
    app, client, tmp_path: Path, monkeypatch
):
    _serve_config(app, monkeypatch, _write_config(tmp_path, "Host bare"))

    response = client.get(SSH_CONFIG_HOSTS_ENDPOINT)

    assert response.status_code == 200
    assert response.get_json() == {"configExists": True, "hosts": [{"host": "bare"}]}


def test_ssh_config_hosts_endpoint_returns_hosts(
    app, client, tmp_path: Path, monkeypatch
):
    config = _write_config(
        tmp_path,
        """
Host lab
    HostName lab.example.com
    User dave
    Port 22
    IdentityFile ~/.ssh/lab_ed25519
""",
    )
    _serve_config(app, monkeypatch, config)

    response = client.get(SSH_CONFIG_HOSTS_ENDPOINT)

    assert response.status_code == 200
    payload = response.get_json()
    assert payload == {
        "configExists": True,
        "hosts": [
            {
                "host": "lab",
                "hostName": "lab.example.com",
                "user": "dave",
                "port": 22,
            }
        ],
    }
    assert "identityFile" not in payload["hosts"][0]


def test_ssh_config_hosts_endpoint_existing_but_unreadable(
    app, client, tmp_path: Path, monkeypatch
):
    config = _write_config(tmp_path, "Host lab")
    _deny_read_text(monkeypatch, config)
    _serve_config(app, monkeypatch, config)

    response = client.get(SSH_CONFIG_HOSTS_ENDPOINT)

    assert response.status_code == 200
    # An unreadable config still answers 200 rather than erroring; the empty host list
    # is what hides the picker.
    assert response.get_json() == {"configExists": True, "hosts": []}


def test_ssh_config_hosts_endpoint_missing_config(
    app, client, tmp_path: Path, monkeypatch
):
    _serve_config(app, monkeypatch, tmp_path / "missing")

    response = client.get(SSH_CONFIG_HOSTS_ENDPOINT)

    assert response.status_code == 200
    assert response.get_json() == {"configExists": False, "hosts": []}


def test_ssh_config_hosts_endpoint_forbidden_in_server_mode(app, client):
    assert app.config["SERVER_MODE"] is True
    response = client.get(SSH_CONFIG_HOSTS_ENDPOINT)
    assert response.status_code == 403
