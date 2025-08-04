# Tool and Feature Proposals

This document outlines potential new tools and features based on user feedback and development needs. These are planned enhancements to expand file management, code editing, and debugging capabilities.

---

## Status: Proposed Features

**Note**: Many tools proposed here have been implemented. See the current tool list in `frontend/js/tool_executor.js` for the latest available tools.

## 1. Granular File/Folder Manipulation

These tools provide more specific and auditable file system operations.

### `copy_file` ✅ **IMPLEMENTED as part of file operations**
- **Description:** Copies a file from a source path to a destination path.
- **Parameters:**
    - `source_path` (string): The path to the file to be copied.
    - `destination_path` (string): The path to the new file.
- **Returns:** `{ "message": "File 'source.txt' copied to 'destination.txt'." }`
- **Error Handling:** Throws an error if the source does not exist or the destination is a directory.

### `move_file` ✅ **IMPLEMENTED as `rename_file`**
- **Action:** Since `rename_file` already supports moving files across directories, this functionality is available.

### `copy_folder` ⏳ **PLANNED**
- **Description:** Recursively copies a folder from a source path to a destination path.
- **Parameters:**
    - `source_folder_path` (string): The path to the folder to be copied.
    - `destination_folder_path` (string): The path to the new folder.
- **Returns:** `{ "message": "Folder 'src' copied to 'src_backup'." }`

### `move_folder` ✅ **IMPLEMENTED as `rename_folder`**
- **Action:** Since `rename_folder` already supports moving folders, this functionality is available.

---

## 2. Enhanced Code Editing

### `find_and_replace` ✅ **IMPLEMENTED**
- **Description:** A powerful find-and-replace tool that operates on files.
- **Current Implementation:** Available as `find_and_replace` tool with exact text matching
- **Enhanced Features Proposed:**
    - `find_pattern` (string): Support for regex patterns
    - `replace_string` (string): Support for regex capture groups (e.g., `$1`)
    - `options` (object):
        - `use_regex` (boolean): Treat pattern as regular expression
        - `case_sensitive` (boolean): Case-sensitive search
        - `all_occurrences` (boolean): Replace all matches

---

## 3. Advanced File Operations

### `smart_replace` ✅ **IMPLEMENTED**
- **Description:** Fuzzy matching replacement for content that might have changed slightly
- **Status:** Available with similarity threshold configuration

### `apply_diff` ✅ **IMPLEMENTED**
- **Description:** Apply precise, surgical changes using diff blocks
- **Status:** Available with comprehensive diff block support

---

## 4. Future Development: Advanced Features

These are complex features requiring significant development work.

### `refactor_code` ⏳ **PLANNED**
- **Description:** Language-aware refactoring operations
- **Potential Operations:**
    - `rename_variable`: Renames a variable within its scope
    - `extract_method`: Extracts code blocks into new methods/functions
    - `inline_variable`: Replaces variables with their values
- **Challenges:** Requires robust AST parsing for each supported language

### Interactive Debugging Tools ⏳ **CONCEPTUAL**
- **Description:** Interactive debugging session management
- **Potential Tools:**
    - `set_breakpoint(filename, line_number)`
    - `remove_breakpoint(filename, line_number)`
    - `step_over()`, `step_into()`, `step_out()`
    - `continue_execution()`
    - `inspect_variables()`
- **Challenges:** Requires Debug Adapter Protocol integration and state management

### Advanced Code Analysis ✅ **PARTIALLY IMPLEMENTED**
- **Description:** Deep code understanding and analysis
- **Implemented Features:**
    - `analyze_symbol` - Symbol analysis across codebase
    - `explain_code_section` - Detailed code explanations
    - `trace_variable_flow` - Variable data flow tracking
- **Future Enhancements:**
    - Cross-language symbol resolution
    - Automated code quality scoring
    - Refactoring suggestions based on code smells

---

## Implementation Status Legend

- ✅ **IMPLEMENTED**: Feature is available in current version
- ⏳ **PLANNED**: Feature is planned for future development
- 🔍 **RESEARCH**: Feature is being researched and evaluated
- ⚠️ **DEPRECATED**: Feature has been replaced or removed

---

## Contributing to Tool Development

To propose new tools or enhancements:

1. Review existing tools in `frontend/js/tool_executor.js`
2. Consider security implications and browser limitations
3. Ensure tools align with the client-centric architecture
4. Submit proposals through the project's issue tracker

For implementation details, see:
- [Contributing Guide](./CONTRIBUTING.md)
- [Architecture Documentation](./ARCHITECTURE.md)
- [Tool Documentation](./TOOL_DOCUMENTATION.md)