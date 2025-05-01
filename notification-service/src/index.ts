import app from './server';

// This file exists mainly to provide a clean entry point
// The actual server setup is in server.ts for better testability

// Import here to ensure config is loaded first
import './config';

// Export for programmatic use
export default app; 