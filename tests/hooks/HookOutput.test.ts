import {
  HookEventName,
  HookOutput,
  PermissionBehavior,
  PermissionDecision,
  PermissionMode,
  PermissionUpdateDestination,
  PermissionUpdateType
} from "claude-gdoc-review-plugin"

describe("HookOutput", () => {
  describe("none", () => {
    it("means print nothing", () => {
      expect(HookOutput.none()).toBeNull()
      expect(HookOutput.serialize(HookOutput.none())).toBeNull()
    })
  })

  describe("preToolUseAllow", () => {
    it("builds an allow carrying the reason", () => {
      expect(HookOutput.preToolUseAllow("because")).toEqual({
        hookSpecificOutput: {
          hookEventName: HookEventName.PreToolUse,
          permissionDecision: PermissionDecision.allow,
          permissionDecisionReason: "because"
        }
      })
    })

    it("falls back to the default reason", () => {
      expect(
        HookOutput.preToolUseAllow().hookSpecificOutput.permissionDecisionReason
      ).toBe(HookOutput.DefaultAllowReason)
    })
  })

  describe("preToolUseDeny", () => {
    it("carries the protocol text as the decision reason", () => {
      const output = HookOutput.preToolUseDeny("run the round")

      expect(output.hookSpecificOutput.permissionDecision).toBe(
        PermissionDecision.deny
      )
      expect(output.hookSpecificOutput.permissionDecisionReason).toBe(
        "run the round"
      )
    })
  })

  describe("postToolUseContext", () => {
    it("adds context under the PostToolUse event", () => {
      expect(HookOutput.postToolUseContext("noted")).toEqual({
        hookSpecificOutput: {
          hookEventName: HookEventName.PostToolUse,
          additionalContext: "noted"
        }
      })
    })
  })

  describe("permissionRequestAllow", () => {
    it("answers the prompt with an allow and a mode switch", () => {
      expect(
        HookOutput.permissionRequestAllow([
          HookOutput.newSetModeUpdate(PermissionMode.acceptEdits)
        ])
      ).toEqual({
        hookSpecificOutput: {
          hookEventName: HookEventName.PermissionRequest,
          decision: {
            behavior: PermissionBehavior.allow,
            updatedPermissions: [
              {
                type: PermissionUpdateType.setMode,
                mode: PermissionMode.acceptEdits,
                destination: PermissionUpdateDestination.session
              }
            ]
          }
        }
      })
    })

    it("allows with no permission updates at all", () => {
      expect(
        HookOutput.permissionRequestAllow().hookSpecificOutput.decision
          .updatedPermissions
      ).toEqual([])
    })
  })

  describe("sessionStartContext", () => {
    it("adds context under the SessionStart event", () => {
      expect(HookOutput.sessionStartContext("resumed")).toEqual({
        hookSpecificOutput: {
          hookEventName: HookEventName.SessionStart,
          additionalContext: "resumed"
        }
      })
    })
  })

  describe("serialize", () => {
    it("renders a result as the exact hook JSON", () => {
      expect(HookOutput.serialize(HookOutput.postToolUseContext("noted"))).toBe(
        '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"noted"}}'
      )
    })
  })
})
