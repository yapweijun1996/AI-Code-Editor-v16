/**
 * Advanced Dependency Injection Container
 * Supports lazy loading, scoped lifetimes, and circular dependency detection
 */

export const ServiceLifetime = {
    SINGLETON: 'singleton',
    TRANSIENT: 'transient', 
    SCOPED: 'scoped',
    REQUEST: 'request'
};

export class DIContainer {
    constructor() {
        this.services = new Map();
        this.instances = new Map();
        this.scopes = new Map();
        this.currentScope = null;
        this.resolutionStack = new Set();
        this.interceptors = [];
        
        // Register container itself
        this.registerInstance(DIContainer, this);
    }

    /**
     * Register a service with the container
     */
    register(key, implementation, lifetime = ServiceLifetime.SINGLETON, options = {}) {
        if (typeof key !== 'string' && typeof key !== 'function') {
            throw new Error('Service key must be a string or constructor function');
        }

        const serviceDescriptor = {
            key,
            implementation,
            lifetime,
            dependencies: options.dependencies || [],
            factory: options.factory || null,
            condition: options.condition || null,
            lazy: options.lazy !== false, // Default to lazy
            metadata: options.metadata || {}
        };

        this.services.set(key, serviceDescriptor);
        
        // Validate dependencies immediately for early error detection
        if (serviceDescriptor.dependencies.length > 0) {
            this.validateDependencies(serviceDescriptor);
        }

        return this; // Fluent interface
    }

    /**
     * Register a singleton service
     */
    registerSingleton(key, implementation, options = {}) {
        return this.register(key, implementation, ServiceLifetime.SINGLETON, options);
    }

    /**
     * Register a transient service
     */
    registerTransient(key, implementation, options = {}) {
        return this.register(key, implementation, ServiceLifetime.TRANSIENT, options);
    }

    /**
     * Register a scoped service
     */
    registerScoped(key, implementation, options = {}) {
        return this.register(key, implementation, ServiceLifetime.SCOPED, options);
    }

    /**
     * Register an existing instance
     */
    registerInstance(key, instance) {
        this.instances.set(key, instance);
        return this;
    }

    /**
     * Register a factory function
     */
    registerFactory(key, factory, lifetime = ServiceLifetime.SINGLETON, options = {}) {
        return this.register(key, null, lifetime, { ...options, factory });
    }

    /**
     * Resolve a service from the container
     */
    resolve(key, scope = null) {
        // Check for circular dependencies
        if (this.resolutionStack.has(key)) {
            const stack = Array.from(this.resolutionStack).join(' -> ');
            throw new Error(`Circular dependency detected: ${stack} -> ${key}`);
        }

        // Check for existing instance first
        if (this.instances.has(key)) {
            return this.instances.get(key);
        }

        const serviceDescriptor = this.services.get(key);
        if (!serviceDescriptor) {
            throw new Error(`Service '${key}' is not registered`);
        }

        // Check condition if present
        if (serviceDescriptor.condition && !serviceDescriptor.condition()) {
            throw new Error(`Service '${key}' condition not met`);
        }

        this.resolutionStack.add(key);

        try {
            const instance = this.createInstance(serviceDescriptor, scope);
            
            // Apply interceptors
            const interceptedInstance = this.applyInterceptors(key, instance, serviceDescriptor);
            
            this.resolutionStack.delete(key);
            return interceptedInstance;
        } catch (error) {
            this.resolutionStack.delete(key);
            throw error;
        }
    }

    /**
     * Create an instance based on service descriptor
     */
    createInstance(serviceDescriptor, scope = null) {
        const { key, implementation, lifetime, factory, dependencies } = serviceDescriptor;

        // Check for existing instance based on lifetime
        const existingInstance = this.getExistingInstance(key, lifetime, scope);
        if (existingInstance !== null) {
            return existingInstance;
        }

        let instance;

        if (factory) {
            // Use factory function
            const resolvedDependencies = this.resolveDependencies(dependencies, scope);
            instance = factory(...resolvedDependencies, this);
        } else if (implementation) {
            // Use constructor
            const resolvedDependencies = this.resolveDependencies(dependencies, scope);
            
            if (typeof implementation === 'function') {
                instance = new implementation(...resolvedDependencies);
            } else {
                // Static instance
                instance = implementation;
            }
        } else {
            throw new Error(`No implementation or factory provided for service '${key}'`);
        }

        // Store instance based on lifetime
        this.storeInstance(key, instance, lifetime, scope);

        return instance;
    }

