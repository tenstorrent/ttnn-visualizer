# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import logging
from pathlib import Path

from ttnn_visualizer.ssh_config import list_ssh_config_hosts, load_ssh_config_hosts


def test_load_ssh_config_hosts_missing_file(tmp_path: Path):
    result = load_ssh_config_hosts(tmp_path / "missing-config")
    assert result.configExists is False
    assert result.hosts == []


def test_list_ssh_config_hosts_missing_file(tmp_path: Path):
    assert list_ssh_config_hosts(tmp_path / "missing-config") == []


def test_list_ssh_config_hosts_parses_concrete_hosts(tmp_path: Path):
    config = tmp_path / "config"
    config.write_text(
        """
Host *
    User shared

Host work-gpu
    HostName gpu.example.com
    User alice
    Port 2222
    IdentityFile ~/.ssh/work_ed25519

Host bastion jump
    HostName bastion.example.com
    User bob

Host "*.internal" ?ingle
    HostName ignored.example.com
""".strip(),
        encoding="utf-8",
    )

    result = load_ssh_config_hosts(config)
    assert result.configExists is True
    hosts = {host.host: host for host in result.hosts}

    assert set(hosts) == {"work-gpu", "bastion", "jump"}
    assert hosts["work-gpu"].hostName == "gpu.example.com"
    assert hosts["work-gpu"].user == "alice"
    assert hosts["work-gpu"].port == 2222
    assert hosts["work-gpu"].identityFile == str(
        Path("~/.ssh/work_ed25519").expanduser()
    )
    assert hosts["bastion"].hostName == "bastion.example.com"
    assert hosts["bastion"].user == "bob"
    assert hosts["jump"].hostName == "bastion.example.com"
    assert "?ingle" not in hosts


def test_list_ssh_config_hosts_include(tmp_path: Path):
    included_dir = tmp_path / "config.d"
    included_dir.mkdir()
    (included_dir / "extra").write_text(
        """
Host included-host
    HostName included.example.com
    User carol
""".strip(),
        encoding="utf-8",
    )

    config = tmp_path / "config"
    config.write_text(
        f"""
Include {included_dir / "extra"}

Host main
    HostName main.example.com
""".strip(),
        encoding="utf-8",
    )

    hosts = {host.host: host for host in list_ssh_config_hosts(config)}
    assert set(hosts) == {"included-host", "main"}
    assert hosts["included-host"].user == "carol"


def test_list_ssh_config_hosts_last_wins_on_duplicate_alias(tmp_path: Path):
    config = tmp_path / "config"
    config.write_text(
        """
Host dup
    User first

Host dup
    User second
    Port 2200
""".strip(),
        encoding="utf-8",
    )

    hosts = list_ssh_config_hosts(config)
    assert len(hosts) == 1
    assert hosts[0].user == "second"
    assert hosts[0].port == 2200


def test_load_ssh_config_hosts_existing_but_unreadable(
    tmp_path: Path, monkeypatch, caplog
):
    config = tmp_path / "config"
    config.write_text("Host lab\n", encoding="utf-8")

    def raise_permission_error(*_args, **_kwargs):
        raise PermissionError("nope")

    monkeypatch.setattr(Path, "read_text", raise_permission_error)

    with caplog.at_level(logging.WARNING):
        result = load_ssh_config_hosts(config)

    assert result.configExists is True
    assert result.hosts == []
    assert "Unable to read SSH config" in caplog.text


def test_list_ssh_config_hosts_ignores_match_blocks(tmp_path: Path):
    config = tmp_path / "config"
    config.write_text(
        """
Host real
    User real-user

Match host anything
    User matched-user
    HostName matched.example.com
""".strip(),
        encoding="utf-8",
    )

    hosts = {host.host: host for host in list_ssh_config_hosts(config)}
    assert set(hosts) == {"real"}
    assert hosts["real"].user == "real-user"
    assert hosts["real"].hostName is None


def test_list_ssh_config_hosts_strips_comments(tmp_path: Path):
    config = tmp_path / "config"
    config.write_text(
        """
# A whole-line comment
Host commented # trailing comment on the Host line
    User carol # trailing comment on a keyword
    #HostName never.example.com
""".strip(),
        encoding="utf-8",
    )

    hosts = {host.host: host for host in list_ssh_config_hosts(config)}
    assert set(hosts) == {"commented"}
    assert hosts["commented"].user == "carol"
    assert hosts["commented"].hostName is None


def test_list_ssh_config_hosts_parses_keyword_equals_value(tmp_path: Path):
    config = tmp_path / "config"
    config.write_text(
        """
Host=eq-host
    HostName=eq.example.com
    User=eq-user
    Port=2200
""".strip(),
        encoding="utf-8",
    )

    hosts = {host.host: host for host in list_ssh_config_hosts(config)}
    assert set(hosts) == {"eq-host"}
    assert hosts["eq-host"].hostName == "eq.example.com"
    assert hosts["eq-host"].user == "eq-user"
    assert hosts["eq-host"].port == 2200


def test_list_ssh_config_hosts_include_inside_host_keeps_later_keywords(tmp_path: Path):
    included = tmp_path / "common"
    included.write_text(
        """
Host included-host
    User carol
""".strip(),
        encoding="utf-8",
    )

    config = tmp_path / "config"
    config.write_text(
        f"""
Host outer
    User outer-user
    Include {included}
    HostName outer.example.com
    Port 2201
""".strip(),
        encoding="utf-8",
    )

    hosts = {host.host: host for host in list_ssh_config_hosts(config)}
    assert set(hosts) == {"outer", "included-host"}
    assert hosts["outer"].user == "outer-user"
    assert hosts["outer"].hostName == "outer.example.com"
    assert hosts["outer"].port == 2201
    assert hosts["included-host"].user == "carol"


