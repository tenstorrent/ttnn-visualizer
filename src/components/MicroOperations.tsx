interface MemoryConfig {
    buffer_type: number;
    memory_layout: number;
    shard_spec: number | null;
}

interface InputTensor {
    dtype: number;
    layout: number;
    memory_config: MemoryConfig;
}

interface MicroOperation {
    composite_parent_names: [];
    input_tensor_records: InputTensor[];
    operation_name: string;
    operation_type: string;
    program_cache_hit: boolean | null;
    program_hash: number | null;
    ttnn_operation_id: number;
}

interface MicroOperationsData {
    microOperations: MicroOperation[];
}

function MicroOperations({ microOperations }: MicroOperationsData) {
    return (
        <table className='operation-arguments'>
            <caption>Micro Operations</caption>

            <tbody>
                <tr>
                    <td>Operation name</td>
                    <td>Operation type</td>
                    <td>Program cache hit</td>
                    <td>Program hash</td>
                    <td>Attributes</td>
                </tr>

                {microOperations.map((op) => (
                    <tr key={op.program_hash}>
                        <td>{op.operation_name}</td>
                        <td>{op.operation_type}</td>
                        <td>{op.program_cache_hit?.toString() ?? 'null'}</td>
                        <td>{op.program_hash ?? 'null'}</td>
                        <td>
                            {op.input_tensor_records.map((inputTensor, index) => (
                                // eslint-disable-next-line react/no-array-index-key
                                <table key={`${op.program_hash}-${index}`}>
                                    <tbody>
                                        <tr>
                                            <td>Dtype</td>
                                            <td>{inputTensor.dtype}</td>
                                        </tr>

                                        <tr>
                                            <td>Layout</td>
                                            <td>{inputTensor.layout}</td>
                                        </tr>

                                        <tr>
                                            <td>Memory config</td>
                                            <td>
                                                <table>
                                                    <tbody>
                                                        <tr>
                                                            <td>Buffer type</td>
                                                            <td>{inputTensor.memory_config.buffer_type}</td>
                                                        </tr>

                                                        <tr>
                                                            <td>Memory layout</td>
                                                            <td>{inputTensor.memory_config.memory_layout}</td>
                                                        </tr>

                                                        <tr>
                                                            <td>Shard spec</td>
                                                            <td>{inputTensor.memory_config.shard_spec ?? 'null'}</td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            ))}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default MicroOperations;
