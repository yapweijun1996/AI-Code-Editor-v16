const express = require('express');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const fs = require('fs').promises;
const prettier = require('prettier');

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:107.0) Gecko/20100101 Firefox/107.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 Edg/107.0.1418.62",
  "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64; rv:102.0) Gecko/20100101 Firefox/102.0",
  "Mozilla/5.0 (Linux; Android 13; SM-A536U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPad; CPU OS 16_1_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/108.0.5359.112 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36 Vivaldi/5.5.2805.50",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:107.0) Gecko/20100101 Firefox/107.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.3 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Linux; Android 12; SM-G991U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36"
];

class RateLimiter {
  constructor(requestsPerMinute = 30) {
    this.requestsPerMinute = requestsPerMinute;
    this.requests = [];
  }

  async acquire() {
    const now = new Date();
    this.requests = this.requests.filter(req => now - req < 60 * 1000);
    if (this.requests.length >= this.requestsPerMinute) {
      const waitTime = 60 - (now - this.requests[0]) / 1000;
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
      }
    }
    this.requests.push(now);
  }
}

class SearchResult {
  constructor(title, link, snippet, position) {
    this.title = title;
    this.link = link;
    this.snippet = snippet;
    this.position = position;
  }
}

class DuckDuckGoSearcher {
  constructor() {
    this.BASE_URL = "https://html.duckduckgo.com/html";
    this.rateLimiter = new RateLimiter();
  }

  async search(query, maxResults = 10, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await this.rateLimiter.acquire();
        console.log(`[BACKEND] Searching DuckDuckGo for: ${query} (Attempt ${i + 1})`);

        const data = new URLSearchParams({ q: query, b: "", kl: "" });
        const response = await axios.post(this.BASE_URL, data.toString(), {
          headers: {
            "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 30000
        });

        const $ = cheerio.load(response.data);
        if (!$) {
            console.error("[BACKEND] Failed to parse HTML response");
            continue;
        }

        const results = [];
        $('.result').each((idx, element) => {
          if (results.length >= maxResults) return false;

          const titleElem = $(element).find('.result__title a');
          const snippetElem = $(element).find('.result__snippet');
          if (!titleElem.length) return true;

          const title = titleElem.text().trim();
          let link = titleElem.attr('href');
          
          if (link && link.includes('y.js')) return true;

          if (link && link.startsWith('//duckduckgo.com/l/?uddg=')) {
            link = decodeURIComponent(link.split('uddg=')[1].split('&')[0]);
          }

          const snippet = snippetElem.length ? snippetElem.text().trim() : "";
          results.push(new SearchResult(title, link, snippet, results.length + 1));
        });

        if (results.length > 0) {
            console.log(`[BACKEND] Successfully found ${results.length} results on attempt ${i + 1}`);
            return results;
        }
        console.log(`[BACKEND] Attempt ${i + 1} returned no results, retrying...`);
      } catch (error) {
        if (error.code === 'ECONNABORTED') {
            console.error(`[BACKEND] Search request timed out on attempt ${i + 1}`);
        } else if (error.response) {
            console.error(`[BACKEND] HTTP error on attempt ${i + 1}: ${error.message}`);
        } else {
            console.error(`[BACKEND] Unexpected error on attempt ${i + 1}: ${error.message}`);
        }
        if (i === maxRetries - 1) {
            console.error("[BACKEND] Max retries reached. Search failed.");
            throw new Error("Failed to fetch search results after multiple retries.");
        }
      }
    }
    return [];
  }
}

const app = express();
const port = 3333;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

app.post('/api/read-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const response = await axios.get(url, {
      headers: { 
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://www.google.com/',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    const $ = cheerio.load(response.data);
    $('script, style, header, footer, nav, aside').remove();
    let content = $('body').text().replace(/\s\s+/g, ' ').trim();
    const links = Array.from($('a')).map(el => $(el).attr('href')).filter(Boolean);
    res.json({ content, links });
  } catch (error) {
    console.error(`[BACKEND] Error fetching URL ${url}:`, error.message);
    res.status(500).json({ message: `Failed to process URL: ${error.message}` });
  }
});

const searcher = new DuckDuckGoSearcher();
app.post('/api/duckduckgo-search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  try {
    const results = await searcher.search(query);
    res.json({ results });
  } catch (error) {
    console.error(`[BACKEND] Error searching DuckDuckGo for "${query}":`, error.message);
    res.status(500).json({ message: `Failed to perform search: ${error.message}` });
  }
});