def test_list_ssh_config_hosts_include_relative_glob(tmp_path: Path):
    included_dir = tmp_path / "conf.d"
    included_dir.mkdir()
    (included_dir / "one").write_text("Host one\n    User u1", encoding="utf-8")
    (included_dir / "two").write_text("Host two\n    User u2", encoding="utf-8")

    config = tmp_path / "config"
    config.write_text(
        """
Include conf.d/*

Host main
    HostName main.example.com
""".strip(),
        encoding="utf-8",
    )

    hosts = {host.host: host for host in list_ssh_config_hosts(config)}
    assert set(hosts) == {"one", "two", "main"}


def test_list_ssh_config_hosts_include_glob_skips_directories(tmp_path: Path, caplog):
    included_dir = tmp_path / "conf.d"
    included_dir.mkdir()
    (included_dir / "nested").mkdir()
    (included_dir / "one").write_text("Host one\n    User u1", encoding="utf-8")

    config = tmp_path / "config"
    config.write_text("Include conf.d/*", encoding="utf-8")

    with caplog.at_level(logging.WARNING):
        hosts = {host.host: host for host in list_ssh_config_hosts(config)}

    assert set(hosts) == {"one"}
    assert caplog.records == []


def test_list_ssh_config_hosts_include_cycle_terminates(tmp_path: Path):
    first = tmp_path / "config"
    second = tmp_path / "other"
    first.write_text(f"Include {second}\n\nHost first", encoding="utf-8")
    second.write_text(f"Include {first}\n\nHost second", encoding="utf-8")

    hosts = {host.host: host for host in list_ssh_config_hosts(first)}
    assert set(hosts) == {"first", "second"}


def test_list_ssh_config_hosts_self_matching_include_glob_terminates(tmp_path: Path):
    included_dir = tmp_path / "conf.d"
    included_dir.mkdir()
    for index in range(5):
        (included_dir / f"part{index}").write_text(
            f"Include {included_dir}/*\n\nHost part{index}", encoding="utf-8"
        )

    config = tmp_path / "config"
    config.write_text(f"Include {included_dir}/*", encoding="utf-8")

    hosts = {host.host: host for host in list_ssh_config_hosts(config)}
    assert set(hosts) == {f"part{index}" for index in range(5)}


def test_list_ssh_config_hosts_rejects_out_of_range_ports(tmp_path: Path):
    config = tmp_path / "config"
    config.write_text(
        """
Host not-a-number
    Port notanumber

Host zero
    Port 0

Host too-large
    Port 70000
""".strip(),
        encoding="utf-8",
    )

    hosts = {host.host: host for host in list_ssh_config_hosts(config)}
    assert set(hosts) == {"not-a-number", "zero", "too-large"}
    assert all(host.port is None for host in hosts.values())


def test_list_ssh_config_hosts_keeps_first_identity_file(tmp_path: Path):
    config = tmp_path / "config"
    config.write_text(
        """
Host two-keys
    IdentityFile /tmp/first_ed25519
    IdentityFile /tmp/second_ed25519
""".strip(),
        encoding="utf-8",
    )

    hosts = list_ssh_config_hosts(config)
    assert hosts[0].identityFile == "/tmp/first_ed25519"


def test_ssh_config_hosts_endpoint_omits_absent_fields(
    app, client, tmp_path: Path, monkeypatch
):
    app.config["SERVER_MODE"] = False
    config = tmp_path / "config"
    config.write_text("Host bare", encoding="utf-8")
    monkeypatch.setattr(
        "ttnn_visualizer.views.load_ssh_config_hosts",
        lambda: load_ssh_config_hosts(config),
    )

    response = client.get("/api/remote/ssh-config-hosts")

    assert response.status_code == 200
    assert response.get_json() == {"configExists": True, "hosts": [{"host": "bare"}]}


def test_ssh_config_hosts_endpoint_returns_hosts(
    app, client, tmp_path: Path, monkeypatch
):
    app.config["SERVER_MODE"] = False
    config = tmp_path / "config"
    config.write_text(
        """
Host lab
    HostName lab.example.com
    User dave
    Port 22
    IdentityFile ~/.ssh/lab_ed25519
""".strip(),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "ttnn_visualizer.views.load_ssh_config_hosts",
        lambda: load_ssh_config_hosts(config),
    )

    response = client.get("/api/remote/ssh-config-hosts")

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


def test_ssh_config_hosts_endpoint_missing_config(
    app, client, tmp_path: Path, monkeypatch
):
    app.config["SERVER_MODE"] = False
    monkeypatch.setattr(
        "ttnn_visualizer.views.load_ssh_config_hosts",
        lambda: load_ssh_config_hosts(tmp_path / "missing"),
    )

    response = client.get("/api/remote/ssh-config-hosts")

    assert response.status_code == 200
    assert response.get_json() == {"configExists": False, "hosts": []}


def test_ssh_config_hosts_endpoint_forbidden_in_server_mode(app, client):
    assert app.config["SERVER_MODE"] is True
    response = client.get("/api/remote/ssh-config-hosts")
    assert response.status_code == 403
