---
name: Premium UI Design
description: Architectural rules and tokens for high-fidelity glassmorphism interfaces.
---

# Premium UI Design System

This skill codifies the "Digital Atelier" aesthetic used in the LinkedIn Assistant project.

## Core Tokens
- **Background**: `hsl(222, 47%, 11%)` (Deep Navy)
- **Primary Accent**: `hsl(210, 90%, 50%)` (LinkedIn Blue)
- **Glass BG**: `rgba(255, 255, 255, 0.05)`
- **Glass Border**: `rgba(255, 255, 255, 0.1)`

## Design Patterns

### Glassmorphism
- Use `backdrop-filter: blur(12px)` for all primary cards.
- Borders should be subtle (`1px`) and slightly lighter than the background.

### Typography
- Header: **Outfit** (Sans-serif, 700+ weight).
- Body: **Inter** (Sans-serif, 400-500 weight).
- Gradient Text: Use `linear-gradient(to right, #f8fafc, #8b5cf6)` with `-webkit-background-clip: text`.

### Interactive Elements
- Buttons should have a `transform: translateY(-2px)` effect on hover.
- Use `transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1)` for smooth UI feedback.
