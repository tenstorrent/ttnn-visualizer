
<div align="center">

<h1>TT-NN Visualizer</h1>

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./src/assets/tt-logo-dark.svg">
  <img alt="" src="./src/assets/tt-logo.svg">
</picture>

A tool for visualizing the Tenstorrent Neural Network model (TT-NN)

</div>

<h2>

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
- Supports multiple instances of the application running concurrently

### Demo

#### Application demo

https://github.com/user-attachments/assets/80e6cfe5-24c4-4d5f-8c1e-2a6a2f9651ff

| L1 Summary with Tensor highlight | Operation inputs and ouputs |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="L1 Summary with Tensor highlight" src="https://github.com/user-attachments/assets/2f58f832-a514-480e-8ddb-80a5e68a3a3d" /> | <img width="400" alt="Operation inputs and outputs" src="https://github.com/user-attachments/assets/e9480ad2-7e24-436b-932b-050c6b489516" /> |

| Device operations with memory consumption | DRAM memory allocation |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Device operations with memory consumption" src="https://github.com/user-attachments/assets/33f83d13-4597-4ad6-bf93-3e81d888a16c" /> | <img width="400" alt="DRAM memory allocations" src="https://github.com/user-attachments/assets/050b2d08-6623-4216-9cfb-a68b62a22e21" /> |

| Operation graph view | Model buffer summary |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Operation graph view" src="https://github.com/user-attachments/assets/04813765-8dd1-48af-b054-4de3fe1afba3" /> | <img width="400" alt="Model buffer summary" src="https://github.com/user-attachments/assets/0371e8bc-1f08-43db-a5a1-6191a611d411" /> |

| Per core allocation details | Per core allocation details for individual tensors |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Per core allocation details" src="https://github.com/user-attachments/assets/276735f3-7cbe-4c18-a765-10650c050663" /> | <img width="400" alt="Per core allocation details for individual tensor" src="https://github.com/user-attachments/assets/b8f7f22d-88ee-4384-a5b8-89a792823e59" /> |

## Getting started

How to [get started](./docs/getting-started.md) with TT-NN Visualizer.

## Remote Querying

Use [remote querying](./docs/remote-querying.md) instead of syncing the report data to your local file system.

## Sample models

You may test the application using the following sample reports.

Unzip the files into their own directories and select them with the local folder selector.

**Segformer encoder**
[report](https://github.com/user-attachments/files/17996493/segformer_encoder.zip)

**Segformer decoder**
[report](https://github.com/user-attachments/files/17996491/segformer_decoder_good.zip)

**Llama mlp**
[report](https://github.com/user-attachments/files/18129462/llama_mlp.zip)
[performance trace](https://github.com/user-attachments/files/18129457/llama_mlp_tracy.zip)

## Contributing

How to run [TT-NN Visualizer](./docs/contributing.md) from source.
