# Getting started

## Prerequisites

TT-NN Visualizer requires data generated from TT-NN to analyze.

Follow instructions for setting up [TT-Metalium](https://github.com/tenstorrent/tt-metal) and [TT-NN](https://github.com/tenstorrent/tt-metal/blob/main/ttnn/README.md).

Recommended PyTest config when generating your data:

``` bash
export TTNN_CONFIG_OVERRIDES='{
    "enable_fast_runtime_mode": false,
    "enable_logging": true,
    "report_name": "TODO ADD NAME",
    "enable_graph_report": false,
    "enable_detailed_buffer_report": true,
    "enable_detailed_tensor_report": false,
    "enable_comparison_mode": false
}'
```

To run a test with custom input data, you can use the following command with suitable values for `input-path`:

``` bash
pytest --disable-warnings --input-path="path/to/input.json" path/to/test_file.py::test_function[param]
```

For more information on generating data please refer to [TT-Metalium](https://docs.tenstorrent.com/tt-metalium/latest/get_started/get_started.html), [TT-NN](https://docs.tenstorrent.com/ttnn/latest/ttnn/get_started.html) and [TT-NN models](https://docs.tenstorrent.com/tt-metal/latest/ttnn/tt_metal_models/get_started.html#running-an-example-model) documentation.

The final output should be a folder including at least a `config.json` and a `db.sqlite` file.

<img width="909" alt="Screenshot 2024-12-13 at 12 29 24 PM" src="https://github.com/user-attachments/assets/ab31892a-2779-4fe1-9ad5-0f35f8329f9a" />

### Performance reports

TT-NN Visualizer supports the reading of TT-Metalium performance reports. The expected output should be a folder containing `profile_log_device.csv`, another csv with the performance results, e.g. `ops_perf_results_2024_12_11_11_09_16.csv`, and a `tracy_profile_log_host.tracy` file.

Consult the TT-Metalium documentation on [how to generate a performance report](https://github.com/tenstorrent/tt-perf-report?tab=readme-ov-file#generating-performance-traces).

<img width="916" alt="Screenshot 2024-12-13 at 12 29 44 PM" src="https://github.com/user-attachments/assets/8209f500-7913-41dc-8952-c1307e7720c3" />

### NPE

Network-on-chip performance estimator data can be loaded separately on the `/npe` route.

To generate this data for your model, refer to the [tt-npe documentation](https://github.com/tenstorrent/tt-npe).

## Installing from PyPI

TT-NN Visualizer can be installed from PyPI:

`pip install ttnn-visualizer`

After installation run `ttnn-visualizer` to start the application.

It is recommended to do this within a virtual environment. The minimum supported version of Python is **3.10**. Pyenv can be used to ensure the application runs with a supported version of Python:

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

## Running the application

After installation run `ttnn-visualizer` to start the application. If the app does not open automatically in your browser you can navigate to `http://localhost:8000`.

## Loading data

Data can be loaded from your local machine or remotely via ssh.

### Local

<img width="595" alt="Screenshot 2025-03-14 at 1 32 23 PM" src="https://github.com/user-attachments/assets/8fce6283-689b-4389-b8c5-4f77a76ae8e9" />

For both profiler and performance data, TT-NN Visualizer expects the relevant files to be in their own directories. Ensure that the directory you select contains the necessary files for the input type you are working with.

Please note that currently NPE data can only be loaded locally on the NPE screen.

### Remote

<img width="595" alt="Screenshot 2025-03-14 at 1 32 32 PM" src="https://github.com/user-attachments/assets/366ae8cd-ee5a-4dfe-a7f0-3229df003c6f" />

Loading data remotely requires you to have SSH access to the relevant machine. You will have to specify paths on the remote machine to look for the profiler and performance data.

<img width="615" alt="Screenshot 2025-03-14 at 1 44 07 PM" src="https://github.com/user-attachments/assets/973ef716-8b7f-4986-919d-c904a56aa4dc" />

You can have multiple sets of profiler data on the remote paths, but they must be separated into their own folders.

The application will sync the files from the remote server to your local machine for analysis.

**Need help setting up SSH?** See our [Remote Sync guide](https://github.com/tenstorrent/ttnn-visualizer/blob/main/docs/remote-sync.md) for detailed SSH setup instructions.

### Custom report and profiler data paths

The `ttnn-visualizer` command supports two CLI arguments for passing custom data paths:

* `--profiler-path` - specify the local path to the folder containing the report
* `--performance-path` - specify the local path to the folder containing the profiler data
* `--tt-metal-home` - specify the path to the TT Metal repo when running directly on the machine where reports are being generated.

These options allow you to pass the folders when starting the visualizer, instead of uploading the report and profiler
data files from the browser after loading the site. This can be used for starting `ttnn-visualizer` from other tools
with the data preloaded, or for restarting the visualizer with the same data, without having to upload it again.

```bash
ttnn-visualizer --report-path ~/Downloads/report/generated/ttnn/reports/17274205533343344897 --profiler-path ~/Downloads/report/generated/profiler/reports/2025_02_24_23_17_27
```

### TT-Metal Home

If reports are being generated on a machine which is accessible to your local workstation,
the `ttnn-visualizer` command can be run directly on the remote machine and load reports
directly from the directory specified by the `--tt-metal-home` CLI arg or the `TT_METAL_HOME`
env var.

When running this way, you must ensure that the HOST and PORT used by the Flask webserver
on the remote machine or container are accessible to the browser on your local machine. When
working directly with the TT-Metal home directory, the remote sync and upload features are
disabled, and you can see the reports generated on that machine only.

This feature is intended for custom tools and integrations only, that bypass the default ways
of loading data into `ttnn-visualizer`.
