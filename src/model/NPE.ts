export interface CommonInfo {
    device_name: string;
    cycles_per_timestep: number;
    congestion_model_name: string;
    num_rows: number;
    num_cols: number;
}

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
}

export interface NoCTransfer {
    id: NoCTransferId;
    src: [row, col];
    dst: [row, col];
    total_bytes: number;
    transfer_type: 'UNICAST' | 'MULTICAST';
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
    link_utilization: [row, col, NoCID, number][]; // LinkUtilization[];
}

export interface NPEData {
    common_info: CommonInfo;
    noc_transfers: NoCTransfer[];
    timestep_data: TimestepData[];
}
