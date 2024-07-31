// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import OperationList from '../components/OperationList';

export default function Operations() {
    return (
        <>
            <Helmet title='Operations' />
            <OperationList />;
        </>
    );
}
