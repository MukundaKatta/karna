---
name: Code Reviewer
description: Analyze code for bugs, security issues, performance problems, and style improvements
version: 1.0.0
author: Karna Team
category: development
icon: "🔍"
tags:
  - code
  - review
  - security
  - development
triggers:
  - type: command
    value: /review
    description: Review code from a file path or pasted snippet
  - type: event
    value: github.pull_request
    description: Auto-review on GitHub PR webhook
actions:
  - name: review
    description: Perform a full code review
    parameters:
      filePath:
        type: string
        description: Path to the file to review
      code:
        type: string
        description: Code snippet to review (alternative to filePath)
      language:
        type: string
        description: Programming language hint
  - name: diff
    description: Review a git diff
    parameters:
      diff:
        type: string
        description: Git diff content
  - name: security
    description: Security-focused review only
    parameters:
      filePath:
        type: string
        description: Path to the file to scan
dependencies:
  - files
requiredTools:
  - file_read
---

# Code Reviewer Skill

Analyze code for quality issues and provide structured feedback.

## Review Categories

1. **Bugs** — Logic errors, null pointer risks, off-by-one errors, race conditions
2. **Security** — SQL injection, XSS, hardcoded secrets, insecure defaults, path traversal
3. **Performance** — N+1 queries, unnecessary allocations, missing caching opportunities
4. **Style** — Naming conventions, code organization, readability, dead code

## Severity Levels

- **critical** — Must fix. Security vulnerabilities or data-loss bugs.
- **high** — Should fix. Logic errors or significant performance issues.
- **medium** — Consider fixing. Style issues or minor improvements.
- **low** — Nice to have. Suggestions and best practices.

## Output Format

For each finding:
```
[SEVERITY] Category: Brief description
  Line(s): X-Y
  Suggestion: How to fix it
```

End with a summary: total findings by severity, overall code quality rating (A-F).

## Supported Languages

TypeScript, JavaScript, Python, Go, Rust, Java, C/C++, and others via pattern matching.
