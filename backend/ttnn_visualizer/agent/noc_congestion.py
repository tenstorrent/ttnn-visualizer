# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""How congested a tt-npe trace's NoC links were: the trace's own run summary, the
worst link and when, bursts of congestion, and the busiest links. #2156

Read through the app's index when it is built and current, else from the trace itself a
timestep at a time, never by building an index: the tools write nothing beside a report.
"""

import io
import json
import logging
import multiprocessing
import multiprocessing.connection
import os
import stat
import sys
import threading
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple, Union

import zstd
from ttnn_visualizer import npe_index
from ttnn_visualizer.agent.bounds import MAX_LIMIT, bounded
from ttnn_visualizer.agent.cells import finite_number, whole_number
from ttnn_visualizer.agent.handles import CacheVariant, ReportRegistry, read_once
from ttnn_visualizer.agent.report_diff import as_answered
from ttnn_visualizer.agent.tools import share_percent
from ttnn_visualizer.file_source import FileSource

# Demand past a link's whole bandwidth: asked of it, but more than it could carry.
CONGESTED_PERCENT = 100.0
# Longer than any link or NoC name tt-npe writes; a longer one is the trace's text.
MAX_LINK_NAME_LENGTH = 32
# Longer than any architecture, device or model name tt-npe writes.
MAX_LABEL_LENGTH = 64
# tt-npe models two NoCs; more in a trace's run summary are its text, not a NoC.
MAX_NOCS = 4
# Past every local trace (904 MB of JSON); reading one costs about twice its size.
MAX_TRACE_JSON_BYTES = 1 << 30
# A trace whose JSON is past this is read in a process of its own, whose memory goes back
# to the system when it ends; the server's own allocator would keep much of it. #2275
MAX_INLINE_TRACE_JSON_BYTES = 64 << 20
# Distinct links summed; the most in a local trace is 4,653.
MAX_LINKS = 1 << 16
# Past this `truncate` overflows; no link is asked for 10^305 percent of itself.
_LARGEST_DEMAND = sys.float_info.max / 1000
_INT64 = 1 << 63

# Not stdout, which carries the server's JSON-RPC.
logger = logging.getLogger(__name__)

NOC_CONGESTION_NOTE = (
    "Figures are tt-npe's simulation of the NoC, in percent of a link's bandwidth, "
    "per timestep of cycles_per_timestep device cycles. Demand is what transfers "
    "asked of a link and can pass 100%; utilisation is what it carried and stops at "
    "100%, so demand over 100% is congestion. run is the trace's own summary: each "
    "figure is the mean over timesteps of that timestep's average across links, and "
    "highest_timestep_average_demand_percent is the largest such average, not one "
    "link's demand. worst_link is the highest demand any single link reached, the "
    "earliest where several did; worst_link_ties counts the link-timesteps at that "
    "demand, that one included. A burst is a run of consecutive timesteps whose "
    "busiest link was over 100%. A link's mean demand is over every timestep of the "
    "trace, idle ones included. device, y and x are the trace's own chip id and grid "
    "coordinates."
)

# device, y, x, link name, as a trace's link_demand rows give them.
Link = Tuple[int, int, int, str]


@dataclass(slots=True)
class _Peak:
    demand: float
    link: Link
    timestep: int
    start_cycle: Optional[int]
    end_cycle: Optional[int]


@dataclass(slots=True)
class _Burst:
    start_cycle: Optional[int]
    end_cycle: Optional[int]
    timesteps: int
    peak: _Peak


@dataclass(slots=True)
class _LinkTotals:
    link: Link
    demand: float = 0.0
    peak: float = 0.0
    congested: int = 0


@dataclass(frozen=True)
class _NocRead:
    """One read of a trace, ranked, with as many bursts and links as a limit can ask."""

    common_info: Dict[str, object]
    timesteps: int
    transfers: int
    first_cycle: Optional[int]
    last_cycle: Optional[int]
    worst: Optional[_Peak]
    worst_ties: int
    congested_timesteps: int
    burst_count: int
    # By peak demand, then length, then start.
    bursts: List[_Burst]
    link_count: int
    # By mean demand, then peak, then link.
    links: List[_LinkTotals]
    unreadable_entries: int
    unreadable_timesteps: int
    # Entries for links past the first MAX_LINKS read.
    entries_past_link_limit: int


@dataclass
class _Timeline:
    """The per-timestep half of a read: the worst link, and the bursts."""

    worst: Optional[_Peak] = None
    worst_ties: int = 0
    congested: int = 0
    bursts: List[_Burst] = field(default_factory=list)
    burst: Optional[_Burst] = None

    def add(self, peak: Optional[_Peak], ties: int) -> None:
        if peak is not None:
            if self.worst is None or peak.demand > self.worst.demand:
                self.worst, self.worst_ties = peak, ties
            elif peak.demand == self.worst.demand:
                self.worst_ties += ties
        if peak is None or peak.demand <= CONGESTED_PERCENT:
            self.close()
            return
        self.congested += 1
        if self.burst is None:
            self.burst = _Burst(peak.start_cycle, peak.end_cycle, 0, peak)
        self.burst.timesteps += 1
        if peak.end_cycle is not None:
            self.burst.end_cycle = peak.end_cycle
        if peak.demand > self.burst.peak.demand:
            self.burst.peak = peak

    def close(self) -> None:
        if self.burst is not None:
            self.bursts.append(self.burst)
            self.burst = None


def _link(device: object, y: object, x: object, name: object) -> Optional[Link]:
    """A link row's key, or None where the trace's cells are not a link's."""
    if (
        type(device) is int
        and type(y) is int
        and type(x) is int
        and type(name) is str
        and len(name) <= MAX_LINK_NAME_LENGTH
    ):
        return device, y, x, name
    return None


