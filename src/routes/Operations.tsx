import { Helmet } from 'react-helmet-async';
import OperationList from '../components/OperationList';

export default function Operations() {
    return (
        <>
            <Helmet title='Operations list' />
            <OperationList />;
        </>
    );
}
