import asyncio
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

async def main():
    async with streamable_http_client("http://127.0.0.1:8788/mcp") as streams:
        read, write = streams
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            tools = await session.list_tools()
            result = await session.call_tool("list_devices", {})
            devices = (result.structured_content or {}).get("devices", [])
            kinds = sorted({d.get("kind", "") for d in devices})
            print(f"Server: {init.server_info.name} {init.server_info.version}")
            print(f"Protocol: {init.protocol_version}")
            print(f"Tools: {len(tools.tools)}")
            print(f"Devices: {len(devices)}")
            print(f"Kinds: {', '.join(kinds)}")
            if result.is_error:
                raise SystemExit("list_devices returned an MCP error")

if __name__ == "__main__":
    asyncio.run(main())
