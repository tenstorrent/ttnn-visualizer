// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import OperationList from '../components/OperationList';
import useClearSelectedBuffer from '../hooks/useClearSelectedBuffer';

export default function Operations() {
    useClearSelectedBuffer();

    return (
        <>
            <Helmet title='Operations' />
            <OperationList />
        </>
    );
}
