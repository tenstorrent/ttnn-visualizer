# Linking reports

TT-NN Visualizer can attempt to link the current active memory and performance reports to provide additional data insights. This is only possible when the two reports are from the same run.

The current link status is indicated in the UI when both a memory and performance report are loaded. If reports fail to link it is likely they are not from the same run.

**Successful link**
<img width="876" height="684" alt="Reports are linked" src="https://github.com/user-attachments/assets/9d81c2ec-ff0e-4956-8d2e-cd8263e25579" />

**Failed link**
<img width="876" height="684" alt="Reports cannot be linked" src="https://github.com/user-attachments/assets/c2925a7f-6d42-40ae-b5d0-1191f93aefc1" />

## Allocation failures in the performance view

When the linked memory report records that an operation failed to allocate memory — out of memory in a buffer bank, or statically allocated circular buffers that run past or clash with L1 buffers — the performance table shows a callout above it. Each entry links to the operation, gives the figures from the allocator's error (requested size, banks, and, from newer tt-metal, the free space and largest free block), and names the device operation that failed where the capture recorded it.

A device operation that fails to allocate never reaches the device, so it has no row in the table, even when the script catches the error and retries. Rows only appear for earlier device operations of the same operation that did run; in the table view those rows carry an **Op failed** flag in the Flags column.

The callout appears only when the two reports are linked, and only for errors whose message tt-metal formats as one of these allocation failures. Other errors stay in the operations view.

## Likely DRAM fallbacks

tt-metal records nothing when a tensor that would normally live in L1 ends up in DRAM, so the performance view infers it from the linked memory report. Rows of an operation that probably fell back carry a **DRAM fallback?** flag in the Flags column. The question mark is deliberate: treat the flag as a lead to check, not a fact. Its tooltip says which of these signals raised it:

- **Requested L1, got DRAM.** Every memory config the operation was given asks for L1, yet an output it allocated is in DRAM. Intermediate memory configs are ignored, because they say nothing about where the output should go.
- **Retry after an L1 failure.** An operation failed to allocate L1, and a same-named operation within the next three is in DRAM. This is the "try L1, fall back to DRAM" pattern in a script.

An output at the same address as one of the operation's inputs is a view of that input, not a fallback; `ttnn.reshape` returns one and ignores its memory config. Those outputs are never flagged.

The flag appears only when the two reports are linked. It does not catch an operation that moves one of its own *inputs* to DRAM internally, such as `ttnn.split` under L1 pressure, because nothing in the report shows the request it overrode.
