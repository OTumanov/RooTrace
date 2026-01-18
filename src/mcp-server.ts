import { RooTraceMCPHandler } from './mcp-handler';

// Create an instance of the RooTraceMCPHandler
const handler = new RooTraceMCPHandler();

// Start the MCP server
async function startServer() {
  try {
    await handler.start();
    console.error('RooTrace MCP Server started successfully');
    
    // Keep the process alive
  } catch (error) {
    console.error('Failed to start RooTrace MCP Server:', error);
    process.exit(1);
  }
}

// Handle process termination gracefully
process.on('SIGINT', async () => {
  console.error('Shutting down RooTrace MCP Server...');
  try {
    await handler.stop();
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('Shutting down RooTrace MCP Server...');
  try {
    await handler.stop();
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
});

// Start the server
startServer();

export { handler };