    /**
     * Get existing instance based on lifetime
     */
    getExistingInstance(key, lifetime, scope) {
        switch (lifetime) {
            case ServiceLifetime.SINGLETON:
                return this.instances.get(key) || null;
            
            case ServiceLifetime.SCOPED:
                const scopeId = scope || this.currentScope;
                if (!scopeId) return null;
                const scopeInstances = this.scopes.get(scopeId);
                return scopeInstances ? scopeInstances.get(key) || null : null;
            
            case ServiceLifetime.REQUEST:
                // Similar to scoped but with request-specific scope
                return this.getExistingInstance(key, ServiceLifetime.SCOPED, scope);
            
            case ServiceLifetime.TRANSIENT:
            default:
                return null; // Always create new instance
        }
    }

    /**
     * Store instance based on lifetime
     */
    storeInstance(key, instance, lifetime, scope) {
        switch (lifetime) {
            case ServiceLifetime.SINGLETON:
                this.instances.set(key, instance);
                break;
            
            case ServiceLifetime.SCOPED:
            case ServiceLifetime.REQUEST:
                const scopeId = scope || this.currentScope;
                if (scopeId) {
                    if (!this.scopes.has(scopeId)) {
                        this.scopes.set(scopeId, new Map());
                    }
                    this.scopes.get(scopeId).set(key, instance);
                }
                break;
            
            case ServiceLifetime.TRANSIENT:
                // Don't store transient instances
                break;
        }
    }

    /**
     * Resolve dependencies for a service
     */
    resolveDependencies(dependencies, scope) {
        return dependencies.map(dep => {
            if (typeof dep === 'string' || typeof dep === 'function') {
                return this.resolve(dep, scope);
            } else if (typeof dep === 'object' && dep.key) {
                // Complex dependency descriptor
                return this.resolve(dep.key, scope);
            } else {
                throw new Error(`Invalid dependency descriptor: ${dep}`);
            }
        });
    }

    /**
     * Validate dependencies to detect issues early
     */
    validateDependencies(serviceDescriptor) {
        const { key, dependencies } = serviceDescriptor;
        
        for (const dep of dependencies) {
            const depKey = typeof dep === 'object' ? dep.key : dep;
            
            if (!this.services.has(depKey) && !this.instances.has(depKey)) {
                console.warn(`[DIContainer] Dependency '${depKey}' for service '${key}' is not registered`);
            }
        }
    }

    /**
     * Create a new scope for scoped services
     */
    createScope(scopeId = null) {
        const newScopeId = scopeId || `scope_${Date.now()}_${Math.random()}`;
        this.scopes.set(newScopeId, new Map());
        return newScopeId;
    }

    /**
     * Execute function within a scope
     */
    withScope(scopeId, fn) {
        const previousScope = this.currentScope;
        this.currentScope = scopeId;
        
        try {
            return fn();
        } finally {
            this.currentScope = previousScope;
        }
    }

    /**
     * Dispose a scope and its instances
     */
    disposeScope(scopeId) {
        const scopeInstances = this.scopes.get(scopeId);
        if (scopeInstances) {
            // Dispose instances that have dispose method
            for (const [key, instance] of scopeInstances) {
                if (instance && typeof instance.dispose === 'function') {
                    try {
                        instance.dispose();
                    } catch (error) {
                        console.error(`[DIContainer] Error disposing service '${key}':`, error);
                    }
                }
            }
            this.scopes.delete(scopeId);
        }
    }

    /**
     * Add an interceptor for service resolution
     */
    addInterceptor(interceptor) {
        if (typeof interceptor !== 'function') {
            throw new Error('Interceptor must be a function');
        }
        this.interceptors.push(interceptor);
        return this;
    }

