export interface Operation {
    id: number;
    name: string;
    arguments: { name: string; value: string }[];
}
