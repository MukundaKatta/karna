---
name: Smart Home
description: Control smart home devices via Home Assistant — lights, thermostat, locks, cameras, and scenes
version: 1.0.0
author: Karna Team
category: home-automation
icon: "🏠"
tags:
  - smart-home
  - home-assistant
  - iot
  - automation
triggers:
  - type: command
    value: /home
    description: Control smart home devices via command
  - type: pattern
    value: "lights?|thermostat|temperature|lock|unlock|camera|scene"
    description: Detect smart home device mentions
actions:
  - name: lights
    description: Control lights (on/off/brightness/color)
    parameters:
      entity:
        type: string
        description: Light entity name or area
      state:
        type: string
        description: "on, off, or toggle"
      brightness:
        type: number
        description: Brightness 0-255
      color:
        type: string
        description: Color name or hex value
  - name: thermostat
    description: Control thermostat (temperature/mode)
    parameters:
      temperature:
        type: number
        description: Target temperature
      mode:
        type: string
        description: "heat, cool, auto, off"
  - name: lock
    description: Control locks
    parameters:
      entity:
        type: string
        description: Lock entity name
      action:
        type: string
        description: "lock or unlock"
    riskLevel: high
  - name: camera
    description: View camera status or snapshots
    parameters:
      entity:
        type: string
        description: Camera entity name
  - name: scene
    description: Activate a scene
    parameters:
      name:
        type: string
        description: Scene name to activate
  - name: status
    description: Get device or area status
    parameters:
      entity:
        type: string
        description: Entity or area name
permissions:
  - network_access
---

# Smart Home Skill

Control smart home devices via Home Assistant REST API.

## Configuration

Requires in the agent config:
- `homeAssistant.url` — Home Assistant instance URL (e.g., http://homeassistant.local:8123)
- `homeAssistant.token` — Long-lived access token

## Supported Devices

- **Lights**: on/off, brightness (0-255), color (name or hex), transition
- **Thermostat**: target temp, HVAC mode (heat/cool/auto/off)
- **Locks**: lock/unlock (requires confirmation for unlock)
- **Cameras**: snapshot URL, motion detection status
- **Scenes**: activate predefined scenes

## Safety

- Lock/unlock operations require high-risk approval
- All commands are logged
- Validate entity IDs before sending to API
- Timeout of 10 seconds for API calls

## Natural Language

- "turn on the living room lights"
- "set temperature to 72"
- "lock the front door"
- "activate movie scene"
- "show camera status"