    /**
     * Apply interceptors to resolved instance
     */
    applyInterceptors(key, instance, serviceDescriptor) {
        return this.interceptors.reduce((currentInstance, interceptor) => {
            try {
                return interceptor(key, currentInstance, serviceDescriptor, this) || currentInstance;
            } catch (error) {
                console.error(`[DIContainer] Interceptor error for service '${key}':`, error);
                return currentInstance;
            }
        }, instance);
    }

    /**
     * Check if a service is registered
     */
    isRegistered(key) {
        return this.services.has(key) || this.instances.has(key);
    }

    /**
     * Get service descriptor
     */
    getServiceDescriptor(key) {
        return this.services.get(key);
    }

    /**
     * Get all registered services
     */
    getRegisteredServices() {
        return Array.from(this.services.keys());
    }

    /**
     * Generate dependency graph for visualization/debugging
     */
    getDependencyGraph() {
        const graph = {};
        
        for (const [key, descriptor] of this.services) {
            graph[key] = {
                dependencies: descriptor.dependencies.map(dep => 
                    typeof dep === 'object' ? dep.key : dep
                ),
                lifetime: descriptor.lifetime,
                lazy: descriptor.lazy
            };
        }
        
        return graph;
    }

    /**
     * Validate entire dependency graph for circular dependencies
     */
    validateDependencyGraph() {
        const graph = this.getDependencyGraph();
        const visited = new Set();
        const recursionStack = new Set();
        
        const hasCircularDependency = (node, path = []) => {
            if (recursionStack.has(node)) {
                const cycle = [...path, node];
                throw new Error(`Circular dependency detected: ${cycle.join(' -> ')}`);
            }
            
            if (visited.has(node)) {
                return false;
            }
            
            visited.add(node);
            recursionStack.add(node);
            
            const dependencies = graph[node]?.dependencies || [];
            for (const dep of dependencies) {
                if (hasCircularDependency(dep, [...path, node])) {
                    return true;
                }
            }
            
            recursionStack.delete(node);
            return false;
        };
        
        for (const service of Object.keys(graph)) {
            if (!visited.has(service)) {
                hasCircularDependency(service);
            }
        }
        
        return true; // No circular dependencies found
    }

    /**
     * Clear all services and instances
     */
    clear() {
        // Dispose all scoped instances
        for (const scopeId of this.scopes.keys()) {
            this.disposeScope(scopeId);
        }
        
        // Dispose singleton instances
        for (const [key, instance] of this.instances) {
            if (instance && typeof instance.dispose === 'function') {
                try {
                    instance.dispose();
                } catch (error) {
                    console.error(`[DIContainer] Error disposing singleton '${key}':`, error);
                }
            }
        }
        
        this.services.clear();
        this.instances.clear();
        this.scopes.clear();
        this.interceptors.length = 0;
        this.currentScope = null;
        
        // Re-register container itself
        this.registerInstance(DIContainer, this);
    }

    /**
     * Create a child container
     */
    createChild() {
        const child = new DIContainer();
        
        // Copy service registrations (not instances)
        for (const [key, descriptor] of this.services) {
            child.services.set(key, { ...descriptor });
        }
        
        // Copy interceptors
        child.interceptors = [...this.interceptors];
        
        return child;
    }
}

// Create and export global container instance
export const container = new DIContainer();

// Add performance monitoring interceptor by default
container.addInterceptor((key, instance, descriptor, container) => {
    if (!window.performanceProfiler) return instance;
    
    // Wrap methods for performance tracking
    if (instance && typeof instance === 'object') {
        const originalMethods = {};
        
        for (const prop of Object.getOwnPropertyNames(Object.getPrototypeOf(instance))) {
            if (typeof instance[prop] === 'function' && prop !== 'constructor') {
                originalMethods[prop] = instance[prop];
                instance[prop] = function(...args) {
                    const timerId = window.performanceProfiler.startTimer(`${key}.${prop}`);
                    try {
                        const result = originalMethods[prop].apply(this, args);
                        
                        // Handle promises
                        if (result && typeof result.then === 'function') {
                            return result.finally(() => {
                                window.performanceProfiler.endTimer(timerId);
                            });
                        }
                        
                        window.performanceProfiler.endTimer(timerId);
                        return result;
                    } catch (error) {
                        window.performanceProfiler.endTimer(timerId);
                        throw error;
                    }
                };
            }
        }
    }
    
    return instance;
});