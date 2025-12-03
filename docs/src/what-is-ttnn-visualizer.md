# What is TT-NN Visualizer?

The visualiser is a diagnostic tool for visualizing the Tenstorrent Neural Network model ([TT-NN](https://docs.tenstorrent.com/tt-metal/latest/ttnn/index.html)). 

The app is available to [install via PyPI](./installing.md#installing-from-pypi) or [hosted online](https://ttnn-visualizer.tenstorrent.com/). You may also [build and run from source](./running-from-source.md).

## Features

### Reports
- Upload reports from the local file system or sync remotely via SSH
- Switch seamlessly between previously uploaded or synced reports
- Run multiple instances of the application concurrently with different data
- Set data ranges for both memory and performance traces
- Display physical topology and configuration of Tenstorrent chip clusters

### Operations
- Filterable list of all operations in the model
- Interactive memory and tensor visualizations, including per core allocations, memory layout, allocation over time
- Input/output tensors details per operation including allocation details per core
- Navigable device operation tree with associated buffers and circular buffers

### Tensors
- List of tensor details filterable by buffer type
- Flagging of high consumer or late deallocated tensors

### Buffers
- Visual overview of all buffers for the entire model run by L1 or DRAM memory
- Toggle additional overlays such as memory layouts or late deallocated tensors
- Ease of navigation to the relevant operation
- Track a specific buffer in the data across the application
- Filterable table view for a more schematic look at buffers

### Graph
- Interactive model graph view showing all operations and connecting tensors
- Filter out deallocated operations 
- Find all operations by name

### Performance
- Integration with tt-perf-report and rendering of performance analysis
- Interactive charts and tables
- Multiple filtering options of performance data 
- Compare multiple performance traces

### NPE
- Network-on-chip performance estimator (NPE) for Tenstorrent Tensix-based devices
- Dedicated NPE visualizations: zones, transfers, congestion, timelines with elaborate filtering capability

For the latest updates see [releases](https://github.com/tenstorrent/ttnn-visualizer/releases).
