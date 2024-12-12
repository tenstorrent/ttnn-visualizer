# Getting started

## Prerequisites

Visualizer requires a preexisting report generated.

Follow instructions for [TT-Metal](https://github.com/tenstorrent/tt-metal)
and [TT-NN](https://github.com/tenstorrent/tt-metal/blob/main/ttnn/README.md)

Sample config:

``` bash
export TTNN_CONFIG_OVERRIDES='{
    "enable_fast_runtime_mode": false,
    "enable_logging": true,
    "report_name": "TODO ADD NAME",
    "enable_graph_report": true,
    "enable_detailed_buffer_report": true,
    "enable_detailed_tensor_report": false,
    "enable_comparison_mode": false
}'
```

To run a test with custom input data, you can use the following command:

``` bash
pytest --disable-warnings --input-path="path/to/input.json" path/to/test_file.py::test_function[param] 
```

For more information please refer to
[TT-Metallium](https://docs.tenstorrent.com/tt-metalium/latest/get_started/get_started.html),
[TT-NN](https://docs.tenstorrent.com/ttnn/latest/ttnn/get_started.html) and
[TT-NN models](https://docs.tenstorrent.com/ttnn/latest/tt_metal_models/get_started.html#running-an-example-model)
 documentation.

The final output should include at least a `config.json` and a `db.sqlite` file.

## Installing as a Python Wheel

The application is designed to run on user local system and has python requirement of `3.12.3`.

Download the wheel file from the [releases page](https://github.com/tenstorrent/ttnn-visualizer/releases) and install
using `pip install release_name.whl`.

## Running the application

After installation run `ttnn-visualizer` to start the application.

### Docker

The application can also be alternatively installed and run via [Docker](./docker.md).
