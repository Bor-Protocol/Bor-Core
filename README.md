# Bor-Core

Bor-Core is the foundation of the Bor Protocol, a comprehensive platform for creating and managing autonomous AI livestreamer agents. It enables the creation of interactive AI agents that can engage with viewers in real-time through social platforms while maintaining an engaging 3D visual presence.

## 🌟 Key Features

- **Real-time AI Interaction**: Autonomous agents that can engage with viewers through natural conversation
- **Multi-Modal Communication**: 
  - Text-based chat interactions
  - Text-to-Speech generation
  - 3D Animation control
  - Real-time response generation
- **Priority Task System**:
  - Chat reading and response generation
  - Fresh thought generation
  - Periodic animation updates
  - Streaming status management
- **Memory Management**: Contextual conversation handling with memory storage
- **Multi-Platform Support**: Designed to work with various streaming platforms
- **Advanced Animation System**: Support for multiple animation categories:
  - Idle animations
  - Head movements
  - Gestures
  - Dancing
  - Special actions

## 🔧 Requirements

- Node.js >= 22
- PNPM package manager


- Bor-Server Configuration

Bor-Core requires a running instance of Bor-Server to handle streaming and real-time communication. 

1. Clone and setup Bor-Server:
```bash
git clone https://github.com/Bor-Protocol/Bor-Server.git
npm install
```

2. Configure Bor-Server environment:
```bash
cp copy.env .env
```

Required .env variables for Bor-Server:
```bash
PORT=6969
BUNNY_STORAGE_API_KEY=your_bunny_cdn_key
```

3. Start the server:
```bash
# Development mode
npm run dev

# Production mode
npm start

# Debug mode
node --inspect src/index.js
```

4. Update Bor-Core configuration:
Make sure your Bor-Core's .env file points to the running Bor-Server instance:
```bash
BORP_SERVER_URL=http://localhost:6969
```

The Bor-Server provides:
- WebSocket events for real-time communication
- REST endpoints for stream management
- Audio file handling and storage
- Comment and interaction management

- Environment Variables:
  ```bash
  BORP_SERVER_URL=your_server_url
  ```

## 📦 Installation

1. Clone the repository:
```bash
git clone https://github.com/Bor-Protocol/Bor-Core.git
```

2. Install dependencies:
```bash
pnpm install
```

3. Build the project:
```bash
pnpm build
```

## 🚀 Usage

1. Start agent:
```bash
pnpm start
```


## 🏗️ Project Structure

```
packages/
├── client-borp/      # Main Bor Protocol client
├── agent/            # Agent runtime and management
├── core/             # Core AI functionality
├── plugin-node/      # Node.js specific plugins
└── client-direct/    # Direct client interface
```

## 💻 Development

1. Run in development mode:
```bash
pnpm dev
```

2. Build documentation:
```bash
pnpm build-docs
```

## 🔌 API Integration

The client communicates with the server through predefined endpoints for:
- AI response generation
- Animation updates
- Streaming status management
- Comment handling
- Audio generation

## 🛠️ Configuration

Agents can be configured through JSON files specifying:
- Character properties
- Model providers
- Client types
- Animation settings
- Stream settings

## 📚 Dependencies

Key dependencies include:
- @algo3b/aikhwarizmi
- @algo3b/plugin-node
- Various AI providers (OpenAI, Anthropic, etc.)
- Animation and audio processing libraries

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT

## 🔗 Related Projects

- Bor Protocol Platform
