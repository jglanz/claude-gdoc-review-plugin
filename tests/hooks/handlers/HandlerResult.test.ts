import {
  HandlerResult,
  HookOutput,
  PostToolUseHookOutput
} from "claude-gdoc-review-plugin"

async function handleNothing(): HandlerResult {
  return HookOutput.none()
}

async function handleSomething(): HandlerResult {
  return HookOutput.postToolUseContext("noted")
}

describe("HandlerResult", () => {
  it("is the promise of a hook result", async () => {
    const output = (await handleSomething()) as PostToolUseHookOutput

    expect(output.hookSpecificOutput.additionalContext).toBe("noted")
  })

  it("carries the print-nothing result", async () => {
    expect(await handleNothing()).toBeNull()
  })
})
