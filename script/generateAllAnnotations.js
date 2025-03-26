const fs = require('fs');
const path = require('path');
const https = require('https'); // Use built-in https module instead of axios
const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');
const hJSON = require('hjson');  // Use hjson instead of YAML or JSON
hJSON.setEndOfLine('\n');

// Create a turndown service for HTML to Markdown conversion
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*'
});

// Customize turndown to handle X4 wiki formatting better
turndownService.addRule('preserveNewlines', {
  filter: ['br'],
  replacement: function (content) {
    return '\n';
  }
});

// Add special rule for code boxes
turndownService.addRule('codeBoxes', {
  filter: function (node) {
    return node.nodeName === 'DIV' && node.classList.contains('box');
  },
  replacement: function (content, node) {
    // Find title and code divs
    const titleDiv = node.querySelector('.box-title');
    const codeDiv = node.querySelector('.code');

    let result = '';

    // Add title if found (as inline code)
    if (titleDiv) {
      result += `\`${titleDiv.textContent.trim()}\`\n\n`;
    }

    // Add code block if found
    if (codeDiv) {
      // Instead of just getting textContent, preserve both newlines and indentation
      // First get the inner HTML
      let codeHtml = codeDiv.innerHTML;

      // Convert <br> tags to newlines
      codeHtml = codeHtml.replace(/<br\s*\/?>/gi, '\n');

      // Create a temporary div to properly decode HTML entities
      const tempDiv = node.ownerDocument.createElement('div');
      tempDiv.innerHTML = codeHtml;

      // Use innerHTML/textContent conversion to properly decode HTML entities like &nbsp;
      // This ensures spaces used for indentation are preserved
      const code = tempDiv.textContent.trim();

      result += `\`\`\`lua\n${code}\n\`\`\`\n`;
    }

    return result;
  }
});

/**
 * Load configuration from JSON file or use defaults
 * @returns {Object} Configuration object
 */
function loadConfiguration() {
  const configFilePath = path.join(__dirname, 'configuration.json');
  let config = {
    // Default configuration
    wikiUrl: 'https://wiki.egosoft.com:1337/X%20Rebirth%20Wiki/Modding%20support/UI%20Modding%20support/Lua%20function%20overview/',
    luaFolderPath: 'C:\\Users\\psvor\\OneDrive\\Development\\X4\\ui',
    hjsonOutputPath: './hjson',
    luaOutputPath: './library',
    wikiHtmlPath: 'Lua function overview - X Community Wiki.html',
    outputFiles: {
      lua: 'X4LuaAPI.lua',
      ffi: 'X4FFIAPI.lua',
      ffiTypes: 'X4FFITypes.lua',
      helper: 'X4HelperAPI.lua',
      undocumented: 'X4UndocumentedAPI.lua'
    },
    hjsonFiles: {
      lua: 'x4-lua-functions.hjson',
      ffi: 'x4-ffi-definitions.hjson',
      helper: 'x4-helper-functions.hjson',
      undocumented: 'x4-undocumented-functions.hjson',
      GloballyExposed: 'x4-global-access.hjson',
      ffiNamespace: 'x4-ffi-namespace.hjson',
      cNamespace: 'x4-c-namespace.hjson'
    }
  };

  try {
    if (fs.existsSync(configFilePath)) {
      const fileConfig = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
      // Merge the file config with the default config
      config = { ...config, ...fileConfig };
      console.log('Loaded configuration from configuration.json');
    } else {
      console.warn('Configuration file not found, using defaults.');
      // Save the default config for next time
      fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2));
      console.log('Default configuration saved to configuration.json');
    }
  } catch (error) {
    console.error(`Error loading configuration: ${error.message}`);
    console.log('Using default configuration');
  }

  // Create output directories if they don't exist
  const hjsonOutputDir = resolvePath(config.hjsonOutputPath);
  const luaOutputDir = resolvePath(config.luaOutputPath);

  try {
    if (!fs.existsSync(hjsonOutputDir)) {
      fs.mkdirSync(hjsonOutputDir, { recursive: true });
      console.log(`Created hjson output directory: ${hjsonOutputDir}`);
    }

    if (!fs.existsSync(luaOutputDir)) {
      fs.mkdirSync(luaOutputDir, { recursive: true });
      console.log(`Created Lua output directory: ${luaOutputDir}`);
    }
  } catch (error) {
    console.error(`Error creating output directories: ${error.message}`);
  }

  // Initialize paths based on configuration
  return {
    wikiUrl: config.wikiUrl,
    luaFolderPath: resolvePath(config.luaFolderPath),
    wikiHtmlPath: resolvePath(config.wikiHtmlPath), // Handle wiki HTML as a file in the base directory
    outputPaths: {
      lua: path.join(luaOutputDir, config.outputFiles.lua),
      ffi: path.join(luaOutputDir, config.outputFiles.ffi),
      ffiTypes: path.join(luaOutputDir, config.outputFiles.ffiTypes),
      helper: path.join(luaOutputDir, config.outputFiles.helper),
      undocumented: path.join(luaOutputDir, config.outputFiles.undocumented)
    },
    hjsonPaths: {
      lua: path.join(hjsonOutputDir, config.hjsonFiles.lua),
      ffi: path.join(hjsonOutputDir, config.hjsonFiles.ffi),
      helper: path.join(hjsonOutputDir, config.hjsonFiles.helper),
      undocumented: path.join(hjsonOutputDir, config.hjsonFiles.undocumented),
      GloballyExposed: path.join(hjsonOutputDir, config.hjsonFiles.GloballyExposed),
      ffiNamespace: path.join(hjsonOutputDir, config.hjsonFiles.ffiNamespace),
      cNamespace: path.join(hjsonOutputDir, config.hjsonFiles.cNamespace)
    },
    hjsonOutputPath: hjsonOutputDir,
    luaOutputPath: luaOutputDir
  };
}

/**
 * Resolve a path, handling both absolute and relative paths
 * @param {string} filePath - The path to resolve
 * @param {string} [basePath=__dirname] - Base path for relative paths
 * @returns {string} - The resolved absolute path
 */
function resolvePath(filePath, basePath = __dirname) {
  // If path is absolute, return it as is
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  // Otherwise, resolve it relative to the base path
  return path.resolve(basePath, filePath);
}

// Configuration
const config = loadConfiguration();

// Data storage for each type of function
const dataStore = {
  // Maps for storing function information
  luaFunctions: new Map(),
  ffiTypes: new Map(),
  ffiFunctions: new Map(),
  helperFunctions: new Map(),
  undocumentedFunctions: new Map(),
  GloballyExposedFunctions: new Map(),  // Add new Map for global access functions

  // Set of all known functions to avoid duplicate documentation
  knownFunctions: new Set(),

  // Additional tracking
  localFunctions: new Set(),
  globalFunctions: new Set(),
  prefixedFunctions: new Map(),
  globallyExposedFunctions: new Set(),
  directFfiFunctions: new Set(),

  // Centralized function catalog with namespace information
  functionCatalog: new Map(), // key: "namespace.functionName", value: function info

  // Map of namespaces to their functions
  namespaces: new Map(), // key: namespace, value: Set of function names
};

// Standard Lua library functions to ignore
const luaStdLib = new Set([
  // Core functions
  'assert', 'collectgarbage', 'dofile', 'error', 'getmetatable', 'ipairs', 'load', 'loadfile',
  'next', 'pairs', 'pcall', 'print', 'rawequal', 'rawget', 'rawlen', 'rawset', 'require',
  'select', 'setmetatable', 'tonumber', 'tostring', 'type', 'xpcall',

  // String library, Table library, Math library, IO library, OS library, Debug library
  // ... (all the standard library functions as in the original script)
]);

/**
 * Find all Lua files recursively in a directory
 */
