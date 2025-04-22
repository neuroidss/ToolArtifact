 import { createServer } from "http";
 import { Server } from "socket.io";
 import fs from 'fs/promises';
 import path from 'path';
 import { fileURLToPath } from 'url';
 import { ToolCreationManager } from "./tool_creation_tool.js";
 import { v4 as uuidv4 } from 'uuid'; // For generating IDs


import express from 'express'; // Add this line


 const __filename = fileURLToPath(import.meta.url);
 const __dirname = path.dirname(__filename);

 const PORT = process.env.PORT || 3001;
 const INITIAL_PROMPT_FILE = 'initial_prompt.txt';
 
 
 // Create Express app and HTTP server
const app = express();
const httpServer = createServer(app); // Changed from createServer()

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));



 // --- Game State ---
 // Simple in-memory storage. For a real MMO, use a database.
 const gameState = {
     souls: {}, // { soulId: { id, name, locationId, inventory: [artifactId1, artifactId2] } }
     locations: {}, // { locationId: { id, name, description, exits: {north: locationId2, ...} } }
     artifacts: {}, // { artifactId: { id, name, description, linkedToolName } }
     worldLog: ["Welcome to the Infinite MMORPG!"],
 };

 // --- Server Setup ---
// const httpServer = createServer();
 const io = new Server(httpServer, {
     cors: {
         origin: "*", // Allow connections from anywhere for simplicity
         methods: ["GET", "POST"]
     }
 });

 const toolManager = new ToolCreationManager();

 // --- Game Logic Functions ---
 // These are examples of functions the LLM *could* create via tools.
 // They interact directly with the gameState. They should return descriptive strings.

 function _internal_create_soul(params) {
      const { name, locationId, type = 'generic' } = params;
      if (!name || !locationId) return "Error: Missing name or locationId for create_soul.";
      if (!gameState.locations[locationId]) return `Error: Location '${locationId}' not found.`;
      const soulId = uuidv4();
      gameState.souls[soulId] = {
          id: soulId,
          name: name,
          locationId: locationId,
          inventory: [], // List of artifact IDs
          type: type // 'player', 'npc', 'generic'
      };
      logToWorld(`A new soul named '${name}' appeared in ${gameState.locations[locationId].name}.`);
      return `Soul '${name}' (ID: ${soulId}) created successfully at location ${locationId}.`;
 }

 function _internal_create_location(params) {
      const { name, description } = params;
      if (!name || !description) return "Error: Missing name or description for create_location.";
      const locationId = name.toLowerCase().replace(/\s+/g, '_'); // Simple ID generation
       if(gameState.locations[locationId]) return `Error: Location with ID '${locationId}' already exists.`
      gameState.locations[locationId] = {
          id: locationId,
          name: name,
          description: description,
          exits: {} // { direction: targetLocationId }
      };
      logToWorld(`A new location called '${name}' was discovered.`);
      return `Location '${name}' (ID: ${locationId}) created successfully.`;
 }

 function _internal_link_exit(params) {
     const { fromLocationId, direction, toLocationId } = params;
      if (!fromLocationId || !direction || !toLocationId) return "Error: Missing parameters for link_exit.";
      if (!gameState.locations[fromLocationId]) return `Error: Origin location '${fromLocationId}' not found.`;
      if (!gameState.locations[toLocationId]) return `Error: Destination location '${toLocationId}' not found.`;

      gameState.locations[fromLocationId].exits[direction.toLowerCase()] = toLocationId;
      logToWorld(`A path opened from ${gameState.locations[fromLocationId].name} ${direction} to ${gameState.locations[toLocationId].name}.`);
      return `Exit '${direction}' added from ${fromLocationId} to ${toLocationId}.`;
 }


 function _internal_create_artifact(params) {
      const { name, description, linkedToolName } = params;
      if (!name || !description || !linkedToolName) return "Error: Missing name, description, or linkedToolName for create_artifact.";
      // Optional: Check if linkedToolName exists in toolManager?
      const artifactId = uuidv4();
      gameState.artifacts[artifactId] = {
          id: artifactId,
          name: name,
          description: description,
          linkedToolName: linkedToolName
      };
      logToWorld(`A powerful artifact known as '${name}' has materialized.`);
      return `Artifact '${name}' (ID: ${artifactId}) created, linked to tool '${linkedToolName}'.`;
 }

 function _internal_give_artifact_to_soul(params) {
     const { soulId, artifactId } = params;
      if (!soulId || !artifactId) return "Error: Missing soulId or artifactId for give_artifact.";
      if (!gameState.souls[soulId]) return `Error: Soul '${soulId}' not found.`;
      if (!gameState.artifacts[artifactId]) return `Error: Artifact '${artifactId}' not found.`;

      if (!gameState.souls[soulId].inventory.includes(artifactId)) {
          gameState.souls[soulId].inventory.push(artifactId);
          logToWorld(`${gameState.souls[soulId].name} obtained the artifact '${gameState.artifacts[artifactId].name}'.`);
          return `Artifact '${gameState.artifacts[artifactId].name}' given to soul '${gameState.souls[soulId].name}'.`;
      } else {
          return `Warning: Soul '${gameState.souls[soulId].name}' already possesses artifact '${gameState.artifacts[artifactId].name}'.`;
      }
 }

 function _internal_move_soul(params) {
     const { soulId, targetLocationId } = params;
     if (!soulId || !targetLocationId) return "Error: Missing soulId or targetLocationId for move_soul.";
     const soul = gameState.souls[soulId];
     if (!soul) return `Error: Soul '${soulId}' not found.`;
     const currentLocation = gameState.locations[soul.locationId];
     const targetLocation = gameState.locations[targetLocationId];
     if (!targetLocation) return `Error: Target location '${targetLocationId}' not found.`;

     // Basic check: Is the target location directly reachable? (Could be enhanced by tool logic)
     let reachable = false;
     if (currentLocation && currentLocation.exits) {
         reachable = Object.values(currentLocation.exits).includes(targetLocationId);
     }
     // Allow moving even if not directly connected for flexibility / initial setup
     // A real game might have the 'move' tool check exits itself.
     // if (!reachable) return `Error: Cannot move from ${currentLocation?.name || 'unknown'} to ${targetLocation.name}. No direct path.`;


     const oldLocationName = currentLocation?.name || 'an unknown place';
     soul.locationId = targetLocationId;
     logToWorld(`${soul.name} moved from ${oldLocationName} to ${targetLocation.name}.`);
     return `${soul.name} moved successfully to ${targetLocation.name}.`;
 }

 // More potential internal functions: describe_location, look_around, etc.


 // --- Utility Functions ---
 function logToWorld(message) {
     console.log("[WORLD]", message);
     gameState.worldLog.push(message);
     if (gameState.worldLog.length > 50) { // Keep log size manageable
         gameState.worldLog.shift();
     }
     // Broadcast important world events? Maybe too noisy.
     // io.emit('gameStateUpdate', getFilteredGameState());
 }

 function sendDebugInfo(socket, message) {
     if (socket) {
         socket.emit('debugInfo', `[SERVER DEBUG] ${message}`);
     } else {
         io.emit('debugInfo', `[SERVER DEBUG] ${message}`); // Broadcast if no specific socket
     }
     console.log(`[DEBUG] ${message}`);
 }

 async function processInitialPrompt() {
     sendDebugInfo(null, `Processing initial prompt file: ${INITIAL_PROMPT_FILE}`);
     try {
         const promptContent = await fs.readFile(INITIAL_PROMPT_FILE, 'utf-8');
         const lines = promptContent.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));

         for (const line of lines) {
             const trimmedLine = line.trim();
             sendDebugInfo(null, `Processing line: ${trimmedLine}`);

             if (trimmedLine.toUpperCase().startsWith('CREATE TOOL')) {
                 // Expect format: CREATE TOOL name='...' description='...' parameters='{...}'
                 const nameMatch = trimmedLine.match(/name='([^']+)'/);
                 const descMatch = trimmedLine.match(/description='([^']+)'/);
                 const paramsMatch = trimmedLine.match(/parameters='({.*})'/);

                 if (nameMatch && descMatch && paramsMatch) {
                     const name = nameMatch[1];
                     const description = descMatch[1];
                     try {
                         const parameters = JSON.parse(paramsMatch[1]);
                         sendDebugInfo(null, `Attempting to create tool '${name}' via tool_creation...`);
                         // Use the *internal* execution path for tool_creation
                         const result = await toolManager.executeTool('tool_creation', {
                             new_tool_name: name,
                             new_tool_description: description,
                             new_tool_parameters: parameters
                         });
                         sendDebugInfo(null, `Tool creation result for '${name}': ${result}`);
                         if (result.startsWith("Error:")) {
                             console.error(`Failed to process initial prompt line: ${line}\nError: ${result}`);
                             // Decide whether to stop or continue on error
                         }
                     } catch (jsonError) {
                         console.error(`Failed to parse parameters JSON in line: ${line}\nError: ${jsonError}`);
                     }
                 } else {
                     console.error(`Invalid CREATE TOOL format in line: ${line}`);
                 }
             } else if (trimmedLine.toUpperCase().startsWith('EXECUTE TOOL')) {
                 // Expect format: EXECUTE TOOL name='...' args='{...}'
                 const nameMatch = trimmedLine.match(/name='([^']+)'/);
                 const argsMatch = trimmedLine.match(/args='({.*})'/);

                 if (nameMatch && argsMatch) {
                     const name = nameMatch[1];
                     try {
                         const args = JSON.parse(argsMatch[1]);
                         sendDebugInfo(null, `Attempting to execute tool '${name}' with args: ${JSON.stringify(args)}`);

                         // Check for internal game logic functions first (bootstrap optimization)
                         let result;
                         switch (name) {
                             case 'create_soul': result = _internal_create_soul(args); break;
                             case 'create_location': result = _internal_create_location(args); break;
                              case 'link_exit': result = _internal_link_exit(args); break;
                             case 'create_artifact': result = _internal_create_artifact(args); break;
                             case 'give_artifact_to_soul': result = _internal_give_artifact_to_soul(args); break;
                             case 'move_soul': result = _internal_move_soul(args); break;
                             // Add other internal bootstrap functions if needed
                             default:
                                 // If not internal, execute via ToolManager
                                 result = await toolManager.executeTool(name, args);
                         }

                         sendDebugInfo(null, `Tool execution result for '${name}': ${result}`);
                         if (result.startsWith("Error:")) {
                             console.error(`Failed execution in initial prompt line: ${line}\nError: ${result}`);
                             // Decide whether to stop or continue
                         }
                          // Potentially update game state based on non-internal tool results if they modify state directly
                          // This requires careful design of the tools created by the LLM.
                          // For now, we primarily rely on the internal functions for bootstrap state changes.

                     } catch (jsonError) {
                         console.error(`Failed to parse args JSON in line: ${line}\nError: ${jsonError}`);
                     }
                 } else {
                     console.error(`Invalid EXECUTE TOOL format in line: ${line}`);
                 }
             } else {
                 console.warn(`Skipping unrecognized line in initial prompt: ${line}`);
             }
              await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between commands
         }
         sendDebugInfo(null, "Finished processing initial prompt.");
     } catch (error) {
         console.error(`Error processing initial prompt file ${INITIAL_PROMPT_FILE}:`, error);
         // Decide if the server should start even if the prompt fails
     }
 }


 // --- Socket Connection Handling ---
 io.on("connection", async (socket) => {
     console.log(`Socket connected: ${socket.id}`);
     sendDebugInfo(socket, `Connection established: ${socket.id}`);

     // --- Player Soul Creation/Assignment ---
     // Simple: create a new soul for each connection for this example
     let playerSoulId = null;
     try {
          const creationParams = { name: `Player_${socket.id.substring(0, 5)}`, locationId: 'town_square' }; // Default start location
          const creationResult = _internal_create_soul(creationParams);
          sendDebugInfo(socket, `Soul creation attempt result: ${creationResult}`);
          // Extract ID from result (basic parsing, might need refinement)
          const idMatch = creationResult.match(/ID: ([a-f0-9-]+)/);
          if (idMatch) {
              playerSoulId = idMatch[1];
              gameState.souls[playerSoulId].type = 'player'; // Mark as player controlled
              socket.emit('assignSoulId', playerSoulId); // Tell client its ID
              socket.data.soulId = playerSoulId; // Now properly defined
              console.log(`Storing soulId ${playerSoulId} in socket.data`);
              console.log(`Current socket.data:`, socket.data);
              sendDebugInfo(socket, `Assigned player soul ID: ${playerSoulId}`);
              
    // Give starting artifacts
    const startingArtifacts = Object.values(gameState.artifacts)
        .filter(a => ['Boots of Walking', 'Amulet of Observation'].includes(a.name));
    
    startingArtifacts.forEach(artifact => {
        _internal_give_artifact_to_soul({
            soulId: playerSoulId,
            artifactId: artifact.id
        });
    });
    
    console.log(`Player ${playerSoulId} inventory:`, gameState.souls[playerSoulId].inventory);
              
          } else {
              throw new Error(`Could not extract soul ID from creation result: ${creationResult}`);
          }

         // Send initial state AFTER soul is created
         socket.emit('gameStateUpdate', getFilteredGameStateForSoul(playerSoulId));
         await sendAvailableActions(socket, playerSoulId);

     } catch (error) {
         console.error("Error creating player soul:", error);
         sendDebugInfo(socket, `Error setting up player: ${error.message}`);
         socket.disconnect(true); // Disconnect if setup fails
         return;
     }


     // --- Event Listeners ---
     socket.on("disconnect", () => {
         console.log(`Socket disconnected: ${socket.id}`);
         if (playerSoulId && gameState.souls[playerSoulId]) {
             logToWorld(`${gameState.souls[playerSoulId].name} has disconnected.`);
             // Optional: Remove player soul or mark as disconnected NPC?
             // delete gameState.souls[playerSoulId];
             // For this example, we leave them in the world.
             broadcastGameState(); // Update others
         }
     });

     socket.on("performAction", async (data) => {
         const { artifactId, args } = data; // Expecting artifactId and potential extra args
         const soulId = playerSoulId; // Action is performed by the player soul associated with this socket

         if (!soulId || !gameState.souls[soulId]) {
             sendDebugInfo(socket, "Error: Cannot perform action, soul not found.");
             return;
         }
         if (!artifactId) {
              sendDebugInfo(socket, "Error: No artifactId provided for action.");
              return;
         }

         const soul = gameState.souls[soulId];
         const artifact = gameState.artifacts[artifactId];

         if (!soul.inventory.includes(artifactId) || !artifact) {
             sendDebugInfo(socket, `Error: Soul ${soul.name} does not possess artifact '${artifact?.name || artifactId}' or artifact invalid.`);
             socket.emit('actionResult', { success: false, message: `You don't have the required artifact '${artifact?.name || artifactId}'.` });
             return;
         }

         const toolName = artifact.linkedToolName;
         if (!toolName) {
              sendDebugInfo(socket, `Error: Artifact '${artifact.name}' is not linked to any tool.`);
              socket.emit('actionResult', { success: false, message: `Artifact '${artifact.name}' seems inert.` });
             return;
         }

         // --- Prepare Arguments for the Tool ---
         // Include the soul performing the action and potentially other context
         const toolArgs = {
              soulId: soulId, // Let the tool know who is acting
              locationId: soul.locationId, // Let the tool know where the action happens
              ...(args || {}) // Include any args sent from the client (e.g., target ID, direction)
         };


         sendDebugInfo(socket, `Executing tool '${toolName}' via artifact '${artifact.name}' for soul ${soulId} with args: ${JSON.stringify(toolArgs)}`);

         try {
             const executionResult = await toolManager.executeTool(toolName, toolArgs);
             sendDebugInfo(socket, `Tool '${toolName}' execution result: ${executionResult}`);

             // --- Process Result ---
             // The tool's return string *is* the primary way it communicates outcomes.
             // We can check if it starts with "Error:"
             const success = !executionResult.startsWith("Error:");
             socket.emit('actionResult', { success: success, message: executionResult });

             // If successful, update game state *based on the assumed effects described by the tool name/result*.
             // This is where the coupling between tool intent and server state happens.
             // More robust: Tools could return structured data, but string is per requirement.
             // We *could* re-parse the result string, but that's fragile.
             // Example: If a 'move' tool succeeded, the internal _internal_move_soul ALREADY updated state.
             // If an LLM-generated tool modified state, its *code* should have interacted with gameState (if passed in or globally accessible - risky!).
             // For now, assume internal bootstrap functions handle state for known actions. LLM tools primarily describe.
             // *** Key Decision: For this example, let's assume LLM tools primarily RETURN STRINGS,
             // and ONLY the predefined _internal_ functions directly modify gameState for simplicity/safety.
             // OR, pass gameState reference to executed tools (complex and risky). Let's stick to internal functions for state changes initially.

             if (success) {
                  // State might have been changed by an *internal* function called via a tool.
                  // Re-broadcast the potentially changed state.
                 broadcastGameState(); // Update everyone
                 await sendAvailableActions(socket, soulId); // Update acting player's actions
             } else {
                  // Maybe only send updated actions if the error didn't prevent future actions
                  await sendAvailableActions(socket, soulId);
             }

         } catch (error) {
             console.error(`Critical error during tool execution via performAction for tool ${toolName}:`, error);
             sendDebugInfo(socket, `System Error executing tool ${toolName}: ${error.message}`);
             socket.emit('actionResult', { success: false, message: `A critical error occurred while performing the action.` });
              await sendAvailableActions(socket, soulId); // Still send actions
         }
     });

     // Request to get game state manually (e.g., after reconnect)
     socket.on('requestState', () => {
          if(playerSoulId){
              socket.emit('gameStateUpdate', getFilteredGameStateForSoul(playerSoulId));
              sendAvailableActions(socket, playerSoulId);
          }
     });
 });


 // --- Game State Broadcasting ---
 function getFilteredGameStateForSoul(soulId) {
     const soul = gameState.souls[soulId];
     if (!soul) return { error: "Soul not found" };

     const currentLoc = gameState.locations[soul.locationId];

     // Souls visible in the same location
     const visibleSouls = Object.values(gameState.souls)
         .filter(s => s.locationId === soul.locationId)
         .map(s => ({ id: s.id, name: s.name, type: s.type })); // Don't send inventory

     // Artifacts in the player's inventory
     const inventoryDetails = soul.inventory
          .map(id => gameState.artifacts[id])
          .filter(Boolean); // Filter out invalid IDs

     return {
         playerSoul: { id: soul.id, name: soul.name, locationId: soul.locationId },
         currentLocation: currentLoc ? {
             name: currentLoc.name,
             description: currentLoc.description,
             exits: currentLoc.exits // Send available exits
         } : { name: "The Void", description: "Lost in space...", exits: {} },
         visibleSouls: visibleSouls,
         inventory: inventoryDetails, // Send artifact details { id, name, description, linkedToolName }
         worldLog: gameState.worldLog.slice(-10) // Send recent log entries
     };
 }

 function broadcastGameState() {
     // Send personalized state to each player
     Object.values(gameState.souls).forEach(soul => {
         if (soul.type === 'player') {
              const playerSocket = io.sockets.sockets.get(soul.id.replace('Player_','')); // Hacky way to find socket by player name pattern
             // This is unreliable. Better: store socket ID with soul state.
             // For now, we'll broadcast a generic state update trigger
             io.emit('gameStateUpdateNeeded'); // Tell clients to request fresh state
         }
     });
      // Simplified: just tell all clients to request new state
      io.emit('requestState'); // Ask all clients to re-request their state
 }

 io.on('connection', (socket) => {
     // ... existing connection logic ...

     socket.on('requestState', () => {
          // Find the soulId associated with this socket (need to store this on connection)
          const soulId = socket.data.soulId; // Assumes we store it like this: socket.data.soulId = playerSoulId;
          if (soulId) {
              socket.emit('gameStateUpdate', getFilteredGameStateForSoul(soulId));
              sendAvailableActions(socket, soulId);
          } else {
              sendDebugInfo(socket, "RequestState received but no soulId associated with socket.");
          }
     });

     // Modify connection logic to store soulId:
      // ... after playerSoulId is assigned ...
      //socket.data.soulId = playerSoulId; // Store it here
      // ... rest of connection logic ...

 });

 // --- Action Handling ---
 async function sendAvailableActions(socket, soulId) {
     if (!soulId || !gameState.souls[soulId]) return;

     const soul = gameState.souls[soulId];
     const availableActions = [];

     // Actions are derived from artifacts in inventory
     for (const artifactId of soul.inventory) {
         const artifact = gameState.artifacts[artifactId];
         if (artifact && artifact.linkedToolName) {
             // Maybe get tool description from tool manager for better display name?
             // const toolDef = await toolManager.getToolDefinition(artifact.linkedToolName);
              // const description = toolDef?.description || artifact.description;

             availableActions.push({
                 artifactId: artifact.id, // ID of the artifact to use
                 toolName: artifact.linkedToolName, // The tool this artifact triggers
                 name: artifact.name, // Display name for the action (use artifact name)
                 description: artifact.description, // Artifact description
                 // Parameters might be needed from client for some tools (e.g., target ID)
                 // We need the tool's parameter schema here.
                 // parameters: toolDef?.parameters?.properties ? Object.keys(toolDef.parameters.properties) : []
                 // For simplicity now, assume args are handled contextually or not needed from client directly
             });
         }
     }

     // Add generic actions? Like "Look"? This could also be an artifact/tool.
     // Example: Add a "look" action if a "look" tool exists and the player has a corresponding artifact.

     sendDebugInfo(socket, `Sending ${availableActions.length} available actions for soul ${soulId}.`);
     socket.emit('availableActions', availableActions);
 }

 // --- Initialization and Startup ---
 async function main() {
     console.log("Initializing server...");
     try {
         await toolManager.initialize();
         console.log("Tool Manager initialized.");

         await processInitialPrompt(); // Bootstrap the world
         console.log("Initial prompt processed.");
         console.log("Initial locations created:", Object.keys(gameState.locations));
         console.log("Initial artifacts created:", Object.keys(gameState.artifacts));
         console.log("Initial souls created:", Object.keys(gameState.souls));

         // Simple game loop for potential NPC actions (if any NPCs exist)
         setInterval(() => {
             Object.values(gameState.souls).forEach(soul => {
                 if (soul.type !== 'player' && Math.random() < 0.1) { // 10% chance per interval
                     // Basic NPC action: maybe move randomly if they have a move artifact?
                     const moveArtifact = soul.inventory.map(id => gameState.artifacts[id]).find(a => a?.linkedToolName === 'move_soul'); // Example tool name
                     if (moveArtifact) {
                         const currentLocation = gameState.locations[soul.locationId];
                         if (currentLocation && Object.keys(currentLocation.exits).length > 0) {
                             const exits = Object.values(currentLocation.exits);
                             const targetLocationId = exits[Math.floor(Math.random() * exits.length)];
                             const args = { soulId: soul.id, targetLocationId: targetLocationId };
                              sendDebugInfo(null, `NPC ${soul.name} attempting automated move to ${targetLocationId}`);
                              // Execute directly using internal function for reliability in this simple loop
                              const result = _internal_move_soul(args);
                              sendDebugInfo(null, `NPC move result: ${result}`);
                              if (!result.startsWith('Error:')) {
                                  broadcastGameState();
                              }
                         }
                     }
                 }
             });
         }, 10000); // Every 10 seconds


         httpServer.listen(PORT, () => {
             console.log(`Server listening on port ${PORT}`);
             console.log(`Game world accessible via client pointed at ws://localhost:${PORT}`);
         });

     } catch (error) {
         console.error("Server failed to start:", error);
         process.exit(1);
     }
 }

 main();
