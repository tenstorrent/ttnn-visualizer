# What is TT-NN Visualizer?

The visualiser is a diagnostic tool for visualizing the Tenstorrent Neural Network model (TT-NN). 

## Features
- Comprehensive list of all operations in the model
- Load reports via the local file system or through an SSH connection
- Interactive graph visualization of operations
- Detailed and interactive L1, DRAM, and circular buffer memory plots
- Filterable list of tensor details
- Flagging of high consumer or late deallocated tensors
- Overview of all buffers for the entire model run
- Visualization of input and output tensors with core tiling and sharding details
- Visualize inputs/outputs per tensor or tensor allocation across each core
- Detailed insights into L1 peak memory consumption, with an interactive graph of allocation over time
- Navigable device operation tree with associated buffers and circular buffers
- Operation flow graph for a holistic view of model execution
- Run multiple instances of the application concurrently
- Network-on-chip performance estimator (NPE) for Tenstorrent Tensix-based devices
- Integration with tt-perf-report performance trace analysis
- Compare multiple performance traces in charts and tables

For the latest updates see [releases](https://github.com/tenstorrent/ttnn-visualizer/releases).
