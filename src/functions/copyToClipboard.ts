// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Copies `text` to the clipboard, reporting whether it worked.
 *
 * Returns a boolean rather than emitting a toast so the caller can put the confirmation
 * where the user is already looking — next to the button they pressed — instead of in a
 * corner of the screen.
 *
 * `navigator.clipboard` is absent on insecure origins and in jsdom, and the write can be
 * refused outright when the document has lost focus, so neither is treated as an error
 * worth throwing: the command is on screen to be selected by hand either way.
 */
const copyToClipboard = async (text: string): Promise<boolean> => {
    if (!navigator.clipboard?.writeText) {
        return false;
    }

    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
};

export default copyToClipboard;
