
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

https://github.com/user-attachments/assets/d00a2629-0bd1-4ee1-bb12-bd796d85221d

| L1 Summary with Tensor highlight | Operation inputs and ouputs |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="L1 Summary with Tensor highlight" src="https://github.com/user-attachments/assets/73c0aff8-16b2-4d1e-85a8-81c434012d36" /> | <img width="400" alt="Operation inputs and outputs" src="https://github.com/user-attachments/assets/e9480ad2-7e24-436b-932b-050c6b489516" /> |

| Device operations with memory consumption | DRAM memory allocation |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Device operations with memory consumption" src="https://github.com/user-attachments/assets/33f83d13-4597-4ad6-bf93-3e81d888a16c" /> | <img width="400" alt="DRAM memory allocations" src="https://github.com/user-attachments/assets/39e73896-2a6a-4404-8a82-c76c10662ca3" /> |

| Operation graph view | Model buffer summary |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Operation graph view" src="https://github.com/user-attachments/assets/04813765-8dd1-48af-b054-4de3fe1afba3" /> | <img width="400" alt="Model buffer summary" src="https://github.com/user-attachments/assets/0371e8bc-1f08-43db-a5a1-6191a611d411" /> |

| Per core allocation details | Per core allocation details for individual tensors |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Per core allocation details" src="https://github.com/user-attachments/assets/e1647b4d-9bf9-4e30-98a5-8cfd48ef495f" /> | <img width="400" alt="Per core allocation details for individual tensor" src="https://github.com/user-attachments/assets/c160744e-0c23-42da-a3a4-ad4bbe513061" /> |

| Tensor details list | Performance report |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Tensor details list" src="https://github.com/user-attachments/assets/d19d770b-a6cd-4c5d-96d5-181c2a5e9692" /> | <img width="400" alt="Performance report" src="https://github.com/user-attachments/assets/882ca7e3-3ef8-47cd-9e78-f69474f13e86" /> |

| Performance charts |  |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Performance analysis" src="https://github.com/user-attachments/assets/03f64a7a-262a-4b2a-a0b6-c70f3f14705c" /> |  <img width="400" alt="" src="https://github.com/user-attachments/assets/224d14f7-c7b3-4f4c-99c6-528c800b1a84" /> |

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
