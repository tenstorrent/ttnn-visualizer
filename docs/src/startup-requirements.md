# Startup requirements

Some settings are not optional. If the environment does not supply them, TT-NN
Visualizer refuses to start rather than serving with the property they guarantee
missing. This page lists those conditions, and shows how to check an environment
against a release **before** deploying it.

Everything here concerns values an operator provides. Requirements marked *Hosted* apply
only when `SERVER_MODE` is enabled; a local install runs on the development defaults and
is unaffected.

## Check an environment before you deploy

```shell
ttnn-visualizer --check-config
```

For a hosted deployment, check the posture it will actually run in:

```shell
SERVER_MODE=true ttnn-visualizer --check-config
```

It reads the same environment the server would, evaluates every requirement, prints
each one's status, and exits **without starting anything**:

| Exit code | Meaning |
|---|---|
| `0` | This release's startup requirements are satisfied. It will start here. |
| non-zero | It will not start here. The output names each unmet requirement and what to set. |

Run this against the target environment as a deploy step, before the running service is
replaced. That is the difference between a failed preflight and a restart loop with no
service behind it.

```text
ttnn-visualizer 0.102.0 startup requirements
Posture: hosted (SERVER_MODE enabled)

  ❌ hosted-secret-key: SERVER_MODE requires SECRET_KEY to contain at least 8 bytes and not use the development default
      Set: SECRET_KEY
      Set SECRET_KEY to a stable random value, the same one on every worker: python3 -c 'import secrets; print(secrets.token_urlsafe(48))'

❌ 1 unmet requirement(s). This release will NOT start in this environment.
```

Satisfied requirements are printed too, so the output is evidence of what was checked
rather than only of what broke.

## Current requirements

| Requirement | Environment variables | Condition | Introduced in | Enforced from | Posture |
|---|---|---|---|---|---|
| `hosted-secret-key` | `SECRET_KEY` | Under SERVER_MODE, SECRET_KEY must be non-default and at least 8 bytes. | 0.102.0 | 0.102.0 | Hosted |

The byte floor is a floor against an obviously-short key, not a strength check — it
counts UTF-8 bytes rather than entropy. Supply a long random value regardless of the
number. What makes the signed session cookie an integrity boundary across workers and
restarts is that the key is *stable and non-default*.

## How a new requirement is introduced

A requirement's **Enforced from** release is the one it becomes fatal in. Before that
release, an environment that does not satisfy it still starts and logs a warning on
every boot:

```text
Startup requirement 'example' is not satisfied: ... This becomes a startup failure in
0.105.0. Set EXAMPLE to ...
```

That gap is deliberate. A value like `SECRET_KEY` is provisioned outside this
repository, often by a different team, so a requirement that is fatal the moment it
ships is not satisfiable at upgrade time — the operator finds out when the service
stops. `--check-config` reports staged requirements as warnings and still exits `0`, so
you can find them on the release before they matter.

Maintainers: the rollout convention, and why the repository's test suite cannot catch
this class of change on its own, are in
[CONVENTIONS.md](https://github.com/tenstorrent/ttnn-visualizer/blob/dev/CONVENTIONS.md#startup-requirements).

## If startup already failed

A refused start prints every unmet requirement and exits; under gunicorn each worker
raises at import and the arbiter reports `Worker failed to boot.` Run
`ttnn-visualizer --check-config` in the same environment to see which condition is
unmet without waiting on a restart loop.

Settings that cannot be *parsed* — a `SERVER_MODE` that is not a recognised boolean, a
`MAX_CONTENT_LENGTH` that is not a byte count — fail earlier than these checks, with
their own message on stderr. `--check-config` still exits non-zero for them, so a deploy
gate reading the exit code needs no special case.