def _cycle(cell: object) -> Optional[int]:
    # A bool as the index's `_as_int` stores it; past int64 is no device's cycle count.
    cycle = int(cell) if isinstance(cell, bool) else whole_number(cell)
    return cycle if cycle is not None and -_INT64 <= cycle < _INT64 else None


# One function, rows inlined: a large trace holds 17 million of them.
def _summed(  # noqa: C901
    rows: Union[npe_index.LinkDemand, npe_index.StreamedLinkDemand],
) -> _NocRead:
    """Sum each link's demand and follow bursts over the timesteps, in order, in one
    pass. Rows are read as the index stores them, so both sources answer alike."""
    links: Dict[Link, _LinkTotals] = {}
    timeline = _Timeline()
    unreadable = unreadable_timesteps = timesteps = past_link_limit = 0
    first_cycle: Optional[int] = None
    last_cycle: Optional[int] = None
    truncate = None if rows.truncated else npe_index.truncate

    for timestep, (start_cell, end_cell, link_demand) in enumerate(rows.timesteps):
        timesteps += 1
        start, end = _cycle(start_cell), _cycle(end_cell)
        if first_cycle is None:
            first_cycle = start
        if end is not None:
            last_cycle = end
        if type(link_demand) is not list:
            unreadable_timesteps += 1
            link_demand = ()
        step_demand = -1.0
        step_link: Optional[_LinkTotals] = None
        ties = 0
        # Not the timestep's noc.*.max_link_demand, which is 10/3 of its rows' largest.
        for entry in link_demand:
            try:
                key = (entry[0], entry[1], entry[2], entry[3])
                demand = entry[4]
                totals = links.get(key)
            except (TypeError, IndexError, KeyError):
                unreadable += 1
                continue
            if type(demand) is float:
                # NaN fails both bounds; truncated first, as the index stores it.
                if not -_LARGEST_DEMAND < demand < _LARGEST_DEMAND:
                    unreadable += 1
                    continue
                if truncate is not None:
                    demand = truncate(demand)
            elif type(demand) is not int:
                unreadable += 1
                continue
            if demand < 0:
                unreadable += 1
                continue
            # Every row, not only a new key's: 0.0 and False find an int link's totals.
            if (
                totals is None
                or type(key[0]) is not int
                or type(key[1]) is not int
                or type(key[2]) is not int
            ):
                link = _link(*key)
                if link is None:
                    unreadable += 1
                    continue
                if len(links) >= MAX_LINKS:
                    past_link_limit += 1
                    continue
                totals = links[link] = _LinkTotals(link)
            totals.demand += demand
            if demand > totals.peak:
                totals.peak = demand
            if demand > CONGESTED_PERCENT:
                totals.congested += 1
            if demand > step_demand:
                step_demand, step_link, ties = demand, totals, 1
            elif demand == step_demand:
                ties += 1

        timeline.add(
            (
                None
                if step_link is None
                else _Peak(step_demand, step_link.link, timestep, start, end)
            ),
            ties,
        )
    timeline.close()

    bursts = sorted(
        timeline.bursts,
        key=lambda burst: (-burst.peak.demand, -burst.timesteps, burst.peak.timestep),
    )
    ranked = sorted(
        links.values(), key=lambda totals: (-totals.demand, -totals.peak, totals.link)
    )
    return _NocRead(
        common_info=rows.common_info,
        timesteps=timesteps,
        transfers=rows.transfer_count,
        first_cycle=first_cycle,
        last_cycle=last_cycle,
        worst=timeline.worst,
        worst_ties=timeline.worst_ties,
        congested_timesteps=timeline.congested,
        burst_count=len(bursts),
        bursts=bursts[:MAX_LIMIT],
        link_count=len(ranked),
        links=ranked[:MAX_LIMIT],
        unreadable_entries=unreadable,
        unreadable_timesteps=unreadable_timesteps + rows.unreadable_timesteps,
        entries_past_link_limit=past_link_limit,
    )


