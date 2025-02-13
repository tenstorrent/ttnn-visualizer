# Getting started

## Prerequisites

TTNN Visualizer requires a preexisting report to analyze.

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
[TT-Metalium](https://docs.tenstorrent.com/tt-metalium/latest/get_started/get_started.html),
[TT-NN](https://docs.tenstorrent.com/ttnn/latest/ttnn/get_started.html) and
[TT-NN models](https://docs.tenstorrent.com/ttnn/latest/tt_metal_models/get_started.html#running-an-example-model)
 documentation.

The final output should be a folder including at least a `config.json` and a `db.sqlite` file.

<img width="909" alt="Screenshot 2024-12-13 at 12 29 24 PM" src="https://github.com/user-attachments/assets/ab31892a-2779-4fe1-9ad5-0f35f8329f9a" />

### Performance traces

TTNN Visualizer supports the reading of TT Metal performance traces. The expected output should be a folder container at least `profile_log_device.csv` and another csv with the performance results.

Consult the TT Metal documentation on [how to generate a performance trace](https://github.com/tenstorrent/tt-metal/tree/main/models/perf#generating-performance-traces).

<img width="916" alt="Screenshot 2024-12-13 at 12 29 44 PM" src="https://github.com/user-attachments/assets/8209f500-7913-41dc-8952-c1307e7720c3" />

### NPE

Network-on-chip performance estimator data can be loaded separately on the `/npe` route.

To generate this data for your model, refer to the [tt-npe documentation](https://github.com/tenstorrent/tt-npe).

## Installing as a Python Wheel

The application is designed to run on user local system and has python requirement of `3.12.3`.

Download the wheel file from the [releases page](https://github.com/tenstorrent/ttnn-visualizer/releases) and install
using `pip install release_name.whl`.

## Running the application

After installation run `ttnn-visualizer` to start the application. If the app does not open automatically in your browser you can navigate to `http://localhost:8000`.

### Docker

The application can also be alternatively installed and run via [Docker](./docker.md).
