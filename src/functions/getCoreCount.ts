import { DeviceArchitecture } from '../model/APIData';

function getCoreCount(architecture: DeviceArchitecture): number {
    const CORE_COUNT = {
        grayskull: 108,
        wormhole_b0: 64,
    };

    return CORE_COUNT[architecture];
}

export default getCoreCount;
