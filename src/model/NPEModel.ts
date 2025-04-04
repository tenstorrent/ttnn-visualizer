export interface CommonInfo {
    congestion_model_name: string;
    cycles_per_timestep: number;
    device_name: string;
    dram_bw_util: number;
    link_demand: number;
    link_util: number;
    max_link_demand: number;
    num_cols: number;
    num_rows: number;
}

export const NPE_KPI_METADATA = {
    congestion_model_name: {
        units: '',
        label: null,
        description: 'Congestion model used in simulation to infer congestion (default: fast)',
    },
    cycles_per_timestep: {
        units: 'cycles',
        label: null,
        description: 'How many cycles each simulation timestep/frame spans',
    },
    device_name: {
        units: '',
        label: null,
        description: 'Device simulated (e.g. wormhole_b0, blackhole)',
    },
    dram_bw_util: {
        units: '%',
        label: null,
        description: '% of DRAM RW bandwidth used over entire operation runtime (100% is maximum)',
    },
    link_demand: {
        units: '%',
        label: null,
        description:
            'Average demand for NoC links over entire runtime. Multiple packets requesting results in demand exceeding 100% for a given link. Demand be compared with link utilization to understand how localized congestion is.',
    },
    link_util: {
        units: '%',
        label: null,
        description:
            'Average utilization of NoC links over entire runtime. Link utilization saturates at 100% for every NoC link, no matter how much demand there is. Useful for understanding NoC toggle rate and overall efficiency of communication.',
    },
    max_link_demand: {
        units: '%',
        label: null,
        description: 'Maximum observed link demand over all timesteps. See link_demand for more details.',
    },
    num_cols: {
        units: '',
        label: null,
        description: 'Number of core columns on the device.',
    },
    num_rows: {
        units: '',
        label: null,
        description: 'Number of core rows on the device.',
    },
};

type row = number;
type col = number;
type NoCTransferId = number;
export type NoCType = 'NOC0' | 'NOC1';

// export type NoCID = 'NOC1_NORTH' | 'NOC0_SOUTH' | 'NOC0_EAST' | 'NOC1_WEST';
export enum NoCID {
    NOC1_NORTH = 'NOC1_NORTH',
    NOC0_SOUTH = 'NOC0_SOUTH',
    NOC0_EAST = 'NOC0_EAST',
    NOC1_WEST = 'NOC1_WEST',
    NOC0_IN = 'NOC0_IN',
    NOC0_OUT = 'NOC0_OUT',
    NOC1_IN = 'NOC1_IN',
    NOC1_OUT = 'NOC1_OUT',
}

export interface NoCTransfer {
    id: NoCTransferId;
    src: [row, col];
    dst: [[row, col]];
    total_bytes: number;
    noc_event_type: '';
    noc_type: NoCType;
    injection_rate: number;
    start_cycle: number;
    end_cycle: number;
    route: [row, col, NoCID][];
}

export interface LinkUtilization {
    row: row;
    column: col;
    noc_id: NoCID;
    utilization: number;
}

export interface TimestepData {
    start_cycle: number;
    end_cycle: number;
    active_transfers: NoCTransferId[];
    link_demand: [row, col, NoCID, number][]; // LinkUtilization[];
    avg_link_demand: number;
    avg_link_util: number;
}

export interface NPEData {
    common_info: CommonInfo;
    noc_transfers: NoCTransfer[];
    timestep_data: TimestepData[];
}
