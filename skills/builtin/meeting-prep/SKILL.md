---
name: Meeting Prep
description: Prepare for upcoming meetings by gathering attendee info, relevant emails, and past context
version: 1.0.0
author: Karna Team
category: productivity
icon: "📅"
tags:
  - meeting
  - calendar
  - preparation
  - productivity
triggers:
  - type: schedule
    value: heartbeat
    description: Auto-trigger before upcoming meetings (within 2 hours)
  - type: command
    value: /meeting-prep
    description: Manually prepare for a specific meeting
actions:
  - name: prepare
    description: Generate a full meeting prep summary
    parameters:
      meetingId:
        type: string
        description: Specific meeting/event ID to prepare for
  - name: attendees
    description: Get information about meeting attendees
    parameters:
      meetingId:
        type: string
        description: Meeting ID to look up attendees for
  - name: context
    description: Search for relevant context (emails, notes) for a meeting
    parameters:
      topic:
        type: string
        description: Meeting topic to search context for
dependencies:
  - calendar
  - email
  - notes
requiredTools:
  - calendar_list
  - email_search
---

# Meeting Prep Skill

Automatically prepare context for upcoming meetings.

## Prep Summary Contents

1. **Meeting Details** — Title, time, location/link, duration
2. **Attendees** — Names, roles, last interaction
3. **Agenda** — From calendar description or email threads
4. **Context** — Relevant emails and notes from the past 30 days
5. **Action Items** — Open items from previous meetings with these attendees

## Heartbeat Behavior

- Check calendar for meetings in the next 2 hours
- Only trigger prep for meetings that haven't been prepped yet
- Mark meetings as prepped to avoid duplicate notifications

## Context Search Strategy

1. Search emails by attendee names + meeting title
2. Search notes by meeting title keywords
3. Look for previous meetings with the same attendees
4. Surface any pending action items related to attendees
