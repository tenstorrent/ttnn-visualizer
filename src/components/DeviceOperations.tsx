import { Node } from '../model/APIData';

interface DeviceOperationsData {
    deviceOperations: Node[];
}

function DeviceOperations({ deviceOperations }: DeviceOperationsData) {
    return (
        <div>
            <table className='ttnn-table two-tone-rows arguments-table'>
                <caption>Device Operations</caption>

                <tbody>
                    <tr>
                        <th>ID</th>
                        <th>Type</th>
                        <th>Params</th>
                    </tr>

                    {deviceOperations.map((op) => (
                        <tr key={`${op.id}-${op.node_type}`}>
                            <td>{op.id}</td>
                            <td>{op.node_type}</td>
                            <td>{JSON.stringify(op.params)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default DeviceOperations;
