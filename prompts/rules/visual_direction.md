# Visual Direction — Non-Negotiable

Every project with any UI must have a distinct, intentional visual identity.
"Dark navy + blue accent" is not a visual direction — it is the absence of one.
The default is banned. You must pick from the palette below and commit to it
before writing a single line of CSS or Tailwind.

---

## The palette (pick exactly one per project)

### 1. Retro Terminal
Amber or green phosphor on near-black (`#0d0d0d`). Scanline texture or subtle
CRT grid. Monospace everything — UI chrome included. Blinking cursors, minimal
icons, status lines. Feels like 1985 hardware that still runs.
Best for: memory allocators, system monitors, CLI-heavy tools, debuggers.

### 2. Neo-Brutalism
White or off-white base. Raw bold sans-serif, thick black borders, flat blocks
of vivid color (one loud accent — red, lime, electric yellow). No gradients, no
shadows — everything is flat and intentional. Brutally readable.
Best for: developer tools, dashboards with strong hierarchy, anything where the
data should feel confrontational.

### 3. Glassmorphism Depth
Very dark or vivid gradient background. Cards are `backdrop-filter: blur(16px)`
frosted glass with `bg-white/10` fill and subtle white border. Vivid accent
colors (purple, cyan, pink) that glow through the glass. Multiple z-layers.
Best for: AI/ML tools, neural network visualizers, anything that should feel
like looking through layers.

### 4. Dark Luxury
Deep charcoal or pure black (`#0a0a0a`). Gold, copper, or champagne accents
(`#c9a84c` or similar). Tight premium spacing, editorial typography (serif or
high-quality sans), subtle texture. Nothing loud — everything refined.
Best for: security tooling that should feel authoritative, financial dashboards,
anything meant to feel like premium software.

### 5. Cyberpunk Neon
Near-black or very dark purple base. Two vivid accent colors — hot pink + cyan,
or lime + electric blue. Strong glow effects (`box-shadow`, `text-shadow`).
Glitch animation on key elements. Feels like a hacker scene.
Best for: network visualizers, attack surface trackers, anything with real-time
threat data.

### 6. Swiss / International
White base. Black and one single accent color. Strict grid, deliberate
asymmetry. Typography-first — type is the design. Generous whitespace, precise
alignment. No decoration that isn't carrying meaning.
Best for: developer tools, documentation-heavy projects, CLI output design.

### 7. Bento Editorial
Asymmetric grid of varied-size cards — some large, some small. Strong
typographic hierarchy across the grid. Two or three intentional background
tones. Grid breaking where appropriate. Feels like a magazine layout.
Best for: dashboards with multiple data types, portfolio pieces, anything that
needs to show a lot of information without feeling cluttered.

### 8. Light Utility
White or very light gray base (`#f8f8f8`). Dense information, small typography,
high data-to-chrome ratio. Feels like Bloomberg Terminal or Linear — built for
people who live in the tool. Minimal but never boring.
Best for: analytics dashboards, log viewers, anything where the data is the
hero and decoration is noise.

### 9. Retro-Futurism
Space-age curves, gradient mesh backgrounds (purple-to-teal, or orange-to-pink).
Rounded panels, 70s-80s sci-fi palette. Feels like a 1979 concept computer.
Best for: AI tools, anything that should feel visionary or speculative.

### 10. Phosphor CLI
Classic green-on-black (`#00ff41` on `#0d1117`) or white-on-black terminal.
Every interaction is text-first. Rich ANSI-style formatting — bold, dim,
colored segments. No browser-style widgets — everything feels like a shell.
Best for: pure CLI tools, monitoring agents, anything that runs in a terminal.

---

## Rules

1. **Pick before writing any CSS or Tailwind.** The direction shapes every
   decision — don't pick a color scheme and then try to match it to a direction.

2. **No navy + blue default.** `#0a0e1a` background + `#3b82f6` accent is
   explicitly banned as a selection. It is not on this list.

3. **Check project_history.md.** The `visual_direction` field in each history
   entry records what was used. Do not use the same direction as either of
   the two most recently completed projects.

4. **Commit to it fully.** One direction, followed through on every component.
   No blending two directions. No reverting to blue because something is hard
   to style in the chosen direction.

5. **Specify the full palette in the project spec (CLAUDE.md):**
   - Background color (hex)
   - Surface color (hex)
   - Primary text color (hex)
   - Accent color (hex)
   - Secondary accent if applicable (hex)
   - Font family for UI chrome
   - Font family for code/data
   - One sentence describing the visual mood

6. **The direction must match the project's domain and emotional register.**
   A memory allocator debugger should feel like Retro Terminal, not Glassmorphism.
   A neural network interpretability tool should feel like Glassmorphism, not
   Neo-Brutalism. Use judgment — but use it before touching the keyboard.

---

## Before marking UI done, check all of these

- [ ] Does it avoid looking like the blue-navy template?
- [ ] Does it demonstrate clear visual hierarchy (not uniform emphasis)?
- [ ] Does it have intentional hover, focus, and active states?
- [ ] Does it have real depth — layering, shadows, or motion — not just flat panels?
- [ ] Would it look distinctive in a portfolio screenshot?
- [ ] Does the aesthetic match the product's emotional register?
