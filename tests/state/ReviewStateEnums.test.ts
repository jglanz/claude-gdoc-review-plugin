import {
  CommentAction,
  DriveKind,
  PermissionMode,
  ReviewDecisionChoice,
  ReviewDecisionSource,
  ReviewStatus,
  SyncMode
} from "claude-gdoc-review-plugin"
import { PermissionMode as HookPermissionMode } from "claude-gdoc-review-plugin/hooks/HookOutput"

describe("ReviewStateEnums", () => {
  it("maps every member to its own name", () => {
    ;[
      ReviewStatus,
      ReviewDecisionChoice,
      ReviewDecisionSource,
      DriveKind,
      SyncMode,
      PermissionMode
    ].forEach(candidate =>
      Object.entries(candidate).forEach(([key, value]) =>
        expect(value).toBe(key)
      )
    )
  })

  it("carries the four menu choices", () => {
    expect(Object.keys(ReviewDecisionChoice)).toEqual([
      "approve_auto",
      "approve_manual",
      "check_doc",
      "other"
    ])
  })
})

describe("PermissionMode", () => {
  it("carries the three modes an approval can switch the session into", () => {
    expect(Object.keys(PermissionMode)).toEqual([
      "acceptEdits",
      "default",
      "auto"
    ])
  })

  it("is the same enum the hook layer re-exports", () => {
    // The persisted `approvedMode` is validated against it, so a hook result
    // and a recorded approval cannot name different sets of modes.
    expect(HookPermissionMode).toBe(PermissionMode)
  })
})

describe("ReviewDecisionSource", () => {
  it("maps every member to its own name", () => {
    Object.entries(ReviewDecisionSource).forEach(([key, value]) =>
      expect(value).toBe(key)
    )
  })

  it("carries exactly the two ways a decision reaches the state file", () => {
    expect(Object.keys(ReviewDecisionSource)).toEqual([
      "ask_user_question",
      "cli"
    ])
  })
})

describe("CommentAction", () => {
  it("maps every member to its own name", () => {
    Object.entries(CommentAction).forEach(([key, value]) =>
      expect(value).toBe(key)
    )
  })

  it("carries the two actions the plugin takes on a comment thread", () => {
    expect(Object.keys(CommentAction)).toEqual(["reply", "resolve"])
  })
})
