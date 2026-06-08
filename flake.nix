# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

{
  description = "TT-NN Visualizer development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      lib = nixpkgs.lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: lib.genAttrs systems (system: f system);
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };

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

          pythonEnv = python.withPackages (
            ps: [
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
              ps.black
              ps.isort
              ps.mypy
              ps.pytest
              ps.playwright
              ps."types-pyyaml"
            ]
          );
        in
        {
          default = pkgs.mkShell {
            packages = [
              pythonEnv
              pkgs.nodejs_24
              pkgs.pnpm_11
              pkgs.playwright-driver.browsers
            ];

            shellHook = ''
              export PYTHONPATH="$PWD/backend''${PYTHONPATH:+:$PYTHONPATH}"
              export PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}

              echo "Development shell ready."
              echo "Run:"
              echo "  pnpm install"
              echo "  pnpm run dev"
              echo "  pnpm run flask:start"
            '';
          };
        }
      );
    };
}
