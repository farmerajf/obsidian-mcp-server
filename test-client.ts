import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const API_KEY = "test-key";
const BASE_URL = `http://localhost:3000/${API_KEY}`;

async function main() {
  console.log("Connecting to MCP server...");

  const transport = new SSEClientTransport(new URL(`${BASE_URL}/sse`));
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("Connected!\n");

  // List available tools
  console.log("=== Available Tools ===");
  const tools = await client.listTools();
  for (const tool of tools.tools) {
    console.log(`- ${tool.name}: ${tool.description}`);
  }
  console.log();

  // Test list_directory
  console.log("=== Testing list_directory ===");
  const listResult = await client.callTool({
    name: "list_directory",
    arguments: { path: "remote-filesystem:/" },
  });
  console.log(JSON.parse((listResult.content[0] as { text: string }).text).slice(0, 5));
  console.log("... (showing first 5 entries)\n");

  // Test search
  console.log("=== Testing search ===");
  const searchResult = await client.callTool({
    name: "search",
    arguments: { query: "TODO", type: "content" },
  });
  const searchData = JSON.parse((searchResult.content[0] as { text: string }).text);
  console.log(`Found ${searchData.resultCount} results`);
  if (searchData.results.length > 0) {
    console.log("First result:", searchData.results[0].path);
  }
  console.log();

  await client.close();
  console.log("Done!");
}

main().catch(console.error);
