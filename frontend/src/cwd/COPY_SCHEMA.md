# CWD pedagogical copy schema

CWD follows the same authoring boundary used elsewhere in Small-GDL:

> **Pedagogical language belongs in activity configuration; interaction/state logic belongs in the engine; visual treatment belongs in the theme/profile.**

The engine reads optional pedagogical framing from `config.copy`. Missing values fall back to stable engine defaults so existing activities remain renderable while their copy is progressively configured.

Existing semantic content remains in its established configuration fields and should not be duplicated into `copy`:

- `config.entry.text`
- `config.judgement.prompt`
- `config.judgement.options`
- `config.confidence.prompt`
- `config.guidance.content`
- `config.resolution.prompt`
- `config.resolution.options`

`config.copy` is for stage framing around those semantic fields.

```json
{
  "copy": {
    "entry": {
      "kicker": "What do you think?"
    },
    "waiting": {
      "kicker": "Response saved",
      "heading": "We’ll show the group responses shortly."
    },
    "reveal": {
      "kicker": "How did the group respond?",
      "heading": "Here’s what everyone said.",
      "prompt": "Your response is highlighted. Look for where people agree, where they differ, and how sure they seem.",
      "continue_label": "Keep going"
    },
    "guidance": {
      "kicker": "Something to think about",
      "continue_label": "Think again"
    },
    "resolution_wait": {
      "kicker": "Stay with the group",
      "heading": "There’s one more response to make.",
      "lead": "It will appear here when it’s time."
    },
    "resolution": {
      "kicker": "One last look",
      "heading": "What changed — if anything?",
      "lead": "Think again about your original answer and how sure you were.",
      "revised_option_prompt": "What would you choose now?",
      "confidence_prompt": "How sure are you now?"
    },
    "completion": {
      "kicker": "Finished",
      "heading": "That’s it.",
      "lead": "You’re finished with this activity."
    },
    "ended": {
      "kicker": "This activity has ended",
      "heading": "Thanks for taking part."
    },
    "presentation": {
      "collecting": {
        "kicker": "What do you think?"
      },
      "reveal": {
        "kicker": "How did the group respond?",
        "heading": "Here’s what the group said.",
        "prompt": "Look for where responses agree, where they differ, and how sure people seem."
      },
      "resolution": {
        "kicker": "One last look",
        "heading": "What changed — if anything?",
        "lead": "Think again about both your answer and how sure you are."
      },
      "closed": {
        "kicker": "Finished",
        "heading": "Thanks for taking part."
      },
      "self_audit": {
        "kicker": "Take a moment",
        "lead": "Work through this on your own device."
      }
    }
  }
}
```

## Authoring rule

If wording could reasonably change because the learning purpose, activity context, or intended interpretive move changes, place it in activity configuration. If it only describes a stable interface action or system state, it may remain in the reusable engine.

## Session rule

CWD sessions snapshot activity configuration. Copy edits therefore apply to **new sessions**, not sessions that are already open. This preserves a stable record of what participants actually saw.
