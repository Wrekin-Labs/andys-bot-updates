from __future__ import annotations

import asyncio
import json
from typing import Any
from urllib.parse import urlparse

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def validate_local_endpoint(endpoint: str) -> str:
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Bridge endpoint must use HTTP or HTTPS")
    if parsed.hostname not in _LOOPBACK_HOSTS:
        raise PermissionError("Project Relay bridge endpoints must be loopback-only")
    if not parsed.path:
        raise ValueError("Bridge endpoint must include an MCP path")
    return endpoint


async def _list_tools(endpoint: str) -> list[dict[str, Any]]:
    validate_local_endpoint(endpoint)
    async with streamable_http_client(endpoint) as streams:
        read, write = streams
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            result = await session.list_tools()
            return [
                {
                    "name": tool.name,
                    "description": tool.description or "",
                    "input_schema": tool.input_schema,
                    "server": init.server_info.name,
                }
                for tool in result.tools
            ]


async def _call_tool(endpoint: str, name: str, args: dict[str, Any]) -> Any:
    validate_local_endpoint(endpoint)
    async with streamable_http_client(endpoint) as streams:
        read, write = streams
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(name, args)
            if result.is_error:
                text = " ".join(
                    getattr(block, "text", "")
                    for block in result.content
                    if getattr(block, "type", None) == "text"
                ).strip()
                raise RuntimeError(text or f"Bridge tool failed: {name}")
            if result.structured_content is not None:
                return result.structured_content
            texts = [
                block.text
                for block in result.content
                if getattr(block, "type", None) == "text"
            ]
            if len(texts) == 1:
                try:
                    return json.loads(texts[0])
                except Exception:
                    return {"text": texts[0]}
            return {"content": texts}


def list_tools(endpoint: str) -> list[dict[str, Any]]:
    return asyncio.run(_list_tools(endpoint))


def call_tool(endpoint: str, name: str, args: dict[str, Any] | None = None) -> Any:
    return asyncio.run(_call_tool(endpoint, name, args or {}))
