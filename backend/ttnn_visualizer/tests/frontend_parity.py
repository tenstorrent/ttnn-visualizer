# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Reads TypeScript definitions for the tests that pin a Python enum to its frontend copy."""

import re
from pathlib import Path
from typing import Dict, Set, Tuple


def typescript_enum_values(path: Path, name: str) -> Set[str]:
    """The string values of one TS enum in ``path``, or a failure rather than an empty set.

    An empty result would satisfy a comparison against an enum that had also been emptied,
    so a body that does not parse, or one with no members, is an error in its own right.
    Raises ``AssertionError`` rather than calling ``pytest.fail`` so callers need no
    ``None`` narrowing.
    """
    body = re.search(
        rf"export enum {name} {{(.*?)^}}",
        path.read_text(encoding="utf-8"),
        re.DOTALL | re.MULTILINE,
    )

    if body is None:
        raise AssertionError(f"No `export enum {name}` in {path.name}")

    values = set(re.findall(r"=\s*'([^']+)'", body.group(1)))

    if not values:
        raise AssertionError(f"`export enum {name}` in {path.name} declares no members")

    return values


def typescript_enum_members(path: Path, name: str) -> Dict[str, str]:
    """One TS enum's string values by member name, as `typescript_enum_values` reads it."""
    body = re.search(
        rf"export enum {name} {{(.*?)^}}",
        path.read_text(encoding="utf-8"),
        re.DOTALL | re.MULTILINE,
    )

    if body is None:
        raise AssertionError(f"No `export enum {name}` in {path.name}")

    members = dict(re.findall(r"(\w+)\s*=\s*'([^']+)'", body.group(1)))

    if not members:
        raise AssertionError(f"`export enum {name}` in {path.name} declares no members")

    return members


def typescript_interface_keys(path: Path, name: str) -> Tuple[Set[str], Set[str]]:
    """One `export interface`'s required and optional keys in ``path``, with those of an
    interface in the same file that it extends, or a failure."""
    found = re.search(
        rf"^export interface {name}(?: extends (\w+))? {{(.*?)^}}",
        path.read_text(encoding="utf-8"),
        re.DOTALL | re.MULTILINE,
    )

    if found is None:
        raise AssertionError(f"No `export interface {name}` in {path.name}")

    required: Set[str] = set()
    optional: Set[str] = set()
    for key, mark in re.findall(r"^\s+(\w+)(\??):", found.group(2), re.MULTILINE):
        (optional if mark else required).add(key)

    if not required | optional:
        raise AssertionError(
            f"`export interface {name}` in {path.name} declares no keys"
        )

    if found.group(1):
        base_required, base_optional = typescript_interface_keys(path, found.group(1))
        required |= base_required
        optional |= base_optional

    return required, optional


def typescript_string_constant(path: Path, name: str) -> str:
    """The value of one `export const NAME = '...';` in ``path``, or a failure."""
    found = re.search(
        rf"^export const {name} = '([^']*)';$",
        path.read_text(encoding="utf-8"),
        re.MULTILINE,
    )

    if found is None:
        raise AssertionError(f"No `export const {name} = '...';` in {path.name}")

    return found.group(1)
