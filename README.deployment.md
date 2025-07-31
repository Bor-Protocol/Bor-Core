# Bor-Core Vercel Deployment

## Overview
Bor-Core is deployed as a traditional Node.js application on Vercel, maintaining all original functionality while adding HTTP endpoints for web access.

## What's Different
- **NO API separation** - Your original code structure is preserved
- **Web wrapper added** - `server.ts` provides HTTP endpoints
- **Original functionality intact** - All CLI features still work
- **Easy deployment** - Single command deployment

## Quick Deploy

```bash
cd Bor-Core
vercel
```

## Environment Variables Needed

Set these in Vercel Dashboard → Settings → Environment Variables:

```bash
# AI Model Configuration
OPENAI_API_KEY=sk-your-openai-key
GEMINI_API_KEY=AIza-your-gemini-key
MODEL_NAME=openai

# Database (choose one)
POSTGRES_URL=postgresql://user:pass@host:5432/db
# OR for development
DATABASE_URL=sqlite://./db.sqlite

# Agent Configuration
AGENT_NAME=AI Khwarizmi
AGENT_BIO=Your AI agent description

# Optional
NODE_ENV=production
```

## Available Endpoints

After deployment:

- `GET /health` - Check if agent is running
- `GET /agent` - Get agent information  
- `POST /chat` - Chat with your AI agent

## Example Usage

```javascript
// Test the agent
const response = await fetch('https://your-app.vercel.app/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: "Hello!",
    userId: "test-user"
  })
});

const data = await response.json();
console.log(data.response); // AI response
```

## What Happens During Deployment

1. **Monorepo Build** - pnpm builds all workspace packages
2. **Agent Initialization** - Your AI agent starts automatically
3. **Web Server** - Express server wraps your agent with HTTP endpoints
4. **Original Features** - All CLI functionality remains available

## Benefits of This Approach

✅ **Preserve Original Code** - No refactoring needed
✅ **Add Web Access** - HTTP endpoints for integration
✅ **Easy Maintenance** - Single codebase, dual functionality  
✅ **Full Features** - All your AI agent capabilities available
✅ **Simple Deployment** - One command to deploy

## Troubleshooting

### Build Issues
- Check all workspace dependencies are properly installed
- Ensure TypeScript compilation succeeds locally first

### Runtime Issues  
- Check environment variables are set correctly
- Verify database connection (if using external DB)
- Check function logs in Vercel dashboard

### Memory Issues
- Vercel functions have memory limits
- Consider using Vercel Pro for larger memory allocation

This approach gives you the best of both worlds - your original AI agent functionality plus web accessibility!