# Running from source

**NOTE:** If you're just looking to run the app, try {ref}`installing from pypi <installing-from-pypi>` or using the [hosted version](https://ttnn-visualizer.tenstorrent.com/) is highly recommended.

## Front end

The current supported Node version is listed in the [.nvmrc](https://github.com/tenstorrent/ttnn-visualizer/blob/dev/.nvmrc) file. We recommend using a node version manager such as NVM for ease of use. 

We use [pnpm](https://pnpm.io/) as our package manager. Please see their guidelines for [installing pnpm on your machine](https://pnpm.io/installation).

```shell
nvm use
pnpm install
pnpm run dev
```

(back-end)=
## Back end

We use [uv](https://docs.astral.sh/uv/) to manage Python versions and dependencies. The version is pinned in [.python-version](https://github.com/tenstorrent/ttnn-visualizer/blob/dev/.python-version) and locked via `uv.lock`.

Install uv (see [uv installation](https://docs.astral.sh/uv/getting-started/installation/)), then sync dependencies:

```shell
uv sync
```

`uv sync` installs the Python version from `.python-version` if needed, creates `.venv`, and installs the project in editable mode with dev dependencies (black, isort, mypy, pytest, etc.). Use `uv run …` for backend commands — no manual activation, pyenv, or `PYTHONPATH` needed.

Starting the server

```shell
pnpm run flask:start
```

Starting with hot reload:

``` shell
pnpm run flask:start-debug
```

When both the frontend and backend are running you can access the app on [http://localhost:5173](http://localhost:5173), but an alternative local URI may be provided in the terminal when running `pnpm run dev`.

## CLI arguments
* `--profiler-path` - specify the local path to the folder containing profiler data
* `--performance-path` - specify the local path to the folder containing performance data
* `--tt-metal-home` - specify the path to the TT Metal repo when running directly on the machine where reports are being generated
* `--host` - set the host to bind the backend server to
* `--port` - set the port to bind the backend server to
* `--server` - enable server mode and bind to all network interfaces (`0.0.0.0`)
* `-d`, `--daemon` - run the backend server as a daemon process

## Environment variables

The application should run out of the box, but should you need to you can adjust certain values in the front end or back end code using a `.env` file. See [.env.sample](https://github.com/tenstorrent/ttnn-visualizer/blob/dev/.env.sample) for some of the key variables available.