function findLuaFiles(directory) {
  const results = [];

  function traverseDirectory(dir) {
    try {
      const files = fs.readdirSync(dir, { withFileTypes: true });

      for (const file of files) {
        const fullPath = path.join(dir, file.name);

        if (file.isDirectory()) {
          traverseDirectory(fullPath);
        } else if (file.name.endsWith('.lua')) {
          results.push(fullPath);
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dir}: ${error.message}`);
    }
  }

  traverseDirectory(directory);
  return results;
}

/**
 * Clean Lua content by removing comments and string literals to prevent false matches
 */
function cleanLuaContent(content) {
  // Remove multi-line comments
  content = content.replace(/--\[\[[\s\S]*?\]\]/g, '');

  // Process line by line to handle single-line comments and string literals
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Remove single-line comments
    const commentStart = line.indexOf('--');
    if (commentStart >= 0) {
      line = line.substring(0, commentStart);
    }

    // Replace string literals with placeholders to prevent false matches
    line = line.replace(/"([^"\\]|\\.)*"/g, '""'); // Double-quoted strings
    line = line.replace(/'([^'\\]|\\.)*'/g, "''"); // Single-quoted strings

    lines[i] = line;
  }

  return lines.join('\n');
}

/**
 * Clean markdown formatting from text
 * @param {string} text - Text with potential markdown formatting
 * @returns {string} - Clean text without markdown formatting
 */
function cleanMarkdown(text) {
  // Remove bold (**text**)
  text = text.replace(/\*\*(.*?)\*\*/g, '$1');

  // Remove italic (*text* or _text_)
  text = text.replace(/\*(.*?)\*/g, '$1');
  text = text.replace(/_(.*?)_/g, '$1');

  // Remove inline code (`text`)
  text = text.replace(/`(.*?)`/g, '$1');

  // Remove links ([text](url))
  text = text.replace(/\[(.*?)\]\(.*?\)/g, '$1');

  return text;
}

/**
 * Parse the Wiki HTML to extract function information
 */
async function parseWikiHtml() {
  console.log('Parsing Wiki HTML...');

  let html;
  try {
    // Try to fetch from online wiki first
    console.log(`Fetching Lua function data from: ${config.wikiUrl}`);
    html = await fetchUrl(config.wikiUrl);
    console.log('Successfully fetched wiki data online');
    if (!fs.existsSync(path.dirname(config.wikiHtmlPath))) {
      fs.mkdirSync(path.dirname(config.wikiHtmlPath), { recursive: true });
    }
    // Save a local copy for future offline use
    fs.writeFileSync(config.wikiHtmlPath, html);
    console.log(`Saved a local copy to: ${config.wikiHtmlPath}`);
  } catch (error) {
    console.warn(`Failed to fetch from online wiki: ${error.message}`);
    console.log('Falling back to local HTML file...');

    // Fall back to local file if available
    if (fs.existsSync(config.wikiHtmlPath)) {
      html = fs.readFileSync(config.wikiHtmlPath, 'utf8');
      console.log('Using local wiki HTML file');
    } else {
      throw new Error('No wiki data available - both online fetch and local file failed');
    }
  }

  // Parse the HTML content
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // Find the main function table
    const table = document.querySelector('#xwikicontent > table');
    if (!table) {
      throw new Error('Function table not found in Wiki HTML');
    }

    // Process each row in the table
    const rows = table.querySelectorAll('tbody > tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 3) {
        const versionInfo = cells[0].textContent.trim();

        // Get the HTML content of the function cell and convert to markdown
        const functionCell = cells[1];
        const functionHtml = functionCell.innerHTML;
        let functionMarkdown = turndownService.turndown(functionHtml);

        // Split the markdown into lines
        const functionLines = functionMarkdown.split(/\r?\n/);

        // First line is the function signature - clean markdown formatting from it
        const functionSignature = cleanMarkdown(functionLines[0] || '').replace(/\\([\[\]])/g, '$1');

        // Second line is the description (if exists)
        const description = functionLines.length > 1 ? functionLines[1].replace(/^[*_]*/, '').replace(/[*_]*$/, '').trim() : '';

        // Any additional lines form the detailed/extended description
        const detailed = functionLines.length > 2 ? functionLines.slice(2).join('\n').replace(/\n\n/g, '\n').replace(/^\n/, '') : '';

        // Get notes from the notes column if it exists, also convert to markdown
        const notesHtml = cells.length > 2 ? cells[2].innerHTML : '';
        const notes = notesHtml ? turndownService.turndown(notesHtml).trim() : '';

        // Check if function is deprecated
        const isDeprecated = versionInfo.toLowerCase().includes('deprecated');

        // Extract function name and parameters
        const functionNameMatch = functionSignature.match(/(\w+)\s*\((.*?)\)/);
        if (functionNameMatch) {
          const functionName = functionNameMatch[1];
          let paramsStr = functionNameMatch[2];

          // Process parameters
          paramsStr = paramsStr.replace(/\[\s*,\s*/g, ", [");
          const parameters = paramsStr.split(',').map(param => {
            const trimmedParam = param.trim();
            return {
              name: trimmedParam.replace(/\[|\]/g, '').trim(),
              optional: trimmedParam.includes('['),
              type: 'any'
            };
          }).filter(param => param.name);

          // Extract return type if available
          let returnType = 'unknown';
          const returnMatch = functionSignature.match(/^(\w+)\s+/);
          if (returnMatch) {
            const potentialReturnType = returnMatch[1];
            if (potentialReturnType.toLowerCase() !== 'deprecated') {
              returnType = potentialReturnType;
            }
          }

          // Ensure multiline fields are properly formatted with line breaks
          const detailedFormatted = detailed.replace(/\\n/g, '\n');
          const notesFormatted = notes.replace(/\\n/g, '\n');

          // Store function information
          dataStore.luaFunctions.set(functionName, {
            description,
            parameters,
            returnType,
            usages: [],
            deprecated: isDeprecated,
            detailed: detailedFormatted,
            notes: notesFormatted
          });

          // Add to known functions set
          dataStore.knownFunctions.add(functionName);
        }
      }
    });

    console.log(`Parsed ${dataStore.luaFunctions.size} functions from Wiki HTML`);
  } catch (error) {
    console.error('Error parsing Wiki HTML:', error);
    throw error;
  }
}

/**
 * Fetch URL content using Node.js built-in https module
 * @param {string} url - The URL to fetch
 * @returns {Promise<string>} - The response body as string
 */
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'X4LuaDocGenerator/1.0'
      },
      timeout: 10000 // 10 second timeout
    }, (res) => {
      // Check for redirect
      if (res.statusCode === 301 || res.statusCode === 302) {
        if (res.headers.location) {
          console.log(`Following redirect to: ${res.headers.location}`);
          fetchUrl(res.headers.location).then(resolve).catch(reject);
          return;
        }
      }

      // Check for successful response
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP Error: ${res.statusCode}`));
        return;
      }

      // Collect response data
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve(data);
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Process a single Lua file to extract all types of function information
 */
function processLuaFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath);

    // First pass - extract all function definitions to the catalog
    processFunctionDefinitions(content, fileName);

    // Second pass - process specialized function types
    processFfiDefinitionsInFile(content, fileName);
    processHelperFunctionsInFile(content, fileName);
    processGloballyExposedFunctionsInFile(content, fileName);

    // Clean the content for further processing
    const cleanedContent = cleanLuaContent(content);

    // Process additional function patterns
    processLocalAndGlobalDefinitions(cleanedContent);
    processPrefixedFunctionCalls(cleanedContent);

    // Update known functions set
    updateKnownFunctionsSet();
  } catch (error) {
    console.error(`Error processing file ${filePath}: ${error.message}`);
  }
}

/**
 * Extract all function definitions from a file and add them to the function catalog
 * @param {string} content - The file content
 * @param {string} fileName - The name of the file
 */
function processFunctionDefinitions(content, fileName) {
  const cleanedContent = cleanLuaContent(content);

  // Extract various function patterns

  // 1. Regular function definitions: function name(params) ... end
  const globalFunctionPattern = /function\s+(\w+)\s*\((.*?)\)(.*?)end/gs;

  // 2. Namespaced function definitions: function namespace.name(params) ... end
  const namespacedFunctionPattern = /function\s+(\w+)\.(\w+)\s*\((.*?)\)(.*?)end/gs;

  // 3. Table function assignments: namespace.name = function(params) ... end
  const tableFunctionPattern = /(\w+)\.(\w+)\s*=\s*function\s*\((.*?)\)(.*?)end/gs;

  // 4. Local function definitions: local function name(params) ... end
  const localFunctionPattern = /local\s+function\s+(\w+)\s*\((.*?)\)(.*?)end/gs;

  // 5. FFI functions in cdef blocks
  const ffiBlocks = content.match(/ffi\.cdef\[\[([\s\S]*?)\]\]/g);
  if (ffiBlocks) {
    for (const block of ffiBlocks) {
      const ffiContent = block.match(/ffi\.cdef\[\[([\s\S]*?)\]\]/)[1];
      const ffiPattern = /(?:(\w+(?:\s*\*)*)\s+)?(\w+)\s*\((.*?)\);/g;

      let ffiMatch;
      while ((ffiMatch = ffiPattern.exec(ffiContent)) !== null) {
        const returnType = ffiMatch[1] ? ffiMatch[1].trim() : 'void';
        const functionName = ffiMatch[2];
        const params = ffiMatch[3].trim();

        // Add to function catalog with C namespace
        addToCatalog('C', functionName, {
          returnType,
          parameters: parseParameters(params),
          source: fileName,
          declaration: ffiMatch[0].trim(),
          type: 'ffi'
        });
      }
    }
  }

  // Process regular global functions
  let match;
  while ((match = globalFunctionPattern.exec(cleanedContent)) !== null) {
    const functionName = match[1];
    const params = match[2];
    const functionBody = match[3];

    // Skip if this is a namespaced function (will be caught by other pattern)
    if (functionName.includes('.')) continue;

    // Add to function catalog with global namespace
    addToCatalog('global', functionName, {
      parameters: parseParameters(params),
      source: fileName,
      body: functionBody,
      type: 'global'
    });
  }

  // Process namespaced functions
  while ((match = namespacedFunctionPattern.exec(cleanedContent)) !== null) {
    const namespace = match[1];
    const functionName = match[2];
    const params = match[3];
    const functionBody = match[4];

    // Add to function catalog
    addToCatalog(namespace, functionName, {
      parameters: parseParameters(params),
      source: fileName,
      body: functionBody,
      type: 'namespaced'
    });
  }

  // Process table function assignments
  while ((match = tableFunctionPattern.exec(cleanedContent)) !== null) {
    const namespace = match[1];
    const functionName = match[2];
    const params = match[3];
    const functionBody = match[4];

    // Add to function catalog
    addToCatalog(namespace, functionName, {
      parameters: parseParameters(params),
      source: fileName,
      body: functionBody,
      type: 'table'
    });
  }

  // Process local functions
  while ((match = localFunctionPattern.exec(cleanedContent)) !== null) {
    const functionName = match[1];
    const params = match[2];
    const functionBody = match[3];

    // Add to function catalog with local namespace
    addToCatalog('local', functionName, {
      parameters: parseParameters(params),
      source: fileName,
      body: functionBody,
      type: 'local'
    });

    // Also add to local functions set
    dataStore.localFunctions.add(functionName);
  }
}

/**
 * Parse parameters from a parameter string
 * @param {string} paramsStr - Parameter string
 * @returns {Array} Array of parameter objects
 */
