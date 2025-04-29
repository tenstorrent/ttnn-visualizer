const getPlotLabel = (dataIndex: number, defaultName: string | null = '', comparisonName: string | null = '') =>
    dataIndex !== 0 ? comparisonName : defaultName;

export default getPlotLabel;