// =================================================================
// === Codebase Indexing and Querying Endpoints                  ===
// =================================================================



// =================================================================
// === Backend Terminal Tool Execution Endpoint                  ===
// =================================================================
app.post('/api/execute-tool', async (req, res) => {
  const { toolName, parameters } = req.body;

  const validBackendTools = [
    'run_terminal_command',
    'get_file_history',
    // Added filesystem tools
    'create_folder',
    'rename_folder',
    'delete_folder',
    'get_project_structure'
  ];
  if (!validBackendTools.includes(toolName)) {
    return res.status(501).json({
      status: 'Error',
      message: `Tool '${toolName}' is not a valid backend tool.`,
    });
  }

  // Handle filesystem tools directly (no shell execution)
  const projectRoot = path.join(__dirname, '..');
  const resolveSafePath = (p) => {
    const safe = path.normalize(String(p || '')).replace(/^(\.\.[\/\\])+/, '');
    const full = path.join(projectRoot, safe);
    if (!full.startsWith(projectRoot)) {
      throw new Error('Access to paths outside the project directory is forbidden.');
    }
    return { safe, full };
  };

  if (toolName === 'create_folder') {
    try {
      const rel = parameters && parameters.path;
      if (!rel) return res.status(400).json({ status: 'Error', message: "Parameter 'path' is required for create_folder." });
      const { safe, full } = resolveSafePath(rel);
      await fs.mkdir(full, { recursive: true });
      return res.json({ status: 'Success', message: `Folder created: ${safe}` });
    } catch (e) {
      return res.status(500).json({ status: 'Error', message: e.message });
    }
  }

  if (toolName === 'rename_folder') {
    try {
      const oldPath = parameters && parameters.oldPath;
      const newPath = parameters && parameters.newPath;
      if (!oldPath || !newPath) {
        return res.status(400).json({ status: 'Error', message: "Parameters 'oldPath' and 'newPath' are required for rename_folder." });
      }
      const { full: oldFull } = resolveSafePath(oldPath);
      const { full: newFull } = resolveSafePath(newPath);
      // Ensure target parent exists
      await fs.mkdir(path.dirname(newFull), { recursive: true });
      await fs.rename(oldFull, newFull);
      return res.json({ status: 'Success', message: `Folder renamed to: ${newPath}` });
    } catch (e) {
      return res.status(500).json({ status: 'Error', message: e.message });
    }
  }

  if (toolName === 'delete_folder') {
    try {
      const rel = parameters && parameters.path;
      if (!rel) return res.status(400).json({ status: 'Error', message: "Parameter 'path' is required for delete_folder." });
      const { safe, full } = resolveSafePath(rel);
      // Remove recursively, no error if missing
      await fs.rm(full, { recursive: true, force: true });
      return res.json({ status: 'Success', message: `Folder deleted: ${safe}` });
    } catch (e) {
      return res.status(500).json({ status: 'Error', message: e.message });
    }
  }

  if (toolName === 'get_project_structure') {
    try {
      // Build a simple newline-separated list of directories and files (relative to project root)
      const lines = [];
      async function walk(dir, relPrefix = '') {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          // Skip node_modules or hidden artifacts if desired (keep all for now)
          const relPath = relPrefix ? path.join(relPrefix, entry.name) : entry.name;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            lines.push(relPath + '/');
            await walk(fullPath, relPath);
          } else {
            lines.push(relPath);
          }
        }
      }
      await walk(projectRoot, '');
      const structure = lines.join('\n');
      return res.json({ status: 'Success', structure });
    } catch (e) {
      return res.status(500).json({ status: 'Error', message: e.message });
    }
  }

  let command;
  if (toolName === 'get_file_history') {
    // Accept both 'filename' and 'path' for flexibility
    const fileParam = (parameters && (parameters.filename || parameters.path)) || null;
    if (!fileParam) {
      return res.status(400).json({ status: 'Error', message: "A 'filename' or 'path' parameter is required for get_file_history." });
    }
    // Sanitize filename to prevent command injection
    const sanitizedFilename = JSON.stringify(fileParam);
    command = `git log --pretty=format:'%H|%an|%ad|%s' -- ${sanitizedFilename}`;
  } else { // run_terminal_command
    if (!parameters.command) {
      return res.status(400).json({ status: 'Error', message: "A 'command' parameter is required for run_terminal_command." });
    }
    command = parameters.command;
  }

  const isWindows = os.platform() === 'win32';
  
  // Set the working directory to the project root, which is one level above the backend directory.
  // This ensures commands like 'git' execute in the correct context.
  const executionCwd = path.join(__dirname, '..');

  // Create a robust environment, ensuring a sane PATH for command execution.
  const executionEnv = {
    ...process.env,
    PATH: isWindows
      ? process.env.PATH
      : `${process.env.PATH}:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin`,
  };

  const execOptions = {
    // The 'cwd' option can be unreliable with explicit shell invocation.
    // Instead, we'll 'cd' as part of the command itself.
    env: executionEnv,
    shell: isWindows ? 'powershell.exe' : '/bin/bash',
  };

  // Force execution in the project root by prepending 'cd' to the command.
  const finalCommand = isWindows
    ? `cd "${executionCwd}"; ${command}`
    : `cd "${executionCwd}" && ${command}`;

  console.log(`[BACKEND] Executing command: '${finalCommand}' in '${executionCwd}'`);

  // The command is now wrapped to ensure it runs in the correct directory.
  const shellCommand = isWindows
    ? `powershell.exe -Command "& {${finalCommand}}"`
    : `/bin/bash -c "${finalCommand.replace(/"/g, '\\"')}"`;

  exec(shellCommand, execOptions, (error, stdout, stderr) => {
    if (error) {
      console.error(`[BACKEND] Execution error for '${toolName}': ${error.message}`);
      console.error(`[BACKEND] Stderr: ${stderr}`);
      
      let specificMessage = `Command failed with exit code ${error.code}.`;
      if (toolName === 'get_file_history') {
          if (stderr.toLowerCase().includes('not a git repository')) {
              specificMessage = "Error: The current project is not a Git repository. Please initialize it with 'git init'.";
          } else if (stderr.toLowerCase().includes("does not have any commits") || stderr.toLowerCase().includes("exists on disk, but not in 'head'")) {
              specificMessage = "Error: The specified file is not tracked by Git or has no commit history.";
          } else {
              specificMessage = "An unknown Git error occurred. Check the backend logs for more details.";
          }
      }

      return res.status(500).json({
        status: 'Error',
        message: specificMessage,
        output: `stdout: ${stdout}\nstderr: ${stderr}`,
      });
    }

    console.log(`[TERMINAL] stdout: ${stdout}`);
    if (stderr) {
      console.warn(`[TERMINAL] stderr: ${stderr}`);
    }

    res.json({ status: 'Success', output: stdout });
  });
});

