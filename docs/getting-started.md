# Getting started

## Prerequisites

Visualizer requires a preexisting report generated. Please refer to
[TT-Metallium](https://docs.tenstorrent.com/tt-metalium/latest/get_started/get_started.html),
[TT-NN](https://docs.tenstorrent.com/ttnn/latest/ttnn/get_started.html) and
[TT-NN models](https://docs.tenstorrent.com/ttnn/latest/tt_metal_models/get_started.html#running-an-example-model)
on how to run models and generate reports.

The final output should include at least a `config.json` and a `db.sqlite` file.

## Installing as a Python Wheel

The application is designed to run on user local system and has python requirement of `3.12.3`.

Download the wheel file from the [releases page](https://github.com/tenstorrent/ttnn-visualizer/releases) and install using `pip install release_name.whl`.

## Running the application

After installation run `ttnn-visualizer` to start the application.

### Docker

The application can also be alternatively installed and run via [Docker](./docker.md).
