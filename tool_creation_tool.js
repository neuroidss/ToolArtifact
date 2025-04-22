 import { ChromaClient, OpenAIEmbeddingFunction as ChromaOpenAIEmbeddingFunction } from 'chromadb';
 import { OllamaEmbeddings } from "@langchain/community/embeddings/ollama";
 import OpenAI from 'openai';
 import { v4 as uuidv4 } from 'uuid'; // Use UUID for unique IDs

 const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
 const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5-coder:7b-instruct-q8_0"; // Model for code generation
 const OLLAMA_EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";
 const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";
 const TOOL_COLLECTION_NAME = "llm_tools";

 // --- Tool Definition for the Tool Creator ---
 const TOOL_CREATION_TOOL_DEFINITION = {
     type: 'function',
     function: {
         name: 'tool_creation',
         description: 'Define and create a new tool (JavaScript function) that the LLM can use later. Takes the desired tool name, description, and parameter schema.',
         parameters: {
             type: 'object',
             properties: {
                 new_tool_name: {
                     type: 'string',
                     description: 'The name for the new tool function (use snake_case).',
                 },
                 new_tool_description: {
                     type: 'string',
                     description: 'A clear description of what the new tool does and when to use it.',
                 },
                 new_tool_parameters: {
                     type: 'object',
                     description: 'A JSON schema object describing the parameters the new function will accept.',
                     properties: {
                         type: { type: 'string', enum: ['object'] },
                         properties: { type: 'object' },
                         required: { type: 'array', items: { type: 'string' } }
                     },
                     required: ['type', 'properties']
                 }
             },
             required: ['new_tool_name', 'new_tool_description', 'new_tool_parameters'],
         },
     },
 };

 const NEW_TOOL_EXAMPLE_SCHEMA = {
     name: 'example_tool_name',
     description: 'A concise description of the example function.',
     parameters: {
         type: 'object',
         properties: {
             param1: { type: 'string', description: 'Description of the first parameter.' },
             param2: { type: 'boolean', description: 'Description of the second parameter.' },
         },
         required: ['param1'],
     },
 };

 function generateToolCreationPrompt(name, description, parameters) {
     // Basic validation for the parameters schema structure
     if (!parameters || typeof parameters !== 'object' || parameters.type !== 'object' || typeof parameters.properties !== 'object') {
          throw new Error("Invalid parameters schema provided for new tool creation.");
     }

     const paramDetails = Object.entries(parameters.properties)
         .map(([key, value]) => ` *   ${key} (${value.type}): ${value.description || 'No description'}`)
         .join('\n');
     const requiredParams = parameters.required || [];

     return `You are an expert JavaScript function generator. Your task is to create a JavaScript function based on the provided specification.

     **Function Specification:**
     - Name: ${name}
     - Description: ${description}
     - Parameters Schema:
     \`\`\`json
     ${JSON.stringify(parameters, null, 2)}
     \`\`\`
     - Required Parameters: ${requiredParams.join(', ') || 'None'}

     **Instructions:**
     1.  Write a single, standalone JavaScript function named precisely \`${name}\`.
     2.  The function MUST accept a single argument: an object named \`params\` containing the specified parameters (e.g., \`params.param1\`, \`params.param2\`).
     3.  The function should perform the action described in the description.
     4.  The function MUST return a single string indicating the result or outcome of the action (e.g., "Entity moved successfully.", "Error: Target location not found."). Do NOT return complex objects or boolean values directly, convert them to descriptive strings.
     5.  Do NOT include any comments, explanations, or surrounding text outside the function definition itself.
     6.  Do NOT include markdown code block markers (\`\`\`javascript or \`\`\`) in your output.
     7.  Ensure the function handles potential errors gracefully and returns an informative error string starting with "Error: ".

     **Example Function Structure:**
     \`\`\`javascript
     function example_tool_name(params) {
       // Access parameters like params.param1, params.param2
       try {
         // ... function logic based on description ...
         if (params.param1 === 'special') {
           return \`Special action performed with \${params.param1}.\`;
         }
         return \`Example tool executed with param1: \${params.param1}\`;
       } catch (error) {
         console.error('Error in example_tool_name:', error);
         return \`Error executing example_tool_name: \${error.message}\`;
       }
     }
     \`\`\`

     **Your Task:**
     Generate *only* the JavaScript function code for \`${name}\` based *exactly* on the specification provided above.`;
 }


 class ToolCreationManager {
     constructor() {
         this.ollama = new OpenAI({
             baseURL: `${OLLAMA_BASE_URL}/v1`,
             apiKey: 'ollama', // Required by openai package, but not used by Ollama
         });
         // Use Langchain's OllamaEmbeddings as it's specifically designed for this
         this.ollamaEmbeddings = new OllamaEmbeddings({
             model: OLLAMA_EMBEDDING_MODEL,
             baseUrl: OLLAMA_BASE_URL,
         });
         this.chromaClient = new ChromaClient({ path: CHROMA_URL });
         this.collection = null;
         this.toolsCache = new Map(); // Cache for loaded tool code
         this.isDebug = true; // Enable debug logging
     }

     debugLog(...args) {
         if (this.isDebug) {
             console.log('[DEBUG ToolManager]', ...args);
         }
     }

     async initialize() {
         this.debugLog("Initializing ToolCreationManager...");
         try {
             this.debugLog(`Attempting to get or create Chroma collection: ${TOOL_COLLECTION_NAME}`);
             // Use Langchain embeddings class with Chroma client directly
             this.collection = await this.chromaClient.getOrCreateCollection({
                 name: TOOL_COLLECTION_NAME,
                 embeddingFunction: this.ollamaEmbeddings // Pass the Langchain embedder instance
             });
             this.debugLog(`Chroma collection '${TOOL_COLLECTION_NAME}' ready.`);
             await this.ensureToolCreationTool();
             this.debugLog("ToolCreationManager initialized successfully.");
         } catch (error) {
             console.error("Error initializing ToolCreationManager:", error);
             throw error; // Re-throw to prevent proceeding in a bad state
         }
     }

     // Ensure the core tool_creation tool exists
     async ensureToolCreationTool() {
         this.debugLog("Ensuring tool_creation tool exists...");
         const toolName = TOOL_CREATION_TOOL_DEFINITION.function.name;
         try {
             const existing = await this.collection.get({
                 ids: [toolName],
                 limit: 1
             });

             if (existing && existing.ids && existing.ids.length > 0) {
                 this.debugLog(`'${toolName}' tool found in DB.`);
                 // Optionally load its definition into cache if needed immediately?
                 // For now, we just ensure it exists. Execution will load it.
                 return;
             }
         } catch (error) {
             // Chroma client might throw if the collection is empty or ID not found
             this.debugLog(`'${toolName}' not found or error checking existence: ${error.message}. Attempting to add.`);
         }

         try {
             this.debugLog(`Adding '${toolName}' tool definition to Chroma DB...`);

             // The 'code' for tool_creation is special - it calls this.createTool internally
             // This is a bit meta. We store a placeholder or indication it's built-in.
             // For simplicity, we'll store a string indicating it's the internal function.
             // Execution logic will need to handle this specific tool name.
             const toolCodePlaceholder = `// Internal ToolCreationManager function: ${toolName}`;

             const description = TOOL_CREATION_TOOL_DEFINITION.function.description;
             const parameters = TOOL_CREATION_TOOL_DEFINITION.function.parameters;

             // Use the embedding function directly if needed, or rely on collection's default
             const embedding = await this.ollamaEmbeddings.embedQuery(`${toolName}: ${description}`);

             await this.collection.add({
                 ids: [toolName],
                 embeddings: [embedding],
                 metadatas: [{
                     name: toolName,
                     description: description,
                     parameters_json: JSON.stringify(parameters), // Store schema as JSON string
                     code: toolCodePlaceholder, // Store the placeholder code
                     is_internal: true // Flag for special handling
                 }],
                 documents: [`Tool definition for ${toolName}: ${description}`] // Document for potential text search
             });
             this.debugLog(`'${toolName}' tool added successfully.`);
         } catch (addError) {
             console.error(`Failed to add '${toolName}' tool to Chroma DB:`, addError);
             throw addError; // Critical failure if we can't add the base tool
         }
     }


     // --- Tool Creation Logic ---
     async createTool(newToolName, newToolDescription, newToolParameters) {
         this.debugLog(`Attempting to create tool: ${newToolName}`);

         // 1. Validate Inputs (Basic)
         if (!newToolName || !newToolDescription || !newToolParameters) {
             return "Error: Missing required arguments for tool creation (name, description, parameters).";
         }
         if (typeof newToolName !== 'string' || typeof newToolDescription !== 'string' || typeof newToolParameters !== 'object') {
             return "Error: Invalid argument types for tool creation.";
         }
          // Simple check for valid function name characters
         if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(newToolName)) {
            return `Error: Invalid tool name '${newToolName}'. Use snake_case with letters, numbers, and underscores, starting with a letter or underscore.`;
         }


         // 2. Generate Prompt for LLM
         const prompt = generateToolCreationPrompt(newToolName, newToolDescription, newToolParameters);
         this.debugLog(`Generated prompt for LLM for tool ${newToolName}`);
         // console.log("--- LLM PROMPT ---", prompt, "--- END PROMPT ---"); // Keep for debugging if needed

         let generatedCode = '';
         try {
             // 3. Call LLM to generate code
             this.debugLog(`Calling Ollama (${OLLAMA_MODEL}) to generate function code...`);
             const response = await this.ollama.chat.completions.create({
                 model: OLLAMA_MODEL,
                 messages: [{ role: 'user', content: prompt }],
                 temperature: 0.2, // Lower temperature for more deterministic code gen
             });

             generatedCode = response.choices[0]?.message?.content?.trim() || '';
             this.debugLog(`Received LLM response for ${newToolName}. Length: ${generatedCode.length}`);
             // console.log("--- LLM RAW RESPONSE ---", generatedCode, "--- END RAW RESPONSE ---"); // Keep for debugging

             if (!generatedCode) {
                 throw new Error("LLM returned empty code.");
             }

             // 4. Sanitize and Validate Generated Code
             generatedCode = this.sanitizeGeneratedCode(generatedCode, newToolName);
             this.debugLog(`Sanitized code for ${newToolName}:`, generatedCode);

             // Basic validation: Does it look like a function definition?
              if (!generatedCode.startsWith(`function ${newToolName}(params)`) && !generatedCode.startsWith(`async function ${newToolName}(params)`)) {
                  throw new Error(`Generated code does not start with the expected function signature 'function ${newToolName}(params) {...}' or 'async function ${newToolName}(params) {...}'. Got: ${generatedCode.substring(0,100)}...`);
              }
             // Try creating a function object to catch syntax errors early
             try {
                 new Function('params', generatedCode); // This doesn't execute, just parses
                 this.debugLog(`Syntax validation passed for ${newToolName}.`);
             } catch (syntaxError) {
                 throw new Error(`Generated code has syntax errors: ${syntaxError.message}\nCode:\n${generatedCode}`);
             }


         } catch (error) {
             console.error(`Error during LLM code generation or validation for ${newToolName}:`, error);
             return `Error: Failed to generate or validate code for tool ${newToolName}. ${error.message}`;
         }

         // 5. Store in ChromaDB
         try {
             this.debugLog(`Adding tool '${newToolName}' to Chroma DB...`);
             // Re-check if it somehow got created concurrently (less likely in Node.js single thread but good practice)
              const existing = await this.collection.get({ ids: [newToolName], limit: 1 });
              if (existing && existing.ids && existing.ids.length > 0) {
                  this.debugLog(`Tool '${newToolName}' already exists. Skipping add.`);
                  // Optionally update it here if needed
                  return `Warning: Tool '${newToolName}' already existed. Creation skipped.`;
              }


             const embedding = await this.ollamaEmbeddings.embedQuery(`${newToolName}: ${newToolDescription}`);

             await this.collection.add({
                 ids: [newToolName],
                 embeddings: [embedding],
                 metadatas: [{
                     name: newToolName,
                     description: newToolDescription,
                     parameters_json: JSON.stringify(newToolParameters),
                     code: generatedCode, // Store the sanitized, validated code
                     is_internal: false
                 }],
                 documents: [`Tool definition for ${newToolName}: ${newToolDescription}`]
             });

             this.debugLog(`Tool '${newToolName}' added successfully to Chroma DB.`);
             this.toolsCache.delete(newToolName); // Invalidate cache if it existed

             return `Successfully created tool: ${newToolName}`;

         } catch (dbError) {
             console.error(`Error adding tool ${newToolName} to ChromaDB:`, dbError);
             return `Error: Failed to store tool ${newToolName} in database. ${dbError.message}`;
         }
     }

      sanitizeGeneratedCode(code, functionName) {
         // Remove markdown code block fences
         let sanitizedCode = code.replace(/^```(?:javascript|js)?\s*|```\s*$/g, '');

         // Ensure it starts with `function functionName(...)` or `async function functionName(...)`
         // Trim leading/trailing whitespace
         sanitizedCode = sanitizedCode.trim();

         // If it doesn't start correctly, attempt a basic fix (this is brittle)
         if (!sanitizedCode.startsWith(`function ${functionName}`) && !sanitizedCode.startsWith(`async function ${functionName}`)) {
              // Look for the first occurrence of `function` or `async function`
             const funcIndex = sanitizedCode.search(/^(async\s+)?function\s+/);
             if (funcIndex !== -1) {
                 this.debugLog(`Warning: Sanitizing function start for ${functionName}. Original might have had extra text.`);
                 sanitizedCode = sanitizedCode.substring(funcIndex);
             } else {
                  // If no function definition found, wrap it assuming the core logic is there
                  // This is a last resort and might fail validation later
                  this.debugLog(`Warning: Could not find standard function definition for ${functionName}. Wrapping code.`);
                  sanitizedCode = `function ${functionName}(params) {\n${sanitizedCode}\n}`;
              }
         }

         return sanitizedCode;
     }


     // --- Tool Retrieval ---
     async getToolDefinition(toolName) {
         this.debugLog(`Retrieving definition for tool: ${toolName}`);
         try {
             const results = await this.collection.get({
                 ids: [toolName],
                 include: ["metadatas"] // Only need metadata which contains code, etc.
             });

             if (!results || !results.ids || results.ids.length === 0) {
                 this.debugLog(`Tool '${toolName}' not found in DB.`);
                 return null;
             }

             const metadata = results.metadatas[0];
             if (!metadata || !metadata.code || !metadata.parameters_json) {
                  console.error(`Error: Incomplete metadata found for tool ${toolName}`, metadata);
                  return null;
             }

             return {
                 name: metadata.name,
                 description: metadata.description,
                 parameters: JSON.parse(metadata.parameters_json), // Parse the schema back into an object
                 code: metadata.code,
                 is_internal: metadata.is_internal || false
             };
         } catch (error) {
             console.error(`Error retrieving tool ${toolName} from ChromaDB:`, error);
             return null;
         }
     }

     async getAvailableTools(contextQuery, count = 5) {
         this.debugLog(`Querying for tools relevant to context: "${contextQuery}" (max ${count})`);
         try {
             const queryEmbedding = await this.ollamaEmbeddings.embedQuery(contextQuery);

             const results = await this.collection.query({
                 queryEmbeddings: [queryEmbedding],
                 nResults: count,
                 include: ["metadatas"] // Fetch metadata (name, description, params)
             });

             let availableTools = [];
             // Always add the tool_creation_tool first if it exists
              const creatorToolDef = TOOL_CREATION_TOOL_DEFINITION.function; // Use static definition
              availableTools.push({
                  name: creatorToolDef.name,
                  description: creatorToolDef.description,
                  parameters: creatorToolDef.parameters,
              });


             if (results && results.ids && results.ids.length > 0) {
                 for (let i = 0; i < results.ids[0].length; i++) {
                     const toolId = results.ids[0][i];
                     // Avoid adding tool_creation again if returned by query
                     if (toolId === TOOL_CREATION_TOOL_DEFINITION.function.name) {
                         continue;
                     }

                     const metadata = results.metadatas[0][i];
                     if (metadata && metadata.name && metadata.description && metadata.parameters_json) {
                          try {
                            availableTools.push({
                                name: metadata.name,
                                description: metadata.description,
                                parameters: JSON.parse(metadata.parameters_json), // Parse schema
                            });
                          } catch(parseError) {
                              console.error(`Error parsing parameters for tool ${metadata.name}:`, parseError);
                              // Skip this tool if params are corrupted
                          }
                     } else {
                          this.debugLog(`Warning: Skipping tool ID ${toolId} due to missing metadata in query results.`);
                     }
                 }
             }

             this.debugLog(`Found ${availableTools.length} available tools.`);
             return availableTools;

         } catch (error) {
             console.error("Error querying ChromaDB for available tools:", error);
             return [TOOL_CREATION_TOOL_DEFINITION.function]; // Return only the base tool on error
         }
     }


    // --- Tool Execution ---
    async executeTool(toolName, args) {
        this.debugLog(`Attempting to execute tool: ${toolName} with args:`, args);

        // Special case: tool_creation is internal
        if (toolName === TOOL_CREATION_TOOL_DEFINITION.function.name) {
            this.debugLog(`Executing internal tool: ${toolName}`);
            try {
                // Validate args against the known schema for tool_creation
                 const required = TOOL_CREATION_TOOL_DEFINITION.function.parameters.required;
                 for (const param of required) {
                     if (args[param] === undefined || args[param] === null) {
                         throw new Error(`Missing required parameter '${param}' for tool_creation.`);
                     }
                 }
                 // Add more specific type checks if needed based on schema
                if(typeof args.new_tool_name !== 'string' || typeof args.new_tool_description !== 'string' || typeof args.new_tool_parameters !== 'object'){
                     throw new Error("Invalid parameter types for tool_creation.");
                }

                return await this.createTool(
                    args.new_tool_name,
                    args.new_tool_description,
                    args.new_tool_parameters
                );
            } catch (error) {
                console.error(`Error executing internal tool ${toolName}:`, error);
                return `Error: Failed to execute ${toolName}. ${error.message}`;
            }
        }

        // Retrieve tool definition (including code) from DB
        const toolDefinition = await this.getToolDefinition(toolName);

        if (!toolDefinition) {
            return `Error: Tool '${toolName}' not found or definition is corrupted.`;
        }

        if (toolDefinition.is_internal) {
             // Should not happen for non-tool_creation internal tools unless added manually
             console.error(`Error: Attempted to execute unhandled internal tool '${toolName}'`);
             return `Error: Cannot execute internal tool '${toolName}' directly.`;
         }

        const { code: toolCode, parameters: schema } = toolDefinition;

        if (!toolCode || typeof toolCode !== 'string') {
            return `Error: Invalid or missing code for tool '${toolName}'.`;
        }

        // --- Dynamic Function Execution ---
        try {
            this.debugLog(`Preparing to execute code for tool: ${toolName}`);
            // Validate args against schema before execution (basic check)
             if (schema && schema.required) {
                 for (const param of schema.required) {
                     if (args[param] === undefined || args[param] === null) {
                         throw new Error(`Missing required parameter '${param}' for tool ${toolName}.`);
                     }
                 }
             }
            // Add more parameter validation based on schema types if needed

            // Create the function dynamically IN A CONTROLLED SCOPE
            // The 'use strict' helps catch common errors.
            // We wrap the retrieved code inside another function to control its scope and execution.
            const functionWrapper = new Function('params', `
                'use strict';
                try {
                    // Define the function using the code retrieved from DB
                    ${toolCode}

                    // Check if the function was actually defined
                    if (typeof ${toolName} !== 'function') {
                        throw new Error('Tool code did not define function "${toolName}".');
                    }

                    // Execute the defined function with the provided parameters
                     const result = ${toolName}(params);

                    // Ensure the result is a string as per the contract
                    if (typeof result !== 'string') {
                         console.warn("Tool ${toolName} did not return a string. Converting result:", result);
                         return String(result); // Attempt conversion
                     }

                    return result;

                } catch (executionError) {
                    console.error('Error during dynamic execution of tool "${toolName}":', executionError);
                     // Return a formatted error string that the calling logic can recognize
                    return \`Error: Execution failed for tool ${toolName}: \${executionError.message}\`;
                }
            `);

            this.debugLog(`Executing function wrapper for ${toolName}...`);
            const result = functionWrapper(args); // Pass the arguments object
            this.debugLog(`Execution result for ${toolName}:`, result);

             // Check if the result indicates an error occurred *inside* the tool's try-catch
             if (typeof result === 'string' && result.startsWith('Error:')) {
                 console.error(`Tool '${toolName}' reported an internal error: ${result}`);
                 // Propagate the error string
             }

            return result; // Return the string result (or error string)

        } catch (wrapperError) {
            // This catches errors in creating the Function object itself (e.g., syntax errors in toolCode)
            // or errors *outside* the inner try-catch within the generated function.
            console.error(`Error creating or executing wrapper for tool '${toolName}':`, wrapperError);
             return `Error: Failed to execute tool ${toolName}. Malformed code or unexpected runtime error. ${wrapperError.message}`;
        }
    }
 }

 export { ToolCreationManager, TOOL_CREATION_TOOL_DEFINITION };