// =================================================================
// === Code Formatting Endpoint                                  ===
// =================================================================
app.post('/api/format-code', async (req, res) => {
  const { filename } = req.body;
  if (!filename) {
    return res.status(400).json({ status: 'Error', message: 'Filename is required.' });
  }

  // Sanitize the filename to prevent path traversal attacks.
  // Ensures the path is relative and does not access parent directories.
  const projectRoot = path.join(__dirname, '..');
  const safeFilename = path.normalize(filename).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(projectRoot, safeFilename);

  // Double-check that the resolved path is still within the project root.
  if (!fullPath.startsWith(projectRoot)) {
    return res.status(403).json({ status: 'Error', message: 'Access to files outside the project directory is forbidden.' });
  }

  try {
    const fileInfo = await prettier.getFileInfo(fullPath);

    if (fileInfo.ignored) {
      return res.json({ status: 'Success', message: `File '${filename}' is ignored by Prettier.` });
    }

    if (!fileInfo.inferredParser) {
      return res.status(400).json({ status: 'Error', message: `Could not infer Prettier parser for file '${filename}'.` });
    }

    const source = await fs.readFile(fullPath, 'utf8');
    const formatted = await prettier.format(source, { parser: fileInfo.inferredParser });

    await fs.writeFile(fullPath, formatted, 'utf8');

    res.json({ status: 'Success', message: `File '${filename}' formatted successfully.` });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ status: 'Error', message: `File not found: ${filename}` });
    }
    console.error(`[API] Error formatting file '${filename}':`, error);
    res.status(500).json({ status: 'Error', message: `Failed to format file: ${error.message}` });
  }
});


// =================================================================
// === File Watcher for Automatic Indexing                       ===
// =================================================================


async function initializeApp() {
  app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
    console.log('Navigate to http://localhost:3333 to open the editor.');
  });
}

initializeApp();
