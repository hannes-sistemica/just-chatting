# Just Chatting - Round Table for AI Agents

A lightweight web interface for hosting conversations between multiple AI personas using your local LLM setup. This project was inspired by [coreOllama](https://github.com/chanulee/coreOllama) but evolved to focus on multi-agent interactions.

## Features

### Persona Management
- Create and customize AI personas with different:
  - Models
  - Temperature settings
  - System prompts
- Select multiple personas for group conversations
- Auto-continue mode for autonomous agent discussions

### Chat Interface
- Clean, modern UI with dark mode support
- Markdown rendering for formatted responses
- Image input support for vision models
- Conversation history with auto-generated titles
- Export conversations as JSON

### Technical Features
- Fully client-side - all data stored in browser localStorage
- No backend required beyond Ollama
- Support for all Ollama models including vision models
- Real-time server status monitoring

## Quick Start

### Prerequisites
1. Install [Ollama](https://ollama.ai)
2. Pull your desired models through Ollama
3. Start the Ollama server:
```bash
ollama serve
```

### Running Locally
1. Clone this repository
2. Open `web/chat/index.html` directly in your browser
3. Create some personas and start chatting!

### Running with Docker
For a more production-ready setup, use the included Docker configuration:

```bash
docker-compose up -d
```

This will:
- Start an Nginx server on port 8080
- Serve the web interface with proper caching headers
- Auto-restart unless explicitly stopped

Access the interface at `http://localhost:8080`

## Usage Tips

### Creating Personas
1. Click the brain icon (🧠) to open the persona sidebar
2. Create new personas with different models/settings
3. Select multiple personas to include in conversations
4. Use auto-continue (▶️) for autonomous discussions

### Managing Conversations
- Start new chats with the + button
- Export conversations before deleting
- Adjust backend URL in settings if needed
- Monitor server status in the header

## Development

The project uses vanilla JavaScript and CSS with no build process required. All state is managed through localStorage, making it easy to hack on and extend.

Feel free to fork and customize for your specific use case!
