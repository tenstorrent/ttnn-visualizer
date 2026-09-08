// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import MemoryTag from '../src/components/MemoryTag';
import { BufferType, BufferTypeLabel, StringBufferType, StringBufferTypeLabel } from '../src/model/BufferType';

// Blueprint wraps the label in an inner span, so the node `getByText` returns is a
// child of the element carrying the classes.
function getTagFor(label: string) {
    return screen.getByText(label).closest('.memory-tag');
}

afterEach(cleanup);

describe('MemoryTag', () => {
    it.each([
        [BufferType.DRAM, 'DRAM', 'tag-dram'],
        [BufferType.L1, 'L1', 'tag-l1'],
        [BufferType.SYSTEM_MEMORY, 'System Memory', 'tag-system-memory'],
        [BufferType.L1_SMALL, 'L1 Small', 'tag-l1-small'],
        [BufferType.TRACE, 'Trace', 'tag-trace'],
    ])('renders %s as "%s" with class %s', (bufferType, expectedLabel, expectedClass) => {
        render(<MemoryTag memory={BufferTypeLabel[bufferType]} />);

        expect(screen.getByText(expectedLabel)).toBeInTheDocument();
        expect(getTagFor(expectedLabel)).toHaveClass('memory-tag', expectedClass);
    });

    it('derives the same class from the string-keyed label map', () => {
        render(<MemoryTag memory={StringBufferTypeLabel[StringBufferType.L1_SMALL]} />);

        expect(getTagFor('L1 Small')).toHaveClass('tag-l1-small');
    });

    it('keeps spaces in the label while hyphenating only the class (#1824)', () => {
        render(<MemoryTag memory='L1 Small' />);

        expect(screen.getByText('L1 Small')).toBeInTheDocument();
        expect(screen.queryByText('L1-Small')).not.toBeInTheDocument();
    });

    it('slugs a multi-word label into one class rather than several', () => {
        render(<MemoryTag memory='L1 Small' />);

        // Dropping the replacement leaves `tag-l1 small`, which the DOM reads as two
        // classes — `tag-l1` would then apply the wrong colour.
        expect(getTagFor('L1 Small')).toHaveClass('tag-l1-small');
        expect(getTagFor('L1 Small')).not.toHaveClass('tag-l1');
        expect(getTagFor('L1 Small')).not.toHaveClass('small');
    });

    it('renders the label verbatim without stripping enum-style prefixes', () => {
        render(<MemoryTag memory='BufferType::L1' />);

        expect(screen.getByText('BufferType::L1')).toBeInTheDocument();
        expect(screen.queryByText('L1')).not.toBeInTheDocument();
    });

    it('renders nothing when no memory type is supplied', () => {
        const { container } = render(<MemoryTag memory={undefined} />);

        expect(container).toBeEmptyDOMElement();
    });
});
