import { RowData } from '../definitions/PerfTable';
import { DeviceArchitecture } from '../model/APIData';
import getCoreCount from './getCoreCount';
import isValidNumber from './isValidNumber';

function getCoreUtilization(row: RowData, architecture: DeviceArchitecture): number {
    const maxCores = getCoreCount(architecture);

    const ideal = row['PM IDEAL [ns]'] ? parseInt(row['PM IDEAL [ns]'], 10) : null;
    const kernelDuration = row['DEVICE KERNEL DURATION [ns]'] ? parseInt(row['DEVICE KERNEL DURATION [ns]'], 10) : null;
    const coreCount = row['CORE COUNT'] ? parseInt(row['CORE COUNT'], 10) : null;

    if (!isValidNumber(ideal) || !isValidNumber(kernelDuration) || !isValidNumber(coreCount)) {
        return 0;
    }

    return (ideal / kernelDuration) * (maxCores / coreCount);
}

export default getCoreUtilization;