function parseParameters(paramsStr) {
  if (!paramsStr || paramsStr.trim() === '') {
    return [];
  }

  return paramsStr.split(',').map(param => {
    const trimmedParam = param.trim();
    const isOptional = trimmedParam.includes('[');
    const name = trimmedParam.replace(/\[|\]/g, '').trim();

    // Try to infer type from name conventions or default values
    let type = 'any';
    if (trimmedParam.includes('=')) {
      const defaultValue = trimmedParam.split('=')[1].trim();
      if (defaultValue.match(/^["'].*["']$/)) {
        type = 'string';
      } else if (!isNaN(Number(defaultValue))) {
        type = 'number';
      } else if (defaultValue === 'true' || defaultValue === 'false') {
        type = 'boolean';
      } else if (defaultValue.startsWith('{') && defaultValue.endsWith('}')) {
        type = 'table';
      }
    }

    return {
      name,
      type,
      optional: isOptional,
      description: ''
    };
  }).filter(param => param.name);
}

/**
 * Add a function to the catalog
 * @param {string} namespace - Function namespace
 * @param {string} functionName - Function name
 * @param {Object} functionInfo - Function information
 */
function addToCatalog(namespace, functionName, functionInfo) {
  // Create the catalog key
  const catalogKey = `${namespace}.${functionName}`;

  // Only add if not already in catalog or if this is more detailed
  if (!dataStore.functionCatalog.has(catalogKey) ||
    dataStore.functionCatalog.get(catalogKey).parameters.length < functionInfo.parameters.length) {

    // Add function return type if not specified
    if (!functionInfo.returnType) {
      // Try to infer return type from body
      if (functionInfo.body) {
        if (functionInfo.body.includes('return true') || functionInfo.body.includes('return false')) {
          functionInfo.returnType = 'boolean';
        } else if (functionInfo.body.match(/return\s+[0-9]/)) {
          functionInfo.returnType = 'number';
        } else if (functionInfo.body.match(/return\s+["']/)) {
          functionInfo.returnType = 'string';
        } else if (functionInfo.body.match(/return\s+\{/)) {
          functionInfo.returnType = 'table';
        } else {
          functionInfo.returnType = 'any';
        }
      } else {
        functionInfo.returnType = 'any';
      }
    }

    // Add empty detailed and notes fields if they don't exist
    if (!functionInfo.detailed) {
      functionInfo.detailed = '';
    }
    if (!functionInfo.notes) {
      functionInfo.notes = '';
    }

    // Store in catalog
    dataStore.functionCatalog.set(catalogKey, functionInfo);

    // Update namespace tracking
    if (!dataStore.namespaces.has(namespace)) {
      dataStore.namespaces.set(namespace, new Set());
    }
    dataStore.namespaces.get(namespace).add(functionName);
  }
}

/**
 * Lookup a function from the catalog
 * @param {string} functionPath - Full function path (namespace.name)
 * @returns {Object|null} Function information or null if not found
 */
function lookupFromCatalog(functionPath) {
  // Direct lookup
  if (dataStore.functionCatalog.has(functionPath)) {
    return dataStore.functionCatalog.get(functionPath);
  }

  // Split into namespace and function name
  const parts = functionPath.split('.');
  if (parts.length !== 2) return null;

  const namespace = parts[0];
  const functionName = parts[1];

  // Check specialized datastores based on namespace
  if (namespace === 'Helper' && dataStore.helperFunctions.has(functionName)) {
    return dataStore.helperFunctions.get(functionName);
  } else if (namespace === 'C' && dataStore.ffiFunctions.has(functionName)) {
    return dataStore.ffiFunctions.get(functionName);
  } else if (namespace === 'global' && dataStore.luaFunctions.has(functionName)) {
    return dataStore.luaFunctions.get(functionName);
  } else if (dataStore.globallyExposedFunctions.has(functionName)) {
    return lookupGloballyExposed(functionName);
  }

  // Check for function in any namespace
  for (const [ns, functions] of dataStore.namespaces.entries()) {
    if (functions.has(functionName)) {
      return dataStore.functionCatalog.get(`${ns}.${functionName}`);
    }
  }

  return null;
}

/**
 * Lookup information about a globally exposed function
 */
function lookupGloballyExposed(functionName) {
  if (dataStore.GloballyExposedFunctions.has(functionName)) {
    const funcInfo = dataStore.GloballyExposedFunctions.get(functionName);

    // If direct mapping, look up the original
    if (funcInfo.type === 'direct') {
      const originalInfo = lookupFromCatalog(funcInfo.original);
      if (originalInfo) {
        return {
          ...originalInfo,
          exposedAs: functionName,
          originalPath: funcInfo.original
        };
      }
    }

    return funcInfo;
  }

  return null;
}

/**
 * Process FFI definitions in a Lua file
 */
function processFfiDefinitionsInFile(content, fileName) {
  // Look for ffi.cdef blocks
  const ffiBlocks = content.match(/ffi\.cdef\[\[([\s\S]*?)\]\]/g);

  if (ffiBlocks) {
    for (const block of ffiBlocks) {
      // Extract the content inside the ffi.cdef block
      const ffiContent = block.match(/ffi\.cdef\[\[([\s\S]*?)\]\]/)[1];

      // Process typedefs
      const typedefMatches = ffiContent.matchAll(/[ \t]+typedef[\s\t]+(struct|enum|union|\w+)([\s\t]+\{\s*[\s\S]*?\s*\}|[\s\t]+\w+)?[\s\t]+(\w+);/g);
      for (const match of typedefMatches) {
        const typeKind = match[1];
        const typeBody = match[2] || '';
        const typeName = match[3];

        // Don't overwrite if we already have this type definition
        if (!dataStore.ffiTypes.has(typeName)) {
          // Store type definition
          dataStore.ffiTypes.set(typeName, {
            kind: typeKind,
            declaration: match[0],
            file: fileName
          });
        }
      }

      // Process functions - improved to handle complex const qualifiers and pointers in parameters
      const functionMatches = ffiContent.matchAll(/(?:((?:const\s+)?(?:\w+(?:\s*\*\s*(?:const)?)*?))\s+)?(\w+)\s*\((.*?)\);/g);
      for (const match of functionMatches) {
        const returnType = match[1] ? match[1].trim() : 'void';
        const functionName = match[2];
        const params = match[3].trim();

        // Don't overwrite if we already have this function
        if (!dataStore.ffiFunctions.has(functionName)) {
          // Parse parameters with improved handling for complex types
          const parameters = [];
          if (params && params !== 'void') {
            const paramList = params.split(',').map(p => p.trim());
            for (const param of paramList) {
              // Enhanced parameter parsing for complex C types including multiple const qualifiers
              const paramParts = param.match(/(?:((?:const\s+)?(?:\w+(?:\s*\*\s*(?:const)?)*?))\s+)?(\w+|\.\.\.)$/);

              if (paramParts) {
                const paramType = paramParts[1] ? paramParts[1].trim() : param.trim();
                const paramName = paramParts[2] !== '...' ? paramParts[2] : 'varargs';

                parameters.push({
                  type: paramType,
                  name: paramName
                });
              } else {
                // Fallback for unrecognized format
                parameters.push({
                  type: param,
                  name: ''
                });
              }
            }
          }

          // Store function definition
          dataStore.ffiFunctions.set(functionName, {
            returnType,
            parameters,
            declaration: match[0].trim(),
            file: fileName,
            detailed: '',
            notes: ''
          });

          // Add to directFfiFunctions set for cross-reference
          dataStore.directFfiFunctions.add(functionName);
        }
      }
    }
  }
}

/**
 * Process Helper functions in a Lua file
 */
function processHelperFunctionsInFile(content, fileName) {
  // Function patterns
  const helperFunctionDefinitionPattern = /function\s+Helper\.(\w+)\s*\((.*?)\)(.*?)end/gs;
  const helperTableFunctionPattern = /Helper\.(\w+)\s*=\s*function\s*\((.*?)\)(.*?)end/gs;

  // Clean the content to remove comments and string literals
  const cleanedContent = cleanLuaContent(content);

  // Find functions in both formats
  let match;

  // Format: function Helper.functionName(params) ... end
  while ((match = helperFunctionDefinitionPattern.exec(cleanedContent)) !== null) {
    const functionName = match[1];
    const parameters = match[2].split(',').map(p => p.trim()).filter(p => p);
    const functionBody = match[3];

    // Don't overwrite if we already have this function
    if (!dataStore.helperFunctions.has(functionName)) {
      extractHelperFunctionInfo(functionName, parameters, functionBody, content, fileName);
    }
  }

  // Format: Helper.functionName = function(params) ... end
  while ((match = helperTableFunctionPattern.exec(cleanedContent)) !== null) {
    const functionName = match[1];
    const parameters = match[2].split(',').map(p => p.trim()).filter(p => p);
    const functionBody = match[3];

    // Don't overwrite if we already have this function
    if (!dataStore.helperFunctions.has(functionName)) {
      extractHelperFunctionInfo(functionName, parameters, functionBody, content, fileName);
    }
  }
}

/**
 * Extract Helper function information
 */
function extractHelperFunctionInfo(functionName, parameters, functionBody, fullContent, fileName) {
  // Try to infer parameter types from function body
  const parameterInfo = parameters.map(param => {
    // Try to infer parameter type from usage
    let paramType = 'any';

    // Look for type checks in function body
    if (functionBody.includes(`type(${param}) == "string"`)) {
      paramType = 'string';
    } else if (functionBody.includes(`type(${param}) == "number"`)) {
      paramType = 'number';
    } else if (functionBody.includes(`type(${param}) == "boolean"`)) {
      paramType = 'boolean';
    } else if (functionBody.includes(`type(${param}) == "table"`)) {
      paramType = 'table';
    } else if (functionBody.includes(`type(${param}) == "function"`)) {
      paramType = 'function';
    }

    return {
      name: param,
      type: paramType,
      description: ''
    };
  });

  // Store function information
  dataStore.helperFunctions.set(functionName, {
    name: functionName,
    parameters: parameterInfo,
    returnType: 'any',
    description: '',
    source: fileName,
    detailed: '', // Add field for future detailed descriptions
    notes: ''     // Add field for future notes
  });
}

/**
 * Process functions exposed via AddGlobalAccess
 */
function processGloballyExposedFunctionsInFile(content, fileName) {
  // Enhanced patterns to match different forms of AddGlobalAccess
  const directMappingPattern = /AddGlobalAccess\s*\(\s*["'](\w+)["']\s*,\s*([\w\.]+)\s*\)/g;
  const wrapperFunctionPattern = /AddGlobalAccess\s*\(\s*["'](\w+)["']\s*,\s*function\s*\((.*?)\)(.*?)return\s+([\w\.]+)\s*\((.*?)\)(.*?)end\s*\)/gs;

  // Process direct mappings (e.g., AddGlobalAccess("ActivateEditBox", widgetSystem.activateEditBox))
  let match;
  while ((match = directMappingPattern.exec(content)) !== null) {
    const exposedFunctionName = match[1];
    const originalFunction = match[2];

    dataStore.globallyExposedFunctions.add(exposedFunctionName);

    // Store detailed mapping information
    dataStore.GloballyExposedFunctions.set(exposedFunctionName, {
      type: 'direct',
      original: originalFunction,
      file: fileName,
      parameters: [], // Will be populated later
      description: `Global access to ${originalFunction}`,
      detailed: '', // Add field for future detailed descriptions
      notes: ''     // Add field for future notes
    });
  }

  // Process wrapper functions (e.g., AddGlobalAccess("DrawRect", function (...) return widgetSystem.queueShapeDraw("rectangle", ...) end))
  while ((match = wrapperFunctionPattern.exec(content)) !== null) {
    const exposedFunctionName = match[1];
    const wrapperParams = match[2].trim();
    const wrapperBody = match[3];
    const targetFunction = match[4];
    const targetParams = match[5];
    const remainingBody = match[6];

    dataStore.globallyExposedFunctions.add(exposedFunctionName);

    // Parse the parameter transformation
    let paramTransformation = 'unknown';
    const fixedParams = [];

    // Extract fixed parameters that are prepended
    if (targetParams) {
      const paramParts = targetParams.split(',').map(p => p.trim());
      let foundSpread = false;

      for (const param of paramParts) {
        if (param === '...') {
          foundSpread = true;
          break;
        } else if (!param.includes('...')) {
          fixedParams.push(param);
        } else {
          // Handle case like "param, ..."
          const parts = param.split('...');
          if (parts[0].trim()) {
            fixedParams.push(parts[0].trim());
          }
          foundSpread = true;
          break;
        }
      }

      if (foundSpread) {
        if (fixedParams.length > 0) {
          paramTransformation = `Prepends fixed parameters: ${fixedParams.join(', ')}`;
        } else {
          paramTransformation = 'Passes all parameters directly';
        }
      } else {
        paramTransformation = `Uses fixed parameters: ${targetParams}`;
      }
    }

    // Store wrapper function information
    dataStore.GloballyExposedFunctions.set(exposedFunctionName, {
      type: 'wrapper',
      original: targetFunction,
      wrapperParams: wrapperParams || '...',
      targetParams: targetParams,
      fixedParams: fixedParams,
      paramTransformation: paramTransformation,
      file: fileName,
      description: `Wrapper for ${targetFunction} with parameter transformation`,
      detailed: '', // Add field for future detailed descriptions
      notes: ''     // Add field for future notes
    });
  }

  // After processing all global access functions:

  // For each direct mapping, try to enrich with original function info
  dataStore.GloballyExposedFunctions.forEach((funcInfo, funcName) => {
    if (funcInfo.type === 'direct') {
      const originalFuncInfo = lookupFromCatalog(funcInfo.original);
      if (originalFuncInfo) {
        // Enrich with original function parameters and return type
        funcInfo.parameters = originalFuncInfo.parameters;
        funcInfo.returnType = originalFuncInfo.returnType;
      }
    }
  });
}

/**
 * Lookup original function information from all available sources
 * @param {string} funcPath - The full path to the function (e.g., "Helper.function", "widgetSystem.function")
 * @returns {Object|null} - Function information or null if not found
 */
function lookupOriginalFunction(funcPath) {
  // Split the path into namespace and function name
  const parts = funcPath.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const namespace = parts[0];
  const funcName = parts[1];

  // Check different data stores based on the namespace
  if (namespace === 'Helper' && dataStore.helperFunctions.has(funcName)) {
    return dataStore.helperFunctions.get(funcName);
  } else if (namespace === 'C' && dataStore.ffiFunctions.has(funcName)) {
    return dataStore.ffiFunctions.get(funcName);
  } else if (dataStore.luaFunctions.has(funcName)) {
    return dataStore.luaFunctions.get(funcName);
  }

  // Check for undocumented functions if they match the exact name
  if (dataStore.undocumentedFunctions.has(funcName)) {
    return dataStore.undocumentedFunctions.get(funcName);
  }

  // If we have prefixed functions, check those
  if (dataStore.prefixedFunctions.has(funcName) &&
    dataStore.prefixedFunctions.get(funcName).has(namespace)) {
    // We know this function exists with this prefix, but don't have details
    return {
      name: funcName,
      parameters: [],
      returnType: 'any',
      description: `Function ${funcName} used with ${namespace} prefix`,
      detailed: '', // Add field for future detailed descriptions
      notes: ''     // Add field for future notes
    };
  }

  return null;
}

/**
 * Process local and global function definitions
 */
function processLocalAndGlobalDefinitions(cleanedContent) {
  const localFunctionDefinitionPattern = /local\s+function\s+(\w+)/g;
  const globalFunctionDefinitionPattern = /function\s+(\w+)\s*\(/g;
  const modulePattern = /^local\s+(\w+)\s*=\s*require/;

  const lines = cleanedContent.split('\n');

  // Find locally defined functions and module imports
  for (const line of lines) {
    // Skip module requires
    if (line.match(modulePattern)) {
      continue;
    }

    // Find local function definitions
    let match;
    while ((match = localFunctionDefinitionPattern.exec(line)) !== null) {
      dataStore.localFunctions.add(match[1]);
    }
    localFunctionDefinitionPattern.lastIndex = 0;

    // Find global function definitions
    while ((match = globalFunctionDefinitionPattern.exec(line)) !== null) {
      dataStore.globalFunctions.add(match[1]);
    }
    globalFunctionDefinitionPattern.lastIndex = 0;
  }
}

/**
 * Process prefixed function calls (like C.FunctionName)
 */
function processPrefixedFunctionCalls(cleanedContent) {
  // Find all prefixed function calls
  const prefixMatches = cleanedContent.matchAll(/(\w+)\.(\w+)\s*\(/g);

  for (const prefixMatch of prefixMatches) {
    const prefix = prefixMatch[1];
    const funcName = prefixMatch[2];

    if (!dataStore.prefixedFunctions.has(funcName)) {
      dataStore.prefixedFunctions.set(funcName, new Set());
    }
    dataStore.prefixedFunctions.get(funcName).add(prefix);
  }
}

/**
 * Update the set of known functions for cross-referencing
 */
function updateKnownFunctionsSet() {
  // Add global function definitions
  dataStore.globalFunctions.forEach(funcName => {
    dataStore.knownFunctions.add(funcName);
  });

  // Add FFI functions with and without C. prefix
  dataStore.ffiFunctions.forEach((_, funcName) => {
    dataStore.knownFunctions.add(funcName);
    dataStore.knownFunctions.add(`C.${funcName}`);
  });

  // Add Helper functions with Helper. prefix
  dataStore.helperFunctions.forEach((_, funcName) => {
    dataStore.knownFunctions.add(`Helper.${funcName}`);
  });

  // Add globally exposed functions
  dataStore.globallyExposedFunctions.forEach(funcName => {
    dataStore.knownFunctions.add(funcName);
  });
}

/**
 * Parse a function argument string, handling nested functions and string concatenation
 * @param {string} argsString - The arguments string from a function call
 * @returns {Array<string>} Array of parsed arguments
 */
function parseArgumentString(argsString) {
  if (!argsString) return [];

  // First, normalize the string by removing whitespace around commas
  argsString = argsString.replace(/\s*,\s*/g, ',');

  const args = [];
  let currentArg = '';
  let parenLevel = 0;
  let bracketLevel = 0;
  let braceLevel = 0;
  let inString = false;
  let stringDelimiter = '';

  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];

    // Handle string literals
    if ((char === '"' || char === "'") && (i === 0 || argsString[i - 1] !== '\\')) {
      if (!inString) {
        inString = true;
        stringDelimiter = char;
      } else if (char === stringDelimiter) {
        inString = false;
      }
    }

    // Handle nested structures
    if (!inString) {
      if (char === '(') parenLevel++;
      else if (char === ')') parenLevel--;
      else if (char === '[') bracketLevel++;
      else if (char === ']') bracketLevel--;
      else if (char === '{') braceLevel++;
      else if (char === '}') braceLevel--;
    }

    // Only split on commas at the top level
    if (char === ',' && parenLevel === 0 && bracketLevel === 0 && braceLevel === 0 && !inString) {
      args.push(currentArg.trim());
      currentArg = '';
    } else {
      currentArg += char;
    }
  }

  // Add the last argument
  if (currentArg.trim()) {
    args.push(currentArg.trim());
  }

  return args;
}

/**
 * Analyze argument list to determine parameter types, with improved handling of nested function calls
 * @param {Array<string>} args - Array of argument strings
 * @returns {Array<string>} Array of parameter types
 */
function analyzeParameterTypes(args) {
  return args.map(arg => {
    // Check for table constructors with varargs (...) inside them
    if (arg.match(/^\{.*\.\.\..*\}$/)) {
      return 'table';  // This is a table with varargs inside
    }

    // Check for function calls in the argument (they'll be treated as 'any' type)
    if (arg.match(/\w+\s*\([^)]*\)/)) {
      // Special case for string formatting functions
      if (arg.match(/string\.format\s*\(/i) || arg.match(/tostring\s*\(/)) {
        return 'string';
      }
      return 'any';  // Most function calls return arbitrary values
    }

    // Check for string concatenation operations using '..'
    if (arg.includes('..')) {
      return 'string';
    }

    // Standard type detection - unchanged
    if (arg === 'true' || arg === 'false') {
      return 'boolean';
    } else if (arg.match(/^".*?"$/) || arg.match(/^'.*?'$/)) {
      return 'string';
    } else if (arg.match(/^[0-9]+(\.[0-9]+)?$/)) {
      return 'number';
    } else if (arg.match(/^\{.*\}$/)) {
      return 'table';
    } else if (arg.match(/^function/)) {
      return 'function';
    }

    // Default type
    return 'any';
  });
}

/**
 * Count actual parameters in a function call by reducing nested calls to placeholders
 * @param {string} argsString - The full argument string
 * @returns {number} The number of top-level parameters
 */
function countActualParameters(argsString) {
  if (!argsString.trim()) return 0;

  // Replace all nested function calls with a placeholder to simplify parameter counting
  // This is a recursive process that handles deeply nested functions
  let simplifiedArgs = argsString;
  let lastLength;

  do {
    lastLength = simplifiedArgs.length;
    // Replace content inside parentheses with empty parentheses
    simplifiedArgs = simplifiedArgs.replace(/\([^()]*\)/g, '()');
  } while (simplifiedArgs.length !== lastLength);

  // Count commas at the top level to determine parameter count
  // Add 1 to account for the last parameter which doesn't have a trailing comma
  return simplifiedArgs.split(',').length;
}

/**
 * Find undocumented function calls in all processed Lua files
 */
function findUndocumentedFunctions(files) {
  console.log('Analyzing for undocumented function calls...');

  const globalFunctionCallPattern = /\b(\w+)\s*\((.*?)\)/g;

  // Create case-insensitive lookup sets for known functions
  const lowerCaseKnownFunctions = new Set(
    Array.from(dataStore.knownFunctions).map(fn => fn.toLowerCase())
  );

  const lowerCaseLocalFunctions = new Set(
    Array.from(dataStore.localFunctions).map(fn => fn.toLowerCase())
  );

  // Known functions that take a single string parameter even if it contains concatenation
  const singleStringParamFunctions = new Set(['DebugError', 'Logf', 'ErrorLog', 'DebugLog']);

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const cleanedContent = cleanLuaContent(content);

      // Use a more robust pattern to extract function calls with their full arguments
      // This captures the function name and the complete argument string including nested functions
      const matches = Array.from(cleanedContent.matchAll(/\b(\w+)\s*\(((?:[^()]|\([^()]*\))*)\)/g));

      for (const match of matches) {
        const functionName = match[1];
        const argsString = match[2].trim();

        // Rest of your existing checks...
        const isAllLowercase = functionName === functionName.toLowerCase();
        const isAllUppercase = functionName === functionName.toUpperCase();

        // Skip if the function is known or meets any exclusion criteria
        if (dataStore.knownFunctions.has(functionName) ||
          dataStore.localFunctions.has(functionName) ||
          luaStdLib.has(functionName) ||
          dataStore.globalFunctions.has(functionName) ||
          // Skip functions with same name but different case
          lowerCaseKnownFunctions.has(functionName.toLowerCase()) ||
          lowerCaseLocalFunctions.has(functionName.toLowerCase()) ||
          // Skip functions that have all lowercase or all uppercase names
          isAllLowercase ||
          isAllUppercase ||
          // Skip if the first character is lowercase (likely a local helper)
          (functionName[0] === functionName[0].toLowerCase() &&
            functionName[0] !== functionName[0].toUpperCase()) ||
          // Skip functions that appear with C. prefix elsewhere
          (dataStore.prefixedFunctions.has(functionName) &&
            dataStore.prefixedFunctions.get(functionName).has('C')) ||
          // Skip functions defined in FFI blocks
          dataStore.directFfiFunctions.has(functionName)) {
          continue;
        }

        // Parse args more intelligently to handle string concatenation and nested functions
        let args = parseArgumentString(argsString);

        // Analyze arguments and determine parameter types with improved handling of nested functions
        const paramTypes = analyzeParameterTypes(args);

        // Check for class method calls using : notation (false positive)
        const beforeCall = content.substring(0, match.index);
        const lastChar = beforeCall.trimEnd().slice(-1);
        if (lastChar === ':' || lastChar === '.') {
          continue;
        }

        // Store information about this undocumented function
        if (!dataStore.undocumentedFunctions.has(functionName)) {
          dataStore.undocumentedFunctions.set(functionName, {
            name: functionName,
            parameters: [],
            returnType: 'any',
            description: `Undocumented function found in ${path.basename(filePath)}`,
            usages: [],
            files: new Set(),
            detailed: '',
            notes: ''
          });
        }

        const funcInfo = dataStore.undocumentedFunctions.get(functionName);
        funcInfo.files.add(path.basename(filePath));

        // Store usage information
        funcInfo.usages.push({
          file: path.basename(filePath),
          arguments: args
        });

        // Create merged parameter info using all our data with improved parameter count accuracy
        const mergedParams = mergeParameterInfo(funcInfo.parameters, args, paramTypes);
        funcInfo.parameters = mergedParams;
      }
    } catch (error) {
      console.error(`Error analyzing ${filePath} for undocumented functions: ${error.message}`);
    }
  }

  console.log(`Found ${dataStore.undocumentedFunctions.size} potentially undocumented functions`);
}

/**
 * Merge and update parameter information based on new arguments and types
 * @param {Array} existingParams - Existing parameter info
 * @param {Array<string>} args - Arguments from function call
 * @param {Array<string>} paramTypes - Parameter types from analysis
 * @returns {Array} Updated parameter info
 */
function mergeParameterInfo(existingParams, args, paramTypes) {
  // Special case: if first argument is a string built with concatenation or formatting,
  // and there appears to be many arguments, treat it as a single string parameter
  if (paramTypes.length > 0 && paramTypes[0] === 'string' &&
    (args[0].includes('..') || args[0].match(/string\.format\s*\(/i))) {
    // Check if this is actually a string formatting call with multiple arguments
    // If so, we should view it as a single string parameter with other parameters
    const isStringFormatWithParams = args[0].match(/string\.format\s*\(/i) && args.length > 1;

    if (args[0].includes('..') || !isStringFormatWithParams) {
      // Consolidated single string parameter case (like DebugError with concatenation)
      if (existingParams.length === 0) {
        return [{
          name: 'text',
          type: 'string',
          description: 'The text string (supports concatenation and formatting)'
        }];
      } else if (existingParams.length === 1) {
        // Keep existing parameter but ensure it's marked as string
        return [{
          ...existingParams[0],
          type: 'string'
        }];
      }
    }
  }

  // Handle table with varargs: {one, two, ...}
  if (args.length === 1 && paramTypes[0] === 'table' && args[0].match(/^\{.*\.\.\..*\}$/)) {
    // If this is a table with varargs, treat it as a single parameter
    if (existingParams.length === 0 || (existingParams.length === 1 && existingParams[0].name === 'arg1')) {
      return [{
        name: 'args',
        type: 'table',
        description: 'Table with variable arguments'
      }];
    } else if (existingParams.length === 1) {
      // Keep existing parameter but ensure it's marked as table
      return [{
        ...existingParams[0],
        type: 'table',
        description: existingParams[0].description || 'Table with variable arguments'
      }];
    }
  }

  // Standard case: extend parameter list if needed
  let updatedParams = [...existingParams];

  // Make sure we have enough parameters
  while (updatedParams.length < args.length) {
    updatedParams.push({
      name: `arg${updatedParams.length + 1}`,
      type: 'any',
      description: ''
    });
  }

  // Update parameter types based on our analysis
  for (let i = 0; i < args.length; i++) {
    // Only update type if we have a more specific type than 'any'
    if (paramTypes[i] !== 'any' && updatedParams[i].type === 'any') {
      updatedParams[i].type = paramTypes[i];
    }

    // Enhanced parameter name handling:

    // 1. If the argument is a simple identifier, use it as the parameter name
    if (args[i].match(/^\w+$/) && !args[i].match(/^(true|false|nil|function)$/) && updatedParams[i].name === `arg${i + 1}`) {
      updatedParams[i].name = args[i];
    }
    // 2. If argument is a numeric literal, use as param name prefixed with 'value'
    else if (args[i].match(/^[0-9]+(\.[0-9]+)?$/) && updatedParams[i].name === `arg${i + 1}`) {
      updatedParams[i].name = 'value';
      updatedParams[i].description = `Literal value: ${args[i]}`;
    }
    // 3. If argument is a string literal, extract content as param name or description
    else if (args[i].match(/^["'](.+)["']$/) && updatedParams[i].name === `arg${i + 1}`) {
      const stringContent = args[i].match(/^["'](.+)["']$/)[1];

      // Use string content for parameter name if it's a simple identifier
      if (stringContent.match(/^\w+$/)) {
        updatedParams[i].name = stringContent;
      } else {
        // Otherwise, use as description
        updatedParams[i].name = 'text';
        updatedParams[i].description = `Example: ${stringContent}`;
      }
    }
    // 4. If argument is true/false, use a more descriptive name
    else if ((args[i] === 'true' || args[i] === 'false') && (updatedParams[i].name === `arg${i + 1}` || updatedParams[i].type === 'any')) {
      if (updatedParams[i].name === `arg${i + 1}`) {
        updatedParams[i].name = 'flag';
      }
      updatedParams[i].type = 'boolean';
      updatedParams[i].description = `Boolean flag, example: ${args[i]}`;
    }
    // 5. If argument is a table constructor, provide a better name
    else if (args[i].match(/^\{.*\}$/) && updatedParams[i].name === `arg${i + 1}`) {
      if (args[i].match(/^\{.*\.\.\..*\}$/)) {
        updatedParams[i].name = 'args';
        updatedParams[i].description = 'Table with variable arguments';
      } else {
        updatedParams[i].name = 'options';
        updatedParams[i].description = 'Table of options';
      }
    }
  }

  return updatedParams;
}

/**
 * Generate Lua API annotations file
 */
function generateLuaApiAnnotations() {
  console.log('Generating Lua API annotations...');

  let output = '---@meta\n\n';
  output += '-- X4: Foundations Lua API\n';
  output += '-- Generated automatically from Wiki documentation\n\n';

  // Convert Map to sorted array for alphabetical output
  const sortedFunctions = Array.from(dataStore.luaFunctions.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));

  for (const [funcName, funcInfo] of sortedFunctions) {
    // Add function description as comment
    if (funcInfo.description) {
      output += `-- ${funcInfo.description.replace(/\n/g, '\n-- ')}\n`;
    }

    // Add detailed information if available
    if (funcInfo.detailed) {
      output += `-- Detailed: ${funcInfo.detailed.replace(/\n/g, '\n-- ')}\n`;
    }

    // Add notes if available - with proper indentation for multi-line notes
    if (funcInfo.notes) {
      const notesLines = funcInfo.notes.split(/\r?\n/);
      if (notesLines.length > 0) {
        output += `-- Notes: ` + (notesLines.length > 1 ? '\n' : '') + `--   ${notesLines[0]}\n`;
        // Add remaining lines with 2-space indentation
        if (notesLines.length > 1) {
          for (let i = 1; i < notesLines.length; i++) {
            output += `--   ${notesLines[i]}\n`;
          }
        }
      }
    }

    if (funcInfo.deprecated) {
      output += '---@deprecated\n';
    }

    // Add parameter annotations
    funcInfo.parameters.forEach(param => {
      const optionalFlag = param.optional ? '?' : '';
      output += `---@param ${param.name}${optionalFlag} ${param.type}\n`;
    });

    // Add return type annotation
    if (funcInfo.returnType && funcInfo.returnType !== 'unknown') {
      output += `---@return ${funcInfo.returnType}\n`;
    }

    // Add function declaration
    const params = funcInfo.parameters.map(p => p.name).join(', ');
    output += `function ${funcName}(${params}) end\n\n`;
  }

  // Write to file
  fs.writeFileSync(config.outputPaths.lua, output);
  console.log(`Generated Lua API annotations at ${config.outputPaths.lua}`);
}

/**
 * Generate FFI API annotations file
 */
function generateFfiApiAnnotations() {
  console.log('Generating FFI API annotations...');

  let output = '---@meta\n\n';

  // Load FFI and C namespace definitions
  const ffiNamespace = loadFfiNamespace();
  const cNamespace = loadCNamespace();

  // Add description
  output += ffiNamespace.description + '\n\n';

  // Add FFI methods
  for (const method of ffiNamespace.methods) {
    if (method.description) {
      output += `--${method.description}\n`;
    }

    // Add parameter annotations
    if (method.parameters) {
      method.parameters.forEach(param => {
        const description = param.description ? ` ${param.description}` : '';
        output += `---@param ${param.name} ${param.type}${description}\n`;
      });
    }

    // Add return type if specified
    if (method.returnType) {
      output += `---@return ${method.returnType}\n`;
    }

    // Add function declaration
    const params = method.parameters ? method.parameters.map(p => p.name).join(', ') : '';
    output += `function ffi.${method.name}(${params}) end\n\n`;
  }

  // Add C namespace
  output += cNamespace.description + '\n\n';

  // Add custom C namespace methods if any
  for (const method of cNamespace.methods || []) {
    if (method.description) {
      output += `--${method.description}\n`;
    }

    // Add parameter annotations
    if (method.parameters) {
      method.parameters.forEach(param => {
        const description = param.description ? ` ${param.description}` : '';
        output += `---@param ${param.name} ${param.type}${description}\n`;
      });
    }

    // Add return type if specified
    if (method.returnType) {
      output += `---@return ${method.returnType}\n`;
    }

    // Add function declaration
    const params = method.parameters ? method.parameters.map(p => p.name).join(', ') : '';
    output += `function C.${method.name}(${params}) end\n\n`;
  }

  // Convert Map to sorted array for alphabetical output
  const sortedFunctions = Array.from(dataStore.ffiFunctions.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));

  // Add all FFI functions
  for (const [funcName, funcInfo] of sortedFunctions) {
    // Add function description as comment
    output += `-- FFI Function: ${funcInfo.declaration}\n`;

    // Add parameter annotations
    funcInfo.parameters.forEach(param => {
      output += `---@param ${param.name || 'arg'} ${param.type || 'any'}\n`;
    });

    // Add return type annotation
    if (funcInfo.returnType && funcInfo.returnType !== 'void') {
      output += `---@return ${funcInfo.returnType}\n`;
    }

    // Add function declaration
    const params = funcInfo.parameters.map(p => p.name || 'arg').join(', ');
    output += `function C.${funcName}(${params}) end\n\n`;
  }

  // Write to file
  fs.writeFileSync(config.outputPaths.ffi, output);
  console.log(`Generated FFI API annotations at ${config.outputPaths.ffi}`);

  // Generate separate file for FFI types
  generateFfiTypesAnnotations();
}

/**
 * Generate FFI Types annotations file
 */
function generateFfiTypesAnnotations() {
  console.log('Generating FFI Types annotations...');

  let output = '---@meta\n\n';
  output += '-- X4: Foundations FFI Types\n';
  output += '-- Generated automatically from game files\n\n';

  // Convert Map to sorted array for alphabetical output
  const sortedTypes = Array.from(dataStore.ffiTypes.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));

  // Add all FFI types
  for (const [typeName, typeInfo] of sortedTypes) {
    output += `-- ${typeInfo.declaration}\n`;
    output += `---@class ${typeName}\n`;

    // If it's a struct or union type with fields, add field annotations
    if (typeInfo.kind === 'struct' || typeInfo.kind === 'union') {
      const typeMatch = typeInfo.declaration.match(/\{([\s\S]*)\}/);
      if (typeMatch) {
        const fields = typeMatch[1].trim().split(';').filter(f => f.trim());
        for (const field of fields) {
          // Enhanced regex to handle complex const pointer types like "const char*const connectionname"
          // This regex captures:
          // 1. Full type with all qualifiers and pointers (const char*const)
          // 2. Variable name (connectionname)
          // 3. Optional array size
          const fieldMatch = field.trim().match(
            /([a-zA-Z0-9_\s\*]+(?:const|volatile|restrict|unsigned|signed)?(?:\s*\*\s*(?:const|volatile|restrict)?)*)\s+([a-zA-Z0-9_]+)(?:\s*\[\s*(\d+)\s*\])?/
          );

          if (fieldMatch) {
            // Clean up type by removing extra spaces and normalizing
            let fieldType = fieldMatch[1].trim().replace(/\s+/g, ' ');
            const fieldName = fieldMatch[2];
            const isArray = fieldMatch[3] !== undefined;

            // Normalize pointer syntax for LuaLS annotations
            if (fieldType.includes('*')) {
              // For any pointer types like "const char*const", convert to "cdata*"
              fieldType = 'cdata*';
            }

            output += `---@field ${fieldName} ${fieldType}${isArray ? '[]' : ''}\n`;
          }
        }
      }
    }

    output += '\n';
  }

  // Write to file
  fs.writeFileSync(config.outputPaths.ffiTypes, output);
  console.log(`Generated FFI Types annotations at ${config.outputPaths.ffiTypes}`);
}

/**
 * Generate Helper API annotations file
 */
function generateHelperApiAnnotations() {
  console.log('Generating Helper API annotations...');

  let output = '---@meta\n\n';
  output += '-- X4: Foundations Helper API\n';
  output += '-- Generated automatically from game files\n\n';

  // Add Helper namespace
  output += 'Helper = {}\n\n';

  // Convert Map to sorted array for alphabetical output
  const sortedFunctions = Array.from(dataStore.helperFunctions.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));

  // Add all Helper functions
  for (const [funcName, funcInfo] of sortedFunctions) {
    // Add function description as comment
    if (funcInfo.description) {
      output += `-- ${funcInfo.description.replace(/\n/g, '\n-- ')}\n`;
    }
    output += `-- Source: ${funcInfo.source}\n`;

    // Add notes if available - with proper indentation
    if (funcInfo.notes) {
      const notesLines = funcInfo.notes.split(/\r?\n/);
      if (notesLines.length > 0) {
        output += `-- Notes: ${notesLines[0]}\n`;
        // Add remaining lines with 2-space indentation
        if (notesLines.length > 1) {
          for (let i = 1; i < notesLines.length; i++) {
            output += `--   ${notesLines[i]}\n`;
          }
        }
      }
    }

    // Add parameter annotations
    funcInfo.parameters.forEach(param => {
      output += `---@param ${param.name} ${param.type}\n`;
    });

    // Add return type annotation
    if (funcInfo.returnType && funcInfo.returnType !== 'unknown') {
      output += `---@return ${funcInfo.returnType}\n`;
    }

    // Add function declaration
    const params = funcInfo.parameters.map(p => p.name).join(', ');
    output += `function Helper.${funcName}(${params}) end\n\n`;
  }

  // Write to file
  fs.writeFileSync(config.outputPaths.helper, output);
  console.log(`Generated Helper API annotations at ${config.outputPaths.helper}`);
}

/**
 * Generate Undocumented API annotations file with improved parameter detection
 */
function generateUndocumentedApiAnnotations() {
  console.log('Generating Undocumented API annotations...');

  let output = '---@meta\n\n';
  output += '-- X4: Foundations Undocumented API\n';
  output += '-- Generated automatically by analyzing game files\n';
  output += '-- These functions are not officially documented and may change without notice\n\n';

  // Known functions that take a single string parameter even if it looks like multiple
  const singleStringParamFunctions = new Set(['DebugError', 'Logf', 'ErrorLog', 'DebugLog']);

  // Convert Map to sorted array for alphabetical output
  const sortedFunctions = Array.from(dataStore.undocumentedFunctions.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));

  for (const [funcName, funcInfo] of sortedFunctions) {
    // Add function description as comment
    if (funcInfo.description) {
      output += `-- ${funcInfo.description.replace(/\n/g, '\n-- ')}\n`;
    }

    // Add files where this function was found
    if (funcInfo.files && funcInfo.files.size > 0) {
      output += `-- Found in: ${Array.from(funcInfo.files).sort().join(', ')}\n`;
    }

    // Special case for known functions that take a single string parameter
    if (singleStringParamFunctions.has(funcName)) {
      output += `---@param message string # Message to display/log (can include string concatenation)\n`;
      output += `function ${funcName}(message) end\n\n`;
      continue;
    }

    // Add notes if available - with proper indentation
    if (funcInfo.notes) {
      const notesLines = funcInfo.notes.split(/\r?\n/);
      if (notesLines.length > 0) {
        output += `-- Notes: ${notesLines[0]}\n`;
        // Add remaining lines with 2-space indentation
        if (notesLines.length > 1) {
          for (let i = 1; i < notesLines.length; i++) {
            output += `--   ${notesLines[i]}\n`;
          }
        }
      }
    }

    // Add parameter annotations with improved naming
    funcInfo.parameters.forEach(param => {
      const description = param.description ? ` # ${param.description}` : '';
      output += `---@param ${param.name} ${param.type}${description}\n`;
    });

    // Add return type annotation
    if (funcInfo.returnType && funcInfo.returnType !== 'unknown') {
      output += `---@return ${funcInfo.returnType}\n`;
    }

    // Add function declaration
    const params = funcInfo.parameters.map(p => p.name).join(', ');
    output += `function ${funcName}(${params}) end\n\n`;
  }

  // Write to file
  fs.writeFileSync(config.outputPaths.undocumented, output);
  console.log(`Generated Undocumented API annotations at ${config.outputPaths.undocumented}`);
}

/**
 * Generate Global Access annotations files - main file and namespace-specific files
 */
function generateGloballyExposedAnnotations() {
  console.log('Generating Global Access annotations...');

  // Group functions by their source namespace
  const namespaceGroups = new Map();

  // Convert to sorted array first
  const sortedFunctions = Array.from(dataStore.GloballyExposedFunctions.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));

  // Group functions by source namespace
  for (const [funcName, funcInfo] of sortedFunctions) {
    // Extract namespace from original function path (e.g., "widgetSystem.activateEditBox" -> "widgetSystem")
    const originalParts = funcInfo.original.split('.');
    if (originalParts.length === 2) {
      const namespace = originalParts[0];

      if (!namespaceGroups.has(namespace)) {
        namespaceGroups.set(namespace, []);
      }
      namespaceGroups.get(namespace).push([funcName, funcInfo]);
    }
  }


  // Generate namespace-specific files
  for (const [namespace, functions] of namespaceGroups.entries()) {
    if (functions.length === 0) continue;

    // Create a specific output path for this namespace in the Lua output directory
    const nsOutputPath = path.join(
      config.luaOutputPath,
      `X4GloballyExposed_${namespace}.lua`
    );

    let output = '---@meta\n\n';
    output += `-- X4: Foundations Globally Exposed Functions from ${namespace}\n`;
    output += '-- Generated automatically from game files\n';
    output += `-- These functions are made globally accessible via AddGlobalAccess from the ${namespace} module\n\n`;

    // Process functions for this namespace
    for (const [funcName, funcInfo] of functions) {
      output += generateGloballyExposedFunctionAnnotation(funcName, funcInfo);
    }

    // Write namespace-specific file
    fs.writeFileSync(nsOutputPath, output);
    console.log(`Generated Global Access annotations for ${namespace} at ${nsOutputPath}`);
  }
}

/**
 * Generate annotation for a single global access function
 * @param {string} funcName - The function name
 * @param {Object} funcInfo - The function information
 * @returns {string} - The generated annotation
 */
function generateGloballyExposedFunctionAnnotation(funcName, funcInfo) {
  let output = '';

  // Add function description
  output += `-- ${funcInfo.description}\n`;
  output += `-- Mapped from: ${funcInfo.original}\n`;
  output += `-- Source: ${funcInfo.file}\n`;

  if (funcInfo.type === 'wrapper') {
    output += `-- Parameter transformation: ${funcInfo.paramTransformation}\n`;
  }

  // Try to find the original function information from catalog
  const originalFuncInfo = lookupFromCatalog(funcInfo.original);

  // Process parameters based on function type
  if (funcInfo.type === 'direct') {
    // For direct mapping, use original function parameters if available
    if (originalFuncInfo && originalFuncInfo.parameters) {
      originalFuncInfo.parameters.forEach(param => {
        const optionalFlag = param.optional ? '?' : '';
        output += `---@param ${param.name}${optionalFlag} ${param.type}\n`;
      });
    } else if (funcInfo.parameters && funcInfo.parameters.length > 0) {
      // Use the parameters we fetched earlier
      funcInfo.parameters.forEach(param => {
        const optionalFlag = param.optional ? '?' : '';
        output += `---@param ${param.name}${optionalFlag} ${param.type}\n`;
      });
    } else {
      output += `---@param ... any # Original function parameters unknown\n`;
    }

    // Add return type
    const returnType = (originalFuncInfo && originalFuncInfo.returnType) ||
      funcInfo.returnType || 'any';
    if (returnType !== 'unknown' && returnType !== 'void') {
      output += `---@return ${returnType}\n`;
    }

    // Generate function declaration
    if ((originalFuncInfo && originalFuncInfo.parameters) ||
      (funcInfo.parameters && funcInfo.parameters.length > 0)) {
      const params = (originalFuncInfo ? originalFuncInfo.parameters : funcInfo.parameters)
        .map(p => p.name).join(', ');
      output += `function ${funcName}(${params}) end\n\n`;
    } else {
      output += `function ${funcName}(...) end\n\n`;
    }
  } else {
    // For wrapper functions, adjust parameters based on the transformation
    if (originalFuncInfo && originalFuncInfo.parameters) {
      const fixedParamCount = funcInfo.fixedParams.length;

      // If we have fixed parameters that replace the first N original parameters
      if (fixedParamCount > 0 && funcInfo.targetParams.includes('...')) {
        // Skip the first N parameters that are replaced by fixed values
        originalFuncInfo.parameters.slice(fixedParamCount).forEach(param => {
          const optionalFlag = param.optional ? '?' : '';
          output += `---@param ${param.name}${optionalFlag} ${param.type}\n`;
        });
      } else if (!funcInfo.targetParams.includes('...')) {
        // If no variable arguments, the function might not take any parameters
        // or has completely custom parameters
        if (funcInfo.wrapperParams && funcInfo.wrapperParams !== '...') {
          // If we have explicit wrapper params, use those
          funcInfo.wrapperParams.split(',').map(p => p.trim()).forEach((param, index) => {
            output += `---@param ${param} any\n`;
          });
        }
      } else {
        // For cases where all original parameters are used
        originalFuncInfo.parameters.forEach(param => {
          const optionalFlag = param.optional ? '?' : '';
          output += `---@param ${param.name}${optionalFlag} ${param.type}\n`;
        });
      }

      // Add return type from original function
      if (originalFuncInfo.returnType && originalFuncInfo.returnType !== 'unknown') {
        output += `---@return ${originalFuncInfo.returnType}\n`;
      }
    } else {
      // If we can't determine specific parameters
      if (funcInfo.wrapperParams && funcInfo.wrapperParams !== '...') {
        // Use the wrapper parameters if explicitly defined
        funcInfo.wrapperParams.split(',').map(p => p.trim()).forEach(param => {
          output += `---@param ${param} any\n`;
        });
      } else {
        output += `---@param ... any # Parameters derived from ${funcInfo.original}\n`;
      }
    }

    // Generate function declaration
    if (funcInfo.wrapperParams && funcInfo.wrapperParams !== '...') {
      output += `function ${funcName}(${funcInfo.wrapperParams}) end\n\n`;
    } else {
      output += `function ${funcName}(...) end\n\n`;
    }
  }

  return output;
}

// JSON import/export functions for each data type
/**
 * Export data to JSON file
 * @param {string} dataType - Type of data to export ('lua', 'ffi', 'helper', 'undocumented', 'GloballyExposed')
 */
function exportToJson(dataType) {
  console.log(`Exporting ${dataType} data to JSON...`);

  let data;
  switch (dataType) {
    case 'lua':
      // Convert Map to Object for JSON serialization and sort
      data = sortObjectByKeys(Object.fromEntries(
        Array.from(dataStore.luaFunctions.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      ));
      break;
    case 'ffi':
      // Create combined FFI data object with sorted components
      data = {
        functions: sortObjectByKeys(Object.fromEntries(
          Array.from(dataStore.ffiFunctions.entries()).sort((a, b) => a[0].localeCompare(b[0]))
        )),
        types: sortObjectByKeys(Object.fromEntries(
          Array.from(dataStore.ffiTypes.entries()).sort((a, b) => a[0].localeCompare(b[0]))
        ))
      };
      break;
    case 'helper':
      data = sortObjectByKeys(Object.fromEntries(
        Array.from(dataStore.helperFunctions.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      ));
      break;
    case 'undocumented':
      // Convert Set to Array for JSON serialization and sort
      data = sortObjectByKeys(Object.fromEntries(
        Array.from(dataStore.undocumentedFunctions.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([key, value]) => {
            return [
              key,
              {
                ...value,
                files: Array.from(value.files || []).sort()
              }
            ];
          })
      ));
      break;
    case 'GloballyExposed':
      data = sortObjectByKeys(Object.fromEntries(
        Array.from(dataStore.GloballyExposedFunctions.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      ));
      break;
    default:
      throw new Error(`Unknown data type: ${dataType}`);
  }

  // Get the appropriate file path
  const filePath = config.jsonPaths[dataType];
  if (!filePath) {
    throw new Error(`No JSON path configured for data type: ${dataType}`);
  }

  // Write to file
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`Exported ${dataType} data to ${filePath}`);
}

/**
 * Sort an object by its keys recursively
 * @param {Object} obj - The object to sort
 * @returns {Object} - A new object with sorted keys
 */
function sortObjectByKeys(obj) {
  // If not an object or null, return as is
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  // Get sorted keys
  const sortedKeys = Object.keys(obj).sort();

  // Create new object with sorted keys
  const result = {};
  for (const key of sortedKeys) {
    // Recursively sort nested objects
    result[key] = sortObjectByKeys(obj[key]);
  }

  return result;
}

/**
 * Import data from JSON file
 * @param {string} dataType - Type of data to import ('lua', 'ffi', 'helper', 'undocumented', 'GloballyExposed')
 */
function importFromJson(dataType) {
  console.log(`Importing ${dataType} data from JSON...`);

  // Get the appropriate file path
  const filePath = config.jsonPaths[dataType];
  if (!filePath) {
    throw new Error(`No JSON path configured for data type: ${dataType}`);
  }

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    console.warn(`JSON file ${filePath} doesn't exist, skipping import.`);
    return;
  }

  try {
    const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    switch (dataType) {
      case 'lua':
        dataStore.luaFunctions = new Map(Object.entries(jsonData));
        // Update knownFunctions set
        dataStore.luaFunctions.forEach((_, key) => {
          dataStore.knownFunctions.add(key);
        });
        console.log(`Imported ${dataStore.luaFunctions.size} Lua functions`);
        break;
      case 'ffi':
        if (jsonData.functions) {
          dataStore.ffiFunctions = new Map(Object.entries(jsonData.functions));
        }
        if (jsonData.types) {
          dataStore.ffiTypes = new Map(Object.entries(jsonData.types));
        }
        console.log(`Imported ${dataStore.ffiFunctions.size} FFI functions and ${dataStore.ffiTypes.size} types`);
        break;
      case 'helper':
        dataStore.helperFunctions = new Map(Object.entries(jsonData));
        console.log(`Imported ${dataStore.helperFunctions.size} Helper functions`);
        break;
      case 'undocumented':
        // Restore Set objects from Arrays in the JSON
        dataStore.undocumentedFunctions = new Map(
          Object.entries(jsonData).map(([key, value]) => {
            return [
              key,
              {
                ...value,
                files: new Set(value.files || [])
              }
            ];
          })
        );
        console.log(`Imported ${dataStore.undocumentedFunctions.size} undocumented functions`);
        break;
      case 'GloballyExposed':
        dataStore.GloballyExposedFunctions = new Map(Object.entries(jsonData));
        // Also add to globallyExposedFunctions Set
        dataStore.GloballyExposedFunctions.forEach((_, key) => {
          dataStore.globallyExposedFunctions.add(key);
        });
        console.log(`Imported ${dataStore.GloballyExposedFunctions.size} global access functions`);
        break;
      default:
        throw new Error(`Unknown data type: ${dataType}`);
    }
  } catch (error) {
    console.error(`Error importing ${dataType} data from JSON:`, error);
    throw error;
  }
}

/**
 * Stringify a value to hjson format
 * @param {*} value - The value to stringify
 * @returns {string} - The hjson string representation of the value
 */

function hJSONStringify(value) {
  return hJSON.stringify(value, {
    space: 2,
    bracesSameLine: true,
    // quotes: 'strings',
    multiline: 'std',  // Changed from 'std' to 'all' to force multiline formatting
    // separator: true,
    colors: false
  });
}

/**
 * Export data to hjson file
 * @param {string} dataType - Type of data to export ('lua', 'ffi', 'helper', 'undocumented', 'GloballyExposed')
 */
function exportTohjson(dataType) {
  console.log(`Exporting ${dataType} data to hjson...`);

  let data;
  switch (dataType) {
    case 'lua':
      // Convert Map to Object for hjson serialization and sort
      data = Object.fromEntries(
        Array.from(dataStore.luaFunctions.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
      );
      break;
    case 'ffi':
      // Create combined FFI data object with sorted components
      data = {
        functions: Object.fromEntries(
          Array.from(dataStore.ffiFunctions.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
        ),
        types: Object.fromEntries(
          Array.from(dataStore.ffiTypes.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
        )
      };
      break;
    case 'helper':
      data = Object.fromEntries(
        Array.from(dataStore.helperFunctions.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
      );
      break;
    case 'undocumented':
      // Convert Set to Array for hjson serialization and sort
      data = Object.fromEntries(
        Array.from(dataStore.undocumentedFunctions.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([key, value]) => {
            return [
              key,
              {
                ...value,
                files: Array.from(value.files || []).sort()
              }
            ];
          })
      );
      break;
    case 'GloballyExposed':
      data = Object.fromEntries(
        Array.from(dataStore.GloballyExposedFunctions.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
      );
      break;
    default:
      throw new Error(`Unknown data type: ${dataType}`);
  }

  // Get the appropriate file path
  const filePath = config.hjsonPaths[dataType];
  if (!filePath) {
    throw new Error(`No hjson path configured for data type: ${dataType}`);
  }

  fs.writeFileSync(filePath, hJSONStringify(data));
  console.log(`Exported ${dataType} data to ${filePath}`);
}

/**
 * Import data from hjson file
 * @param {string} dataType - Type of data to import ('lua', 'ffi', 'helper', 'undocumented', 'GloballyExposed')
 */
function importFromhjson(dataType) {
  console.log(`Importing ${dataType} data from hjson...`);

  // Get the appropriate file path
  const hjsonPath = config.hjsonPaths[dataType];

  if (!fs.existsSync(hjsonPath)) {
    console.warn(`No hjson file ${hjsonPath} exists, skipping import.`);
    return;
  }

  try {
    // Parse file using hjson
    let inputData = hJSON.parse(fs.readFileSync(hjsonPath, 'utf8'));

    // Process data the same way regardless of source format
    switch (dataType) {
      case 'lua':
        dataStore.luaFunctions = new Map(Object.entries(inputData));
        // Update knownFunctions set
        dataStore.luaFunctions.forEach((_, key) => {
          dataStore.knownFunctions.add(key);
        });
        console.log(`Imported ${dataStore.luaFunctions.size} Lua functions`);
        break;
      case 'ffi':
        if (inputData.functions) {
          dataStore.ffiFunctions = new Map(Object.entries(inputData.functions));
        }
        if (inputData.types) {
          dataStore.ffiTypes = new Map(Object.entries(inputData.types));
        }
        console.log(`Imported ${dataStore.ffiFunctions.size} FFI functions and ${dataStore.ffiTypes.size} types`);
        break;
      case 'helper':
        dataStore.helperFunctions = new Map(Object.entries(inputData));
        console.log(`Imported ${dataStore.helperFunctions.size} Helper functions`);
        break;
      case 'undocumented':
        // Restore Set objects from Arrays in the hjson
        dataStore.undocumentedFunctions = new Map(
          Object.entries(inputData).map(([key, value]) => {
            return [
              key,
              {
                ...value,
                files: new Set(value.files || [])
              }
            ];
          })
        );
        console.log(`Imported ${dataStore.undocumentedFunctions.size} undocumented functions`);
        break;
      case 'GloballyExposed':
        dataStore.GloballyExposedFunctions = new Map(Object.entries(inputData));
        // Also add to globallyExposedFunctions Set
        dataStore.GloballyExposedFunctions.forEach((_, key) => {
          dataStore.globallyExposedFunctions.add(key);
        });
        console.log(`Imported ${dataStore.GloballyExposedFunctions.size} global access functions`);
        break;
      default:
        throw new Error(`Unknown data type: ${dataType}`);
    }

    console.log(`Successfully imported ${dataType} data from ${hjsonPath}`);
  } catch (error) {
    console.error(`Error importing ${dataType} data from ${hjsonPath}:`, error);
    throw error;
  }
}

/**
 * Load FFI namespace definition from hjson file
 * @returns {Object} FFI namespace definition or default if file not found
 */
function loadFfiNamespace() {
  const defaultNamespace = {
    description: '-- X4: Foundations FFI API\n-- Generated automatically from game files\n\n---@class ffi\nffi = require("ffi")',
    methods: [
      {
        name: 'string',
        description: 'Converts arg to a Lua string',
        parameters: [{ name: 'arg', type: 'any' }],
        returnType: 'string'
      },
      {
        name: 'new',
        description: 'Initialize/convert the Lua value to a C data type\nThis creates a new C data object',
        parameters: [
          { name: 'typeDescription', type: 'string', description: 'C data type' },
          { name: 'arg', type: 'any', description: 'Lua value' }
        ],
        returnType: 'cdata'
      }
    ]
  };

  const hjsonPath = config.hjsonPaths.ffiNamespace;
  try {
    // Try hjson file
    if (fs.existsSync(hjsonPath)) {
      console.log(`Loading FFI namespace definition from ${hjsonPath}`);
      return hJSON.parse(fs.readFileSync(hjsonPath, 'utf8'));
    }
  } catch (error) {
    console.warn(`Error loading FFI namespace definition: ${error.message}`);
  }

  console.log('Using default FFI namespace definition');
  try {
    if (!fs.existsSync(path.dirname(hjsonPath))) {
      fs.mkdirSync(path.dirname(hjsonPath), { recursive: true });
    }
    fs.writeFileSync(hjsonPath, hJSONStringify(defaultNamespace));
    console.log(`Exported default FFI namespace definition to ${hjsonPath}`);
  } catch (error) {
    console.warn(`Error exporting default FFI namespace definition: ${error.message}`);
  }
  return defaultNamespace;
}

/**
 * Load C namespace definition from hjson file
 * @returns {Object} C namespace definition or default if file not found
 */
function loadCNamespace() {
  const defaultNamespace = {
    description: '---@class C\nC = ffi.C',
    methods: []
  };

  const hjsonPath = config.hjsonPaths.cNamespace;
  try {
    // Try hjson file
    if (fs.existsSync(hjsonPath)) {
      console.log(`Loading C namespace definition from ${hjsonPath}`);
      return hJSON.parse(fs.readFileSync(hjsonPath, 'utf8'));
    }
  } catch (error) {
    console.warn(`Error loading C namespace definition: ${error.message}`);
  }

  console.log('Using default C namespace definition');
  try {
    if (!fs.existsSync(path.dirname(hjsonPath))) {
      fs.mkdirSync(path.dirname(hjsonPath), { recursive: true });
    }
    fs.writeFileSync(hjsonPath, hJSONStringify(defaultNamespace));
    console.log(`Exported default C namespace definition to ${hjsonPath}`);
  }
  catch (error) {
    console.warn(`Error exporting default C namespace definition: ${error.message}`);
  }
  return defaultNamespace;
}

/**
 * Main function to orchestrate the process
 */
async function main() {
  try {
    const args = process.argv.slice(2);
    const options = {
      usehjson: args.includes('--use-hjson'),
      skiphjsonExport: args.includes('--skip-hjson-export'),
      types: {
        lua: !args.includes('--no-lua'),
        ffi: !args.includes('--no-ffi'),
        helper: !args.includes('--no-helper'),
        undocumented: !args.includes('--no-undocumented'),
        GloballyExposed: !args.includes('--no-global-access')
      }
    };

    // Load from hjson if requested
    if (options.usehjson) {
      if (options.types.lua) importFromhjson('lua');
      if (options.types.ffi) importFromhjson('ffi');
      if (options.types.helper) importFromhjson('helper');
      if (options.types.undocumented) importFromhjson('undocumented');
      if (options.types.GloballyExposed) importFromhjson('GloballyExposed');
    }

    // Process files if needed
    const needsProcessing = (options.types.lua && dataStore.luaFunctions.size === 0) ||
      (options.types.ffi && dataStore.ffiFunctions.size === 0) ||
      (options.types.helper && dataStore.helperFunctions.size === 0) ||
      (options.types.undocumented) || // Always process for undocumented functions
      (options.types.GloballyExposed && dataStore.GloballyExposedFunctions.size === 0);

    if (needsProcessing) {
      // Parse Wiki HTML for Lua functions if needed
      if (options.types.lua && dataStore.luaFunctions.size === 0) {
        await parseWikiHtml(); // Notice the await here
      }

      // Find and process all Lua files
      const luaFiles = findLuaFiles(config.luaFolderPath);
      console.log(`Found ${luaFiles.length} Lua files to analyze.`);

      // Process each file for all selected function types
      for (const filePath of luaFiles) {
        processLuaFile(filePath);
      }

      // Update the known functions set
      updateKnownFunctionsSet();

      // Find undocumented functions
      if (options.types.undocumented) {
        findUndocumentedFunctions(luaFiles);
      }

      // Export to hjson unless skipped
      if (!options.skiphjsonExport && !options.usehjson) {
        if (options.types.lua) exportTohjson('lua');
        if (options.types.ffi) exportTohjson('ffi');
        if (options.types.helper) exportTohjson('helper');
        if (options.types.undocumented) exportTohjson('undocumented');
        if (options.types.GloballyExposed) exportTohjson('GloballyExposed');
      }
    }

    // Generate annotation files
    if (options.types.lua) generateLuaApiAnnotations();
    if (options.types.ffi) generateFfiApiAnnotations();
    if (options.types.helper) generateHelperApiAnnotations();
    if (options.types.undocumented) generateUndocumentedApiAnnotations();
    if (options.types.GloballyExposed) generateGloballyExposedAnnotations();

    console.log('Annotation generation completed successfully!');
  } catch (error) {
    console.error('Error generating annotations:', error);
  }
}

// Run the script
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
