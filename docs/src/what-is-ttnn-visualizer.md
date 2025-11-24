# What is TT-NN Visualizer?

The visualiser is a diagnostic tool for visualizing the Tenstorrent Neural Network model ([TT-NN](https://docs.tenstorrent.com/tt-metal/latest/ttnn/index.html)). 

The app is available to [install via PyPI](https://docs.tenstorrent.com/ttnn-visualizer/src/installing.html#installing-from-pypi) or [hosted online](https://ttnn-visualizer.tenstorrent.com/). You may also [build and run from source](https://docs.tenstorrent.com/ttnn-visualizer/src/running-from-source.html).

## Features
<!-- Reports -->
- Upload reports from the local file system or sync remotely via SSH

<!-- Operations -->
- Filterable list of all operations in the model

<!-- Op Details -->
- Interactive memory and tensor visualizations, including per core allocations, memory layout, allocation over time
- Input/output tensors details per operation including allocation details per core
- Navigable device operation tree with associated buffers and circular buffers

<!-- Tensors -->
- Filterable list of tensor details and flagging of high consumer or late deallocated tensors

<!-- Buffers -->
- Visual overview of all buffers for the entire model run 

<!-- Graph -->
- Interactive model graph view (operations and connecting tensors)

<!-- Perf -->
- Integration with tt-perf-report performance analysis
- Compare multiple performance traces in charts and tables

<!-- NPE -->
- Network-on-chip performance estimator (NPE) for Tenstorrent Tensix-based devices

<!-- Topology -->
- Display physical topology and configuration of Tenstorrent chip clusters

<!-- Misc -->
- Run multiple instances of the application concurrently

For the latest updates see [releases](https://github.com/tenstorrent/ttnn-visualizer/releases).
