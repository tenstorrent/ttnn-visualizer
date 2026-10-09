# Allocation failures

When an operation fails to allocate memory, TT-NN records the allocator's error in the memory report. TT-NN Visualizer reads four of these errors from tt-metal:

- **Out of memory** — a buffer did not fit its banks;
- **Out of memory after dependencies** — a buffer did not fit once other allocators' reservations were taken into account;
- **Circular buffers beyond L1** — statically allocated circular buffers grow past the end of L1;
- **Circular buffers clash with L1 buffers** — statically allocated circular buffers run into an L1 buffer.

Other errors are still shown, as their raw message and stack trace.

## On the operation's page

A failed operation's memory details page opens with a callout that gives:

- the kind of failure;
- the figures from the error: for a buffer, the size requested, how many banks it was spread across, the size of a bank and, from newer tt-metal, the free space and largest free block; for circular buffers, the core range and where the region ends;
- why it did not fit, where the figures say;
- the device operation that failed, where the capture recorded it.

The **View operation error** button above it still shows the raw message and stack trace.

### Why it did not fit

The reason comes first, in bold, followed by the figures that show it. For a buffer, all figures are per bank.

- **Not enough free space** — there was not enough free space for the request. The callout gives how far short it was.
- **Fragmented** — there was enough free space in total, but no single free block was large enough. Look at the order tensors are deallocated in and how long they live, not only their size.
- **A free block could hold it** — a large enough block was free, but the allocator could not use it. For the error after dependencies, other allocators had reserved part of that block; newer tt-metal also gives the largest window left once their ranges are subtracted. For the plain error, the message does not say why.
- **Larger than an empty bank** — the request cannot fit in this buffer type spread across that many banks, whatever else is allocated.
- **Beyond the end of L1** — the circular buffers need more than L1 holds; the callout gives by how much.
- **Overlaps an L1 buffer** — the circular buffer region runs into an L1 buffer already allocated; the callout gives the buffer's address and the size of the overlap.

For an L1 buffer, the free space tt-metal reports includes space an interleaved buffer may not use: tt-metal allocates interleaved L1 only within the interleaved region. A shortfall there can be larger than stated, and fragmentation can be worse.

For the error after dependencies, newer tt-metal also reports how much space remained placeable: what is left of the free blocks large enough for the request once other allocators' ranges are subtracted. That is not free space, so TT-NN Visualizer decides why the allocation did not fit from the allocator's own figures, and lists the placeable figures beside them.

Older tt-metal reports only the bank size, so there is no free space to compare against. The only reason it can give is **Larger than an empty bank**.

## In the operations list

Operations with an error are marked with an error icon. Expand one with an allocation failure to see it explained above the raw message and stack trace.

Use the error button beside the list controls to show only operations with an error. It is disabled when no operation in the list has an error attached.

## In the device operations tree

A device operation whose launch failed is marked with an error icon, and so is every scope enclosing it, since the failure ended those too. Hover the icon for the reason newer tt-metal records. Whatever the scope allocated before it failed is still listed.

Older tt-metal leaves a failed scope open rather than closing it. The tree marks an open scope as failed only when the operation recorded an error; otherwise the capture simply ended before the scope closed, and it is shown without the error icon. Where the capture records how deeply each scope is nested, a scope left open ends where the next scope at its level starts; otherwise what follows it is shown inside it.

## In the performance view

When the memory and performance reports are [linked](linking-reports.md), the performance table shows a callout above it listing the allocation failures the memory report records. Each entry links to the operation and gives the kind of failure, its figures and why it did not fit, as on the operation's page. It also says which device operation failed, where the capture recorded it, and whether any of the operation's earlier device operations ran.

A device operation that fails to allocate never reaches the device, so it has no row in the table, even when the script catches the error and retries. Rows only appear for earlier device operations of the same operation that did run; in the table view those rows carry an **Op failed** flag in the Flags column.

The callout appears only when the two reports are linked: a failure from an unrelated run would be blamed on this one.
