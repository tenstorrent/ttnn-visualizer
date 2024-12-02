
<div align="center">

<h1 style="color: #FA512E;"> TT-NN Visualizer </h1>

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./src/assets/tt-logo-dark.svg">
  <img alt="" src="./src/assets/tt-logo.svg">
</picture>

A tool for visualizing the Tenstorrent Neural Network model (TT-NN)

</div>

<h2 style="text-align: center">

[Buy Hardware](https://tenstorrent.com/cards/) | [Install TT-NN](https://github.com/tenstorrent/tt-metal/blob/main/INSTALLING.md) | [Discord](https://discord.gg/tvhGzHQwaj) | [Join Us](https://boards.greenhouse.io/tenstorrent/jobs/4155609007)

</h2>

</div>

## Features

For the latest updates and features, please see [releases](https://github.com/tenstorrent/ttnn-visualizer/releases).

- Comprehensive list of all operations in the model
- Interactive graph visualization of operations
- Detailed and interactive L1, DRAM, and circular buffer memory plots
- Filterable list of tensor details
- Overview of all buffers for the entire model run
- Visualization of input and output tensors with core tiling and sharding details
- Visualize inputs/outputs per tensor or tensor allocation across each core
- Detailed insights into L1 peak memory consumption, with an interactive graph of allocation over time
- Navigate a tree of device operations with associated buffers and circular buffers
- Operation flow graph for a holistic view of model execution
- Load reports via the local file system or through an SSH connection
- Support for multiple instances of the application running concurrently

### Demo

#### Application demo

https://github.com/user-attachments/assets/80e6cfe5-24c4-4d5f-8c1e-2a6a2f9651ff

#### L1 Summary with Tensor highlight

<img width="400" alt="L1 Summary with Tensor highlight" src="https://github.com/user-attachments/assets/ef0ce0d5-ae00-4030-a1a1-91ae0c1db930">

#### Operation inputs and ouputs

<img width="400" alt="Operation inputs and outputs" src="https://github.com/user-attachments/assets/3e59c95c-9a57-459c-98c0-e8d86f4e38ec">

#### Device operations with memory consumption

<img width="400" alt="Device operations with memory consumption" src="https://github.com/user-attachments/assets/ae0a261e-650c-4c03-92a8-d2a00ada594b">

#### DRAM memory allocation

<img width="400" alt="DRAM memory allocations" src="https://github.com/user-attachments/assets/4cdfa75e-2a47-4de6-85ce-ce0441e7cc83">

#### Operation graph view

<img width="400" alt="Operation graph view" src="https://github.com/user-attachments/assets/291dc2d3-5737-4a51-8e0d-41b1b03a385c">

#### Model buffer summary

<img width="400" alt="Model buffer summary" src="https://github.com/user-attachments/assets/a384c61e-10e8-4884-8a10-223b2014a29d">

#### Per core allocation details

<img width="400" alt="Per core allocation details" src="https://github.com/user-attachments/assets/b2fb8ea5-90e0-4c0c-8a4a-ad8891b3d7a1">

#### Per core allocation details for individual tensors

<img width="400" alt="Per core allocation details for individual tensor" src="https://github.com/user-attachments/assets/047129c1-d80b-4d2b-9940-7c162052280d">

## Getting started

How to [get started](./docs/getting-started.md) with TT-NN Visualizer.

## Remote Querying

Use [remote querying](./docs/remote-querying.md) instead of file syncing the report data.

## Contributing

How to run [TT-NN Visualizer](./docs/contributing.md) from source.
