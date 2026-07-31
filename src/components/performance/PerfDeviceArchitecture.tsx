// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { DeviceArchitecture } from '../../definitions/DeviceArchitecture';
import { LoadingSpinnerSizes } from '../../definitions/LoadingSpinner';
import { usePerfMeta } from '../../hooks/useAPI';
import LoadingSpinner from '../LoadingSpinner';
import 'styles/components/PerfDeviceArchitecture.scss';

const NO_META_DATA = 'Unknown';

interface PerfDeviceArchitectureProps {
    /** On-disk folder of the report to read device meta for, not a display name. */
    reportFolderName: string | null;
    maxCores: number;
}

const PerfDeviceArchitecture = ({ reportFolderName, maxCores }: PerfDeviceArchitectureProps) => {
    const { data: deviceMeta, isLoading: isLoadingDeviceLog } = usePerfMeta(reportFolderName);

    const architecture = deviceMeta?.architecture ?? DeviceArchitecture.WORMHOLE;

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
