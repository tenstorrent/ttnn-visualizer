# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from pathlib import Path

from ttnn_visualizer.ssh_config import list_ssh_config_hosts


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

    hosts = {host.host: host for host in list_ssh_config_hosts(config)}

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
""".strip(),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "ttnn_visualizer.views.list_ssh_config_hosts",
        lambda: list_ssh_config_hosts(config),
    )

    response = client.get("/api/remote/ssh-config-hosts")

    assert response.status_code == 200
    assert response.get_json() == [
        {
            "host": "lab",
            "hostName": "lab.example.com",
            "user": "dave",
            "port": 22,
        }
    ]


def test_ssh_config_hosts_endpoint_forbidden_in_server_mode(app, client):
    assert app.config["SERVER_MODE"] is True
    response = client.get("/api/remote/ssh-config-hosts")
    assert response.status_code == 403
