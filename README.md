# MCPBro

MCPBro is an AI agent application leveraging the Model Context Protocol (MCP) to interact with various data sources and provide intelligent responses.

## Features

- **AI-powered chat interface** built with Next.js
- **Model Context Protocol (MCP) integration** for file system, memory, and vector database access
- **Gemini AI integration** for natural language understanding and generation
- **Context-aware conversations** with history management and summarization
- **Modular configuration system** for easy customization and extension

## Getting Started

### Prerequisites

- Node.js (v18 or newer)
- npm or yarn
- Google Gemini API key

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/mcpbro.git
cd mcpbro
```

2. Install dependencies:
```bash
npm install
# or
yarn install
```

3. Create your configuration:
```bash
cp bot_config/config.json.sample bot_config/config.json
```

4. Edit `bot_config/config.json` to add your Gemini API key and adjust settings as needed.

5. Run the development server:
```bash
npm run dev
# or
yarn dev
```

6. Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.
```

## System Instructions

Custom system instructions can be provided in the following files:

- Main system instruction: `bot_config/system_instruction.md`
- Summarizer instruction: `bot_config/system-instruction-summarizer.md`

## Architecture

MCPBro follows a modular architecture:

- **UI Layer**: Next.js frontend with React components
- **Agent Layer**: Manages conversation state, history, and tool orchestration
- **LLM Layer**: Handles interaction with Gemini AI models
- **Tool Layer**: Integrates with MCP servers for accessing various data sources

## MCP Server Integration

MCPBro integrates with multiple MCP servers:

- **Filesystem**: Provides access to project files
- **Memory**: Enables persistent memory storage
- **ChromaDB**: Vector database for semantic search

## Development

### Linting

```bash
npm run lint
# or
yarn lint
```

### Building for Production

```bash
npm run build
# or
yarn build
```

## License

[MIT](LICENSE)

## Acknowledgments

- [Next.js](https://nextjs.org)
- [Model Context Protocol](https://modelcontextprotocol.github.io/)
- [Google Generative AI](https://ai.google.dev/)
