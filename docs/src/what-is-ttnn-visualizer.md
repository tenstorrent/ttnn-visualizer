# What is TT-NN Visualizer?

The visualiser is a diagnostic tool for visualizing the Tenstorrent Neural Network model ([TT-NN](https://docs.tenstorrent.com/tt-metal/latest/ttnn/index.html)). 

The app is available to [install via PyPI](./installing.md#installing-from-pypi) or [hosted online](https://ttnn-visualizer.tenstorrent.com/). You may also [build and run from source](./running-from-source.md).

## Features
- Upload reports from the local file system or sync remotely via SSH
- Filterable list of all operations in the model
- Interactive memory and tensor visualizations, including per core allocations, memory layout, allocation over time
- Input/output tensors details per operation including allocation details per core
- Navigable device operation tree with associated buffers and circular buffers
- Filterable list of tensor details and flagging of high consumer or late deallocated tensors
- Visual overview of all buffers for the entire model run 
- Interactive model graph view (operations and connecting tensors)
- Integration with tt-perf-report performance analysis
- Compare multiple performance traces in charts and tables
- Network-on-chip performance estimator (NPE) for Tenstorrent Tensix-based devices
- Display physical topology and configuration of Tenstorrent chip clusters
- Run multiple instances of the application concurrently

For the latest updates see [releases](https://github.com/tenstorrent/ttnn-visualizer/releases).
