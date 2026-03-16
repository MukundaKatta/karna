---
name: Health Tracker
description: Track daily health metrics including water intake, sleep, exercise, steps, and mood
version: 1.0.0
author: Karna Team
category: health
icon: "💪"
tags:
  - health
  - fitness
  - tracker
  - wellness
triggers:
  - type: command
    value: /health
    description: Manage health tracking via command
  - type: pattern
    value: "workout|exercise|sleep|slept|water|drank|steps|walked|mood|feeling"
    description: Detect health-related mentions in conversation
actions:
  - name: log
    description: Log a health metric
    parameters:
      metric:
        type: string
        description: Metric type (water, sleep, exercise, steps, mood)
      value:
        type: string
        description: Value to log
  - name: summary
    description: Get daily health summary
    parameters:
      date:
        type: string
        description: Date to summarize (YYYY-MM-DD)
  - name: weekly
    description: Get weekly health report
  - name: streaks
    description: View current streaks
permissions:
  - file_write
  - file_read
---

# Health Tracker Skill

Track and visualize daily health metrics.

## Tracked Metrics

- **water** — Glasses/ml of water consumed (goal: 8 glasses)
- **sleep** — Hours of sleep (goal: 7-9 hours)
- **exercise** — Type and duration of exercise
- **steps** — Step count for the day (goal: 10,000)
- **mood** — Scale of 1-5 or descriptive (great, good, okay, bad, terrible)

## Natural Language Support

- "drank 3 glasses of water"
- "slept 7 hours last night"
- "did 30 minutes of running"
- "walked 8000 steps today"
- "feeling great today"

## Streaks

Track consecutive days of hitting goals:
- Water goal streak
- Sleep goal streak
- Exercise streak (any exercise logged)
- Step goal streak

## Storage

Health data stored in `~/.karna/health.json`.
