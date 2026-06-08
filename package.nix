# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

let
  pkgs = import <nixpkgs> { };
  python = pkgs.python3.override {
    packageOverrides =
      final: prev:
      {
        flask-cors = final.buildPythonPackage rec {
          pname = "flask-cors";
          version = "6.0.2";
          pyproject = true;

          src = final.fetchPypi {
            pname = "flask_cors";
            inherit version;
            sha256 = "6e118f3698249ae33e429760db98ce032a8bf9913638d085ca0f4c5534ad2423";
          };

          build-system = [
            final.setuptools
            final.wheel
          ];

          dependencies = [
            final.flask
            final.werkzeug
          ];

          pythonImportsCheck = [ "flask_cors" ];
        };

        flask-static-digest = final.buildPythonPackage rec {
          pname = "flask-static-digest";
          version = "0.4.1";
          pyproject = true;

          src = final.fetchPypi {
            pname = "flask_static_digest";
            inherit version;
            sha256 = "a6b38e953a4cfaac092e0ae40feea82a4f098bfac50969cefc48d4a9e7492e14";
          };

          build-system = [
            final.setuptools
            final.wheel
          ];

          dependencies = [ final.flask ];

          pythonImportsCheck = [ "flask_static_digest" ];
        };

        tt-perf-report = final.buildPythonPackage rec {
          pname = "tt-perf-report";
          version = "1.2.4";
          pyproject = true;

          src = final.fetchPypi {
            pname = "tt_perf_report";
            inherit version;
            sha256 = "f3c2b13c8bace25d3bdca33acfa2c8882f5e7baa219db295eb23c3f588dea7c9";
          };

          build-system = [
            final.setuptools
            final.wheel
          ];

          dependencies = [
            final.pandas
            final.matplotlib
          ];

          pythonImportsCheck = [ "tt_perf_report" ];
        };
      };
  };
  ps = python.pkgs;
  src = pkgs.lib.cleanSourceWith {
    src = ./.;
    filter =
      path: type:
      let
        baseName = builtins.baseNameOf path;
      in
      !builtins.elem baseName [
        ".git"
        "node_modules"
        "result"
      ];
  };

  frontendSource = pkgs.stdenvNoCC.mkDerivation {
    pname = "ttnn-visualizer-frontend-source";
    version = "0.88.0";
    inherit src;

    pnpmDeps = pkgs.fetchPnpmDeps {
      inherit src;
      pname = "ttnn-visualizer";
      version = "0.88.0";
      pnpm = pkgs.pnpm_11;
      fetcherVersion = 3;
      hash = "sha256-hsNslFQE46H07q42cqATx2z6TApSU0uhaz6FVtLgPB8=";
    };

    nativeBuildInputs = [
      pkgs.nodejs_24
      pkgs.pnpm_11
      pkgs.pnpmConfigHook
    ];

    env = {
      CI = "true";
      npm_config_yes = "true";
      pnpm_config_confirm_modules_purge = "false";
    };

    postPatch = ''
      ${pkgs.python3}/bin/python - <<'PY'
      import json
      from pathlib import Path

      package_json = Path("package.json")
      data = json.loads(package_json.read_text())
      scripts = data.get("scripts", {})
      scripts.pop("preinstall", None)
      scripts.pop("prepare", None)
      data["scripts"] = scripts
      package_json.write_text(json.dumps(data, indent=2) + "\n")
      PY
    '';

    buildPhase = ''
      runHook preBuild
      export HOME="$(mktemp -d)"
      pnpm build
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      cp -r . "$out/"
      runHook postInstall
    '';
  };

  ttnnVisualizer = ps.buildPythonPackage rec {
    pname = "ttnn-visualizer";
    version = "0.88.0";
    pyproject = true;
    src = frontendSource;

    build-system = [
      ps.setuptools
      ps.wheel
    ];

    propagatedBuildInputs = [
      ps.alembic
      ps.build
      ps.flask
      ps."flask-cors"
      ps."flask-socketio"
      ps."flask-sqlalchemy"
      ps."flask-static-digest"
      ps.gevent
      ps.gunicorn
      ps.orjson
      ps.pandas
      ps.pydantic
      ps."pydantic-core"
      ps."python-dotenv"
      ps.pyyaml
      ps."tt-perf-report"
      ps.uvicorn
      ps.zstd
    ];

    pythonImportsCheck = [ "ttnn_visualizer" ];
  };

  pythonEnv = python.withPackages (
    ps: [
      ttnnVisualizer
      ps.gunicorn
      ps.gevent
    ]
  );
in
pkgs.symlinkJoin {
  name = "ttnn-visualizer-app";
  paths = [
    (pkgs.writeShellScriptBin "ttnn-visualizer" ''
      export FLASK_ENV=production
      export PATH="${pkgs.lib.makeBinPath [ pythonEnv ]}:$(dirname "$0"):$PATH"
      echo "Using python environment: ${pythonEnv}"
      exec ${pythonEnv}/bin/python -m ttnn_visualizer.app "$@"
    '')
    (pkgs.writeShellScriptBin "gunicorn" ''
      export PATH="${pkgs.lib.makeBinPath [ pythonEnv ]}:$(dirname "$0"):$PATH"
      exec ${pythonEnv}/bin/python -m gunicorn "$@"
    '')
  ];
}
