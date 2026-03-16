---
name: News Digest
description: Search and summarize news articles on configured topics into a concise digest
version: 1.0.0
author: Karna Team
category: information
icon: "📰"
tags:
  - news
  - digest
  - headlines
  - information
triggers:
  - type: schedule
    value: heartbeat
    description: Periodically refresh news digest
  - type: command
    value: /news
    description: Manually request a news digest
actions:
  - name: digest
    description: Generate a full news digest on configured topics
  - name: search
    description: Search for news on a specific topic
    parameters:
      topic:
        type: string
        description: Topic to search news about
      count:
        type: number
        description: Number of articles to include
  - name: headlines
    description: Get top headlines only (no summaries)
dependencies:
  - web-search
requiredTools:
  - web_search
---

# News Digest Skill

Search for and summarize news articles into a readable digest.

## Digest Format

For each article:
- **Headline** in bold
- **Source** and publish time
- **Summary** in 1-2 sentences

Group articles by topic when generating a full digest.

## Default Topics

Unless the user specifies otherwise, cover:
- Technology
- World news
- Business/Finance

Users can override via the `topics` input parameter.

## Behavior

- On heartbeat: refresh once every 4 hours
- On command: generate immediately
- Deduplicate articles from multiple sources
- Prioritize recent articles (last 24 hours)
- Maximum 10 articles per digest unless overridden
