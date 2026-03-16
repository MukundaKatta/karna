---
name: Expense Tracker
description: Track personal expenses from natural language, categorize spending, and generate reports
version: 1.0.0
author: Karna Team
category: finance
icon: "💰"
tags:
  - expense
  - finance
  - budget
  - tracker
triggers:
  - type: command
    value: /expense
    description: Manage expenses via command
  - type: pattern
    value: "spent|paid|bought|cost me|charged"
    description: Detect expense mentions in natural language
actions:
  - name: add
    description: Add a new expense entry
    parameters:
      amount:
        type: number
        description: Amount spent
      category:
        type: string
        description: Expense category
      description:
        type: string
        description: What the expense was for
      currency:
        type: string
        description: Currency code (INR, USD, EUR)
  - name: list
    description: List expenses with optional date range filter
    parameters:
      startDate:
        type: string
        description: Start date (YYYY-MM-DD)
      endDate:
        type: string
        description: End date (YYYY-MM-DD)
      category:
        type: string
        description: Filter by category
  - name: summary
    description: Get spending summary grouped by category
  - name: report
    description: Generate a monthly expense report
    parameters:
      month:
        type: number
        description: Month number (1-12)
      year:
        type: number
        description: Year
permissions:
  - file_write
  - file_read
---

# Expense Tracker Skill

Parse and track expenses from natural language input.

## Natural Language Parsing

Understand expressions like:
- "spent $50 on groceries"
- "paid ₹2000 for electricity bill"
- "bought lunch for €15"
- "taxi cost me $25"

Extract: amount, currency, category, and description.

## Categories

- **food** — groceries, restaurants, coffee, snacks
- **transport** — taxi, fuel, bus, metro, parking
- **entertainment** — movies, games, subscriptions, hobbies
- **bills** — electricity, water, internet, phone, rent
- **shopping** — clothing, electronics, household items
- **health** — medicine, doctor, gym, pharmacy
- **other** — anything that doesn't fit above

## Storage

Expenses are stored in `~/.karna/expenses.json` as a JSON array.
Each entry includes: id, amount, currency, category, description, date, tags.

## Reports

- Daily, weekly, monthly summaries
- Category-wise breakdown with percentages
- Top spending categories highlighted
- Comparison with previous period when available
