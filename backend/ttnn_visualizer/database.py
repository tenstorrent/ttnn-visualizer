import sqlite3
from logging import getLogger

logger = getLogger(__name__)


def create_update_database(sqlite_db_path):
    """
    Creates or updates database with all tables
    :param sqlite_db_path Path to target SQLite database
    :return:
    """
    sqlite_connection = sqlite3.connect(sqlite_db_path)
    logger.info("Creating/updating SQLite database")
    cursor = sqlite_connection.cursor()
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS devices
                (
                    device_id int,
                    num_y_cores int,
                    num_x_cores int,
                    num_y_compute_cores int,
                    num_x_compute_cores int,
                    worker_l1_size int,
                    l1_num_banks int,
                    l1_bank_size int,
                    address_at_first_l1_bank int,
                    address_at_first_l1_cb_buffer int,
                    num_banks_per_storage_core int,
                    num_compute_cores int,
                    num_storage_cores int,
                    total_l1_memory int,
                    total_l1_for_tensors int,
                    total_l1_for_interleaved_buffers int,
                    total_l1_for_sharded_buffers int,
                    cb_limit int
                )"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS tensors
                (tensor_id int UNIQUE, shape text, dtype text, layout text, memory_config text, device_id int, address int, buffer_type int)"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS local_tensor_comparison_records
                (tensor_id int UNIQUE, golden_tensor_id int, matches bool, desired_pcc bool, actual_pcc float)"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS global_tensor_comparison_records
                (tensor_id int UNIQUE, golden_tensor_id int, matches bool, desired_pcc bool, actual_pcc float)"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS operations
                (operation_id int UNIQUE, name text, duration float)"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS operation_arguments
                (operation_id int, name text, value text)"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS stack_traces
                (operation_id int, stack_trace text)"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS input_tensors
                (operation_id int, input_index int, tensor_id int)"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS output_tensors
                (operation_id int, output_index int, tensor_id int)"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS buffers
                (operation_id int, device_id int, address int, max_size_per_bank int, buffer_type int)"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS buffer_pages
                (operation_id int, device_id int, address int, core_y int, core_x int, bank_id int, page_index int, page_address int, page_size int, buffer_type int)"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS nodes
                (operation_id int, unique_id int, node_operation_id int, name text)"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS edges
                (operation_id int, source_unique_id int, sink_unique_id int, source_output_index int, sink_input_index int, key int)"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS captured_graph
                (operation_id int, captured_graph text)"""
    )
    sqlite_connection.commit()
