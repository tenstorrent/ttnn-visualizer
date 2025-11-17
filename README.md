
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

Please see the [getting started](https://github.com/tenstorrent/ttnn-visualizer/blob/main/docs/src/getting-started.md) guide for further information on getting up and running with TT-NN Visualizer.

If you want to test out TT-NN Visualizer you can try some of the [sample data](https://github.com/tenstorrent/ttnn-visualizer/tree/main?tab=readme-ov-file#sample-reports). See [loading data](https://github.com/tenstorrent/ttnn-visualizer/blob/main/docs/src/getting-started.md#loading-data) for instructions on how to use this.

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
| <img width="400" alt="L1 Summary with Tensor highlight" src="https://github.com/user-attachments/assets/7c6a3558-1084-492b-ac0b-f5f910487c8f" /> | <img width="400" alt="Operation inputs and outputs" src="https://github.com/user-attachments/assets/48197e65-4831-4005-9da8-99574c47d5c7" /> |

| Device operations with memory consumption | DRAM memory allocation |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Device operations with memory consumption" src="https://github.com/user-attachments/assets/4b8cefb9-fd75-4291-9e64-ab2f2c866c51" />| <img width="400" alt="DRAM memory allocations" src="https://github.com/user-attachments/assets/a9ad8b1d-200c-4c10-b1d8-5d76900c688c" /> |

| Operation graph view | Model buffer summary |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Operation graph view" src="https://github.com/user-attachments/assets/422f1591-4232-4d16-a783-726960261443" /> | <img width="400" alt="Model buffer summary" src="https://github.com/user-attachments/assets/9afa48b2-628d-4dad-ac89-42fda762aee6" /> |

| Per core allocation details | Per core allocation details for individual tensors |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Per core allocation details" src="https://github.com/user-attachments/assets/681c8d0e-c628-4839-afca-f31ff9d53f73" /> | <img width="400" alt="Per core allocation details for individual tensor" src="https://github.com/user-attachments/assets/a9d66f2d-2457-4ced-b777-6e8f0c54eb86" /> |

| Tensor details list | Performance report |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Tensor details list" src="https://github.com/user-attachments/assets/315089ff-ae75-4615-87b9-19c45431871c" /> | <img width="400" alt="Performnance analysis" src="https://github.com/user-attachments/assets/468b0acb-733e-4891-8e16-781c47889017" /> |

| Performance charts |  |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="Performance charts" src="https://github.com/user-attachments/assets/19f6bd6f-8f48-48dd-b9ee-726b1a1e40e3" /> |  <img width="400" alt="Performance charts" src="https://github.com/user-attachments/assets/bc6ae03b-f143-4ee5-9f14-834ddf8b0cde" /> |

| NPE |  |
|-----------------------------------------------|------------------------------------------|
| <img width="400" alt="NPE" src="https://github.com/user-attachments/assets/5f45c1bf-565d-4003-b3b7-0ddd90cbdeca" /> | <img width="400" alt="NPE" src="https://github.com/user-attachments/assets/8a3e9a09-4c86-45a6-9916-52fba16debc6" />

## Sample reports

You may test the application using the following sample reports.

Unzip the files into their own directories and select them with the local folder selector, or load the NPE data on the `/npe` route.

**Segformer encoder**
[memory report](https://github.com/user-attachments/files/17996493/segformer_encoder.zip)

**Segformer decoder**
[memory report](https://github.com/user-attachments/files/17996491/segformer_decoder_good.zip)

**Llama mlp**
[memory + performance report](https://github.com/user-attachments/files/18770763/llama_attn_32l_10iter_30jan.zip)

**N300 llama**
[memory + performance report with NPE data + cluster description](https://github.com/user-attachments/files/21496609/n300.zip)

### NPE report

**T3K synthetic**
[synthetic_t3k_small.json.zip](https://github.com/user-attachments/files/20491459/synthetic_t3k_small.json.zip)




## Contributing

How to run [TT-NN Visualizer](https://github.com/tenstorrent/ttnn-visualizer/blob/main/docs/src/contributing.md) from source.
