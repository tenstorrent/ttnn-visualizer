// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

// This exists so that we can properly style intent on the Switch component according to our theme
import { Button } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useNavigate } from 'react-router';
import { useGetClusterDescription } from '../../hooks/useAPI';

function ClusterRenderer() {
    const navigate = useNavigate();
    const clusterDescription = useGetClusterDescription();
    const data = clusterDescription?.data;
    return (
        <div
            style={{
                position: 'absolute',
                top: '80px',
                backgroundColor: '#000000aa',
                width: '100%',
                bottom: 0,
                zIndex: 10,
            }}
        >
            <h1>
                CLUSTER RENDERER TEMP{' '}
                <Button
                    icon={IconNames.CROSS}
                    onClick={() => {
                        navigate(-1);
                    }}
                />
            </h1>
            <pre>{JSON.stringify(data, null, 2)}</pre>
        </div>
    );
}

export default ClusterRenderer;
