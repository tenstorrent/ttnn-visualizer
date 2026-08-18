# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""CORS defaults are a trust boundary: local-only endpoints publish SSH host, user and
path metadata, and the app has no authentication, so every extra allowed origin is
another local page that can read them.

The environment-override tests guard a second failure of the same kind: ``SERVER_MODE``
switches between the local and hosted postures, so a config layer that hands back the
truthy string ``"false"`` inverts a security setting.
"""

import ast
import logging
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
from ttnn_visualizer.settings import (
    _ENV_ALIASES,
    _ENV_OVERRIDE_CONSTANTS,
    _ENV_OVERRIDE_DERIVED,
    _ENV_OVERRIDE_SKIP,
    _ENV_OVERRIDE_UNCONFIGURED,
    _ENV_PARSERS,
    _RECOMPUTE_HONOURS,
    _STRICT_BOOLEANS,
    DefaultConfig,
    DevelopmentConfig,
    ProductionConfig,
    _build_allowed_origins,
    _coerce_env_value,
    _parse_env_bool,
    _parse_max_content_length,
    build_socketio_origin_check,
)
from ttnn_visualizer.tests.fixture_settings import (
    PINNED_ENV_SETTINGS,
    pinned_settings_sample,
)
from ttnn_visualizer.utils import (
    FALSE_VALUES,
    TRUE_VALUES,
    get_app_data_directory,
    get_report_data_directory,
    parse_bool,
)

DEV_ARGS = {
    "app_port": "8000",
    "dev_server_host": "localhost",
    "dev_server_port": "5173",
}


def wsgi_environ(host: str, scheme: str = "http", **headers: str) -> dict:
    return {"wsgi.url_scheme": scheme, "HTTP_HOST": host, **headers}


def _import_settings_with(
    code: str = "import ttnn_visualizer.settings", **env: str
) -> subprocess.CompletedProcess:
    """Import ``settings`` in a fresh interpreter under the given environment.

    The class body runs once per process and this one imported the module before the
    first test, so an import-time decision can only be exercised from outside it.
    ``load_dotenv`` reads the repo's ``.env`` on import, so the variables under test are
    also cleared from what the child inherits — otherwise a developer checkout that
    configures one would decide the result.
    """
    child_env = {key: value for key, value in os.environ.items() if key not in env}

    return subprocess.run(
        [sys.executable, "-c", code],
        env={**child_env, **env},
        capture_output=True,
        text=True,
    )


def test_defaults_add_the_vite_dev_server_outside_production():
    assert _build_allowed_origins(None, flask_env="development", **DEV_ARGS) == [
        "http://localhost:8000",
        "http://localhost:5173",
    ]


def test_defaults_omit_the_vite_dev_server_in_production():
    assert _build_allowed_origins(None, flask_env="production", **DEV_ARGS) == [
        "http://localhost:8000"
    ]

    assert _build_allowed_origins(None, flask_env="PRODUCTION", **DEV_ARGS) == [
        "http://localhost:8000"
    ]


def test_defaults_follow_the_configured_app_port():
    origins = _build_allowed_origins(
        None,
        app_port="9001",
        dev_server_host="localhost",
        dev_server_port="5173",
        flask_env="production",
    )

    assert origins == ["http://localhost:9001"]


def test_configured_origins_replace_the_defaults():
    origins = _build_allowed_origins(
        "https://ttnn-visualizer.tenstorrent.com,https://other.example",
        flask_env="development",
        **DEV_ARGS,
    )

    assert origins == [
        "https://ttnn-visualizer.tenstorrent.com",
        "https://other.example",
    ]


def test_configured_origins_tolerate_whitespace():
    origins = _build_allowed_origins(
        " https://a.example , https://b.example ,, ",
        flask_env="development",
        **DEV_ARGS,
    )

    assert origins == ["https://a.example", "https://b.example"]


def test_empty_configured_origins_trust_nothing():
    assert _build_allowed_origins("", flask_env="development", **DEV_ARGS) == []


def test_config_defaults_to_localhost_on_the_serving_port(monkeypatch):
    # ``_AllowedOrigins`` resolves on every read, so an operator's own variable reaches
    # this assertion about the *default*. Deleting it is enough here, and necessary:
    # there is no class attribute to pin, the descriptor is the value.
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)

    origins = DefaultConfig.ALLOWED_ORIGINS

    assert isinstance(origins, list)
    assert f"http://localhost:{DefaultConfig.PORT}" in origins


def test_config_narrows_to_production_set_after_import(monkeypatch):
    # ``main()`` defaults FLASK_ENV to production long after this module is imported,
    # so an allowlist frozen at import time would keep trusting the Vite dev server.
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    monkeypatch.setenv("FLASK_ENV", "production")

    assert DefaultConfig.ALLOWED_ORIGINS == [f"http://localhost:{DefaultConfig.PORT}"]


def test_config_follows_a_port_applied_after_import(monkeypatch):
    # ``--port`` is applied by mutating the environment and the config object, both
    # after import; the allowlist has to name the port the app actually serves on.
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.setenv("PORT", "9123")

    class PortOverride(DefaultConfig):
        PORT = "9123"

    assert PortOverride.ALLOWED_ORIGINS == ["http://localhost:9123"]


def test_config_honours_configured_origins(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://ttnn-visualizer.tenstorrent.com")

    assert DefaultConfig.ALLOWED_ORIGINS == ["https://ttnn-visualizer.tenstorrent.com"]


def test_env_override_leaves_the_allowlist_parsed(monkeypatch):
    # The path the hosted deployment actually takes: ``Config()`` runs this on an instance and
    # ``app.config.from_object`` then reads it. ``ALLOWED_ORIGINS`` is a non-data descriptor, so
    # copying the raw environment string onto the instance would shadow it and hand flask_cors a
    # single comma-joined origin that can never match. Every assertion above reads the class
    # instead, where no instance attribute exists to do the shadowing.
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.example,https://b.example")

    config = DefaultConfig()
    config.override_with_env_variables()

    assert config.ALLOWED_ORIGINS == ["https://a.example", "https://b.example"]
    assert config.to_dict()["ALLOWED_ORIGINS"] == [
        "https://a.example",
        "https://b.example",
    ]


def test_env_override_still_applies_to_plain_values(monkeypatch):
    # The descriptor skip is keyed on ``__get__``, so it must not quietly widen into
    # "stop overriding config" for ordinary string values.
    monkeypatch.setenv("BASE_PATH", "/visualizer/")

    config = DefaultConfig()
    config.override_with_env_variables()

    assert config.BASE_PATH == "/visualizer/"


# ``is`` rather than truthiness throughout: the defect produced the string "false".
# Derived from the frozensets rather than written out, so a token added to ``parse_bool``
# is exercised here rather than at whichever setting first receives it. The trailing
# literals cover the normalisation, which isn't part of either set.
BOOLEAN_VOCABULARY_CASES = (
    [(token, True) for token in sorted(TRUE_VALUES)]
    + [(token, False) for token in sorted(FALSE_VALUES)]
    + [("TRUE", True), ("FALSE", False), (" true ", True), (" false ", False)]
)


@pytest.mark.parametrize("env_value, expected", BOOLEAN_VOCABULARY_CASES)
@pytest.mark.parametrize(
    "env_name, key",
    [
        ("SERVER_MODE", "SERVER_MODE"),
        ("LAUNCH_BROWSER_ON_START", "LAUNCH_BROWSER_ON_START"),
        ("USE_WEBSOCKETS", "USE_WEBSOCKETS"),
        # Aliased, so the pair differs — see ``_ENV_ALIASES``.
        ("FLASK_DEBUG", "DEBUG"),
    ],
)
def test_env_override_parses_booleans(env_name, key, env_value, expected, monkeypatch):
    # An exported ``SERVER_MODE`` would refuse the ``FLASK_DEBUG`` cases outright. Both
    # layers, and before the parametrised ``setenv`` so the ``SERVER_MODE`` case still
    # sets its own value and wins.
    monkeypatch.delenv("SERVER_MODE", raising=False)
    monkeypatch.setattr(DefaultConfig, "SERVER_MODE", False)
    monkeypatch.setenv(env_name, env_value)

    config = DefaultConfig()
    config.override_with_env_variables()

    assert getattr(config, key) is expected


def test_production_testing_is_not_enabled_by_the_string_false(monkeypatch):
    # ``TESTING`` and ``DEBUG`` are the sole settings a concrete config class declares,
    # so this is where the truthy-``"false"`` defect manifested on the shipped path.
    # ``ProductionConfig`` directly, as ``Config()``'s singleton leaks between tests.
    monkeypatch.setenv("TESTING", "false")

    config = ProductionConfig()
    config.override_with_env_variables()

    assert config.TESTING is False


def test_the_logging_debug_variable_does_not_enable_flask_debug(monkeypatch):
    # ``DEBUG=true`` is what ``pnpm flask:start-debug`` sets to raise the log level.
    # Matching it to the ``DEBUG`` *attribute* would hand Flask debug mode to anyone
    # who wanted verbose logs, and ``Flask.debug`` returning truthy suppresses the
    # catch-all error handler — tracebacks in responses, under SERVER_MODE too.
    # ``ProductionConfig`` declares ``DEBUG = False`` in its own body, so an exported
    # ``FLASK_DEBUG`` can only arrive through the override loop's alias — deleting the
    # variable is the whole fix, and no ``setattr`` is needed.
    monkeypatch.delenv("FLASK_DEBUG", raising=False)
    monkeypatch.setenv("DEBUG", "true")

    config = ProductionConfig()
    config.override_with_env_variables()

    assert config.DEBUG is False


def test_flask_debug_applies_after_the_class_body_has_been_evaluated(monkeypatch):
    # The other half of the alias: the class body reads ``FLASK_DEBUG`` at import, so
    # the override loop is the only chance for a value that arrives later — a ``.env``
    # ``create_app()`` loads, say — to reach the attribute it feeds. The posture is
    # pinned because the hosted one refuses debug mode outright; this is the local case
    # debug mode exists for, and a developer ``.env`` must not decide which is tested.
    # ``setattr`` alone is not a pin: the override loop re-reads the variable, so an
    # exported ``SERVER_MODE`` would decide which posture is tested after all.
    monkeypatch.delenv("SERVER_MODE", raising=False)
    monkeypatch.setattr(DefaultConfig, "SERVER_MODE", False)
    monkeypatch.setenv("FLASK_DEBUG", "true")

    config = ProductionConfig()
    config.override_with_env_variables()

    assert config.DEBUG is True


ENV_SAMPLE_PATH = Path(__file__).parents[3] / ".env.sample"
COMMENTED_SETTING_PATTERN = re.compile(r"^#\s*([A-Z][A-Z0-9_]*)=(.*)$")


_ATTRIBUTE_BY_ENV_NAME = {env_name: key for key, env_name in _ENV_ALIASES.items()}


def _documented_boolean_defaults():
    """``# KEY=value`` lines in ``.env.sample`` feeding a boolean config attribute.

    Yields ``(env_name, attribute, value)`` triples, since the two names need not
    match: ``FLASK_DEBUG`` is what feeds ``DEBUG``, so the file's bare ``DEBUG`` line
    is the log-level knob and no config attribute's variable at all.
    """
    if not ENV_SAMPLE_PATH.exists():
        pytest.skip(f"{ENV_SAMPLE_PATH.name} is not part of the installed package")

    documented = []

    for line in ENV_SAMPLE_PATH.read_text(encoding="utf-8").splitlines():
        match = COMMENTED_SETTING_PATTERN.match(line.strip())
        if not match:
            continue

        env_name, documented_value = match.group(1), match.group(2).strip()
        if env_name in _ENV_ALIASES:
            continue

        attribute = _ATTRIBUTE_BY_ENV_NAME.get(env_name, env_name)
        if isinstance(getattr(DefaultConfig, attribute, None), bool):
            documented.append((env_name, attribute, documented_value))

    # Guards against the parser silently matching nothing if the file's format changes.
    assert documented

    return documented


def test_the_documented_defaults_match_the_code_defaults():
    # Each setting is listed commented out at its default, so uncommenting a line
    # should be a no-op — which only holds while the documented value still names the
    # coded default. Keys the environment already sets are skipped: ``load_dotenv()``
    # folds a developer ``.env`` into the class body at import, so asserting on them
    # would pass in CI and fail on a checkout that configures them.
    for env_name, attribute, documented_value in _documented_boolean_defaults():
        if env_name in os.environ:
            continue

        assert getattr(DefaultConfig, attribute) is parse_bool(
            documented_value
        ), env_name


def test_the_documented_defaults_survive_being_set_explicitly(monkeypatch):
    # The other half: uncommenting the line must not invert the setting on the way
    # through the override. Uncommenting ``SERVER_MODE=false`` used to enable server
    # mode. Expected values come from the documented string rather than the class
    # attribute, which the test above is what pins to the sample file.
    documented = _documented_boolean_defaults()

    for env_name, _, documented_value in documented:
        monkeypatch.setenv(env_name, documented_value)

    config = DefaultConfig()
    config.override_with_env_variables()

    for env_name, attribute, documented_value in documented:
        assert getattr(config, attribute) is parse_bool(documented_value), env_name


def test_env_override_parses_integers(monkeypatch):
    # ``SESSION_MAX_UPLOADED_REPORTS`` is a slice bound in ``decorators.py`` and
    # ``views.py``, where a string raises rather than merely misbehaving.
    monkeypatch.setenv("SESSION_MAX_UPLOADED_REPORTS", "5")
    monkeypatch.setenv("SSH_SUBPROCESS_TIMEOUT", "30")

    config = DefaultConfig()
    config.override_with_env_variables()

    assert config.SESSION_MAX_UPLOADED_REPORTS == 5
    assert config.SSH_SUBPROCESS_TIMEOUT == 30


@pytest.mark.parametrize("env_value", ["0", "-1", "-10"])
def test_a_session_cap_below_one_keeps_the_declared_default(
    env_value, monkeypatch, caplog
):
    # ``0`` is the dangerous one rather than the merely odd one: every call site spells the
    # bound ``lst[-cap:]``, and ``[-0:]`` returns the whole list, so accepting it would turn
    # the cap into no cap and let the signed session cookie grow without limit.
    monkeypatch.setenv("SESSION_MAX_UPLOADED_REPORTS", env_value)

    config = DefaultConfig()
    with caplog.at_level(logging.WARNING):
        config.override_with_env_variables()

    assert (
        config.SESSION_MAX_UPLOADED_REPORTS
        == DefaultConfig.SESSION_MAX_UPLOADED_REPORTS
    )
    assert "SESSION_MAX_UPLOADED_REPORTS" in caplog.text


def test_the_smallest_accepted_session_cap_is_one(monkeypatch):
    # The floor is a real cap, not a rejection of every small value.
    monkeypatch.setenv("SESSION_MAX_UPLOADED_REPORTS", "1")

    config = DefaultConfig()
    config.override_with_env_variables()

    assert config.SESSION_MAX_UPLOADED_REPORTS == 1


@pytest.mark.parametrize("env_value", ["0", "-1", "not-a-number"])
def test_importing_settings_substitutes_a_usable_session_cap(env_value):
    # The class body needs its own guard: the override loop keeps the *declared* value for
    # a bad variable, so a zero that reached the class body would be the value it kept.
    result = _import_settings_with(
        "import ttnn_visualizer.settings as s;"
        " print(s.DefaultConfig.SESSION_MAX_UPLOADED_REPORTS)",
        SESSION_MAX_UPLOADED_REPORTS=env_value,
    )

    assert result.returncode == 0, result.stderr
    assert int(result.stdout.strip()) >= 1


def test_the_session_cap_bounds_the_stored_list(monkeypatch):
    # The property the range check exists to protect, asserted against the slice idiom the
    # call sites in ``decorators.py`` and ``views.py`` all use. The cap is pinned rather
    # than taken as declared: the class attribute binds at import from the environment, and
    # an operator's large-but-valid value would leave this loop slicing for hours. Any cap
    # of one or more exercises the property.
    monkeypatch.setattr(DefaultConfig, "SESSION_MAX_UPLOADED_REPORTS", 3)
    cap = DefaultConfig.SESSION_MAX_UPLOADED_REPORTS
    stored: list = []

    for report in range(cap + 5):
        stored = (stored + [report])[-cap:]

    assert len(stored) == cap


def test_a_port_stays_a_string_so_gunicorn_can_take_it(monkeypatch):
    # Coercion follows the declared type, keeping these strings for gunicorn's argv.
    monkeypatch.setenv("PORT", "9123")
    monkeypatch.setenv("GUNICORN_WORKERS", "4")

    config = DefaultConfig()
    config.override_with_env_variables()

    assert config.PORT == "9123"
    assert config.GUNICORN_WORKERS == "4"


def test_an_uncoercible_integer_keeps_the_declared_default(monkeypatch, caplog):
    monkeypatch.setenv("SESSION_MAX_UPLOADED_REPORTS", "ten")

    config = DefaultConfig()
    with caplog.at_level(logging.WARNING):
        config.override_with_env_variables()

    assert (
        config.SESSION_MAX_UPLOADED_REPORTS
        == DefaultConfig.SESSION_MAX_UPLOADED_REPORTS
    )
    assert "SESSION_MAX_UPLOADED_REPORTS" in caplog.text


def test_an_empty_max_content_length_means_no_limit(monkeypatch):
    # The bare form ``.env.sample`` documents. Empty is not an integer, so the setting
    # needs its own parser: the ``int`` branch would warn and keep the existing limit,
    # the opposite of what the documented value asks for. The declared value is set
    # here so the assertion doesn't depend on a developer ``.env`` CI won't have.
    monkeypatch.setattr(DefaultConfig, "MAX_CONTENT_LENGTH", 1048576)
    monkeypatch.setenv("MAX_CONTENT_LENGTH", "")

    config = DefaultConfig()
    config.override_with_env_variables()

    assert config.MAX_CONTENT_LENGTH is None


def test_a_max_content_length_is_parsed_as_an_integer(monkeypatch):
    # Werkzeug compares the request's content length against this, so a string would
    # raise on any request with a body.
    monkeypatch.setattr(DefaultConfig, "MAX_CONTENT_LENGTH", None)
    monkeypatch.setenv("MAX_CONTENT_LENGTH", "1048576")

    config = DefaultConfig()
    config.override_with_env_variables()

    assert config.MAX_CONTENT_LENGTH == 1048576


@pytest.mark.parametrize("env_value", ["abc", "  ", "1.5", "10MB"])
def test_an_unreadable_max_content_length_names_itself(env_value):
    # The class body calls this unguarded, so a typo aborts startup — right, since the
    # value it would otherwise fall back to is *no limit*, but only useful if the
    # operator can tell which variable to fix from the traceback.
    with pytest.raises(ValueError, match="MAX_CONTENT_LENGTH"):
        _parse_max_content_length(env_value)


def test_an_overridden_ssh_port_is_applied(monkeypatch):
    monkeypatch.setenv("SSH_DEFAULT_PORT", "2222")

    config = DefaultConfig()
    config.override_with_env_variables()

    assert config.SSH_DEFAULT_PORT == 2222


@pytest.mark.parametrize("env_value", ["99999", "0", "-1", "not-a-port", ""])
def test_an_unusable_ssh_port_is_reported_and_discarded(env_value, monkeypatch, caplog):
    # Dispatching on ``int`` alone would accept 99999 and publish it to the browser
    # through ``_build_spa_client_config``. ``parse_tcp_port`` substitutes its default
    # instead, which is right in the class body but would make this the one setting an
    # override changes without saying so. The declared value is set here so the
    # assertion doesn't depend on a developer ``.env`` CI won't have.
    monkeypatch.setattr(DefaultConfig, "SSH_DEFAULT_PORT", 2222)
    monkeypatch.setenv("SSH_DEFAULT_PORT", env_value)

    config = DefaultConfig()
    with caplog.at_level(logging.WARNING):
        config.override_with_env_variables()

    assert config.SSH_DEFAULT_PORT == 2222
    assert "SSH_DEFAULT_PORT" in caplog.text


def test_an_uncoercible_max_content_length_keeps_the_declared_limit(
    monkeypatch, caplog
):
    # The upload size cap, and the only setting whose parser can raise — so this is the
    # sole cover for the ``_ENV_PARSERS`` failure branch. Silently reverting to a
    # declared ``None`` would mean no limit at all.
    monkeypatch.setattr(DefaultConfig, "MAX_CONTENT_LENGTH", 1048576)
    monkeypatch.setenv("MAX_CONTENT_LENGTH", "abc")

    config = DefaultConfig()
    with caplog.at_level(logging.WARNING):
        config.override_with_env_variables()

    assert config.MAX_CONTENT_LENGTH == 1048576
    assert "MAX_CONTENT_LENGTH" in caplog.text


def test_every_env_parser_names_a_real_setting():
    # Keyed by string, so a renamed or mistyped setting leaves a dead entry and falls
    # back to type dispatch — dropping the SSH range check, or inverting
    # ``MAX_CONTENT_LENGTH``'s empty-means-no-limit — with nothing else failing.
    assert set(_ENV_PARSERS) <= set(vars(DefaultConfig))


def test_every_registry_is_keyed_the_way_it_is_looked_up():
    # Attribute names, not variable names. An alias is the only case where the two
    # differ, so a registry keyed by the variable would pass the checks above while
    # never firing for the one setting that has one.
    aliased = set(_ENV_ALIASES.values())

    assert not set(_ENV_PARSERS) & aliased
    assert not _STRICT_BOOLEANS & aliased
    assert not _ENV_OVERRIDE_SKIP & aliased


def test_every_strict_boolean_names_a_real_boolean_setting():
    # A dead entry here downgrades a refusal to a warning, which for ``SERVER_MODE``
    # means booting into the local posture on a value nobody could read.
    for key in _STRICT_BOOLEANS:
        assert isinstance(getattr(DefaultConfig, key, None), bool), key


def test_every_env_alias_names_a_real_setting():
    # Same string-keyed hazard, with a worse failure: a dead alias sends the loop back
    # to the attribute name, which for ``DEBUG`` is the log-level variable.
    assert set(_ENV_ALIASES) <= set(vars(DefaultConfig))

    # An alias pointing at a name that is also an attribute would have the loop write
    # one setting from another's variable.
    assert not set(_ENV_ALIASES.values()) & set(vars(DefaultConfig))


def test_a_setting_with_no_coercible_type_is_reported_and_discarded(
    monkeypatch, caplog
):
    # ``_coerce_env_value`` declines a ``Path`` rather than handing handlers a string.
    # ``LOCAL_DATA_DIRECTORY`` is also in ``_ENV_OVERRIDE_SKIP``, so exercise the
    # backstop directly — the loop never reaches it.
    declared = Path("/declared")

    with caplog.at_level(logging.WARNING):
        result = _coerce_env_value("LOCAL_DATA_DIRECTORY", declared, "/from/env")

    assert result == declared
    assert "LOCAL_DATA_DIRECTORY" in caplog.text


# Every setting an environment variable is allowed to reach. Pinned rather than derived
# so that adding a setting is a decision: the skip list on its own only fails closed for
# a *dead* entry, and the type backstop in ``_coerce_env_value`` only catches ``Path`` /
# ``dict``, so a new derived string or constant that nobody classified would silently
# become configurable. Deleting a name from here without deleting the setting fails too,
# which is what the old ``_REQUIRED_ENV_OVERRIDE_SKIPS`` list existed to catch.
_OVERRIDABLE_SETTINGS = frozenset(
    {
        "BASE_PATH",
        "DEBUG",
        "DEV_SERVER_HOST",
        "DEV_SERVER_PORT",
        "GUNICORN_APP_MODULE",
        "GUNICORN_TIMEOUT",
        "GUNICORN_WORKERS",
        "GUNICORN_WORKER_CLASS",
        "HOST",
        "LAUNCH_BROWSER_ON_START",
        "MALWARE_SCANNER",
        "MAX_CONTENT_LENGTH",
        "PORT",
        "SECRET_KEY",
        "SERVER_MODE",
        "SESSION_MAX_UPLOADED_REPORTS",
        "SSH_DEFAULT_PERFORMANCE_PATH",
        "SSH_DEFAULT_PORT",
        "SSH_DEFAULT_PROFILER_PATH",
        "SSH_REMOTE_CHECK_TIMEOUT",
        "SSH_SUBPROCESS_TIMEOUT",
        "TESTING",
        "TT_METAL_HOME",
        "USE_WEBSOCKETS",
    }
)


def test_every_env_override_skip_names_a_real_setting():
    # Keyed by string, so a renamed setting leaves a dead skip entry and the loop
    # starts accepting env strings for a derived attribute again.
    assert _ENV_OVERRIDE_SKIP <= set(vars(DefaultConfig))


# Settings the test fixtures deliberately let the environment reach. Every name here was
# exported individually against the full suite and left it green; the ones that did not
# are pinned in ``PINNED_ENV_SETTINGS``, or neutralised on the test that constructs its
# own config (``FLASK_DEBUG`` and ``DEV_SERVER_HOST`` here, ``SERVER_MODE`` in three
# places). ``DEV_SERVER_HOST`` is listed here because no app under test depends on it —
# only the allowlist tests do.
#
# Two limitations worth knowing before trusting this test. First,
# ``override_with_env_variables`` skips anything with ``__get__``, so
# ``_OVERRIDABLE_SETTINGS`` excludes the descriptor-backed ``ALLOWED_ORIGINS`` and
# ``USAGE_RECORDING_ENABLED``; the former is pinned in the baseline anyway (see
# ``_UNPOLICEABLE_PINS``) and the latter is neutralised by the ``usage_directory`` fixture,
# but neither is reconciled here. Second, ``APP_DATA_DIRECTORY`` and
# ``REPORT_DATA_DIRECTORY`` are env-reachable through ``recompute_derived_settings`` while
# living in ``_ENV_OVERRIDE_SKIP``, so they too are pinned without being policed.
_INHERITED_BY_TEST_FIXTURES = frozenset(
    {
        "DEV_SERVER_HOST",
        "DEV_SERVER_PORT",
        "GUNICORN_APP_MODULE",
        "GUNICORN_TIMEOUT",
        "GUNICORN_WORKERS",
        "GUNICORN_WORKER_CLASS",
        "HOST",
        "LAUNCH_BROWSER_ON_START",
        "PORT",
        "SECRET_KEY",
        "SESSION_MAX_UPLOADED_REPORTS",
        "SSH_REMOTE_CHECK_TIMEOUT",
        "SSH_SUBPROCESS_TIMEOUT",
    }
)


def test_the_test_fixtures_pin_every_env_reachable_setting():
    # The fixture counterpart to ``test_the_settings_inventory_is_pinned``: a new
    # overridable setting has to be classified as pinned or inherited before it can reach
    # an app under test from whatever the developer happens to export. Enumerated rather
    # than derived — a computed complement would pass no matter what, which is the same
    # reason ``_OVERRIDABLE_SETTINGS`` is hand-maintained.
    assert _OVERRIDABLE_SETTINGS == PINNED_ENV_SETTINGS | _INHERITED_BY_TEST_FIXTURES
    assert not (PINNED_ENV_SETTINGS & _INHERITED_BY_TEST_FIXTURES)

    # Equality, not containment, and in both directions: a pin deleted from the baseline
    # fails, and so does one added to the baseline while still listed as inherited — which
    # containment alone would let through, leaving the inventory quietly lying. The
    # intersection drops the derived directory keys, which no variable reaches directly.
    assert PINNED_ENV_SETTINGS == set(pinned_settings_sample()) & _OVERRIDABLE_SETTINGS


def test_every_app_under_test_is_built_from_the_shared_baseline():
    # The other half of #1869: the inventory above stops a new *setting* escaping
    # classification, but nothing stopped a new *fixture* hand-rolling its own settings
    # dict and reintroducing the whole bug class with the suite green. Read at the source
    # level because the offending fixture would be correct Python that simply never calls
    # ``base_test_settings`` — there is no runtime hook to catch that.
    tests_root = Path(__file__).parent
    offenders = []

    for path in sorted(tests_root.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue

            for keyword in node.keywords:
                if keyword.arg != "settings_override":
                    continue

                called = {
                    inner.func.id
                    for inner in ast.walk(keyword.value)
                    if isinstance(inner, ast.Call) and isinstance(inner.func, ast.Name)
                }
                if "base_test_settings" not in called:
                    offenders.append(f"{path.relative_to(tests_root)}:{node.lineno}")

    assert offenders == [], (
        "these call sites build an app without the shared baseline, so the developer's "
        f"environment reaches it: {offenders}. Pass overrides to base_test_settings "
        "instead — see backend/ttnn_visualizer/tests/fixture_settings.py."
    )


def test_the_settings_inventory_is_pinned():
    # Forces a classification for every setting rather than only catching the entries
    # someone remembered to list. A new attribute lands in neither set and fails here,
    # which is the direction the skip list alone cannot see.
    declared = {
        key: value
        for key, value in vars(DefaultConfig).items()
        if not key.startswith("_") and not hasattr(value, "__get__")
    }

    assert set(declared) == _OVERRIDABLE_SETTINGS | _ENV_OVERRIDE_SKIP
    assert not (_OVERRIDABLE_SETTINGS & _ENV_OVERRIDE_SKIP)


def test_the_three_skip_rationales_stay_disjoint():
    # Unioned at the point of use, so an entry listed twice would still work and hide
    # which rule a maintainer is editing under.
    assert not (_ENV_OVERRIDE_DERIVED & _ENV_OVERRIDE_CONSTANTS)
    assert not (_ENV_OVERRIDE_DERIVED & _ENV_OVERRIDE_UNCONFIGURED)
    assert not (_ENV_OVERRIDE_CONSTANTS & _ENV_OVERRIDE_UNCONFIGURED)
    assert _RECOMPUTE_HONOURS <= _ENV_OVERRIDE_DERIVED


def test_an_inherited_setting_is_reachable_on_a_subclass(monkeypatch):
    # ``Config()`` always returns a subclass; ``DefaultConfig()`` tests mask the reach
    # bug because that class's own ``__dict__`` already holds every setting.
    monkeypatch.setenv("SERVER_MODE", "true")
    monkeypatch.setenv("HOST", "127.0.0.1")

    config = ProductionConfig()
    config.override_with_env_variables()

    assert config.SERVER_MODE is True
    assert config.HOST == "127.0.0.1"


def test_a_skipped_setting_is_not_overridden(monkeypatch):
    # Only settings the loop is the sole writer of prove anything here: ``GUNICORN_BIND``
    # and the path tree are rewritten by ``recompute_derived_settings`` afterwards, and
    # ``LOCAL_``/``REMOTE_DATA_DIRECTORY`` are ``Path``-typed, so the type backstop would
    # decline them with or without the skip.
    monkeypatch.setenv("APPLICATION_DIR", "/from/env")
    monkeypatch.setenv("STATIC_ASSETS_DIR", "/from/env/static")
    monkeypatch.setenv("DB_VERSION", "0.0.0")
    monkeypatch.setenv("SQLITE_DB_PATH", "evil.sqlite")
    monkeypatch.setenv("SESSION_COOKIE_SAMESITE", "None")

    config = ProductionConfig()
    declared_app_dir = config.APPLICATION_DIR
    declared_static = config.STATIC_ASSETS_DIR
    config.override_with_env_variables()

    assert config.APPLICATION_DIR == declared_app_dir
    assert config.STATIC_ASSETS_DIR == declared_static
    assert config.DB_VERSION == DefaultConfig.DB_VERSION
    assert config.SQLITE_DB_PATH == DefaultConfig.SQLITE_DB_PATH
    assert config.SESSION_COOKIE_SAMESITE == "Lax"


def test_an_ignored_variable_says_so(monkeypatch, caplog):
    # Declining an uncoercible value warns, so dropping a skipped one in silence is the
    # same outcome with no signal — and an inert variable looks exactly like a typo.
    monkeypatch.setenv("SQLALCHEMY_DATABASE_URI", "sqlite:////tmp/evil.db")

    with caplog.at_level(logging.WARNING, logger="ttnn_visualizer.settings"):
        ProductionConfig().override_with_env_variables()

    assert "SQLALCHEMY_DATABASE_URI" in caplog.text
    assert "not configurable" in caplog.text


def test_a_variable_the_recompute_honours_is_not_reported_as_ignored(
    monkeypatch, caplog
):
    # ``APP_DATA_DIRECTORY`` is skipped by the loop but applied by the recompute, so
    # warning about it would send an operator chasing a variable that works.
    monkeypatch.setenv("APP_DATA_DIRECTORY", "/tmp/late-app")

    with caplog.at_level(logging.WARNING, logger="ttnn_visualizer.settings"):
        config = ProductionConfig()
        config.override_with_env_variables()

    assert "APP_DATA_DIRECTORY" not in caplog.text
    assert config.APP_DATA_DIRECTORY == "/tmp/late-app"


def test_a_late_tt_metal_home_carries_the_whole_path_tree(monkeypatch, tmp_path):
    # The root the class body read and the one the override loop reads can differ —
    # this module's ``load_dotenv`` targets the working directory while ``create_app``'s
    # targets ``backend/.env``. Applying the root alone would serve reports from
    # ``$TT_METAL_HOME/generated`` while the database stayed on the import-time tree.
    monkeypatch.delenv("APP_DATA_DIRECTORY", raising=False)
    monkeypatch.delenv("REPORT_DATA_DIRECTORY", raising=False)
    monkeypatch.setenv("TT_METAL_HOME", str(tmp_path))

    config = ProductionConfig()
    config.override_with_env_variables()

    expected_app_data = get_app_data_directory(str(tmp_path), config.APPLICATION_DIR)
    expected_reports = get_report_data_directory(str(tmp_path), config.APPLICATION_DIR)

    assert config.TT_METAL_HOME == str(tmp_path)
    assert config.APP_DATA_DIRECTORY == expected_app_data
    assert config.REPORT_DATA_DIRECTORY == expected_reports
    assert config.LOCAL_DATA_DIRECTORY == Path(expected_reports).joinpath("local")
    assert config.REMOTE_DATA_DIRECTORY == Path(expected_reports).joinpath("remote")
    assert config.SQLALCHEMY_DATABASE_URI.endswith(
        f"{Path(expected_app_data) / f'ttnn_{config.DB_VERSION}.db'}"
    )


def test_an_explicit_report_directory_still_wins_over_the_derived_one(
    monkeypatch, tmp_path
):
    # Same precedence the class body gives it, and the children follow the winner
    # rather than the value ``TT_METAL_HOME`` would have produced.
    monkeypatch.setenv("TT_METAL_HOME", str(tmp_path))
    monkeypatch.setenv("REPORT_DATA_DIRECTORY", "/tmp/explicit-reports")

    config = ProductionConfig()
    config.override_with_env_variables()

    assert config.REPORT_DATA_DIRECTORY == "/tmp/explicit-reports"
    assert config.LOCAL_DATA_DIRECTORY == Path("/tmp/explicit-reports/local")
    assert config.REMOTE_DATA_DIRECTORY == Path("/tmp/explicit-reports/remote")


@pytest.mark.parametrize(
    "key, env_value",
    [("DEV_SERVER_HOST", "vite.internal"), ("DEV_SERVER_PORT", "4173")],
)
def test_a_documented_dev_server_setting_is_readable(key, env_value, monkeypatch):
    # ``.env.sample`` offers both, and they feed the dev CORS allowlist and ``main()``'s
    # browser-open target — an operator on a non-default Vite port would otherwise set
    # them and get silence.
    monkeypatch.setenv(key, env_value)

    config = DevelopmentConfig()
    config.override_with_env_variables()

    assert getattr(config, key) == env_value


def test_a_dev_server_override_reaches_the_allowlist(monkeypatch):
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    # Both layers, because either alone still reads the operator's value: the class body
    # bound it at import (so ``delenv`` cannot reach it) and the override loop re-applies
    # it from the environment (so ``setattr`` alone is overwritten).
    monkeypatch.delenv("DEV_SERVER_HOST", raising=False)
    monkeypatch.setattr(DefaultConfig, "DEV_SERVER_HOST", "localhost")
    monkeypatch.setenv("FLASK_ENV", "development")
    monkeypatch.setenv("DEV_SERVER_PORT", "4173")

    config = DevelopmentConfig()
    config.override_with_env_variables()

    assert "http://localhost:4173" in config.ALLOWED_ORIGINS


def test_gunicorn_bind_is_recomputed_from_host_and_port(monkeypatch):
    monkeypatch.setenv("HOST", "127.0.0.1")
    monkeypatch.setenv("PORT", "9001")

    config = DevelopmentConfig()
    config.override_with_env_variables()

    assert config.HOST == "127.0.0.1"
    assert config.PORT == "9001"
    assert config.GUNICORN_BIND == "127.0.0.1:9001"


def test_server_cli_flag_enables_server_mode_without_a_manual_patch(monkeypatch):
    # ``main()`` must not hand-patch ``SERVER_MODE`` / ``HOST``; the override loop is
    # the single mechanism. Reset the singleton so a prior ``Config()`` cannot poison
    # the assertion. Prefill env keys the SUT may write so monkeypatch restores them.
    from argparse import Namespace

    from ttnn_visualizer.app import _config_after_cli_env
    from ttnn_visualizer.settings import Config

    monkeypatch.setattr(Config, "_instance", None)
    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.setenv("SERVER_MODE", "false")
    monkeypatch.setenv("HOST", "localhost")
    monkeypatch.setenv("PORT", "8000")

    args = Namespace(host=None, server=True, port=None)
    config = _config_after_cli_env(args)

    assert config.SERVER_MODE is True
    assert config.HOST == "0.0.0.0"
    assert config.GUNICORN_BIND == "0.0.0.0:8000"


def test_an_explicit_host_does_not_suppress_server_mode(monkeypatch):
    # ``--server`` is documented as enabling server mode, and naming an interface still
    # binds a reachable socket. If ``--host`` won outright, ``--server --host <addr>``
    # would leave every ``@local_only`` endpoint open on it.
    from argparse import Namespace

    from ttnn_visualizer.app import _config_after_cli_env
    from ttnn_visualizer.settings import Config

    monkeypatch.setattr(Config, "_instance", None)
    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.setenv("SERVER_MODE", "false")
    monkeypatch.setenv("HOST", "localhost")
    monkeypatch.setenv("PORT", "8000")

    args = Namespace(host="192.0.2.10", server=True, port=None)
    config = _config_after_cli_env(args)

    assert config.SERVER_MODE is True
    assert config.HOST == "192.0.2.10"
    assert config.GUNICORN_BIND == "192.0.2.10:8000"


def test_the_cli_refuses_to_run_after_the_config_singleton_exists(monkeypatch):
    # The CLI writes environment variables and relies on ``Config()`` reading them, so
    # an instance built during import would make ``--server`` a silent no-op. Fail
    # loudly instead — that is the guarantee the removed hand-patches provided.
    from argparse import Namespace

    from ttnn_visualizer.app import _config_after_cli_env
    from ttnn_visualizer.settings import Config

    monkeypatch.setattr(Config, "_instance", ProductionConfig())

    with pytest.raises(AssertionError, match="constructed before"):
        _config_after_cli_env(Namespace(host=None, server=True, port=None))


def test_an_unrecognised_boolean_keeps_the_declared_default(monkeypatch, caplog):
    # A feature flag doesn't warrant refusing to boot, so the override path reports the
    # value and carries on — the counterpart to the strict path below.
    monkeypatch.setattr(DefaultConfig, "LAUNCH_BROWSER_ON_START", True)
    monkeypatch.setenv("LAUNCH_BROWSER_ON_START", "Ture")

    config = DefaultConfig()
    with caplog.at_level(logging.WARNING):
        config.override_with_env_variables()

    assert config.LAUNCH_BROWSER_ON_START is True
    assert "LAUNCH_BROWSER_ON_START" in caplog.text


def test_the_override_path_refuses_a_strict_boolean_it_cannot_read(monkeypatch):
    # Strictness belongs to the setting, not to the call site, so the loop has to refuse
    # what the class body would have. The value it would otherwise keep is not
    # necessarily one the strict parse already vetted: ``create_app`` calls
    # ``load_dotenv`` long after import, so a ``.env`` can introduce a spelling the
    # class body never saw — and falling back there means the local posture.
    monkeypatch.setattr(DefaultConfig, "SERVER_MODE", True)
    monkeypatch.setenv("SERVER_MODE", "Ture")

    config = DefaultConfig()
    with pytest.raises(ValueError, match="SERVER_MODE"):
        config.override_with_env_variables()


@pytest.mark.parametrize("env_value, expected", BOOLEAN_VOCABULARY_CASES)
def test_the_class_body_parses_a_recognised_boolean(env_value, expected, monkeypatch):
    # Import-time path; the override loop has its own cover via
    # ``test_env_override_parses_booleans`` and the inherited-reach case.
    monkeypatch.setenv("SERVER_MODE", env_value)

    assert _parse_env_bool("SERVER_MODE", False) is expected


@pytest.mark.parametrize("default", [True, False])
def test_an_unset_boolean_keeps_the_coded_default(default, monkeypatch):
    monkeypatch.delenv("SERVER_MODE", raising=False)

    assert _parse_env_bool("SERVER_MODE", default) is default


@pytest.mark.parametrize("env_value", ["Ture", "on", "yes", "t", "enabled", ""])
def test_a_strict_boolean_refuses_to_start_on_an_unrecognised_value(
    env_value, monkeypatch
):
    # ``SERVER_MODE`` is the one setting whose fallback is itself a posture: keeping the
    # default means *local*, which un-gates every ``@local_only`` endpoint. Failing to
    # start is the safe outcome, and unlike a warning it can't be missed — the warning
    # would be emitted before ``create_app`` configures logging.
    monkeypatch.setenv("SERVER_MODE", env_value)

    with pytest.raises(ValueError, match="SERVER_MODE"):
        _parse_env_bool("SERVER_MODE", False)


@pytest.mark.parametrize("env_value", ["Ture", "yes", ""])
def test_importing_settings_refuses_an_unreadable_server_mode(env_value):
    # Out of process because the class body is what applies strictness, and pytest has
    # already imported the module — so nothing in-process can exercise the line that
    # decides the posture. Without this, deleting ``SERVER_MODE`` from
    # ``_STRICT_BOOLEANS`` leaves the whole suite green.
    result = _import_settings_with(SERVER_MODE=env_value)

    assert result.returncode != 0
    assert "SERVER_MODE" in result.stderr


@pytest.mark.parametrize("env_value", sorted(TRUE_VALUES | FALSE_VALUES))
def test_importing_settings_accepts_the_documented_vocabulary(env_value):
    # The other half: strictness must refuse a typo without refusing a spelling
    # ``.env.sample`` tells operators to use.
    assert _import_settings_with(SERVER_MODE=env_value).returncode == 0


def test_server_mode_wins_over_flask_debug(monkeypatch, caplog):
    # ``Flask.debug`` is not merely verbosity: it suppresses the catch-all error handler
    # (tracebacks to untrusted callers) and, without websockets, mounts Werkzeug's
    # interactive console. The hosted posture must clear ``DEBUG`` even when
    # ``FLASK_DEBUG`` is set via the override loop.
    # Both layers, for the reason above — here an exported ``SERVER_MODE=false`` would
    # otherwise leave the hosted posture untested and the assertion inverted.
    monkeypatch.delenv("SERVER_MODE", raising=False)
    monkeypatch.setattr(DefaultConfig, "SERVER_MODE", True)
    monkeypatch.setenv("FLASK_DEBUG", "true")

    config = ProductionConfig()
    with caplog.at_level(logging.WARNING):
        config.override_with_env_variables()

    assert config.DEBUG is False
    assert "SERVER_MODE" in caplog.text


@pytest.mark.parametrize("env_value", ["Ture", "on", "yes", "t", "enabled"])
def test_a_non_strict_boolean_warns_and_keeps_its_default(
    env_value, monkeypatch, caplog
):
    # A feature flag doesn't warrant refusing to boot, so everything but ``SERVER_MODE``
    # reports and carries on.
    monkeypatch.setenv("LAUNCH_BROWSER_ON_START", env_value)

    with caplog.at_level(logging.WARNING):
        assert _parse_env_bool("LAUNCH_BROWSER_ON_START", True) is True

    assert "LAUNCH_BROWSER_ON_START" in caplog.text


def test_the_boolean_vocabulary_has_one_source():
    # A token in both halves would make ``parse_bool`` order-dependent, and the true
    # half silently wins — so the sets being disjoint is the property worth pinning.
    assert TRUE_VALUES.isdisjoint(FALSE_VALUES)
    assert all(parse_bool(token) is True for token in TRUE_VALUES)
    assert all(parse_bool(token) is False for token in FALSE_VALUES)


@pytest.mark.parametrize("key", ["MALWARE_SCANNER", "TT_METAL_HOME"])
def test_an_optional_string_setting_is_still_overridable(key, monkeypatch):
    # These declare ``None`` when unset, which offers no type to coerce towards. They
    # are optional strings, so the raw value is already what the class body would hold.
    monkeypatch.setattr(DefaultConfig, key, None)
    monkeypatch.setenv(key, "/some/value")

    config = DefaultConfig()
    config.override_with_env_variables()

    assert getattr(config, key) == "/some/value"


# engine.io rejects an unlisted Origin with a 400 rather than merely withholding CORS
# headers, so the socket check has to accept the app's own origin under every binding —
# the default allowlist only ever names localhost.
@pytest.mark.parametrize("host", ["localhost:8000", "0.0.0.0:8000", "127.0.0.1:8000"])
def test_socketio_accepts_the_origin_the_app_is_served_on(host):
    is_allowed = build_socketio_origin_check(["http://localhost:8000"])

    assert is_allowed(f"http://{host}", wsgi_environ(host))


def test_socketio_accepts_a_configured_cross_origin():
    is_allowed = build_socketio_origin_check(
        ["http://localhost:8000", "http://localhost:5173"]
    )

    assert is_allowed("http://localhost:5173", wsgi_environ("localhost:8000"))


def test_socketio_rejects_an_unrelated_origin():
    is_allowed = build_socketio_origin_check(["http://localhost:8000"])

    assert not is_allowed("http://evil.example", wsgi_environ("0.0.0.0:8000"))


def test_socketio_accepts_an_ipv6_loopback_binding():
    is_allowed = build_socketio_origin_check(["http://localhost:8000"])

    assert is_allowed("http://[::1]:8000", wsgi_environ("[::1]:8000"))


def test_socketio_accepts_the_host_it_was_launched_with():
    # ``--host name.example`` is the operator naming this machine, so serving the SPA
    # from it must work without also spelling the name out in ALLOWED_ORIGINS.
    is_allowed = build_socketio_origin_check([], bind_host="name.example")

    assert is_allowed("http://name.example:8000", wsgi_environ("name.example:8000"))


# Self-derivation only ever matches a same-origin request, and an IP literal can't be
# forged into one by DNS: a page whose origin is an address was served from it. So
# ``--server`` and containers stay reachable by address without configuration.
@pytest.mark.parametrize(
    "host", ["10.0.0.5:8000", "192.168.1.20:8000", "[fd00::1]:8000"]
)
def test_socketio_accepts_being_reached_by_address(host):
    is_allowed = build_socketio_origin_check(["http://localhost:8000"])

    assert is_allowed(f"http://{host}", wsgi_environ(host))


# The Host header is attacker-controlled, so a name that merely resolves here must not
# vouch for itself: a page on attacker.example that points the name at 127.0.0.1 would
# otherwise pass its own origin check and read instance-scoped socket traffic.
@pytest.mark.parametrize(
    "environ",
    [
        wsgi_environ("attacker.example"),
        # A proxy is not distinguishable from a forged header without a trust signal.
        wsgi_environ(
            "127.0.0.1:8000",
            HTTP_X_FORWARDED_PROTO="https",
            HTTP_X_FORWARDED_HOST="attacker.example",
        ),
    ],
    ids=["host", "forwarded-host"],
)
def test_socketio_refuses_to_derive_trust_from_an_unrecognised_name(environ):
    is_allowed = build_socketio_origin_check(["http://localhost:8000"])

    assert not is_allowed("http://attacker.example", environ)
    assert not is_allowed("https://attacker.example", environ)


def test_socketio_accepts_a_proxy_origin_once_it_is_configured():
    # Reaching the app under a name it was not launched with — a hosted deployment
    # behind TLS termination, a LAN or container address — is a configuration step.
    is_allowed = build_socketio_origin_check(["https://visualizer.example.com"])
    environ = wsgi_environ(
        "127.0.0.1:8000",
        HTTP_X_FORWARDED_PROTO="https",
        HTTP_X_FORWARDED_HOST="visualizer.example.com",
    )

    assert is_allowed("https://visualizer.example.com", environ)


def test_socketio_still_accepts_same_origin_when_nothing_is_configured():
    # An empty list means "skip the origin check entirely" to engine.io, so trusting
    # nothing must not be expressible as one — a callable is always consulted.
    is_allowed = build_socketio_origin_check([])

    assert is_allowed("http://0.0.0.0:8000", wsgi_environ("0.0.0.0:8000"))
    assert not is_allowed("http://evil.example", wsgi_environ("0.0.0.0:8000"))


# Unit-testing the builder alone leaves the wiring unpinned, and both halves fail open:
# ``SocketIO`` carried ``cors_allowed_origins="*"`` before this allowlist existed, and
# ``socketio.test_client`` never reaches engine.io's origin gate, so a revert to ``"*"``
# would pass every test above.
def test_socketio_is_wired_with_the_origin_check(app):
    from ttnn_visualizer.extensions import socketio

    # engine.io owns the origin gate; socketio.Server just forwards the option to it.
    origin_check = socketio.server.eio.cors_allowed_origins

    assert callable(origin_check)
    assert origin_check("http://localhost:8000", wsgi_environ("localhost:8000"))
    assert not origin_check("http://evil.example", wsgi_environ("localhost:8000"))


# The HTTP half of the same boundary: flask_cors withholds the header rather than
# refusing the request, so only the response headers show whether the allowlist arrived.
def test_cors_withholds_the_header_for_an_unlisted_origin(client):
    response = client.get("/api/up", headers={"Origin": "http://evil.example"})

    assert "Access-Control-Allow-Origin" not in response.headers


def test_cors_echoes_a_listed_origin(app, client):
    allowed_origin = app.config["ALLOWED_ORIGINS"][0]

    response = client.get("/api/up", headers={"Origin": allowed_origin})

    assert response.headers["Access-Control-Allow-Origin"] == allowed_origin
