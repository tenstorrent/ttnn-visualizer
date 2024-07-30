import { atom, createStore } from 'jotai';

const appData = createStore();

export const reportMeta = atom({
    report_name: '',
});

export default appData;
