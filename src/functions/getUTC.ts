const getUTC = (epoch: number): Date => {
    const date = new Date(0);
    date.setUTCSeconds(epoch);

    return date;
};

export default getUTC;
