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

The callout appears only when the two reports are linked, and only for errors whose message tt-metal formats as one of these allocation failures. Other errors stay in the operations view. See [Allocation failures](allocation-failures.md) for how the memory report explains each one.
