# Running the application

After installation run `ttnn-visualizer` to start the application. If the app does not open automatically in your browser you can navigate to `http://localhost:8000`.

Data can be loaded from your local file system or remotely via ssh.

## Local data 

<img width="595" alt="Local folder upload" src="https://github.com/user-attachments/assets/8fce6283-689b-4389-b8c5-4f77a76ae8e9" />

For both profiler and performance data, TT-NN Visualizer expects the relevant files to be in their own directories. Ensure that the directory you select contains the necessary files for the input type you are working with.

Please note that currently NPE data can only be loaded locally on the NPE screen.

## Remote data

<img width="595" alt="Remote folder sync" src="https://github.com/user-attachments/assets/366ae8cd-ee5a-4dfe-a7f0-3229df003c6f" />

Loading data remotely requires you to have SSH access to the relevant machine. You will have to specify paths on the remote machine to look for the profiler and performance data.

<img width="615" alt="Remote connection fields" src="https://github.com/user-attachments/assets/973ef716-8b7f-4986-919d-c904a56aa4dc" />

You can have multiple sets of profiler data on the remote paths, but they must be separated into their own folders.

The application will sync the files from the remote server to your local machine for analysis.

**Need help setting up SSH?** See our [Remote Sync guide](./remote-sync.md) for detailed SSH setup instructions.

## Preload data on app launch

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

## TT-Metal Home

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
