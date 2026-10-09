# Allocation failures

When an operation fails to allocate memory, TT-NN records the allocator's error in the memory report. TT-NN Visualizer reads four of these errors from tt-metal:

- out of memory in a buffer bank;
- out of memory after considering other allocators' reservations;
- statically allocated circular buffers that grow past the end of L1;
- statically allocated circular buffers that clash with an L1 buffer.

Other errors are still shown, as their raw message and stack trace.

## On the operation's page

A failed operation's memory details page opens with a callout that gives:

- the kind of failure;
- the figures from the error: the size requested, how many banks it was spread across, the size of a bank and, from newer tt-metal, the free space and largest free block;
- why it did not fit, where the figures say;
- the device operation that failed, where the capture recorded it.

The **View operation error** button above it still shows the raw message and stack trace.

### Why it did not fit

All figures are per bank.

- **Short by** — there was not enough free space for the request.
- **Fragmented** — there was enough free space in total, but no single free block was large enough. Look at the order tensors are deallocated in and how long they live, not only their size.
- **A free block could hold it** — a large enough block was free, but the allocator could not use it. For the dependency-aware error, other allocators had reserved part of that block; newer tt-metal also gives the largest window left once their ranges are subtracted. For the plain error, the message does not say why.
- **Larger than an empty bank** — the request cannot fit in this buffer type spread across that many banks, whatever else is allocated.

For an L1 buffer, the free space tt-metal reports includes space an interleaved buffer may not use: tt-metal allocates interleaved L1 only within the interleaved region. A shortfall there can be larger than stated, and fragmentation can be worse.

For the dependency-aware error, newer tt-metal also reports how much space remained placeable: what is left of the free blocks large enough for the request once other allocators' ranges are subtracted. That is not free space, so TT-NN Visualizer decides why the allocation did not fit from the allocator's own figures, and lists the placeable figures beside them.

Older tt-metal reports only the bank size, so there is no free space to compare against; the only reason given is when the request is larger than an empty bank.

## In the operations list

Operations with an error are marked with an error icon. Expand one with an allocation failure to see it explained above the raw message and stack trace.

Use the error button beside the list controls to show only operations with an error. It is disabled when no operation recorded one.

## In the device operations tree

A device operation whose launch failed is marked with an error icon, and so is every scope enclosing it, since the failure ended those too. Hover the icon for the reason newer tt-metal records. Whatever the scope allocated before it failed is still listed.

Older tt-metal leaves a failed scope open rather than closing it. The tree marks an open scope as failed only when the operation recorded an error; otherwise the capture simply ended before the scope closed, and it is shown without the error icon.
