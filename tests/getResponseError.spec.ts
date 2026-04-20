// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError, AxiosResponse } from 'axios';
import { expect, test } from 'vitest';
import getResponseError from '../src/functions/getResponseError';

test('getResponseError reads backend payload from Axios error object response', () => {
    const response = { data: { error: 'Backend says no' } } as AxiosResponse<{ error: string }>;
    const error = new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined, response);

    expect(getResponseError(error)).toBe('Backend says no');
});

test('getResponseError reads string payload from Axios error response', () => {
    const response = { data: 'Plain text backend error' } as AxiosResponse<string>;
    const error = new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined, response);

    expect(getResponseError(error)).toBe('Plain text backend error');
});

test('getResponseError falls back to Axios error message', () => {
    const error = new AxiosError('Network Error');

    expect(getResponseError(error)).toBe('Network Error');
});

test('getResponseError handles standard Error objects', () => {
    expect(getResponseError(new Error('Something broke'))).toBe('Something broke');
});

test('getResponseError handles string errors', () => {
    expect(getResponseError('Bad request')).toBe('Bad request');
});

test('getResponseError uses explicit fallback for unknown values', () => {
    expect(getResponseError({ unexpected: true }, 'Custom fallback')).toBe('Custom fallback');
});
