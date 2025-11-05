// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { DeviceArchitecture } from '../../definitions/DeviceArchitecture';
import { LoadingSpinnerSizes } from '../../definitions/LoadingSpinner';
import { TypedPerfTableRow } from '../../definitions/PerfTable';
import getCoreCount from '../../functions/getCoreCount';
import { useDeviceLog } from '../../hooks/useAPI';
import LoadingSpinner from '../LoadingSpinner';
import 'styles/components/PerfDeviceArchitecture.scss';

const NO_META_DATA = 'n/a';

interface PerfDeviceArchitectureProps {
    data: TypedPerfTableRow[];
    reportName: string | null;
}

const PerfDeviceArchitecture = ({ data, reportName }: PerfDeviceArchitectureProps) => {
    const { data: deviceLog, isLoading: isLoadingDeviceLog } = useDeviceLog(reportName);

    const architecture = deviceLog?.deviceMeta?.architecture ?? DeviceArchitecture.WORMHOLE;
    const maxCores = data ? getCoreCount(architecture, data) : 0;

    return (
        <div className='meta-data'>
            {isLoadingDeviceLog ? (
                <LoadingSpinner size={LoadingSpinnerSizes.SMALL} />
            ) : (
                <>
                    <p>
                        <strong>Arch: </strong>
                        {architecture || NO_META_DATA}
                    </p>
                    <p>
                        <strong>Cores: </strong>
                        {maxCores || NO_META_DATA}
                    </p>
                </>
            )}
        </div>
    );
};

export default PerfDeviceArchitecture;
