# DeepSeek Skills — Professional AI System Prompts

> **Turn DeepSeek into a Principal-level Software Engineer.**

Production-grade system prompts that transform DeepSeek into a senior/staff/principal engineer with deep expertise across frontend and backend engineering. Every prompt is meticulously crafted to enforce best practices, eliminate lazy patterns, and ensure output that is secure, performant, accessible, and maintainable.

---

## Why?

Default AI coding assistants often produce decent code but miss critical production concerns: accessibility, security edge cases, error states, N+1 queries, proper indexing, CSP headers, focus management, cache invalidation, and dozens of other details that separate tutorial code from production systems.

These prompts encode that senior-level judgment directly into the model's system instructions.

---

## Available Skill Prompts

| Prompt | Role | Lines | Coverage |
|--------|------|-------|----------|
| [`frontend-skills.md`](./frontend-skills.md) | Principal Frontend Engineer | 447 | HTML5 semantics, CSS3 deep fundamentals, TypeScript strict, React 19 hooks, Next.js App Router, state management, performance (Core Web Vitals), accessibility (WCAG 2.2 AA), testing (unit to E2E), security (CSP, XSS, CSRF), PWA, i18n, design systems, form handling, real-time patterns, CI/CD, code quality |
| [`backend-skills.md`](./backend-skills.md) | Principal Backend Engineer | 381 | PHP/Laravel 11+, Node.js/TypeScript (Express, Fastify, NestJS, Hono), Python (Django, FastAPI), Go, PostgreSQL/MySQL indexing, Redis, MongoDB, Elasticsearch, REST/GraphQL/gRPC API design, auth (JWT, OAuth2, Passkeys, RBAC/ABAC/ReBAC), architecture (Clean, CQRS, Event-Driven, Microservices), caching strategies, queue/job processing, OWASP Top 10, DevOps (Docker, CI/CD, Terraform), testing |

---

## How to Use

### Option 1: Cursor / Windsurf / Cline Custom Instructions

Copy the contents of the skill file into your AI coding tool's system prompt or custom instructions field.

**With Cline:** Place the `.md` file in your project and reference it via `.clinerules`.

### Option 2: Direct Prompt Injection

Paste the entire skill prompt at the beginning of your conversation with DeepSeek, ChatGPT, or Claude:

```
[Paste frontend-skills.md or backend-skills.md content here]

---

Now, [your task here]
```

### Option 3: GitHub Copilot / Custom Instructions

Add the content to your IDE's custom instructions/rules file. For VS Code with GitHub Copilot, add to `.github/copilot-instructions.md`.

### Option 4: Per-Project Rules

Create a `.cursorrules` or `.clinerules` file in your project root and reference the skill file:

```
# .cursorrules
Follow the engineering standards defined in @skills/frontend-skills.md
```

---

## What Makes These Different?

| Trait | Default AI Code | With These Prompts |
|-------|----------------|-------------------|
| **Error handling** | Often missing | Every state handled (loading, empty, error, edge cases) |
| **Accessibility** | Usually ignored | WCAG 2.2 AA built-in, keyboard nav, screen reader tested |
| **Security** | Minimal | CSP, XSS prevention, CSRF, auth patterns, OWASP coverage |
| **Performance** | Not considered | Core Web Vitals, caching strategies, N+1 prevention, indexing |
| **Type safety** | `any` creep | Strict TypeScript, branded types, zod validation, no `any` |
| **Testing** | Rarely included | Test pyramid, MSW, RTL, Playwright, AAA pattern |
| **Code quality** | Works but messy | Named conventions, SOLID, design patterns, anti-pattern awareness |
| **Completeness** | TODOs and stubs | Full implementations, no placeholders, production-ready |

---

## Project Structure

```
deepseek-skills/
├── README.md                  # This file
├── frontend-skills.md         # Frontend engineering prompt (447 lines)
└── backend-skills.md          # Backend engineering prompt (381 lines)
```



---

## 🚀 Getting Started

### Clone the Repository

```bash
git clone https://github.com/RHKfullstack/DEEPSEEK-SKILLS.git
cd DEEPSEEK-SKILLS
```

### Quick Start

1. Open the skill file you need:
   - `frontend-skills.md` — for frontend tasks
   - `backend-skills.md` — for backend tasks

2. Copy the entire contents.

3. Paste into your AI tool as a system prompt (Cursor, Windsurf, Cline, ChatGPT, Claude, etc.).

4. Start coding with a Principal-level engineer guiding the output.

### Stay Updated

```bash
git pull origin main
```

---

## Contributing

These prompts are living documents. If you find gaps, anti-patterns that should be added, or have suggestions for improvement:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Open a pull request with a clear description

Focus contributions on:
- Missing production concerns
- New framework versions and their best practices
- Anti-patterns that should be explicitly called out
- Better decision frameworks

---

## Roadmap

- [ ] `fullstack-skills.md` — Combined full-stack engineering prompt
- [ ] `devops-skills.md` — DevOps & infrastructure prompt
- [ ] `mobile-skills.md` — React Native / Flutter prompt
- [ ] `system-design-skills.md` — System design & architecture prompt
- [ ] `security-skills.md` — Dedicated application security prompt
- [ ] `code-review-skills.md` — Code review & PR review prompt

---

## License

MIT — Use, modify, and distribute freely. Attribution appreciated but not required.

---

<p align="center">
  <b>Built with ❤️ for engineers who want AI to produce real production code.</b>
</p>