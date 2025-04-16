
<div align="center">

<h1>TT-NN Visualizer</h1>

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tenstorrent/ttnn-visualizer/refs/heads/main/src/assets/tt-logo-dark.svg">
  <img alt="" src="https://raw.githubusercontent.com/tenstorrent/ttnn-visualizer/refs/heads/main/src/assets/tt-logo.svg">
</picture>

A tool for visualizing the Tenstorrent Neural Network model (TT-NN)

</div>

<h2>

[Buy Hardware](https://tenstorrent.com/cards/) | [Install TT-NN](https://github.com/tenstorrent/tt-metal/blob/main/INSTALLING.md) | [Discord](https://discord.gg/tvhGzHQwaj) | [Join Us](https://boards.greenhouse.io/tenstorrent/jobs/4155609007)

</h2>

</div>

## Quick Start

TT-NN Visualizer can be installed from PyPI:

`pip install ttnn-visualizer`

After installation run `ttnn-visualizer` to start the application.

It is recommended to do this within a virtual environment. The minimum Python version is **3.10**.

Please see the [getting started](https://github.com/tenstorrent/ttnn-visualizer/blob/main/docs/getting-started.md) guide for further information on getting up and running with TT-NN Visualizer.

If you want to test out TT-NN Visualizer you can try some of the [sample data](https://github.com/tenstorrent/ttnn-visualizer/tree/main?tab=readme-ov-file#sample-reports). See [loading data](https://github.com/tenstorrent/ttnn-visualizer/blob/main/docs/getting-started.md#loading-data) for instructions on how to use this.

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
- BETA: Network-on-chip performance estimator (NPE) for Tenstorrent Tensix-based devices

### Demo

#### Application demo

https://github.com/user-attachments/assets/4e51a636-c6d6-46df-bf34-a06bca13c0b3

| L1 Summary with Tensor highlight | Operation inputs and outputs |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="L1 Summary with Tensor highlight" src="https://github.com/user-attachments/assets/6679e3ab-3819-4037-bf63-15aac0f8b625" /> | <img width="400" alt="Operation inputs and outputs" src="https://github.com/user-attachments/assets/7b0bf6da-d6e5-4b8d-b2cd-457181ac6b99" /> |

| Device operations with memory consumption | DRAM memory allocation |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Device operations with memory consumption" src="https://github.com/user-attachments/assets/46f51cde-86ec-4251-8f41-261b5e14e1b7" />| <img width="400" alt="DRAM memory allocations" src="https://github.com/user-attachments/assets/588dbb57-3964-48f8-aa0d-bafc614706d3" /> |

| Operation graph view | Model buffer summary |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Operation graph view" src="https://github.com/user-attachments/assets/a77b099e-9caa-4758-8dee-8b30cad4dad8" /> | <img width="400" alt="Model buffer summary" src="https://github.com/user-attachments/assets/90a4c0e6-58cb-4031-b224-a91f3beadc51" /> |

| Per core allocation details | Per core allocation details for individual tensors |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Per core allocation details" src="https://github.com/user-attachments/assets/0d4a833a-d9b6-4239-a953-42c0b84d4f80" /> | <img width="400" alt="Per core allocation details for individual tensor" src="https://github.com/user-attachments/assets/06b69fbb-c6fc-45fe-9360-36722e68bee5" /> |

| Tensor details list | Performance report |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Tensor details list" src="https://github.com/user-attachments/assets/919da94e-45f9-432e-9eb4-c584b4140663" /> | <img width="400" alt="Performnance analysis" src="https://github.com/user-attachments/assets/468b0acb-733e-4891-8e16-781c47889017" /> |

| Performance charts |  |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Performance charts" src="https://github.com/user-attachments/assets/23e6b1d0-2def-490a-8921-3477ded2c8ce" /> |  <img width="400" alt="Performance charts" src="https://github.com/user-attachments/assets/ee620711-10be-4582-ab6f-635c896a1101" /> |

| NPE |  |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="NPE" src="https://github.com/user-attachments/assets/5a25a79c-0fcc-4298-aaae-8e8656b99ab5" /> | <img width="400" alt="NPE" src="https://github.com/user-attachments/assets/b2845948-02fa-4255-81f4-fc3257a282da" />


## Sample reports

You may test the application using the following sample reports.

Unzip the files into their own directories and select them with the local folder selector, or load the NPE data on the `/npe` route.

**Segformer encoder**
[memory report](https://github.com/user-attachments/files/17996493/segformer_encoder.zip)

**Segformer decoder**
[memory report](https://github.com/user-attachments/files/17996491/segformer_decoder_good.zip)

**Llama mlp**
[memory + performance report](https://github.com/user-attachments/files/18770763/llama_attn_32l_10iter_30jan.zip)

### NPE report

**Llama decode**
[npe data](https://github.com/user-attachments/files/18772778/llama-decode-3B.zip)


## Contributing

How to run [TT-NN Visualizer](https://github.com/tenstorrent/ttnn-visualizer/blob/main/docs/contributing.md) from source.
