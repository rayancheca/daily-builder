# Project Wishlist

Topics I actually want to build. `start.sh` in wishlist mode picks from the
**Unused** list below. Add freely — one line per idea. Short is fine; the LLM
will expand into a full spec. Move to **Used** after building.

---

## Unused

- [ ] (add your own here — one line per idea)

---
- [ ] 1. LLM-Automated Incident Response (IR) Sandbox. Security Operations Centers (SOCs) are drowning in alerts. Build a pipeline that ingests raw, messy network logs or SIEM alerts and uses a local, fine-tuned LLM (like Llama 3) to translate them into human-readable incident summaries. The differentiator: Have the AI automatically generate the remediation scripts (e.g., a Bash or PowerShell script to isolate the compromised endpoint or block an IP). The stack: Python, ELK Stack (Elasticsearch, Logstash, Kibana), and a local LLM via Ollama. You could easily build the analyst dashboard in SwiftUI, using Firebase to sync the live alerts and generated scripts in real-time.
- [ ] Behavioral Biometrics Authentication System: Passwords are out; continuous authentication is in. Build an authorization system that doesn't just check a password, but analyzes how the user interacts with the system. The differentiator: Train a machine learning model (like a Random Forest or SVM) on keystroke dynamics—typing speed, flight time between keys, and error rates. If the behavior suddenly deviates, the system flags the session as hijacked and forces a re-authentication. The stack: Scikit-learn or TensorFlow for the ML model, paired with a custom web or mobile frontend to capture the input telemetry.

## Used

(built projects will be moved here automatically when wishlist mode picks them)