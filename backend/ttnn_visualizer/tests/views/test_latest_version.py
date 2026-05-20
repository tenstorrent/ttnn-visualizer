# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for the /api/latest-version endpoint.

Tests both success and failure cases for fetching the latest version from PyPI.
"""

from http import HTTPStatus
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def mock_pypi_response():
    """Fixture providing a mock PyPI RSS response with a version."""
    xml_content = """<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
        <channel>
            <title>PyPI Latest Releases</title>
            <item>
                <title>3.14.15</title>
                <description>Latest stable release</description>
            </item>
            <item>
                <title>3.14.14</title>
                <description>Previous release</description>
            </item>
        </channel>
    </rss>
    """
    return xml_content.encode("utf-8")


class TestLatestVersionSuccess:
    """Tests for successful version retrieval."""

    def test_returns_the_latest_version(self, client):
        """Test that the endpoint extracts the first (latest) version correctly."""
        xml_with_many_releases = """<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
            <channel>
                <item><title>01.0.0</title></item>
                <item><title>1.0.1</title></item>
                <item><title>2.0.0</title></item>
                <item><title>2.1.0</title></item>
            </channel>
        </rss>
        """.encode("utf-8")

        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_response = MagicMock()
            mock_response.read.return_value = xml_with_many_releases
            mock_response.__enter__.return_value = mock_response
            mock_response.__exit__.return_value = None
            mock_urlopen.return_value = mock_response

            response = client.get("/api/latest-version")

        assert response.status_code == HTTPStatus.OK
        data = response.get_json()
        # The first match in the XML is returned
        assert data == "01.0.0"


class TestLatestVersionFailures:
    """Tests for failure scenarios."""

    def test_returns_error_when_http_request_fails(self, client):
        """Test that the endpoint handles HTTP errors gracefully."""
        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_urlopen.side_effect = OSError("Network error")

            response = client.get("/api/latest-version")

        assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
        data = response.get_json()
        assert "error" in data
        assert data["error"] == "Failed to fetch releases"

    def test_returns_error_when_pypi_times_out(self, client):
        """Test that the endpoint handles timeout errors."""
        with patch("urllib.request.urlopen") as mock_urlopen:
            import socket

            mock_urlopen.side_effect = socket.timeout("Request timed out")

            response = client.get("/api/latest-version")

        assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
        data = response.get_json()
        assert data["error"] == "Failed to fetch releases"

    def test_returns_error_when_correlation_error_occurs(self, client):
        """Test handling of correlation errors (invalid host, DNS, etc)."""
        with patch("urllib.request.urlopen") as mock_urlopen:
            import urllib.error

            mock_urlopen.side_effect = urllib.error.URLError("Connection refused")

            response = client.get("/api/latest-version")

        assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
        data = response.get_json()
        assert data["error"] == "Failed to fetch releases"

    def test_returns_null_when_no_version_found_in_response(self, client):
        """Test that endpoint returns null when XML has no valid version."""
        xml_without_version = """<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
            <channel>
                <item><title>Release Notes</title></item>
                <item><title>Latest Update</title></item>
            </channel>
        </rss>
        """.encode("utf-8")

        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_response = MagicMock()
            mock_response.read.return_value = xml_without_version
            mock_response.__enter__.return_value = mock_response
            mock_response.__exit__.return_value = None
            mock_urlopen.return_value = mock_response

            response = client.get("/api/latest-version")

        assert response.status_code == HTTPStatus.OK
        data = response.get_json()
        assert data is None

    def test_returns_error_when_response_is_malformed(self, client):
        """Test handling of malformed XML response."""
        malformed_xml = b"Not XML at all, just garbage <title> data"

        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_response = MagicMock()
            mock_response.read.return_value = malformed_xml
            mock_response.__enter__.return_value = mock_response
            mock_response.__exit__.return_value = None
            mock_urlopen.return_value = mock_response

            response = client.get("/api/latest-version")

        # Should not crash, but regex will not find a version
        assert response.status_code == HTTPStatus.OK
        data = response.get_json()
        assert data is None

    def test_returns_error_when_response_is_empty(self, client):
        """Test handling of empty response from PyPI."""
        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_response = MagicMock()
            mock_response.read.return_value = b""
            mock_response.__enter__.return_value = mock_response
            mock_response.__exit__.return_value = None
            mock_urlopen.return_value = mock_response

            response = client.get("/api/latest-version")

        assert response.status_code == HTTPStatus.OK
        data = response.get_json()
        assert data is None


class TestLatestVersionEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_makes_correct_request_to_pypi(self, client):
        """Test that the endpoint makes the correct HTTP request to PyPI."""
        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_response = MagicMock()
            mock_response.read.return_value = b"<title>1.0.0</title>"
            mock_response.__enter__.return_value = mock_response
            mock_response.__exit__.return_value = None
            mock_urlopen.return_value = mock_response

            client.get("/api/latest-version")

        # Verify the request was made with correct parameters
        assert mock_urlopen.called
        call_args = mock_urlopen.call_args
        request_obj = call_args[0][0]  # First positional argument

        assert (
            request_obj.full_url
            == "https://pypi.org/rss/project/ttnn-visualizer/releases.xml"
        )
        assert request_obj.method == "GET"
        assert request_obj.headers.get("Content-type") == "application/xml"

    def test_request_includes_timeout(self, client):
        """Test that the request includes a timeout of 2 seconds."""
        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_response = MagicMock()
            mock_response.read.return_value = b"<title>1.0.0</title>"
            mock_response.__enter__.return_value = mock_response
            mock_response.__exit__.return_value = None
            mock_urlopen.return_value = mock_response

            client.get("/api/latest-version")

        # Verify timeout parameter
        call_kwargs = mock_urlopen.call_args[1]
        assert call_kwargs.get("timeout") == 2
