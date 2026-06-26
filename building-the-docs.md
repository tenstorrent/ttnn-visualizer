# Building the docs

The markdown files in `/src` are meant to be run through a build process to turn them into a set of navigable HTML files. These are deployed to [Tenstorrent docs](https://docs.tenstorrent.com/ttnn-visualizer). 

## Building for local

If you wish you build them locally you may follow the steps below.

1. Open a terminal window in the root of this report.
2. Install documentation dependencies with `uv sync --no-default-groups --group docs`.
3. Run `uv run --no-default-groups --group docs sphinx-build docs docs/output` (or navigate to `./docs` and run `sphinx-build . output`).

The built files will be output into `/docs/output`. The documentation root can be found in `index.html`.