def _past_limit(npe_path: Path, size: str) -> ValueError:
    return ValueError(
        f"{npe_path.name} holds {size} bytes of JSON, past the "
        f"{MAX_TRACE_JSON_BYTES:,} this tool reads, about twice that in memory; "
        "open it in the app, whose index this tool then reads"
    )


def _unreadable(npe_path: Path, reason: object) -> ValueError:
    return ValueError(f"{npe_path.name} is not a readable tt-npe trace: {reason}")


def _trace_json(npe_path: Path, compressed: bool) -> bytes:
    """The trace's JSON, read through one descriptor so the bytes bounded are those read."""
    with npe_path.open("rb") as source:
        if not npe_index.starts_as_trace(
            source.read(npe_index.TRACE_HEAD_BYTES), compressed
        ):
            raise ValueError(
                f"{npe_path.name} does not start as a tt-npe trace does: a zstd frame "
                "for .zst, a JSON object otherwise"
            )
        stored = os.fstat(source.fileno()).st_size
        if stored > MAX_TRACE_JSON_BYTES:
            if compressed:
                raise ValueError(
                    f"{npe_path.name} is {stored:,} bytes, past the "
                    f"{MAX_TRACE_JSON_BYTES:,} this tool reads; open it in the app, "
                    "whose index this tool then reads"
                )
            raise _past_limit(npe_path, f"{stored:,}")
        source.seek(0)
        # Exactly its size, which a read past the limit would allocate for and copy.
        data = source.read(stored)
        if source.read(1):
            raise ValueError(
                f"{npe_path.name} grew while it was read; call load_report again to "
                "read it as it is now"
            )
    if compressed:
        size = npe_index.declared_content_size(io.BytesIO(data))
        if size is None:
            raise ValueError(
                f"{npe_path.name} is not zstd frames that each declare their size, so "
                "the memory its read takes cannot be bounded beforehand"
            )
        if size > MAX_TRACE_JSON_BYTES:
            raise _past_limit(npe_path, f"{size:,}")
        # Rebound, so the compressed bytes are gone before the text is made.
        data = zstd.uncompress(data)
    return data


def _from_trace(npe_path: Path) -> _NocRead:
    """The trace's summed link demand, read from the trace a timestep at a time."""
    # Every refusal `from None`: its message carries the cause, and no frame of the read.
    compressed = npe_path.suffix == ".zst"
    try:
        text = npe_index.trace_text(_trace_json(npe_path, compressed))
    except OSError as error:
        raise ValueError(f"{npe_path.name} cannot be read: {error.strerror}") from None
    except zstd.Error as error:
        raise _unreadable(npe_path, error) from None
    try:
        return _summed(npe_index.streamed_link_demand(text))
    except json.JSONDecodeError as error:
        raise _unreadable(npe_path, error) from None
    except RecursionError:
        raise _unreadable(npe_path, "it nests too deep") from None
    except ValueError as error:
        raise ValueError(f"{npe_path.name}: {error}") from None


def _reader_setup() -> None:
    """Keep a reading process off stdout, which carries the server's messages, and end
    it with the server: a pool's worker outlives a killed parent, holding the read."""
    try:
        quiet = sys.stderr.fileno()
    except (AttributeError, OSError, ValueError):
        quiet = os.open(os.devnull, os.O_WRONLY)
    os.dup2(quiet, 1)
    parent = multiprocessing.parent_process()
    if parent is not None:
        threading.Thread(
            target=_exit_with, args=(parent.sentinel,), daemon=True
        ).start()


