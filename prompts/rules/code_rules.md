# Code Rules — Non-Negotiable

## Core principles

- **Every function has a clear single responsibility**
- **Every error is handled** — no silent failures, no bare `except:`,
  no empty `catch` blocks
- **No TODO comments in committed code** — implement or delete
- **No placeholder implementations** — if it says it does X, it does X
- **Types everywhere** — TypeScript strict mode, Python type hints,
  Go exported identifiers documented
- **Zero debug statements** — no `console.log`, no `print(` leftovers,
  no `fmt.Println` for debugging, no `dbg!`

## File and function size

- Functions: typically < 50 lines, absolute max 100
- Files: typically 200–400 lines, absolute max 800
- Extract utilities from large modules
- Organize by feature / domain, not by file type

## Naming

- Variables and functions: `camelCase` (JS/TS) or `snake_case` (Python/Go)
  with descriptive names
- Booleans: `is`, `has`, `should`, or `can` prefixes
- Interfaces, types, components: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Custom hooks: `useCamelCase`

## Immutability

Prefer immutable data. In Python: `@dataclass(frozen=True)` or
`NamedTuple` for DTOs. In TS/JS: readonly types, `as const`, spread
instead of mutation. In Go: return new values where idiomatic.

## Anti-patterns to avoid

- Deep nesting (> 4 levels) — use early returns
- Magic numbers — use named constants
- Long functions — split by responsibility
- Mutation of shared state — return copies
- `any` types in TypeScript — use `unknown` or real types
- Bare `except:` or `catch(e)` that swallows errors
- `// @ts-ignore` / `# type: ignore` without a comment explaining why

## Language restrictions (daily-builder specific)

Never use: **Rust, Haskell, Erlang, Elixir, Crystal**

Prefer: **Go** (systems), **Python** (scripting, ML, data), **TypeScript**
or **JavaScript** (web), **C** (when a systems-level lang is genuinely
required and Go doesn't fit).

## Security

- Never hardcode secrets, API keys, passwords, or tokens
- Always use environment variables or a secret manager
- Validate required secrets at startup
- Use parameterized queries (never string concatenation for SQL)
- Sanitize user HTML
- Rate limit state-changing endpoints
- CSRF protection on forms
- Error messages must not leak sensitive data
