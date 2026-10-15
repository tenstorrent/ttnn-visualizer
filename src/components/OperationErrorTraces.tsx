// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Intent } from '@blueprintjs/core';
import { StackTraceLanguage } from '../definitions/StackTrace';
import { OperationError } from '../model/APIData';
import StackTrace from './operation-details/StackTrace';

interface OperationErrorTracesProps {
    error: OperationError;
    className?: string;
    onExpandChange?: (isOpen: boolean) => void;
}

// The error message and, when the report recorded one, its stack trace
function OperationErrorTraces({ error, className, onExpandChange }: OperationErrorTracesProps) {
    return (
        <>
            <StackTrace
                className={className}
                title='Error Message'
                stackTrace={error.error_message}
                language={StackTraceLanguage.CPP}
                onExpandChange={onExpandChange}
                intent={Intent.DANGER}
                hideSourceButton
                isInline
            />

            {error.stack_trace && (
                <StackTrace
                    className={className}
                    title='Error Stack Trace'
                    stackTrace={error.stack_trace}
                    language={StackTraceLanguage.CPP}
                    onExpandChange={onExpandChange}
                    intent={Intent.DANGER}
                    hideSourceButton
                    isInline
                />
            )}
        </>
    );
}

export default OperationErrorTraces;
