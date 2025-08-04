export async function getIgnorePatterns(rootDirHandle) {
    try {
        const ignoreFileHandle = await rootDirHandle.getFileHandle('.ai_ignore');
        const file = await ignoreFileHandle.getFile();
        const content = await file.text();
        return content.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
    } catch (e) {
        return [];
    }
}

export async function getFileHandleFromPath(dirHandle, path, options = {}) {
    const parts = path.split('/').filter((p) => p);
    let currentHandle = dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
        currentHandle = await currentHandle.getDirectoryHandle(parts[i], { create: options.create });
    }
    return await currentHandle.getFileHandle(parts[parts.length - 1], options);
}

export async function getParentDirectoryHandle(rootDirHandle, path) {
    const parts = path.split('/').filter((p) => p);
    if (parts.length === 0) {
        throw new Error('Invalid path provided. Cannot get parent of root.');
    }

    let currentHandle = rootDirHandle;
    // Traverse to the parent directory
    for (let i = 0; i < parts.length - 1; i++) {
        currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
    }

    const entryName = parts[parts.length - 1];
    return { parentHandle: currentHandle, entryName };
}

export async function createDirectoryFromPath(dirHandle, path) {
    const parts = path.split('/').filter((p) => p);
    let currentHandle = dirHandle;
    for (const part of parts) {
        currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
    }
    return currentHandle;
}

async function getDirectoryHandleFromPath(dirHandle, path) {
    const parts = path.split('/').filter((p) => p);
    let currentHandle = dirHandle;
    for (const part of parts) {
        currentHandle = await currentHandle.getDirectoryHandle(part);
    }
    return currentHandle;
}

async function getEntryHandleFromPath(rootDirHandle, path) {
    try {
        const handle = await getDirectoryHandleFromPath(rootDirHandle, path);
        return { handle, isDirectory: true };
    } catch (e) {
        if (e.name === 'TypeMismatchError' || e.name === 'NotFoundError') {
            try {
                const handle = await getFileHandleFromPath(rootDirHandle, path);
                return { handle, isDirectory: false };
            } catch (fileError) {
                throw new Error(`Entry not found at path: ${path}`);
            }
        }
        throw e;
    }
}

