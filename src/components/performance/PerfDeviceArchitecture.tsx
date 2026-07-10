// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { DeviceArchitecture } from '../../definitions/DeviceArchitecture';
import { LoadingSpinnerSizes } from '../../definitions/LoadingSpinner';
import { TypedPerfTableRow } from '../../definitions/PerfTable';
import { buildPerfHeuristicContext } from '../../functions/computePerfHeuristicFlags';
import { DEFAULT_MAX_CORES } from '../../functions/getCoreCount';
import { usePerfMeta } from '../../hooks/useAPI';
import LoadingSpinner from '../LoadingSpinner';
import 'styles/components/PerfDeviceArchitecture.scss';

const NO_META_DATA = 'Unknown';

interface PerfDeviceArchitectureProps {
    data: TypedPerfTableRow[];
    reportName: string | null;
}

const PerfDeviceArchitecture = ({ data, reportName }: PerfDeviceArchitectureProps) => {
    const { data: deviceMeta, isLoading: isLoadingDeviceLog } = usePerfMeta(reportName);

    const architecture = deviceMeta?.architecture ?? DeviceArchitecture.WORMHOLE;
    const maxCores = buildPerfHeuristicContext(deviceMeta, data).maxCores || DEFAULT_MAX_CORES;

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
