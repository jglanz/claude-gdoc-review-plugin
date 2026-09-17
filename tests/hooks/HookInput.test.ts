import {
  HookEventName,
  HookInputCodec,
  HostToolName,
  NestedError,
  parseHookInput
} from "claude-gdoc-review-plugin"

import { readHookFixture } from "../support/hookTestSupport.js"

describe("parseHookInput", () => {
  it("validates a PreToolUse payload and keeps the tool input verbatim", () => {
    const input = parseHookInput(
      readHookFixture("pre-tool-use-exit-plan-mode.json")
    )

    expect(input.hook_event_name).toBe(HookEventName.PreToolUse)
    expect(input).toMatchObject({
      tool_name: HostToolName.ExitPlanMode,
      tool_input: {},
      session_id: "session-fixture"
    })
  })

  it("validates a PostToolUse payload including its response", () => {
    const input = parseHookInput(
      readHookFixture("post-tool-use-update-drive-file.json")
    )

    expect(input.hook_event_name).toBe(HookEventName.PostToolUse)
    expect(input).toHaveProperty("tool_response")
  })

  it("validates a PermissionRequest payload including its suggestions", () => {
    const input = parseHookInput(
      readHookFixture("permission-request-exit-plan-mode.json")
    )

    expect(input.hook_event_name).toBe(HookEventName.PermissionRequest)
    expect(input).toMatchObject({ tool_name: HostToolName.ExitPlanMode })
    expect(input).toHaveProperty("permission_suggestions")
  })

  it("validates a SessionStart payload with its source", () => {
    const input = parseHookInput(readHookFixture("session-start-resume.json"))

    expect(input.hook_event_name).toBe(HookEventName.SessionStart)
    expect(input).toMatchObject({ source: "resume" })
  })

  it("accepts a payload without the optional fields", () => {
    const input = parseHookInput({
      session_id: "s",
      transcript_path: "/tmp/t.jsonl",
      cwd: "/tmp",
      hook_event_name: HookEventName.SessionStart
    })

    expect(input.hook_event_name).toBe(HookEventName.SessionStart)
  })

  it("refuses an unknown event", () => {
    expect(() =>
      parseHookInput({
        session_id: "s",
        transcript_path: "/tmp/t.jsonl",
        cwd: "/tmp",
        hook_event_name: "Notification"
      })
    ).toThrow(NestedError)
  })

  it("refuses a payload missing a required field and reports the issues", () => {
    const fixture = readHookFixture("pre-tool-use-exit-plan-mode.json")
    delete fixture.tool_name

    let error: NestedError = null
    try {
      parseHookInput(fixture)
    } catch (caught) {
      error = caught as NestedError
    }

    expect(error).toBeInstanceOf(NestedError)
    expect(error.message).toBe(HookInputCodec.InvalidPayloadMessage)
    expect(Array.isArray(error.context.issues)).toBe(true)
  })

  it("refuses a value that is not an object at all", () => {
    expect(() => parseHookInput(null)).toThrow(NestedError)
    expect(() => parseHookInput("PreToolUse")).toThrow(NestedError)
  })
})
