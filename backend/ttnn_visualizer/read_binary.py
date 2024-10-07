import struct
import numpy as np

# Constants for reading the binary file
SENTINEL_SIZE = 8  # std::size_t (8 bytes)
VERSION_ID_SIZE = 1  # std::uint8_t (1 byte)
UINT32_SIZE = 4  # uint32_t (4 bytes)
PAD_VALUE_SIZE = 4  # PadValue enum (4 bytes)
PAD_DIMENSION_SIZE = 16  # Each PadDimension is two std::size_t (8 bytes each)


# Enum mappings (these should match the C++ enum values)
class DataType:
    BFLOAT16 = 0
    FLOAT32 = 1
    UINT32 = 2
    BFLOAT8_B = 3
    BFLOAT4_B = 4
    UINT8 = 5
    UINT16 = 6
    INT32 = 7
    INVALID = 8


class PadValue:
    ANY = 0
    ZERO = 1
    INFINITY = 2
    NEGATIVE_INFINITY = 3


def debug(message, *args):
    """Helper function to print debug information."""
    print(message.format(*args))


def parse_padding(f, rank):
    """
    Parse the padding structure from the binary file.
    """
    debug("Parsing padding structure for rank: {}", rank)
    pad_dimensions = []
    for i in range(rank):
        # Each PadDimension consists of two std::size_t (8 bytes each)
        front = struct.unpack("Q", f.read(SENTINEL_SIZE))[
            0
        ]  # std::size_t front padding
        back = struct.unpack("Q", f.read(SENTINEL_SIZE))[0]  # std::size_t back padding
        debug("PadDimension[{}] - front: {}, back: {}", i, front, back)
        pad_dimensions.append((front, back))

    # Read PadValue enum (4 bytes)
    pad_value = struct.unpack("I", f.read(PAD_VALUE_SIZE))[0]
    debug("PadValue: {}", pad_value)

    return pad_dimensions, pad_value


def parse_owned_storage(f, data_type):
    """
    Parse the OwnedStorage from the binary file.
    """
    # Read the size of the buffer (std::size_t, 8 bytes)
    buffer_size = struct.unpack("Q", f.read(SENTINEL_SIZE))[0]
    debug("OwnedStorage - buffer_size: {}", buffer_size)

    # Read the buffer data based on the DataType
    if data_type == DataType.FLOAT32:
        buffer_data = np.frombuffer(f.read(buffer_size * 4), dtype=np.float32)
        debug("Read FLOAT32 buffer of size: {}", buffer_size)
    elif data_type == DataType.UINT32:
        buffer_data = np.frombuffer(f.read(buffer_size * 4), dtype=np.uint32)
        debug("Read UINT32 buffer of size: {}", buffer_size)
    elif data_type == DataType.UINT8:
        buffer_data = np.frombuffer(f.read(buffer_size), dtype=np.uint8)
        debug("Read UINT8 buffer of size: {}", buffer_size)
    elif data_type == DataType.UINT16:
        buffer_data = np.frombuffer(f.read(buffer_size * 2), dtype=np.uint16)
        debug("Read UINT16 buffer of size: {}", buffer_size)
    elif data_type == DataType.INT32:
        buffer_data = np.frombuffer(f.read(buffer_size * 4), dtype=np.int32)
        debug("Read INT32 buffer of size: {}", buffer_size)
    else:
        raise ValueError(f"Unsupported data type: {data_type}")

    return buffer_data


def parse_borrowed_storage(f, data_type):
    """
    Parse the BorrowedStorage from the binary file.
    The format is similar to OwnedStorage.
    """
    debug("Parsing BorrowedStorage")
    return parse_owned_storage(f, data_type)


def parse_storage(f, storage_type, data_type):
    """
    Parse different types of storage based on the StorageType enum.
    """
    debug("Parsing storage - StorageType: {}", storage_type)

    if storage_type == 0:  # OWNED
        return parse_owned_storage(f, data_type)
    elif storage_type == 2:  # BORROWED
        return parse_borrowed_storage(f, data_type)
    elif storage_type == 4:  # MULTI_DEVICE_HOST
        # MultiDeviceHostStorage involves multiple buffers
        num_buffers = struct.unpack("Q", f.read(SENTINEL_SIZE))[
            0
        ]  # std::size_t num_buffers
        debug("MultiDeviceHostStorage - num_buffers: {}", num_buffers)
        buffers = []
        for i in range(num_buffers):
            buffer = parse_owned_storage(f, data_type)  # Parse each buffer
            debug("Parsed buffer {} of MultiDeviceHostStorage", i)
            buffers.append(buffer)
        return buffers
    else:
        # Debug output for unsupported storage types
        debug("Encountered unsupported StorageType: {}", storage_type)
        # Continue reading, or return None for now
        return None  # Or raise ValueError if you want to stop execution


def parse_bin_file(file_path):
    with open(file_path, "rb") as f:
        # Read sentinel value (std::size_t, 8 bytes)
        sentinel = struct.unpack("Q", f.read(SENTINEL_SIZE))[0]
        debug("Sentinel value: {}", sentinel)

        # Read version ID (std::uint8_t, 1 byte)
        version_id = struct.unpack("B", f.read(VERSION_ID_SIZE))[0]
        debug("Version ID: {}", version_id)

        # Read the shape (assuming it's a tensor with shape rank and dimensions)
        rank = struct.unpack("Q", f.read(SENTINEL_SIZE))[0]  # std::size_t for rank
        debug("Shape rank: {}", rank)

        dimensions = []
        for i in range(rank):
            dim = struct.unpack("I", f.read(UINT32_SIZE))[0]  # uint32_t per dimension
            debug("Dimension[{}]: {}", i, dim)
            dimensions.append(dim)

        # Read the padding structure (if applicable)
        pad_dimensions, pad_value = parse_padding(f, rank)

        # Read the data type (DataType enum, 4 bytes)
        data_type = struct.unpack("I", f.read(UINT32_SIZE))[0]
        debug("DataType: {}", data_type)

        # Read the storage type (StorageType enum, 4 bytes)
        storage_type = struct.unpack("I", f.read(UINT32_SIZE))[0]
        debug("StorageType: {}", storage_type)

        # Parse the storage (OwnedStorage, BorrowedStorage, MultiDeviceHostStorage)
        tensor_data = parse_storage(f, storage_type, data_type)

        # Reshape tensor based on dimensions and return
        if isinstance(tensor_data, np.ndarray):
            tensor = tensor_data.reshape(dimensions)
            debug("Tensor reshaped: {}", tensor.shape)
        else:
            # Handle multi-buffer storage types (e.g., MultiDeviceHostStorage)
            tensor = [buffer.reshape(dimensions) for buffer in tensor_data]
            debug("Multi-buffer tensor reshaped for each buffer")

        return tensor, pad_dimensions, pad_value


if __name__ == "__main__":
    # Parse the binary file and print the results
    binary_path = "the_path_to_binary"
    tensor, pad_dimensions, pad_value = parse_bin_file(binary_path)
    print("Tensor Data:", tensor)
    print("Padding Dimensions:", pad_dimensions)
    print("Padding Value:", pad_value)