export async function renameEntry(rootDirHandle, oldPath, newPath) {
    const { handle: oldHandle, isDirectory } = await getEntryHandleFromPath(rootDirHandle, oldPath);

    if (isDirectory) {
        await createDirectoryFromPath(rootDirHandle, newPath);
        for await (const entry of oldHandle.values()) {
            await renameEntry(
                rootDirHandle,
                `${oldPath}/${entry.name}`,
                `${newPath}/${entry.name}`
            );
        }
    } else {
        const file = await oldHandle.getFile();
        const content = await file.arrayBuffer();
        const newFileHandle = await getFileHandleFromPath(rootDirHandle, newPath, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(content);
        await writable.close();
    }

    await deleteEntry(rootDirHandle, oldPath);
}

export async function deleteEntry(rootDirHandle, path) {
    const { parentHandle, entryName } = await getParentDirectoryHandle(rootDirHandle, path);
    let isDirectory = false;
    try {
        await parentHandle.getDirectoryHandle(entryName);
        isDirectory = true;
    } catch (e) {
        // It's a file
    }
    await parentHandle.removeEntry(entryName, { recursive: isDirectory });
}

export async function writeFile(fileHandle, content) {
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
}

export async function searchInDirectory(
    dirHandle,
    searchTerm,
    currentPath,
    results,
    ignorePatterns,
    useRegex = false,
    caseSensitive = false
) {
    for await (const entry of dirHandle.values()) {
        const newPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
        if (ignorePatterns.some(pattern => newPath.startsWith(pattern.replace(/\/$/, '')))) {
            continue;
        }

        if (entry.kind === 'file') {
            try {
                const file = await entry.getFile();
                const content = await file.text();
                const lines = content.split('\n');
                const fileMatches = [];
                for (let i = 0; i < lines.length; i++) {
                    if (useRegex) {
                        const regex = new RegExp(searchTerm, caseSensitive ? '' : 'i');
                        if (regex.test(lines[i])) {
                            fileMatches.push({
                                line_number: i + 1,
                                line_content: lines[i].trim(),
                            });
                        }
                    } else {
                        const line = caseSensitive ? lines[i] : lines[i].toLowerCase();
                        const term = caseSensitive ? searchTerm : searchTerm.toLowerCase();
                        if (line.includes(term)) {
                            fileMatches.push({
                                line_number: i + 1,
                                line_content: lines[i].trim(),
                            });
                        }
                    }
                }
                if (fileMatches.length > 0) {
                    results.push({
                        file: newPath,
                        matches: fileMatches,
                    });
                }
            } catch (readError) {
                console.warn(`Could not read file ${newPath}:`, readError);
                results.push({
                    file: newPath,
                    error: `Could not read file: ${readError.message}`
                });
            }
        } else if (entry.kind === 'directory') {
            await searchInDirectory(entry, searchTerm, newPath, results, ignorePatterns);
        }
    }
}


export const buildTree = async (dirHandle, ignorePatterns, currentPath = '') => {
    const buildChildren = async (currentDirHandle, pathPrefix) => {
        const children = [];
        for await (const entry of currentDirHandle.values()) {
            const newPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
            if (ignorePatterns.some(pattern => newPath.startsWith(pattern.replace(/\/$/, '')))) {
                continue;
            }
            if (entry.kind === 'directory') {
                children.push({
                    id: newPath,
                    text: entry.name,
                    type: 'folder',
                    children: await buildChildren(entry, newPath),
                });
            } else {
                children.push({
                    id: newPath,
                    text: entry.name,
                    type: 'file',
                    li_attr: { 'data-path': newPath, 'data-handle': entry },
                });
            }
        }
        children.sort((a, b) => {
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            return a.text.localeCompare(b.text);
        });
        return children;
    };

    const rootChildren = await buildChildren(dirHandle, '');
    return [{
        id: dirHandle.name,
        text: dirHandle.name,
        type: 'folder',
        state: { opened: true },
        children: rootChildren,
    }];
};
export async function verifyAndRequestPermission(fileHandle, withWrite = false) {
    const options = { mode: withWrite ? 'readwrite' : 'read' };
    
    // First check if we already have permission
    const currentPermission = await fileHandle.queryPermission(options);
    if (currentPermission === 'granted') {
        return true;
    }
    
    // If we don't have permission, we need user activation to request it
    // For AI tool execution, we'll try to proceed without explicit permission request
    // and let the browser handle the permission naturally during file operations
    
    // Only attempt to request permission if we're in a user activation context
    // This prevents the "User activation is required" error
    try {
        // Check if we're in a user activation context by testing if we can request permission
        const permissionResult = await fileHandle.requestPermission(options);
        return permissionResult === 'granted';
    } catch (error) {
        // If requestPermission fails due to lack of user activation,
        // we'll return true and let the actual file operation handle permissions
        if (error.message.includes('User activation is required')) {
            console.warn('Permission request requires user activation, proceeding with file operation...');
            return true; // Optimistically proceed
        }
        
        // For other errors, return false
        console.error('Permission request failed:', error);
        return false;
    }
}
/**
 * Creates a file system adapter for isomorphic-git to use the File System Access API.
 * @param {FileSystemDirectoryHandle} rootDirectoryHandle - The root directory handle.
 * @returns {object} An fs-like object for isomorphic-git.
 */
export function createFsAdapter(rootDirectoryHandle) {
    const getHandle = async (filepath, create = false) => {
        const parts = filepath.split('/').filter(p => p);
        let handle = rootDirectoryHandle;
        for (let i = 0; i < parts.length - 1; i++) {
            handle = await handle.getDirectoryHandle(parts[i], { create });
        }
        return { dir: handle, name: parts[parts.length - 1] };
    };

    return {
        promises: {
            async readFile(filepath, options) {
                try {
                    const { dir, name } = await getHandle(filepath);
                    const fileHandle = await dir.getFileHandle(name);
                    const file = await fileHandle.getFile();
                    const content = await file.text();
                    return options && options.encoding === 'utf8' ? content : new TextEncoder().encode(content);
                } catch (e) {
                    throw new Error(`ENOENT: no such file or directory, open '${filepath}'`);
                }
            },
            async writeFile(filepath, data) {
                const { dir, name } = await getHandle(filepath, true);
                const fileHandle = await dir.getFileHandle(name, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(data);
                await writable.close();
            },
            async unlink(filepath) {
                const { dir, name } = await getHandle(filepath);
                await dir.removeEntry(name);
            },
            async mkdir(filepath) {
                const parts = filepath.split('/').filter(p => p);
                let handle = rootDirectoryHandle;
                for (const part of parts) {
                    handle = await handle.getDirectoryHandle(part, { create: true });
                }
            },
            async rmdir(filepath) {
                const { dir, name } = await getHandle(filepath);
                await dir.removeEntry(name, { recursive: true });
            },
            async stat(filepath) {
                try {
                    const { dir, name } = await getHandle(filepath);
                    const handle = await dir.getDirectoryHandle(name).catch(() => dir.getFileHandle(name));
                    const file = handle.kind === 'file' ? await handle.getFile() : null;
                    return {
                        isFile: () => handle.kind === 'file',
                        isDirectory: () => handle.kind === 'directory',
                        size: file ? file.size : 0,
                        mtimeMs: file ? file.lastModified : 0,
                    };
                } catch (e) {
                     throw new Error(`ENOENT: no such file or directory, lstat '${filepath}'`);
                }
            },
            async lstat(filepath) {
                return this.stat(filepath); // Simplified for this use case
            },
            async readdir(filepath) {
                let handle = rootDirectoryHandle;
                if (filepath !== '.' && filepath !== '/') {
                    const parts = filepath.split('/').filter(p => p);
                    for (const part of parts) {
                       handle = await handle.getDirectoryHandle(part);
                    }
                }
                const entries = [];
                for await (const name of handle.keys()) {
                    entries.push(name);
                }
                return entries;
            },
        }
    };
}

// Functions for project structure tool
export async function buildStructureTree(dirHandle, ignorePatterns, currentPath = '') {
    const tree = { name: 'root', type: 'folder', children: [] };
    await buildStructureTreeRecursive(dirHandle, ignorePatterns, tree, currentPath);
    return tree;
}

async function buildStructureTreeRecursive(dirHandle, ignorePatterns, parentNode, currentPath = '') {
    for await (const entry of dirHandle.values()) {
        const newPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
        
        // Check if this path should be ignored
        if (ignorePatterns.some(pattern => {
            const normalizedPattern = pattern.replace(/\/$/, '');
            return newPath.startsWith(normalizedPattern) || entry.name === normalizedPattern;
        })) {
            continue;
        }

        const node = {
            name: entry.name,
            type: entry.kind === 'directory' ? 'folder' : 'file',
            path: newPath
        };

        if (entry.kind === 'directory') {
            node.children = [];
            await buildStructureTreeRecursive(entry, ignorePatterns, node, newPath);
        }

        parentNode.children.push(node);
    }

    // Sort children: folders first, then files, both alphabetically
    parentNode.children.sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        return a.name.localeCompare(b.name);
    });
}

export function formatTreeToString(tree, indent = '', isLast = true) {
    if (!tree || tree.name === 'root') {
        // For root, just format its children
        if (!tree.children || tree.children.length === 0) {
            return 'Project directory is empty.';
        }
        return tree.children
            .map((child, index) => formatTreeToString(child, '', index === tree.children.length - 1))
            .join('\n');
    }

    const prefix = isLast ? '└── ' : '├── ';
    const nextIndent = indent + (isLast ? '    ' : '│   ');
    
    let result = indent + prefix + tree.name;
    
    if (tree.type === 'folder' && tree.children && tree.children.length > 0) {
        const childrenStr = tree.children
            .map((child, index) => formatTreeToString(child, nextIndent, index === tree.children.length - 1))
            .join('\n');
        result += '\n' + childrenStr;
    }
    
    return result;
}
