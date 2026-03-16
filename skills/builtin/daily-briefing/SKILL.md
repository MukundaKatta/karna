---
name: Daily Briefing
description: Generate a comprehensive morning briefing with weather, calendar events, news headlines, and pending tasks
version: 1.0.0
author: Karna Team
category: productivity
icon: "📋"
tags:
  - briefing
  - morning
  - productivity
  - daily
triggers:
  - type: schedule
    value: heartbeat
    description: Automatically triggered during morning heartbeat
  - type: command
    value: /briefing
    description: Manually request a daily briefing
actions:
  - name: generate
    description: Generate the full daily briefing
  - name: weather
    description: Get current weather information
  - name: calendar
    description: Get today's calendar events
  - name: news
    description: Get top news headlines
  - name: tasks
    description: Get pending tasks and reminders
dependencies:
  - calendar
  - web-search
requiredTools:
  - web_search
  - calendar_list
---

# Daily Briefing Skill

Generate a concise, actionable morning briefing for the user.

## Briefing Structure

1. **Greeting** — Time-aware greeting (Good morning/afternoon/evening)
2. **Weather** — Current conditions and forecast for the day
3. **Calendar** — Today's events with times and locations
4. **News** — Top 3-5 relevant news headlines with brief summaries
5. **Tasks** — Pending reminders and to-do items

## Formatting Rules

- Use bullet points for each section
- Keep weather to 1-2 lines
- Calendar events sorted chronologically
- News headlines with source attribution
- Flag any calendar conflicts or urgent items

## Behavior

- On heartbeat: only trigger between 6 AM and 10 AM local time
- On command: generate immediately regardless of time
- If a dependency is unavailable, skip that section with a note
- Cache results for 30 minutes to avoid redundant API calls
