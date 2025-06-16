// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import TensorList from '../components/TensorList';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';

export default function Tensors() {
    useClearSelectedBuffer();

    return (
        <>
            <Helmet title='Tensors' />
            <TensorList />
        </>
    );
}
