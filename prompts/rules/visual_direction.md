# Visual Direction — Derive It, Don't Assign It

The visual identity of a project must feel inevitable — like it couldn't have
been anything else. It comes from understanding the project first: who uses it,
what the data feels like, what the tool needs to communicate. Never pick a style
from a list and apply it. That produces the same result as defaulting to navy+blue.

---

## The derivation process (do this before touching any CSS)

Answer these four questions. The answers determine everything.

### 1. Who is the actual user, and what tools do they live in?

A SOC analyst lives in Splunk, CrowdStrike Falcon, Elastic SIEM — dense, dark,
status-driven. An ML researcher lives in Jupyter, W&B, papers — data-first,
scientific, precise. A systems engineer lives in terminals, profilers, gdb,
Instruments — raw, dense, monospace. A developer lives in VSCode, Linear,
GitHub — clean, functional, information-rich but not overwhelming.

The tool should feel like it belongs in the same ecosystem as what that user
already trusts. Not identical — better — but recognizably in the same world.

### 2. What is the emotional register of the data being shown?

- **Urgent / operational** (threats, anomalies, live system state) →
  High contrast, strong status colors, designed for sustained attention
  under pressure. No decorative flourishes.

- **Technical / precise** (memory layouts, network packets, binary data,
  performance metrics) → High information density, monospace-heavy, raw
  numbers should be beautiful, not dressed up.

- **Analytical / exploratory** (ML activations, graph traversals, data
  pipelines) → Scientific visualization aesthetic. Color encodes meaning.
  Chrome gets out of the way of the data.

- **Operational / workflow** (CI/CD, developer tools, CLIs) → Functional
  above all. Every pixel earns its place. Typography carries the design.

### 3. What does the tool need to communicate nonverbally?

- Trust and control → Restraint, precision, nothing flashy
- Speed and urgency → Tight spacing, strong status colors, real-time motion
- Depth and insight → Layering, information hierarchy, visual complexity
  that rewards attention
- Power and capability → Density, raw technical data treated as beautiful

### 4. What would make a domain expert say "this looks right"?

A senior SOC analyst looking at a security tool should feel like they're
looking at something that understands their world. A systems programmer
looking at a profiler should feel like it was built by someone who has
actually read memory addresses. That intuitive correctness is the target.

---

## Derivation examples

**Memory allocator visualizer** →
Users: systems engineers, C programmers. Data: raw hex addresses, block
sizes, fragmentation percentages. Register: technical/precise.
What it communicates: power, control over low-level systems.
Result: dark terminal, amber or green phosphor, monospace-everything,
numbers are the hero. Looks like perf or Instruments made beautiful.

**SOC incident response dashboard** →
Users: SOC analysts, IR consultants. Data: alerts, IPs, timestamps, severity.
Register: urgent/operational. What it communicates: trust, control, speed.
Result: dark, high-density, strong severity colors (red/amber/yellow/blue),
no decoration. Looks like CrowdStrike Falcon, not a startup landing page.

**Transformer interpretability lab** →
Users: ML researchers. Data: attention matrices, activation patterns, circuit
graphs. Register: analytical/exploratory. What it communicates: depth, insight.
Result: dark background, vivid scientific color scales (the data HAS color),
clean chrome that steps back. Looks like a polished Jupyter visualization.

**Network topology visualizer** →
Users: distributed systems engineers. Data: nodes, edges, convergence state.
Register: technical/precise. What it communicates: the system structure.
Result: the graph IS the design. Chrome is minimal. Edge and node colors
encode state. Nothing competes with the topology.

**Log anomaly detection engine** →
Users: SREs, data engineers. Data: log streams, anomaly scores, blast radius.
Register: operational/analytical. What it communicates: confidence, signal vs. noise.
Result: dark base with bright signal spikes, time-series data as the focal
point, Bloomberg Terminal energy — dense but controlled.

---

## What is always banned

- **Navy + blue default.** `#0a0e1a` background + `#3b82f6` accent is not
  a visual direction. It is what you get when you make no decision.

- **Aesthetic chosen before understanding the project.** If you picked the
  visual direction before answering the four questions above, start over.

- **Style for style's sake.** Glassmorphism on a CLI tool. Retro terminal on
  a consumer-facing product. Neo-brutalism on a security dashboard. The style
  must emerge from the product, not be imposed on it.

- **Uniform treatment.** Every component the same border-radius, the same
  shadow, the same spacing. Visual hierarchy requires variety with purpose.

- **Decorative elements that don't carry meaning.** Gradient blobs, abstract
  background shapes, decorative dividers. Every visual element should earn
  its place by communicating something.

---

## What to specify in CLAUDE.md

After running the derivation process, commit these values in the project spec:

```
Visual direction:
  Derived from: [one sentence — users + data + register]
  Background: #hex
  Surface: #hex
  Surface elevated: #hex
  Border: #hex
  Text primary: #hex
  Text secondary: #hex
  Accent (primary): #hex — [what this color communicates]
  Accent (secondary, if any): #hex — [what this color communicates]
  UI font: [typeface] — [why this one]
  Data/mono font: [typeface] — [why this one]
  Information density: high / medium / low
  Animation register: [real-time data / narrative transitions / minimal / none]
  Visual mood: [one sentence — what a domain expert should feel looking at it]
```

---

## Before marking UI done

- [ ] Could you explain in one sentence why this looks the way it does,
      grounded in the project's users and data? If not, the direction
      wasn't derived — it was guessed.
- [ ] Would a domain expert say "this looks right for this kind of tool"?
- [ ] Is every color doing something — communicating status, hierarchy,
      or meaning — or is any color just decoration?
- [ ] Does it look genuinely different from every other project in the portfolio?
- [ ] Hover, focus, active states: designed, not browser defaults.
