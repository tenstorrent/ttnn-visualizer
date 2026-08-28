# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import dataclasses
import enum
import json
import logging
import os
import re
import shutil
import sqlite3
import sys
import time
from collections import Counter
from functools import wraps
from pathlib import Path
from timeit import default_timer
from typing import Any, Callable, Dict, Iterable, List, Optional, Pattern, Tuple

logger = logging.getLogger(__name__)

LAST_SYNCED_FILE_NAME = ".last-synced"

# TTNN profiler report directory may contain a single config.json or per-rank
# config_<n>_of_<world_size>.json files from multi-host runs. The first number is
# 1-based (1..world_size), not MPI rank; logical rank == that number minus one.
PROFILER_CONFIG_BASENAME = "config.json"
PROFILER_CONFIG_RANKED_RE = re.compile(r"^config_(\d+)_of_(\d+)\.json$")

MESH_DESCRIPTOR_BASENAME = "physical_chip_mesh_coordinate_mapping.yaml"
MESH_DESCRIPTOR_RANKED_RE = re.compile(
    r"^physical_chip_mesh_coordinate_mapping_(\d+)_of_(\d+)\.yaml$"
)

CLUSTER_DESCRIPTOR_BASENAME = "cluster_descriptor.yaml"
CLUSTER_DESCRIPTOR_RANKED_RE = re.compile(r"^cluster_descriptor_(\d+)_of_(\d+)\.yaml$")


def parse_ranked_basename(
    filename: str, ranked_re: Pattern[str]
) -> Optional[Tuple[int, int]]:
    """If filename matches <prefix>_<n>_of_<world>.<ext>, return (n, world)."""
    match = ranked_re.match(filename)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def parse_ranked_profiler_config_basename(
    filename: str,
) -> Optional[Tuple[int, int]]:
    """If filename matches config_<n>_of_<world>.json, return (n, world)."""
    return parse_ranked_basename(filename, PROFILER_CONFIG_RANKED_RE)


# A world size is parsed straight out of a filename, and filenames on the local
# upload path are client-controlled. Anything past this is not a run we could
# render anyway — the largest cluster the app has seen is in the hundreds — and
# without a bound an 11-digit name asks for a multi-terabyte allocation in the
# shared Flask process. Well above _MAX_RANK's use as a query-param bound.
MAX_RANKED_WORLD_SIZE = 4096


def is_valid_profiler_ranked_entry(index_one_based: int, world: int) -> bool:
    """True when the filename indices match TTNN output (1..world inclusive)."""
    return 1 <= world <= MAX_RANKED_WORLD_SIZE and 1 <= index_one_based <= world


def ranked_report_basenames(
    file_names: Iterable[str],
    ranked_re: Pattern[str],
    malformed_label: str,
) -> List[str]:
    """
    Select per-rank report files that share the same world_size (majority wins).

    Only filenames whose first number is in 1..world (inclusive) are considered.
    Returns basenames sorted by ascending 1-based index.
    """
    meta: List[Tuple[int, int, str]] = []
    for name in file_names:
        parsed = parse_ranked_basename(name, ranked_re)
        if parsed:
            index_one_based, world = parsed
            if not is_valid_profiler_ranked_entry(index_one_based, world):
                logger.warning(
                    "Skipping malformed report filename %s (expected %s)",
                    name,
                    malformed_label,
                )
                continue
            meta.append((world, index_one_based, name))
    if not meta:
        return []
    common_world = Counter(w for w, _, _ in meta).most_common(1)[0][0]
    filtered = [(idx, n) for w, idx, n in meta if w == common_world]
    filtered.sort(key=lambda x: x[0])
    return [n for _, n in filtered]


def ranked_profiler_config_basenames(file_names: Iterable[str]) -> List[str]:
    """
    Select per-rank config files that share the same world_size (majority wins).

    Only filenames whose first number is in 1..world (inclusive) are considered.
    Returns basenames sorted by ascending 1-based index (config_1_of_*, then
    config_2_of_*, ...).
    """
    return ranked_report_basenames(
        file_names,
        PROFILER_CONFIG_RANKED_RE,
        "config_<n>_of_<world>.json with 1 <= n <= world",
    )


def _ranked_family(
    report_dir: Path, ranked_re: Pattern[str], malformed_label: str
) -> tuple[List[str], int, bool]:
    """
    The ranked files in ``report_dir``: their names, world size, and completeness.

    ``ranked_report_basenames`` calls any non-empty same-world group consistent, so
    a lone ``_1_of_2`` left behind by an earlier import looks like a family. It is
    reported as incomplete here instead, because such a group must not outrank a
    usable unsuffixed descriptor. #1947
    """
    names = ranked_report_basenames(
        (p.name for p in report_dir.iterdir() if p.is_file()),
        ranked_re,
        malformed_label,
    )
    if not names:
        return [], 0, False
    # Parsed once per name: this ran the regex three times per filename, and the
    # hoist is also what removes the `type: ignore[index]` the comprehension needed.
    parsed = [parse_ranked_basename(name, ranked_re) for name in names]
    if not parsed[0]:
        return [], 0, False
    _, world_size = parsed[0]
    indices = {entry[0] for entry in parsed if entry}
    # Counted, not compared against `set(range(1, world_size + 1))`: the indices are
    # already unique and `ranked_report_basenames` has bounded them to 1..world, so
    # the count settles completeness without allocating a set sized by a number that
    # came out of a filename.
    return names, world_size, len(indices) == world_size


