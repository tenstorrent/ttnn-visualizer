import { PerfTableRow, TableFilter, TableKeys } from '../definitions/PerfTable';

interface TypedPerfTableRow
    extends Omit<
        PerfTableRow,
        | 'id'
        | 'total_percent'
        | 'device_time'
        | 'op_to_op_gap'
        | 'cores'
        | 'dram'
        | 'dram_percent'
        | 'flops'
        | 'flops_percent'
    > {
    id: number;
    total_percent: number;
    device_time: number;
    op_to_op_gap: number | null;
    cores: number;
    dram: number;
    dram_percent: number;
    flops: number;
    flops_percent: number;
}

const areFiltersActive = (filters: Record<TableKeys, string> | null) =>
    filters ? Object.values(filters).some((filter) => filter.length > 0) : false;

const getCellText = (buffer: PerfTableRow, key: TableKeys) => {
    const textValue = buffer[key]?.toString() || '';

    return textValue;
};

const sortAndFilterPerfTableData = (
    data: PerfTableRow[],
    filters: TableFilter,
    filterableColumnKeys: TableKeys[],
    activeFilters: (string | number)[],
) => {
    let filteredRows = data || [];

    if (areFiltersActive(filters) && filterableColumnKeys) {
        filteredRows = filteredRows.filter((row) => {
            const isFilteredOut =
                filters &&
                Object.entries(filters)
                    .filter(([_key, filterValue]) => String(filterValue).length)
                    .some(([key, filterValue]) => {
                        const bufferValue = getCellText(row, key as TableKeys);

                        return !bufferValue.includes(filterValue);
                    });

            return !isFilteredOut;
        });
    }

    if (activeFilters?.length > 0) {
        filteredRows = filteredRows.filter(
            (tensor) => tensor?.math_fidelity !== null && activeFilters.includes(tensor.math_fidelity),
        );
    }

    return filteredRows.map((row) => ({
        ...row,
        id: parseInt(row.id, 10),
        total_percent: parseFloat(row.total_percent),
        device_time: parseFloat(row.device_time),
        op_to_op_gap: row.op_to_op_gap ? parseFloat(row.op_to_op_gap) : null,
        cores: parseInt(row.cores, 10),
        dram: row.dram ? parseFloat(row.dram) : null,
        dram_percent: row.dram_percent ? parseFloat(row.dram_percent) : null,
        flops: row.flops ? parseFloat(row.flops) : null,
        flops_percent: row.flops_percent ? parseFloat(row.flops_percent) : null,
    })) as TypedPerfTableRow[];
};

export default sortAndFilterPerfTableData;
