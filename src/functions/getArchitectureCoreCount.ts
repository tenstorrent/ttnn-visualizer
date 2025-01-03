import { DeviceArchitecture } from '../model/APIData';

export default function getArchitectureCoreCount(type: DeviceArchitecture) {
    // This function will need updating when we understand the different architectures
    // grayskull: 96 or 120 cores
    // wormhole: 72 or 128 cores
    // blackhole: ???

    if (type === 'grayskull') {
        return 108;
    }

    return 64;
}
