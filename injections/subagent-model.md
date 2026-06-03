---
id: subagent-model
title: Subagent Model Policy
trigger: interactive
tags: [injection, policy, subagents, model-selector]
---

When spawning subagents, use high model: "{{ocx model subagent --tier high}}"; low model: "{{ocx model subagent --tier low}}". Standard is high unless it's certainly a small request.
