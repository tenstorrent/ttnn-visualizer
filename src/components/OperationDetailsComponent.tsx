import React from 'react';
import axios, { AxiosError } from 'axios';
import { useQuery } from 'react-query';

interface OperationDetailsProps {
    operationId: string;
}

const OperationDetailsComponent: React.FC<OperationDetailsProps> = ({ operationId }) => {
    const fetchOperations = async () => {
        const { data } = await axios.get(`/api/get-operation-details/${operationId}`);
        return data;
    };
    const { data, error, isLoading } = useQuery<any, AxiosError>(
        ['get-operation-detail', operationId],
        fetchOperations,
    );

    const fetchPlotData = async () => {
        return axios.get(`/api/get-buffer-plot-data/${operationId}`);
    };
    const { data: plotData } = useQuery(['get-buffer-plot-data', operationId], fetchPlotData);

    console.log(data, error, isLoading);
    console.log(plotData);
    return <div className='operation-details'>Operation details</div>;
};

export default OperationDetailsComponent;
