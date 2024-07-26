import axios, { AxiosError } from 'axios';
import { useQuery } from 'react-query';
import { OperationDetailsData } from '../model/APIData';
import { MicroOperation, Operation } from '../model/Graph';

const fetchOperationDetails = async (id: number): Promise<OperationDetailsData> => {
    const response = await axios.get<OperationDetailsData>(`/api/get-operation-details/${id}`);

    return response.data;
};
const fetchOperations = async (): Promise<Operation[]> => {
    const [{ data: operationList }, { data: microOperations }] = await Promise.all([
        axios.get<Omit<Operation, 'microOperations'>[]>('/api/get-operations'),
        axios.get<MicroOperation[]>('/api/get-operation-history'),
    ]);

    return operationList.map((operation) => ({
        ...operation,
        microOperations:
            microOperations.filter((microOperation) => microOperation.ttnn_operation_id === operation.id) || [],
    })) as Operation[];
};

export const useOperationsList = () => {
    return useQuery<Operation[], AxiosError>('get-operations', fetchOperations);
};

export const useOperationDetails = (operationId: number) => {
    const { data: operations } = useOperationsList();
    const operation = operations?.filter((_operation) => {
        return _operation.id === operationId;
    })[0];
    const operationDetails = useQuery<OperationDetailsData>(['get-operation-detail', operationId], () =>
        fetchOperationDetails(operationId),
    );

    // TODO: consider useQueries or include operation data on BE

    return {
        operation,
        operationDetails,
    };
};

export const usePreviousOperationDetails = (operationId: number) => {
    // TODO: change to return array and number of previous operations
    const { data: operations } = useOperationsList();

    const operation = operations?.find((_operation, index, operationList) => {
        return operationList[index + 1]?.id === operationId;
    });

    return useOperationDetails(operation?.id || -1);
};

export const usePreviousOperation = (operationId: number) => {
    const { data: operations } = useOperationsList();

    const operation = operations?.find((_operation, index, operationList) => {
        return operationList[index + 1]?.id === operationId;
    });

    return operation ? { id: operation.id, name: operation.name } : undefined;
};

export const useNextOperation = (operationId: number) => {
    const { data: operations } = useOperationsList();

    const operation = operations?.find((_operation, index, operationList) => {
        return operationList[index - 1]?.id === operationId;
    });

    return operation ? { id: operation.id, name: operation.name } : undefined;
};

export const useReportMeta = () => {
    // TODO: Get this information from somewhere
    return {
        cache_path: '/localdev/aknezevic/.cache/ttnn',
        model_cache_path: '/localdev/aknezevic/.cache/ttnn/models',
        tmp_dir: '/tmp/ttnn',
        enable_model_cache: true,
        enable_fast_runtime_mode: false,
        throw_exception_on_fallback: true,
        enable_logging: true,
        enable_graph_report: false,
        enable_detailed_buffer_report: true,
        enable_detailed_tensor_report: false,
        enable_comparison_mode: false,
        comparison_mode_pcc: 0.99,
        root_report_path: 'generated/ttnn/reports',
        report_name: 'resnet',
    };
};
