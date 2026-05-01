# Installing

## Prerequisites

TT-NN Visualizer requires data generated from TT-NN to analyze.

Follow instructions for setting up [TT-Metalium](https://docs.tenstorrent.com/tt-metal/latest/tt-metalium/index.html) and [TT-NN](https://docs.tenstorrent.com/tt-metal/latest/ttnn/index.html).

### Memory reports

Recommended pytest config when generating your data:

``` bash
export TTNN_CONFIG_OVERRIDES='{
    "enable_fast_runtime_mode": false,
    "enable_logging": true,
    "report_name": "YOUR REPORT NAME",
    "enable_detailed_buffer_report": true,
    "enable_detailed_tensor_report": false,
    "enable_graph_report": true,
    "enable_comparison_mode": false
}'
```

| Configuration Option | Description |
|----------------------|-------------|
| **enable_fast_runtime_mode** | Disable fast runtime mode to ensure all operations are properly traced. **Must be disabled to enable logging**. |
| **enable_logging** | Synchronizes main thread after every operation and logs the operation. **Must be enabled**. |
| **report_name** | Prefix of the folder name where the memory report is output. **Must have a value for data8 to be output to disk**. |
| **enable_detailed_buffer_report** | Enable to visualize the detailed buffer report after every operation. **Needed for full buffer information**. |
| **enable_detailed_tensor_report** | Enable to visualize the values of input and output tensors of every operation. **Data not used by the visualizer**. |
| **enable_graph_report** | Generates an SVG visualization of the computation graph and enables automatic report generation with pytest. **Must be enabled**. |
| **enable_comparison_mode** | Enable to test the output of operations against their golden implementation. **Optional, not always available on models**. |

To run a test with custom input data, you can use the following command with suitable values for `input-path`:

``` bash
pytest --disable-warnings --input-path="path/to/input.json" path/to/test_file.py::test_function[param]
```

The final output should be a folder within `${TT_METAL_HOME}/generated/ttnn/reports/` which should include at least a `db.sqlite` file (config.json is optional for the visualizer). The report will be created automatically when running TT-Metal model demos and tests with `pytest`, when `enable_logging` and `enable_graph_report` are `true`.

The cluster layout view also expects `cluster_descriptor.yaml` in that same folder. If it is missing, see {ref}`Missing cluster descriptor <cluster-descriptor-missing>`.

<img width="909" alt="Memory report files" src="https://github.com/user-attachments/assets/ab31892a-2779-4fe1-9ad5-0f35f8329f9a" />

For more information on generating data please refer to [TT-Metalium](https://docs.tenstorrent.com/tt-metal/latest/tt-metalium/get_started/get_started.html) and [TT-NN](https://docs.tenstorrent.com/tt-metal/latest/ttnn/ttnn/get_started.html) documentation.

To generate reports with other codebases using TT-NN, see the [TT-NN Graph Tracing](https://github.com/tenstorrent/tt-metal/blob/main/tech_reports/ttnn/graph-tracing.md) documentation.

### Performance reports

TT-NN Visualizer supports the reading of TT-Metalium performance reports. The expected output should be a folder within `${TT_METAL_HOME}/generated/profiler/reports/` containing a `profile_log_device.csv` file, another csv with the performance results, e.g. `ops_perf_results_2024_12_11_11_09_16.csv`, and a `tracy_profile_log_host.tracy` file.

<img width="916" alt="Performance report files" src="https://github.com/user-attachments/assets/8209f500-7913-41dc-8952-c1307e7720c3" />

Consult the TT-Metalium documentation on [how to generate a performance report](https://github.com/tenstorrent/tt-perf-report?tab=readme-ov-file#generating-performance-traces).

### NPE

Network-on-chip performance estimator data can be loaded separately on the `/npe` route.

Refer to the [tt-npe documentation](https://github.com/tenstorrent/tt-npe/blob/main/docs/src/getting_started.md) for more details.

(installing-from-pypi)=
## Installing from PyPI

TT-NN Visualizer can be installed from [PyPI](https://pypi.org/project/ttnn-visualizer/):

`pip install ttnn-visualizer`

After installation run `ttnn-visualizer` to start the application. It is recommended to do this within a virtual environment.

The minimum supported version of Python is **3.10**. Pyenv can be used to ensure the application runs with a supported version of Python:

```bash
mkdir ttnn-visualizer
cd ttnn-visualizer
pyenv local 3.10 # Optional step if using pyenv to manage versions
python -m venv .env
source .env/bin/activate
pip install ttnn-visualizer
ttnn-visualizer
```

See [pyenv](https://github.com/pyenv/pyenv) for installation instructions.

### pipx

If you have `pipx` installed on your system, it can be used to simplify the above steps.

```bash
pipx install --include-deps ttnn-visualizer
ttnn-visualizer
```

See [pipx installation](https://pipx.pypa.io/stable/installation/) for further help with setting up `pipx`.

When installing `ttnn-visualizer` in a virtual environment, ensure that it is not also installed with the system Python. Having the package installed at the system level and in a virtual environment at the same time can lead to version mismatches.

If you run into any issue with an unexpected TT-NN Visualizer version appearing in the browser ensure you have uninstalled the system package by running `pip uninstall ttnn-visualizer` outside of the virtual env.