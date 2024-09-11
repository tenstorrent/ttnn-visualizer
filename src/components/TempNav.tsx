import { Button } from '@blueprintjs/core';
import { useNavigate } from 'react-router';
import ROUTES from '../definitions/routes';

function TempNav() {
    const navigate = useNavigate();
    const isTensors = window.location.pathname === ROUTES.TENSORS;

    return (
        <Button
            text={isTensors ? 'View Operations' : 'View Tensors'}
            onClick={() => navigate(isTensors ? ROUTES.OPERATIONS : ROUTES.TENSORS)}
            style={{ marginBottom: '10px' }}
        />
    );
}

export default TempNav;
