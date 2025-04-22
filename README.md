 # Infinite MMORPG - LLM Tool Creation Demo

 This project demonstrates a dynamic game world where game actions and potentially even content are created and managed by a Large Language Model (LLM) using a "Tool Creation Tool".

 The core idea is that the LLM isn't just a content generator but an active participant that can define *new capabilities (tools/functions)* for itself and the game entities on the fly. These tools are stored in a RAG (Retrieval-Augmented Generation) system using ChromaDB and Ollama embeddings, allowing the LLM or game engine to find and execute relevant tools based on context.

 The MMORPG is a simple example application showcasing this concept. Players connect, receive available actions (derived from artifacts they possess), and perform those actions. Actions trigger tools linked to artifacts, which are executed on the server. NPCs can also use artifacts/tools.

 ## Key Concepts

 *   **`tool_creation_tool`**: An initial, fundamental tool provided to the LLM. Its sole purpose is to allow the LLM to define *other* tools by providing a name, description, and parameter schema. The LLM then generates the JavaScript function code for the new tool.
 *   **Dynamic Tool Generation**: The LLM uses `tool_creation_tool` to create new functions (e.g., `move_entity`, `create_item`, `cast_spell`).
 *   **RAG (ChromaDB + Ollama Embeddings)**: Newly created tools (their code and descriptions) are stored in ChromaDB. The description is embedded using Ollama (`nomic-embed-text`) to enable semantic searching.
 *   **Contextual Tool Retrieval**: When an action needs to be performed or possibilities explored, the system queries ChromaDB based on the current context (e.g., "player wants to move north", "describe the forest") to find relevant tools.
 *   **Safe Dynamic Execution**: Retrieved tool code (JavaScript strings) is executed safely on the server using `new Function()` wrappers with error handling.
 *   **Artifact-Driven Actions**: In this MMORPG example, player/NPC actions are primarily driven by possessing "Artifacts". Each artifact is linked to a specific tool created by the LLM. Using the artifact triggers the execution of the corresponding tool. This allows actions without direct LLM intervention for every step, while the LLM still defines the *capabilities*.
 *   **LLM as Orchestrator/Creator**: The LLM bootstraps the world via an initial prompt, creates the tools, artifacts, and can potentially drive NPC behavior or world events.

 ## Architecture

 1.  **`tool_creation_tool.js`**: Library managing LLM interaction (Ollama API), ChromaDB storage/retrieval, tool code generation/sanitization, and dynamic execution.
 2.  **`server.js`**: Node.js backend using Socket.IO. Manages player connections, game state (in-memory), interacts with `ToolCreationManager` to get/execute tools via artifacts, handles game logic triggered by tools, and broadcasts updates. Processes `initial_prompt.txt` on startup.
 3.  **`public/index.html`**: Simple web frontend using Socket.IO client. Connects to the server, displays game state/log, dynamically generates action buttons based on received available actions (artifacts), and sends chosen actions back to the server. Includes a debug panel.
 4.  **`initial_prompt.txt`**: Text file containing instructions for the LLM (via `tool_creation_tool`) to create initial tools, locations, souls, artifacts, and link them to set up the game world.
 5.  **Ollama**: Runs the LLM (`qwen2.5-coder:7b-instruct-q8_0`) and the embedding model (`nomic-embed-text`).
 6.  **ChromaDB**: Vector database storing the tools and their embeddings.

 ## Setup

 1.  **Prerequisites**:
     *   Node.js (v18+ recommended)
     *   npm
     *   Ollama installed and running (`ollama serve`)
     *   ChromaDB installed and running (e.g., `pip install chromadb`, then `chroma run --path ./chroma_db_data`)
 2.  **Pull Ollama Models**:
     ```bash
     ollama pull qwen2.5-coder:7b-instruct-q8_0
     ollama pull nomic-embed-text
     ```
 3.  **Clone the Repository**:
     ```bash
     git clone <repository-url>
     cd infinite-mmorpg-tool-creator
     ```
 4.  **Install Dependencies**:
     ```bash
     chmod +x setup.sh
     ./setup.sh
     ```
     (Or just `npm install`)
 5.  **Configure (Optional)**: If Ollama or ChromaDB are running on different hosts/ports, set environment variables:
     *   `OLLAMA_BASE_URL` (e.g., `http://192.168.1.100:11434`)
     *   `CHROMA_URL` (e.g., `http://192.168.1.100:8000`)
     *   `OLLAMA_MODEL`
     *   `OLLAMA_EMBEDDING_MODEL`

 ## Running

 1.  Ensure Ollama is running.
 2.  Ensure ChromaDB is running.
 3.  Start the server:
     ```bash
     chmod +x run.sh
     ./run.sh
     ```
     (Or just `node server.js`)
 4.  Open `public/index.html` in your web browser (you might need a simple static file server like `npx serve public` or open the file directly, though connecting might require `localhost` if served locally). Alternatively, navigate to `http://localhost:3001` if the server is configured to serve the HTML directly (current setup doesn't do this, use `npx serve .` in the root directory and go to `http://localhost:3000/public/`).
 5.  Interact with the game using the dynamically generated action buttons. Observe the log and debug output.

 ## How it Works (Example Flow)

 1.  **Startup**: `server.js` initializes `ToolCreationManager`, which connects to Ollama/ChromaDB and ensures `tool_creation_tool` exists.
 2.  **Bootstrap**: `server.js` reads `initial_prompt.txt`.
     *   `CREATE TOOL` lines: Calls `toolManager.executeTool('tool_creation', ...)` which uses the LLM to generate code for tools like `move_soul`, `create_artifact`, etc., and stores them in ChromaDB.
     *   `EXECUTE TOOL` lines: Calls `toolManager.executeTool(...)` for the specified tool (or uses internal server functions for bootstrapping reliability) to create locations, NPCs, artifacts etc., modifying the `gameState`.
 3.  **Player Connects**: `server.js` creates a player soul, gives it default starting artifacts (e.g., "Boots of Walking", "Amulet of Observation" - implemented in server connection logic).
 4.  **Send State/Actions**: Server sends the player their current location, visible souls, inventory, and available actions (derived from artifacts in inventory).
 5.  **Player Action**: Player clicks an action button (e.g., "Boots of Walking").
 6.  **Frontend**: Sends `performAction` event with the `artifactId` to the server.
 7.  **Server**:
     *   Receives `performAction`.
     *   Finds the artifact and its linked `toolName` (e.g., `move_soul`).
     *   Calls `toolManager.executeTool('move_soul', { soulId: 'player...', targetLocationId: '...' /* maybe prompted */ })`.
     *   `ToolCreationManager`: Retrieves the code for `move_soul` from ChromaDB.
     *   `ToolCreationManager`: Executes the retrieved code dynamically.
     *   The `move_soul` function (either internal or LLM-generated) updates the `gameState` (player's location).
     *   `ToolCreationManager`: Returns the result string (e.g., "Player moved to Shady Alley.").
     *   Server receives the result, updates all clients about the state change (player moved), and sends updated available actions to the acting player.
