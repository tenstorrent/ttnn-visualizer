import { DeviceOperationTypes, Node, NodeType } from '../model/APIData';

export const calculateL1MemoryUsage = (trace: Node[]): number => {
    let totalCB = 0;
    let totalBuffer = 0;
    let peakMemoryUsage = 0;
    const currentOp: string[] = [];

    for (let i = 0; i < trace.length; ++i) {
        const v = trace[i];

        switch (v.node_type) {
            case NodeType.function_start:
                if (currentOp.length === 0) {
                    while (++i < trace.length) {
                        const innerV = trace[i];
                        if (innerV.node_type === NodeType.buffer && innerV.params.type === DeviceOperationTypes.L1) {
                            totalBuffer += parseInt(innerV.params.size, 10);
                        } else if (innerV.node_type === NodeType.tensor) {
                            /* empty */
                        } else {
                            --i;
                            break;
                        }
                    }
                }
                currentOp.push(v.params.name);
                break;

            case NodeType.circular_buffer_allocate:
                totalCB += parseInt(v.params.size, 10);
                break;

            case NodeType.circular_buffer_deallocate_all:
                totalCB = 0;
                break;

            case NodeType.buffer_allocate:
                if (v.params.type === DeviceOperationTypes.L1) {
                    totalBuffer += parseInt(v.params.size, 10);
                }
                break;

            case NodeType.buffer_deallocate:
                if (v.connections && v.connections.length > 0) {
                    const connectionIndex = v.connections[0];
                    const buffer = trace[connectionIndex];
                    if (buffer.params.type === DeviceOperationTypes.L1) {
                        totalBuffer -= parseInt(buffer.params.size, 10);
                    }
                }
                break;

            case NodeType.function_end:
                break;

            default:
                break;
        }
        peakMemoryUsage = Math.max(peakMemoryUsage, totalCB + totalBuffer);
    }

    return peakMemoryUsage;
};

type ProcessedData = {
    id: number;
    name: string | null;
    total_cb: number;
    total_buffer: number;
    total_memory: number;
};

export function processAllocations(graph: Node[]): ProcessedData[] {
    let peakMemoryUsage = 0;
    const result: ProcessedData[] = [];
    const curOp: { name: string; id: number }[] = [];
    let totalCb = 0;
    let totalBuffer = 0;

    let i = 1;
    while (i < graph.length) {
        const v = graph[i];
        i += 1;

        if (v.node_type === NodeType.function_start) {
            if (curOp.length === 0) {
                while (i < graph.length) {
                    if (graph[i].node_type === NodeType.buffer && graph[i].params.type === DeviceOperationTypes.L1) {
                        totalBuffer += parseInt(graph[i].params.size, 10);
                        i += 1;
                    } else if (graph[i].node_type === NodeType.tensor) {
                        i += 1;
                    } else {
                        break;
                    }
                }
            }

            const { name } = v.params;

            curOp.push({ name, id: v.id });
        }

        if (v.node_type === NodeType.circular_buffer_allocate) {
            totalCb += parseInt(v.params.size, 10);
        }

        if (v.node_type === NodeType.circular_buffer_deallocate_all) {
            totalCb = 0;
        }

        if (v.node_type === NodeType.buffer_allocate && v.params.type === DeviceOperationTypes.L1) {
            totalBuffer += parseInt(v.params.size, 10);
        }

        if (v.node_type === 'function_end') {
            curOp.pop();
        }

        if (v.node_type === 'tensor') {
            // continue;
        }

        if (v.node_type === 'buffer_deallocate') {
            const connectionIndex = v.connections ? v.connections[0] : -1;
            if (connectionIndex >= 0 && graph[connectionIndex].params.type === 'L1') {
                totalBuffer -= parseInt(graph[connectionIndex].params.size, 10);
            }
        }

        if (v.node_type === 'buffer') {
            // continue;
        }

        if (curOp.length > 0) {
            const data: ProcessedData = {
                name: curOp[curOp.length - 1].name,
                id: v.id,
                total_cb: totalCb,
                total_buffer: totalBuffer,
                total_memory: totalCb + totalBuffer,
            };
            result.push(data);
        }

        peakMemoryUsage = Math.max(peakMemoryUsage, totalCb + totalBuffer);
    }
    // console.log('Peak memory usage:', peakMemoryUsage);
    return result;
}
