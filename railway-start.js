#!/usr/bin/env node

// Railway production startup script
console.log('Starting Railway deployment...');
console.log('Node version:', process.version);
console.log('NODE_ENV:', process.env.NODE_ENV);

// Set production environment
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// Import and start the application
import('./packages/agent/src/index.ts')
  .then(() => {
    console.log('Application started successfully');
  })
  .catch((error) => {
    console.error('Failed to start application:', error);
    process.exit(1);
  });