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

 ## vibe coding prompt

```
make tool_creation_tool library, this is llm tool to create all other tools.

tool_creation_tool = { 'type': 'function', 'function': { 'name': 'tool_creation', 'description': 'tool to create tool', 'parameters': { 'type': 'object', 'properties': { 'new_tool_name': { 'type': 'string', 'description': 'new tool name', }, 'new_tool_description': { 'type': 'string', 'description': 'new tool description', }, }, 'required': ['new_tool_name', 'new_tool_description'], }, }, }

tool_creation_tool_prompt = 'Write two blocks one code and another json. In code block write single function named "'+name+'" which makes "'+description+'" and returns string type, no need comments, in that code block should be only definition of that function. \n In json block write in json format which parameters was used to call that function if any, using example "' + new_tool_example + '"'
new_tool_example = { 'name': 'place function name here', 'description': 'place function description here', 'parameters': { 'type': 'object', 'properties': { 'first parameter name': { 'type': 'string', 'description': 'first parameter description', }, 'second parameter name': { 'type': 'string', 'description': 'second parameter description', }, }, 'required': ['first parameter name', 'second parameter name'], }, }

store tools in RAG chromadb using ollama nomic-embed-text:latest. make llm agent to have available tools list updated from RAG base always related to llm agents context. make tool creation tool also in RAG base as any other tools but little unique that it should be always on first place in available to use tools, and if it disappeared somehow then will be recreated.

make llm and rag logic all inside tool_creation_tool library for ollama qwen2.5-coder:7b-instruct-q8_0 via openai api with nodejs in single file tool_creation_tool.js.

first plan then make. make full implementations. add readme for github, make ``` not on first column as it breaks chat markdown. add sh for setup and run.

make infinite mmorpg example using tool_creation_tool.js where llm is game master, with all game logic on backend, so frontend only gets players input and gives output to players.
nodejs backend in single file server.js use port 3001, html frontend in single file index.html in public.

use sockets.

game example should be playable, make it be like mmorpg.
make game logic be only on server without llm or rag specific, game engine should not have llm and rag specific. leave tool creation tool library for llm and rag and not include there any game logic, game is only example of use tool creation tool.

and make it looks like mmorpg, to run on mobile with just touchscreen, no need to type text, add some game logic, to show how tool_creation_tool will work. not make predefined actions in client, all available actions should dynamically comes from server.

this is real implementation, with dynamically executed code.
This is not simplified version.

make it all happen in some visible world, where will be visible actions of players.

ChromaDB JavaScript client API doesn't have a direct .get() method.
make ChromaDB collection initialization to properly use async/await.
make tool checking to use query() instead of non-existent get().

generate game debug info, to be aware how llm operates.

make world not static but inhabited by llm created souls, and make visible to player available actions. make something happen in world by will of llm which takes visible actions in this demo. make no game mechanics in tool_creation_tool. all game mechanics must be in server.js. no actions should be hardcoded in client index.html, all actions client gets dynamically from server, as llm creates them and can change any time. so no predefined content and actions should be in index.html, all llm created entities should be dynamically streamed from server. all what in this world and world itself should be created by llm tools directly by llm, or can be precreated for debug purposes but also as it could be created by llm. make player also not something special entity but also some soul created by llm but only which can choose actions which other players could also choose but bot souls choosing as llm captured from player souls and turn into bots.

Removes code block markers (```) if present in the stored code
Ensures proper function declaration format
Wraps the execution in try-catch blocks
Provides meaningful error messages
Creates a wrapper function with its own error handling
Ensures consistent return type (string)
Properly passes the parameters object to the function
add some tool validation when creating new tools to catch formatting issues early
Generate cleaner function code from the LLM
Store properly formatted functions
Execute tools more reliably
Provide better error messages
The code is properly sanitized before function creation
The function wrapper ensures proper execution context
Error handling prevents crashes from malformed tools

main purpose of this example infinite mmorpg is to show power of tool_creation_tool, so needs only features which maximally show how tool_creation_tool can be used on full power.

also for more dynamic make in engine ability to use llm tools but without wait for llm, if llm will allow it, it can be some item, some artifact that will use power of llm tool without asking llm, and llm will only be informed of what happen. so, mmorpg activity will happen via artifacts created by llm with power of llm tools but without llm interruption.

make initial prompt file where will be all required info to create in game content using only one tool_creation_tool. in this initial_prompt.txt should be also all required actions, so no actions predefined in game engine, all created from this initial prompt.

use OllamaEmbeddingFunction. if tool not existed and no similar found then try to create it.

make real implementation.

make ability for souls only to use artifacts, so any action of soul must be artifact use, artifacts created by llm to use llm tools asynchronously without asking llm. so souls not able to interact with llm directly, but only use llm tools when have artifacts. so for initialization you can provide souls with needed artifacts, or souls could get artifacts in world. idea that with enough artifacts in world llm even can go to sleep and make finetuning to learn new features from created tools in RAG and their usage details, and while llm sleep world of mmorpg will still be fully functioning as game waiting for llm finetune and wake up.
```