def _exit_with(sentinel: int) -> None:
    multiprocessing.connection.wait([sentinel])
    os._exit(1)


def _reader_pool(
    initializer: Callable[[], None] = _reader_setup,
) -> ProcessPoolExecutor:
    """The process a large trace is read in: spawned, since a fork copies the server."""
    return ProcessPoolExecutor(
        1, mp_context=multiprocessing.get_context("spawn"), initializer=initializer
    )


def _read_trace(npe_path: Path) -> _NocRead:
    """`_from_trace`, in a process of its own for a trace past
    `MAX_INLINE_TRACE_JSON_BYTES`."""
    try:
        size = npe_index.trace_size(npe_path)
    except OSError:
        size = None
    # Past the cap the read refuses it at once, so no process is started for it.
    # Sized before it is read: one that grows meanwhile is read here, still capped.
    if size is None or not MAX_INLINE_TRACE_JSON_BYTES < size <= MAX_TRACE_JSON_BYTES:
        return _from_trace(npe_path)
    with _reader_pool() as reader:
        try:
            return reader.submit(_from_trace, npe_path).result()
        except RecursionError:
            # Sending the read back nests as deep as its `common_info` does.
            raise _unreadable(npe_path, "it nests too deep") from None
        except BrokenProcessPool:
            # Not a refusal, which would be kept: what ended the process may pass.
            raise RuntimeError(
                f"{npe_path.name}: the process reading it ended before it answered"
            ) from None


def _read(npe_path: Path) -> _NocRead:
    """The trace's link demand, through the app's index when it is current."""
    try:
        with npe_index.indexed_link_demand(npe_path) as indexed:
            if indexed is not None:
                return _summed(indexed)
    except npe_index.INDEX_READ_ERRORS as error:
        # Replaced or damaged since it was checked: the trace still answers, slowly.
        logger.warning(
            "NoC congestion: the index of %s could not be read (%s); reading the trace",
            npe_path.name,
            error,
        )
    return _read_trace(npe_path)


def _trace_source(path: Path) -> Optional[FileSource]:
    try:
        found = path.stat()
    except OSError:
        return None
    return FileSource.of(str(path), found) if stat.S_ISREG(found.st_mode) else None


def _pinned_read(
    registry: ReportRegistry, handle: str, path: Path
) -> Tuple[_NocRead, bool]:
    """The handle's read of the trace it first read, and whether that has changed.

    Pinned as `tools._per_capture` pins a CSV, except that a hit after the trace has
    changed says so: this read is the whole answer.
    """
    now = _trace_source(path)

    def pin(_: object) -> FileSource:
        if now is None:
            raise ValueError(
                f"{path.name} is no longer a readable file; call load_report with the "
                "trace's current path"
            )
        return now

    pinned = registry.cached_report(handle, pin, variant=CacheVariant.NOC_SOURCE)

    def unchanged(_: object) -> None:
        if now != pinned:
            raise ValueError(
                f"{path.name} has changed since {handle!r} first read it; call "
                "load_report again for a fresh handle"
            )

    read = read_once(
        registry,
        handle,
        lambda _: _read(path),
        variant=CacheVariant.NOC_CONGESTION,
        share_key=pinned,
        refusals=(ValueError,),
        check=unchanged,
    )
    return read, now != pinned


def _label(value: object) -> Optional[str]:
    return value if isinstance(value, str) and len(value) <= MAX_LABEL_LENGTH else None


def _figure(value: object) -> Optional[float]:
    number = finite_number(value)
    return None if number is None else as_answered(number)


def _summary_figures(
    figures: Dict[str, object], demand_key: str, util_key: str
) -> Dict[str, object]:
    return {
        "link_demand_percent": _figure(figures.get(demand_key)),
        "link_util_percent": _figure(figures.get(util_key)),
        "highest_timestep_average_demand_percent": _figure(
            figures.get("max_link_demand")
        ),
    }


