// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

const getPlotLabel = (
    dataIndex: number,
    defaultName: string | null = '',
    comparisonName: string[] | null = [],
): string | undefined =>
    dataIndex !== 0 && comparisonName?.[dataIndex - 1] ? comparisonName[dataIndex - 1] : (defaultName ?? undefined);

export default getPlotLabel;
