interface MicroOperation {
    composite_parent_names: string[];
    input_tensor_records: object;
    operation_name: string;
    operation_type: string;
    program_cache_hit: boolean | null;
    program_hash: number | null;
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
                </tr>

                {microOperations.map((op) => (
                    <tr>
                        <td>{op.operation_name}</td>
                        <td>{op.operation_type}</td>
                        <td>{op.program_cache_hit?.toString()}</td>
                        <td>{op.program_hash}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default MicroOperations;