def _newest_mtime_ns(paths: Iterable[Path]) -> int:
    """Newest mtime among ``paths``; -1 when none of them can be stat'd."""
    stamps = []
    for path in paths:
        try:
            stamps.append(path.stat().st_mtime_ns)
        except OSError:
            continue
    return max(stamps) if stamps else -1


def _prefer_ranked_family(
    report_dir: Path, single: Path, ranked_names: List[str], ranked_is_complete: bool
) -> bool:
    """
    Whether the ranked family wins over an unsuffixed descriptor beside it.

    Both can exist: ``import_report`` reuses the output directory and writes each
    descriptor only ``if not path.exists()``, so whichever import ran first owns
    its filenames and the other import adds the second family. Which one is stale
    therefore depends on import order, and both orders are reachable — a world-1
    import then a world-N one leaves the unsuffixed file stale, and the reverse
    leaves the ranked family stale.

    Nothing in the filenames records that, so recency decides, and only a complete
    family is eligible to win. Ties go to the ranked family, which carries per-rank
    detail. Note that mtimes do not survive every copy — an archive extract can
    flatten them all — in which case the tie-break is what applies. #1947
    """
    if not ranked_is_complete:
        return False
    ranked_mtime = _newest_mtime_ns(report_dir / name for name in ranked_names)
    return ranked_mtime >= _newest_mtime_ns([single])


def _pick_single_or_ranked_report_path(
    report_dir: Path,
    *,
    single_basename: str,
    ranked_re: Pattern[str],
    ranked_basename_for: Callable[[int, int], str],
    malformed_label: str,
    logical_rank: int = 0,
    single_is_one_rank: bool = False,
) -> tuple[Optional[Path], Optional[str]]:
    """
    Pick the descriptor file for ``logical_rank``. Returns ``(path, None)`` or
    ``(None, error)`` where error is ``rank_out_of_range``, ``missing_rank_file``,
    or ``None`` when nothing is present.

    ``single_is_one_rank`` declares that an unsuffixed file describes exactly one
    rank. A consistent ranked set then outranks it, and with no ranked set it
    answers rank 0 only. Cluster descriptors set it: world size lives in the
    ranked filenames, so serving one unsuffixed descriptor for every rank made the
    topology probe read a single host as a whole world and clone it once per
    probed rank. #1939

    Left ``False`` for mesh mappings, where one unsuffixed file legitimately
    covers every rank — reused as a legacy single doc, or holding one ``chips:``
    document per rank that the frontend selects from by rank. #1947

    Which *family* is used — the unsuffixed file or the ranked set — is decided
    identically for both, so cluster and mesh cannot end up reading different
    generations of the same report. Only the per-rank question above differs.
    """
    if not report_dir.is_dir():
        return None, None

    single = report_dir / single_basename
    single_exists = single.is_file()
    ranked_names, world_size, ranked_is_complete = _ranked_family(
        report_dir, ranked_re, malformed_label
    )

    if single_exists and ranked_names:
        use_ranked = _prefer_ranked_family(
            report_dir, single, ranked_names, ranked_is_complete
        )
    else:
        use_ranked = bool(ranked_names)

    if not use_ranked:
        if not single_exists:
            return None, None
        # A whole-world mapping answers every rank; a single-host descriptor
        # answers rank 0 and nothing beyond it.
        if single_is_one_rank and logical_rank != 0:
            return None, "rank_out_of_range"
        return single, None

    if logical_rank < 0 or logical_rank >= world_size:
        return None, "rank_out_of_range"

    path = report_dir / ranked_basename_for(logical_rank + 1, world_size)
    if not path.is_file():
        # Only reachable for an incomplete family that had no unsuffixed file to
        # defer to, or a file removed since the directory was listed.
        return None, "missing_rank_file"
    return path, None


def pick_profiler_config_paths(report_dir: Path) -> List[Path]:
    """
    Prefer config.json when present; otherwise use consistent config_*_of_*.json files.
    """
    if not report_dir.is_dir():
        return []
    single = report_dir / PROFILER_CONFIG_BASENAME
    if single.is_file():
        return [single]
    ranked_names = ranked_profiler_config_basenames(
        p.name for p in report_dir.iterdir() if p.is_file()
    )
    return [report_dir / name for name in ranked_names]


