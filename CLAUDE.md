# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an AI-Powered Browser-Based Code Editor with Senior Engineer AI capabilities. It's a sophisticated single-page application that integrates multiple LLM providers (Google Gemini, OpenAI GPT, Ollama) with advanced coding assistance features.

## Core Architecture

The project follows a **client-centric design** where most logic runs in the browser:

- **Frontend** (`frontend/`): Vanilla JavaScript application using Monaco Editor
- **Backend** (`backend/`): Minimal Express.js server for serving static files and URL fetching
- **File Operations**: Uses browser's File System Access API (no server-side file handling)
- **AI System**: Multi-provider tool-calling system managed entirely client-side

## Development Commands

### Backend
```bash
cd backend
npm start              # Start the Express server (port 3333)
npm run format         # Format code with Prettier
npm install            # Install backend dependencies
```

### Frontend  
```bash
cd frontend
npm run format         # Format JS/HTML/CSS/JSON files with Prettier
npm install            # Install frontend dependencies
```

### Root Level
```bash
npm start              # Start server via PM2
npm stop               # Stop PM2 server
npm restart            # Restart PM2 server
npm delete             # Delete PM2 process
npm install            # Install root dependencies (jest, etc.)
```

### Application Management
Use the interactive scripts for full setup and management:
- **Windows**: Run `app.bat`
- **macOS/Linux**: Run `./app.sh` (after `chmod +x ./app.sh`)

The scripts handle dependency installation, server management, and PM2 process control.

### Testing
No formal test framework is currently configured. The project uses manual testing via the browser interface.

## Key Components

### Tool Execution System
The heart of the AI functionality is in `frontend/js/tool_executor.js`, which:
- Implements 40+ specialized tools for file operations, code analysis, and AI assistance
- Manages performance tracking and optimization
- Handles Senior Engineer AI capabilities (symbol resolution, data flow analysis, debugging)
- Provides smart tool selection based on context

### LLM Services
Located in `frontend/js/llm/`:
- `service_factory.js` - Creates appropriate LLM service instances
- `gemini_service.js`, `openai_service.js`, `ollama_service.js` - Provider implementations
- `chat_service.js` - Orchestrates all provider interactions

### Core Modules
- `main.js` - Application initialization and state management
- `editor.js` - Monaco Editor integration and file management
- `file_system.js` - Browser File System Access API handling
- `ui.js` - Resizable panels and interface management
- `task_manager.js` - Task execution and workflow management

### Backend Services
- `backend/index.js` - Express server with endpoints for:
  - `/api/read-url` - Fetch external URLs (bypasses CORS)
  - `/api/duckduckgo-search` - Web search functionality
  - `/api/build-codebase-index` - Code indexing for semantic search
  - `/api/query-codebase` - Query the indexed codebase
  - `/api/execute-tool` - Terminal command execution
  - `/api/format-code` - Code formatting via Prettier
- `backend/codebase_indexer.js` - Extracts symbols from code files for indexing

## Senior Engineer AI Features

The application includes advanced AI capabilities:
- **Symbol Resolution**: Build comprehensive symbol tables
- **Data Flow Analysis**: Trace variable flow and dependencies  
- **Systematic Debugging**: Hypothesis-driven debugging approach
- **Code Quality Analysis**: Comprehensive metrics and smell detection
- **Architecture Optimization**: Pattern recognition and optimization suggestions

These are implemented across multiple specialized modules in the `frontend/js/` directory.

## Development Workflow

### Local Development
1. Install dependencies: `npm install` (root), `cd frontend && npm install`, `cd backend && npm install`
2. Start the server: `npm start` or use `./app.sh` / `app.bat`
3. Access at `http://localhost:3333`
4. Changes to frontend JS/HTML/CSS are reflected immediately (no build step)
5. Backend changes require server restart

### Code Formatting
- Use `npm run format` in respective directories
- Prettier is configured for consistent code style
- No linting is currently configured

### Performance Monitoring
- Built-in performance profiler in `frontend/js/core/performance_profiler.js`
- Tool execution metrics tracked automatically
- Browser DevTools recommended for debugging

## Architecture Notes

- **No Build System**: Uses vanilla JavaScript ES6 modules directly
- **Client-Side State**: All state persisted in IndexedDB (no server-side sessions)
- **Security**: File System Access API provides sandboxed file operations
- **Scalability**: Designed for local development environments
- **Dependencies**: Minimal external dependencies, self-contained libraries in `frontend/js/lib/`

## File Structure

```
backend/
├── index.js                # Express server (port 3333)
├── codebase_indexer.js     # Code symbol extraction
└── package.json            # Backend dependencies

frontend/
├── index.html              # Main application entry
├── style.css               # Global styles
├── js/
│   ├── llm/               # LLM provider services
│   ├── lib/               # Third-party libraries (diff_match_patch)
│   ├── core/              # Core systems (DI, error handling, performance)
│   ├── workers/           # Web Workers for background tasks
│   ├── main.js            # Application initialization
│   ├── tool_executor.js   # Core tool execution system
│   ├── editor.js          # Monaco Editor integration
│   ├── file_system.js     # File System Access API wrapper
│   ├── chat_service.js    # LLM communication orchestrator
│   └── [25+ specialized modules]
└── package.json           # Frontend dependencies (prettier, acorn)
```

## Important Implementation Details

- **Error Handling**: Centralized error handling system in `frontend/js/core/error_handler.js`
- **State Management**: Dependency injection container in `frontend/js/core/di_container.js`
- **File Operations**: All file I/O uses browser File System Access API, no server-side file handling
- **Tool System**: 30+ tools for AI agent, including Senior Engineer AI capabilities
- **Multi-Provider**: Supports Gemini (with API key rotation), OpenAI, and Ollama
- **Persistence**: IndexedDB stores settings, chat history, checkpoints, and file handles