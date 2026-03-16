---
name: Travel Planner
description: Create travel itineraries with flights, hotels, attractions, day-by-day plans, and budget tracking
version: 1.0.0
author: Karna Team
category: travel
icon: "✈️"
tags:
  - travel
  - planning
  - itinerary
  - booking
triggers:
  - type: command
    value: /travel
    description: Plan or manage travel itineraries
actions:
  - name: plan
    description: Create a new travel itinerary
    parameters:
      destination:
        type: string
        description: Travel destination
      startDate:
        type: string
        description: Trip start date (YYYY-MM-DD)
      endDate:
        type: string
        description: Trip end date (YYYY-MM-DD)
      budget:
        type: number
        description: Total budget
      currency:
        type: string
        description: Budget currency
  - name: flights
    description: Search for flight options
    parameters:
      from:
        type: string
        description: Departure city/airport
      to:
        type: string
        description: Arrival city/airport
      date:
        type: string
        description: Travel date
  - name: hotels
    description: Search for hotel options
    parameters:
      location:
        type: string
        description: Hotel location
      checkIn:
        type: string
        description: Check-in date
      checkOut:
        type: string
        description: Check-out date
  - name: attractions
    description: Find attractions and things to do
    parameters:
      location:
        type: string
        description: Location to search
  - name: budget
    description: View budget status for a trip
    parameters:
      tripId:
        type: string
        description: Trip identifier
dependencies:
  - web-search
  - calendar
requiredTools:
  - web_search
  - calendar_create
---

# Travel Planner Skill

Create comprehensive travel itineraries with day-by-day plans.

## Planning Process

1. Gather trip parameters (destination, dates, budget, preferences)
2. Search for flights and transportation options
3. Search for accommodation options
4. Find top attractions and activities
5. Generate day-by-day itinerary
6. Track budget allocation

## Itinerary Format

For each day:
- **Morning**: Activity + location + estimated cost
- **Afternoon**: Activity + location + estimated cost
- **Evening**: Dinner recommendation + activity
- **Transport**: How to get between locations

## Budget Categories

- Flights/Transport
- Accommodation
- Food & Dining
- Activities & Attractions
- Shopping
- Miscellaneous (10% buffer)

## Calendar Integration

- Block travel dates on calendar
- Add flight times as calendar events
- Add hotel check-in/check-out reminders
