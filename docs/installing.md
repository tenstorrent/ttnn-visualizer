# Getting started

## Prerequisites

Visualizer requires a preexisting report generated. Please refer to
[TT-Metallium](https://docs.tenstorrent.com/tt-metalium/latest/installing.html),
[TT-NN](https://docs.tenstorrent.com/ttnn/latest/ttnn/get_started.html) and
[TT-NN models](https://docs.tenstorrent.com/ttnn/latest/tt_metal_models/get_started.html#running-an-example-model)
on how to run models and generate reports.

The final output should include at least `config.json` and `db.sqlite` files.

### Installing as a Python Wheel

The application is designed to run on user local system and has python requirement of 3.12.

Download the wheel file from the [releases page](https://github.com/tenstorrent/ttnn-visualizer/releases) and install using `pip install release_name.whl`.

### Running the application

After installation run `ttnn-visualizer` to start the application.

### Docker

The application can also be run via [Docker](./docker.md).
