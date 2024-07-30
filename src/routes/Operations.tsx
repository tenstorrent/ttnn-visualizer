import { Helmet } from 'react-helmet-async';
import { useSetAtom } from 'jotai';
import OperationList from '../components/OperationList';
import { useReportMeta } from '../hooks/useAPI';
import { reportMetaAtom } from '../definitions/appData';

export default function Operations() {
    const report = useReportMeta();
    const setMeta = useSetAtom(reportMetaAtom);

    if (report.status === 'success') {
        setMeta(report.data);
    }

    return (
        <>
            <Helmet title='Operations' />
            <OperationList />;
        </>
    );
}
