import { SymbolResolver } from '../symbol_resolver.js';

const resolver = new SymbolResolver();

self.onmessage = async (e) => {
    const { action, data, id } = e.data;

    try {
        let result;
        switch (action) {
            case 'resolve_symbols':
                const { content, filePath, options } = data;
                result = await resolver.buildSymbolTable(content, filePath);
                break;
            default:
                throw new Error(`Unknown action: ${action}`);
        }

        self.postMessage({
            success: true,
            action: action,
            data: result,
            id: id
        });
    } catch (error) {
        self.postMessage({
            success: false,
            action: action,
            error: error.message,
            id: id
        });
    }
};