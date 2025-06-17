// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useRouteError } from 'react-router-dom';

interface RouteErrorProps {
    statusText: string;
    message: string;
}

export default function ErrorPage() {
    const error = useRouteError() as RouteErrorProps;

    return (
        <div id='error-page'>
            <h1>Oops!</h1>
            <p>Sorry, an unexpected error has occurred.</p>
            <p>
                <i>{error.statusText || error.message}</i>
            </p>
        </div>
    );
}
