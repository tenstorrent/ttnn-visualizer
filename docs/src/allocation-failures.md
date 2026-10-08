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
- **A free block could hold it** — a large enough block was free, but the allocator could not use it. For an interleaved L1 buffer, tt-metal only allocates within the interleaved region, and the free block lies outside it. For the dependency-aware error, other allocators had reserved that space.
- **Larger than an empty bank** — the request cannot fit in this buffer type spread across that many banks, whatever else is allocated.

The free space tt-metal reports for an interleaved L1 buffer includes space it may not use, so a shortfall there can be larger than stated.

For the dependency-aware error, newer tt-metal also reports how much space remained placeable once other allocators' ranges were subtracted. TT-NN Visualizer uses those figures when the error has them, since the allocator's own free space can look ample when the failure was caused by those reservations.

Older tt-metal reports only the bank size, so there is no free space to compare against and no reason is given.

## In the operations list

Operations with an error are marked with an error icon. Expand one with an allocation failure to see it explained above the raw message and stack trace.

Use the error button beside the list controls to show only operations with an error. It is disabled when no operation recorded one.

## In the device operations tree

A device operation whose launch failed is marked with an error icon, and so is every scope enclosing it, since the failure ended those too. Hover the icon for the reason newer tt-metal records. Whatever the scope allocated before it failed is still listed.

Older tt-metal leaves a failed scope open rather than closing it. The tree marks an open scope as failed only when the operation recorded an error; otherwise the capture simply ended before the scope closed, and it is shown without the error icon.
