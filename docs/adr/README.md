# Architectural Decision Records (ADRs)

This directory contains architectural decision records for the AI Code Editor project.

## Format

We use the format suggested by Michael Nygard in his article ["Documenting Architecture Decisions"](http://thinkrelevance.com/blog/2011/11/15/documenting-architecture-decisions).

Each ADR should have:
- **Title**: Short noun phrase describing the decision
- **Status**: Proposed, Accepted, Deprecated, Superseded
- **Context**: Forces at play, including technological, political, social, and project local
- **Decision**: The change we're proposing or have agreed to implement
- **Consequences**: What becomes easier or more difficult to do because of this change

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [001](001-refactoring-strategy.md) | Major Refactoring Strategy | Accepted |
| [002](002-dependency-injection-system.md) | Dependency Injection System Design | Accepted |
| [003](003-error-handling-strategy.md) | Global Error Handling Strategy | Accepted |
| [004](004-performance-monitoring.md) | Performance Monitoring and Profiling | Accepted |

## Creating New ADRs

1. Copy `template.md` to a new file with format `###-title.md`
2. Fill in the template with your decision
3. Add entry to this index
4. Commit and create PR for review