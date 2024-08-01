import { MicroOperation } from '../model/Graph';

interface MicroOperationsData {
    microOperations: MicroOperation[];
}

function MicroOperations({ microOperations }: MicroOperationsData) {
    return (
        <div>
            <table className='arguments-table'>
                <caption>Micro Operations</caption>

                <tbody>
                    <tr>
                        <th>Operation name</th>
                        <th>Operation type</th>
                        <th>Program cache hit</th>
                        <th>Program hash</th>
                    </tr>

                    {microOperations.map((op) => (
                        <tr key={op.program_hash}>
                            <td>{op.operation_name}</td>
                            <td>{op.operation_type}</td>
                            <td>{op.program_cache_hit?.toString() ?? 'null'}</td>
                            <td>{op.program_hash ?? 'null'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <p>
                <strong>Input tensor records</strong>
            </p>

            <div className='microops'>
                {microOperations.map((op) =>
                    op.input_tensor_records.map((inputTensor, index) => (
                        <table
                            // eslint-disable-next-line react/no-array-index-key
                            key={`${op.program_hash}-${index}`}
                            className='arguments-table has-vertical-headings'
                        >
                            <tbody>
                                <tr>
                                    <th>Dtype</th>
                                    <td>{inputTensor.dtype}</td>
                                </tr>

                                <tr>
                                    <th>Layout</th>
                                    <td>{inputTensor.layout}</td>
                                </tr>

                                <tr>
                                    <th>Memory config</th>
                                    <td>
                                        <table className='memory-config'>
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

                                <tr>
                                    <td>Shape</td>
                                    <td>
                                        <table className='arguments-table has-vertical-headings'>
                                            <tbody>
                                                <tr>
                                                    <th>Dimensions</th>
                                                    <td>
                                                        [
                                                        {inputTensor.shape.dimensions
                                                            .slice(0, inputTensor.shape.rank)
                                                            .toString()}
                                                        ]
                                                    </td>
                                                </tr>

                                                <tr>
                                                    <th>Padding dimensions</th>
                                                    <td>
                                                        [
                                                        {inputTensor.shape.padding.pad_dimensions
                                                            .slice(0, inputTensor.shape.padding.rank)
                                                            .map(
                                                                (paddingDimension) =>
                                                                    `[${paddingDimension.back},${paddingDimension.front}]`,
                                                            )
                                                            .toString()}
                                                        ]
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    )),
                )}
            </div>
        </div>
    );
}

export default MicroOperations;