def _run(info: Dict[str, object]) -> Dict[str, object]:
    """The trace's own run summary, as the app's NPE view shows it."""
    run = _summary_figures(info, "link_demand", "link_util")
    run["dram_bw_util_percent"] = _figure(info.get("dram_bw_util"))
    mcast = _figure(info.get("mcast_write_link_util"))
    if mcast is not None:
        run["mcast_write_link_util_percent"] = mcast
    nocs = info.get("noc")
    if isinstance(nocs, dict):
        run["by_noc"] = {
            name: _summary_figures(figures, "avg_link_demand", "avg_link_util")
            for name, figures in sorted(
                (name, figures)
                for name, figures in nocs.items()
                if isinstance(figures, dict) and len(name) <= MAX_LINK_NAME_LENGTH
            )[:MAX_NOCS]
        }
    return run


def _link_fields(link: Link) -> Dict[str, object]:
    device, y, x, name = link
    return {"device": device, "y": y, "x": x, "link": name}


def _peak(peak: _Peak) -> Dict[str, object]:
    return {
        "demand_percent": as_answered(peak.demand),
        "timestep": peak.timestep,
        "start_cycle": peak.start_cycle,
        "end_cycle": peak.end_cycle,
        **_link_fields(peak.link),
    }


def _caveats(read: _NocRead, path: Path, changed: bool) -> List[str]:
    caveats: List[str] = []
    if read.unreadable_entries:
        caveats.append(
            f"{read.unreadable_entries} link demand entries were not a link's "
            f"coordinates, a name of at most {MAX_LINK_NAME_LENGTH} characters and a "
            "non-negative number, and were left out."
        )
    if read.entries_past_link_limit:
        caveats.append(
            f"{read.entries_past_link_limit} link demand entries were for links past "
            f"the first {MAX_LINKS:,} read, and were left out, so every figure but run, "
            "the trace's own summary, covers those links only."
        )
    if read.unreadable_timesteps:
        caveats.append(
            f"{read.unreadable_timesteps} timesteps were not a timestep's object or "
            "held no list of link demand, and count as idle."
        )
    if changed:
        caveats.append(
            f"{path.name} has changed or gone since this handle read it, and this is "
            "that read; call load_report again to read it as it is now."
        )
    return caveats


def noc_congestion(
    registry: ReportRegistry, handle: str, limit: Optional[int] = None
) -> Dict[str, object]:
    """How congested a tt-npe trace's NoC links were, and where and when."""
    count = bounded(limit)
    npe_path = registry.get(handle).npe_path
    if not npe_path:
        raise ValueError(
            f"{handle!r} was loaded without an npe_path, so it holds no tt-npe trace; "
            "call load_report with one"
        )
    path = Path(npe_path)
    read, changed = _pinned_read(registry, handle, path)
    if not read.timesteps:
        raise ValueError(
            f"{path.name} records no timesteps, so there is no NoC to read"
        )

    info = read.common_info
    result: Dict[str, object] = {
        "handle": handle,
        "npe_trace": path.name,
        "arch": _label(info.get("arch")),
        "device": _label(info.get("mesh_device", info.get("device_name"))),
        "congestion_model": _label(info.get("congestion_model_name")),
        "cycles_per_timestep": whole_number(info.get("cycles_per_timestep")),
        "timesteps": read.timesteps,
        "first_cycle": read.first_cycle,
        "last_cycle": read.last_cycle,
        "transfers": read.transfers,
        "run": _run(info),
        "worst_link": _peak(read.worst) if read.worst is not None else None,
        "worst_link_ties": read.worst_ties,
        "congested_timesteps": read.congested_timesteps,
        "congested_percent": share_percent(read.congested_timesteps, read.timesteps),
        "burst_count": read.burst_count,
        "bursts": [
            {
                "start_cycle": burst.start_cycle,
                "end_cycle": burst.end_cycle,
                "timesteps": burst.timesteps,
                "peak": _peak(burst.peak),
            }
            for burst in read.bursts[:count]
        ],
        "link_count": read.link_count,
        "busiest_links": [
            {
                **_link_fields(totals.link),
                "mean_demand_percent": as_answered(totals.demand / read.timesteps),
                "peak_demand_percent": as_answered(totals.peak),
                "congested_percent": share_percent(totals.congested, read.timesteps),
            }
            for totals in read.links[:count]
        ],
        "note": NOC_CONGESTION_NOTE,
    }
    caveats = _caveats(read, path, changed)
    if caveats:
        result["caveat"] = " ".join(caveats)
    return result


__all__ = [
    "MAX_LINKS",
    "MAX_TRACE_JSON_BYTES",
    "NOC_CONGESTION_NOTE",
    "noc_congestion",
]
