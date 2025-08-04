# ADR-002: Dependency Injection System Design

## Status
Accepted

## Context
The current codebase has several dependency management issues:

- **Tight Coupling**: Modules directly import and instantiate dependencies
- **Circular Dependencies**: Complex import chains between modules
- **No Lifecycle Management**: Services are created when imported, not when needed
- **Testing Difficulties**: Hard to mock dependencies for unit testing
- **Configuration Complexity**: No centralized way to configure service behavior

We need a dependency injection system that supports:
- Lazy loading of services
- Different service lifetimes (singleton, transient, scoped)
- Circular dependency detection
- Performance monitoring integration
- Easy testing and mocking

## Decision
We will implement an advanced DIContainer with the following features:

1. **Service Lifetimes**:
   - `SINGLETON`: One instance per container
   - `TRANSIENT`: New instance every time
   - `SCOPED`: One instance per scope (e.g., per request/operation)
   - `REQUEST`: Alias for scoped, semantic clarity

2. **Lazy Loading**: Services are only instantiated when first requested

3. **Circular Dependency Detection**: Runtime and static validation

4. **Interceptor Pattern**: For cross-cutting concerns like performance monitoring

5. **Fluent API**: Easy service registration with method chaining

6. **Factory Support**: Custom creation logic for complex services

7. **Conditional Registration**: Services can be registered based on conditions

## Usage Examples
```javascript
import { container, ServiceLifetime } from './core/di_container.js';

// Register services
container
  .registerSingleton('ApiService', ApiService, {
    dependencies: ['HttpClient', 'ConfigService']
  })
  .registerTransient('DataProcessor', DataProcessor)
  .registerScoped('UserSession', UserSession);

// Resolve services
const apiService = container.resolve('ApiService');

// Work with scopes
const scopeId = container.createScope();
container.withScope(scopeId, () => {
  const session = container.resolve('UserSession');
  // session is scoped to this execution
});
container.disposeScope(scopeId);
```

## Consequences
**Positive:**
- **Decoupling**: Services depend on abstractions, not concrete implementations
- **Testability**: Easy to inject mocks and test doubles
- **Lifecycle Management**: Proper service initialization and disposal
- **Performance**: Lazy loading reduces startup time
- **Debugging**: Dependency graph visualization and circular dependency detection
- **Monitoring**: Built-in performance tracking for all services

**Negative:**
- **Learning Curve**: Team needs to understand DI patterns
- **Initial Complexity**: More setup code for service registration
- **Runtime Overhead**: Small performance cost for service resolution
- **Debugging Complexity**: Stack traces may be deeper due to indirection

**Neutral:**
- **Configuration**: Centralized service configuration (can be pro or con)
- **Magic**: Some developers prefer explicit imports over DI "magic"

## Notes
- The container includes performance monitoring by default via interceptors
- Child containers can be created for isolated testing scenarios  
- The system validates dependencies at registration time for early error detection
- Services can implement a `dispose()` method for cleanup
- The container itself is registered as a service for advanced scenarios