def read_profiler_report_name(report_dir: Path) -> Optional[str]:
    """Read report_name from profiler config(s), or None if absent / unreadable."""
    paths = pick_profiler_config_paths(report_dir)
    if not paths:
        return None
    primary = paths[0]
    try:
        with open(primary, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("Failed to read profiler config %s: %s", primary, e)
        return None
    return data.get("report_name") if isinstance(data, dict) else None


def read_profiler_config_api_payload(
    report_dir: Path, logical_rank: int = 0
) -> tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Read one profiler config file for /api/config.

    Same JSON shape as a standalone ``config.json``: the parsed object from that
    file only.

    If ``config.json`` exists, it is always used (``logical_rank`` is ignored).

    Otherwise ranked ``config_<n>_of_<world>.json`` files are used: logical rank R
    reads ``config_{R+1}_of_<world>.json``. Default ``logical_rank`` is 0 (first
    host).

    Returns ``(payload, None)`` on success. On failure returns ``(None, error)``
    where ``error`` is ``None`` only when there is no config at all (caller may
    respond with an empty object); otherwise ``rank_out_of_range``,
    ``missing_rank_file``, or ``parse_error``.
    """
    if not report_dir.is_dir():
        return None, None
    single = report_dir / PROFILER_CONFIG_BASENAME
    if single.is_file():
        try:
            with open(single, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            logger.warning("Failed to read profiler config %s: %s", single, e)
            return None, "parse_error"
        if not isinstance(data, dict):
            return None, "parse_error"
        return data, None

    ranked_names = ranked_profiler_config_basenames(
        p.name for p in report_dir.iterdir() if p.is_file()
    )
    if not ranked_names:
        return None, None

    parsed0 = parse_ranked_profiler_config_basename(ranked_names[0])
    if not parsed0:
        return None, None
    _, world_size = parsed0

    if logical_rank < 0 or logical_rank >= world_size:
        return None, "rank_out_of_range"

    basename = f"config_{logical_rank + 1}_of_{world_size}.json"
    path = report_dir / basename
    if not path.is_file():
        return None, "missing_rank_file"

    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("Failed to read profiler config %s: %s", path, e)
        return None, "parse_error"
    if not isinstance(data, dict):
        return None, "parse_error"
    return data, None


def get_app_data_directory(tt_metal_home: Optional[str], application_dir: str) -> str:
    """
    Calculate the APP_DATA_DIRECTORY with sensible defaults.

    Priority:
    1. TT_METAL_HOME (if set) -> {tt_metal_home}/generated/ttnn-visualizer
    2. Environment variable APP_DATA_DIRECTORY (if set)
    3. Container detection -> /var/lib/ttnn-visualizer/app (root) or ~/.ttnn-visualizer/app (non-root)
    4. Regular user -> ~/.ttnn-visualizer/app

    Args:
        tt_metal_home: Path to TT-Metal home directory, or None
        application_dir: Fallback application directory path (legacy, used for migration detection)

    Returns:
        Path to the app data directory
    """
    # Priority 1: TT_METAL_HOME mode
    if tt_metal_home and tt_metal_home.strip():
        return str(Path(tt_metal_home).expanduser() / "generated" / "ttnn-visualizer")

    # Priority 2: Explicit environment variable
    if env_dir := os.getenv("APP_DATA_DIRECTORY"):
        return env_dir

    # Priority 3: Container detection
    if is_running_in_container():
        # If running as root in container, use /var/lib
        try:
            if os.geteuid() == 0:
                return "/var/lib/ttnn-visualizer/app"
        except AttributeError:
            # Windows doesn't have geteuid(), assume non-root
            pass
        # Otherwise use home directory (even in container)
        return str(Path.home() / ".ttnn-visualizer" / "app")

    # Priority 4: Default for regular users
    return str(Path.home() / ".ttnn-visualizer" / "app")


def get_report_data_directory(
    tt_metal_home: Optional[str], application_dir: str
) -> str:
    """
    Calculate the REPORT_DATA_DIRECTORY with sensible defaults.

    Uses the same base directory as app data, but points to reports subdirectory.
    Structure: {base}/reports (where base is ~/.ttnn-visualizer or /var/lib/ttnn-visualizer)

    Args:
        tt_metal_home: Path to TT-Metal home directory, or None
        application_dir: Fallback application directory path (legacy, used for migration detection)

    Returns:
        Path to the report data directory
    """
    # Priority 1: Explicit environment variable
    if env_dir := os.getenv("REPORT_DATA_DIRECTORY"):
        return env_dir

    # Priority 2: Use same base as app data, but in reports subdirectory
    app_data_dir = get_app_data_directory(tt_metal_home, application_dir)
    base_dir = Path(app_data_dir).parent
    return str(base_dir / "reports")


def migrate_old_data_directory(
    old_app_data_dir: str,
    old_report_data_dir: str,
    new_app_data_dir: str,
    new_report_data_dir: str,
    db_version: str,
) -> bool:
    """
    Migrate data from old site-packages directory to new user directory.

    Args:
        old_app_data_dir: Old app data directory (typically in site-packages)
        old_report_data_dir: Old report data directory (typically in site-packages)
        new_app_data_dir: New app data directory (typically ~/.ttnn-visualizer/app)
        new_report_data_dir: New report data directory (typically ~/.ttnn-visualizer/reports)
        db_version: Database version string (e.g., "0.29.0") to construct database filename

    Returns:
        True if migration was performed, False otherwise
    """
    old_app_path = Path(old_app_data_dir)
    old_report_path = Path(old_report_data_dir)
    new_app_path = Path(new_app_data_dir)
    new_report_path = Path(new_report_data_dir)

    # Construct the database filename
    db_filename = f"ttnn_{db_version}.db"
    old_db_path = old_app_path / db_filename

    # Check if old directories exist and have data
    old_app_has_data = old_db_path.exists()
    old_report_has_data = old_report_path.exists() and any(old_report_path.iterdir())

    if not old_app_has_data and not old_report_has_data:
        return False

    # Check if new directories already have data (don't overwrite)
    new_db_path = new_app_path / db_filename
    new_app_has_data = new_db_path.exists()
    new_report_has_data = new_report_path.exists() and any(new_report_path.iterdir())

    if new_app_has_data or new_report_has_data:
        logger.info(
            f"New data directories already exist with data, skipping migration. "
            f"App: {new_app_path}, Reports: {new_report_path}"
        )
        return False

    # Check if old directory is actually in site-packages (to avoid migrating from custom locations)
    old_app_str = str(old_app_path)
    if "site-packages" not in old_app_str and "dist-packages" not in old_app_str:
        logger.info(
            f"Old app data directory is not in site-packages, skipping migration: {old_app_path}"
        )
        return False

    print("\n" + "=" * 70)
    print("📦 DATA DIRECTORY MIGRATION")
    print("=" * 70)
    print(f"Detected old data in site-packages directory.")
    print(f"  Old app data: {old_app_path}")
    print(f"  Old reports: {old_report_path}")
    print(f"\nNew location:")
    print(f"  New app data: {new_app_path}")
    print(f"  New reports: {new_report_path}")
    print("\nWould you like to migrate the data? (y/n): ", end="", flush=True)

    try:
        response = input().strip().lower()
        if response not in ("y", "yes"):
            print("Migration cancelled by user.")
            return False
    except (EOFError, KeyboardInterrupt):
        print("\nMigration cancelled.")
        return False

    # Create new directories
    new_app_path.mkdir(parents=True, exist_ok=True)
    new_report_path.mkdir(parents=True, exist_ok=True)

    migrated = False

    # Migrate app data (only the specific database file)
    if old_app_has_data:
        print(f"\nMigrating database file from {old_app_path} to {new_app_path}...")
        try:
            # Move the database file
            shutil.move(str(old_db_path), str(new_db_path))
            print(f"  ✓ Moved {db_filename}")
            migrated = True
        except Exception as e:
            logger.error(f"Error migrating database file: {e}")
            print(f"  ❌ Error: {e}")

    # Migrate report data (all files and directories)
    if old_report_has_data:
        print(f"\nMigrating reports from {old_report_path} to {new_report_path}...")
        try:
            for item in old_report_path.iterdir():
                dest = new_report_path / item.name
                if item.is_file():
                    shutil.move(str(item), str(dest))
                    print(f"  ✓ Moved {item.name}")
                elif item.is_dir():
                    shutil.move(str(item), str(dest))
                    print(f"  ✓ Moved directory {item.name}")
            migrated = True
        except Exception as e:
            logger.error(f"Error migrating report data: {e}")
            print(f"  ❌ Error: {e}")

    # Update paths in the database after migration
    # Note: We use the old_report_path for matching even though files are moved,
    # because the database still contains the old paths that need to be updated
    if migrated and old_app_has_data:
        print(f"\nUpdating paths in database...")
        try:
            _update_database_paths(new_db_path, old_report_path, new_report_path)
            print(f"  ✓ Updated paths in database")
        except Exception as e:
            logger.error(f"Error updating database paths: {e}")
            print(f"  ⚠️  Warning: Could not update paths in database: {e}")
            print(f"     You may need to manually update paths in the instances table.")

    if migrated:
        print("\n✅ Migration completed successfully!")
        print(f"   Data has been moved from: {old_app_path}")
    else:
        print("\n⚠️  No data was migrated.")

    print("=" * 70 + "\n")

    return migrated


def _update_database_paths(
    db_path: Path, old_report_data_dir: Path, new_report_data_dir: Path
) -> None:
    """
    Update absolute paths in the instances table after migration.

    Args:
        db_path: Path to the SQLite database file
        old_report_data_dir: Old report data directory path
        new_report_data_dir: New report data directory path
    """
    # Normalize paths to handle symlinks and ensure consistent format
    old_report_data_dir = old_report_data_dir.resolve()
    new_report_data_dir = new_report_data_dir.resolve()
    old_report_str = str(old_report_data_dir)
    new_report_str = str(new_report_data_dir)

    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()

        # Update profiler_path
        cursor.execute(
            """
            UPDATE instances
            SET profiler_path = REPLACE(profiler_path, ?, ?)
            WHERE profiler_path LIKE ? || '%'
            """,
            (old_report_str, new_report_str, old_report_str),
        )
        profiler_updated = cursor.rowcount

        # Update performance_path
        cursor.execute(
            """
            UPDATE instances
            SET performance_path = REPLACE(performance_path, ?, ?)
            WHERE performance_path LIKE ? || '%'
            """,
            (old_report_str, new_report_str, old_report_str),
        )
        performance_updated = cursor.rowcount

        # Update npe_path
        cursor.execute(
            """
            UPDATE instances
            SET npe_path = REPLACE(npe_path, ?, ?)
            WHERE npe_path LIKE ? || '%'
            """,
            (old_report_str, new_report_str, old_report_str),
        )
        npe_updated = cursor.rowcount

        conn.commit()
        conn.close()

        if profiler_updated > 0 or performance_updated > 0 or npe_updated > 0:
            logger.info(
                f"Updated database paths: {profiler_updated} profiler_path, "
                f"{performance_updated} performance_path, {npe_updated} npe_path"
            )
    except sqlite3.Error as e:
        logger.error(f"SQLite error updating paths: {e}")
        raise


def find_gunicorn_path() -> tuple[str, Optional[str]]:
    """
    Find the gunicorn executable, prioritizing the same bin directory as ttnn-visualizer.

    Returns:
        tuple: (gunicorn_path, warning_message)
            - gunicorn_path: Full path to the gunicorn executable to use
            - warning_message: Warning message if there are any issues finding gunicorn
              (e.g., multiple installations, falling back to PATH, or not found),
              or None if found without conflicts.
    """
    # Get the directory where ttnn-visualizer was run from
    ttnn_visualizer_path = Path(sys.argv[0]).resolve()
    bin_dir = ttnn_visualizer_path.parent

    # Look for gunicorn in the same directory
    expected_gunicorn = bin_dir / "gunicorn"

    if (
        expected_gunicorn.exists()
        and expected_gunicorn.is_file()
        and os.access(expected_gunicorn, os.X_OK)
    ):
        # Found gunicorn in the same bin directory and it's executable
        gunicorn_path = str(expected_gunicorn)

        # Check if there's a different gunicorn in PATH
        path_gunicorn = shutil.which("gunicorn")
        warning_message = None

        if path_gunicorn and Path(path_gunicorn).resolve() != expected_gunicorn:
            warning_message = (
                f"⚠️  WARNING: Multiple gunicorn installations detected!\n"
                f"   Using: {gunicorn_path}\n"
                f"   Found in PATH: {path_gunicorn}\n"
                f"   This may cause version conflicts. Consider using a virtual environment."
            )

        return gunicorn_path, warning_message

    # If file exists but isn't executable, add a warning about that
    if expected_gunicorn.exists() and expected_gunicorn.is_file():
        warning_message = (
            f"⚠️  WARNING: gunicorn found at {expected_gunicorn} but it's not executable!\n"
            f"   Falling back to PATH. Fix permissions with: chmod +x {expected_gunicorn}"
        )
        path_gunicorn = shutil.which("gunicorn")
        if path_gunicorn:
            return path_gunicorn, warning_message
        # If not in PATH either, return error with permission hint
        error_message = (
            f"❌ ERROR: gunicorn found at {expected_gunicorn} but it's not executable!\n"
            f"   Not found in PATH either.\n"
            f"   Fix permissions with: chmod +x {expected_gunicorn}"
        )
        return "gunicorn", error_message

    # Fall back to PATH
    path_gunicorn = shutil.which("gunicorn")

    if path_gunicorn:
        warning_message = (
            f"⚠️  WARNING: gunicorn not found in {bin_dir}\n"
            f"   Falling back to gunicorn from PATH: {path_gunicorn}\n"
            f"   This may cause issues if different versions are installed."
        )
        return path_gunicorn, warning_message

    # Not found anywhere - return "gunicorn" and let subprocess.run fail with a clear error
    warning_message = (
        f"❌ ERROR: gunicorn not found!\n"
        f"   Expected location: {expected_gunicorn}\n"
    )
    return "gunicorn", warning_message


PROFILER_REPORT_REQUIRED_FILES = frozenset({"db.sqlite"})
# Tracy binary is optional — newer TT-Metal runs omit tracy_profile_log_host.tracy
# (see manifest.json without tracy_file). Device log + ops_perf is enough to load.
PERFORMANCE_REPORT_REQUIRED_FILES = frozenset({"profile_log_device.csv"})
PERFORMANCE_OPS_PERF_PREFIX = "ops_perf_results"


def remote_host_report_path(
    remote_data_directory: Path,
    host: str,
    report_directory_name: str,
    report_name: Optional[str] = None,
) -> Path:
    """REMOTE_DATA_DIRECTORY/<host>/<report_directory_name>[/<report_name>].

    Canonical on-disk layout for synced remote reports. PathResolver, sync
    destinations, and offline listing must all go through this helper.
    """
    base = Path(remote_data_directory) / host / report_directory_name
    return base / report_name if report_name is not None else base


def is_valid_profiler_report_dir(directory: Path) -> bool:
    """True when the folder has the files needed to load a memory/profiler report."""
    return all((directory / name).is_file() for name in PROFILER_REPORT_REQUIRED_FILES)


def is_valid_performance_report_dir(directory: Path) -> bool:
    """True when the folder has the files needed to load a performance report.

    Requires profile_log_device.csv and at least one ops_perf_results* *file*
    (a directory with that name is not enough). Tracy is optional.
    """
    if not all(
        (directory / name).is_file() for name in PERFORMANCE_REPORT_REQUIRED_FILES
    ):
        return False
    try:
        return any(
            path.is_file() for path in directory.glob(f"{PERFORMANCE_OPS_PERF_PREFIX}*")
        )
    except OSError:
        return False


class PathResolver:
    """Centralized path resolution for both TT-Metal and upload/sync modes."""

    def __init__(self, current_app):
        self.current_app = current_app
        self.tt_metal_home = current_app.config.get("TT_METAL_HOME")
        self.is_direct_report_mode = bool(self.tt_metal_home)

    def get_base_report_path(self, report_type: str, remote_connection=None):
        """
        Get the base path for a report type (profiler/performance).

        Args:
            report_type: Either 'profiler' or 'performance'
            remote_connection: Optional remote connection for upload/sync mode

        Returns:
            Path object to the base directory for this report type
        """
        if self.is_direct_report_mode:
            tt_metal_base = Path(self.tt_metal_home) / "generated"
            if report_type == "profiler":
                return tt_metal_base / "ttnn" / "reports"
            elif report_type == "performance":
                return tt_metal_base / "profiler" / "reports"
            else:
                raise ValueError(f"Unknown report type: {report_type}")
        else:
            # Upload/sync mode - use existing logic
            local_dir = Path(self.current_app.config["LOCAL_DATA_DIRECTORY"])
            remote_dir = Path(self.current_app.config["REMOTE_DATA_DIRECTORY"])

            if report_type == "profiler":
                dir_name = self.current_app.config["PROFILER_DIRECTORY_NAME"]
            elif report_type == "performance":
                dir_name = self.current_app.config["PERFORMANCE_DIRECTORY_NAME"]
            else:
                raise ValueError(f"Unknown report type: {report_type}")

            if remote_connection:
                return remote_host_report_path(
                    remote_dir, remote_connection.host, dir_name
                )
            return local_dir / dir_name

    def get_profiler_path(self, profiler_name: str, remote_connection=None):
        """Get the full path to a profiler report's db.sqlite file."""
        if not profiler_name:
            return ""

        base_path = self.get_base_report_path("profiler", remote_connection)

        if self.is_direct_report_mode and not base_path.exists():
            logger.warning(f"TT-Metal profiler reports not found: {base_path}")
            return ""

        profiler_path = base_path / profiler_name
        target_path = profiler_path / self.current_app.config["SQLITE_DB_PATH"]

        return str(target_path)

    def get_performance_path(self, performance_name: str, remote_connection=None):
        """Get the full path to a performance report directory."""
        base_path = self.get_base_report_path("performance", remote_connection)

        if self.is_direct_report_mode and not base_path.exists():
            logger.warning(f"TT-Metal performance reports not found: {base_path}")
            return ""

        performance_path = base_path / performance_name
        return str(performance_path)

    def get_mode_info(self):
        """Get information about the current mode for debugging/display."""
        if self.is_direct_report_mode:
            return {
                "mode": "tt_metal",
                "tt_metal_home": self.tt_metal_home,
                "profiler_base": str(
                    Path(self.tt_metal_home) / "generated" / "ttnn" / "reports"
                ),
                "performance_base": str(
                    Path(self.tt_metal_home) / "generated" / "profiler" / "reports"
                ),
            }
        else:
            return {
                "mode": "upload_sync",
                "local_dir": str(self.current_app.config["LOCAL_DATA_DIRECTORY"]),
                "remote_dir": str(self.current_app.config["REMOTE_DATA_DIRECTORY"]),
            }

    def validate_tt_metal_setup(self):
        """Validate that TT-Metal directories exist and are accessible."""
        if not self.is_direct_report_mode:
            return True, "Not in TT-Metal mode"

        tt_metal_base = Path(self.tt_metal_home)
        if not tt_metal_base.exists():
            return False, f"TT_METAL_HOME directory does not exist: {tt_metal_base}"

        generated_dir = tt_metal_base / "generated"
        if not generated_dir.exists():
            return False, f"TT-Metal generated directory not found: {generated_dir}"

        profiler_base = self.get_base_report_path("profiler")
        performance_base = self.get_base_report_path("performance")

        messages = []
        if not profiler_base.exists():
            messages.append(f"Profiler reports directory not found: {profiler_base}")
        if not performance_base.exists():
            messages.append(
                f"Performance reports directory not found: {performance_base}"
            )

        if messages:
            return False, "; ".join(messages)

        return True, "TT-Metal setup is valid"


TRUE_VALUES = frozenset({"true", "1"})
FALSE_VALUES = frozenset({"false", "0"})


def parse_bool(value: str) -> Optional[bool]:
    """Parse a boolean setting, returning ``None`` for a value outside the vocabulary.

    Deliberately narrow: the two spellings ``.env.sample`` documents, and the two the
    SPA's own parsing accepts, so a value can't mean one thing to the API and another
    to the page reading it.

    Distinguishing "means false" from "we don't recognise this" is what lets a caller
    report a typo instead of obeying it: ``str_to_bool`` alone maps ``"yes"`` and
    ``"Ture"`` to ``False``, which for ``SERVER_MODE`` is the local posture.
    """
    normalised = value.strip().lower()
    if normalised in TRUE_VALUES:
        return True

    if normalised in FALSE_VALUES:
        return False

    return None


def str_to_bool(string_value):
    """Whether a value names truth, treating anything unrecognised as false.

    Callers that need to tell an unrecognised value apart from a false one — config,
    where the distinction is a security posture — use :func:`parse_bool` instead.
    """
    return parse_bool(string_value) is True


MIN_TCP_PORT = 1
MAX_TCP_PORT = 65535


def require_tcp_port(value: str) -> int:
    """Parse a TCP port, raising ``ValueError`` for anything unusable.

    The strict half of :func:`parse_tcp_port`, for callers that have a declared value
    to keep and would rather report a bad one than silently substitute a default.
    """
    port = int(value, 10)
    if not MIN_TCP_PORT <= port <= MAX_TCP_PORT:
        raise ValueError(f"port {port} is outside {MIN_TCP_PORT}-{MAX_TCP_PORT}")

    return port


def parse_tcp_port(value: Optional[str], default: int = 22) -> int:
    """Parse a TCP port from an env string; return ``default`` if invalid.

    Accepts only integer ports in 1..65535. Non-integers, out-of-range values,
    and ``None``/empty strings fall back to ``default``.
    """
    if value is None or value.strip() == "":
        return default

    try:
        return require_tcp_port(value)
    except ValueError:
        return default


def is_running_in_container():
    """
    Detect if running inside a container (Docker, Podman, Kubernetes, etc.).

    Uses multiple detection methods for robustness:
    1. /.dockerenv file (Docker-specific, fastest check)
    2. /proc/self/cgroup contains container indicators
    3. Container-specific environment variables

    Returns:
        bool: True if running in a container, False otherwise
    """
    # Method 1: Check for /.dockerenv (Docker-specific, most common)
    if os.path.exists("/.dockerenv"):
        logger.info("Container detected via /.dockerenv file")
        return True

    # Method 2: Check cgroup for container indicators
    try:
        with open("/proc/self/cgroup", "r") as f:
            content = f.read()
            # Check for various container runtimes
            container_indicators = ["docker", "containerd", "lxc", "kubepods"]
            if any(indicator in content for indicator in container_indicators):
                logger.info(
                    f"Container detected via /proc/self/cgroup: {content[:100]}"
                )
                return True
    except (FileNotFoundError, PermissionError):
        # Not on Linux or no permission to read cgroup
        pass

    # Method 3: Check for container-specific environment variables
    container_env_vars = [
        "KUBERNETES_SERVICE_HOST",  # Kubernetes
        "KUBERNETES_PORT",  # Kubernetes
        "container",  # systemd-nspawn and others
    ]

    for env_var in container_env_vars:
        if os.getenv(env_var):
            logger.info(f"Container detected via environment variable: {env_var}")
            return True

    return False


@dataclasses.dataclass
class SerializeableDataclass:
    def to_dict(self) -> dict:
        # Convert the dataclass to a dictionary and handle Enums.
        return {
            key: (value.value if isinstance(value, enum.Enum) else value)
            for key, value in dataclasses.asdict(self).items()
        }


def timer(f: Callable):
    @wraps(f)
    def wrapper(*args, **kwargs):
        start_time = default_timer()
        response = f(*args, **kwargs)
        total_elapsed_time = default_timer() - start_time
        logger.info(f"{f.__name__}: Elapsed time: {total_elapsed_time:0.4f} seconds")
        return response

    return wrapper


def get_performance_path(performance_name, current_app, remote_connection=None):
    """
    Gets the path for the given performance_name.

    :param performance_name: The name of the performance directory.
    :param current_app: Flask current application object.
    :param remote_connection: Remote connection model instance

    :return: Performance path as a string.
    """
    resolver = PathResolver(current_app)
    return resolver.get_performance_path(performance_name, remote_connection)


def get_profiler_path(profiler_name, current_app, remote_connection=None):
    """
    Gets the report path for the given active_report object.
    :param profiler_name: The name of the report directory.
    :param current_app: Flask current application
    :param remote_connection: Remote connection model instance

    :return: profiler_path as a string
    """
    resolver = PathResolver(current_app)
    return resolver.get_profiler_path(profiler_name, remote_connection)


def create_path_resolver(current_app):
    """Create a PathResolver instance for the current app."""
    return PathResolver(current_app)


def get_available_reports(current_app):
    """
    Get available reports in the current mode.

    Returns a dict with 'profiler' and 'performance' keys containing lists of available reports.
    This is a convenience function for views that need to discover available reports.
    """
    resolver = PathResolver(current_app)

    reports = {"profiler": [], "performance": []}

    # Get profiler reports
    try:
        profiler_base = resolver.get_base_report_path("profiler")
        if profiler_base.exists():
            for report_dir in profiler_base.iterdir():
                if report_dir.is_dir() and is_valid_profiler_report_dir(report_dir):
                    reports["profiler"].append(
                        {
                            "name": report_dir.name,
                            "path": str(report_dir),
                            "modified": report_dir.stat().st_mtime,
                        }
                    )
    except Exception as e:
        logger.warning(f"Error reading profiler reports: {e}")

    # Get performance reports
    try:
        performance_base = resolver.get_base_report_path("performance")
        if performance_base.exists():
            for report_dir in performance_base.iterdir():
                if report_dir.is_dir() and is_valid_performance_report_dir(report_dir):
                    reports["performance"].append(
                        {
                            "name": report_dir.name,
                            "path": str(report_dir),
                            "modified": report_dir.stat().st_mtime,
                        }
                    )
    except Exception as e:
        logger.warning(f"Error reading performance reports: {e}")

    # Sort by modification time (newest first)
    reports["profiler"].sort(key=lambda x: x["modified"], reverse=True)
    reports["performance"].sort(key=lambda x: x["modified"], reverse=True)

    return reports


def get_npe_path(npe_name, current_app, remote_connection=None):
    local_dir = Path(current_app.config["LOCAL_DATA_DIRECTORY"])

    npe_path = local_dir / current_app.config["NPE_DIRECTORY_NAME"]

    return str(npe_path)


def get_mlir_path(mlir_name, current_app, remote_connection=None, **_kwargs):
    # MLIR uploads are saved as `<MLIR_DIRECTORY_NAME>/<mlir_name>.json`
    # (the upload handler stores the source filename's stem, so `mlir_name`
    # carries no suffix). Reconstruct the file path the same way so callers
    # like `_resolve_report_path` get an openable file — returning just the
    # directory previously caused `get_mlir_json()` to try `open()` on a
    # directory after any unrelated instance update.
    #
    # MLIR server uploads are stored under
    # REMOTE_DATA_DIRECTORY/<remote_host>/mlir-reports/<name>.json, matching
    # remote profiler/performance host scoping. Keep a flat-directory fallback
    # for older instances created before host scoping.
    if not mlir_name:
        return None
    remote_dir = Path(current_app.config["REMOTE_DATA_DIRECTORY"])
    host_scoped_path: Path | None = None

    if remote_connection is not None and getattr(remote_connection, "host", None):
        host_scoped_path = (
            remote_dir
            / remote_connection.host
            / current_app.config["MLIR_DIRECTORY_NAME"]
            / f"{mlir_name}.json"
        )
        if host_scoped_path.exists():
            return str(host_scoped_path)

    host_scoped_candidates = []
    mlir_file_name = f"{mlir_name}.json"
    mlir_dir_name = current_app.config["MLIR_DIRECTORY_NAME"]
    if remote_dir.exists():
        for host_dir in sorted(path for path in remote_dir.iterdir() if path.is_dir()):
            candidate = host_dir / mlir_dir_name / mlir_file_name
            if candidate.exists():
                host_scoped_candidates.append(candidate)
    if host_scoped_candidates:
        return str(host_scoped_candidates[0])

    fallback_path = (
        remote_dir / current_app.config["MLIR_DIRECTORY_NAME"] / f"{mlir_name}.json"
    )
    if fallback_path.exists():
        return str(fallback_path)

    if host_scoped_path is not None:
        return str(host_scoped_path)

    return str(fallback_path)


def pick_cluster_descriptor_path(
    report_dir: Path, logical_rank: int = 0
) -> tuple[Optional[Path], Optional[str]]:
    """Resolve cluster_descriptor.yaml or cluster_descriptor_<n>_of_<world>.yaml."""
    return _pick_single_or_ranked_report_path(
        report_dir,
        single_basename=CLUSTER_DESCRIPTOR_BASENAME,
        ranked_re=CLUSTER_DESCRIPTOR_RANKED_RE,
        ranked_basename_for=lambda index, world: (
            f"cluster_descriptor_{index}_of_{world}.yaml"
        ),
        malformed_label="cluster_descriptor_<n>_of_<world>.yaml with 1 <= n <= world",
        logical_rank=logical_rank,
        # One unsuffixed cluster descriptor is one host. Mesh mappings differ. #1939
        single_is_one_rank=True,
    )


def pick_mesh_descriptor_path(
    report_dir: Path, logical_rank: int = 0
) -> tuple[Optional[Path], Optional[str]]:
    """Resolve mesh mapping YAML with or without per-rank suffix."""
    return _pick_single_or_ranked_report_path(
        report_dir,
        single_basename=MESH_DESCRIPTOR_BASENAME,
        ranked_re=MESH_DESCRIPTOR_RANKED_RE,
        ranked_basename_for=lambda index, world: (
            f"physical_chip_mesh_coordinate_mapping_{index}_of_{world}.yaml"
        ),
        malformed_label=(
            "physical_chip_mesh_coordinate_mapping_<n>_of_<world>.yaml "
            "with 1 <= n <= world"
        ),
        logical_rank=logical_rank,
    )


def get_cluster_descriptor_path(instance, logical_rank: int = 0):
    if not instance.profiler_path:
        return None

    path, _err = pick_cluster_descriptor_path(
        Path(instance.profiler_path).parent, logical_rank
    )
    if path is None:
        return None

    return str(path)


def get_mesh_descriptor_paths(instance, logical_rank: int = 0):
    if not instance.profiler_path:
        return []

    path, _err = pick_mesh_descriptor_path(
        Path(instance.profiler_path).parent, logical_rank
    )
    if path is None:
        return []

    return [str(path)]


def read_last_synced_file(directory: str) -> Optional[int]:
    """Reads the '.last-synced' file in the specified directory and returns the timestamp as an integer, or None if not found."""
    last_synced_path = Path(directory) / LAST_SYNCED_FILE_NAME

    # Return None if the file does not exist
    if not last_synced_path.exists():
        return None

    # Corrupt / empty / unreadable markers must not fail the whole listing —
    # callers fall back to mtime when this returns None.
    try:
        with last_synced_path.open("r") as file:
            return int(file.read().strip())
    except (ValueError, OSError):
        logger.warning("Unable to read last-synced marker at %s", last_synced_path)
        return None


def update_last_synced(directory: Path) -> None:
    """Creates a file called '.last-synced' with the current timestamp in the specified directory."""
    last_synced_path = Path(directory) / LAST_SYNCED_FILE_NAME

    # Get the current Unix timestamp
    timestamp = int(time.time())

    # Write the timestamp to the .last-synced file
    with last_synced_path.open("w") as file:
        logger.info(f"Updating last synced for directory {directory}")
        file.write(str(timestamp))


MEMORY_CONFIG_PATTERN = re.compile(r"MemoryConfig\((.*)\)$")
MEMORY_LAYOUT_PATTERN = re.compile(r"memory_layout=([A-Za-z_:]+)")
SHARD_SPEC_PATTERN = re.compile(
    r"shard_spec=ShardSpec\(grid=\{(\[.*?\])\},shape=\{(\d+),\s*(\d+)\},orientation=ShardOrientation::([A-Z_]+),halo=(\d+)\)"
)


def parse_memory_config(memory_config: Optional[str]) -> Optional[Dict[str, Any]]:
    if not memory_config:  # Handle None or empty string
        return None

    memory_config_match = MEMORY_CONFIG_PATTERN.match(memory_config)
    if not memory_config_match:
        return None

    captured_string = memory_config_match.group(1)

    memory_layout_match = MEMORY_LAYOUT_PATTERN.search(captured_string)
    memory_layout = memory_layout_match.group(1) if memory_layout_match else None

    shard_spec_match = SHARD_SPEC_PATTERN.search(captured_string)
    shard_spec: str | dict[str, Any]
    if shard_spec_match:
        shard_spec = {
            "grid": shard_spec_match.group(1),
            "shape": [int(shard_spec_match.group(2)), int(shard_spec_match.group(3))],
            "orientation": shard_spec_match.group(4),
            "halo": int(shard_spec_match.group(5)),
        }
    else:
        shard_spec = "std::nullopt"

    return {
        "memory_layout": memory_layout,
        "shard_spec": shard_spec,
    }


def read_version_from_package_json() -> str:
    root_directory = Path(__file__).parent.parent.parent
    file_path = root_directory / "package.json"
    try:
        with open(file_path, "r") as file:
            content = json.load(file)
            return content["version"]
    except FileNotFoundError:
        raise FileNotFoundError(f"The file {file_path} was not found.")
    except KeyError:
        raise KeyError("The 'version' key was not found in the package.json file.")
